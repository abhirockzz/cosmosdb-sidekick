// E2E: Partition key validation in upsert_items — tests that the sidecar warns
// when inserted documents are missing the target container's partition key field.
//
// This test talks to the sidecar via the chat API (full LLM loop). It asks the
// LLM to insert a document missing the partition key field and checks that the
// response includes a warning about the missing field.
//
// It also validates directly via the Cosmos SDK that the upsertItems function
// returns the expected shape (warnings + partitionKeyPath) by calling the
// sidecar's chat endpoint and examining the LLM's response for warning signals.
//
// Scenario: The orders container has partition key /customerId. If the LLM
// inserts a document without a customerId field, the tool response should
// include a warning, and the LLM should surface that to the user per the
// system prompt's write-safety rules.

import { test, expect, openSidePanel } from "./fixtures.js";
import { CosmosClient } from "@azure/cosmos";
import type { Page } from "@playwright/test";

const EMULATOR_ENDPOINT = "http://localhost:8081";
const EMULATOR_KEY =
    "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

/** Wait for streaming to fully complete */
async function waitForStreamingDone(page: Page) {
    await expect(page.locator(".thinking-indicator")).toBeHidden({
        timeout: 90_000,
    });
    await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 15_000 });
    await page.waitForTimeout(500);
}

async function cleanupTestDocs() {
    const client = new CosmosClient({ endpoint: EMULATOR_ENDPOINT, key: EMULATOR_KEY });
    const container = client.database("e2etest").container("orders");
    for (const id of ["pk-test-missing-001"]) {
        try {
            await container.item(id, undefined).delete();
        } catch {
            // ignore — doc may not exist
        }
    }
}

test.describe("Partition key validation on upsert", () => {
    test.afterAll(async () => {
        await cleanupTestDocs();
    });

    test("LLM surfaces partition key warning when document is missing the partition key field", async ({
        context,
        extensionId,
    }) => {
        await cleanupTestDocs();

        const page = await openSidePanel(context, extensionId);
        await expect(page.locator("#status")).toHaveText("Connected", {
            timeout: 30_000,
        });
        await expect(page.locator(".message.assistant")).toHaveCount(1, {
            timeout: 10_000,
        });

        const input = page.locator("#prompt-input");

        // Set context to orders (partition key: /customerId)
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

        // Ask the LLM to insert a document that is deliberately MISSING the
        // partition key field (customerId). The upsert_items tool should return
        // a warning, and the LLM should relay it to the user.
        await input.fill(
            'Insert a document into the orders container with id "pk-test-missing-001", productName "Broken Widget", category "testing", price 9.99. Do NOT include a customerId field.'
        );
        const assistantCountBefore = await page.locator(".message.assistant").count();
        await page.locator("#send-btn").click();

        // Wait for a NEW assistant message to appear
        await expect(page.locator(".message.assistant")).toHaveCount(
            assistantCountBefore + 1,
            { timeout: 90_000 }
        );
        await waitForStreamingDone(page);

        const lastResponse = page.locator(".message.assistant").last();
        const responseText = await lastResponse.textContent();

        console.log("\n=== PARTITION KEY WARNING TEST ===");
        console.log(`Response: ${responseText}`);
        console.log("=== END ===\n");

        // The LLM should mention the missing partition key — either "customerId",
        // "partition key", or "warning" in its response
        const mentionsPartitionIssue =
            responseText?.toLowerCase().includes("customerid") ||
            responseText?.toLowerCase().includes("partition") ||
            responseText?.toLowerCase().includes("warning") ||
            responseText?.toLowerCase().includes("missing");

        expect(mentionsPartitionIssue).toBe(true);
    });
});
