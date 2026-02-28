// Demo data seed script for the "ShopCosmos" narrative.
// Creates shopDB with products (10 docs), users (8 docs), and an empty orders container.
// Orders are generated LIVE during the demo via the AI, referencing real users and products.
//
// Usage: npx tsx demo-seed.ts

import { CosmosClient } from "@azure/cosmos";

const EMULATOR_ENDPOINT =
  process.env.COSMOS_EMULATOR_ENDPOINT ?? "http://localhost:8081";
const EMULATOR_KEY =
  "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

const DATABASE = "shopDB";

// --- Products (10 docs) ---
// Wide price range for "cheapest 3" queries. No "status" field — critical for schema mismatch demo.
const PRODUCTS = [
  { id: "prod-001", name: "Wireless Earbuds", category: "electronics", price: 39.99, inStock: true, description: "Bluetooth 5.3, 24h battery life" },
  { id: "prod-002", name: "Mechanical Keyboard", category: "electronics", price: 89.99, inStock: true, description: "Cherry MX Blue switches, RGB backlight" },
  { id: "prod-003", name: "Cast Iron Skillet", category: "kitchen", price: 34.95, inStock: true, description: "12-inch pre-seasoned, oven safe to 500°F" },
  { id: "prod-004", name: "Pour Over Coffee Maker", category: "kitchen", price: 24.99, inStock: false, description: "Borosilicate glass, reusable filter" },
  { id: "prod-005", name: "Hiking Backpack 40L", category: "outdoor", price: 129.99, inStock: true, description: "Waterproof, ventilated back panel" },
  { id: "prod-006", name: "LED Camping Lantern", category: "outdoor", price: 18.50, inStock: true, description: "Rechargeable, 3 brightness modes" },
  { id: "prod-007", name: "TypeScript Handbook", category: "books", price: 5.99, inStock: true, description: "Comprehensive guide, 4th edition" },
  { id: "prod-008", name: "Designing Data-Intensive Apps", category: "books", price: 42.00, inStock: true, description: "Martin Kleppmann, distributed systems" },
  { id: "prod-009", name: "USB-C Hub 7-in-1", category: "electronics", price: 29.99, inStock: false, description: "HDMI, SD card, 3x USB-A, PD charging" },
  { id: "prod-010", name: "Stainless Steel Water Bottle", category: "outdoor", price: 22.95, inStock: true, description: "32oz, vacuum insulated, keeps cold 24h" },
  { id: "prod-011", name: "Noise-Cancelling Headphones", category: "electronics", price: 199.99, inStock: true, description: "ANC, 30h battery, foldable design" },
  { id: "prod-012", name: "French Press Coffee Maker", category: "kitchen", price: 27.50, inStock: true, description: "34oz, double-wall stainless steel" },
];

// --- Users (8 docs) ---
// Realistic customers the AI can reference when generating orders during the demo.
const USERS = [
  { id: "user-001", name: "Alice Johnson", email: "alice@example.com", region: "us-west", memberSince: "2024-03-15" },
  { id: "user-002", name: "Bob Chen", email: "bob@example.com", region: "us-east", memberSince: "2023-11-02" },
  { id: "user-003", name: "Carla Rivera", email: "carla@example.com", region: "eu-west", memberSince: "2025-01-20" },
  { id: "user-004", name: "David Kim", email: "david@example.com", region: "us-west", memberSince: "2024-07-08" },
  { id: "user-005", name: "Emma Müller", email: "emma@example.com", region: "eu-central", memberSince: "2024-09-30" },
  { id: "user-006", name: "Frank Okafor", email: "frank@example.com", region: "us-east", memberSince: "2023-06-14" },
  { id: "user-007", name: "Grace Tanaka", email: "grace@example.com", region: "apac", memberSince: "2025-02-01" },
  { id: "user-008", name: "Hassan Ali", email: "hassan@example.com", region: "eu-west", memberSince: "2024-12-10" },
];

async function seed(): Promise<void> {
  const client = new CosmosClient({
    endpoint: EMULATOR_ENDPOINT,
    key: EMULATOR_KEY,
  });

  const { database } = await client.databases.createIfNotExists({ id: DATABASE });

  // Products container
  const { container: products } = await database.containers.createIfNotExists({
    id: "products",
    partitionKey: { paths: ["/category"], kind: "Hash" },
  });
  for (const doc of PRODUCTS) {
    await products.items.upsert(doc);
  }

  // Users container
  const { container: users } = await database.containers.createIfNotExists({
    id: "users",
    partitionKey: { paths: ["/region"], kind: "Hash" },
  });
  for (const doc of USERS) {
    await users.items.upsert(doc);
  }

  // Orders container — empty, populated live during demo
  await database.containers.createIfNotExists({
    id: "orders",
    partitionKey: { paths: ["/customerId"], kind: "Hash" },
  });

  console.log(`✅ Seeded ${DATABASE}:`);
  console.log(`   products: ${PRODUCTS.length} documents`);
  console.log(`   users:    ${USERS.length} documents`);
  console.log(`   orders:   0 documents (generate during demo)`);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
