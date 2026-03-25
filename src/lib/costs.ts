// ─── Cost & Token Tracking ───────────────────────────────────────
//
// Persists cost records to SQLite via Electron IPC. Each record captures a
// single Claude Code interaction (one sendMessage or ClaudeCodePanel round-trip).

export interface CostRecord {
  id: string;
  agentId: string;
  agentName: string;
  sessionId?: string;
  timestamp: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentBudget {
  agentId: string;
  dailyLimitUsd?: number;
  totalLimitUsd?: number;
}

export interface CostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  recordCount: number;
}

export interface AgentCostSummary extends CostSummary {
  agentId: string;
  agentName: string;
}

export interface DailyCostSummary extends CostSummary {
  date: string; // YYYY-MM-DD
}

// ─── IPC bridge ─────────────────────────────────────────────────

function getCostAPI() {
  const w = window as unknown as { electronAPI?: { db?: Record<string, unknown> } };
  const db = w.electronAPI?.db;
  if (!db) return null;
  return db as {
    costAddRecord: (record: CostRecord) => Promise<void>;
    costGetAll: () => Promise<CostRecord[]>;
    costGetByAgent: (agentId: string) => Promise<CostRecord[]>;
    costGetSince: (sinceMs: number) => Promise<CostRecord[]>;
    costClear: () => Promise<void>;
    costGetCumulative: (sessionKey: string) => Promise<{ cost: number; input_tokens: number; output_tokens: number } | null>;
    costSetCumulative: (sessionKey: string, cost: number, inputTokens: number, outputTokens: number) => Promise<void>;
    costDeleteCumulative: (sessionKey: string) => Promise<void>;
    costGetBudgets: () => Promise<AgentBudget[]>;
    costSetBudget: (agentId: string, dailyLimitUsd?: number, totalLimitUsd?: number) => Promise<void>;
    costRecordDelta: (
      sessionKey: string,
      record: { id: string; agentId: string; agentName: string; sessionId?: string; timestamp: number },
      cumulativeCost: number,
      cumulativeInputTokens: number,
      cumulativeOutputTokens: number,
    ) => Promise<CostRecord | null>;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function toDateString(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Cumulative → Delta tracking ─────────────────────────────────

/**
 * Record a cost from Claude Code's cumulative total_cost_usd.
 * Automatically computes the delta from the last known value for this session.
 */
export async function addCumulativeCost(
  agentId: string,
  agentName: string,
  cumulativeCost: number,
  cumulativeInputTokens: number,
  cumulativeOutputTokens: number,
  sessionKey: string,
): Promise<CostRecord | null> {
  const api = getCostAPI();
  if (!api) return null;

  // Single atomic IPC call: computes delta, updates cumulative state, and
  // inserts the cost record inside one SQLite transaction.
  const record = {
    id: String(nextId++),
    agentId,
    agentName,
    sessionId: sessionKey,
    timestamp: Date.now(),
  };
  return api.costRecordDelta(
    sessionKey,
    record,
    cumulativeCost,
    cumulativeInputTokens,
    cumulativeOutputTokens,
  );
}

/** Reset cumulative tracking for a session (call when session is cleared). */
export async function resetCumulativeSession(sessionKey: string): Promise<void> {
  const api = getCostAPI();
  if (api) await api.costDeleteCumulative(sessionKey);
}

// ─── Public API ──────────────────────────────────────────────────

let nextId = Date.now();

export async function addCostRecord(
  agentId: string,
  agentName: string,
  costUsd: number,
  inputTokens: number,
  outputTokens: number,
  sessionId?: string,
): Promise<CostRecord> {
  const record: CostRecord = {
    id: String(nextId++),
    agentId,
    agentName,
    sessionId,
    timestamp: Date.now(),
    costUsd,
    inputTokens,
    outputTokens,
  };
  const api = getCostAPI();
  if (api) {
    await api.costAddRecord(record);
  }
  return record;
}

export async function getAllRecords(): Promise<CostRecord[]> {
  const api = getCostAPI();
  return api ? api.costGetAll() : [];
}

export async function getRecordsByAgent(agentId: string): Promise<CostRecord[]> {
  const api = getCostAPI();
  return api ? api.costGetByAgent(agentId) : [];
}

export async function getRecordsSince(sinceMs: number): Promise<CostRecord[]> {
  const api = getCostAPI();
  return api ? api.costGetSince(sinceMs) : [];
}

// ─── Aggregations ────────────────────────────────────────────────

function summarize(records: CostRecord[]): CostSummary {
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const r of records) {
    totalCostUsd += r.costUsd;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
  }
  return {
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    recordCount: records.length,
  };
}

export async function getTotalSummary(): Promise<CostSummary> {
  return summarize(await getAllRecords());
}

export async function getTodaySummary(): Promise<CostSummary> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return summarize(await getRecordsSince(startOfDay.getTime()));
}

export async function getPerAgentSummary(): Promise<AgentCostSummary[]> {
  const records = await getAllRecords();
  const byAgent = new Map<string, CostRecord[]>();
  for (const r of records) {
    const arr = byAgent.get(r.agentId) || [];
    arr.push(r);
    byAgent.set(r.agentId, arr);
  }
  const result: AgentCostSummary[] = [];
  for (const [agentId, recs] of byAgent) {
    const s = summarize(recs);
    result.push({ agentId, agentName: recs[0].agentName, ...s });
  }
  result.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  return result;
}

export async function getDailySummaries(days = 7): Promise<DailyCostSummary[]> {
  const cutoff = Date.now() - days * 86400000;
  const records = (await getAllRecords()).filter((r) => r.timestamp >= cutoff);
  const byDay = new Map<string, CostRecord[]>();
  for (const r of records) {
    const d = toDateString(r.timestamp);
    const arr = byDay.get(d) || [];
    arr.push(r);
    byDay.set(d, arr);
  }

  const result: DailyCostSummary[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = toDateString(d.getTime());
    const recs = byDay.get(key) || [];
    result.push({ date: key, ...summarize(recs) });
  }
  return result;
}

// ─── Budgets ─────────────────────────────────────────────────────

export async function loadBudgets(): Promise<AgentBudget[]> {
  const api = getCostAPI();
  return api ? api.costGetBudgets() : [];
}

export async function setBudget(
  agentId: string,
  dailyLimitUsd?: number,
  totalLimitUsd?: number,
): Promise<void> {
  const api = getCostAPI();
  if (api) await api.costSetBudget(agentId, dailyLimitUsd, totalLimitUsd);
}

export interface BudgetStatus {
  agentId: string;
  dailySpent: number;
  dailyLimit?: number;
  totalSpent: number;
  totalLimit?: number;
  dailyExceeded: boolean;
  totalExceeded: boolean;
}

export async function checkBudget(agentId: string): Promise<BudgetStatus> {
  const budgets = await loadBudgets();
  const budget = budgets.find((b) => b.agentId === agentId);
  const allRecords = await getRecordsByAgent(agentId);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayRecords = allRecords.filter(
    (r) => r.timestamp >= startOfDay.getTime(),
  );

  const dailySpent = todayRecords.reduce((s, r) => s + r.costUsd, 0);
  const totalSpent = allRecords.reduce((s, r) => s + r.costUsd, 0);

  return {
    agentId,
    dailySpent,
    dailyLimit: budget?.dailyLimitUsd,
    totalSpent,
    totalLimit: budget?.totalLimitUsd,
    dailyExceeded: budget?.dailyLimitUsd
      ? dailySpent >= budget.dailyLimitUsd
      : false,
    totalExceeded: budget?.totalLimitUsd
      ? totalSpent >= budget.totalLimitUsd
      : false,
  };
}

export async function clearAllRecords(): Promise<void> {
  const api = getCostAPI();
  if (api) await api.costClear();
}
