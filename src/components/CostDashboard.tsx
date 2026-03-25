import { useState, useEffect, useCallback } from "react";
import { Agent } from "../lib/types";
import {
  getAllRecords,
  getTodaySummary,
  getTotalSummary,
  getPerAgentSummary,
  getDailySummaries,
  checkBudget,
  setBudget,
  loadBudgets,
  clearAllRecords,
  type CostRecord,
  type CostSummary,
  type AgentCostSummary,
  type DailyCostSummary,
  type BudgetStatus,
} from "../lib/costs";

// ─── Helpers ─────────────────────────────────────────────────────

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[d.getDay()];
}

// ─── Sub-components ──────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color = "text-emerald-400",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2">
      <p className="text-[9px] font-pixel text-slate-500 uppercase tracking-wide">
        {label}
      </p>
      <p className={`text-sm font-pixel ${color} mt-0.5`}>{value}</p>
      {sub && <p className="text-[9px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function MiniBarChart({
  data,
  maxVal,
}: {
  data: DailyCostSummary[];
  maxVal: number;
}) {
  return (
    <div className="flex items-end gap-1 h-16">
      {data.map((d) => {
        const pct = maxVal > 0 ? (d.totalCostUsd / maxVal) * 100 : 0;
        return (
          <div
            key={d.date}
            className="flex-1 flex flex-col items-center gap-0.5"
          >
            <div
              className="w-full flex flex-col justify-end"
              style={{ height: "48px" }}
            >
              <div
                className="w-full bg-indigo-500/70 rounded-t"
                style={{
                  height: `${Math.max(pct, 2)}%`,
                  minHeight: d.totalCostUsd > 0 ? "2px" : "0px",
                }}
                title={`${d.date}: ${formatCost(d.totalCostUsd)}`}
              />
            </div>
            <span className="text-[8px] text-slate-600">
              {dayLabel(d.date)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BudgetRow({
  agent,
  status,
  onUpdate,
}: {
  agent?: Agent;
  status: BudgetStatus;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dailyVal, setDailyVal] = useState(status.dailyLimit?.toString() ?? "");
  const [totalVal, setTotalVal] = useState(status.totalLimit?.toString() ?? "");

  async function save() {
    const d = dailyVal.trim() ? parseFloat(dailyVal) : undefined;
    const t = totalVal.trim() ? parseFloat(totalVal) : undefined;
    await setBudget(
      status.agentId,
      d && !isNaN(d) ? d : undefined,
      t && !isNaN(t) ? t : undefined,
    );
    setEditing(false);
    onUpdate();
  }

  const exceeded = status.dailyExceeded || status.totalExceeded;

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded ${exceeded ? "bg-red-900/30 border border-red-700/40" : "bg-slate-800/40"}`}
    >
      <div className="flex-1 min-w-0">
        <span
          className="text-[10px] font-pixel text-slate-300 truncate block"
          style={{ color: agent?.color }}
        >
          {agent?.name || status.agentId.slice(0, 8)}
        </span>
        {!editing && (
          <span className="text-[9px] text-slate-500">
            Today: {formatCost(status.dailySpent)}
            {status.dailyLimit ? ` / ${formatCost(status.dailyLimit)}` : ""}
            {" · "}
            Total: {formatCost(status.totalSpent)}
            {status.totalLimit ? ` / ${formatCost(status.totalLimit)}` : ""}
          </span>
        )}
      </div>
      {exceeded && (
        <span className="text-[9px] text-red-400 font-pixel shrink-0">
          OVER BUDGET
        </span>
      )}
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            value={dailyVal}
            onChange={(e) => setDailyVal(e.target.value)}
            placeholder="Daily $"
            className="w-14 text-[10px] input-mono px-1 py-0.5"
          />
          <input
            value={totalVal}
            onChange={(e) => setTotalVal(e.target.value)}
            placeholder="Total $"
            className="w-14 text-[10px] input-mono px-1 py-0.5"
          />
          <button
            onClick={save}
            className="text-[9px] text-emerald-400 hover:text-emerald-300"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-[9px] text-slate-500 hover:text-slate-300"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-[9px] text-indigo-400 hover:text-indigo-300 shrink-0"
        >
          Set Limit
        </button>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────

export default function CostDashboard({ agents }: { agents: Agent[] }) {
  const [records, setRecords] = useState<CostRecord[]>([]);
  const [perAgent, setPerAgent] = useState<AgentCostSummary[]>([]);
  const [daily, setDaily] = useState<DailyCostSummary[]>([]);
  const [budgetStatuses, setBudgetStatuses] = useState<BudgetStatus[]>([]);
  const [today, setToday] = useState<CostSummary>({ totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, recordCount: 0 });
  const [total, setTotal] = useState<CostSummary>({ totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, recordCount: 0 });
  const [tab, setTab] = useState<"overview" | "agents" | "budgets">("overview");

  const refresh = useCallback(async () => {
    const all = await getAllRecords();
    setRecords(all);
    setPerAgent(await getPerAgentSummary());
    setDaily(await getDailySummaries(7));
    setToday(await getTodaySummary());
    setTotal(await getTotalSummary());
    // Build budget statuses for agents that have records or budgets
    const budgets = await loadBudgets();
    const agentIds = new Set([
      ...all.map((r) => r.agentId),
      ...budgets.map((b) => b.agentId),
    ]);
    const statuses = await Promise.all(Array.from(agentIds).map((id) => checkBudget(id)));
    setBudgetStatuses(statuses);
  }, []);

  useEffect(() => {
    refresh();
    // Refresh every 10s while the dashboard is open
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  const maxDaily = Math.max(...daily.map((d) => d.totalCostUsd), 0.001);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-gray-800 shrink-0">
        {(["overview", "agents", "budgets"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-[10px] font-pixel leading-relaxed transition-colors ${
              tab === t
                ? "text-white border-b-2 border-emerald-500 bg-gray-800"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t === "overview"
              ? "Overview"
              : t === "agents"
                ? "Per Agent"
                : "Budgets"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {tab === "overview" && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="Today"
                value={formatCost(today.totalCostUsd)}
                sub={`${today.recordCount} requests`}
              />
              <StatCard
                label="All Time"
                value={formatCost(total.totalCostUsd)}
                sub={`${total.recordCount} requests`}
                color="text-indigo-400"
              />
              <StatCard
                label="Tokens Today"
                value={formatTokens(
                  today.totalInputTokens + today.totalOutputTokens,
                )}
                sub={`${formatTokens(today.totalInputTokens)}↑ ${formatTokens(today.totalOutputTokens)}↓`}
                color="text-slate-300"
              />
              <StatCard
                label="Tokens Total"
                value={formatTokens(
                  total.totalInputTokens + total.totalOutputTokens,
                )}
                sub={`${formatTokens(total.totalInputTokens)}↑ ${formatTokens(total.totalOutputTokens)}↓`}
                color="text-slate-300"
              />
            </div>

            {/* 7-day chart */}
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3">
              <p className="text-[9px] font-pixel text-slate-500 uppercase mb-2">
                Last 7 Days
              </p>
              <MiniBarChart data={daily} maxVal={maxDaily} />
              <div className="flex justify-between mt-1">
                <span className="text-[8px] text-slate-600">
                  {daily[0]?.date}
                </span>
                <span className="text-[8px] text-slate-600">
                  {daily[daily.length - 1]?.date}
                </span>
              </div>
            </div>

            {/* Recent activity */}
            <div>
              <p className="text-[9px] font-pixel text-slate-500 uppercase mb-1.5">
                Recent Activity
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {records.length === 0 && (
                  <p className="text-[10px] text-slate-600 text-center py-4">
                    No cost data yet. Start chatting with agents!
                  </p>
                )}
                {records
                  .slice(-20)
                  .reverse()
                  .map((r) => {
                    const agent = agents.find((a) => a.id === r.agentId);
                    return (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 text-[10px] px-2 py-1 bg-slate-800/30 rounded"
                      >
                        <span
                          className="font-pixel truncate max-w-[80px]"
                          style={{ color: agent?.color || "#94a3b8" }}
                        >
                          {r.agentName}
                        </span>
                        <span className="text-emerald-500">
                          {formatCost(r.costUsd)}
                        </span>
                        <span className="text-slate-600 text-[9px]">
                          {formatTokens(r.inputTokens)}{" "}
                          {formatTokens(r.outputTokens)}↓
                        </span>
                        <span className="text-slate-700 text-[9px] ml-auto">
                          {new Date(r.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </>
        )}

        {tab === "agents" && (
          <>
            <p className="text-[9px] font-pixel text-slate-500 uppercase">
              Cost by Agent (All Time)
            </p>
            {perAgent.length === 0 && (
              <p className="text-[10px] text-slate-600 text-center py-4">
                No cost data yet.
              </p>
            )}
            {perAgent.map((a) => {
              const agent = agents.find((ag) => ag.id === a.agentId);
              const pct =
                total.totalCostUsd > 0
                  ? (a.totalCostUsd / total.totalCostUsd) * 100
                  : 0;
              return (
                <div
                  key={a.agentId}
                  className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-2.5"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="text-[11px] font-pixel truncate"
                      style={{ color: agent?.color || "#94a3b8" }}
                    >
                      {a.agentName}
                    </span>
                    <span className="text-[10px] text-emerald-400 ml-auto">
                      {formatCost(a.totalCostUsd)}
                    </span>
                    <span className="text-[9px] text-slate-500">
                      ({pct.toFixed(1)}%)
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(pct, 1)}%`,
                        backgroundColor: agent?.color || "#6366f1",
                      }}
                    />
                  </div>
                  <div className="flex gap-3 mt-1">
                    <span className="text-[9px] text-slate-500">
                      {a.recordCount} requests
                    </span>
                    <span className="text-[9px] text-slate-500">
                      {formatTokens(a.totalInputTokens)}↑{" "}
                      {formatTokens(a.totalOutputTokens)}↓
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {tab === "budgets" && (
          <>
            <p className="text-[9px] font-pixel text-slate-500 uppercase">
              Budget Limits
            </p>
            <p className="text-[9px] text-slate-600">
              Set daily or total spending limits per agent. Warnings appear when
              limits are reached.
            </p>
            {budgetStatuses.length === 0 && (
              <p className="text-[10px] text-slate-600 text-center py-4">
                No agents with cost data yet.
              </p>
            )}
            <div className="space-y-1.5">
              {budgetStatuses.map((bs) => (
                <BudgetRow
                  key={bs.agentId}
                  agent={agents.find((a) => a.id === bs.agentId)}
                  status={bs}
                  onUpdate={refresh}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-3 py-1.5 border-t border-slate-800 flex items-center gap-2">
        <button
          onClick={refresh}
          className="text-[9px] text-indigo-400 hover:text-indigo-300 font-pixel"
        >
          Refresh
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            if (
              window.confirm(
                "Clear all cost tracking data? This cannot be undone.",
              )
            ) {
              clearAllRecords().then(() => refresh());
            }
          }}
          className="text-[9px] text-red-500/60 hover:text-red-400 font-pixel"
        >
          Clear Data
        </button>
      </div>
    </div>
  );
}
