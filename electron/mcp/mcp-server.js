// ─── Outworked MCP Server (Streamable HTTP) ─────────────────────
// Single always-running MCP server that exposes memory, scheduler,
// channel, and skill tools to Claude Code agents over HTTP.
// Runs in the Electron main process on localhost:7823.
//
// Agents connect with: { type: "http", url: "http://127.0.0.1:7823/mcp" }

const http = require("http");
const crypto = require("crypto");
const db = require("../db/database");

const PORT = 7823;
let _skillManager = null;
let _server = null;

function setSkillManager(manager) {
  _skillManager = manager;
}

// ─── Tool definitions ───────────────────────────────────────────

const BUILTIN_TOOLS = [
  {
    name: "remember",
    description:
      'Store a fact in persistent memory. Scopes: "global" (all agents), "agent:<id>" (private), "project:<path>" (workspace).',
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Memory scope" },
        key: { type: "string", description: "Short key for this memory" },
        value: { type: "string", description: "The information to remember" },
      },
      required: ["scope", "key", "value"],
    },
  },
  {
    name: "recall",
    description: "Retrieve memories from persistent storage.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Memory scope to search" },
        query: { type: "string", description: "Optional search query" },
      },
      required: ["scope"],
    },
  },
  {
    name: "forget",
    description: "Delete a memory entry.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Memory scope" },
        key: { type: "string", description: "Key to delete" },
      },
      required: ["scope", "key"],
    },
  },
  {
    name: "schedule_task",
    description:
      'Schedule a task. Types: "one-time" (ISO timestamp), "interval" (ms), "cron" (expression).',
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["one-time", "interval", "cron"] },
        schedule: { type: "string" },
        agentId: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["name", "type", "schedule", "agentId", "prompt"],
    },
  },
  {
    name: "list_scheduled_tasks",
    description: "List all scheduled tasks.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "cancel_scheduled_task",
    description: "Cancel a scheduled task by ID.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "send_message",
    description:
      'Send a message through a connected messaging channel (iMessage, Slack, etc). Use list_channels first to discover available channels. For Slack threads, use "CHANNEL_ID:THREAD_TS" as the conversationId.',
    inputSchema: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description: "ID of the channel to send through (from list_channels)",
        },
        conversationId: {
          type: "string",
          description:
            'Recipient — phone number/email for iMessage, Slack channel ID, or "CHANNEL_ID:THREAD_TS" for threaded replies',
        },
        content: { type: "string", description: "Message text to send" },
      },
      required: ["channelId", "conversationId", "content"],
    },
  },
  {
    name: "list_channels",
    description:
      "List all configured messaging channels and their connection status. Use this to discover available channels before sending messages.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_channel_messages",
    description: "Read recent messages from a messaging channel.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel ID to read from" },
        limit: {
          type: "number",
          description: "Max messages to return (default 20)",
        },
      },
      required: ["channelId"],
    },
  },
];

// ─── Skill tool discovery ───────────────────────────────────────

function getSkillTools() {
  console.log("[mcp] Discovering skill tools...");
  if (!_skillManager) return [];
  const tools = [];
  for (const runtime of _skillManager.listRuntimes()) {
    const r = _skillManager.getRuntime(runtime.name);
    if (r && r.status === "connected") {
      for (const t of r.getTools()) {
        tools.push({
          name: t.name,
          description: t.description,
          inputSchema: t.parameters || { type: "object", properties: {} },
        });
      }
    }
  }
  return tools;
}

// ─── Tool execution ─────────────────────────────────────────────

async function executeTool(name, args) {
  console.log(`[mcp] Executing tool: ${name} with args:`, args);
  switch (name) {
    case "remember": {
      db.memorySet(args.scope, args.key, args.value);
      return `Remembered: [${args.scope}] ${args.key}`;
    }
    case "recall": {
      const memories = db.memorySearch(args.scope, args.query);
      if (!memories || memories.length === 0) {
        return `No memories found in scope "${args.scope}"${args.query ? ` matching "${args.query}"` : ""}`;
      }
      return memories
        .map((m) => `[${m.key}] ${m.value.slice(0, 500)}`)
        .join("\n\n");
    }
    case "forget": {
      const deleted = db.memoryDelete(args.scope, args.key);
      return deleted
        ? `Forgot: [${args.scope}] ${args.key}`
        : `Not found: [${args.scope}] ${args.key}`;
    }
    case "schedule_task": {
      const id = crypto.randomUUID();
      let nextRunAt;
      if (args.type === "one-time") {
        nextRunAt = new Date(args.schedule).getTime();
      } else if (args.type === "interval") {
        nextRunAt = Date.now() + parseInt(args.schedule, 10);
      } else {
        nextRunAt = Date.now() + 60000;
      }
      db.schedulerCreate({
        id,
        name: args.name,
        type: args.type,
        schedule: args.schedule,
        agentId: args.agentId,
        prompt: args.prompt,
        enabled: true,
        nextRunAt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return `Scheduled "${args.name}" (${args.type}: ${args.schedule}) — ID: ${id}`;
    }
    case "list_scheduled_tasks": {
      const tasks = db.schedulerList();
      if (!tasks || tasks.length === 0) return "No scheduled tasks.";
      return tasks
        .map(
          (t) =>
            `[${t.id}] ${t.name} (${t.type}: ${t.schedule}) — ${t.enabled ? "enabled" : "disabled"}, runs: ${t.runCount}`,
        )
        .join("\n");
    }
    case "cancel_scheduled_task": {
      db.schedulerDelete(args.taskId);
      return `Cancelled task: ${args.taskId}`;
    }
    case "send_message": {
      const channelManager = require("../channels/channel-manager");
      await channelManager.sendMessage(
        args.channelId,
        args.conversationId,
        args.content,
      );
      return `Message sent via ${args.channelId} to ${args.conversationId}`;
    }
    case "list_channels": {
      const channelManager = require("../channels/channel-manager");
      const channels = channelManager.getChannels();
      if (!channels || channels.length === 0) {
        return "No messaging channels configured.";
      }
      return channels
        .map(
          (ch) =>
            `[${ch.id}] ${ch.name} (${ch.type}) — ${ch.status}${ch.errorMessage ? ` (${ch.errorMessage})` : ""}`,
        )
        .join("\n");
    }
    case "read_channel_messages": {
      const limit = args.limit || 20;
      const msgs = db.channelMessageList(args.channelId, limit);
      if (!msgs || msgs.length === 0) {
        return `No messages found for channel ${args.channelId}`;
      }
      return msgs
        .map(
          (m) =>
            `[${m.direction}] ${m.sender ? m.sender + ": " : ""}${m.content.slice(0, 300)}${m.content.length > 300 ? "…" : ""} (${new Date(m.timestamp).toLocaleString()})`,
        )
        .join("\n");
    }
    default: {
      // Skill tools: "runtime:action" format
      if (!_skillManager) return `Error: skill runtime manager not available`;
      const colonIdx = name.indexOf(":");
      if (colonIdx === -1) return `Unknown tool: ${name}`;
      const prefix = name.slice(0, colonIdx);
      const runtimeMap = {
        gmail: "gmail",
        calendar: "google-calendar",
        browse: "browser",
      };
      const resolvedRuntime = runtimeMap[prefix] || prefix;
      try {
        const result = await _skillManager.executeTool(
          resolvedRuntime,
          name,
          args,
        );
        return typeof result === "string"
          ? result
          : JSON.stringify(result, null, 2);
      } catch (err) {
        return `Error executing ${name}: ${err.message}`;
      }
    }
  }
}

// ─── MCP JSON-RPC handler ───────────────────────────────────────

async function handleMcpRequest(msg) {
  const { id, method, params } = msg;

  console.log(`[mcp] Received request: ${method} with params:`, params);

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "outworked-skills", version: "0.2.0" },
        },
      };

    case "notifications/initialized":
      // No response needed for notifications
      return null;

    case "tools/list": {
      const skillTools = getSkillTools();
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: [...BUILTIN_TOOLS, ...skillTools] },
      };
    }

    case "tools/call": {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      try {
        const result = await executeTool(toolName, toolArgs);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          },
        };
      }
    }

    default:
      if (id !== undefined) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      }
      return null;
  }
}

// ─── Streamable HTTP transport ──────────────────────────────────
// POST /mcp — receives JSON-RPC, responds with SSE or JSON
// GET  /mcp — SSE stream for server-initiated notifications (not used yet)
// DELETE /mcp — close session (no-op, stateless)

function start() {
  if (_server) return;

  _server = http.createServer(async (req, res) => {
    // CORS for local connections
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url !== "/mcp") {
      res.writeHead(404);
      res.end();
      return;
    }

    if (req.method === "DELETE") {
      // Session termination — we're stateless so just acknowledge
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === "GET") {
      // SSE endpoint for server-initiated notifications
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // Keep alive until client disconnects; no server notifications yet
      req.on("close", () => res.end());
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        let msg;
        try {
          msg = JSON.parse(body);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            }),
          );
          return;
        }

        const response = await handleMcpRequest(msg);

        if (!response) {
          // Notification — no response body, just 202
          res.writeHead(202);
          res.end();
          return;
        }

        // Respond as SSE (Streamable HTTP spec)
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        res.end();
      });
      return;
    }

    res.writeHead(405);
    res.end();
  });

  _server.listen(PORT, "127.0.0.1", () => {
    console.log(`[mcp] MCP server listening on http://127.0.0.1:${PORT}/mcp`);
  });

  _server.on("error", (err) => {
    console.error(`[mcp] Server error: ${err.message}`);
  });
}

function stop() {
  if (_server) {
    _server.close();
    _server = null;
  }
}

module.exports = { start, stop, setSkillManager, PORT };
