// E2E: Context bar — setting context via chrome.storage, display states, context in chat.

import { test, expect, openSidePanel } from "./fixtures.js";

test.describe("Context bar", () => {
  test("shows database and container when both are set", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Inject context via chrome.storage.local (same mechanism as content script → service worker)
    await page.evaluate(() => {
      chrome.storage.local.set({
        explorerContext: {
          endpoint: "http://localhost:8081",
          database: "e2etest",
          container: "products",
          contextResolved: true,
        },
      });
    });

    // Context bar should appear with database › container format
    const contextBar = page.locator("#context-bar");
    await expect(contextBar).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#context-text")).toContainText("e2etest");
    await expect(page.locator("#context-text")).toContainText("products");
    await expect(page.locator("#context-text")).toContainText("›");
  });

  test("shows only database when container is not set", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    await page.evaluate(() => {
      chrome.storage.local.set({
        explorerContext: {
          endpoint: "http://localhost:8081",
          database: "e2etest",
          contextResolved: true,
        },
      });
    });

    const contextText = page.locator("#context-text");
    await expect(contextText).toContainText("e2etest", { timeout: 5_000 });
    // Should NOT contain the separator since there's no container
    const text = await contextText.textContent();
    expect(text).not.toContain("›");
  });

  test("shows only endpoint when database and container are absent", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    await page.evaluate(() => {
      chrome.storage.local.set({
        explorerContext: {
          endpoint: "http://localhost:8081",
          contextResolved: true,
        },
      });
    });

    const contextText = page.locator("#context-text");
    await expect(contextText).toContainText("localhost:8081", {
      timeout: 5_000,
    });
    // Should use the 🔗 prefix, not 📂
    const text = await contextText.textContent();
    expect(text).toContain("🔗");
    expect(text).not.toContain("📂");
  });

  test("hides when context is cleared", async ({ context, extensionId }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // First set context so it becomes visible
    await page.evaluate(() => {
      chrome.storage.local.set({
        explorerContext: {
          database: "e2etest",
          container: "products",
        },
      });
    });
    await expect(page.locator("#context-bar")).toBeVisible({ timeout: 5_000 });

    // Now clear it
    await page.evaluate(() => {
      chrome.storage.local.remove("explorerContext");
    });

    await expect(page.locator("#context-bar")).toBeHidden({ timeout: 5_000 });
  });

  test("updates when context changes to a different container", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Set initial context
    await page.evaluate(() => {
      chrome.storage.local.set({
        explorerContext: {
          database: "e2etest",
          container: "products",
        },
      });
    });
    await expect(page.locator("#context-text")).toContainText("products", {
      timeout: 5_000,
    });

    // Switch to a different container
    await page.evaluate(() => {
      chrome.storage.local.set({
        explorerContext: {
          database: "e2etest",
          container: "orders",
        },
      });
    });
    await expect(page.locator("#context-text")).toContainText("orders", {
      timeout: 5_000,
    });
    // Old container should no longer be shown
    const text = await page.locator("#context-text").textContent();
    expect(text).not.toContain("products");
  });

  test("context is sent to sidecar with chat message", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Wait for welcome message
    await expect(page.locator(".message.assistant")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Set context to products container
    await page.evaluate(() => {
      chrome.storage.local.set({
        explorerContext: {
          endpoint: "http://localhost:8081",
          database: "e2etest",
          container: "products",
          contextResolved: true,
        },
      });
    });
    await expect(page.locator("#context-bar")).toBeVisible({ timeout: 5_000 });

    // Send a message — the context should be sent along and influence the response
    const input = page.locator("#prompt-input");
    await input.fill(
      "What items are in the currently selected container? List their names."
    );
    await page.locator("#send-btn").click();

    // The response should contain sentinel data from the products container
    // because context told the LLM which container to look at
    const response = page.locator(".message.assistant", {
      hasText: "sentinel",
    });
    await expect(response.first()).toBeVisible({ timeout: 90_000 });
  });
});
