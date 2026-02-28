// E2E: UI details — textarea auto-resize, message formatting, thinking indicator.

import { test, expect, openSidePanel } from "./fixtures.js";

test.describe("UI details", () => {
  test("textarea grows when typing multiple lines", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    const input = page.locator("#prompt-input");

    // Get initial height
    const initialHeight = await input.evaluate(
      (el) => (el as HTMLTextAreaElement).offsetHeight
    );

    // Type several lines using Shift+Enter
    await input.fill("");
    await input.type("line 1");
    await input.press("Shift+Enter");
    await input.type("line 2");
    await input.press("Shift+Enter");
    await input.type("line 3");
    await input.press("Shift+Enter");
    await input.type("line 4");

    // Height should have increased
    const expandedHeight = await input.evaluate(
      (el) => (el as HTMLTextAreaElement).offsetHeight
    );
    expect(expandedHeight).toBeGreaterThan(initialHeight);
  });

  test("textarea does not exceed max height", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    const input = page.locator("#prompt-input");

    // Type many lines to potentially exceed 120px max
    const manyLines = Array(15).fill("test line").join("\n");
    await input.fill(manyLines);
    // Trigger the input event so the auto-resize fires
    await input.evaluate((el) => el.dispatchEvent(new Event("input")));

    const height = await input.evaluate(
      (el) => (el as HTMLTextAreaElement).offsetHeight
    );
    // Max height is 120px (from sidepanel.js auto-resize logic)
    expect(height).toBeLessThanOrEqual(125); // small tolerance for borders
  });

  test("textarea shrinks back when content is cleared", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    const input = page.locator("#prompt-input");

    // Get initial height
    const initialHeight = await input.evaluate(
      (el) => (el as HTMLTextAreaElement).offsetHeight
    );

    // Expand it
    const manyLines = Array(6).fill("line").join("\n");
    await input.fill(manyLines);
    await input.evaluate((el) => el.dispatchEvent(new Event("input")));

    // Clear it
    await input.fill("");
    await input.evaluate((el) => el.dispatchEvent(new Event("input")));

    const afterClearHeight = await input.evaluate(
      (el) => (el as HTMLTextAreaElement).offsetHeight
    );
    // Should return to approximately initial height
    expect(afterClearHeight).toBeLessThanOrEqual(initialHeight + 5);
  });

  test("thinking indicator appears while streaming", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Wait for welcome
    await expect(page.locator(".message.assistant")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Send a message and check for the thinking indicator
    const input = page.locator("#prompt-input");
    await input.fill("What databases exist?");
    await page.locator("#send-btn").click();

    // Thinking indicator should appear almost immediately
    const thinking = page.locator(".thinking-indicator");
    await expect(thinking).toBeVisible({ timeout: 5_000 });

    // Send button should be disabled during streaming
    await expect(page.locator("#send-btn")).toBeDisabled();

    // Wait for streaming to finish — thinking indicator disappears
    await expect(thinking).toBeHidden({ timeout: 90_000 });

    // Send button should be re-enabled
    await expect(page.locator("#send-btn")).toBeEnabled();
  });

  test("markdown bold renders as strong tags", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Wait for welcome
    await expect(page.locator(".message.assistant")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Ask something that typically produces bold text in the response
    const input = page.locator("#prompt-input");
    await input.fill(
      'List the databases in the emulator. Use **bold** formatting for each database name.'
    );
    await page.locator("#send-btn").click();

    // Wait for the response to contain a <strong> element (rendered from **bold**)
    const strongInResponse = page.locator(
      ".message.assistant:last-child strong"
    );
    await expect(strongInResponse.first()).toBeVisible({ timeout: 90_000 });
  });

  test("user message text is escaped to prevent XSS", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a message with HTML tags — should be escaped, not rendered
    const input = page.locator("#prompt-input");
    await input.fill('<img src=x onerror="alert(1)">');
    await page.locator("#send-btn").click();

    // The user message should show the raw text, not render an img tag
    const userMsg = page.locator(".message.user .message-content");
    await expect(userMsg.last()).toBeVisible({ timeout: 5_000 });

    // Verify no img element was injected
    const imgCount = await userMsg.last().locator("img").count();
    expect(imgCount).toBe(0);

    // The escaped text should be visible — HTML is double-escaped (&amp;lt;)
    // which means the browser renders it as the literal text "<img..."
    const innerHtml = await userMsg.last().innerHTML();
    // Must NOT contain a real img tag
    expect(innerHtml).not.toContain("<img ");
    // Should contain escaped entities (double-escaped since escapeHtml ran on already-escaped text)
    expect(innerHtml).toContain("&amp;") // proves escaping happened
  });
});
