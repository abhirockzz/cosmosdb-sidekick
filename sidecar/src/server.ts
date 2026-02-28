import express from "express";
import cors from "cors";
import { checkEmulatorConnection } from "./cosmos.js";
import { createSession, sendMessage, destroySession, hasSession, listAllSessions, getSessionMessages } from "./copilot.js";
import type { SessionEvent } from "@github/copilot-sdk";

const app = express();
const PORT = 3001;
const HOST = "127.0.0.1"; // localhost only — no network exposure

// CORS: lock to a single Chrome extension origin after first request
let allowedExtensionOrigin: string | null = null;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        // Same-origin requests (no Origin header)
        callback(null, true);
      } else if (origin.startsWith("chrome-extension://")) {
        if (!allowedExtensionOrigin) {
          // First extension request — register this as the allowed origin
          allowedExtensionOrigin = origin;
          console.error(`🔒 CORS locked to extension: ${origin}`);
        }
        if (origin === allowedExtensionOrigin) {
          callback(null, true);
        } else {
          callback(new Error(`CORS rejected: ${origin} is not the registered extension`));
        }
      } else {
        callback(new Error("CORS not allowed"));
      }
    },
  })
);

app.use(express.json());

// Health check — also verifies emulator connectivity
app.get("/status", async (_req, res) => {
  const emulatorConnected = await checkEmulatorConnection();
  res.json({
    status: "ok",
    emulatorConnected,
    timestamp: new Date().toISOString(),
  });
});

// Create a new Copilot session
app.post("/sessions", async (_req, res) => {
  try {
    const sessionId = await createSession();
    res.json({ sessionId });
  } catch (error: any) {
    console.error("Failed to create session:", error);
    res.status(500).json({ error: error.message });
  }
});

// List all sessions
app.get("/sessions", async (_req, res) => {
  try {
    const sessions = await listAllSessions();
    res.json({ sessions });
  } catch (error: any) {
    console.error("Failed to list sessions:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a session
app.get("/sessions/:sessionId/messages", async (req, res) => {
  try {
    const messages = await getSessionMessages(req.params.sessionId);
    res.json({ messages });
  } catch (error: any) {
    console.error("Failed to get session messages:", error);
    res.status(404).json({ error: error.message });
  }
});

// Chat endpoint — streams responses via SSE
app.post("/chat", async (req, res) => {
  const { sessionId, prompt, context } = req.body;

  if (!sessionId || !prompt) {
    res.status(400).json({ error: "sessionId and prompt are required" });
    return;
  }

  if (!(await hasSession(sessionId))) {
    res.status(404).json({ error: `Session ${sessionId} not found. Create a session first.` });
    return;
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    await sendMessage(sessionId, prompt, context, (event: SessionEvent) => {
      // Stream relevant events to the client
      const eventType = event.type;

      if (
        eventType === "assistant.message_delta" ||
        eventType === "assistant.message" ||
        eventType === "assistant.reasoning_delta" ||
        eventType === "assistant.reasoning" ||
        eventType === "tool.execution_start" ||
        eventType === "tool.execution_complete" ||
        eventType === "session.error"
      ) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });

    // Signal completion
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("Chat error:", error);
    res.write(
      `data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`
    );
    res.end();
  }
});

// Destroy a session
app.delete("/sessions/:sessionId", async (req, res) => {
  try {
    await destroySession(req.params.sessionId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.error(`🚀 Cosmos Explorer sidecar running at http://${HOST}:${PORT}`);
  console.error(`   Connecting to emulator at ${process.env.COSMOS_EMULATOR_ENDPOINT || "http://localhost:8081"}`);
  console.error(`   Press Ctrl+C to stop.`);
});

server.on("error", async (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    // Another sidecar is already running — check if it's healthy
    try {
      const res = await fetch(`http://${HOST}:${PORT}/status`);
      if (res.ok) {
        console.error(`Sidecar already running on port ${PORT} — reusing it.`);
        process.exit(0);
      }
    } catch {
      // Not our sidecar — can't recover
    }
    console.error(`Port ${PORT} is in use by another process. Cannot start.`);
    process.exit(1);
  } else {
    console.error("Server error:", err);
    process.exit(1);
  }
});
