/**
 * Embedded Mock API & Static Web Server for Frontend Testing
 * Zero-dependency Node.js HTTP server.
 * Serves the frontend UI at http://localhost:3000/ and full OpenAPI 3.0 endpoints.
 * 
 * Usage:
 *   node sdk/mock-server.js
 *   (or: agy-node sdk/mock-server.js)
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// 3 Stores matching Database Seed
const STORES = [
  {
    id: 'e4ae48a3-532e-4f7e-983a-538c8294481c',
    name: 'Koramangala',
    code: 'STORE-KOR-01',
    address: '5th Block, Koramangala, Bengaluru - 560034',
    lat: 12.9279,
    lon: 77.6271,
  },
  {
    id: 'a1f98624-f08c-4fb1-8549-424efa814cdc',
    name: 'Whitefield',
    code: 'STORE-WF-01',
    address: 'ITPL Main Road, Whitefield, Bengaluru - 560066',
    lat: 12.9698,
    lon: 77.7499,
  },
  {
    id: 'a75a4941-16d5-4405-ae94-34bc09c6aafa',
    name: 'MG Road',
    code: 'STORE-MGR-01',
    address: 'MG Road, Bengaluru - 560001',
    lat: 12.9757,
    lon: 77.6011,
  },
];

// 10 Products matching Database Seed
const PRODUCTS = [
  { id: 'p1',  sku: 'SKU-MILK-001',  title: 'Nandini Toned Milk',  category: 'Dairy',       price: 30.00,  emoji: '🥛', unit: 'L' },
  { id: 'p2',  sku: 'SKU-MAGGI-002', title: 'Maggi Noodles',       category: 'Instant Food', price: 14.00,  emoji: '🍜', unit: 'pkt' },
  { id: 'p3',  sku: 'SKU-SALT-003',  title: 'Tata Salt',           category: 'Staples',     price: 28.00,  emoji: '🧂', unit: 'kg' },
  { id: 'p4',  sku: 'SKU-PRLG-004',  title: 'Parle-G',             category: 'Biscuits',    price: 65.00,  emoji: '🍪', unit: 'pack' },
  { id: 'p5',  sku: 'SKU-DETL-005',  title: 'Dettol Handwash',     category: 'Hygiene',     price: 85.00,  emoji: '🧼', unit: 'bottle' },
  { id: 'p6',  sku: 'SKU-RICE-006',  title: 'Rice',                category: 'Staples',     price: 320.00, emoji: '🌾', unit: 'kg' },
  { id: 'p7',  sku: 'SKU-CURD-007',  title: 'Curd',                category: 'Dairy',       price: 45.00,  emoji: '🥣', unit: 'cup' },
  { id: 'p8',  sku: 'SKU-BRNJ-008',  title: 'Brinjal',             category: 'Vegetables',  price: 40.00,  emoji: '🍆', unit: 'kg' },
  { id: 'p9',  sku: 'SKU-TMAT-009',  title: 'Tomato',              category: 'Vegetables',  price: 25.00,  emoji: '🍅', unit: 'kg' },
  { id: 'p10', sku: 'SKU-PTAT-010',  title: 'Potato',              category: 'Vegetables',  price: 35.00,  emoji: '🥔', unit: 'kg' },
];

// In-Memory Unique Physical Units (10 per product per store)
const UNIQUE_ITEMS = new Map();
const STORE_TAG = { 'STORE-KOR-01': 'KOR', 'STORE-WF-01': 'WF', 'STORE-MGR-01': 'MGR' };

for (const store of STORES) {
  const tag = STORE_TAG[store.code] || 'BLR';
  for (const prod of PRODUCTS) {
    for (let i = 1; i <= 10; i++) {
      const id = `${prod.id}-${tag}-${String(i).padStart(3, '0')}`;
      const serialNumber = `${prod.title.substring(0, 4).toUpperCase()}-${tag}-${String(i).padStart(3, '0')}`;
      UNIQUE_ITEMS.set(id, {
        id,
        productId: prod.id,
        storeId: store.id,
        storeName: store.name,
        serialNumber,
        status: 'AVAILABLE',
        reservedByUserId: null,
        reservationExpiresAt: null,
      });
    }
  }
}

// Fallback canonical demo item
UNIQUE_ITEMS.set('7c9e6679-7425-40de-944b-e07fc1f90ae7', {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  productId: 'p1',
  storeId: STORES[0].id,
  storeName: 'Koramangala',
  serialNumber: 'MILK-KOR-001',
  status: 'AVAILABLE',
  reservedByUserId: null,
  reservationExpiresAt: null,
});

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  // 1. Static Website Frontend Serving
  if (pathname === '/' || pathname === '/index.html') {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexPath).pipe(res);
    }
  }

  if (pathname.startsWith('/public/') || pathname.endsWith('.js') || pathname.endsWith('.css') || pathname.endsWith('.png')) {
    const safePath = path.join(PUBLIC_DIR, path.basename(pathname));
    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath);
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      return fs.createReadStream(safePath).pipe(res);
    }
  }

  // 2. GET /api/v1/search
  if (pathname === '/api/v1/search' && method === 'GET') {
    const storeParam = (parsedUrl.query.store_id || parsedUrl.query.storeId || 'Koramangala').toLowerCase();
    const query = (parsedUrl.query.q || '').toLowerCase();

    const matchedStore = STORES.find(s => 
      s.name.toLowerCase().includes(storeParam) || s.id.toLowerCase() === storeParam
    ) || STORES[0];

    const hits = PRODUCTS.map((p) => {
      const availableUnits = Array.from(UNIQUE_ITEMS.values()).filter(
        (u) => u.productId === p.id && u.storeId === matchedStore.id && u.status === 'AVAILABLE',
      );

      return {
        productId: p.id,
        title: p.title,
        name: p.title,
        category: p.category,
        price: p.price,
        unit: p.unit,
        emoji: p.emoji,
        storeId: matchedStore.id,
        storeName: matchedStore.name,
        availableCount: availableUnits.length,
        availableItems: availableUnits.map((u) => ({
          uniqueItemId: u.id,
          serialNumber: u.serialNumber,
        })),
      };
    }).filter((hit) => {
      if (!query) return true;
      return hit.title.toLowerCase().includes(query) || hit.category.toLowerCase().includes(query);
    });

    return sendJson(res, 200, {
      total: hits.length,
      page: 1,
      limit: 20,
      hits,
    });
  }

  // Collect Body for POST Requests
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    let json = {};
    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      json = {};
    }

    // 3. POST /api/v1/cart/reserve
    if (pathname === '/api/v1/cart/reserve' && method === 'POST') {
      const targetId = json.uniqueItemId || '7c9e6679-7425-40de-944b-e07fc1f90ae7';
      const item = UNIQUE_ITEMS.get(targetId);

      if (!item || item.status !== 'AVAILABLE') {
        return sendJson(res, 409, {
          statusCode: 409,
          errorCode: 'ITEM_ALREADY_RESERVED',
          message: `Unique physical item '${targetId}' is already reserved or unavailable.`,
          timestamp: new Date().toISOString(),
        });
      }

      item.status = 'RESERVED';
      item.reservedByUserId = json.userId || 'usr_buyer_49102';
      item.reservationExpiresAt = new Date(Date.now() + (json.ttlSeconds || 600) * 1000);

      return sendJson(res, 201, {
        reservationId: 'a81d4fe6-03fa-4a24-9f4a-a459b1588661',
        uniqueItemId: item.id,
        serialNumber: item.serialNumber,
        productId: item.productId,
        storeId: item.storeId,
        status: 'RESERVED',
        reservedAt: new Date().toISOString(),
        expiresAt: item.reservationExpiresAt.toISOString(),
      });
    }

    // 4. POST /api/v1/cart/release
    if (pathname === '/api/v1/cart/release' && method === 'POST') {
      const targetId = json.uniqueItemId;
      const item = UNIQUE_ITEMS.get(targetId);
      if (item && item.status === 'RESERVED') {
        item.status = 'AVAILABLE';
        item.reservedByUserId = null;
        item.reservationExpiresAt = null;
      }
      return sendJson(res, 200, {
        success: true,
        message: 'Item returned to AVAILABLE inventory.',
        uniqueItemId: targetId,
        status: 'AVAILABLE',
      });
    }

    // 5. POST /api/v1/checkout (Concurrency Lock Enforcer)
    if (pathname === '/api/v1/checkout' && method === 'POST') {
      let targetId = json.uniqueItemId || '7c9e6679-7425-40de-944b-e07fc1f90ae7';
      let item = UNIQUE_ITEMS.get(targetId);

      // If targetId not directly found, pick first item matching or create placeholder
      if (!item) {
        // Auto-match an available item or conflict if exhausted
        item = Array.from(UNIQUE_ITEMS.values()).find(u => u.status === 'AVAILABLE');
      }

      // Check strictly: If already SOLD, reject with 409 Conflict immediately!
      if (!item || item.status === 'SOLD') {
        return sendJson(res, 409, {
          statusCode: 409,
          errorCode: 'ITEM_ALREADY_SOLD',
          message: `Item just sold out! Live Kafka sync updated inventory.`,
          timestamp: new Date().toISOString(),
        });
      }

      // Commit lock: Mark SOLD
      item.status = 'SOLD';
      item.soldAt = new Date().toISOString();

      return sendJson(res, 200, {
        orderId: `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        orderNumber: `NC-${Math.floor(10000 + Math.random() * 90000)}`,
        status: 'CONFIRMED',
        uniqueItemId: item.id,
        serialNumber: item.serialNumber,
        storeId: item.storeId,
        storeName: item.storeName,
        totalAmount: json.amount || 30.00,
        currency: json.currency || 'INR',
        stockLocked: true,
        inventorySynced: true,
        timestamp: new Date().toISOString(),
      });
    }

    // 404 Fallback
    return sendJson(res, 404, {
      statusCode: 404,
      error: 'NOT_FOUND',
      message: `Cannot ${method} ${pathname}`,
    });
  });
});

server.listen(PORT, () => {
  console.log(`=================================================================`);
  console.log(`  🛒 NAMMACART RETAIL SERVER IS LIVE & READY FOR TESTING!`);
  console.log(`=================================================================`);
  console.log(`  🌐 Website URL:  http://localhost:${PORT}/`);
  console.log(`  📦 Search API:   http://localhost:${PORT}/api/v1/search`);
  console.log(`  💳 Checkout API: http://localhost:${PORT}/api/v1/checkout`);
  console.log(`  🏪 Mini-Warehouses: Koramangala, Whitefield, MG Road`);
  console.log(`=================================================================`);
});
