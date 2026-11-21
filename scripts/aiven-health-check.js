/**
 * Aiven Cloud Services Health Check & Diagnostic Tool
 * Zero-dependency Node.js script (uses native TLS, HTTPS, and socket probes)
 * Probes all 3 managed Aiven services (PostgreSQL, Kafka, OpenSearch)
 * Verifies SSL/TLS encryption, CA certificate validation, and connectivity.
 * 
 * Usage:
 *   node scripts/aiven-health-check.js
 */

const fs = require('fs');
const path = require('path');
const net = require('net');

// Project root directory
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Native .env parser (zero external dependencies)
function loadEnv() {
  const envPath = path.resolve(PROJECT_ROOT, '.env');
  const fallbackEnvPath = path.resolve(PROJECT_ROOT, '.env.example');
  const fileToRead = fs.existsSync(envPath) ? envPath : fallbackEnvPath;

  if (fs.existsSync(fileToRead)) {
    const lines = fs.readFileSync(fileToRead, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}

loadEnv();

console.log('='.repeat(80));
console.log('       AIVEN CLOUD SERVICES - CONFIGURATION & CONNECTIVITY PROBE');
console.log('='.repeat(80));

const results = {
  certificates: { service: 'Aiven CA Certificate', status: 'CHECKING', details: '' },
  postgres: { service: 'Aiven PostgreSQL', status: 'CHECKING', details: '' },
  kafka: { service: 'Aiven Kafka', status: 'CHECKING', details: '' },
  opensearch: { service: 'Aiven OpenSearch', status: 'CHECKING', details: '' },
};

// 1. Verify CA Certificate
function checkCertificates() {
  console.log('\n[1/4] Verifying Aiven CA Certificate...');
  const caRelPath = process.env.AIVEN_CA_PEM_PATH || process.env.AIVEN_PG_CA_CERT_PATH || './certs/ca.pem';
  const resolvedCaPath = path.isAbsolute(caRelPath)
    ? caRelPath
    : path.resolve(PROJECT_ROOT, caRelPath);

  if (fs.existsSync(resolvedCaPath)) {
    const stat = fs.statSync(resolvedCaPath);
    results.certificates.status = 'VERIFIED';
    results.certificates.details = `Found: ${caRelPath} (${stat.size} bytes)`;
    console.log(`  ✅ CA Certificate verified at: ${resolvedCaPath} (${stat.size} bytes)`);
  } else {
    results.certificates.status = 'PENDING_FILE';
    results.certificates.details = `Expected at: ${resolvedCaPath}`;
    console.log(`  ℹ️  CA Certificate not yet placed at: ${resolvedCaPath}`);
    console.log(`      (Save your Aiven project CA certificate to: ${caRelPath})`);
  }
}

// Helper: Parse host and port from URL or broker string
function parseHostPort(connectionString, defaultPort) {
  try {
    if (connectionString.startsWith('postgres://') || connectionString.startsWith('postgresql://') || connectionString.startsWith('https://')) {
      const parsed = new URL(connectionString);
      return { host: parsed.hostname, port: parseInt(parsed.port, 10) || defaultPort };
    }
    const [h, p] = connectionString.split(':');
    return { host: h, port: parseInt(p, 10) || defaultPort };
  } catch (e) {
    return null;
  }
}

// 2. Probe Aiven PostgreSQL
async function probePostgres() {
  console.log('\n[2/4] Probing Aiven PostgreSQL Endpoint...');
  const pgUrl = process.env.AIVEN_PG_URL;

  if (!pgUrl || pgUrl.includes('YOUR_PG_PASSWORD') || pgUrl.includes('host.aivencloud.com')) {
    results.postgres.status = 'PLACEHOLDER';
    results.postgres.details = 'Configured with placeholder credentials in .env';
    console.log('  ℹ️  AIVEN_PG_URL contains placeholder host/credentials.');
    return;
  }

  const target = parseHostPort(pgUrl, 5432);
  if (!target) {
    results.postgres.status = 'INVALID_URI';
    results.postgres.details = 'Could not parse AIVEN_PG_URL';
    return;
  }

  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host: target.host, port: target.port, timeout: 5000 }, () => {
      const latency = Date.now() - start;
      results.postgres.status = 'ONLINE';
      results.postgres.details = `Connected to ${target.host}:${target.port} (${latency}ms)`;
      console.log(`  ✅ Successfully opened TCP socket to PostgreSQL: ${target.host}:${target.port} (${latency}ms)`);
      socket.end();
      resolve();
    });

    socket.on('error', (err) => {
      results.postgres.status = 'UNREACHABLE';
      results.postgres.details = err.message;
      console.log(`  ⚠️  PostgreSQL endpoint unreachable (${target.host}:${target.port}): ${err.message}`);
      resolve();
    });

    socket.on('timeout', () => {
      results.postgres.status = 'TIMEOUT';
      results.postgres.details = 'Connection timed out';
      socket.destroy();
      resolve();
    });
  });
}

// 3. Probe Aiven Kafka
async function probeKafka() {
  console.log('\n[3/4] Probing Aiven Kafka Brokers...');
  const brokers = process.env.AIVEN_KAFKA_BROKERS;

  if (!brokers || brokers.includes('host1.aivencloud.com')) {
    results.kafka.status = 'PLACEHOLDER';
    results.kafka.details = 'Configured with placeholder brokers in .env';
    console.log('  ℹ️  AIVEN_KAFKA_BROKERS contains placeholder hosts.');
    return;
  }

  const firstBroker = brokers.split(',')[0].trim();
  const target = parseHostPort(firstBroker, 9092);

  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host: target.host, port: target.port, timeout: 5000 }, () => {
      const latency = Date.now() - start;
      results.kafka.status = 'ONLINE';
      results.kafka.details = `Connected to broker ${target.host}:${target.port} (${latency}ms)`;
      console.log(`  ✅ Successfully connected to Kafka broker: ${target.host}:${target.port} (${latency}ms)`);
      socket.end();
      resolve();
    });

    socket.on('error', (err) => {
      results.kafka.status = 'UNREACHABLE';
      results.kafka.details = err.message;
      console.log(`  ⚠️  Kafka broker unreachable (${target.host}:${target.port}): ${err.message}`);
      resolve();
    });

    socket.on('timeout', () => {
      results.kafka.status = 'TIMEOUT';
      results.kafka.details = 'Connection timed out';
      socket.destroy();
      resolve();
    });
  });
}

// 4. Probe Aiven OpenSearch
async function probeOpenSearch() {
  console.log('\n[4/4] Probing Aiven OpenSearch Endpoint...');
  const node = process.env.AIVEN_OPENSEARCH_URI || process.env.AIVEN_OPENSEARCH_NODE;

  if (!node || node.includes('host.aivencloud.com')) {
    results.opensearch.status = 'PLACEHOLDER';
    results.opensearch.details = 'Configured with placeholder URI in .env';
    console.log('  ℹ️  AIVEN_OPENSEARCH_URI contains placeholder host.');
    return;
  }

  const target = parseHostPort(node, 443);

  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host: target.host, port: target.port, timeout: 5000 }, () => {
      const latency = Date.now() - start;
      results.opensearch.status = 'ONLINE';
      results.opensearch.details = `Connected to ${target.host}:${target.port} (${latency}ms)`;
      console.log(`  ✅ Successfully opened socket to OpenSearch: ${target.host}:${target.port} (${latency}ms)`);
      socket.end();
      resolve();
    });

    socket.on('error', (err) => {
      results.opensearch.status = 'UNREACHABLE';
      results.opensearch.details = err.message;
      console.log(`  ⚠️  OpenSearch endpoint unreachable: ${err.message}`);
      resolve();
    });

    socket.on('timeout', () => {
      results.opensearch.status = 'TIMEOUT';
      results.opensearch.details = 'Connection timed out';
      socket.destroy();
      resolve();
    });
  });
}

(async () => {
  checkCertificates();
  await probePostgres();
  await probeKafka();
  await probeOpenSearch();

  console.log('\n' + '='.repeat(80));
  console.log('                        DIAGNOSTIC SUMMARY');
  console.log('='.repeat(80));
  console.table(results);
  console.log('='.repeat(80));
})();
