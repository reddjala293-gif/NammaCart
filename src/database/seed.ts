import { DataSource } from 'typeorm';
import { Client } from '@opensearch-project/opensearch';
import * as dotenv from 'dotenv';
import { Store } from '../modules/stores/entities/store.entity';
import { Product } from '../modules/products/entities/product.entity';
import { UniqueItem } from '../modules/inventory/entities/unique-item.entity';
import { ItemStatus } from '../common/enums/item-status.enum';

dotenv.config();

export async function runSeed(dataSource: DataSource, openSearchClient?: Client) {
  console.log('--- Commencing Database & OpenSearch Seeding ---');

  const storeRepo = dataSource.getRepository(Store);
  const productRepo = dataSource.getRepository(Product);
  const itemRepo = dataSource.getRepository(UniqueItem);

  // 1. Seed Stores (Mini-Warehouses)
  const storesData = [
    {
      name: 'Downtown Manhattan Flagship',
      code: 'STORE-NYC-01',
      address: '568 Broadway, New York, NY 10012',
      latitude: 40.7245,
      longitude: -73.9972,
    },
    {
      name: 'Brooklyn Arts & Tech Depot',
      code: 'STORE-BKLN-02',
      address: '25 Washington St, Brooklyn, NY 11201',
      latitude: 40.7032,
      longitude: -73.9897,
    },
    {
      name: 'Chicago Magnificent Mile Store',
      code: 'STORE-CHI-01',
      address: '600 N Michigan Ave, Chicago, IL 60611',
      latitude: 41.8929,
      longitude: -87.6243,
    },
    {
      name: 'San Francisco Market St Hub',
      code: 'STORE-SF-01',
      address: '845 Market St, San Francisco, CA 94103',
      latitude: 37.7844,
      longitude: -122.4064,
    },
  ];

  const stores: Store[] = [];
  for (const s of storesData) {
    let existing = await storeRepo.findOne({ where: { code: s.code } });
    if (!existing) {
      existing = await storeRepo.save(storeRepo.create(s));
      console.log(`Created Store: ${existing.name} (${existing.code})`);
    }
    stores.push(existing);
  }

  // 2. Seed Products
  const productsData = [
    {
      sku: 'SKU-RUN-001',
      title: 'Ultralight Trail Runner Pro',
      description: 'Gore-Tex waterproof running shoe engineered with carbon fiber torsion plate for technical mountain terrain.',
      category: 'Footwear',
      price: 189.99,
    },
    {
      sku: 'SKU-JKT-002',
      title: 'Apex Waterproof Hardshell Alpine Jacket',
      description: '3-layer ripstop seam-sealed storm jacket built for blizzard mountaineering and high-altitude winds.',
      category: 'Outerwear',
      price: 299.00,
    },
    {
      sku: 'SKU-WTC-003',
      title: 'Chronos Sub-Maritime Automatic Watch',
      description: 'Hand-assembled mechanical diver watch rated for 300m with sapphire crystal and ceramic bezel.',
      category: 'Accessories',
      price: 850.00,
    },
    {
      sku: 'SKU-BIK-004',
      title: 'Aero-Dynamic Carbon Road Bike Frame X1',
      description: 'UCI-certified monocoque carbon fiber road frame with integrated cockpit aerodynamics.',
      category: 'Cycling',
      price: 1450.00,
    },
  ];

  const products: Product[] = [];
  for (const p of productsData) {
    let existing = await productRepo.findOne({ where: { sku: p.sku } });
    if (!existing) {
      existing = await productRepo.save(productRepo.create(p));
      console.log(`Created Product: ${existing.title} (${existing.sku})`);
    }
    products.push(existing);
  }

  // 3. Seed Unique Physical Items (Individual Serialized Units)
  console.log('Seeding serialized physical units (UniqueItem)...');
  const seededItems: UniqueItem[] = [];

  for (const store of stores) {
    for (const product of products) {
      // Create 3 available physical items, 1 reserved item per store/product
      const storePrefix = store.code.replace('STORE-', '');
      const productPrefix = product.sku.replace('SKU-', '');

      for (let unit = 1; unit <= 3; unit++) {
        const serialNumber = `SN-${storePrefix}-${productPrefix}-00${unit}`;
        let item = await itemRepo.findOne({ where: { serialNumber } });
        if (!item) {
          item = await itemRepo.save(
            itemRepo.create({
              productId: product.id,
              storeId: store.id,
              serialNumber,
              status: ItemStatus.AVAILABLE,
            }),
          );
        }
        seededItems.push(item);
      }

      // One reserved unit with TTL
      const reservedSerial = `SN-${storePrefix}-${productPrefix}-RES-99`;
      let resItem = await itemRepo.findOne({ where: { serialNumber: reservedSerial } });
      if (!resItem) {
        resItem = await itemRepo.save(
          itemRepo.create({
            productId: product.id,
            storeId: store.id,
            serialNumber: reservedSerial,
            status: ItemStatus.RESERVED,
            reservedByUserId: 'shopper_preview_user',
            reservedAt: new Date(),
            reservationExpiresAt: new Date(Date.now() + 600 * 1000),
          }),
        );
      }
      seededItems.push(resItem);
    }
  }

  console.log(`Successfully seeded ${seededItems.length} individual physical units.`);

  // 4. Index Aggregated Availability into OpenSearch (if client provided)
  if (openSearchClient) {
    const indexName = process.env.AIVEN_OPENSEARCH_INDEX || 'store_inventory';
    console.log(`Syncing seed catalog into OpenSearch index '${indexName}'...`);

    for (const store of stores) {
      for (const product of products) {
        const storeUnits = seededItems.filter(
          (i) => i.storeId === store.id && i.productId === product.id && i.status === ItemStatus.AVAILABLE,
        );

        const docId = `${product.id}_${store.id}`;
        await openSearchClient.index({
          index: indexName,
          id: docId,
          body: {
            id: docId,
            productId: product.id,
            storeId: store.id,
            title: product.title,
            description: product.description,
            category: product.category,
            price: Number(product.price),
            storeName: store.name,
            storeLocation: {
              lat: Number(store.latitude),
              lon: Number(store.longitude),
            },
            availableCount: storeUnits.length,
            availableItems: storeUnits.map((u) => ({
              uniqueItemId: u.id,
              serialNumber: u.serialNumber,
            })),
            updatedAt: new Date().toISOString(),
          },
        });
      }
    }
    console.log(`OpenSearch catalog index populated.`);
  }

  console.log('--- Seeding Completed Successfully ---');
}
