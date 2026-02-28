// E2E: Context switch scenario — tests whether the LLM correctly handles
// switching from one container to another with a different schema.
//
// Scenario: User browses orders (has "status" field) in Data Explorer, asks
// "show me all items" then "how many are pending?". Then switches to products
// (no "status" field) and asks "how many are pending?" again — identical question.
//
// Risk: The LLM has conversation history full of successful queries against
// orders using WHERE c.status = 'pending'. It might blindly reuse that pattern
// against products, which has no status field — returning 0 silently or erroring.
//
// Tested 5 times (2026-02-28): The LLM consistently recognized the schema
// difference across all runs. Typical response:
//   "The products container doesn't have a status field, so there's no concept
//    of 'pending' here. The available fields are: id, name, category, price,
//    inStock. Did you mean to query the orders container?"
//
// This test is exploratory — it logs the LLM response for human review rather
// than asserting on specific wording, since LLM output varies between runs.

import { test, expect, openSidePanel } from "./fixtures.js";
import type { Page } from "@playwright/test";

/** Wait for streaming to fully complete: thinking indicator gone + send button enabled */
async function waitForStreamingDone(page: Page) {
  await expect(page.locator(".thinking-indicator")).toBeHidden({
    timeout: 90_000,
  });
  await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 15_000 });
  // Let the JS event loop settle (isStreaming = false happens in finally{})
  await page.waitForTimeout(500);
}

test.describe("Context switch", () => {
  test("LLM handles schema difference when container changes mid-conversation", async ({
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

    // Step 1: Set context to orders container (user clicked orders in Data Explorer)
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

    // Step 2: User asks naturally — context tells the LLM which container
    await input.fill("show me all items");
    await page.locator("#send-btn").click();
    await waitForStreamingDone(page);

    // Step 3: Follow-up about status — should work since orders has a status field
    await input.fill("how many are pending?");
    await page.locator("#send-btn").click();
    await waitForStreamingDone(page);

    // Verify: should mention "2" pending somewhere
    const pendingResponse = page.locator(".message.assistant", {
      hasText: "2",
    });
    await expect(pendingResponse.first()).toBeVisible();

    // Step 4: User clicks products tab in Data Explorer — context switches
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
    await expect(page.locator("#context-text")).toContainText("products", {
      timeout: 5_000,
    });

    // Step 5: User asks the EXACT same question — no hint about the switch
    await input.fill("how many are pending?");
    await page.locator("#send-btn").click();

    // Verify the 3rd user message appeared (confirms the message was actually sent)
    await expect(page.locator(".message.user")).toHaveCount(3, {
      timeout: 10_000,
    });

    // Wait for the response to complete
    await waitForStreamingDone(page);

    // Read the final response
    const allAssistantMsgs = page.locator(".message.assistant");
    const finalResponseText = await allAssistantMsgs.last().textContent();
    console.log("\n=== CONTEXT SWITCH TEST RESULT ===");
    console.log("Context: products (no 'status' field)");
    console.log('Question: "how many are pending?"');
    console.log(`LLM response: ${finalResponseText}`);
    console.log("=== END ===\n");

    // Exploratory: log what the LLM did so we can decide on assertions.
    // Acceptable: mentions no status field, different schema, or asks for clarification.
    // Unacceptable: "there are 2 pending" (stale orders data carried over).
  });
});
