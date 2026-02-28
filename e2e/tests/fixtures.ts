// Shared Playwright fixtures for Chrome extension E2E tests.

import { test as base, type BrowserContext, chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../../extension");
const EXTENSION_ID = "dhiofhfpjlopikafhgikndocaghgdkgj";

// Custom fixture that launches Chrome with the extension loaded
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--disable-default-apps",
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    // Wait for the service worker to register
    let swURL: string | undefined;
    for (const sw of context.serviceWorkers()) {
      if (sw.url().includes(EXTENSION_ID)) {
        swURL = sw.url();
        break;
      }
    }
    if (!swURL) {
      const sw = await context.waitForEvent("serviceworker", {
        predicate: (w) => w.url().includes("chrome-extension://"),
        timeout: 10_000,
      });
      swURL = sw.url();
    }
    const id = swURL!.split("/")[2];
    await use(id);
  },
});

export { expect } from "@playwright/test";
export { EXTENSION_ID };

/** Navigate to the side panel page in a new tab */
export async function openSidePanel(
  context: BrowserContext,
  extensionId: string
) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
}
