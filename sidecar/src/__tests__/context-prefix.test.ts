import { describe, it, expect } from "vitest";
import { buildContextPrefix, type ExplorerContext } from "../copilot.js";

describe("buildContextPrefix", () => {
    // --- Structural invariants (must never break — session history stripping depends on this) ---

    it("starts with '[Current Data Explorer context' when context is resolved", () => {
        const ctx: ExplorerContext = {
            endpoint: "http://localhost:8081",
            database: "shopDB",
            container: "orders",
            contextResolved: true,
        };
        const prefix = buildContextPrefix(ctx);
        expect(prefix.startsWith("[Current Data Explorer context")).toBe(true);
    });

    it("includes Database and Container lines when both are provided", () => {
        const ctx: ExplorerContext = {
            database: "shopDB",
            container: "orders",
            contextResolved: true,
        };
        const prefix = buildContextPrefix(ctx);
        expect(prefix).toContain("Database: shopDB");
        expect(prefix).toContain("Container: orders");
    });

    it("returns unresolved guidance when context is empty (no database/container)", () => {
        const prefix = buildContextPrefix({});
        // An empty context object has contextResolved=undefined, no database, no container.
        // The function treats this as unresolved and emits guidance.
        expect(prefix).toContain("unresolved");
    });

    // --- Write-safety guidance (P1 fix) ---

    it("contains write-specific guidance that distinguishes reads from writes", () => {
        const ctx: ExplorerContext = {
            database: "shopDB",
            container: "orders",
            contextResolved: true,
        };
        const prefix = buildContextPrefix(ctx);

        // The prefix should NOT tell the LLM to blindly use context for all operations.
        // It should distinguish between reads (safe to default) and writes (verify first).
        expect(prefix).toMatch(/write/i);
        expect(prefix).toMatch(/read/i);
    });

    it("does not unconditionally say 'use as defaults' without qualification", () => {
        const ctx: ExplorerContext = {
            database: "shopDB",
            container: "orders",
            contextResolved: true,
        };
        const prefix = buildContextPrefix(ctx);

        // The old wording "use as defaults when the user doesn't specify explicitly"
        // was too broad — it treated reads and writes the same. The new wording
        // should qualify that defaults apply primarily to reads.
        const hasUnqualifiedDefault =
            prefix.includes("use as defaults when the user doesn't specify explicitly") &&
            !prefix.match(/read|write/i);
        expect(hasUnqualifiedDefault).toBe(false);
    });

    // --- Unresolved context ---

    it("warns about unresolved context and advises verifying before writes", () => {
        const ctx: ExplorerContext = {
            endpoint: "http://localhost:8081",
            contextResolved: false,
        };
        const prefix = buildContextPrefix(ctx);
        expect(prefix).toContain("unresolved");
    });
});
