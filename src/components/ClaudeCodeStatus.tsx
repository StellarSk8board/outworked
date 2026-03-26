import { useState, useEffect, useCallback } from "react";
import {
  ClaudeCodeAuthStatus,
  getClaudeCodeAuthStatus,
  isElectron,
} from "../lib/terminal";
import { getSetting, setSetting } from "../lib/settings";

// Global session defaults — used when an agent's SubagentDef doesn't specify these.
export interface GlobalSessionDefaults {
  model: string;
  thinking: "adaptive" | "enabled" | "disabled";
  thinkingBudget: number;
  effort: "" | "low" | "medium" | "high" | "max";
}

const SETTINGS_KEYS = {
  model: "outworked_default_model",
  thinking: "outworked_default_thinking",
  thinkingBudget: "outworked_default_thinking_budget",
  effort: "outworked_default_effort",
} as const;

export async function loadGlobalDefaults(): Promise<GlobalSessionDefaults> {
  const [model, thinking, thinkingBudget, effort] = await Promise.all([
    getSetting(SETTINGS_KEYS.model),
    getSetting(SETTINGS_KEYS.thinking),
    getSetting(SETTINGS_KEYS.thinkingBudget),
    getSetting(SETTINGS_KEYS.effort),
  ]);
  return {
    model: model || "",
    thinking: (thinking as GlobalSessionDefaults["thinking"]) || "adaptive",
    thinkingBudget: thinkingBudget ? parseInt(thinkingBudget) : 0,
    effort: (effort as GlobalSessionDefaults["effort"]) || "",
  };
}

export default function ClaudeCodeStatus() {
  const [status, setStatus] = useState<ClaudeCodeAuthStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [defaults, setDefaults] = useState<GlobalSessionDefaults>({
    model: "",
    thinking: "adaptive",
    thinkingBudget: 0,
    effort: "",
  });

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const result = await getClaudeCodeAuthStatus();
      setStatus(result);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (isElectron()) {
      checkStatus();
      loadGlobalDefaults().then(setDefaults);
    } else {
      setStatus({
        installed: false,
        version: null,
        authenticated: false,
        accountInfo: null,
        error: "Not running in Electron",
      });
    }
  }, [checkStatus]);

  function updateDefault<K extends keyof GlobalSessionDefaults>(
    key: K,
    value: GlobalSessionDefaults[K],
  ) {
    setDefaults((prev) => ({ ...prev, [key]: value }));
    setSetting(SETTINGS_KEYS[key], String(value));
  }

  return (
    <div className="px-2 py-1.5 border-b border-gray-800">
      {/* Summary bar — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 text-left"
      >
        <StatusDot status={status} checking={checking} />
        <span className="flex-1 text-[10px] font-pixel text-slate-300 truncate">
          {checking && !status
            ? "Checking Claude Code…"
            : checking
              ? "Rechecking…"
              : !status?.installed
                ? "Claude Code not found"
                : !status?.authenticated
                  ? "Claude Code — needs login"
                  : `Claude Code ${status.version ?? ""} ✓`.trim()}
        </span>
        <span className="text-[9px] text-slate-500">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Installation status */}
          <Row
            ok={!!status?.installed}
            label="CLI installed"
            detail={status?.version ?? "not found"}
          />

          {/* Auth status */}
          <Row
            ok={!!status?.authenticated}
            label="Authenticated"
            detail={
              status?.authenticated
                ? (status?.accountInfo ?? "logged in")
                : (status?.error ?? "not logged in")
            }
          />

          {status?.installed && status?.authenticated && (
            <div className="text-[9px] font-pixel text-emerald-400/80">
              Agents auto-sync from ~/.claude/agents/
            </div>
          )}

          {/* Error / help text */}
          {!status?.installed && (
            <HelpBox>
              Install with:{" "}
              <code className="bg-slate-700 px-1 rounded text-[10px]">
                curl -fsSL https://claude.ai/install.sh | bash
              </code>
            </HelpBox>
          )}

          {status?.installed && !status?.authenticated && (
            <HelpBox>
              Run in your terminal:{" "}
              <code className="bg-slate-700 px-1 rounded text-[10px]">
                claude login
              </code>
            </HelpBox>
          )}

          {/* Session defaults — only show when Claude Code is ready */}
          {status?.installed && status?.authenticated && (
            <div className="border-t border-slate-700/50 pt-2 space-y-1.5 font-mono  text-[7px]">
              <p className="text-[9px] font-pixel text-slate-500">
                Session Defaults
              </p>
              <SettingSelect
                label="Model"
                value={defaults.model}
                onChange={(v) => updateDefault("model", v)}
                options={[
                  ["", "Default"],
                  ["sonnet", "Sonnet"],
                  ["opus", "Opus"],
                  ["haiku", "Haiku"],
                ]}
              />
              <SettingSelect
                label="Thinking"
                value={defaults.thinking}
                onChange={(v) =>
                  updateDefault(
                    "thinking",
                    v as GlobalSessionDefaults["thinking"],
                  )
                }
                options={[
                  ["adaptive", "Adaptive"],
                  ["enabled", "Enabled"],
                  ["disabled", "Disabled"],
                ]}
              />
              {defaults.thinking === "enabled" && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-slate-500 shrink-0 w-16">
                    Budget
                  </span>
                  <input
                    type="number"
                    value={defaults.thinkingBudget || ""}
                    onChange={(e) =>
                      updateDefault(
                        "thinkingBudget",
                        e.target.value ? parseInt(e.target.value) : 0,
                      )
                    }
                    placeholder="default"
                    step={1024}
                    min={0}
                    className="flex-1 px-1.5 py-0.5 text-[10px] bg-slate-800 border border-slate-700 rounded text-white font-mono"
                  />
                </div>
              )}
              <SettingSelect
                label="Effort"
                value={defaults.effort}
                onChange={(v) =>
                  updateDefault("effort", v as GlobalSessionDefaults["effort"])
                }
                options={[
                  ["", "Default (high)"],
                  ["low", "Low"],
                  ["medium", "Medium"],
                  ["high", "High"],
                  ["max", "Max"],
                ]}
              />
            </div>
          )}

          {/* Recheck button */}
          <button
            onClick={checkStatus}
            disabled={checking}
            className="w-full py-1 text-[10px] font-pixel rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50 transition-colors"
          >
            {checking ? "⏳ Checking…" : "🔄 Recheck"}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusDot({
  status,
  checking,
}: {
  status: ClaudeCodeAuthStatus | null;
  checking: boolean;
}) {
  let color = "#6b7280"; // gray default
  if (checking)
    color = "#f59e0b"; // amber
  else if (status?.installed && status?.authenticated)
    color = "#22c55e"; // green
  else if (status?.installed)
    color = "#f59e0b"; // amber — installed but not authed
  else color = "#ef4444"; // red — not installed

  return (
    <div
      className={`w-2 h-2 rounded-full shrink-0 ${checking ? "animate-pulse" : ""}`}
      style={{ backgroundColor: color }}
    />
  );
}

function Row({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-[10px] mt-px">{ok ? "✅" : "❌"}</span>
      <div className="min-w-0">
        <span className="text-[10px] font-pixel text-slate-300">{label}</span>
        <p className="text-[10px] font-mono text-slate-400 truncate">
          {detail}
        </p>
      </div>
    </div>
  );
}

function HelpBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-900/30 border border-amber-700/40 rounded p-1.5">
      <p className="text-[10px] font-mono text-amber-300 break-words">
        {children}
      </p>
    </div>
  );
}

function SettingSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-slate-500 shrink-0 w-16">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-1.5 py-0.5 text-[10px] bg-slate-800 border border-slate-700 rounded text-white"
      >
        {options.map(([val, label]) => (
          <option key={val} value={val}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
