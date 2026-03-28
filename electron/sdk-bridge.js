// SDK Bridge: wraps @anthropic-ai/claude-agent-sdk for use from Electron main process.
// Replaces the previous approach of spawning `claude` CLI as a child process.

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { IS_WIN } = require("./platform");
const verbose = process.env.VERBOSE_LOGGING === "true";
// The SDK is ESM-only, so we use dynamic import (cached after first call).
let _queryFn = null;
async function getQuery() {
  if (!_queryFn) {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    _queryFn = sdk.query;
  }
  return _queryFn;
}

// Resolve the system-installed Claude Code CLI executable.
// Inside a packaged Electron app the SDK's bundled cli.js lives inside
// app.asar and cannot be spawned as a child process, so we must point
// the SDK at the real CLI binary on disk.
let _claudeExePath = null;
function getClaudeExecutablePath() {
  if (_claudeExePath) return _claudeExePath;

  const home = os.homedir(); // cross-platform: works on Windows and Unix
  const ext = IS_WIN ? ".exe" : "";

  // Platform-specific candidate install locations
  const candidates = IS_WIN
    ? [
        // Windows: installer places the binary at %USERPROFILE%\.claude\bin\claude.exe
        path.join(home, ".claude", "bin", `claude${ext}`),
      ]
    : [
        // macOS / Linux: curl installer places the binary here
        path.join(home, ".claude", "bin", "claude"),
        path.join(home, ".local", "bin", "claude"),
        "/usr/local/bin/claude",
      ];

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      _claudeExePath = p;
      return _claudeExePath;
    } catch {
      // not found / not executable — try the next candidate
    }
  }

  // Fallback: ask the OS path resolver
  // `where` on Windows, `which` on Unix
  const finder = IS_WIN ? "where" : "which";
  try {
    const found = execFileSync(finder, ["claude"], {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    // `where` on Windows may return multiple matches, one per line — take the first
    _claudeExePath = found.split(/\r?\n/)[0].trim();
    if (_claudeExePath) return _claudeExePath;
  } catch {
    // not on PATH
  }

  return undefined; // let the SDK try its default (will fail inside asar)
}

// Active sessions: reqId → { abortController, done: boolean, heartbeatInterval }
const activeSessions = new Map();

// Heartbeat interval (ms) — renderer uses 2× this as the dead-session threshold
const HEARTBEAT_INTERVAL_MS = 15_000;

// Pending permission requests: permId → { resolve }
// Used by canUseTool to wait for user approval from the renderer.
const pendingPermissions = new Map();

/**
 * Resolve a pending permission request from the renderer.
 * @param {string} permId - Permission request ID
 * @param {boolean} allow - Whether to allow the tool use
 * @returns {boolean} true if the permission was found and resolved
 */
function resolvePermission(permId, allow) {
  const pending = pendingPermissions.get(permId);
  if (!pending) return false;
  pendingPermissions.delete(permId);
  pending.resolve(allow);
  return true;
}

/**
 * Start an SDK session. Streams SDKMessage objects via the onMessage callback.
 * Returns the final result when the session completes.
 *
 * @param {string} reqId - Unique request ID
 * @param {object} options - ClaudeCodeAdvancedOptions from the renderer
 * @param {object} callbacks - { onMessage, onError, onDone }
 */
async function startSession(reqId, options, callbacks) {
  const query = await getQuery();
  const abortController = new AbortController();

  // Periodic heartbeat so the renderer can detect silently dead sessions
  const heartbeatInterval = setInterval(() => {
    if (callbacks.onHeartbeat) {
      callbacks.onHeartbeat(reqId);
    }
  }, HEARTBEAT_INTERVAL_MS);

  activeSessions.set(reqId, {
    abortController,
    done: false,
    heartbeatInterval,
    query: null, // set after query() is called
  });

  // Handle timeout via AbortController
  let timeoutId = null;
  if (options.timeoutMs) {
    timeoutId = setTimeout(() => abortController.abort(), options.timeoutMs);
  }

  // Build SDK options from ClaudeCodeAdvancedOptions
  const sdkOptions = {
    cwd: options.cwd || os.homedir(),
    abortController,
    // Load all filesystem settings (user, project, local) so CLAUDE.md,
    // permissions, and MCP servers configured in settings.json are available.
    settingSources: ["user", "project", "local"],
  };

  // Point the SDK at the system-installed Claude CLI so it doesn't try
  // to spawn cli.js from inside the app.asar archive.
  const claudePath = getClaudeExecutablePath();
  if (claudePath) {
    sdkOptions.pathToClaudeCodeExecutable = claudePath;
  }

  if (options.systemPrompt) sdkOptions.systemPrompt = options.systemPrompt;
  if (options.appendSystemPrompt) {
    // If no custom systemPrompt is set, use the preset and append.
    // If a custom systemPrompt IS set, just concatenate.
    if (!options.systemPrompt) {
      sdkOptions.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: options.appendSystemPrompt,
      };
    } else {
      sdkOptions.systemPrompt =
        options.systemPrompt + "\n\n" + options.appendSystemPrompt;
    }
  }
  if (options.model) sdkOptions.model = options.model;
  if (options.maxTurns) sdkOptions.maxTurns = options.maxTurns;
  if (options.maxBudget) sdkOptions.maxBudgetUsd = options.maxBudget;
  if (options.permissionMode)
    sdkOptions.permissionMode = options.permissionMode;
  if (options.dangerouslySkipPermissions)
    sdkOptions.allowDangerouslySkipPermissions = true;
  if (options.effort) sdkOptions.effort = options.effort;
  if (options.fallbackModel) sdkOptions.fallbackModel = options.fallbackModel;
  if (options.outputFormat) sdkOptions.outputFormat = options.outputFormat;
  if (options.thinking) sdkOptions.thinking = options.thinking;

  // Tool permissions — pass even if empty (empty = no tools allowed)
  if (options.allowedTools != null) {
    sdkOptions.allowedTools = options.allowedTools;
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    sdkOptions.disallowedTools = options.disallowedTools;
  }

  // Session management — resume takes precedence over continue.
  // When we have an explicit session ID, use resume (not continue).
  // continue resumes the *most recent* session, which may not be ours.
  if (options.resumeSessionId) {
    sdkOptions.resume = options.resumeSessionId;
    if (options.forkSession) sdkOptions.forkSession = true;
  } else if (options.continueSession) {
    sdkOptions.continue = true;
  }
  if (options.sessionId) sdkOptions.sessionId = options.sessionId;
  if (options.persistSession === false) sdkOptions.persistSession = false;

  // Subagent definitions
  if (options.agents) {
    sdkOptions.agents = options.agents;
  }

  // MCP servers — SDK takes Record<string, McpServerConfig> directly.
  // Pass through the full config object so env, headers, etc. are preserved.
  if (options.mcpServers && options.mcpServers.length > 0) {
    const mcpObj = {};
    for (const entry of options.mcpServers) {
      if (typeof entry === "string") {
        mcpObj[entry] = {};
      } else {
        for (const [name, cfg] of Object.entries(entry)) {
          mcpObj[name] = { ...cfg };
        }
      }
    }
    if (Object.keys(mcpObj).length > 0) {
      sdkOptions.mcpServers = mcpObj;
    }
  }

  // Environment variables — pass through SDK's env option
  const envOverrides = {};
  if (options.enableAgentTeams) {
    envOverrides.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
  }
  if (options.githubToken) {
    envOverrides.GH_TOKEN = options.githubToken;
    envOverrides.GITHUB_TOKEN = options.githubToken;
  }
  if (Object.keys(envOverrides).length > 0) {
    sdkOptions.env = { ...process.env, ...envOverrides };
  }

  // Forward stderr if callback provided
  if (callbacks.onStderr) {
    sdkOptions.stderr = (data) => callbacks.onStderr(reqId, data);
  }

  // Permission request handler — prompts the user via IPC when a tool
  // isn't explicitly allowed or denied by the permission rules.
  if (callbacks.onPermissionRequest) {
    // Track recently approved tools to auto-approve repeat requests
    // (the SDK may ask multiple times for the same tool, e.g. for subagents)
    const recentApprovals = new Map(); // key → expiry timestamp

    // canUseTool signature per SDK docs:
    //   (toolName, input, { signal, suggestions, blockedPath, decisionReason, toolUseID, agentID })
    sdkOptions.canUseTool = async (toolName, input, context) => {
      verbose &&
        console.log(
          `[sdk-bridge] canUseTool: ${toolName}`,
          JSON.stringify(input).slice(0, 200),
        );

      // Auto-approve our own MCP server tools — they run locally and are trusted
      if (toolName.startsWith("mcp__outworked-skills__")) {
        verbose &&
          console.log(
            `[sdk-bridge] Auto-approved (outworked MCP): ${toolName}`,
          );
        return {
          behavior: "allow",
          updatedInput: input || {},
          toolUseID: context?.toolUseID,
        };
      }

      // Build a key from tool name + command/path to identify duplicate requests
      const inputKey = input?.command || input?.file_path || input?.path || "";
      const approvalKey = `${toolName}:${inputKey}`;

      // Auto-approve if this exact tool+input was approved within the last 30s
      const expiry = recentApprovals.get(approvalKey);
      if (expiry && Date.now() < expiry) {
        verbose &&
          console.log(`[sdk-bridge] Auto-approved (cached): ${toolName}`);
        return {
          behavior: "allow",
          updatedInput: input || {},
          updatedPermissions: context?.suggestions,
          toolUseID: context?.toolUseID,
        };
      }

      const permId = `${reqId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const description =
        context?.decisionReason || `Wants to use ${toolName}`;

      verbose &&
        console.log(
          `[sdk-bridge] Sending permission request: ${permId} for ${toolName}`,
        );
      // Send permission request to the renderer
      callbacks.onPermissionRequest(reqId, {
        permId,
        tool: toolName,
        input: input || {},
        description,
        agentName: context?.agentID,
      });

      // Wait for the user to approve or deny — also listen for abort
      const allowed = await new Promise((resolve) => {
        pendingPermissions.set(permId, { resolve });
        // If the session is aborted while waiting, auto-deny
        if (context?.signal) {
          const onAbort = () => {
            if (pendingPermissions.has(permId)) {
              pendingPermissions.delete(permId);
              resolve(false);
            }
          };
          if (context.signal.aborted) {
            onAbort();
          } else {
            context.signal.addEventListener("abort", onAbort, { once: true });
          }
        }
      });
      verbose &&
        console.log(`[sdk-bridge] Permission resolved: ${permId} → ${allowed}`);

      if (allowed) {
        // Cache the approval for 30s to avoid re-prompting for the same tool
        recentApprovals.set(approvalKey, Date.now() + 30_000);
        return {
          behavior: "allow",
          updatedInput: input || {},
          updatedPermissions: context?.suggestions,
          toolUseID: context?.toolUseID,
        };
      } else {
        return {
          behavior: "deny",
          message: "User denied permission",
          toolUseID: context?.toolUseID,
        };
      }
    };
  }

  try {
    const q = query({
      prompt: options.prompt || "",
      options: sdkOptions,
    });

    // Store query reference so abortSession can call close()
    const session = activeSessions.get(reqId);
    if (session) session.query = q;

    // Track the last result message from the stream
    let lastResult = null;

    // Stream messages from the async generator
    for await (const message of q) {
      if (activeSessions.get(reqId)?.done) break;
      verbose && console.log(`[sdk-bridge] message:`);
      verbose &&
        console.dir(message, {
          depth: 4,
          maxArrayLength: 3,
          maxStringLength: 100,
        });

      callbacks.onMessage(reqId, message);

      // Capture result message for the onDone callback
      if (message.type === "result") {
        lastResult = message;
      }
    }

    _cleanupTimers(reqId, heartbeatInterval, timeoutId);

    const isError = lastResult?.is_error || false;
    callbacks.onDone(
      reqId,
      isError ? 1 : 0,
      null,
      lastResult
        ? {
            text: lastResult.result || "",
            sessionId: lastResult.session_id,
            cost: lastResult.total_cost_usd,
            usage: lastResult.usage,
            subtype: lastResult.subtype,
            durationMs: lastResult.duration_ms,
            durationApiMs: lastResult.duration_api_ms,
            numTurns: lastResult.num_turns,
            stopReason: lastResult.stop_reason,
            modelUsage: lastResult.modelUsage,
            permissionDenials: lastResult.permission_denials,
            structuredOutput: lastResult.structured_output,
          }
        : null,
    );

    return lastResult;
  } catch (err) {
    _cleanupTimers(reqId, heartbeatInterval, timeoutId);

    // AbortError means user cancelled — treat as code 0 with no error
    if (err.name === "AbortError" || abortController.signal.aborted) {
      callbacks.onDone(reqId, 0, null, null);
      return null;
    }

    callbacks.onDone(reqId, -1, err.message, null);
    return null;
  }
}

function _cleanupTimers(reqId, heartbeatInterval, timeoutId) {
  if (timeoutId) clearTimeout(timeoutId);
  clearInterval(heartbeatInterval);
  activeSessions.delete(reqId);
}

function _terminateSession(reqId, session) {
  session.done = true;

  // Reject any pending permissions for this session so canUseTool doesn't hang
  for (const [permId, pending] of pendingPermissions) {
    if (permId.startsWith(`${reqId}:`)) {
      pendingPermissions.delete(permId);
      pending.resolve(false);
    }
  }

  if (session.query?.close) {
    try { session.query.close(); } catch { /* ignore */ }
  }
  session.abortController.abort();
  if (session.heartbeatInterval) clearInterval(session.heartbeatInterval);
  activeSessions.delete(reqId);
}

/**
 * Abort a running session.
 * @param {string} reqId
 * @returns {boolean} true if the session was found and aborted
 */
function abortSession(reqId) {
  const session = activeSessions.get(reqId);
  if (session && !session.done) {
    _terminateSession(reqId, session);
    return true;
  }
  return false;
}

/**
 * Check if any sessions are active (for caffeinate).
 */
function hasActiveSessions() {
  return activeSessions.size > 0;
}

/**
 * Abort all active sessions (for app quit).
 */
function abortAll() {
  for (const [reqId, session] of activeSessions) {
    _terminateSession(reqId, session);
  }
}

module.exports = {
  startSession,
  abortSession,
  hasActiveSessions,
  abortAll,
  resolvePermission,
};
