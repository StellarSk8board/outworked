// Agent tool definitions and executor
// Tools give agents access to the virtual filesystem and code execution

import {
  writeFile,
  readFile,
  listFiles,
  deleteFile,
  getWorkspace,
} from "./filesystem";
import { executeCode } from "./sandbox";
import { execCommand, getCapabilities } from "./terminal";

// Evaluated once at module load — stable for the lifetime of the process.
const capabilities = getCapabilities();

// ─── Database IPC bridge ────────────────────────────────────────

function getDbAPI(): {
  memorySet: (scope: string, key: string, value: string) => Promise<unknown>;
  memorySearch: (scope: string, query?: string) => Promise<unknown[]>;
  memoryDelete: (scope: string, key: string) => Promise<boolean>;
  channelListLive: () => Promise<
    { id: string; type: string; name: string; status: string; errorMessage: string | null }[]
  >;
  channelSend: (
    channelId: string,
    conversationId: string,
    content: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  channelMessageList: (
    channelId: string,
    limit: number,
  ) => Promise<{ direction: string; sender?: string; content: string; timestamp: number }[]>;
} | null {
  const w = window as unknown as { electronAPI?: { db?: unknown } };
  return (w.electronAPI?.db as ReturnType<typeof getDbAPI>) ?? null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: "write_file",
    description:
      "Create or overwrite a file with the given content. Use this to save code, configs, documentation, etc.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: 'File path (e.g. "src/index.js", "README.md")',
        },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of an existing file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description:
      "List files in the workspace, optionally filtered by directory prefix.",
    parameters: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Directory prefix to filter by (omit for all files)",
        },
      },
    },
  },
  {
    name: "execute_code",
    description:
      "Execute JavaScript code in a sandboxed environment with console.log support. Returns output and any errors.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript code to execute" },
      },
      required: ["code"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to delete" },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command on the local machine and return its stdout/stderr. Use for installing packages, running builds, git operations, etc. Commands run in /bin/zsh (macOS/Linux) or cmd.exe (Windows). Defaults to the project workspace directory.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            'Shell command to execute (e.g. "npm install", "ls -la", "git status")',
        },
        cwd: {
          type: "string",
          description:
            "Working directory — use a subdirectory relative to workspace if needed. Omit to use the workspace root.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "assign_task",
    description:
      "Assign a task to an employee. The employee will execute the task autonomously using their tools. Only available to the Boss.",
    parameters: {
      type: "object",
      properties: {
        employeeName: {
          type: "string",
          description: "Exact name of the employee to assign the task to",
        },
        task: {
          type: "string",
          description:
            "Clear, actionable description of the task for the employee to complete",
        },
      },
      required: ["employeeName", "task"],
    },
  },
  {
    name: "update_todos",
    description:
      "Create or update your task list. Call this at the START of any non-trivial task to plan your work, then call it again to mark tasks in-progress or done as you go.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "Complete replacement list of all todos",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: 'Short unique id, e.g. "1", "2"',
              },
              text: { type: "string", description: "What needs to be done" },
              status: {
                type: "string",
                enum: ["pending", "in-progress", "done", "error"],
              },
            },
            required: ["id", "text", "status"],
          },
        },
      },
      required: ["todos"],
    },
  },
  {
    name: "git_status",
    description:
      "Show the current git branch, staged/unstaged changes, and recent commits for a repository.",
    parameters: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description:
            "Absolute or workspace-relative path to the git repository root. Omit to use workspace root.",
        },
      },
    },
  },
  {
    name: "git_create_branch",
    description:
      "Create and checkout a new git branch. Always create a new feature branch before making code changes.",
    parameters: {
      type: "object",
      properties: {
        branch: {
          type: "string",
          description:
            'Branch name (e.g. "feature/add-login", "fix/typo-in-readme")',
        },
        repo_path: {
          type: "string",
          description: "Path to the git repo root. Omit to use workspace root.",
        },
      },
      required: ["branch"],
    },
  },
  {
    name: "git_commit",
    description:
      "Stage all changes (git add -A) and commit them with a message.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit message" },
        repo_path: {
          type: "string",
          description: "Path to the git repo root. Omit to use workspace root.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "git_push",
    description:
      "Push the current branch to the remote origin, setting upstream if needed.",
    parameters: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Path to the git repo root. Omit to use workspace root.",
        },
      },
    },
  },
  {
    name: "remember",
    description:
      "Store a fact or note in persistent memory. Memories survive across sessions and can be recalled later. Use scopes: 'global' (shared across all agents), 'agent:<agentId>' (private to you), or 'project:<path>' (workspace-specific).",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description:
            'Memory scope: "global", "agent:<yourAgentId>", or "project:<workspacePath>"',
        },
        key: {
          type: "string",
          description:
            "Short key to identify this memory (e.g. 'user-preference', 'api-endpoint')",
        },
        value: {
          type: "string",
          description: "The information to remember",
        },
      },
      required: ["scope", "key", "value"],
    },
  },
  {
    name: "recall",
    description:
      "Retrieve memories from persistent storage. Search by scope and optional query string.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description:
            'Memory scope to search: "global", "agent:<agentId>", or "project:<path>"',
        },
        query: {
          type: "string",
          description:
            "Optional search query to filter memories by key or value",
        },
      },
      required: ["scope"],
    },
  },
  {
    name: "forget",
    description: "Delete a specific memory entry by scope and key.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", description: "Memory scope" },
        key: { type: "string", description: "Memory key to delete" },
      },
      required: ["scope", "key"],
    },
  },
  {
    name: "git_create_pr",
    description:
      "Create a GitHub pull request for the current branch using the gh CLI. Requires gh to be authenticated.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "PR title" },
        body: { type: "string", description: "PR description / body" },
        repo_path: {
          type: "string",
          description: "Path to the git repo root. Omit to use workspace root.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "send_message",
    description:
      `Send a message through a connected messaging channel (${capabilities.imessage ? "iMessage, " : ""}Slack, etc). Use list_channels first to see which channels are available and connected. For Slack threads, use "CHANNEL_ID:THREAD_TS" as the conversationId.`,
    parameters: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description:
            "ID of the channel to send through (from list_channels)",
        },
        conversationId: {
          type: "string",
          description: capabilities.imessage
            ? 'Recipient identifier — phone number/email for iMessage, Slack channel ID, or "CHANNEL_ID:THREAD_TS" for threaded Slack replies'
            : 'Recipient identifier — Slack channel ID, or "CHANNEL_ID:THREAD_TS" for threaded Slack replies',
        },
        content: {
          type: "string",
          description: "Message text to send",
        },
      },
      required: ["channelId", "conversationId", "content"],
    },
  },
  {
    name: "list_channels",
    description:
      "List all configured messaging channels and their connection status. Use this to discover available channels before sending messages.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "read_channel_messages",
    description:
      "Read recent messages from a messaging channel. Useful for checking what messages have been received or sent.",
    parameters: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description: "ID of the channel to read messages from",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return (default: 20)",
        },
      },
      required: ["channelId"],
    },
  },
];

export const BOSS_ASSIGN_TOOL: ToolDefinition = AGENT_TOOLS.find(
  (t) => t.name === "assign_task",
)!;

export async function executeTool(
  name: string,
  args: Record<string, string>,
): Promise<string> {
  switch (name) {
    case "write_file":
      return await writeFile(args.path, args.content);
    case "read_file":
      return await readFile(args.path);
    case "list_files":
      return await listFiles(args.directory);
    case "delete_file":
      return await deleteFile(args.path);
    case "run_command": {
      const cwd = args.cwd || (await getWorkspace());
      const result = await execCommand(args.command, cwd || undefined, 30000);
      const parts: string[] = [`[cwd: ${cwd}]`];
      if (result.stdout) parts.push(result.stdout);
      if (result.stderr) parts.push(`[stderr] ${result.stderr}`);
      if (result.error) parts.push(`Error: ${result.error}`);
      if (parts.length === 1)
        parts.push(
          result.ok ? "(completed successfully)" : `Exit code: ${result.code}`,
        );
      return parts.join("\n");
    }
    case "assign_task":
      // Handled by the UI layer via onToolCall
      return `(task assigned to ${args.employeeName})`;
    case "update_todos":
      // Handled by the UI layer via onToolCall; acknowledge here
      return `(todos updated: ${Array.isArray((args as unknown as Record<string, unknown>).todos) ? (args as unknown as Record<string, unknown[]>).todos.length : 0} tasks)`;
    case "execute_code": {
      const result = await executeCode(args.code);
      const parts: string[] = [];
      if (result.logs.length > 0) {
        parts.push(result.logs.map((l) => `[${l.type}] ${l.text}`).join("\n"));
      }
      if (result.ok) {
        parts.push(
          result.result ? `→ ${result.result}` : "(executed successfully)",
        );
      } else {
        parts.push(`Error: ${result.error}`);
      }
      return parts.join("\n");
    }
    case "git_status": {
      const cwd = args.repo_path || (await getWorkspace());
      const r = await execCommand(
        "git status && git log --oneline -5",
        cwd || undefined,
        15000,
      );
      return [r.stdout, r.stderr].filter(Boolean).join("\n") || "(no output)";
    }
    case "git_create_branch": {
      const cwd = args.repo_path || (await getWorkspace());
      const r = await execCommand(
        `git checkout -b ${args.branch}`,
        cwd || undefined,
        15000,
      );
      if (!r.ok) return `Error creating branch: ${r.stderr || r.error}`;
      return `Switched to new branch '${args.branch}'`;
    }
    case "git_commit": {
      const cwd = args.repo_path || (await getWorkspace());
      const r = await execCommand(
        `git add -A && git commit -m ${JSON.stringify(args.message)}`,
        cwd || undefined,
        30000,
      );
      if (!r.ok) return `Error committing: ${r.stderr || r.error}`;
      return r.stdout || "(committed)";
    }
    case "git_push": {
      const cwd = args.repo_path || (await getWorkspace());
      // --set-upstream handles both first push and subsequent pushes
      const r = await execCommand(
        "git push --set-upstream origin HEAD",
        cwd || undefined,
        60000,
      );
      if (!r.ok) return `Error pushing: ${r.stderr || r.error}`;
      return r.stdout || r.stderr || "(pushed)";
    }
    case "git_create_pr": {
      const cwd = args.repo_path || (await getWorkspace());
      const bodyFlag = args.body
        ? `--body ${JSON.stringify(args.body)}`
        : '--body ""';
      const r = await execCommand(
        `gh pr create --title ${JSON.stringify(args.title)} ${bodyFlag} --head HEAD`,
        cwd || undefined,
        60000,
      );
      if (!r.ok) return `Error creating PR: ${r.stderr || r.error}`;
      return r.stdout || "(PR created)";
    }
    case "remember": {
      const db = getDbAPI();
      if (!db) return "Error: database not available (not running in Electron)";
      const result = await db.memorySet(args.scope, args.key, args.value);
      return `Remembered: [${args.scope}] ${args.key} = ${args.value.slice(0, 100)}${args.value.length > 100 ? "…" : ""}`;
    }
    case "recall": {
      const db = getDbAPI();
      if (!db) return "Error: database not available (not running in Electron)";
      const memories = await db.memorySearch(args.scope, args.query);
      if (!memories || memories.length === 0)
        return `No memories found in scope "${args.scope}"${args.query ? ` matching "${args.query}"` : ""}`;
      return (memories as Record<string, unknown>[])
        .map(
          (m) =>
            `[${m.key}] ${String(m.value).slice(0, 200)}`,
        )
        .join("\n");
    }
    case "forget": {
      const db = getDbAPI();
      if (!db) return "Error: database not available (not running in Electron)";
      const deleted = await db.memoryDelete(args.scope, args.key);
      return deleted
        ? `Forgot: [${args.scope}] ${args.key}`
        : `Memory not found: [${args.scope}] ${args.key}`;
    }
    case "send_message": {
      const db = getDbAPI();
      if (!db) return "Error: database not available (not running in Electron)";
      const result = await db.channelSend(
        args.channelId,
        args.conversationId,
        args.content,
      );
      if (!result.ok)
        return `Error sending message: ${result.error || "unknown error"}`;
      return `Message sent via channel ${args.channelId} to ${args.conversationId}`;
    }
    case "list_channels": {
      const db = getDbAPI();
      if (!db) return "Error: database not available (not running in Electron)";
      const channels = await db.channelListLive();
      if (!channels || channels.length === 0)
        return `No messaging channels configured. Ask the user to set up a channel (${capabilities.imessage ? "iMessage or " : ""}Slack) in the Channels panel.`;
      return channels
        .map(
          (ch) =>
            `[${ch.id}] ${ch.name} (${ch.type}) — ${ch.status}${ch.errorMessage ? ` (${ch.errorMessage})` : ""}`,
        )
        .join("\n");
    }
    case "read_channel_messages": {
      const db = getDbAPI();
      if (!db) return "Error: database not available (not running in Electron)";
      const limit = parseInt(args.limit, 10) || 20;
      const msgs = await db.channelMessageList(args.channelId, limit);
      if (!msgs || msgs.length === 0)
        return `No messages found for channel ${args.channelId}`;
      return msgs
        .map(
          (m) =>
            `[${m.direction}] ${m.sender ? m.sender + ": " : ""}${m.content.slice(0, 300)}${m.content.length > 300 ? "…" : ""} (${new Date(m.timestamp).toLocaleString()})`,
        )
        .join("\n");
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
