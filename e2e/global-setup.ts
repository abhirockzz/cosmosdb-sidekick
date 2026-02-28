// Global setup: start Cosmos DB emulator (testcontainers) + sidecar process.

import { GenericContainer } from "testcontainers";
import { spawn, type ChildProcess } from "child_process";
import { seedTestData } from "./seed-data.js";
import path from "path";
import { fileURLToPath } from "url";
import net from "net";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SIDECAR_PORT = 3001;
const EMULATOR_CONTAINER_PORT = 8081;

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function waitForEmulator(
  endpoint: string,
  timeoutMs: number = 60_000
): Promise<void> {
  const { CosmosClient } = await import("@azure/cosmos");
  const client = new CosmosClient({
    endpoint,
    key: "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==",
  });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await client.getDatabaseAccount();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(
    `Emulator at ${endpoint} did not become ready within ${timeoutMs}ms`
  );
}

async function waitForSidecar(
  url: string,
  timeoutMs: number = 30_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.emulatorConnected) return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Sidecar at ${url} did not become ready within ${timeoutMs}ms`
  );
}

export default async function globalSetup() {
  // 1. Check required ports are free
  for (const port of [SIDECAR_PORT, EMULATOR_CONTAINER_PORT]) {
    const free = await isPortFree(port);
    if (!free) {
      throw new Error(
        `Port ${port} is in use. Stop any dev sidecar or local emulator before running E2E tests.`
      );
    }
  }

  // 2. Start Cosmos DB vNext emulator via testcontainers
  // Uses fixed port mapping (8081→8081) because the Cosmos DB SDK follows
  // gateway URLs returned by the emulator, which reference its internal port.
  console.log("🐳 Starting Cosmos DB vNext emulator container...");
  const emulatorContainer = await new GenericContainer(
    "mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-preview"
  )
    .withExposedPorts({
      container: EMULATOR_CONTAINER_PORT,
      host: EMULATOR_CONTAINER_PORT,
    })
    .withStartupTimeout(120_000)
    .start();

  const emulatorEndpoint = `http://localhost:${EMULATOR_CONTAINER_PORT}`;
  console.log(`✅ Emulator running at ${emulatorEndpoint}`);

  // Wait for emulator to accept Cosmos DB requests
  console.log("⏳ Waiting for emulator to be ready...");
  await waitForEmulator(emulatorEndpoint);
  console.log("✅ Emulator ready");

  // 3. Seed test data
  await seedTestData(emulatorEndpoint);

  // 4. Start sidecar process
  console.log("🚀 Starting sidecar...");
  const sidecarDir = path.resolve(__dirname, "../sidecar");
  const sidecar = spawn("node", ["dist/server.js"], {
    cwd: sidecarDir,
    env: {
      ...process.env,
      COSMOS_EMULATOR_ENDPOINT: emulatorEndpoint,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  sidecar.stdout?.on("data", (data: Buffer) => {
    process.stdout.write(`[sidecar] ${data}`);
  });
  sidecar.stderr?.on("data", (data: Buffer) => {
    process.stderr.write(`[sidecar] ${data}`);
  });

  // 5. Wait for sidecar to connect to emulator
  const sidecarUrl = `http://127.0.0.1:${SIDECAR_PORT}`;
  await waitForSidecar(sidecarUrl);
  console.log(`✅ Sidecar ready at ${sidecarUrl}`);

  // Store references for teardown
  (globalThis as any).__E2E_EMULATOR_CONTAINER__ = emulatorContainer;
  (globalThis as any).__E2E_SIDECAR_PROCESS__ = sidecar;
  (globalThis as any).__E2E_EMULATOR_ENDPOINT__ = emulatorEndpoint;
}
