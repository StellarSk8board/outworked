import { Message, Session, SessionMeta } from "./types";
import { v4 as uuidv4 } from "uuid";

// ─── Electron IPC bridge ──────────────────────────────────────────

function getAPI(): {
  save: (session: Session) => Promise<{ ok: boolean }>;
  load: (
    agentId: string,
    sessionId: string,
  ) => Promise<{ ok: boolean; session?: Session }>;
  list: (agentId: string) => Promise<SessionMeta[]>;
  delete: (agentId: string, sessionId: string) => Promise<{ ok: boolean }>;
  search: (agentId: string, query: string) => Promise<SessionMeta[]>;
} | null {
  const w = window as unknown as { electronAPI?: { sessions?: unknown } };
  return (w.electronAPI?.sessions as ReturnType<typeof getAPI>) ?? null;
}

// ─── localStorage fallback keys ───────────────────────────────────

const LS_PREFIX = "outworked_session_";

function lsKey(agentId: string, sessionId: string) {
  return `${LS_PREFIX}${agentId}_${sessionId}`;
}

function lsIndexKey(agentId: string) {
  return `${LS_PREFIX}index_${agentId}`;
}

function lsGetIndex(agentId: string): SessionMeta[] {
  try {
    const raw = localStorage.getItem(lsIndexKey(agentId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function lsSaveIndex(agentId: string, index: SessionMeta[]) {
  localStorage.setItem(lsIndexKey(agentId), JSON.stringify(index));
}

// ─── Public API ───────────────────────────────────────────────────

export function generateTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\n/g, " ").trim();
  if (cleaned.length <= 50) return cleaned;
  const cut = cleaned.slice(0, 50);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + "…";
}

export function createSession(agentId: string, firstMessage?: string): Session {
  const now = Date.now();
  return {
    id: uuidv4(),
    agentId,
    title: firstMessage ? generateTitle(firstMessage) : "New conversation",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    messages: [],
  };
}

export async function saveSession(session: Session): Promise<boolean> {
  const updated: Session = {
    ...session,
    updatedAt: Date.now(),
    messageCount: session.messages.length,
  };

  const api = getAPI();
  if (api) {
    const result = await api.save(updated);
    return result.ok;
  }

  // localStorage fallback
  try {
    localStorage.setItem(
      lsKey(updated.agentId, updated.id),
      JSON.stringify(updated),
    );
    const index = lsGetIndex(updated.agentId);
    const meta: SessionMeta = {
      id: updated.id,
      agentId: updated.agentId,
      claudeSessionId: updated.claudeSessionId,
      title: updated.title,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      messageCount: updated.messageCount,
      totalCostUsd: updated.totalCostUsd,
    };
    const filtered = index.filter((m) => m.id !== updated.id);
    filtered.unshift(meta);
    lsSaveIndex(updated.agentId, filtered);
    return true;
  } catch {
    return false;
  }
}

export async function loadSession(
  agentId: string,
  sessionId: string,
): Promise<Session | null> {
  const api = getAPI();
  if (api) {
    const result = await api.load(agentId, sessionId);
    return result.ok ? (result.session ?? null) : null;
  }

  // localStorage fallback
  try {
    const raw = localStorage.getItem(lsKey(agentId, sessionId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function listSessions(agentId: string): Promise<SessionMeta[]> {
  const api = getAPI();
  if (api) {
    return api.list(agentId);
  }
  return lsGetIndex(agentId);
}

export async function deleteSession(
  agentId: string,
  sessionId: string,
): Promise<boolean> {
  const api = getAPI();
  if (api) {
    const result = await api.delete(agentId, sessionId);
    return result.ok;
  }

  try {
    localStorage.removeItem(lsKey(agentId, sessionId));
    const index = lsGetIndex(agentId).filter((m) => m.id !== sessionId);
    lsSaveIndex(agentId, index);
    return true;
  } catch {
    return false;
  }
}

export async function searchSessions(
  agentId: string,
  query: string,
): Promise<SessionMeta[]> {
  const api = getAPI();
  if (api) {
    return api.search(agentId, query);
  }

  // localStorage fallback: search index titles only
  const q = query.toLowerCase();
  return lsGetIndex(agentId).filter((m) => m.title.toLowerCase().includes(q));
}

/**
 * Migrate an agent's in-memory history into a new persisted session.
 * Returns the new session, or null if there was nothing to migrate.
 */
export async function migrateHistoryToSession(
  agentId: string,
  history: Message[],
  claudeSessionId?: string,
): Promise<Session | null> {
  if (!history || history.length === 0) return null;

  const firstUserMsg = history.find((m) => m.role === "user");
  const session = createSession(agentId, firstUserMsg?.content);
  session.messages = history;
  session.claudeSessionId = claudeSessionId;
  session.createdAt = history[0].timestamp || Date.now();
  session.updatedAt = history[history.length - 1].timestamp || Date.now();
  session.messageCount = history.length;

  await saveSession(session);
  return session;
}
