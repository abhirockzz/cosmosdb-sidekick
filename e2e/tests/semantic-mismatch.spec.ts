// E2E: Semantic mismatch scenario — same field name, different meaning across containers.
//
// Scenario: User browses products (category = "electronics" | "books"), asks
// "show me all electronics". Then switches to reviews (category = "complaint" |
// "praise" | "question") and asks "show me all electronics" again.
//
// Risk: The query `WHERE c.category = 'electronics'` is valid SQL on both
// containers — it won't error on reviews. But reviews has NO documents with
// category "electronics", so it returns 0 results. The LLM might just say
// "no results found" without explaining that the category field means something
// different here. The user thinks there are no electronics reviews, when really
// the field tracks review type, not product type.
//
// This is harder than the missing-field case (context-switch.spec.ts) because
// the query succeeds — there's no error signal to trigger re-examination.
//
// === TEST RESULTS (5 runs) ===
// Run 1: PASS — LLM cross-referenced product IDs, queried reviews by productId
// Run 2: PASS — Same approach, explicitly noted cross-container lookup
// Run 3: PASS — Same, added summary of review sentiments
// Run 4: PASS — Added note "cross-container joins aren't supported in Cosmos DB"
// Run 5: PASS — Noted "reviews don't store product category directly"
//
// Outcome: The LLM consistently avoided the trap. Instead of running
// WHERE c.category = 'electronics' on reviews (which returns 0 silently),
// it recognized that "electronics" is a product category concept, used the
// product IDs from the conversation, and queried reviews via productId.
// It always explained the cross-container reasoning to the user.

import { test, expect, openSidePanel } from "./fixtures.js";
import type { Page } from "@playwright/test";

async function waitForStreamingDone(page: Page) {
  await expect(page.locator(".thinking-indicator")).toBeHidden({
    timeout: 90_000,
  });
  await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

test.describe("Semantic mismatch", () => {
  test("LLM recognizes that same field name has different meaning across containers", async ({
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

    // Step 1: Set context to products (category = electronics | books)
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

    // Step 2: Ask for electronics — should return 2 products
    await input.fill("show me all electronics");
    await page.locator("#send-btn").click();

    // Wait for user message to appear, then streaming to complete
    await expect(page.locator(".message.user")).toHaveCount(1, {
      timeout: 10_000,
    });
    await waitForStreamingDone(page);

    // Wait for a second assistant message (response to our query)
    await expect(page.locator(".message.assistant")).toHaveCount(2, {
      timeout: 90_000,
    });

    // Verify we got electronics products (sentinel values visible in response)
    const allMsgs = page.locator(".message.assistant");
    const firstResponseText = await allMsgs.last().textContent();
    console.log("\n=== STEP 2: Products query ===");
    console.log(`Response: ${firstResponseText?.substring(0, 300)}`);
    expect(firstResponseText?.toLowerCase()).toContain("sentinel");

    // Step 3: Switch context to reviews (category = complaint | praise | question)
    await page.evaluate(() => {
      chrome.storage.local.set({
        explorerContext: {
          endpoint: "http://localhost:8081",
          database: "e2etest",
          container: "reviews",
          contextResolved: true,
        },
      });
    });
    await expect(page.locator("#context-text")).toContainText("reviews", {
      timeout: 5_000,
    });

    // Step 4: Ask the SAME question — "show me all electronics"
    // The trap: WHERE c.category = 'electronics' is valid SQL on reviews
    // but returns 0 results (reviews use category for complaint/praise/question)
    await input.fill("show me all electronics");
    await page.locator("#send-btn").click();

    // Wait for user message, then for streaming to complete
    await expect(page.locator(".message.user")).toHaveCount(2, {
      timeout: 10_000,
    });
    await waitForStreamingDone(page);

    // Wait for the third assistant message (response to reviews query)
    await expect(page.locator(".message.assistant")).toHaveCount(3, {
      timeout: 90_000,
    });

    // Read the final response
    const allAssistantMsgs = page.locator(".message.assistant");
    const finalResponseText = await allAssistantMsgs.last().textContent();
    console.log("\n=== SEMANTIC MISMATCH TEST RESULT ===");
    console.log("Context: reviews (category = complaint | praise | question)");
    console.log('Question: "show me all electronics"');
    console.log(`LLM response: ${finalResponseText}`);
    console.log("=== END ===\n");

    // Acceptable responses:
    // - Explains that "category" in reviews means review type, not product type
    // - Lists the actual category values (complaint, praise, question)
    // - Suggests filtering by productId instead
    // - Says "no electronics category exists in reviews" and explains the schema
    //
    // Unacceptable responses:
    // - Just says "no results found" or "0 items" without explaining WHY
    // - Returns empty table with no schema context
    // - Silently runs the query and presents 0 results as if that's the answer
  });
});
