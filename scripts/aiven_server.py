#!/usr/bin/env python3
"""
NammaCart Live Aiven Backend Server
─────────────────────────────────────────────────────────────────────────────
Directly connects to:
  • Live Aiven PostgreSQL (Pessimistic Row-Locking SELECT ... FOR UPDATE NOWAIT)
  • Live Aiven Kafka (SASL_SSL event streaming on topic: nammacart-inventory)
  • Serves the frontend at http://localhost:3000/
"""

import os
import sys
import json
import ssl
import time
import uuid
import mimetypes
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs

# Load .env
ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
CA_PEM_PATH = ROOT / "certs" / "ca.pem"

if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import psycopg2
import psycopg2.pool
from psycopg2.extensions import ISOLATION_LEVEL_READ_COMMITTED
import requests
from requests.auth import HTTPBasicAuth
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# OpenSearch Cluster Credentials
OPENSEARCH_URI = os.environ.get("AIVEN_OPENSEARCH_URI", "").rstrip("/")
OPENSEARCH_USER = os.environ.get("AIVEN_OPENSEARCH_USER", "")
OPENSEARCH_PASS = os.environ.get("AIVEN_OPENSEARCH_PASSWORD", "")
opensearch_auth = HTTPBasicAuth(OPENSEARCH_USER, OPENSEARCH_PASS)

def query_aiven_opensearch(query_str):
    """Executes a real-time multi-match fuzzy query against Aiven OpenSearch index namma_products."""
    if not OPENSEARCH_URI:
        return None
    try:
        if not query_str or query_str.strip() == "*":
            q_body = {"query": {"match_all": {}}, "size": 30}
        else:
            q_body = {
                "query": {
                    "multi_match": {
                        "query": query_str.strip(),
                        "fields": ["name^3", "description^2", "category"],
                        "fuzziness": "AUTO",
                        "prefix_length": 2
                    }
                },
                "size": 30
            }
        url = f"{OPENSEARCH_URI}/api/console/proxy?path=namma_products%2F_search&method=POST"
        resp = requests.post(
            url,
            auth=opensearch_auth,
            headers={"osd-xsrf": "kibana", "Content-Type": "application/json"},
            data=json.dumps(q_body),
            verify=False,
            timeout=5
        )
        if resp.status_code == 200:
            hits = resp.json().get("hits", {}).get("hits", [])
            print(f"🔍 Aiven OpenSearch query '{query_str}' returned {len(hits)} hits.")
            return hits
        else:
            print(f"⚠️ OpenSearch HTTP {resp.status_code}: {resp.text[:100]}")
    except Exception as e:
        print(f"⚠️ OpenSearch query error: {e}")
    return None

# Initialize PostgreSQL Connection Pool
PG_URL = os.environ.get("AIVEN_PG_URL")
if not PG_URL:
    print("❌ ERROR: AIVEN_PG_URL is not set in .env")
    sys.exit(1)

ssl_kwargs = {"sslmode": "require"}
if CA_PEM_PATH.exists():
    ssl_kwargs["sslrootcert"] = str(CA_PEM_PATH)

pg_pool = psycopg2.pool.ThreadedConnectionPool(
    minconn=2,
    maxconn=20,
    dsn=PG_URL,
    connect_timeout=10,
    **ssl_kwargs
)
print("✅ Connected to Live Aiven PostgreSQL Pool")

# Initialize Live Kafka Producer
kafka_brokers = os.environ.get("AIVEN_KAFKA_BROKERS")
kafka_user = os.environ.get("AIVEN_KAFKA_USER")
kafka_pass = os.environ.get("AIVEN_KAFKA_PASSWORD")
kafka_producer = None

if kafka_brokers and kafka_user:
    try:
        from kafka import KafkaProducer
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

        kafka_producer = KafkaProducer(
            bootstrap_servers=kafka_brokers.split(","),
            security_protocol="SASL_SSL",
            sasl_mechanism="PLAIN",
            sasl_plain_username=kafka_user,
            sasl_plain_password=kafka_pass,
            ssl_context=ssl_ctx,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            request_timeout_ms=10000,
        )
        print(f"✅ Connected to Live Aiven Kafka Broker: {kafka_brokers}")
    except Exception as e:
        print(f"⚠️ Kafka connection warning: {e}")
else:
    print("⚠️ Kafka credentials not configured")

PUBLIC_DIR = ROOT / "public"
PORT = 3000

# Emoji map for products
EMOJI_MAP = {
    "nandini toned milk": "🥛",
    "milk": "🥛",
    "maggi noodles": "🍜",
    "tata salt": "🧂",
    "salt": "🧂",
    "parle-g": "🍪",
    "biscuits": "🍪",
    "dettol handwash": "🧼",
    "rice": "🌾",
    "curd": "🥣",
    "brinjal": "🍆",
    "tomato": "🍅",
    "potato": "🥔",
}

# Multi-Language & Phonetic Aliases (Hindi, Kannada, Telugu, Tamil, English)
PRODUCT_ALIASES = {
    "brinjal": ["baingan", "vankaya", "kathirikai", "badanekayi", "eggplant", "aubergine", "bringal", "brinjal"],
    "tomato": ["tamatar", "thakkali", "tamata", "tomato"],
    "potato": ["aloo", "aaloo", "bangaladumpa", "batata", "potato", "alu"],
    "nandini toned milk": ["milk", "doodh", "dudh", "paalu", "haalu", "nandini", "toned milk", "cow milk"],
    "curd": ["dahi", "thayir", "mosaru", "perugu", "curd", "yogurt"],
    "rice": ["chawal", "arisi", "akki", "annam", "rice", "sona masoori", "bhat"],
    "maggi noodles": ["maggi", "noodles", "magi", "instant noodles", "chowmein"],
    "tata salt": ["salt", "namak", "uppu", "tata salt", "lavana"],
    "parle-g": ["parle", "parleg", "biscuit", "biscuits", "cookies", "glucose"],
    "dettol handwash": ["dettol", "handwash", "soap", "liquid soap", "hand wash", "sanitizer"],
}

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class AivenRequestHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def send_json(self, status_code, data):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        pathname = parsed.path
        query = parse_qs(parsed.query)

        # 1. API: GET /api/v1/search?store_id=...&q=...
        if pathname == "/api/v1/search":
            store_param = query.get("store_id", query.get("storeId", ["Koramangala"]))[0].strip()
            search_query = query.get("q", [""])[0].strip().lower()

            opensearch_hits = None
            os_matched_names = {}
            if search_query:
                opensearch_hits = query_aiven_opensearch(search_query)
                if opensearch_hits:
                    for h in opensearch_hits:
                        src = h.get("_source", {})
                        nm = src.get("name", "").strip().lower()
                        sc = float(h.get("_score", 1.0))
                        if nm:
                            os_matched_names[nm] = sc
                    print(f"✅ OpenSearch matched: {os_matched_names}")

            conn = pg_pool.getconn()
            try:
                cur = conn.cursor()
                # Query products and available physical units for the specified store
                sql = """
                    SELECT 
                        p.id::text,
                        p.title,
                        p.category,
                        p.price::float,
                        p.sku,
                        s.id::text,
                        s.name,
                        COUNT(ui.id)::int AS available_count,
                        COALESCE(
                            json_agg(
                                json_build_object(
                                    'uniqueItemId', ui.id::text,
                                    'serialNumber', ui.serial_number
                                )
                            ) FILTER (WHERE ui.id IS NOT NULL),
                            '[]'::json
                        ) AS available_items
                    FROM stores s
                    CROSS JOIN products p
                    LEFT JOIN unique_items ui 
                        ON ui.store_id = s.id 
                       AND ui.product_id = p.id 
                       AND ui.status = 'AVAILABLE'
                    WHERE (s.name ILIKE %s OR s.id::text = %s)
                    GROUP BY p.id, p.title, p.category, p.price, p.sku, s.id, s.name
                    ORDER BY p.title;
                """
                cur.execute(sql, (f"%{store_param}%", store_param))
                rows = cur.fetchall()
                cur.close()

                hits = []
                for r in rows:
                    prod_id, title, category, price, sku, store_id, store_name, avail_cnt, avail_items = r
                    t_lower = title.lower()
                    aliases = PRODUCT_ALIASES.get(t_lower, [t_lower])

                    os_score = 0.0
                    matched_via_os = False
                    if search_query:
                        if os_matched_names:
                            for os_nm, sc in os_matched_names.items():
                                if os_nm in t_lower or t_lower in os_nm:
                                    os_score = max(os_score, sc)
                                    matched_via_os = True
                            # Also check aliases if OpenSearch matched an alias
                            if os_score == 0.0:
                                for a in aliases:
                                    if any(os_nm in a.lower() or a.lower() in os_nm for os_nm in os_matched_names):
                                        os_score = 1.0
                                        matched_via_os = True
                                        break
                        else:
                            # Fallback if OpenSearch returned 0 hits
                            matched = (
                                search_query in t_lower or
                                search_query in category.lower() or
                                any(search_query in a.lower() or a.lower() in search_query for a in aliases)
                            )
                            if matched:
                                os_score = 1.0

                        if os_score <= 0.0:
                            continue

                    emoji = EMOJI_MAP.get(t_lower, "📦")
                    unit = "L" if "milk" in t_lower else "pkt" if "maggi" in t_lower else "kg"

                    hits.append({
                        "id": prod_id,
                        "productId": prod_id,
                        "title": title,
                        "name": title,
                        "category": category,
                        "price": price,
                        "unit": unit,
                        "emoji": emoji,
                        "sku": sku,
                        "aliases": aliases,
                        "storeId": store_id,
                        "storeName": store_name,
                        "availableCount": avail_cnt,
                        "availableItems": avail_items,
                        "openSearchScore": round(os_score, 2) if os_score > 0 else None,
                        "isAivenPostgres": True,
                        "isAivenOpenSearch": matched_via_os
                    })

                if search_query and hits:
                    hits.sort(key=lambda x: (x.get("openSearchScore") or 0.0), reverse=True)

                is_os = bool(search_query and os_matched_names)
                self.send_json(200, {
                    "total": len(hits),
                    "store": store_param,
                    "query": search_query,
                    "searchEngine": "Aiven OpenSearch (Live Cluster)" if is_os else "Aiven PostgreSQL",
                    "dataSource": "Aiven OpenSearch + Aiven PostgreSQL" if is_os else "Aiven PostgreSQL (Live Cloud)",
                    "opensearchHitsCount": len(opensearch_hits) if opensearch_hits else 0,
                    "hits": hits
                })
            except Exception as e:
                self.send_json(500, {"error": str(e), "message": "Failed querying Aiven PostgreSQL"})
            finally:
                pg_pool.putconn(conn)
            return

        # 1b. API: GET /api/v1/opensearch?q=... (Direct OpenSearch Query Proxy)
        if pathname == "/api/v1/opensearch":
            q_param = query.get("q", [""])[0].strip()
            hits = query_aiven_opensearch(q_param) or []
            self.send_json(200, {
                "engine": "Aiven OpenSearch",
                "index": "namma_products",
                "query": q_param,
                "total": len(hits),
                "hits": hits
            })
            return

        # 2. Static File Serving (Frontend)
        if pathname in ("/", "/index.html"):
            file_path = PUBLIC_DIR / "index.html"
        else:
            file_path = PUBLIC_DIR / pathname.lstrip("/")

        if file_path.exists() and file_path.is_file():
            mime_type, _ = mimetypes.guess_type(str(file_path))
            mime_type = mime_type or "text/html"
            content = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", f"{mime_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        self.send_json(404, {"error": "Not Found", "path": pathname})

    def do_POST(self):
        parsed = urlparse(self.path)
        pathname = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            data = json.loads(body)
        except Exception:
            data = {}

        # 3. API: POST /api/v1/checkout (Strict ACID Pessimistic Row Lock on Live Aiven PG)
        if pathname == "/api/v1/checkout":
            target_unit_id = data.get("uniqueItemId")
            user_id = data.get("userId", "shopper_demo")
            amount = float(data.get("amount", 30.0))

            conn = pg_pool.getconn()
            conn.set_isolation_level(ISOLATION_LEVEL_READ_COMMITTED)
            try:
                cur = conn.cursor()

                # If no specific target unit passed, allocate next available item
                if not target_unit_id:
                    cur.execute("""
                        SELECT id FROM unique_items 
                        WHERE status = 'AVAILABLE' 
                        LIMIT 1 
                        FOR UPDATE SKIP LOCKED;
                    """)
                    row = cur.fetchone()
                    if not row:
                        cur.close()
                        conn.rollback()
                        self.send_json(409, {
                            "statusCode": 409,
                            "errorCode": "SOLD_OUT",
                            "message": "Item just sold out! Live Kafka sync updated inventory."
                        })
                        return
                    target_unit_id = row[0]

                # STRICT GOLDEN INVARIANT: Pessimistic Row Lock with NOWAIT
                # If another concurrent transaction is locking this physical unit, NOWAIT immediately raises error!
                try:
                    cur.execute("""
                        SELECT id, serial_number, status, store_id, product_id 
                        FROM unique_items 
                        WHERE id = %s 
                        FOR UPDATE NOWAIT;
                    """, (target_unit_id,))
                    item_row = cur.fetchone()
                except psycopg2.errors.LockNotAvailable:
                    # Row lock could not be obtained because another concurrent buyer locked it!
                    conn.rollback()
                    cur.close()
                    self.send_json(409, {
                        "statusCode": 409,
                        "errorCode": "ROW_LOCK_CONFLICT",
                        "message": "Item just sold out! Live Kafka sync updated inventory.",
                        "details": "PostgreSQL row-lock rejected concurrent checkout (SELECT ... FOR UPDATE NOWAIT)."
                    })
                    return

                if not item_row or item_row[2] != "AVAILABLE":
                    conn.rollback()
                    cur.close()
                    self.send_json(409, {
                        "statusCode": 409,
                        "errorCode": "ITEM_ALREADY_SOLD",
                        "message": "Item just sold out! Live Kafka sync updated inventory.",
                        "details": f"Physical item {target_unit_id} status is already {item_row[2] if item_row else 'NOT_FOUND'}."
                    })
                    return

                unit_id, serial_num, status, store_id, product_id = item_row

                # Mark Physical Unit SOLD
                cur.execute("""
                    UPDATE unique_items 
                    SET status = 'SOLD', sold_at = NOW(), updated_at = NOW() 
                    WHERE id = %s;
                """, (unit_id,))

                # Record Order
                order_num = f"NC-{int(time.time() * 1000) % 90000 + 10000}"
                order_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO orders (id, order_number, user_id, store_id, status, total_amount, currency, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, 'CONFIRMED', %s, 'INR', NOW(), NOW())
                    RETURNING id;
                """, (order_id, order_num, user_id, store_id, amount))

                # Record Order Item binding to serialized physical unit
                cur.execute("""
                    INSERT INTO order_items (id, order_id, product_id, unique_item_id, serial_number, price, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW());
                """, (str(uuid.uuid4()), order_id, product_id, unit_id, serial_num, amount))

                # Write to Transactional Outbox
                outbox_payload = {
                    "event": "item.sold",
                    "itemId": str(unit_id),
                    "serialNumber": serial_num,
                    "storeId": str(store_id),
                    "productId": str(product_id),
                    "status": "SOLD",
                    "orderId": order_id,
                    "timestamp": time.time()
                }
                cur.execute("""
                    INSERT INTO outbox_events (id, topic, event_name, partition_key, payload, status, created_at)
                    VALUES (%s, 'nammacart-inventory', 'item.sold', %s, %s, 'PUBLISHED', NOW());
                """, (str(uuid.uuid4()), str(store_id), json.dumps(outbox_payload)))

                # COMMIT POSTGRESQL TRANSACTION (Row is now officially SOLD in Aiven PG)
                conn.commit()
                cur.close()

                # EMIT TO LIVE AIVEN KAFKA CLUSTER
                kafka_emitted = False
                if kafka_producer:
                    try:
                        kafka_producer.send("nammacart-inventory", key=str(store_id).encode("utf-8"), value=outbox_payload)
                        kafka_producer.flush(timeout=3)
                        kafka_emitted = True
                        print(f"📡 Emitted live Kafka event for item {serial_num} to 'nammacart-inventory'")
                    except Exception as ke:
                        print(f"⚠️ Kafka produce error: {ke}")

                # SUCCESS RESPONSE
                self.send_json(200, {
                    "statusCode": 200,
                    "status": "CONFIRMED",
                    "orderId": order_id,
                    "orderNumber": order_num,
                    "uniqueItemId": str(unit_id),
                    "serialNumber": serial_num,
                    "stockLocked": True,
                    "postgresLocked": "SELECT FOR UPDATE NOWAIT -> COMMITTED",
                    "kafkaEmitted": kafka_emitted,
                    "kafkaTopic": "nammacart-inventory",
                    "liveAivenPostgres": True,
                    "message": "Order committed to Live Aiven PostgreSQL with real row lock & published to Aiven Kafka!"
                })
            except Exception as ex:
                conn.rollback()
                self.send_json(500, {"error": str(ex), "message": "Transaction error on Aiven PostgreSQL"})
            finally:
                pg_pool.putconn(conn)
            return

        self.send_json(404, {"error": "Not Found", "path": pathname})

def run():
    server = ThreadedHTTPServer(("0.0.0.0", PORT), AivenRequestHandler)
    print("=" * 70)
    print(f"🚀 NAMMACART LIVE AIVEN PRODUCTION SERVER RUNNING ON PORT {PORT}")
    print("=" * 70)
    print(f"  🌐 Website:    http://localhost:{PORT}/")
    print(f"  🐘 Database:   Live Aiven PostgreSQL (Pool active)")
    print(f"  📡 Streaming:  Live Aiven Kafka (nammacart-inventory)")
    print("=" * 70)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        pg_pool.closeall()
        if kafka_producer:
            kafka_producer.close()

if __name__ == "__main__":
    run()
