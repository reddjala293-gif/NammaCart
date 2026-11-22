# NammaCart: Phygital Shopping Platform

A real-time, zero-overselling e-commerce backend where every physical shop acts as a mini-warehouse. Built for Build Bengaluru 2.0.

##Hackathon Highlights
- **Zero Overselling Guarantee:** Uses PostgreSQL `SELECT ... FOR UPDATE` (pessimistic locking) to ensure a physical item is never sold twice, even under massive concurrent load.
- **Real-Time Inventory Sync:** Checkout events are streamed via **Aiven Kafka** to update **Aiven OpenSearch** instantly, ensuring smart search only shows truly available items.
- **Phygital Architecture:** Bridges the gap between online search and physical store inventory.

##Tech Stack
- **Runtime:** Node.js / TypeScript
- **Database:** Aiven PostgreSQL (with Prisma ORM)
- **Event Streaming:** Aiven Kafka (SASL_SSL)
- **Search Engine:** Aiven OpenSearch (HTTPS)

##How to Run Locally
1. Clone the repository: `git clone https://github.com/reddjala293-gif/nammacart-phygital.git`
2. Install dependencies: `npm install`
3. Create a `.env` file with your Aiven credentials (see `.env.example` if provided).
4. Place your Aiven `ca.pem` in the `./certs/` directory.
5. Seed the database: `npx tsx src/scripts/seed.ts`
6. Start the server: `npm run start:dev`
7. Open `http://localhost:3000` to view the frontend.

##Testing Concurrency
Run the end-to-end test to see the "never sell twice" lock in action:
```bash
npx tsx src/scripts/e2e-test.ts
```
