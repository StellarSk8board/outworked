import { Agent, AgentSkill, ApiKeys, Message, ToolCall } from "./types";
import { AGENT_TOOLS, ToolDefinition, executeTool } from "./tools";
import { getWorkspace } from "./filesystem";
import { getSetting } from "./settings";
import {
  runClaudeCode,
  ClaudeCodeAdvancedOptions,
  ClaudeCodeStreamCallbacks,
  PermissionRequest,
} from "./terminal";
import { getBundledSkill } from "./bundled-skills";

function buildToolPreamble(workspace: string): string {
  return `

## Workspace
Your working directory is: ${workspace}
All file operations and shell commands run in this directory by default.

## Asking Colleagues
If you need information or expertise from a colleague, include this exact format in your response:
[ASK:ColleagueName] Your question here
The system will route your question and provide their answer before your next step. Only ask when you genuinely need their input.
`;
}

function buildSystemPrompt(
  agent: Agent,
  withTools: boolean,
  workspace = "",
  skills: AgentSkill[] = [],
): string {
  let prompt = agent.personality;
  // Resolve per-agent skill names (from subagentDef) into actual skill objects
  const agentDefSkills: AgentSkill[] = (agent.subagentDef?.skills || [])
    .map((name) => getBundledSkill(name))
    .filter((s): s is AgentSkill => s !== undefined);
  // Combine: app-level skills + agent-level skills from subagentDef + legacy agent.skills
  const allSkills = [...skills, ...agentDefSkills, ...agent.skills];
  // Deduplicate by id
  const seen = new Set<string>();
  const uniqueSkills = allSkills.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  if (uniqueSkills.length > 0) {
    prompt += "\n\n## Skills\n";
    for (const skill of uniqueSkills) {
      prompt += `\n### ${skill.name}\n${skill.content}\n`;
    }
  }
  if (withTools) prompt += buildToolPreamble(workspace);
  return prompt;
}

export interface SendOptions {
  onToolCall?: (call: ToolCall) => void;
  useTools?: boolean; // default true
  skills?: AgentSkill[]; // app-level skills injected into all agents
  extraTools?: ToolDefinition[]; // additional tools (e.g. assign_task for boss)
  extraSystemPrompt?: string; // appended to the system prompt
  customToolExecutor?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string | null>; // return string to override default executeTool, null to use default
  colleagues?: { name: string; role: string }[]; // other agents available for ask_agent
  onClaudeCodeEvent?: (event: {
    type: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    text?: string;
  }) => void;
  onPermissionRequest?: (request: PermissionRequest) => void;
  onStderr?: (text: string) => void;
}

export interface SendMessageResult {
  text: string;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function sendMessage(
  agent: Agent,
  userMessage: string,
  keys: ApiKeys,
  onThought: (text: string) => void,
  signal?: AbortSignal,
  options?: SendOptions,
): Promise<string> {
  const result = await sendMessageWithCost(
    agent,
    userMessage,
    keys,
    onThought,
    signal,
    options,
  );
  return result.text;
}

export async function sendMessageWithCost(
  agent: Agent,
  userMessage: string,
  keys: ApiKeys,
  onThought: (text: string) => void,
  signal?: AbortSignal,
  options?: SendOptions,
): Promise<SendMessageResult> {
  const useTools = options?.useTools !== false;
  const workspace = useTools ? await getWorkspace() : "";
  let systemPrompt = buildSystemPrompt(
    agent,
    useTools,
    workspace,
    options?.skills,
  );
  if (options?.colleagues && options.colleagues.length > 0) {
    systemPrompt +=
      "\n\n## Colleagues\nYou can ask these colleagues questions using [ASK:Name] format:\n";
    for (const c of options.colleagues) {
      systemPrompt += `- **${c.name}** — ${c.role}\n`;
    }
  }
  if (options?.extraSystemPrompt) systemPrompt += options.extraSystemPrompt;
  const messages: Message[] = [
    ...agent.history,
    { role: "user", content: userMessage, timestamp: Date.now() },
  ];

  // Currently only Claude Code is supported — API-key-based providers are disabled
  if (agent.provider === "claude-code") {
    return callClaudeCode(
      systemPrompt,
      messages,
      onThought,
      signal,
      agent,
      options?.onClaudeCodeEvent,
      options?.onPermissionRequest,
      options?.onStderr,
      useTools,
    );
  } else {
    throw new Error(
      `Provider "${agent.provider}" is disabled. Only Claude Code (local) is supported. Switch this agent to Claude Code in the editor.`,
    );
  }

}


// ─── Claude Code CLI ──────────────────────────────────────────────
// Uses the locally-installed `claude` CLI.
// Uses runClaudeCode with stream-json for full event visibility
// (tool calls, subagent activity, session metadata, cost tracking).

async function callClaudeCode(
  system: string,
  messages: Message[],
  onThought: (text: string) => void,
  signal?: AbortSignal,
  agent?: Agent,
  onClaudeCodeEvent?: SendOptions["onClaudeCodeEvent"],
  onPermissionRequest?: SendOptions["onPermissionRequest"],
  onStderr?: SendOptions["onStderr"],
  useTools = true,
): Promise<SendMessageResult> {
  // When resuming a session, only send the latest user message — Claude Code
  // already has the conversation history from the session.  Sending the full
  // history again doubles input tokens and significantly slows responses.
  let prompt = "";
  if (agent?.sessionId && messages.length > 0) {
    // Find the last user message
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        prompt = messages[i].content;
        break;
      }
    }
  } else {
    for (const msg of messages) {
      if (msg.role === "user") prompt += `Human: ${msg.content}\n\n`;
      else if (msg.role === "assistant")
        prompt += `Assistant: ${msg.content}\n\n`;
    }
  }

  const workspace = await getWorkspace();

  // Always use advanced mode so we get cost/usage data back
  return callClaudeCodeAdvanced(
    prompt,
    system,
    workspace,
    onThought,
    signal,
    agent,
    onClaudeCodeEvent,
    onPermissionRequest,
    onStderr,
    useTools,
  );
}

/**
 * Advanced Claude Code invocation with stream-json parsing.
 * Used for subagent-backed agents for rich tool/event visibility.
 */
async function callClaudeCodeAdvanced(
  prompt: string,
  system: string,
  workspace: string,
  onThought: (text: string) => void,
  signal?: AbortSignal,
  agent?: Agent,
  onClaudeCodeEvent?: SendOptions["onClaudeCodeEvent"],
  onPermissionRequest?: SendOptions["onPermissionRequest"],
  onStderr?: SendOptions["onStderr"],
  useTools = true,
): Promise<SendMessageResult> {
  const subDef = agent?.subagentDef;
  const isResume = !!agent?.sessionId;

  // Build MCP servers list — include user-configured ones plus the always-running
  // outworked-skills server. Skip MCP when tools are disabled (e.g. router calls).
  let mcpServers = subDef?.mcpServers
    ? subDef.mcpServers.filter(
        (s) => !(typeof s === "object" && s !== null && "outworked-skills" in s),
      )
    : [];
  if (useTools) {
    mcpServers.push({
      "outworked-skills": {
        type: "http" as const,
        url: "http://127.0.0.1:7823/mcp",
      },
    });
  }

  // If the agent has an allowlist, ensure our MCP server tools are permitted.
  // Claude Code prefixes MCP tools with "mcp__<serverName>__<toolName>".
  let allowedTools = subDef?.tools ? [...subDef.tools] : undefined;
  if (allowedTools) {
    const mcpToolPattern = "mcp__outworked-skills__*";
    if (!allowedTools.includes(mcpToolPattern)) {
      allowedTools.push(mcpToolPattern);
    }
  }

  const options: ClaudeCodeAdvancedOptions = {
    prompt,
    cwd: workspace,
    // Skip system prompt on resumed sessions — Claude Code already has it
    // from the initial session. Re-sending it wastes input tokens.
    ...(isResume ? {} : { systemPrompt: system }),
    model: subDef?.model || undefined,
    // When useTools is false (e.g. router/planning calls), block all tools
    // and force maxTurns: 1 so Claude Code returns text immediately.
    allowedTools: useTools ? allowedTools : [],
    disallowedTools: useTools ? subDef?.disallowedTools : undefined,
    maxTurns: useTools ? subDef?.maxTurns : 1,
    permissionMode:
      (subDef?.permissionMode as ClaudeCodeAdvancedOptions["permissionMode"]) ||
      ((await getSetting("outworked_permission_prompts")) !== "0"
        ? "default"
        : "acceptEdits"),
    mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
    continueSession: isResume,
    resumeSessionId: agent?.sessionId,
  };

  let fullText = "";
  onThought("🤖 Claude Code is thinking...");

  const callbacks: ClaudeCodeStreamCallbacks = {
    onTextDelta: (text) => {
      fullText += text;
      onThought(fullText);
    },
    onToolUse: (name, input) => {
      const label = claudeCodeToolLabel(name, input);
      if (fullText && !fullText.endsWith("\n")) fullText += "\n";
      fullText += `\n${label}\n`;
      onThought(fullText);
      onClaudeCodeEvent?.({
        type: "tool_use",
        toolName: name,
        toolInput: input,
      });
    },
    onEvent: (event) => {
      // Extract text from assistant messages for thinking previews
      let eventText: string | undefined;
      if (event.type === "result" && typeof event.result === "string") {
        eventText = event.result;
      } else if (event.type === "assistant" && event.message?.content) {
        const content = event.message.content;
        if (typeof content === "string") {
          eventText = content;
        } else if (Array.isArray(content)) {
          eventText = content
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text)
            .join("");
        }
      }
      onClaudeCodeEvent?.({
        type: event.type,
        text: eventText,
      });
    },
    onStderr: onStderr,
    onPermissionRequest: onPermissionRequest,
  };

  const result = await runClaudeCode(options, callbacks, signal);

  // Store session ID on the agent for continuity
  if (agent && result.sessionId) {
    agent.sessionId = result.sessionId;
  }

  return {
    text: result.result || fullText,
    cost: result.cost,
    inputTokens: result.usage?.input_tokens,
    outputTokens: result.usage?.output_tokens,
  };
}

function claudeCodeToolLabel(
  name: string,
  args: Record<string, unknown>,
): string {
  const p = (args.file_path ?? args.path ?? args.command ?? "") as string;
  switch (name) {
    case "Write":
      return `📁 Writing ${p}…`;
    case "Edit":
      return `✏️ Editing ${p}…`;
    case "Read":
      return `📖 Reading ${p}…`;
    case "Bash":
      return `💻 $ ${p.slice(0, 80)}…`;
    case "Glob":
      return `🔍 Searching files…`;
    case "Grep":
      return `🔎 Grepping ${(args.pattern as string) ?? ""}…`;
    case "WebFetch":
      return `🌐 Fetching ${p}…`;
    case "WebSearch":
      return `🔍 Searching: ${(args.query as string) ?? ""}…`;
    case "Agent":
      return `🤖 Delegating to subagent…`;
    case "TodoWrite":
      return `📋 Updating task list…`;
    case "TaskCreate":
      return `📋 Creating task…`;
    default:
      return `🔧 ${name} ${p ? `(${p.slice(0, 40)})` : ""}…`;
  }
}
