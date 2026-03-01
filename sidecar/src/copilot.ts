import { CopilotClient, approveAll, type SessionEvent, type ModelInfo } from "@github/copilot-sdk";
import { getTools } from "./tools.js";

export const DEFAULT_MODEL = "gpt-4.1";

export function validateModel(requested: string, availableIds: string[]): string {
  if (!availableIds.includes(requested)) {
    throw new Error(
      `Model "${requested}" is not available. Available models: ${availableIds.join(", ")}`
    );
  }
  return requested;
}

async function resolveModel(): Promise<string> {
  const requested = process.env.COPILOT_MODEL || DEFAULT_MODEL;
  const c = await getClient();
  const models: ModelInfo[] = await c.listModels();
  return validateModel(requested, models.map((m) => m.id));
}

const SYSTEM_PROMPT = `You are a Cosmos DB data exploration assistant. You help users explore data in their local Cosmos DB emulator using natural language.

Rules:
- ALWAYS use the provided tools to query actual data — never make up or hallucinate results.
- When answering a question, first discover the schema by listing databases, containers, and sampling documents if you haven't already.
- Show the SQL query you used alongside the results.
- Format tabular data as markdown tables when appropriate.
- If a query fails, explain the error and try to fix it.
- You can only run SELECT queries for reading data. To insert or update documents, use the upsert_items tool.
- When generating test data, always include an 'id' field and the container's partition key field in each document.
- Keep responses concise and focused on the data.

Write-safety rules (apply before every upsert_items call):
- Determine the correct target container from the user's request. If the user says "add products", the target is the products container, regardless of which container is shown in the ambient context.
- If the user's intent implies a different container than the ambient context, use the container that matches the user's intent.
- Before writing, sample a few documents from the target container to verify your document shape matches the existing schema (field names, partition key).
- If the upsert_items response includes warnings (e.g. missing partition key), stop and inform the user — do not silently continue.
- After a successful write, run a SELECT query against the target container to verify the data landed correctly, and show the results to the user.`;

let client: CopilotClient | null = null;

// Session store: sessionId -> CopilotSession
const sessions = new Map<string, any>();

// Shared session config for create and resume
function getSessionConfig(model: string) {
  return {
    model,
    onPermissionRequest: approveAll,
    systemMessage: {
      mode: "append" as const,
      content: SYSTEM_PROMPT,
    },
    tools: getTools(),
    streaming: true,
  };
}

export async function getClient(): Promise<CopilotClient> {
  if (!client) {
    client = new CopilotClient();
    await client.start();
  }
  return client;
}

export async function createSession(): Promise<string> {
  const c = await getClient();
  const model = await resolveModel();
  const session = await c.createSession(getSessionConfig(model));
  sessions.set(session.sessionId, session);
  return session.sessionId;
}

// Resume a session from the SDK (e.g., after sidecar restart)
async function resumeExistingSession(sessionId: string): Promise<any> {
  const c = await getClient();
  const model = await resolveModel();
  const session = await c.resumeSession(sessionId, getSessionConfig(model));
  sessions.set(session.sessionId, session);
  return session;
}

export async function hasSession(sessionId: string): Promise<boolean> {
  if (sessions.has(sessionId)) return true;
  // Try to resume from SDK
  try {
    await resumeExistingSession(sessionId);
    return true;
  } catch {
    return false;
  }
}

export interface SessionInfo {
  sessionId: string;
  summary?: string;
  startTime: string;
  modifiedTime: string;
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const c = await getClient();
  try {
    const metadata = await c.listSessions();
    return metadata.map((m: any) => ({
      sessionId: m.sessionId,
      summary: m.summary,
      startTime: m.startTime instanceof Date ? m.startTime.toISOString() : String(m.startTime),
      modifiedTime: m.modifiedTime instanceof Date ? m.modifiedTime.toISOString() : String(m.modifiedTime),
    }));
  } catch (err) {
    console.error("listSessions failed:", err);
    return [];
  }
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  // Ensure session is in memory
  if (!sessions.has(sessionId)) {
    await resumeExistingSession(sessionId);
  }
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const events: SessionEvent[] = await session.getMessages();
  const messages: ChatMessage[] = [];

  for (const event of events) {
    if (event.type === "user.message") {
      let content: string = (event as any).data?.content || "";
      // Strip context prefix that was prepended before sending to the SDK
      if (content.startsWith("[Current Data Explorer context")) {
        const sep = content.indexOf("\n\n");
        if (sep !== -1) content = content.slice(sep + 2);
      }
      messages.push({
        role: "user",
        content,
        timestamp: (event as any).timestamp,
      });
    } else if (event.type === "assistant.message") {
      const content = (event as any).data?.content || "";
      if (content) {
        messages.push({
          role: "assistant",
          content,
          timestamp: (event as any).timestamp,
        });
      }
    }
  }
  return messages;
}

export interface ExplorerContext {
  endpoint?: string;
  database?: string;
  container?: string;
  contextResolved?: boolean;
}

export function buildContextPrefix(context: ExplorerContext): string {
  const parts: string[] = [];
  const isResolved =
    context.contextResolved === true ||
    (context.contextResolved !== false && !!(context.database && context.container));
  if (context.endpoint) parts.push(`Emulator endpoint: ${context.endpoint}`);
  if (isResolved) {
    if (context.database) parts.push(`Database: ${context.database}`);
    if (context.container) parts.push(`Container: ${context.container}`);
  } else {
    parts.push(
      "Data Explorer selection unresolved: do not assume database/container defaults; ask for or verify target before writes."
    );
  }
  if (parts.length === 0) return "";

  return `[Current Data Explorer context — use as default for reads. For writes, only use if the user's request doesn't imply a different container.]\n${parts.join("\n")}\n\n`;
}

export async function sendMessage(
  sessionId: string,
  prompt: string,
  context: ExplorerContext | undefined,
  onEvent: (event: SessionEvent) => void
): Promise<void> {
  // Auto-resume if not in memory
  if (!sessions.has(sessionId)) {
    await resumeExistingSession(sessionId);
  }
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found. Create a session first.`);
  }

  // Prepend context as ambient hint if available
  const contextPrefix = context ? buildContextPrefix(context) : "";
  const enrichedPrompt = contextPrefix ? `${contextPrefix}${prompt}` : prompt;

  // Subscribe to events for this message
  const unsubscribe = session.on((event: SessionEvent) => {
    onEvent(event);
  });

  try {
    await session.sendAndWait({ prompt: enrichedPrompt });
  } finally {
    unsubscribe();
  }
}

export async function destroySession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (session) {
    await session.destroy();
    sessions.delete(sessionId);
  }
}

export async function stopClient(): Promise<void> {
  if (client) {
    await client.stop();
    client = null;
  }
}
