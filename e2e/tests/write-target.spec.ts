// E2E: Write-target accuracy — tests whether the LLM writes data to the
// semantically correct container, even when the ambient UI context points
// to a different container.
//
// This is the golden test for the bug where "add 3 fitness products" caused
// the LLM to insert into the orders container (the ambient context) instead
// of the products container (the user's intent).
//
// Test C: Ambient context is orders. User asks to add a product to the
// products container. Verify the document lands in products, not orders.
//
// Test D: After a write, the LLM should run a verification query and show
// the inserted data in its response (not just say "successfully inserted").

import { test, expect, openSidePanel } from "./fixtures.js";
import { CosmosClient } from "@azure/cosmos";
import type { Page } from "@playwright/test";

const EMULATOR_ENDPOINT = "http://localhost:8081";
const EMULATOR_KEY =
    "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

const SENTINEL_PRODUCT_NAME = "sentinel-write-target-test";
const SENTINEL_ORDER_NAME = "sentinel-write-verify-test";

/** Wait for streaming to fully complete: thinking indicator gone + send button enabled */
async function waitForStreamingDone(page: Page) {
    await expect(page.locator(".thinking-indicator")).toBeHidden({
        timeout: 90_000,
    });
    await expect(page.locator("#send-btn")).toBeEnabled({ timeout: 15_000 });
    await page.waitForTimeout(500);
}

/** Direct Cosmos client for verification — bypasses the sidecar entirely */
function getCosmosClient() {
    return new CosmosClient({ endpoint: EMULATOR_ENDPOINT, key: EMULATOR_KEY });
}

/** Query a container directly for a document by name */
async function findDocByName(
    database: string,
    container: string,
    name: string
): Promise<any[]> {
    const client = getCosmosClient();
    const { resources } = await client
        .database(database)
        .container(container)
        .items.query({
            query: "SELECT * FROM c WHERE c.name = @name",
            parameters: [{ name: "@name", value: name }],
        })
        .fetchAll();
    return resources;
}

/** Clean up sentinel test documents from both containers */
async function cleanupSentinels() {
    const client = getCosmosClient();

    // Clean from products (where it SHOULD land)
    for (const name of [SENTINEL_PRODUCT_NAME, SENTINEL_ORDER_NAME]) {
        const docs = await findDocByName("e2etest", "products", name);
        for (const doc of docs) {
            try {
                await client
                    .database("e2etest")
                    .container("products")
                    .item(doc.id, doc.category)
                    .delete();
            } catch {
                // ignore
            }
        }
    }

    // Clean from orders (where it should NOT land, but might due to the bug)
    for (const name of [SENTINEL_PRODUCT_NAME, SENTINEL_ORDER_NAME]) {
        const docs = await findDocByName("e2etest", "orders", name);
        for (const doc of docs) {
            try {
                await client
                    .database("e2etest")
                    .container("orders")
                    .item(doc.id, doc.customerId ?? undefined)
                    .delete();
            } catch {
                // ignore
            }
        }
    }
}

test.describe("Write-target accuracy", () => {
    test.afterAll(async () => {
        await cleanupSentinels();
    });

    test("LLM writes to semantically correct container despite different ambient context", async ({
        context,
        extensionId,
    }) => {
        // Clean up before test in case of prior partial run
        await cleanupSentinels();

        const page = await openSidePanel(context, extensionId);
        await expect(page.locator("#status")).toHaveText("Connected", {
            timeout: 30_000,
        });
        await expect(page.locator(".message.assistant")).toHaveCount(1, {
            timeout: 10_000,
        });

        const input = page.locator("#prompt-input");

        // Step 1: Set ambient context to orders (the WRONG container for products)
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

        // Step 2: Ask to add a product — the user's intent clearly targets "products"
        await input.fill(
            `Add a product called "${SENTINEL_PRODUCT_NAME}" with category "electronics" and price 19.99 to the products container`
        );
        const assistantCountBefore = await page.locator(".message.assistant").count();
        await page.locator("#send-btn").click();

        // Wait for a NEW assistant message to appear
        await expect(page.locator(".message.assistant")).toHaveCount(
            assistantCountBefore + 1,
            { timeout: 90_000 }
        );
        await waitForStreamingDone(page);

        // Step 3: Verify directly via Cosmos SDK — the document should be in products
        const inProducts = await findDocByName(
            "e2etest",
            "products",
            SENTINEL_PRODUCT_NAME
        );
        const inOrders = await findDocByName(
            "e2etest",
            "orders",
            SENTINEL_PRODUCT_NAME
        );

        console.log("\n=== WRITE-TARGET TEST ===");
        console.log(`Ambient context: e2etest/orders`);
        console.log(
            `Request: Add product "${SENTINEL_PRODUCT_NAME}" to products container`
        );
        console.log(`Found in products: ${inProducts.length} doc(s)`);
        console.log(`Found in orders: ${inOrders.length} doc(s)`);
        console.log("=== END ===\n");

        // The product MUST be in the products container
        expect(inProducts.length).toBeGreaterThanOrEqual(1);
        // The product MUST NOT be in the orders container
        expect(inOrders.length).toBe(0);
    });

    test("LLM response includes verification query after writing data", async ({
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

        // Set context to orders — this time the write IS to orders (no mismatch)
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

        // Ask to add an order — context and intent align
        await input.fill(
            `Add an order with id "sentinel-verify-001", customerId "cust-test-888", total 25.00, status "pending", and name "${SENTINEL_ORDER_NAME}"`
        );
        const assistantCountBefore2 = await page.locator(".message.assistant").count();
        await page.locator("#send-btn").click();

        // Wait for a NEW assistant message to appear
        await expect(page.locator(".message.assistant")).toHaveCount(
            assistantCountBefore2 + 1,
            { timeout: 90_000 }
        );
        await waitForStreamingDone(page);

        // The LLM's response should contain evidence of a verification query —
        // either showing a SELECT statement or displaying the inserted data back
        const lastResponse = page.locator(".message.assistant").last();
        const responseText = await lastResponse.textContent();

        console.log("\n=== POST-WRITE VERIFICATION TEST ===");
        console.log(`Response text: ${responseText}`);
        console.log("=== END ===\n");

        // The response should show the data back (verification), not just a bare
        // "successfully inserted" claim. Look for evidence of a SELECT query or
        // the sentinel data being echoed back.
        const hasVerification =
            responseText?.toLowerCase().includes("select") ||
            responseText?.includes(SENTINEL_ORDER_NAME) ||
            responseText?.includes("sentinel-verify-001") ||
            responseText?.includes("cust-test-888");

        expect(hasVerification).toBe(true);
    });
});
