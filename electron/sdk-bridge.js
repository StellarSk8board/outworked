// SDK Bridge: wraps @anthropic-ai/claude-agent-sdk for use from Electron main process.
// Replaces the previous approach of spawning `claude` CLI as a child process.

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

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

  const home = process.env.HOME || "";
  // Common install locations (same paths augmentedEnv adds to PATH)
  const candidates = [
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
      // not found / not executable
    }
  }

  // Fallback: ask the shell (works if claude is on the user's login PATH)
  try {
    _claudeExePath = execFileSync("which", ["claude"], {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    if (_claudeExePath) return _claudeExePath;
  } catch {
    // not on PATH
  }

  return undefined; // let the SDK try its default (will fail inside asar)
}

// Active sessions: reqId → { abortController, done: boolean }
const activeSessions = new Map();

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
  activeSessions.set(reqId, { abortController, done: false });

  // Handle timeout via AbortController
  let timeoutId = null;
  if (options.timeoutMs) {
    timeoutId = setTimeout(() => abortController.abort(), options.timeoutMs);
  }

  // Build SDK options from ClaudeCodeAdvancedOptions
  const sdkOptions = {
    cwd: options.cwd || process.env.HOME,
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
      sdkOptions.systemPrompt = options.systemPrompt + "\n\n" + options.appendSystemPrompt;
    }
  }
  if (options.model) sdkOptions.model = options.model;
  if (options.maxTurns) sdkOptions.maxTurns = options.maxTurns;
  if (options.maxBudget) sdkOptions.maxBudgetUsd = options.maxBudget;
  if (options.permissionMode) sdkOptions.permissionMode = options.permissionMode;
  if (options.dangerouslySkipPermissions) sdkOptions.allowDangerouslySkipPermissions = true;

  // Tool permissions
  if (options.allowedTools && options.allowedTools.length > 0) {
    sdkOptions.allowedTools = options.allowedTools;
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    sdkOptions.disallowedTools = options.disallowedTools;
  }

  // Session management
  if (options.resumeSessionId) {
    sdkOptions.resume = options.resumeSessionId;
  } else if (options.continueSession) {
    sdkOptions.continue = true;
  }

  // Subagent definitions
  if (options.agents) {
    sdkOptions.agents = options.agents;
  }

  // MCP servers — SDK takes Record<string, McpServerConfig> directly
  if (options.mcpServers && options.mcpServers.length > 0) {
    const mcpObj = {};
    for (const entry of options.mcpServers) {
      if (typeof entry === "string") {
        mcpObj[entry] = {};
      } else {
        for (const [name, cfg] of Object.entries(entry)) {
          mcpObj[name] = {};
          if (cfg.type) mcpObj[name].type = cfg.type;
          if (cfg.command) mcpObj[name].command = cfg.command;
          if (cfg.args) mcpObj[name].args = cfg.args;
          if (cfg.url) mcpObj[name].url = cfg.url;
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

  try {
    const q = query({
      prompt: options.prompt || "",
      options: sdkOptions,
    });

    // Track the last result message from the stream
    let lastResult = null;

    // Stream messages from the async generator
    for await (const message of q) {
      if (activeSessions.get(reqId)?.done) break;
      callbacks.onMessage(reqId, message);

      // Capture result message for the onDone callback
      if (message.type === "result") {
        lastResult = message;
      }
    }

    if (timeoutId) clearTimeout(timeoutId);
    activeSessions.delete(reqId);

    const isError = lastResult?.is_error || false;
    callbacks.onDone(reqId, isError ? 1 : 0, null, lastResult ? {
      text: lastResult.result || "",
      sessionId: lastResult.session_id,
      cost: lastResult.total_cost_usd,
      usage: lastResult.usage,
    } : null);

    return lastResult;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    activeSessions.delete(reqId);

    // AbortError means user cancelled — treat as code 0 with no error
    if (err.name === "AbortError" || abortController.signal.aborted) {
      callbacks.onDone(reqId, 0, null, null);
      return null;
    }

    callbacks.onDone(reqId, -1, err.message, null);
    return null;
  }
}

/**
 * Abort a running session.
 * @param {string} reqId
 * @returns {boolean} true if the session was found and aborted
 */
function abortSession(reqId) {
  const session = activeSessions.get(reqId);
  if (session && !session.done) {
    session.done = true;
    session.abortController.abort();
    activeSessions.delete(reqId);
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
    session.done = true;
    session.abortController.abort();
  }
  activeSessions.clear();
}

module.exports = {
  startSession,
  abortSession,
  hasActiveSessions,
  abortAll,
};
