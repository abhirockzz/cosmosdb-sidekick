import { CosmosClient } from "@azure/cosmos";

// Well-known Cosmos DB emulator credentials (public, not a secret)
// Default to HTTP — the newer emulator (Docker/Linux) uses HTTP by default.
const EMULATOR_ENDPOINT = process.env.COSMOS_EMULATOR_ENDPOINT || "http://localhost:8081";
const EMULATOR_KEY =
  "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

export const cosmosClient = new CosmosClient({
  endpoint: EMULATOR_ENDPOINT,
  key: EMULATOR_KEY,
});

export async function listDatabases(): Promise<string[]> {
  const { resources } = await cosmosClient.databases.readAll().fetchAll();
  return resources.map((db) => db.id);
}

export async function listContainers(
  databaseId: string
): Promise<{ id: string; partitionKeyPath: string }[]> {
  const { resources } = await cosmosClient
    .database(databaseId)
    .containers.readAll()
    .fetchAll();

  return resources.map((c) => ({
    id: c.id,
    partitionKeyPath: Array.isArray(c.partitionKey?.paths)
      ? c.partitionKey.paths.join(", ")
      : "unknown",
  }));
}

export async function sampleDocuments(
  databaseId: string,
  containerId: string,
  count: number = 5
): Promise<{ documents: unknown[]; count: number }> {
  const container = cosmosClient
    .database(databaseId)
    .container(containerId);

  const querySpec = {
    query: `SELECT TOP ${Math.min(count, 20)} * FROM c`,
  };

  const { resources } = await container.items.query(querySpec).fetchAll();
  return { documents: resources, count: resources.length };
}

/**
 * Validates that a query is read-only (SELECT only).
 * Rejects INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, etc.
 */
function validateReadOnly(query: string): void {
  const normalized = query.trim().toUpperCase();
  const forbidden = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "CREATE",
    "ALTER",
    "UPSERT",
    "REPLACE",
    "EXEC",
    "EXECUTE",
  ];
  for (const keyword of forbidden) {
    if (normalized.startsWith(keyword)) {
      throw new Error(
        `Write operations are not allowed. Only SELECT queries are permitted. Got: ${keyword}`
      );
    }
  }
  if (!normalized.startsWith("SELECT")) {
    throw new Error(
      `Only SELECT queries are permitted. Query must start with SELECT.`
    );
  }
}

export async function runQuery(
  databaseId: string,
  containerId: string,
  query: string
): Promise<{ results: unknown[]; count: number }> {
  validateReadOnly(query);

  const container = cosmosClient
    .database(databaseId)
    .container(containerId);

  const response = await container.items.query(query).fetchAll();

  return {
    results: response.resources,
    count: response.resources.length,
  };
}

/** Quick connectivity check */
export async function checkEmulatorConnection(): Promise<boolean> {
  try {
    await cosmosClient.getDatabaseAccount();
    return true;
  } catch {
    return false;
  }
}

/**
 * Upsert one or more items into a container.
 * Each item must have an `id` field. Uses individual upsert calls
 * so partial failures don't break the batch.
 * 
 * Returns partition key path and warnings if items are missing the
 * partition key field — this helps the LLM detect wrong-container writes.
 */
export async function upsertItems(
  databaseId: string,
  containerId: string,
  items: Record<string, unknown>[]
): Promise<{
  succeeded: number;
  failed: number;
  errors: string[];
  warnings: string[];
  partitionKeyPath: string | null;
}> {
  const container = cosmosClient.database(databaseId).container(containerId);
  let succeeded = 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  let partitionKeyPath: string | null = null;

  // Fetch partition key path for validation — gracefully skip if it fails
  try {
    const { resource } = await container.read();
    if (resource?.partitionKey?.paths?.length) {
      partitionKeyPath = resource.partitionKey.paths[0];
    }
  } catch {
    // Can't read container metadata — skip validation, let upsert proceed
  }

  // Check each item for the partition key field
  if (partitionKeyPath) {
    // Strip leading "/" to get the field name (e.g. "/customerId" → "customerId")
    const pkField = partitionKeyPath.replace(/^\//, "");
    for (const item of items) {
      if (!(pkField in item)) {
        warnings.push(
          `Item ${item.id ?? "(no id)"} is missing partition key field '${pkField}' (path: ${partitionKeyPath}). Data may be orphaned or written to the wrong container.`
        );
      }
    }
  }

  for (const item of items) {
    try {
      await container.items.upsert(item);
      succeeded++;
    } catch (err: any) {
      errors.push(`Item ${item.id ?? "(no id)"}: ${err.message}`);
    }
  }

  return { succeeded, failed: errors.length, errors, warnings, partitionKeyPath };
}
