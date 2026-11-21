import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const stores = ['Koramangala', 'Whitefield', 'MG Road'];
const products = ['Nandini Toned Milk', 'Maggi Noodles', 'Tata Salt', 'Parle-G', 'Dettol Handwash', 'Rice', 'Curd', 'Brinjal', 'Tomato', 'Potato'];

async function main() {
  console.log('🧹 Clearing data...');
  await prisma.uniqueItem.deleteMany();
  await prisma.product.deleteMany();
  await prisma.store.deleteMany();
  console.log('🏪 Creating stores...');
  const storeRecords = await Promise.all(stores.map(name => prisma.store.create({ data: { name } })));
  console.log('📦 Creating products...');
  let count = 0;
  for (const productName of products) {
    const product = await prisma.product.create({ data: { name: productName, description: `Fresh ${productName}` } });
    for (const store of storeRecords) {
      for (let i = 1; i <= 10; i++) {
        const prefix = productName.substring(0, 4).toUpperCase();
        const serial = `${prefix}-${store.name.substring(0, 3).toUpperCase()}-${String(i).padStart(3, '0')}`;
        await prisma.uniqueItem.create({ data: { productId: product.id, storeId: store.id, serialNumber: serial, status: 'AVAILABLE' } });
        count++;
      }
    }
  }
  console.log(`✅ Seeded ${stores.length} stores, ${products.length} products, and ${count} unique items.`);
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
