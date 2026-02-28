// E2E: Cross-database explicit reference — tests whether the LLM correctly
// queries a different database/container when the user explicitly names it,
// even though the ambient context points elsewhere.
//
// Scenario: User is browsing e2etest/orders (ambient context). They've asked
// a couple of questions against orders. Then, WITHOUT switching tabs, they ask
// "how many documents are in the events container in analyticsDB?" — explicitly
// naming a completely different database and container.
//
// Risk 1: The LLM ignores the explicit reference and queries orders instead,
// because the ambient context prefix and all prior tool calls reinforce orders.
//
// Risk 2: The LLM queries the right container for the explicit question, but
// on the next ambiguous follow-up ("what about pageviews?") it snaps back to
// orders (the ambient context) instead of continuing with analyticsDB/events.

import { test, expect, openSidePanel } from "./fixtures.js";
import type { Page } from "@playwright/test";

/** Wait for streaming to fully complete: thinking indicator gone + send button enabled */
async function waitForStreamingDone(page: Page) {
  await expect(page.locator(".thinking-indicator")).toBeHidden({
    timeout: 90_000,
  });
  await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

test.describe("Cross-database explicit reference", () => {
  test("LLM queries explicitly named database/container despite different ambient context", async ({
    context,
    extensionId,
  }) => {
    const page = await openSidePanel(context, extensionId);
    await expect(page.locator("#status")).toHaveText("Connected", {
      timeout: 30_000,
    });
    await expect(page.locator(".message.assistant")).toHaveCount(1, {
      timeout: 10_000,
    });

    const input = page.locator("#prompt-input");

    // Step 1: Set ambient context to e2etest/orders
    await page.evaluate(() => {
      chrome.storage.local.set({
        explorerContext: {
          endpoint: "http://localhost:8081",
          database: "e2etest",
          container: "orders",
          contextResolved: true,
        },
      });
    });
    await expect(page.locator("#context-bar")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#context-text")).toContainText("orders");

    // Step 2: Build momentum — ask a couple of questions against orders
    await input.fill("show me all items in this container");
    await page.locator("#send-btn").click();
    await waitForStreamingDone(page);

    await input.fill("how many orders are pending?");
    await page.locator("#send-btn").click();
    await waitForStreamingDone(page);

    // Verify orders momentum is established — should mention "2" pending
    const pendingResponse = page.locator(".message.assistant", {
      hasText: "2",
    });
    await expect(pendingResponse.first()).toBeVisible();

    // Step 3: Explicitly reference a DIFFERENT database/container — no tab switch
    // The ambient context STILL says e2etest/orders
    const assistantCountBefore = await page
      .locator(".message.assistant")
      .count();

    await input.fill(
      "how many documents are in the events container in the analyticsDB database?"
    );
    await page.locator("#send-btn").click();

    // Wait for a NEW assistant message to appear beyond what we had before
    await expect(page.locator(".message.assistant")).toHaveCount(
      assistantCountBefore + 1,
      { timeout: 90_000 }
    );
    await waitForStreamingDone(page);

    // Should return 5 (the number of event documents seeded)
    const crossDbResponse = page.locator(".message.assistant").last();
    const crossDbText = await crossDbResponse.textContent();
    console.log("\n=== CROSS-DB EXPLICIT REFERENCE TEST ===");
    console.log("Ambient context: e2etest/orders");
    console.log(
      'Question: "how many documents are in the events container in the analyticsDB database?"'
    );
    console.log(`LLM response: ${crossDbText}`);
    console.log("=== END ===\n");

    // The response should mention 5 (the count from analyticsDB/events)
    // NOT 4 (the count from e2etest/orders)
    expect(crossDbText).toContain("5");

    // Step 4: Ambiguous follow-up — does the LLM stick with analyticsDB/events
    // or snap back to e2etest/orders?
    const assistantCountBeforeFollowUp = await page
      .locator(".message.assistant")
      .count();

    await input.fill("how many of those are pageviews?");
    await page.locator("#send-btn").click();

    await expect(page.locator(".message.assistant")).toHaveCount(
      assistantCountBeforeFollowUp + 1,
      { timeout: 90_000 }
    );
    await waitForStreamingDone(page);

    const followUpResponse = page.locator(".message.assistant").last();
    const followUpText = await followUpResponse.textContent();
    console.log("\n=== CROSS-DB FOLLOW-UP TEST ===");
    console.log("Ambient context: still e2etest/orders");
    console.log('Question: "how many of those are pageviews?"');
    console.log(`LLM response: ${followUpText}`);
    console.log("=== END ===\n");

    // Should return 3 (pageview events in analyticsDB/events)
    // NOT something from orders (which has no "pageview" concept)
    expect(followUpText).toContain("3");
  });
});
