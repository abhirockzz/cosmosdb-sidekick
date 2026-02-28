// Service worker: handles extension lifecycle, side panel, and context relay

let dataExplorerTabId = null; // Track which tab has the Data Explorer

// --- Side panel behavior ---

// Open side panel on action icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("Failed to set panel behavior:", error));

// Listen for Data Explorer detection from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DATA_EXPLORER_DETECTED" && sender.tab?.id) {
    dataExplorerTabId = sender.tab.id;
    // Auto-open the side panel at the window level so it persists across tab switches
    chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {
      // open() may not be available in all Chrome versions — fall back to just enabling
      chrome.sidePanel.setOptions({
        path: "sidepanel.html",
        enabled: true,
      });
    });
    // Data Explorer detected — side panel opened
  }

  if (message.type === "CONTEXT_UPDATE" && message.context) {
    // Store context from the Data Explorer content script
    chrome.storage.local.set({
      explorerContext: {
        ...message.context,
        timestamp: Date.now(),
      },
    });
  }

  return false;
});

// Clear context when the Data Explorer tab is closed or navigates away
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === dataExplorerTabId) {
    dataExplorerTabId = null;
    chrome.storage.local.remove(["explorerContext"]);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === dataExplorerTabId && changeInfo.url) {
    // Tab navigated — check if it's still a Data Explorer page
    const url = changeInfo.url.toLowerCase();
    const isStillDataExplorer =
      (url.includes("localhost") || url.includes("127.0.0.1")) &&
      (url.includes("_explorer") || url.includes("dataexplorer") || url.includes("cosmos") || url.includes(":8081"));
    if (!isStillDataExplorer) {
      dataExplorerTabId = null;
      // Keep explorerContext — the emulator is still running and the side panel
      // conversation should persist even when navigating away
    }
  }
});
