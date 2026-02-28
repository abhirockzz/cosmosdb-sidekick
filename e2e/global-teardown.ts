// Global teardown: stop sidecar process and emulator container.

import type { ChildProcess } from "child_process";
import type { StartedTestContainer } from "testcontainers";

export default async function globalTeardown() {
  // Kill sidecar
  const sidecar = (globalThis as any)
    .__E2E_SIDECAR_PROCESS__ as ChildProcess | undefined;
  if (sidecar && !sidecar.killed) {
    console.log("🛑 Stopping sidecar...");
    sidecar.kill("SIGTERM");
    // Give it a moment to exit cleanly
    await new Promise((r) => setTimeout(r, 1000));
    if (!sidecar.killed) {
      sidecar.kill("SIGKILL");
    }
  }

  // Stop emulator container
  const container = (globalThis as any)
    .__E2E_EMULATOR_CONTAINER__ as StartedTestContainer | undefined;
  if (container) {
    console.log("🐳 Stopping emulator container...");
    await container.stop();
  }

  console.log("✅ Teardown complete");
}
