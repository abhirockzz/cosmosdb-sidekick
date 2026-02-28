// Seeds known test data into the Cosmos DB emulator for E2E assertions.

import { CosmosClient } from "@azure/cosmos";

const EMULATOR_KEY =
  "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

export const TEST_DATABASE = "e2etest";
export const TEST_CONTAINER = "products";
export const PARTITION_KEY = "/category";

export const TEST_DOCUMENTS = [
  {
    id: "sentinel-001",
    name: "sentinel-abc123",
    category: "electronics",
    price: 29.99,
    inStock: true,
  },
  {
    id: "sentinel-002",
    name: "sentinel-xyz789",
    category: "electronics",
    price: 49.99,
    inStock: false,
  },
  {
    id: "sentinel-003",
    name: "sentinel-def456",
    category: "books",
    price: 12.50,
    inStock: true,
  },
];

// Orders container — has a "status" field that products does NOT have
export const ORDERS_CONTAINER = "orders";
export const ORDERS_PARTITION_KEY = "/customerId";

// Second database for cross-database context tests
export const ANALYTICS_DATABASE = "analyticsDB";
export const EVENTS_CONTAINER = "events";
export const EVENTS_PARTITION_KEY = "/eventType";

export const EVENT_DOCUMENTS = [
  {
    id: "evt-001",
    eventType: "pageview",
    url: "/home",
    timestamp: "2026-02-27T10:00:00Z",
  },
  {
    id: "evt-002",
    eventType: "pageview",
    url: "/products",
    timestamp: "2026-02-27T11:00:00Z",
  },
  {
    id: "evt-003",
    eventType: "click",
    url: "/checkout",
    timestamp: "2026-02-27T12:00:00Z",
  },
  {
    id: "evt-004",
    eventType: "pageview",
    url: "/about",
    timestamp: "2026-02-28T09:00:00Z",
  },
  {
    id: "evt-005",
    eventType: "click",
    url: "/signup",
    timestamp: "2026-02-28T10:00:00Z",
  },
];

// Reviews container — same "category" field name as products, but different semantics.
// In products, category = "electronics" | "books". In reviews, category = "complaint" | "praise" | "question".
// This tests whether the LLM notices the semantic difference when switching containers.
export const REVIEWS_CONTAINER = "reviews";
export const REVIEWS_PARTITION_KEY = "/category";

export const REVIEW_DOCUMENTS = [
  {
    id: "review-001",
    title: "Broken on arrival",
    category: "complaint",
    rating: 1,
    productId: "sentinel-001",
  },
  {
    id: "review-002",
    title: "Excellent quality",
    category: "praise",
    rating: 5,
    productId: "sentinel-002",
  },
  {
    id: "review-003",
    title: "Does it come in blue?",
    category: "question",
    rating: 3,
    productId: "sentinel-001",
  },
  {
    id: "review-004",
    title: "Stopped working after a week",
    category: "complaint",
    rating: 2,
    productId: "sentinel-003",
  },
  {
    id: "review-005",
    title: "Best purchase ever",
    category: "praise",
    rating: 5,
    productId: "sentinel-001",
  },
];

export const ORDER_DOCUMENTS = [
  {
    id: "order-001",
    customerId: "cust-100",
    total: 59.99,
    status: "pending",
  },
  {
    id: "order-002",
    customerId: "cust-100",
    total: 120.0,
    status: "shipped",
  },
  {
    id: "order-003",
    customerId: "cust-200",
    total: 35.5,
    status: "pending",
  },
  {
    id: "order-004",
    customerId: "cust-300",
    total: 89.99,
    status: "delivered",
  },
];

export async function seedTestData(emulatorEndpoint: string): Promise<void> {
  const client = new CosmosClient({
    endpoint: emulatorEndpoint,
    key: EMULATOR_KEY,
  });

  // Create database
  const { database } = await client.databases.createIfNotExists({
    id: TEST_DATABASE,
  });

  // Create container with partition key
  const { container } = await database.containers.createIfNotExists({
    id: TEST_CONTAINER,
    partitionKey: { paths: [PARTITION_KEY], kind: "Hash" },
  });

  // Upsert test documents
  for (const doc of TEST_DOCUMENTS) {
    await container.items.upsert(doc);
  }

  // Create orders container (different schema — has "status" field)
  const { container: ordersContainer } =
    await database.containers.createIfNotExists({
      id: ORDERS_CONTAINER,
      partitionKey: { paths: [ORDERS_PARTITION_KEY], kind: "Hash" },
    });

  for (const doc of ORDER_DOCUMENTS) {
    await ordersContainer.items.upsert(doc);
  }

  // Create reviews container (same "category" field name as products, different values)
  const { container: reviewsContainer } =
    await database.containers.createIfNotExists({
      id: REVIEWS_CONTAINER,
      partitionKey: { paths: [REVIEWS_PARTITION_KEY], kind: "Hash" },
    });

  for (const doc of REVIEW_DOCUMENTS) {
    await reviewsContainer.items.upsert(doc);
  }

  // Create analytics database and events container (different database entirely)
  const { database: analyticsDb } = await client.databases.createIfNotExists({
    id: ANALYTICS_DATABASE,
  });
  const { container: eventsContainer } =
    await analyticsDb.containers.createIfNotExists({
      id: EVENTS_CONTAINER,
      partitionKey: { paths: [EVENTS_PARTITION_KEY], kind: "Hash" },
    });

  for (const doc of EVENT_DOCUMENTS) {
    await eventsContainer.items.upsert(doc);
  }

  console.log(
    `✅ Seeded: ${TEST_DATABASE}/${TEST_CONTAINER} (${TEST_DOCUMENTS.length}), ${TEST_DATABASE}/${ORDERS_CONTAINER} (${ORDER_DOCUMENTS.length}), ${TEST_DATABASE}/${REVIEWS_CONTAINER} (${REVIEW_DOCUMENTS.length}), ${ANALYTICS_DATABASE}/${EVENTS_CONTAINER} (${EVENT_DOCUMENTS.length})`
  );
}
