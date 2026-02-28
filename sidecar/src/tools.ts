import { z } from "zod";

// Tool definitions for the Copilot SDK.
// Each tool has a name, description, Zod schema for parameters, and a handler.

import {
  listDatabases,
  listContainers,
  sampleDocuments,
  runQuery,
  upsertItems,
} from "./cosmos.js";

/**
 * Returns tool definitions compatible with the Copilot SDK's Tool interface.
 * We define them as plain objects so they work with both defineTool and raw registration.
 */
export function getTools() {
  return [
    {
      name: "list_databases",
      description:
        "List all databases in the Cosmos DB emulator. Returns an array of database names.",
      parameters: {
        type: "object" as const,
        properties: {},
        required: [] as string[],
      },
      handler: async () => {
        const databases = await listDatabases();
        return { databases };
      },
    },
    {
      name: "list_containers",
      description:
        "List all containers in a specific database. Returns container names and their partition key paths.",
      parameters: {
        type: "object" as const,
        properties: {
          database: {
            type: "string",
            description: "The database name to list containers from",
          },
        },
        required: ["database"],
      },
      handler: async (args: { database: string }) => {
        const containers = await listContainers(args.database);
        return { containers };
      },
    },
    {
      name: "sample_documents",
      description:
        "Fetch a few sample documents from a container to understand its schema and data shape. Returns up to 5 documents by default.",
      parameters: {
        type: "object" as const,
        properties: {
          database: {
            type: "string",
            description: "The database name",
          },
          container: {
            type: "string",
            description: "The container name",
          },
          count: {
            type: "number",
            description:
              "Number of sample documents to fetch (default 5, max 20)",
          },
        },
        required: ["database", "container"],
      },
      handler: async (args: {
        database: string;
        container: string;
        count?: number;
      }) => {
        const result = await sampleDocuments(
          args.database,
          args.container,
          args.count ?? 5
        );
        return result;
      },
    },
    {
      name: "run_query",
      description:
        "Execute a read-only SQL query against a Cosmos DB container. Only SELECT queries are allowed.",
      parameters: {
        type: "object" as const,
        properties: {
          database: {
            type: "string",
            description: "The database name",
          },
          container: {
            type: "string",
            description: "The container name",
          },
          query: {
            type: "string",
            description:
              "The SQL query to execute. Must be a SELECT query. Example: SELECT c.name, c.email FROM c WHERE c.status = 'active'",
          },
        },
        required: ["database", "container", "query"],
      },
      handler: async (args: {
        database: string;
        container: string;
        query: string;
      }) => {
        const result = await runQuery(args.database, args.container, args.query);
        return result;
      },
    },
    {
      name: "upsert_items",
      description:
        "Insert or update one or more documents in a Cosmos DB container. Each item must have an 'id' field. If a document with the same id already exists, it will be replaced. Works for 1 or 100 items.",
      parameters: {
        type: "object" as const,
        properties: {
          database: {
            type: "string",
            description: "The database name",
          },
          container: {
            type: "string",
            description: "The container name",
          },
          items: {
            type: "array",
            description:
              "Array of JSON documents to upsert. Each must have an 'id' field.",
            items: {
              type: "object",
            },
          },
        },
        required: ["database", "container", "items"],
      },
      handler: async (args: {
        database: string;
        container: string;
        items: Record<string, unknown>[];
      }) => {
        const result = await upsertItems(
          args.database,
          args.container,
          args.items
        );
        return result;
      },
    },
  ];
}
