#!/usr/bin/env python3
"""
NammaCart – Python Seed Script (zero npm dependency)
─────────────────────────────────────────────────────
Runs directly against Aiven PostgreSQL using psycopg2.
Idempotent: deletes demo stores/products/items before re-inserting.

Usage:
  python src/scripts/seed.py
"""

import os, sys, uuid, time
from pathlib import Path
from datetime import datetime

# ── load .env manually ────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parents[2]
ENV  = ROOT / ".env"

if ENV.exists():
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# ── colour helpers ─────────────────────────────────────────────────────────────
class C:
    RESET = "\x1b[0m"; BOLD = "\x1b[1m"; GREEN = "\x1b[32m"
    CYAN  = "\x1b[36m"; YELLOW = "\x1b[33m"; RED = "\x1b[31m"
    DIM   = "\x1b[2m";  MAGENTA = "\x1b[35m"; BLUE = "\x1b[34m"

def ok(m):   print(f"{C.GREEN}✅{C.RESET} {m}")
def info(m): print(f"{C.CYAN}ℹ{C.RESET}  {m}")
def warn(m): print(f"{C.YELLOW}⚠{C.RESET}  {m}")
def err(m):  print(f"{C.RED}✖{C.RESET}  {m}", file=sys.stderr)
def step(m): print(f"\n{C.BOLD}{C.BLUE}▶ {m}{C.RESET}")
def dim(m):  print(f"{C.DIM}   {m}{C.RESET}")

# ── catalogue ─────────────────────────────────────────────────────────────────
STORES = [
    dict(name="Koramangala", code="STORE-KOR-01", address="5th Block, Koramangala, Bengaluru - 560034", latitude=12.9279, longitude=77.6271),
    dict(name="Whitefield",  code="STORE-WF-01",  address="ITPL Main Road, Whitefield, Bengaluru - 560066", latitude=12.9698, longitude=77.7499),
    dict(name="MG Road",     code="STORE-MGR-01", address="MG Road, Bengaluru - 560001", latitude=12.9757, longitude=77.6011),
]
STORE_TAG = {"STORE-KOR-01": "KOR", "STORE-WF-01": "WF", "STORE-MGR-01": "MGR"}

PRODUCTS = [
    dict(sku="SKU-MILK-001",  title="Nandini Toned Milk",  description="Fresh pasteurised toned milk from Karnataka Co-op.", category="Dairy",       price=30.00,  prefix="MILK"),
    dict(sku="SKU-MAGGI-002", title="Maggi Noodles",       description="2-Minute Nestle Maggi Masala Noodles pack of 4.",   category="Instant Food", price=14.00,  prefix="MGGI"),
    dict(sku="SKU-SALT-003",  title="Tata Salt",           description="Tata Salt 1 kg iodised vacuum evaporated salt.",    category="Staples",      price=28.00,  prefix="SALT"),
    dict(sku="SKU-PRLG-004",  title="Parle-G",             description="Parle-G Original Glucose Biscuits 800 g pack.",     category="Biscuits",     price=65.00,  prefix="PRLG"),
    dict(sku="SKU-DETL-005",  title="Dettol Handwash",     description="Dettol Original Liquid Handwash 250 ml refill.",    category="Hygiene",      price=85.00,  prefix="DETL"),
    dict(sku="SKU-RICE-006",  title="Rice",                description="Sona Masoori Raw Rice 5 kg — premium quality.",     category="Staples",      price=320.00, prefix="RICE"),
    dict(sku="SKU-CURD-007",  title="Curd",                description="Nandini Natural Fresh Curd 500 g cup.",             category="Dairy",        price=45.00,  prefix="CURD"),
    dict(sku="SKU-BRNJ-008",  title="Brinjal",             description="Fresh organic brinjal sourced from local farms.",   category="Vegetables",   price=40.00,  prefix="BRNJ"),
    dict(sku="SKU-TMAT-009",  title="Tomato",              description="Farm-fresh ripe tomatoes sourced daily — per kg.", category="Vegetables",   price=25.00,  prefix="TMAT"),
    dict(sku="SKU-PTAT-010",  title="Potato",              description="Premium Kufri Jyoti potatoes, 1 kg pack.",         category="Vegetables",   price=35.00,  prefix="PTAT"),
]

UNITS_PER_STORE = 10

# ── connect ────────────────────────────────────────────────────────────────────
def connect():
    try:
        import psycopg2
    except ImportError:
        err("psycopg2 not installed. Run: pip install psycopg2-binary"); sys.exit(1)

    pg_url   = os.environ.get("AIVEN_PG_URL")
    ca_path  = ROOT / "certs" / "ca.pem"
    sslmode  = "require"
    sslroot  = str(ca_path) if ca_path.exists() else None

    kwargs = dict(dsn=pg_url, connect_timeout=15, sslmode=sslmode)
    if sslroot:
        kwargs["sslrootcert"] = sslroot

    conn = psycopg2.connect(**kwargs)
    conn.autocommit = False
    return conn

# ─────────────────────────────────────────────────────────────────────────────
def main():
    print("\n" + "═" * 65)
    print(f"{C.BOLD}{C.MAGENTA}  NammaCart — Database Seed Script{C.RESET}")
    print("═" * 65)

    step("Connecting to Aiven PostgreSQL…")
    conn = connect()
    cur  = conn.cursor()
    ok("Connected")

    # ── verify tables exist ───────────────────────────────────────────────────
    for tbl in ("stores", "products", "unique_items"):
        cur.execute("SELECT to_regclass(%s)", (f"public.{tbl}",))
        if cur.fetchone()[0] is None:
            err(f"Table '{tbl}' not found — run migrations first:")
            err(f"  psql $AIVEN_PG_URL < migrations/001_init_retail_schema.sql")
            conn.close(); sys.exit(1)

    # ── idempotent wipe ───────────────────────────────────────────────────────
    step("Wiping existing demo data (idempotent reset)…")
    demo_codes = [s["code"] for s in STORES]
    demo_skus  = [p["sku"]  for p in PRODUCTS]

    # 1. grab demo store IDs
    cur.execute("SELECT id FROM stores WHERE code = ANY(%s)", (demo_codes,))
    store_ids = [r[0] for r in cur.fetchall()]

    if store_ids:
        cur.execute("DELETE FROM unique_items WHERE store_id::text = ANY(%s)", (store_ids,))
        dim(f"  Deleted UniqueItems for {len(store_ids)} existing demo stores")

    cur.execute("DELETE FROM products WHERE sku = ANY(%s)", (demo_skus,))
    dim(f"  Deleted existing demo products")

    cur.execute("DELETE FROM stores WHERE code = ANY(%s)", (demo_codes,))
    dim(f"  Deleted existing demo stores")

    conn.commit()
    ok("Demo data cleared — starting fresh")

    # ── seed stores ───────────────────────────────────────────────────────────
    step("Seeding Stores…")
    seeded_stores = []
    for s in STORES:
        sid = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO stores (id, name, code, address, latitude, longitude, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,NOW(),NOW()) RETURNING id, name, code""",
            (sid, s["name"], s["code"], s["address"], s["latitude"], s["longitude"])
        )
        row = cur.fetchone()
        seeded_stores.append({"id": row[0], "name": row[1], "code": row[2]})
        ok(f"Store: {C.BOLD}{row[1]}{C.RESET} [{row[2]}]  id={C.DIM}{row[0]}{C.RESET}")
    conn.commit()

    # ── seed products ─────────────────────────────────────────────────────────
    step("Seeding Products…")
    seeded_products = []
    for p in PRODUCTS:
        pid = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO products (id, sku, title, description, category, price, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,NOW(),NOW()) RETURNING id, sku, title, price""",
            (pid, p["sku"], p["title"], p["description"], p["category"], p["price"])
        )
        row = cur.fetchone()
        seeded_products.append({"id": row[0], "sku": row[1], "title": row[2], "price": row[3], "prefix": p["prefix"]})
        ok(f"Product: {C.BOLD}{row[2]}{C.RESET} [{row[1]}]  ₹{row[3]}")
    conn.commit()

    # ── seed unique items ─────────────────────────────────────────────────────
    total_units = UNITS_PER_STORE * len(PRODUCTS) * len(STORES)
    step(f"Seeding UniqueItems — {UNITS_PER_STORE} × {len(PRODUCTS)} × {len(STORES)} = {total_units} rows…")

    rows = []
    for store in seeded_stores:
        tag = STORE_TAG.get(store["code"], store["code"][-3:].upper())
        for product in seeded_products:
            for unit in range(1, UNITS_PER_STORE + 1):
                sn = f"{product['prefix']}-{tag}-{unit:03d}"
                rows.append((str(uuid.uuid4()), product["id"], store["id"], sn, "AVAILABLE"))

    # batch insert in chunks of 100
    chunk = 100
    inserted = 0
    for i in range(0, len(rows), chunk):
        batch = rows[i:i+chunk]
        args_str = ",".join(
            cur.mogrify("(%s,%s,%s,%s,%s,NOW(),NOW(),1)", r).decode() for r in batch
        )
        cur.execute(
            f"INSERT INTO unique_items (id, product_id, store_id, serial_number, status, created_at, updated_at, version) VALUES {args_str}"
        )
        inserted += len(batch)
        dim(f"  Inserted batch {i//chunk + 1}: {inserted}/{len(rows)} rows")
    conn.commit()
    ok(f"Inserted {inserted} UniqueItem rows — all status=AVAILABLE")

    # ── OpenSearch sync ───────────────────────────────────────────────────────
    os_ok = False
    step("Syncing to Aiven OpenSearch…")
    os_uri  = os.environ.get("AIVEN_OPENSEARCH_URI")
    os_user = os.environ.get("AIVEN_OPENSEARCH_USER")
    os_pass = os.environ.get("AIVEN_OPENSEARCH_PASSWORD")
    index   = os.environ.get("AIVEN_OPENSEARCH_INDEX", "store_inventory")

    if not os_uri:
        warn("AIVEN_OPENSEARCH_URI not set — skipping OpenSearch sync")
    else:
        try:
            import requests
            from requests.auth import HTTPBasicAuth
            import urllib3
            urllib3.disable_warnings()

            auth    = HTTPBasicAuth(os_user, os_pass)
            session = requests.Session()
            session.verify = False

            # Fetch inserted items from DB grouped by store+product
            cur.execute("""
                SELECT ui.id, ui.serial_number, ui.store_id, ui.product_id
                FROM unique_items ui
                WHERE ui.status = 'AVAILABLE'
                  AND ui.store_id::text = ANY(%s)
            """, ([str(s["id"]) for s in seeded_stores],))
            db_items = cur.fetchall()

            # Group by (product_id, store_id)
            from collections import defaultdict
            groups = defaultdict(list)
            for row in db_items:
                groups[(row[3], row[2])].append({"uniqueItemId": row[0], "serialNumber": row[1]})

            bulk_lines = []
            for store in seeded_stores:
                store_meta = next(s for s in STORES if s["code"] == store["code"])
                for product in seeded_products:
                    doc_id   = f"{product['id']}_{store['id']}"
                    avail    = groups[(product["id"], store["id"])]
                    bulk_lines.append(f'{{"index":{{"_index":"{index}","_id":"{doc_id}"}}}}')
                    import json
                    bulk_lines.append(json.dumps({
                        "id": doc_id, "productId": product["id"], "storeId": store["id"],
                        "title": product["title"], "category": next(p["category"] for p in PRODUCTS if p["sku"] == product["sku"]),
                        "price": float(product["price"]), "storeName": store["name"],
                        "status": "AVAILABLE", "is_available": True,
                        "storeLocation": {"lat": store_meta["latitude"], "lon": store_meta["longitude"]},
                        "availableCount": len(avail), "availableItems": avail,
                        "updatedAt": datetime.utcnow().isoformat() + "Z"
                    }))

            body = "\n".join(bulk_lines) + "\n"
            resp = session.post(f"{os_uri}/_bulk", data=body,
                                headers={"Content-Type": "application/x-ndjson"},
                                auth=auth, timeout=20)
            if resp.status_code in (200, 201):
                result = resp.json()
                errs   = [i for i in result.get("items", []) if i.get("index", {}).get("error")]
                if errs:
                    warn(f"{len(errs)} OpenSearch bulk errors")
                else:
                    ok(f"Indexed {len(bulk_lines)//2} docs into '{index}'")
                    os_ok = True
            else:
                warn(f"OpenSearch bulk returned HTTP {resp.status_code}")
        except Exception as e:
            warn(f"OpenSearch sync skipped: {e}")

    # ── summary ───────────────────────────────────────────────────────────────
    print("\n" + "─" * 65)
    print(f"{C.BOLD}{C.GREEN}  SEED COMPLETE{C.RESET}")
    print("─" * 65)
    print(f"""
  {C.BOLD}Seeded {len(seeded_stores)} stores{C.RESET}, {C.BOLD}{len(seeded_products)} products{C.RESET}, and {C.BOLD}{inserted} unique items{C.RESET}.

  {C.BOLD}Stores:{C.RESET}
""" + "\n".join(f"    • {s['name']:<14} [{s['code']}]" for s in seeded_stores) + f"""

  {C.BOLD}Products (10):{C.RESET}
""" + "\n".join(f"    • {p['title']:<24} ₹{p['price']:>6}  {p['sku']}" for p in seeded_products) + f"""

  {C.BOLD}UniqueItems per product per store:{C.RESET} {UNITS_PER_STORE}
  {C.BOLD}Total UniqueItems:{C.RESET}                 {inserted}
  {C.BOLD}OpenSearch sync:{C.RESET}                   {"✅ Done" if os_ok else "⚠ Skipped"}
    """)
    print("═" * 65 + "\n")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
