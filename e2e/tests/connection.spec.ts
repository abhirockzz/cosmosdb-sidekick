// E2E: Side panel loads, connects to sidecar, shows correct UI state.

import { test, expect, openSidePanel } from "./fixtures.js";

test.describe("Connection", () => {
  test("side panel loads and shows connected status", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);

    // Wait for the status indicator to show "Connected"
    const status = page.locator("#status");
    await expect(status).toHaveText("Connected", { timeout: 30_000 });
    await expect(status).toHaveClass(/status-connected/);
  });

  test("welcome message is displayed", async ({ context, extensionId }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Welcome message should be present
    const messages = page.locator(".message.assistant");
    await expect(messages).toHaveCount(1);
    const welcomeText = await messages.first().textContent();
    expect(welcomeText).toContain("write the query");
  });

  test("input area is visible and enabled", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    await expect(page.locator("#input-area")).toBeVisible();
    await expect(page.locator("#prompt-input")).toBeEnabled();
    await expect(page.locator("#send-btn")).toBeVisible();
  });

  test("context bar is hidden when no context is set", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    await expect(page.locator("#context-bar")).toBeHidden();
  });

  test("startup screen is hidden when sidecar is running", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    await expect(page.locator("#startup-screen")).toBeHidden();
  });
});
