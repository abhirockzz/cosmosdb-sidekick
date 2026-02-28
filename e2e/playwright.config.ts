import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "../extension");

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000, // 3 min per test — accounts for LLM response time
  retries: 0,
  workers: 1, // sequential — single sidecar on port 3001
  use: {
    // No default browser config here — Chrome extension requires launchPersistentContext
    // which is set up in the test fixtures
  },
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  reporter: [["list"], ["html", { open: "never" }]],
});

// Re-export for use in fixtures
export { extensionPath };
