// E2E: Session management — new chat, history drawer, session switching.

import { test, expect, openSidePanel } from "./fixtures.js";

test.describe("Sessions", () => {
  test("new chat button clears messages and shows welcome", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a message first so we have something to clear
    const input = page.locator("#prompt-input");
    await input.fill("What databases exist?");
    await page.locator("#send-btn").click();

    // Wait for response
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Click new chat
    await page.locator("#new-chat-btn").click();

    // User messages should be cleared
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Only welcome message should remain
    const assistantMessages = page.locator(".message.assistant");
    await expect(assistantMessages).toHaveCount(1, { timeout: 5_000 });
    const welcomeText = await assistantMessages.first().textContent();
    expect(welcomeText).toContain("write the query");
  });

  test("history drawer opens and shows previous session", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a message to create a session with content
    const input = page.locator("#prompt-input");
    await input.fill("Hello from history test");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Start a new chat so the previous one becomes history
    await page.locator("#new-chat-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Open history drawer
    await page.locator("#history-btn").click();
    const drawer = page.locator("#history-drawer");
    await expect(drawer).toBeVisible();

    // Should have at least one history entry (wait for it to load)
    const historyItems = page.locator(".history-item");
    await expect(historyItems.first()).toBeVisible({ timeout: 10_000 });
    const count = await historyItems.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("clicking history entry loads that session", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a recognizable message
    const input = page.locator("#prompt-input");
    await input.fill("sentinel-session-switch-test");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user").last()).toContainText(
      "sentinel-session-switch-test",
      { timeout: 10_000 }
    );

    // Wait briefly for the message to be registered with the sidecar
    await page.waitForTimeout(2_000);

    // Start a new chat
    await page.locator("#new-chat-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Open history and click the previous session
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();

    // Wait for history items to load, then click the entry with our message
    // (not the active session which is the new empty one)
    await expect(page.locator(".history-item").first()).toBeVisible({
      timeout: 10_000,
    });
    // The active session is marked with .active class — click a non-active one
    const previousSession = page.locator(
      ".history-item:not(.active) .history-item-content"
    );
    await previousSession.first().click();

    // The previous conversation should load — our user message should reappear
    const userMessages = page.locator(".message.user");
    await expect(userMessages.first()).toContainText(
      "sentinel-session-switch-test",
      { timeout: 15_000 }
    );
  });

  test("delete session from history", async ({ context, extensionId }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a message, then start new chat to push it to history
    const input = page.locator("#prompt-input");
    await input.fill("session to delete");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });

    await page.locator("#new-chat-btn").click();

    // Open history and wait for items to load
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();
    await expect(page.locator(".history-item").first()).toBeVisible({
      timeout: 10_000,
    });

    // Get the title of the first item before deleting
    const firstTitle = await page
      .locator(".history-item-title")
      .first()
      .textContent();

    // Delete the first item
    await page.locator(".history-delete-btn").first().click();

    // Wait for the drawer to update — the deleted item's title should no longer
    // be the first item (either it's gone or a different item took its place)
    await page.waitForTimeout(1_000);

    // Verify the item was removed: either fewer items, or the first title changed
    const remainingTitles = await page
      .locator(".history-item-title")
      .allTextContents();
    // The deleted session's title should not be the first entry anymore
    // (it might appear elsewhere if there was a re-creation, but it shouldn't be first)
    if (remainingTitles.length > 0 && firstTitle === "session to delete") {
      expect(remainingTitles[0]).not.toBe("session to delete");
    }
  });

  test("conversation survives panel close and reopen", async ({
    context,
    extensionId,
  }) => {
    // Open panel and send a recognizable message
    const page1 = await openSidePanel(context, extensionId);
    await expect(page1.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    const input = page1.locator("#prompt-input");
    await input.fill("sentinel-persist-across-reopen");
    await page1.locator("#send-btn").click();
    await expect(page1.locator(".message.user")).toContainText(
      "sentinel-persist-across-reopen",
      { timeout: 10_000 }
    );

    // Wait for the message to be registered server-side
    await page1.waitForTimeout(2_000);

    // Close the panel tab
    await page1.close();

    // Re-open the panel in a new tab (simulates user closing & reopening)
    const page2 = await openSidePanel(context, extensionId);
    await expect(page2.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // The previous conversation should be restored automatically
    await expect(page2.locator(".message.user").first()).toContainText(
      "sentinel-persist-across-reopen",
      { timeout: 15_000 }
    );
  });

  test("history entry title matches the first message sent", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a unique first message — this should become the session title
    const input = page.locator("#prompt-input");
    const firstMessage = "sentinel-title-test-first-message";
    await input.fill(firstMessage);
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Send a second message — title should NOT change to this
    await input.fill("this is a follow-up message");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(2, {
      timeout: 10_000,
    });

    // Start a new chat so the previous session appears in history
    await page.locator("#new-chat-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Open history drawer and verify the title is the first message
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();
    await expect(page.locator(".history-item").first()).toBeVisible({
      timeout: 10_000,
    });

    const titles = await page
      .locator(".history-item-title")
      .allTextContents();
    expect(titles).toContain(firstMessage);
  });

  test("deleting the active session starts a new chat", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a message so the current session has content
    const input = page.locator("#prompt-input");
    await input.fill("sentinel-delete-active-session");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toContainText(
      "sentinel-delete-active-session",
      { timeout: 10_000 }
    );

    // Open history — the active session should be listed with .active class
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();
    await expect(page.locator(".history-item.active")).toBeVisible({
      timeout: 10_000,
    });

    // Delete the active session
    await page
      .locator(".history-item.active .history-delete-btn")
      .click();

    // Should auto-start a new chat: user messages cleared, welcome message shown
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });
    const assistantMessages = page.locator(".message.assistant");
    await expect(assistantMessages).toHaveCount(1, { timeout: 10_000 });
    const welcomeText = await assistantMessages.first().textContent();
    expect(welcomeText).toContain("write the query");
  });

  // ── Known Limitations (expected failures) ──────────────────────────
  //
  // The next two tests document known UX edge-case bugs in startNewChat().
  // Both are expected to FAIL against the current codebase.
  //
  // For a demo/sample app these are low-priority:
  //
  // • Test 1 (streaming reset): Moderate likelihood during demos — user sends
  //   a query, decides to start over while the LLM is thinking, and the send
  //   button stays frozen until the old response finishes (~15-30 s).
  //   Fix: reset isStreaming / sendBtn.disabled in startNewChat(), and add an
  //   AbortController to cancel the in-flight fetch.
  //
  // • Test 2 (rapid clicks): Very unlikely in normal use — requires double/
  //   triple-clicking New Chat fast enough for concurrent POST /sessions calls.
  //   Orphan sessions only pollute the history drawer; nothing breaks.
  //   Fix: add a guard flag (e.g. isCreatingSession) in startNewChat().

  test("new chat while streaming resets cleanly", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a message — this starts an async LLM request
    const input = page.locator("#prompt-input");
    await input.fill("What databases exist?");
    await page.locator("#send-btn").click();

    // Wait for user message to confirm send was processed
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Click New Chat while the response is pending/streaming
    await page.locator("#new-chat-btn").click();

    // Should show a clean new-chat state
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(page.locator(".message.assistant")).toHaveCount(1, {
      timeout: 5_000,
    });

    // Send button should be usable immediately — if isStreaming is stuck true
    // from the abandoned request, this click will time out on the disabled button.
    await input.fill("Hello after reset");
    await page.locator("#send-btn").click({ timeout: 5_000 });
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 5_000,
    });

    // Wait to ensure no ghost messages leak from the abandoned stream
    await page.waitForTimeout(5_000);
    await expect(page.locator(".message.user")).toHaveCount(1);
  });

  test("rapid new-chat clicks create only one session", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Create a session with content first
    const input = page.locator("#prompt-input");
    await input.fill("message before rapid clicks");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });
    await page.waitForTimeout(2_000);

    // Click New Chat 3 times in rapid succession via JS (bypasses Playwright's
    // actionability waits to simulate real rapid clicking)
    await page.evaluate(() => {
      const btn = document.getElementById("new-chat-btn")!;
      btn.click();
      btn.click();
      btn.click();
    });

    // Wait for all async operations to settle
    await page.waitForTimeout(5_000);

    // UI should be in a clean new-chat state
    await expect(page.locator(".message.user")).toHaveCount(0);
    await expect(page.locator(".message.assistant")).toHaveCount(1);

    // History should show exactly 2 sessions: the original + 1 new chat.
    // If rapid clicks aren't debounced, this will be 4 (original + 3 new).
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();
    await expect(page.locator(".history-item").first()).toBeVisible({
      timeout: 10_000,
    });

    const sessionCount = await page.locator(".history-item").count();
    expect(sessionCount).toBe(2);
  });

  test("session switch restores both user and assistant messages", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a message and wait for the full assistant response
    const input = page.locator("#prompt-input");
    await input.fill("What databases exist?");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Wait for assistant response to FULLY complete (send button re-enables)
    await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 90_000 });
    await page.waitForTimeout(2_000);

    // Start a new chat to push the conversation into history
    await page.locator("#new-chat-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Switch back via history drawer
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();
    await expect(page.locator(".history-item").first()).toBeVisible({
      timeout: 10_000,
    });

    const previousSession = page.locator(
      ".history-item:not(.active) .history-item-content"
    );
    await previousSession.first().click();

    // BOTH user and assistant messages must be restored
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(page.locator(".message.user").first()).toContainText(
      "What databases exist?"
    );

    // At least one assistant message should be present (the LLM response)
    const assistantCount = await page.locator(".message.assistant").count();
    expect(assistantCount).toBeGreaterThanOrEqual(1);
  });

  test("sending to expired session auto-recovers", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a message to establish a session
    const input = page.locator("#prompt-input");
    await input.fill("Hello");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Wait for response to complete
    await expect(page.locator(".message.assistant")).toHaveCount(2, {
      timeout: 90_000,
    });
    await page.waitForTimeout(2_000);

    // Get the current sessionId from Chrome extension storage
    const sessionId = await page.evaluate(() =>
      new Promise((resolve) =>
        chrome.storage.local.get("sessionId", (r: any) => resolve(r.sessionId))
      )
    );

    // Delete the session server-side to simulate expiry/restart
    await fetch(`http://127.0.0.1:3001/sessions/${sessionId}`, {
      method: "DELETE",
    });
    await page.waitForTimeout(500);

    // Record current assistant message count
    const countBefore = await page.locator(".message.assistant").count();

    // Send another message — the client should detect 404 and auto-recover
    await input.fill("What databases exist after recovery?");
    await page.locator("#send-btn").click();

    // The user message should appear
    await expect(page.locator(".message.user").last()).toContainText(
      "What databases exist after recovery?",
      { timeout: 15_000 }
    );

    // A new assistant response should arrive (proving recovery succeeded)
    await page.waitForFunction(
      (prevCount: number) =>
        document.querySelectorAll(".message.assistant").length > prevCount,
      countBefore,
      { timeout: 90_000 }
    );
  });

  // ── Phase 2: Edge cases ──────────────────────────────────────────────

  test("deleting all sessions results in fresh chat", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Create two sessions with content
    const input = page.locator("#prompt-input");
    await input.fill("first session message");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 90_000 });

    await page.locator("#new-chat-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });

    await input.fill("second session message");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 90_000 });

    // Open history — should have 2 sessions
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();
    await expect(page.locator(".history-item").first()).toBeVisible({
      timeout: 10_000,
    });

    // Delete non-active sessions first (these don't close the drawer)
    while (
      (await page
        .locator(".history-item:not(.active) .history-delete-btn")
        .count()) > 0
    ) {
      await page
        .locator(".history-item:not(.active) .history-delete-btn")
        .first()
        .click();
      await page.waitForTimeout(500);
    }

    // Delete the active session last (triggers new chat + closes drawer)
    const activeDeleteBtn = page.locator(
      ".history-item.active .history-delete-btn"
    );
    if ((await activeDeleteBtn.count()) > 0) {
      await activeDeleteBtn.click();
    }

    // Should be in a fresh chat state: welcome message, no user messages
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });
    const assistantMessages = page.locator(".message.assistant");
    await expect(assistantMessages).toHaveCount(1, { timeout: 10_000 });
    const welcomeText = await assistantMessages.first().textContent();
    expect(welcomeText).toContain("write the query");

    // Send button should work in the fresh chat
    await input.fill("message after deleting all");
    await page.locator("#send-btn").click({ timeout: 5_000 });
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });
  });

  test("multi-turn conversation order preserved after switch", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Turn 1: send message and wait for full response
    const input = page.locator("#prompt-input");
    await input.fill("sentinel-turn-one");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 90_000 });

    // Turn 2: send another message and wait for full response
    await input.fill("sentinel-turn-two");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(2, {
      timeout: 10_000,
    });
    await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 90_000 });
    await page.waitForTimeout(2_000);

    // Switch away and back
    await page.locator("#new-chat-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });

    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();
    await expect(page.locator(".history-item").first()).toBeVisible({
      timeout: 10_000,
    });
    const previousSession = page.locator(
      ".history-item:not(.active) .history-item-content"
    );
    await previousSession.first().click();

    // Verify both user messages restored in order
    const userMessages = page.locator(".message.user");
    await expect(userMessages).toHaveCount(2, { timeout: 15_000 });
    await expect(userMessages.nth(0)).toContainText("sentinel-turn-one");
    await expect(userMessages.nth(1)).toContainText("sentinel-turn-two");

    // Verify assistant messages are interleaved (at least 2)
    const assistantCount = await page.locator(".message.assistant").count();
    expect(assistantCount).toBeGreaterThanOrEqual(2);

    // Verify ordering: first message in DOM should be user turn 1
    const allMessages = page.locator(".message");
    const firstRole = await allMessages.first().evaluate((el) =>
      el.classList.contains("user") ? "user" : "assistant"
    );
    expect(firstRole).toBe("user");
  });

  test("clicking active session in history is a no-op", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a message so the session has content
    const input = page.locator("#prompt-input");
    await input.fill("sentinel-active-noop");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 90_000 });

    // Open history and click the ACTIVE session
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();
    await expect(page.locator(".history-item.active")).toBeVisible({
      timeout: 10_000,
    });
    await page
      .locator(".history-item.active .history-item-content")
      .click();

    // Drawer should close
    await expect(page.locator("#history-drawer")).not.toBeVisible({
      timeout: 3_000,
    });

    // Messages should remain exactly as they were (no reload/flicker)
    await expect(page.locator(".message.user")).toHaveCount(1);
    await expect(page.locator(".message.user").first()).toContainText(
      "sentinel-active-noop"
    );
  });

  test("first open with no stored session shows welcome", async ({
    context,
    extensionId,
  }) => {
    // Fresh browser context — no stored sessionId
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Should show exactly 1 welcome message and 0 user messages
    await expect(page.locator(".message.user")).toHaveCount(0);
    const assistantMessages = page.locator(".message.assistant");
    await expect(assistantMessages).toHaveCount(1, { timeout: 5_000 });
    const welcomeText = await assistantMessages.first().textContent();
    expect(welcomeText).toContain("write the query");

    // Send button should be enabled and functional
    await expect(page.locator("#send-btn")).toBeEnabled();
  });

  // ── Phase 3: UX polish ───────────────────────────────────────────────

  test("history drawer closes on toggle re-click", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Open the drawer
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();

    // Click the same button again — should close the drawer
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).not.toBeVisible({
      timeout: 3_000,
    });

    // History button should lose active state
    await expect(page.locator("#history-btn")).not.toHaveClass(/active/, {
      timeout: 2_000,
    });
  });

  test("input is focused after new chat", async ({ context, extensionId }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Send a message first
    const input = page.locator("#prompt-input");
    await input.fill("some message");
    await page.locator("#send-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });

    // Click New Chat
    await page.locator("#new-chat-btn").click();
    await expect(page.locator(".message.user")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Input should be focused
    const isFocused = await input.evaluate(
      (el) => document.activeElement === el
    );
    expect(isFocused).toBe(true);
  });

  test("empty history shows placeholder", async ({
    context,
    extensionId,
  }) => {
    // Fresh browser context — no sessions have been created yet
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });

    // Open history drawer without sending any messages
    await page.locator("#history-btn").click();
    await expect(page.locator("#history-drawer")).toBeVisible();

    // Should show the "No past conversations" placeholder
    await expect(page.locator(".history-empty")).toBeVisible({
      timeout: 5_000,
    });
    const emptyText = await page.locator(".history-empty").textContent();
    expect(emptyText).toContain("No past conversations");

    // No history items should be present
    await expect(page.locator(".history-item")).toHaveCount(0);
  });
});
