// E2E: Chat flow — send message, see streamed response with known data.

import { test, expect, openSidePanel } from "./fixtures.js";

test.describe("Chat", () => {
  test("send message and receive response with sentinel data", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Wait for welcome message to confirm UI is ready
    await expect(page.locator(".message.assistant")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Type a query about the seeded test data
    const input = page.locator("#prompt-input");
    await input.fill(
      'List all items in the "products" container in the "e2etest" database. Show them in a table.'
    );

    // Send the message
    await page.locator("#send-btn").click();

    // User message should appear
    const userMessages = page.locator(".message.user");
    await expect(userMessages.last()).toContainText("products");

    // Wait for assistant response — a new .message.assistant div appears when streaming starts.
    // Use a longer timeout since this is a real LLM call.
    const assistantMessages = page.locator(".message.assistant");
    await expect(assistantMessages).toHaveCount(2, { timeout: 90_000 });

    // Wait for the response to contain our sentinel data (streaming may still be in progress)
    const lastResponse = assistantMessages.last();
    await expect(lastResponse).toContainText("sentinel-abc123", {
      timeout: 90_000,
    });
    await expect(lastResponse).toContainText("sentinel-xyz789");
    await expect(lastResponse).toContainText("sentinel-def456");
  });

  test("Shift+Enter creates newline instead of sending", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    const input = page.locator("#prompt-input");
    await input.fill("line one");
    await input.press("Shift+Enter");
    await input.type("line two");

    // Message should NOT have been sent — still in the input
    const value = await input.inputValue();
    expect(value).toContain("line one");
    expect(value).toContain("line two");

    // No new user messages should have appeared (only welcome assistant message)
    const userMessages = page.locator(".message.user");
    await expect(userMessages).toHaveCount(0);
  });

  test("input is cleared after sending", async ({ context, extensionId }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    const input = page.locator("#prompt-input");
    await input.fill("What databases exist?");
    await page.locator("#send-btn").click();

    // Input should be cleared immediately after sending
    await expect(input).toHaveValue("");

    // User message should appear in the chat
    const userMessages = page.locator(".message.user");
    await expect(userMessages.last()).toContainText("What databases exist?");

    // Wait for an assistant response that mentions our test database
    const response = page.locator(".message.assistant", {
      hasText: "e2etest",
    });
    await expect(response.first()).toBeVisible({ timeout: 60_000 });
  });
});
