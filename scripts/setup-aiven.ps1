<#
.SYNOPSIS
    Automated Aiven Services Setup & Configuration Script (PowerShell)
    Provisions and configures Aiven PostgreSQL, Kafka, and OpenSearch for the Retail Backend.
.DESCRIPTION
    1. Validates Aiven CLI (`avn`) availability and project selection.
    2. Provisions PostgreSQL, Kafka (with topics), and OpenSearch services.
    3. Downloads the Project CA certificate (ca.pem) and Kafka mTLS access certificates.
    4. Automatically writes connection credentials into `.env`.
#>

param(
    [string]$ProjectName = $env:AIVEN_PROJECT_NAME,
    [string]$CloudRegion = "google-us-east4",
    [string]$EnvFile = ".env"
)

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "      AIVEN CLOUD SERVICES - AUTOMATED PROVISIONING SCRIPT" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# 1. Check if Aiven CLI (avn) is installed
$avnCmd = Get-Command avn -ErrorAction SilentlyContinue
if (-not $avnCmd) {
    Write-Host "`n[ERROR] Aiven CLI ('avn') is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Install it via Python pip:" -ForegroundColor Yellow
    Write-Host "    pip install aiven-client" -ForegroundColor White
    Write-Host "Then authenticate with your Aiven account:" -ForegroundColor Yellow
    Write-Host "    avn user login <your-email@example.com>" -ForegroundColor White
    Write-Host "`nAlternatively, provision services via the Aiven Web Console (https://console.aiven.io)." -ForegroundColor Yellow
    exit 1
}

# 2. Project check
if (-not $ProjectName) {
    $ProjectName = Read-Host "`nEnter your Aiven Project Name"
}

Write-Host "`n[Step 1/5] Using Aiven Project: $ProjectName (Cloud: $CloudRegion)" -ForegroundColor Green

# 3. Download Project CA Certificate
$certsDir = Join-Path $PSScriptRoot "..\certs"
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir -Force | Out-Null
}

$caCertPath = Join-Path $certsDir "aiven-ca.pem"
Write-Host "`n[Step 2/5] Downloading Project CA Certificate to $caCertPath..." -ForegroundColor Green
try {
    avn project ca-get --project $ProjectName > $caCertPath
    Write-Host "  ✅ Project CA Certificate saved successfully." -ForegroundColor Green
} catch {
    Write-Host "  ⚠️ Could not download CA certificate via CLI. Please export it manually from the Aiven Console." -ForegroundColor Yellow
}

# 4. Create / Verify Services
Write-Host "`n[Step 3/5] Provisioning / Verifying Aiven Services..." -ForegroundColor Green

# A. PostgreSQL
Write-Host "  -> Checking PostgreSQL service 'retail-pg'..." -ForegroundColor White
$pgService = avn service get retail-pg --project $ProjectName --json 2>$null | ConvertFrom-Json
if (-not $pgService) {
    Write-Host "     Creating 'retail-pg' (PostgreSQL startup-4)..." -ForegroundColor Yellow
    avn service create retail-pg --project $ProjectName --service-type pg --plan startup-4 --cloud $CloudRegion
} else {
    Write-Host "     'retail-pg' is already active." -ForegroundColor Green
}

# B. Kafka
Write-Host "  -> Checking Kafka service 'retail-kafka'..." -ForegroundColor White
$kafkaService = avn service get retail-kafka --project $ProjectName --json 2>$null | ConvertFrom-Json
if (-not $kafkaService) {
    Write-Host "     Creating 'retail-kafka' (Kafka startup-2)..." -ForegroundColor Yellow
    avn service create retail-kafka --project $ProjectName --service-type kafka --plan startup-2 --cloud $CloudRegion
} else {
    Write-Host "     'retail-kafka' is already active." -ForegroundColor Green
}

# C. OpenSearch
Write-Host "  -> Checking OpenSearch service 'retail-opensearch'..." -ForegroundColor White
$osService = avn service get retail-opensearch --project $ProjectName --json 2>$null | ConvertFrom-Json
if (-not $osService) {
    Write-Host "     Creating 'retail-opensearch' (OpenSearch startup-4)..." -ForegroundColor Yellow
    avn service create retail-opensearch --project $ProjectName --service-type opensearch --plan startup-4 --cloud $CloudRegion
} else {
    Write-Host "     'retail-opensearch' is already active." -ForegroundColor Green
}

# 5. Provision Kafka Topics
Write-Host "`n[Step 4/5] Provisioning Kafka Topics on 'retail-kafka'..." -ForegroundColor Green
$topics = @("inventory.changes", "orders.created", "search.index.sync")
foreach ($t in $topics) {
    Write-Host "  -> Ensuring topic '$t' exists (partitions: 3, replication: 2)..." -ForegroundColor White
    avn service topic-create retail-kafka $t --project $ProjectName --partitions 3 --replication 2 2>$null
}

# 6. Retrieve Credentials and Write .env
Write-Host "`n[Step 5/5] Extracting Service Connection URIs into $EnvFile..." -ForegroundColor Green

$pgUri = avn service get retail-pg --project $ProjectName --format '{service_uri}' 2>$null
$kafkaUri = avn service get retail-kafka --project $ProjectName --format '{service_uri}' 2>$null
$osUri = avn service get retail-opensearch --project $ProjectName --format '{service_uri}' 2>$null

$envContent = @"
# ==========================================
# Auto-Generated Aiven Retail Configuration
# ==========================================
PORT=3000
NODE_ENV=production
API_PREFIX=api/v1

# Aiven PostgreSQL (mTLS / SSL)
AIVEN_PG_URL=$pgUri
AIVEN_PG_CA_CERT_PATH=./certs/aiven-ca.pem
AIVEN_PG_SSL_REJECT_UNAUTHORIZED=true
AIVEN_PG_POOL_SIZE=50

# Aiven Kafka (mTLS / SASL_SSL)
AIVEN_KAFKA_BROKERS=$kafkaUri
AIVEN_KAFKA_CLIENT_ID=retail-backend-service
AIVEN_KAFKA_GROUP_ID=retail-search-sync-group
AIVEN_KAFKA_CA_CERT_PATH=./certs/aiven-ca.pem
AIVEN_KAFKA_ACCESS_CERT_PATH=./certs/service.cert
AIVEN_KAFKA_ACCESS_KEY_PATH=./certs/service.key

KAFKA_TOPIC_INVENTORY_CHANGES=inventory.changes
KAFKA_TOPIC_ORDERS_CREATED=orders.created
KAFKA_TOPIC_SEARCH_SYNC=search.index.sync

# Aiven OpenSearch (HTTPS + CA)
AIVEN_OPENSEARCH_NODE=$osUri
AIVEN_OPENSEARCH_CA_CERT_PATH=./certs/aiven-ca.pem
AIVEN_OPENSEARCH_INDEX=store_inventory

# Business Rules
DEFAULT_RESERVATION_TTL_SECONDS=600
"@

Set-Content -Path $EnvFile -Value $envContent -Encoding UTF8
Write-Host "  ✅ Connection credentials written to $EnvFile" -ForegroundColor Green

Write-Host "`n======================================================================" -ForegroundColor Cyan
Write-Host "   AIVEN SETUP COMPLETE! RUN: node scripts/aiven-health-check.js" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
