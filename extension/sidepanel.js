// Side panel chat logic — communicates with the sidecar server

const SIDECAR_URL = "http://127.0.0.1:3001";

const messagesEl = document.getElementById("messages");
const promptInput = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send-btn");
const statusEl = document.getElementById("status");
const contextBarEl = document.getElementById("context-bar");
const contextTextEl = document.getElementById("context-text");
const startupScreen = document.getElementById("startup-screen");
const reconnectBanner = document.getElementById("reconnect-banner");
const inputArea = document.getElementById("input-area");
const retryBtn = document.getElementById("retry-btn");
const bannerRetryBtn = document.getElementById("banner-retry-btn");
const copyCmdBtn = document.getElementById("copy-cmd-btn");
const emulatorOfflineBanner = document.getElementById("emulator-offline-banner");
const emulatorRetryBtn = document.getElementById("emulator-retry-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const historyBtn = document.getElementById("history-btn");
const historyDrawer = document.getElementById("history-drawer");
const historyList = document.getElementById("history-list");

let sessionId = null;
let isStreaming = false;
let currentContext = null; // Latest Data Explorer context
let autoRetryInterval = null;
let emulatorPollInterval = null;
let hasConnectedBefore = false; // Track if we've ever connected this session
let emulatorConnected = false; // Track emulator reachability
let historyDrawerOpen = false;

// --- Session history registry ---

async function getSessionHistory() {
  const stored = await chrome.storage.local.get(["sessionHistory"]);
  return stored.sessionHistory || [];
}

async function addToSessionHistory(id) {
  const history = await getSessionHistory();
  if (!history.includes(id)) {
    history.unshift(id); // newest first
    await chrome.storage.local.set({ sessionHistory: history });
  }
}

async function getSessionTitles() {
  const stored = await chrome.storage.local.get(["sessionTitles"]);
  return stored.sessionTitles || {};
}

async function setSessionTitle(id, title) {
  const titles = await getSessionTitles();
  if (!titles[id]) {
    titles[id] = title;
    await chrome.storage.local.set({ sessionTitles: titles });
  }
}

async function removeFromSessionHistory(id) {
  const history = await getSessionHistory();
  const updated = history.filter((h) => h !== id);
  const titles = await getSessionTitles();
  delete titles[id];
  await chrome.storage.local.set({ sessionHistory: updated, sessionTitles: titles });
}

// --- Initialization ---

async function init() {
  setStatus("Connecting...", "connecting");

  const ready = await waitForSidecar(5);

  if (ready) {
    await onSidecarConnected();
  } else {
    showStartupScreen();
    startAutoRetry();
  }

  // Load initial context from storage
  loadContext();
}

async function onSidecarConnected() {
  hasConnectedBefore = true;
  stopAutoRetry();
  hideStartupScreen();
  hideReconnectBanner();
  await checkStatus();
  await ensureSession();

  // Restore messages from SDK if chat is empty and we have a session
  if (messagesEl.children.length === 0 && sessionId) {
    try {
      const res = await fetch(`${SIDECAR_URL}/sessions/${sessionId}/messages`);
      if (res.ok) {
        const data = await res.json();
        const messages = data.messages || [];
        if (messages.length > 0) {
          for (const msg of messages) {
            addMessage(msg.role, msg.content);
          }
          scrollToBottom();
        }
      }
    } catch { /* ignore — will show welcome below */ }
  }

  // Show welcome message if still empty
  if (messagesEl.children.length === 0) {
    addMessage("assistant",
      "Describe what you need — I'll write the query, run it, and show you the results.\n\n" +
      "Try:\n" +
      '• "Find orders over $100 sorted by date"\n' +
      '• "Add 5 sample users with realistic data"\n' +
      '• "How many documents are in each container?"'
    );
  }

  startEmulatorPoll();
  if (emulatorConnected) promptInput.focus();
}

// --- Startup screen ---

function showStartupScreen() {
  startupScreen.style.display = "flex";
  messagesEl.style.display = "none";
  inputArea.style.display = "none";
  setStatus("Sidecar offline", "disconnected");
}

function hideStartupScreen() {
  startupScreen.style.display = "none";
  messagesEl.style.display = "flex";
  inputArea.style.display = "flex";
}

function showReconnectBanner() {
  reconnectBanner.style.display = "flex";
  setStatus("Disconnected", "disconnected");
}

function hideReconnectBanner() {
  reconnectBanner.style.display = "none";
}

function startAutoRetry() {
  stopAutoRetry();
  autoRetryInterval = setInterval(async () => {
    const ok = await isSidecarUp();
    if (ok) {
      await onSidecarConnected();
    }
  }, 5000);
}

function stopAutoRetry() {
  if (autoRetryInterval) {
    clearInterval(autoRetryInterval);
    autoRetryInterval = null;
  }
}

async function isSidecarUp() {
  try {
    const res = await fetch(`${SIDECAR_URL}/status`);
    return res.ok;
  } catch {
    return false;
  }
}

async function retryConnection() {
  setStatus("Connecting...", "connecting");
  const ok = await isSidecarUp();
  if (ok) {
    await onSidecarConnected();
  } else {
    if (hasConnectedBefore) {
      setStatus("Disconnected", "disconnected");
    } else {
      setStatus("Sidecar offline", "disconnected");
    }
  }
}

// --- Context bar ---

async function loadContext() {
  try {
    const stored = await chrome.storage.local.get(["explorerContext"]);
    if (stored.explorerContext) {
      updateContextBar(stored.explorerContext);
    }
  } catch { /* ignore */ }
}

function updateContextBar(context) {
  if (!context || (!context.database && !context.container && !context.endpoint)) {
    contextBarEl.style.display = "none";
    currentContext = null;
    return;
  }

  currentContext = context;
  let text = "";

  if (context.database && context.container) {
    text = `📂 ${context.database} › ${context.container}`;
  } else if (context.database) {
    text = `📂 ${context.database}`;
  } else if (context.container) {
    text = `📂 ${context.container}`;
  } else if (context.endpoint) {
    text = `🔗 ${context.endpoint.replace(/^https?:\/\//, "")}`;
  }

  contextTextEl.textContent = text;
  contextBarEl.style.display = "block";
}

// Listen for context changes from storage (driven by content script → service worker)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.explorerContext) {
    if (changes.explorerContext.newValue) {
      updateContextBar(changes.explorerContext.newValue);
    } else {
      updateContextBar(null);
    }
  }
});

async function waitForSidecar(maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isSidecarUp()) return true;
    await new Promise((r) => setTimeout(r, Math.min(300 * Math.pow(1.3, i), 1000)));
  }
  return false;
}

async function checkStatus() {
  try {
    const res = await fetch(`${SIDECAR_URL}/status`);
    const data = await res.json();
    if (data.emulatorConnected) {
      setStatus("Connected", "connected");
      setEmulatorAvailable(true);
    } else {
      setStatus("Emulator offline", "disconnected");
      setEmulatorAvailable(false);
    }
  } catch {
    if (hasConnectedBefore) {
      showReconnectBanner();
      startAutoRetry();
      stopEmulatorPoll();
    } else {
      showStartupScreen();
      startAutoRetry();
    }
  }
}

function setEmulatorAvailable(available) {
  emulatorConnected = available;
  if (available) {
    emulatorOfflineBanner.style.display = "none";
    inputArea.style.display = "flex";
  } else {
    inputArea.style.display = "none";
    emulatorOfflineBanner.style.display = "flex";
  }
}

function startEmulatorPoll() {
  stopEmulatorPoll();
  emulatorPollInterval = setInterval(() => checkStatus(), 5000);
}

function stopEmulatorPoll() {
  if (emulatorPollInterval) {
    clearInterval(emulatorPollInterval);
    emulatorPollInterval = null;
  }
}

async function ensureSession() {
  // Try to restore session from storage
  const stored = await chrome.storage.local.get(["sessionId"]);
  if (stored.sessionId) {
    sessionId = stored.sessionId;
    // Ensure it's in the registry
    await addToSessionHistory(sessionId);
    return;
  }

  try {
    const res = await fetch(`${SIDECAR_URL}/sessions`, { method: "POST" });
    const data = await res.json();
    sessionId = data.sessionId;
    await chrome.storage.local.set({ sessionId });
    await addToSessionHistory(sessionId);
  } catch (err) {
    console.error("Failed to create session:", err);
  }
}

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.className = `status status-${state}`;
}

// --- Message rendering ---

function addMessage(role, content) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  msg.innerHTML = `<div class="message-content">${formatContent(content)}</div>`;
  messagesEl.appendChild(msg);
  scrollToBottom();
  return msg;
}

function addToolIndicator(toolName) {
  const el = document.createElement("div");
  el.className = "tool-indicator";
  el.innerHTML = `<div class="spinner"></div> Running <code>${escapeHtml(toolName)}</code>...`;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function formatContent(text) {
  if (!text) return "";

  // Step 1: Extract code blocks before escaping (they get their own escaping)
  const codeBlocks = [];
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
    return placeholder;
  });

  const inlineCode = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `__INLINE_${inlineCode.length}__`;
    inlineCode.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // Step 2: Escape ALL remaining text to prevent XSS
  text = escapeHtml(text);

  // Step 3: Restore code blocks (already escaped internally)
  codeBlocks.forEach((block, i) => {
    text = text.replace(`__CODEBLOCK_${i}__`, block);
  });
  inlineCode.forEach((code, i) => {
    text = text.replace(`__INLINE_${i}__`, code);
  });

  // Step 4: Apply safe markdown transforms on escaped text
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Convert markdown tables
  text = convertMarkdownTables(text);

  // Line breaks to paragraphs
  text = text
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return text;
}

function convertMarkdownTables(text) {
  const tableRegex = /(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)+)/g;
  return text.replace(tableRegex, (_, header, separator, body) => {
    const headers = header.split("|").filter((c) => c.trim()).map((c) => c.trim());
    const rows = body.trim().split("\n").map((row) =>
      row.split("|").filter((c) => c.trim()).map((c) => c.trim())
    );

    let html = "<table><thead><tr>";
    headers.forEach((h) => (html += `<th>${escapeHtml(h)}</th>`));
    html += "</tr></thead><tbody>";
    rows.forEach((row) => {
      html += "<tr>";
      row.forEach((cell) => (html += `<td>${escapeHtml(cell)}</td>`));
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// --- Chat logic ---

async function sendMessage() {
  const prompt = promptInput.value.trim();
  if (!prompt || isStreaming) return;

  // Check sidecar is still up before sending
  if (!(await isSidecarUp())) {
    showReconnectBanner();
    startAutoRetry();
    return;
  }

  if (!sessionId) {
    await ensureSession();
    if (!sessionId) {
      addMessage("assistant", "⚠️ Cannot connect to sidecar. Make sure the sidecar is running.");
      return;
    }
  }

  // Show user message
  addMessage("user", escapeHtml(prompt));
  // Store first message as session title
  if (sessionId) setSessionTitle(sessionId, prompt);
  promptInput.value = "";
  promptInput.style.height = "auto";
  isStreaming = true;
  sendBtn.disabled = true;

  // Create assistant message placeholder with thinking indicator
  const assistantMsg = addMessage("assistant", "");
  const contentEl = assistantMsg.querySelector(".message-content");
  contentEl.innerHTML = '<div class="thinking-indicator"><span></span><span></span><span></span></div>';
  let fullContent = "";
  let currentToolEl = null;

  try {
    const chatBody = { sessionId, prompt };
    if (currentContext) chatBody.context = currentContext;

    const res = await fetch(`${SIDECAR_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody),
    });

    // If the server returns an error (e.g. stale session), handle it
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.error && errData.error.includes("not found")) {
        // Stale session — clear and retry once
        sessionId = null;
        await chrome.storage.local.remove(["sessionId"]);
        await ensureSession();
        if (sessionId) {
          const retryBody = { sessionId, prompt };
          if (currentContext) retryBody.context = currentContext;
          const retryRes = await fetch(`${SIDECAR_URL}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(retryBody),
          });
          if (retryRes.ok) {
            await processStream(retryRes, contentEl);
            return;
          }
        }
        contentEl.innerHTML = formatContent("⚠️ Session expired. Please try again.");
        return;
      }
    }

    await processStream(res, contentEl);
  } catch (err) {
    contentEl.innerHTML = formatContent(
      `⚠️ Failed to connect to sidecar: ${err.message}`
    );

    // Session might be stale — clear it so a new one is created next time
    sessionId = null;
    await chrome.storage.local.remove(["sessionId"]);

    // Sidecar may have gone down
    if (!(await isSidecarUp())) {
      showReconnectBanner();
      startAutoRetry();
    }
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    promptInput.focus();
  }
}

async function processStream(res, contentEl) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let currentToolEl = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr);

        if (event.type === "assistant.message_delta") {
          const delta = event.data?.deltaContent || "";
          if (!delta) continue;
          fullContent += delta;
          contentEl.innerHTML = formatContent(fullContent);
          scrollToBottom();
        } else if (event.type === "assistant.message") {
          const content = event.data?.content || "";
          if (!content) continue;
          fullContent = content;
          contentEl.innerHTML = formatContent(fullContent);
          scrollToBottom();
        } else if (event.type === "tool.execution_start") {
          // No UI indicator — tool calls complete too fast against the local emulator
        } else if (event.type === "tool.execution_complete") {
          // No-op
        } else if (event.type === "session.error") {
          fullContent += `\n\n⚠️ Error: ${event.data?.message || "Unknown error"}`;
          contentEl.innerHTML = formatContent(fullContent);
        } else if (event.type === "error") {
          fullContent += `\n\n⚠️ ${event.message || "Unknown error"}`;
          contentEl.innerHTML = formatContent(fullContent);
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

// --- History drawer ---

function toggleHistoryDrawer() {
  historyDrawerOpen = !historyDrawerOpen;
  if (historyDrawerOpen) {
    historyDrawer.style.display = "block";
    historyBtn.classList.add("active");
    loadHistoryDrawer();
  } else {
    historyDrawer.style.display = "none";
    historyBtn.classList.remove("active");
  }
}

function closeHistoryDrawer() {
  historyDrawerOpen = false;
  historyDrawer.style.display = "none";
  historyBtn.classList.remove("active");
}

async function loadHistoryDrawer() {
  const registry = await getSessionHistory();
  if (registry.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No past conversations</div>';
    return;
  }

  historyList.innerHTML = '<div class="history-empty">Loading...</div>';
  try {
    const [res, sessionTitles] = await Promise.all([
      fetch(`${SIDECAR_URL}/sessions`),
      getSessionTitles(),
    ]);
    const data = await res.json();
    const allSessions = data.sessions || [];

    // Use registry as source of truth; enrich with SDK metadata when available
    const sessionMap = new Map(allSessions.map((s) => [s.sessionId, s]));
    const ourSessions = registry.map((id) => sessionMap.get(id) ?? { sessionId: id, summary: null, modifiedTime: null });

    historyList.innerHTML = "";
    for (const s of ourSessions) {
      const item = document.createElement("div");
      item.className = `history-item${s.sessionId === sessionId ? " active" : ""}`;

      // Prefer locally stored title (first user message), fall back to "Conversation"
      const title = sessionTitles[s.sessionId] || "Conversation";
      const time = s.modifiedTime ? formatRelativeTime(s.modifiedTime) : "";

      item.innerHTML = `
        <div class="history-item-content">
          <div class="history-item-title">${escapeHtml(title)}</div>
          <div class="history-item-time">${time}</div>
        </div>
        <button class="history-delete-btn" title="Delete">✕</button>
      `;

      // Click to switch
      item.querySelector(".history-item-content").addEventListener("click", () => {
        switchToSession(s.sessionId);
      });

      // Delete button
      item.querySelector(".history-delete-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteSessionFromHistory(s.sessionId);
      });

      historyList.appendChild(item);
    }
  } catch (err) {
    console.error("Failed to load history:", err);
    // SDK unavailable — still render registry sessions with fallback metadata
    historyList.innerHTML = "";
    for (const id of registry) {
      const item = document.createElement("div");
      item.className = `history-item${id === sessionId ? " active" : ""}`;
      item.innerHTML = `
        <div class="history-item-content">
          <div class="history-item-title">${escapeHtml("Conversation")}</div>
          <div class="history-item-time"></div>
        </div>
        <button class="history-delete-btn" title="Delete">✕</button>
      `;
      item.querySelector(".history-item-content").addEventListener("click", () => {
        switchToSession(id);
      });
      item.querySelector(".history-delete-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteSessionFromHistory(id);
      });
      historyList.appendChild(item);
    }
  }
}

function formatRelativeTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// --- New chat ---

async function startNewChat() {
  closeHistoryDrawer();
  try {
    const res = await fetch(`${SIDECAR_URL}/sessions`, { method: "POST" });
    const data = await res.json();
    sessionId = data.sessionId;
    await chrome.storage.local.set({ sessionId });
    await addToSessionHistory(sessionId);

    // Clear messages and show welcome
    messagesEl.innerHTML = "";
    addMessage("assistant",
      "Describe what you need — I'll write the query, run it, and show you the results.\n\n" +
      "Try:\n" +
      '• "Find orders over $100 sorted by date"\n' +
      '• "Add 5 sample users with realistic data"\n' +
      '• "How many documents are in each container?"'
    );
    promptInput.focus();
  } catch (err) {
    console.error("Failed to create new chat:", err);
  }
}

// --- Switch session ---

async function switchToSession(targetSessionId) {
  if (targetSessionId === sessionId) {
    closeHistoryDrawer();
    return;
  }

  closeHistoryDrawer();
  sessionId = targetSessionId;
  await chrome.storage.local.set({ sessionId });

  // Clear messages and show loading
  messagesEl.innerHTML = "";
  const loadingMsg = addMessage("assistant", "Loading conversation...");

  try {
    const res = await fetch(`${SIDECAR_URL}/sessions/${targetSessionId}/messages`);
    if (!res.ok) {
      // Session no longer exists — remove from registry and start fresh
      await removeFromSessionHistory(targetSessionId);
      messagesEl.innerHTML = "";
      await startNewChat();
      return;
    }

    const data = await res.json();
    const messages = data.messages || [];

    messagesEl.innerHTML = "";

    if (messages.length === 0) {
      addMessage("assistant",
        "Describe what you need — I'll write the query, run it, and show you the results.\n\n" +
        "Try:\n" +
        '• "Find orders over $100 sorted by date"\n' +
        '• "Add 5 sample users with realistic data"\n' +
        '• "How many documents are in each container?"'
      );
    } else {
      for (const msg of messages) {
        addMessage(msg.role, msg.content);
      }
    }

    scrollToBottom();
  } catch (err) {
    console.error("Failed to load session messages:", err);
    messagesEl.innerHTML = "";
    addMessage("assistant", "⚠️ Failed to load conversation history.");
  }

  promptInput.focus();
}

// --- Delete session ---

async function deleteSessionFromHistory(targetSessionId) {
  try {
    await fetch(`${SIDECAR_URL}/sessions/${targetSessionId}`, { method: "DELETE" });
  } catch { /* best effort */ }

  await removeFromSessionHistory(targetSessionId);

  // If we deleted the active session, start a new chat
  if (targetSessionId === sessionId) {
    sessionId = null;
    await chrome.storage.local.remove(["sessionId"]);
    await startNewChat();
  }

  // Re-render drawer if open
  if (historyDrawerOpen) {
    await loadHistoryDrawer();
  }
}

// --- Event listeners ---

sendBtn.addEventListener("click", sendMessage);

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + "px";
});

// Retry buttons
retryBtn.addEventListener("click", retryConnection);
bannerRetryBtn.addEventListener("click", retryConnection);
emulatorRetryBtn.addEventListener("click", () => checkStatus());

// Session management buttons
newChatBtn.addEventListener("click", startNewChat);
historyBtn.addEventListener("click", toggleHistoryDrawer);

// Copy command to clipboard
copyCmdBtn.addEventListener("click", () => {
  navigator.clipboard.writeText("cd sidecar && npm start").then(() => {
    copyCmdBtn.textContent = "✅";
    setTimeout(() => { copyCmdBtn.textContent = "📋"; }, 1500);
  });
});

// Initialize
init();
