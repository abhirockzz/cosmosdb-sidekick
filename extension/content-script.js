// Content script: detects Data Explorer pages and extracts context
// (selected database, container) for the side panel.

(function () {
  function isDataExplorerPage() {
    const url = window.location.href.toLowerCase();
    if (url.includes("localhost") || url.includes("127.0.0.1")) {
      if (
        url.includes("_explorer") ||
        url.includes("explorer.html") ||
        url.includes("dataexplorer") ||
        url.includes("cosmos") ||
        document.title.toLowerCase().includes("data explorer") ||
        document.title.toLowerCase().includes("cosmos")
      ) {
        return true;
      }
      if (url.includes(":8081")) {
        return true;
      }
    }
    return false;
  }

  if (!isDataExplorerPage()) return;

  chrome.runtime.sendMessage({ type: "DATA_EXPLORER_DETECTED" });

  // --- Context extraction ---

  // Extract emulator endpoint from page URL (protocol + host + port)
  function getEndpoint() {
    return window.location.origin;
  }

  // The emulator Data Explorer uses Fluent UI TreeItems with these attributes:
  //   data-test="TreeNodeContainer:DbName" (level 1 = database)
  //   data-test="TreeNodeContainer:DbName/containerName" (level 2 = container)
  //   data-fui-tree-item-value="DbName/containerName"
  //   aria-level="1|2|3", aria-expanded="true|false"
  // There is NO selectedItem class or aria-selected on tree items.
  //
  // The active context is best determined from the selected tab:
  //   [role="tab"][aria-selected="true"] .tabNavText → e.g. "movies.Items" or "movies.Query 1"
  // Combined with the expanded database node in the tree sidebar.

  function extractPathFromTreeValue(rawValue) {
    const raw = (rawValue || "").trim();
    if (!raw) return null;
    const value = raw.startsWith("TreeNodeContainer:") ? raw.replace("TreeNodeContainer:", "") : raw;
    const slashIdx = value.indexOf("/");
    if (slashIdx <= 0 || slashIdx === value.length - 1) return null;

    const database = value.slice(0, slashIdx).trim();
    const container = value.slice(slashIdx + 1).trim();
    if (!database || !container || database === "Home") return null;
    return { database, container };
  }

  function getKnownContainerPaths() {
    const byPath = new Map();
    const addPath = (raw) => {
      const parsed = extractPathFromTreeValue(raw);
      if (!parsed) return;
      byPath.set(`${parsed.database}/${parsed.container}`, parsed);
    };

    const pathNodes = document.querySelectorAll('[data-test^="TreeNodeContainer:"], [data-fui-tree-item-value]');
    for (const node of pathNodes) {
      addPath(node.getAttribute("data-test"));
      addPath(node.getAttribute("data-fui-tree-item-value"));
    }

    return Array.from(byPath.values());
  }

  function resolveContainerFromPrefix(prefix, hintedDatabase) {
    const normalizedPrefix = (prefix || "").toLowerCase();
    if (!normalizedPrefix) return null;

    const matches = getKnownContainerPaths().filter((path) =>
      path.container.toLowerCase().startsWith(normalizedPrefix)
    );
    if (matches.length === 0) return null;

    if (hintedDatabase) {
      const dbMatches = matches.filter((path) => path.database === hintedDatabase);
      if (dbMatches.length === 1) return dbMatches[0];
      if (dbMatches.length > 1) return null;
    }

    return matches.length === 1 ? matches[0] : null;
  }

  function parseContextFromTabCandidate(candidate) {
    const text = (candidate || "").trim();
    if (!text) {
      return {
        database: null,
        container: null,
        isHomeTab: false,
        containerUncertain: false,
        containerPrefix: null,
      };
    }
    if (text === "Home") {
      return {
        database: null,
        container: null,
        isHomeTab: true,
        containerUncertain: false,
        containerPrefix: null,
      };
    }

    // Handle tab title attribute format: "database>container>tabType"
    if (text.includes(">")) {
      const parts = text.split(">").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return {
          database: parts[0],
          container: parts[1],
          isHomeTab: false,
          containerUncertain: false,
          containerPrefix: null,
        };
      }
    }

    let database = null;
    let container = null;
    let containerUncertain = false;
    let containerPrefix = null;

    const slashParts = text
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (slashParts.length >= 2) {
      database = slashParts[0];
      const containerPart = slashParts[1];
      const dotIdx = containerPart.indexOf(".");
      container = (dotIdx > 0 ? containerPart.substring(0, dotIdx) : containerPart).trim();
    } else {
      const dotIdx = text.indexOf(".");
      if (dotIdx > 0) {
        container = text.substring(0, dotIdx).trim();
      } else if (!text.includes(" ")) {
        container = text;
      }
    }

    if (container && (container.includes("...") || container.includes("…"))) {
      containerPrefix = container.split("...")[0].split("…")[0].trim() || null;
      container = null;
      containerUncertain = true;
    }

    return { database, container, isHomeTab: false, containerUncertain, containerPrefix };
  }

  function getSelectedDatabaseAndContainer() {
    let database = null;
    let container = null;
    let hasActiveTab = false;
    let isHomeTab = false;
    let containerUncertain = false;
    let containerPrefix = null;
    let tabKey = null;

    // The active tab is the only reliable signal for what the user is working with.
    // Tab text format: "containerName.Items", "containerName.Query 1", "containerName.Settings"
    // If the active tab is "Home" or absent, the user isn't focused on any specific data.
    const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
    if (!selectedTab) {
      return {
        database,
        container,
        hasActiveTab,
        isHomeTab,
        containerUncertain,
        containerPrefix,
        tabKey,
      };
    }
    hasActiveTab = true;

    const tabTextEl = selectedTab.querySelector(".tabNavText");
    const tabText = ((tabTextEl || selectedTab).textContent || "").trim();
    const keyCandidates = [
      selectedTab.getAttribute("data-fui-tab-value"),
      selectedTab.getAttribute("data-tab-key"),
      selectedTab.getAttribute("aria-controls"),
      selectedTab.id,
    ];
    const labelCandidates = [
      selectedTab.getAttribute("aria-label"),
      selectedTab.getAttribute("title"),
      tabTextEl?.getAttribute("title"),
      tabText,
    ];

    tabKey = keyCandidates.find((value) => !!value?.trim()) || null;

    for (const candidate of [...keyCandidates, ...labelCandidates]) {
      const parsed = parseContextFromTabCandidate(candidate);
      if (parsed.isHomeTab) {
        isHomeTab = true;
        break;
      }
      if (parsed.database && !database) {
        database = parsed.database;
      }
      if (parsed.container) {
        container = parsed.container;
      }
      if (parsed.containerUncertain) {
        containerUncertain = true;
      }
      if (parsed.containerPrefix && !containerPrefix) {
        containerPrefix = parsed.containerPrefix;
      }
      if (database && container) break;
    }

    if (!container && containerPrefix) {
      const resolved = resolveContainerFromPrefix(containerPrefix, database);
      if (resolved) {
        container = resolved.container;
        database = database || resolved.database;
        containerUncertain = false;
      }
    }

    if (isHomeTab || !container) {
      return {
        database,
        container,
        hasActiveTab,
        isHomeTab,
        containerUncertain,
        containerPrefix,
        tabKey,
      };
    }

    // Find the parent database by looking for the container in expanded tree items.
    // When multiple expanded databases contain a container with the same name,
    // disambiguate using tree selection signals (aria-current, tabindex, expanded state).
    const dbNodes = document.querySelectorAll(
      '[role="treeitem"][aria-level="1"][aria-expanded="true"]'
    );
    const matchingDatabases = [];
    for (const node of dbNodes) {
      const val = node.getAttribute("data-fui-tree-item-value");
      if (val && val !== "Home") {
        const containerNode = node.querySelector(
          `[data-fui-tree-item-value="${val}/${container}"]`
        );
        if (containerNode) {
          // Check multiple signals that indicate this container is the active one:
          // - aria-current on the container or any of its descendants
          // - tabindex="0" (Fluent UI sets this on the focused/active tree item)
          // - aria-expanded on the container sub-tree (Items/Settings visible)
          const hasCurrent =
            containerNode.matches('[aria-current]') ||
            containerNode.querySelector('[aria-current]') !== null;
          const hasFocus =
            containerNode.matches('[tabindex="0"]') ||
            containerNode.querySelector('[tabindex="0"]') !== null;
          const isContainerExpanded =
            containerNode.getAttribute("aria-expanded") === "true";
          matchingDatabases.push({
            database: val,
            active: hasCurrent || hasFocus,
            expanded: isContainerExpanded,
          });
        }
      }
    }
    if (matchingDatabases.length === 1) {
      database = matchingDatabases[0].database;
    } else if (matchingDatabases.length > 1) {
      // Prefer the database whose container has an active/focused indicator
      const activeMatches = matchingDatabases.filter((m) => m.active);
      if (activeMatches.length === 1) {
        database = activeMatches[0].database;
      } else {
        // Fall back to expanded state (only one container sub-tree open)
        const expandedMatches = matchingDatabases.filter((m) => m.expanded);
        if (expandedMatches.length === 1) {
          database = expandedMatches[0].database;
        }
      }
      // If still ambiguous, leave database unset so downstream fallbacks
      // don't pick the wrong one.
    }

    // Fallback: find the container via data-test attribute even if db isn't expanded
    if (!database && container) {
      const matches = Array.from(
        document.querySelectorAll(`[data-test^="TreeNodeContainer:"][data-test$="/${container}"]`)
      );
      if (matches.length === 1) {
        const path = matches[0].getAttribute("data-test").replace("TreeNodeContainer:", "");
        database = path.split("/")[0];
      }
    }

    return {
      database,
      container,
      hasActiveTab,
      isHomeTab,
      containerUncertain,
      containerPrefix,
      tabKey,
    };
  }

  // Build and send context, only when it changes
  let lastContextJson = "";
  let lastStableContext = null;
  const knownContainerDatabase = new Map();
  const knownTabContext = new Map();

  function sendContextUpdate() {
    const { database, container, hasActiveTab, isHomeTab, containerUncertain, tabKey } =
      getSelectedDatabaseAndContainer();
    const endpoint = getEndpoint();
    let resolvedDatabase = database;
    let resolvedContainer = container;
    let contextResolved = !!(resolvedDatabase && resolvedContainer);

    if (!contextResolved && hasActiveTab && tabKey) {
      const knownTab = knownTabContext.get(tabKey);
      if (knownTab?.database && knownTab?.container) {
        resolvedDatabase = knownTab.database;
        resolvedContainer = knownTab.container;
        contextResolved = true;
      }
    }

    // Preserve context through UI-only changes when container identity is known.
    if (!contextResolved && resolvedContainer && !resolvedDatabase && !containerUncertain) {
      const knownDatabase = knownContainerDatabase.get(resolvedContainer);
      if (knownDatabase) {
        resolvedDatabase = knownDatabase;
        contextResolved = true;
      } else if (tabKey && lastStableContext?.tabKey === tabKey) {
        resolvedDatabase = lastStableContext.database;
        contextResolved = !!(resolvedDatabase && resolvedContainer);
      } else if (!tabKey && lastStableContext?.container === resolvedContainer) {
        resolvedDatabase = lastStableContext.database;
        contextResolved = !!(resolvedDatabase && resolvedContainer);
      }
    }

    // During transient re-renders, keep the last stable context instead of downgrading to endpoint-only.
    if (!contextResolved && !hasActiveTab && lastStableContext?.database && lastStableContext?.container) {
      resolvedDatabase = lastStableContext.database;
      resolvedContainer = lastStableContext.container;
      contextResolved = true;
    }

    if (isHomeTab) {
      lastStableContext = null;
    } else if (contextResolved) {
      const stableTabKey = tabKey || `${resolvedDatabase}/${resolvedContainer}`;
      lastStableContext = {
        database: resolvedDatabase,
        container: resolvedContainer,
        tabKey: stableTabKey,
      };
      const existingDatabase = knownContainerDatabase.get(resolvedContainer);
      if (existingDatabase === undefined) {
        knownContainerDatabase.set(resolvedContainer, resolvedDatabase);
      } else if (existingDatabase !== resolvedDatabase) {
        knownContainerDatabase.set(resolvedContainer, null);
      }
      knownTabContext.set(stableTabKey, {
        database: resolvedDatabase,
        container: resolvedContainer,
      });
    }

    const displayContainer = !contextResolved && !containerUncertain ? resolvedContainer : null;
    const context = {
      endpoint,
      database: contextResolved ? resolvedDatabase : null,
      container: contextResolved ? resolvedContainer : displayContainer,
      contextResolved,
    };
    const json = JSON.stringify(context);

    if (json === lastContextJson) return;
    lastContextJson = json;

    chrome.runtime.sendMessage({ type: "CONTEXT_UPDATE", context });
  }

  // Send initial context after a short delay (let the page render)
  setTimeout(sendContextUpdate, 1500);

  // Observe DOM mutations to detect navigation and selection changes
  const observer = new MutationObserver(() => {
    // Debounce: wait for DOM to settle
    clearTimeout(observer._debounceTimer);
    observer._debounceTimer = setTimeout(sendContextUpdate, 300);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "data-test", "aria-selected"],
  });
})();
