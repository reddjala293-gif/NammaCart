#!/usr/bin/env bash
# ==============================================================================
# Automated Aiven Services Setup & Configuration Script (Bash)
# Provisions and configures Aiven PostgreSQL, Kafka, and OpenSearch.
# ==============================================================================

set -e

PROJECT_NAME="${AIVEN_PROJECT_NAME:-}"
CLOUD_REGION="${AIVEN_CLOUD_REGION:-google-us-east4}"
ENV_FILE="${ENV_FILE:-.env}"

echo "======================================================================"
echo "      AIVEN CLOUD SERVICES - AUTOMATED PROVISIONING SCRIPT"
echo "======================================================================"

if ! command -v avn &> /dev/null; then
    echo "[ERROR] Aiven CLI ('avn') is not installed or not in PATH."
    echo "Install it via: pip install aiven-client"
    echo "Authenticate with: avn user login <your-email@example.com>"
    exit 1
fi

if [ -z "$PROJECT_NAME" ]; then
    read -p "Enter your Aiven Project Name: " PROJECT_NAME
fi

echo "[Step 1/5] Using Aiven Project: $PROJECT_NAME ($CLOUD_REGION)"

# 2. Download CA
mkdir -p certs
echo "[Step 2/5] Downloading Project CA Certificate..."
avn project ca-get --project "$PROJECT_NAME" > certs/aiven-ca.pem || true

# 3. Create Services
echo "[Step 3/5] Provisioning / Verifying Aiven Services..."
avn service create retail-pg --project "$PROJECT_NAME" --service-type pg --plan startup-4 --cloud "$CLOUD_REGION" 2>/dev/null || echo "retail-pg exists."
avn service create retail-kafka --project "$PROJECT_NAME" --service-type kafka --plan startup-2 --cloud "$CLOUD_REGION" 2>/dev/null || echo "retail-kafka exists."
avn service create retail-opensearch --project "$PROJECT_NAME" --service-type opensearch --plan startup-4 --cloud "$CLOUD_REGION" 2>/dev/null || echo "retail-opensearch exists."

# 4. Provision Topics
echo "[Step 4/5] Creating Kafka Topics..."
for topic in inventory.changes orders.created search.index.sync; do
    avn service topic-create retail-kafka "$topic" --project "$PROJECT_NAME" --partitions 3 --replication 2 2>/dev/null || true
done

# 5. Extract Credentials
echo "[Step 5/5] Extracting connection URIs into $ENV_FILE..."
PG_URI=$(avn service get retail-pg --project "$PROJECT_NAME" --format '{service_uri}' 2>/dev/null || echo "")
KAFKA_URI=$(avn service get retail-kafka --project "$PROJECT_NAME" --format '{service_uri}' 2>/dev/null || echo "")
OS_URI=$(avn service get retail-opensearch --project "$PROJECT_NAME" --format '{service_uri}' 2>/dev/null || echo "")

cat <<EOF > "$ENV_FILE"
PORT=3000
NODE_ENV=production
API_PREFIX=api/v1

AIVEN_PG_URL=$PG_URI
AIVEN_PG_CA_CERT_PATH=./certs/aiven-ca.pem
AIVEN_PG_SSL_REJECT_UNAUTHORIZED=true
AIVEN_PG_POOL_SIZE=50

AIVEN_KAFKA_BROKERS=$KAFKA_URI
AIVEN_KAFKA_CLIENT_ID=retail-backend-service
AIVEN_KAFKA_GROUP_ID=retail-search-sync-group
AIVEN_KAFKA_CA_CERT_PATH=./certs/aiven-ca.pem
AIVEN_KAFKA_ACCESS_CERT_PATH=./certs/service.cert
AIVEN_KAFKA_ACCESS_KEY_PATH=./certs/service.key

KAFKA_TOPIC_INVENTORY_CHANGES=inventory.changes
KAFKA_TOPIC_ORDERS_CREATED=orders.created
KAFKA_TOPIC_SEARCH_SYNC=search.index.sync

AIVEN_OPENSEARCH_NODE=$OS_URI
AIVEN_OPENSEARCH_CA_CERT_PATH=./certs/aiven-ca.pem
AIVEN_OPENSEARCH_INDEX=store_inventory

DEFAULT_RESERVATION_TTL_SECONDS=600
EOF

echo "Setup complete! Run: node scripts/aiven-health-check.js"
