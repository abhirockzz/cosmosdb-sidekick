// Unit tests for content-script.js DOM parsing logic.
//
// Approach: build a jsdom environment that mimics the Cosmos DB Data Explorer,
// load the unmodified content-script.js, and assert what CONTEXT_UPDATE messages
// are sent via chrome.runtime.sendMessage.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import vm from "node:vm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, "../content-script.js"),
  "utf-8"
);

// ---------------------------------------------------------------------------
// Helpers: build DOM elements matching the emulator's real structure
// ---------------------------------------------------------------------------

/** Create the jsdom window with mocked chrome API, returning a helper object. */
function createEnv() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost:8081/_explorer/index.html",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;

  // Capture messages sent by the content script
  const messages = [];
  window.chrome = {
    runtime: {
      sendMessage: (msg) => messages.push(structuredClone(msg)),
    },
  };

  // Prevent the MutationObserver / setTimeout from running — we call
  // sendContextUpdate indirectly by triggering the initial setTimeout.
  const timers = [];
  const origSetTimeout = window.setTimeout.bind(window);
  const origClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms) => {
    timers.push(fn);
    return timers.length;
  };
  window.clearTimeout = () => {}; // no-op so debounce doesn't remove pending timers

  function loadScript() {
    // Run the content script in the jsdom window context so that
    // document, window, chrome, setTimeout etc. are all available as globals.
    const vmContext = vm.createContext(window);
    vm.runInContext(CONTENT_SCRIPT, vmContext);
  }

  /** Execute all pending timers (triggers the initial sendContextUpdate). */
  function flush() {
    for (const fn of timers.splice(0)) fn();
  }

  /** Get the last CONTEXT_UPDATE message, or null. */
  function lastContext() {
    const updates = messages.filter((m) => m.type === "CONTEXT_UPDATE");
    return updates.length ? updates[updates.length - 1].context : null;
  }

  /** Get all CONTEXT_UPDATE messages. */
  function allContexts() {
    return messages
      .filter((m) => m.type === "CONTEXT_UPDATE")
      .map((m) => m.context);
  }

  return { dom, window, document, messages, loadScript, flush, lastContext, allContexts };
}

/**
 * Build a tree sidebar with databases and containers.
 *
 * @param {Document} document
 * @param {Array<{name: string, expanded: boolean, containers: Array<{name: string, expanded?: boolean, tabindex?: string, ariaCurrent?: string}>}>} databases
 */
function buildTree(document, databases) {
  const tree = document.createElement("div");
  tree.setAttribute("role", "tree");

  // Home node
  const home = document.createElement("div");
  home.setAttribute("role", "treeitem");
  home.setAttribute("aria-level", "1");
  home.setAttribute("data-fui-tree-item-value", "Home");
  tree.appendChild(home);

  for (const db of databases) {
    const dbNode = document.createElement("div");
    dbNode.setAttribute("role", "treeitem");
    dbNode.setAttribute("aria-level", "1");
    dbNode.setAttribute("aria-expanded", db.expanded ? "true" : "false");
    dbNode.setAttribute("data-fui-tree-item-value", db.name);
    dbNode.setAttribute("data-test", `TreeNodeContainer:${db.name}`);

    for (const c of db.containers) {
      const cNode = document.createElement("div");
      cNode.setAttribute("role", "treeitem");
      cNode.setAttribute("aria-level", "2");
      cNode.setAttribute(
        "aria-expanded",
        c.expanded ? "true" : "false"
      );
      cNode.setAttribute(
        "data-fui-tree-item-value",
        `${db.name}/${c.name}`
      );
      cNode.setAttribute(
        "data-test",
        `TreeNodeContainer:${db.name}/${c.name}`
      );
      if (c.tabindex != null) cNode.setAttribute("tabindex", c.tabindex);
      if (c.ariaCurrent) cNode.setAttribute("aria-current", c.ariaCurrent);

      // Level-3 children (Items, Scale & Settings)
      for (const child of ["Items", "Scale & Settings"]) {
        const l3 = document.createElement("div");
        l3.setAttribute("role", "treeitem");
        l3.setAttribute("aria-level", "3");
        l3.textContent = child;
        cNode.appendChild(l3);
      }

      dbNode.appendChild(cNode);
    }
    tree.appendChild(dbNode);
  }

  document.body.appendChild(tree);
}

/**
 * Build a tab bar with tabs.
 *
 * @param {Document} document
 * @param {Array<{text: string, selected?: boolean, title?: string, tabValue?: string}>} tabs
 */
function buildTabs(document, tabs) {
  const tabBar = document.createElement("div");
  tabBar.setAttribute("role", "tablist");

  for (const t of tabs) {
    const tab = document.createElement("div");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", t.selected ? "true" : "false");
    if (t.title) tab.setAttribute("title", t.title);
    if (t.tabValue)
      tab.setAttribute("data-fui-tab-value", t.tabValue);

    const textEl = document.createElement("span");
    textEl.className = "tabNavText";
    textEl.textContent = t.text;
    if (t.textTitle) textEl.setAttribute("title", t.textTitle);
    tab.appendChild(textEl);

    tabBar.appendChild(tab);
  }

  document.body.appendChild(tabBar);
}

// ===========================================================================
// A. Tab parsing
// ===========================================================================

describe("A. Tab text parsing", () => {
  it("A1: title with database>container>tabType format", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      { name: "demodb2", expanded: true, containers: [{ name: "demo1", expanded: true }] },
    ]);
    buildTabs(document, [
      { text: "demo1.Items", selected: true, title: "demodb2>demo1>Items" },
    ]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "demodb2");
    assert.equal(ctx.container, "demo1");
    assert.equal(ctx.contextResolved, true);
  });

  it("A2: slash format database/container.tabType", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      { name: "myDb", expanded: true, containers: [{ name: "myContainer", expanded: true }] },
    ]);
    buildTabs(document, [
      { text: "myContainer.Items", selected: true, tabValue: "myDb/myContainer.Items" },
    ]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "myDb");
    assert.equal(ctx.container, "myContainer");
  });

  it("A3: plain container.Items text (no database)", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      { name: "movies_db", expanded: true, containers: [{ name: "movies", expanded: true }] },
    ]);
    buildTabs(document, [
      { text: "movies.Items", selected: true },
    ]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "movies_db");
    assert.equal(ctx.container, "movies");
  });

  it("A4: query tab (container.Query 1)", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      { name: "testdb", expanded: true, containers: [{ name: "users", expanded: true }] },
    ]);
    buildTabs(document, [
      { text: "users.Query 1", selected: true },
    ]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.container, "users");
  });

  it("A5: Home tab", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTabs(document, [{ text: "Home", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, null);
    assert.equal(ctx.container, null);
  });

  it("A6: no selected tab", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTabs(document, [{ text: "movies.Items", selected: false }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, null);
    assert.equal(ctx.container, null);
  });

  it("A7: truncated name with unicode ellipsis resolves from tree", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      {
        name: "proddb",
        expanded: true,
        containers: [{ name: "appleProducts", expanded: true }],
      },
    ]);
    // Tab text shows truncated name
    buildTabs(document, [{ text: "apple\u2026Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.container, "appleProducts");
    assert.equal(ctx.database, "proddb");
  });

  it("A8: truncated name with ASCII ellipsis — parsed as container name up to first dot", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      {
        name: "proddb",
        expanded: true,
        containers: [{ name: "appleProducts", expanded: true }],
      },
    ]);
    // "apple...Items" — the first dot splits before the ellipsis check runs,
    // so container becomes "apple" (not resolved via prefix). This matches
    // real behavior: the emulator uses Unicode "…", not ASCII "...".
    buildTabs(document, [{ text: "apple...Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.container, "apple");
  });
});

// ===========================================================================
// B. Tree DOM scan — finding the parent database
// ===========================================================================

describe("B. Tree DOM scan", () => {
  it("B1: one expanded DB has the container", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      { name: "db1", expanded: true, containers: [{ name: "orders" }] },
      { name: "db2", expanded: false, containers: [{ name: "users" }] },
    ]);
    buildTabs(document, [{ text: "orders.Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "db1");
    assert.equal(ctx.container, "orders");
  });

  it("B3: no expanded DB has the container — falls through to data-test", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      { name: "db1", expanded: false, containers: [{ name: "orders" }] },
    ]);
    buildTabs(document, [{ text: "orders.Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    // data-test fallback: only one match → resolves
    assert.equal(ctx.database, "db1");
    assert.equal(ctx.container, "orders");
  });

  it("B4: container unique via data-test when DB not expanded", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      { name: "alpha", expanded: false, containers: [{ name: "items" }] },
    ]);
    buildTabs(document, [{ text: "items.Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "alpha");
  });

  it("B5: container in multiple DBs via data-test — leaves db unset", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    // Both collapsed — data-test fallback finds two matches
    buildTree(document, [
      { name: "db1", expanded: false, containers: [{ name: "shared" }] },
      { name: "db2", expanded: false, containers: [{ name: "shared" }] },
    ]);
    buildTabs(document, [{ text: "shared.Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    // Ambiguous — neither expanded, multiple data-test matches
    assert.equal(ctx.database, null);
  });
});

// ===========================================================================
// C. Disambiguation — same container name across databases (the bug)
// ===========================================================================

describe("C. Same container name across databases", () => {
  it("C1: two expanded DBs, only second has aria-current — picks second", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      {
        name: "demodb1",
        expanded: true,
        containers: [{ name: "demo1", expanded: true }],
      },
      {
        name: "demodb2",
        expanded: true,
        containers: [{ name: "demo1", expanded: true, ariaCurrent: "true" }],
      },
    ]);
    buildTabs(document, [{ text: "demo1.Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "demodb2");
    assert.equal(ctx.container, "demo1");
  });

  it("C2: two expanded DBs, only first has tabindex=0 — picks first", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      {
        name: "demodb1",
        expanded: true,
        containers: [{ name: "demo1", expanded: true, tabindex: "0" }],
      },
      {
        name: "demodb2",
        expanded: true,
        containers: [{ name: "demo1", expanded: true }],
      },
    ]);
    buildTabs(document, [{ text: "demo1.Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "demodb1");
  });

  it("C3: two DBs, only one container expanded — picks expanded one", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      {
        name: "demodb1",
        expanded: true,
        containers: [{ name: "demo1", expanded: false }],
      },
      {
        name: "demodb2",
        expanded: true,
        containers: [{ name: "demo1", expanded: true }],
      },
    ]);
    buildTabs(document, [{ text: "demo1.Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "demodb2");
  });

  it("C4: both expanded, one has tabindex=0 — picks focused one", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      {
        name: "demodb1",
        expanded: true,
        containers: [{ name: "demo1", expanded: true }],
      },
      {
        name: "demodb2",
        expanded: true,
        containers: [{ name: "demo1", expanded: true, tabindex: "0" }],
      },
    ]);
    buildTabs(document, [{ text: "demo1.Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "demodb2");
  });

  it("C5: both expanded, no focus/current signal — ambiguous", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      {
        name: "demodb1",
        expanded: true,
        containers: [{ name: "demo1", expanded: true }],
      },
      {
        name: "demodb2",
        expanded: true,
        containers: [{ name: "demo1", expanded: true }],
      },
    ]);
    buildTabs(document, [{ text: "demo1.Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    // Ambiguous — should NOT arbitrarily pick demodb1
    assert.equal(ctx.database, null);
  });

  it("C6: title attribute resolves correctly even with duplicate names", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      {
        name: "demodb1",
        expanded: true,
        containers: [{ name: "demo1", expanded: true }],
      },
      {
        name: "demodb2",
        expanded: true,
        containers: [{ name: "demo1", expanded: true }],
      },
    ]);
    // Title attribute provides unambiguous db>container>tab format
    buildTabs(document, [
      { text: "demo1.Items", selected: true, title: "demodb2>demo1>Items" },
    ]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "demodb2");
    assert.equal(ctx.container, "demo1");
  });
});

// ===========================================================================
// D. Caching & stability
// ===========================================================================

describe("D. Caching and stability", () => {
  it("D1: identical context is not sent twice", () => {
    const { document, loadScript, flush, allContexts } = createEnv();
    buildTree(document, [
      { name: "db1", expanded: true, containers: [{ name: "c1", expanded: true }] },
    ]);
    buildTabs(document, [{ text: "c1.Items", selected: true }]);
    loadScript();
    flush();
    // Trigger again (simulating MutationObserver callback)
    flush();
    const updates = allContexts();
    assert.equal(updates.length, 1, "should deduplicate identical context");
  });

  it("D5: switching to Home clears context", async () => {
    const { document, loadScript, flush, allContexts } = createEnv();
    buildTree(document, [
      { name: "db1", expanded: true, containers: [{ name: "c1", expanded: true }] },
    ]);
    buildTabs(document, [
      { text: "c1.Items", selected: true },
      { text: "Home", selected: false },
    ]);
    loadScript();
    flush(); // initial sendContextUpdate

    // Switch to Home tab — triggers MutationObserver → setTimeout(sendContextUpdate)
    const tabs = document.querySelectorAll('[role="tab"]');
    tabs[0].setAttribute("aria-selected", "false");
    tabs[1].setAttribute("aria-selected", "true");

    // MutationObserver callbacks are delivered asynchronously in jsdom
    await new Promise((r) => setTimeout(r, 50));
    flush();

    const updates = allContexts();
    assert.ok(updates.length >= 2, "should have sent at least 2 updates");
    const last = updates[updates.length - 1];
    assert.equal(last.database, null);
    assert.equal(last.container, null);
  });
});

// ===========================================================================
// E. Prefix resolution (truncated container names)
// ===========================================================================

describe("E. Prefix resolution", () => {
  it("E1: prefix matches exactly one container", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      {
        name: "db1",
        expanded: true,
        containers: [
          { name: "longContainerName", expanded: true },
          { name: "other", expanded: false },
        ],
      },
    ]);
    buildTabs(document, [{ text: "long\u2026Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.container, "longContainerName");
    assert.equal(ctx.database, "db1");
  });

  it("E2: prefix matches multiple containers — unresolved", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      {
        name: "db1",
        expanded: true,
        containers: [
          { name: "longAlpha", expanded: true },
          { name: "longBeta", expanded: false },
        ],
      },
    ]);
    buildTabs(document, [{ text: "long\u2026Items", selected: true }]);
    loadScript();
    flush();
    const ctx = lastContext();
    // Multiple matches for "long" prefix — can't resolve
    assert.equal(ctx.container, null);
  });

  it("E3: prefix + hinted database narrows to one", () => {
    const { document, loadScript, flush, lastContext } = createEnv();
    buildTree(document, [
      { name: "db1", expanded: true, containers: [{ name: "longAlpha" }] },
      { name: "db2", expanded: true, containers: [{ name: "longBeta" }] },
    ]);
    // title gives us the database, text is truncated
    buildTabs(document, [
      { text: "long\u2026Items", selected: true, title: "db1>longAlpha>Items" },
    ]);
    loadScript();
    flush();
    const ctx = lastContext();
    assert.equal(ctx.database, "db1");
    assert.equal(ctx.container, "longAlpha");
  });
});

// ===========================================================================
// F. Page detection
// ===========================================================================

describe("F. Page detection", () => {
  it("F1: localhost:8081 is detected", () => {
    const { messages, loadScript } = createEnv(); // URL is localhost:8081
    loadScript();
    assert.ok(
      messages.some((m) => m.type === "DATA_EXPLORER_DETECTED"),
      "should detect Data Explorer page"
    );
  });

  it("F4: non-emulator page is not detected", () => {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      url: "https://example.com/page",
    });
    const messages = [];
    dom.window.chrome = {
      runtime: { sendMessage: (msg) => messages.push(msg) },
    };
    dom.window.setTimeout = () => {};
    const vmContext = vm.createContext(dom.window);
    vm.runInContext(CONTENT_SCRIPT, vmContext);
    assert.ok(
      !messages.some((m) => m.type === "DATA_EXPLORER_DETECTED"),
      "should not detect non-emulator page"
    );
  });
});
