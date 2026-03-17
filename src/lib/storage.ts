import { Agent, AgentSkill, SubagentDef, McpServerInline, AGENT_COLORS, SPRITE_KEYS } from './types';
import { readClaudeAgentFiles, writeClaudeAgentFile, getHomedir, AgentFileInfo, runClaudeCode } from './terminal';
import { v4 as uuidv4 } from 'uuid';

const AGENTS_KEY = 'outworked_agents';
const SKILLS_KEY = 'outworked_skills';

const DEFAULT_AGENTS: Agent[] = [
  {
    id: uuidv4(),
    name: 'Boss',
    role: 'Office Manager',
    personality:
      'You are the Boss, the office manager. Your ONLY role is delegation — you NEVER do implementation work yourself. You assign every task to the right employee using the Agent tool. You break complex requests into subtasks and delegate each one. You speak with authority but are fair and encouraging.',
    model: 'claude-code',
    provider: 'claude-code',
    skills: [],
    position: { x: 7, y: 1 },
    status: 'idle',
    currentThought: 'Overseeing the team...',
    spriteKey: 'char_yellow',
    history: [],
    color: AGENT_COLORS[3],
    todos: [],
    isBoss: true,
  },
];

export function loadAgents(): Agent[] {
  if (typeof window === 'undefined') return DEFAULT_AGENTS;
  try {
    const raw = localStorage.getItem(AGENTS_KEY);
    if (!raw) {
      saveAgents(DEFAULT_AGENTS);
      return DEFAULT_AGENTS;
    }
    return JSON.parse(raw) as Agent[];
  } catch {
    return DEFAULT_AGENTS;
  }
}

export function saveAgents(agents: Agent[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
}

export function createAgent(partial: Partial<Agent>, claudeCodeDefault?: boolean): Agent {
  const idx = Math.floor(Math.random() * SPRITE_KEYS.length);
  return {
    id: uuidv4(),
    name: makeAgentName(),
    role: 'Assistant',
    personality: 'You are a helpful AI assistant working in the office.',
    model: claudeCodeDefault ? 'claude-code' : 'gpt-5.4',
    provider: claudeCodeDefault ? 'claude-code' : 'openai',
    skills: [],
    position: { x: 3, y: 3 },
    status: 'idle',
    currentThought: '',
    spriteKey: SPRITE_KEYS[idx],
    history: [],
    color: AGENT_COLORS[idx],
    todos: [],
    ...partial,
  };
}

// ─── App-level skills ──────────────────────────────────────────

export function loadSkills(): AgentSkill[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SKILLS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AgentSkill[];
  } catch {
    return [];
  }
}

export function saveSkills(skills: AgentSkill[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SKILLS_KEY, JSON.stringify(skills));
}

export function resetProject(agents: Agent[]): Agent[] {
  const cleared = agents.map((a) => ({ ...a, history: [], todos: [], status: 'idle' as const, currentThought: '' }));
  saveAgents(cleared);
  if (typeof window !== 'undefined') localStorage.removeItem('outworked_selected_agent');
  return cleared;
}

// ─── Claude Code agent file helpers ────────────────────────────

/**
 * Build the markdown content for a Claude Code agent .md file.
 */
export function buildSubagentMd(name: string, def: SubagentDef, body: string, outworkedName?: string, outworkedRole?: string): string {
  let fm = '---\n';
  fm += `name: ${name}\n`;
  fm += `description: ${def.description}\n`;
  if (outworkedName) fm += `outworked-name: ${outworkedName}\n`;
  if (outworkedRole) fm += `outworked-role: ${outworkedRole}\n`;
  if (def.tools && def.tools.length > 0) {
    fm += 'tools:\n';
    for (const t of def.tools) fm += `  - ${t}\n`;
  }
  if (def.disallowedTools && def.disallowedTools.length > 0) {
    fm += 'disallowedTools:\n';
    for (const t of def.disallowedTools) fm += `  - ${t}\n`;
  }
  if (def.model) fm += `model: ${def.model}\n`;
  if (def.permissionMode) fm += `permissionMode: ${def.permissionMode}\n`;
  if (def.maxTurns) fm += `maxTurns: ${def.maxTurns}\n`;
  if (def.isolation) fm += `isolation: ${def.isolation}\n`;
  if (def.background) fm += `background: true\n`;
  if (def.memory) fm += `memory: ${def.memory}\n`;
  if (def.skills && def.skills.length > 0) {
    fm += 'skills:\n';
    for (const s of def.skills) fm += `  - ${s}\n`;
  }
  if (def.mcpServers && def.mcpServers.length > 0) {
    fm += 'mcpServers:\n';
    for (const entry of def.mcpServers) {
      if (typeof entry === 'string') {
        fm += `  - ${entry}\n`;
      } else {
        for (const [srvName, cfg] of Object.entries(entry)) {
          fm += `  - ${srvName}:\n`;
          if (cfg.type) fm += `      type: ${cfg.type}\n`;
          if (cfg.command) fm += `      command: ${cfg.command}\n`;
          if (cfg.args && cfg.args.length > 0) {
            fm += `      args:\n`;
            for (const a of cfg.args) fm += `        - ${JSON.stringify(a)}\n`;
          }
          if (cfg.url) fm += `      url: ${cfg.url}\n`;
        }
      }
    }
  }
  if (def.hooks && Object.keys(def.hooks).length > 0) {
    fm += 'hooks:\n';
    for (const [event, matchers] of Object.entries(def.hooks)) {
      fm += `  ${event}:\n`;
      for (const m of matchers) {
        if (m.matcher) fm += `    - matcher: ${JSON.stringify(m.matcher)}\n`;
        else fm += `    - hooks:\n`;
        if (m.matcher) fm += `      hooks:\n`;
        for (const h of m.hooks) {
          const prefix = m.matcher ? '        ' : '        ';
          fm += `${prefix}- type: ${h.type}\n`;
          fm += `${prefix}  command: ${JSON.stringify(h.command)}\n`;
        }
      }
    }
  }
  fm += '---\n\n';
  fm += body;
  return fm;
}

/**
 * Create a new Claude Code agent .md file.
 * scope='user' → ~/.claude/agents/  (default)
 * scope='project' → <workspaceDir>/.claude/agents/
 * Returns the file path if successful, null otherwise.
 */
export async function createClaudeAgentFile(
  agent: Agent,
  workspaceDir?: string,
): Promise<string | null> {
  const slug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'agent';
  const scope = agent.agentScope || 'user';
  let basePath: string;
  if (scope === 'project' && workspaceDir) {
    basePath = `${workspaceDir}/.claude/agents`;
  } else {
    basePath = `${getHomedir()}/.claude/agents`;
  }
  const filePath = `${basePath}/${slug}.md`;
  const def: SubagentDef = agent.subagentDef || {
    description: agent.role || 'Office assistant',
  };
  const body = agent.personality || `You are ${agent.name}. ${def.description}`;
  const content = buildSubagentMd(slug, def, body, agent.name, agent.role);
  const ok = await writeClaudeAgentFile(filePath, content);
  return ok ? filePath : null;
}

/**
 * Use Claude Code CLI to AI-generate a full agent .md file from a description.
 * Returns the generated file content, or null on failure.
 */
export async function generateAgentWithAI(
  description: string,
  opts: {
    name?: string;
    scope?: 'user' | 'project';
    workspaceDir?: string;
    onProgress?: (chunk: string) => void;
  } = {},
): Promise<{ content: string; filePath: string } | null> {
  const systemPrompt = `You are an expert at creating Claude Code agent definition files. Given a description of the desired agent, generate a complete .md file with YAML frontmatter and a detailed system prompt body.

The file MUST follow this exact format:
---
outworked-name: <Display Name for the office UI>
outworked-role: <Short role title, e.g. "Frontend Developer", "QA Engineer">
name: <kebab-case-slug>
description: "<1-2 sentence description of when to delegate to this agent, used by Claude Code for routing>"
model: sonnet
---

<Detailed system prompt that defines the agent's expertise, responsibilities, and operational approach. Be thorough — include specific domain knowledge, methodologies, and behavioral guidelines. Use markdown formatting with headers and bullet points.>

Rules:
- outworked-name should be a human first name that fits the role
- outworked-role is a short job title (2-4 words)
- name is a kebab-case slug derived from the role
- description is for Claude Code delegation routing — explain WHEN and WHY to use this agent
- The body should be 200-500 words of detailed expertise and instructions
- Do NOT wrap the output in markdown code fences — output the raw .md content directly
- Do NOT include any explanation before or after the file content`;

  const prompt = opts.name
    ? `Create a Claude Code agent file for an employee named "${opts.name}" with this role/description: ${description}`
    : `Create a Claude Code agent file for this role/description: ${description}`;

  try {
    const output = await runClaudeCode(prompt, systemPrompt, opts.workspaceDir, opts.onProgress);

    // Strip any accidental code fences the LLM might wrap around the output
    let content = output.trim();
    if (content.startsWith('```')) {
      content = content.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    // Validate we got valid frontmatter
    if (!content.startsWith('---')) {
      return null;
    }

    // Extract the slug from the generated frontmatter to determine filename
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const slug = nameMatch ? nameMatch[1].trim() : (opts.name || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const scope = opts.scope || 'user';
    let basePath: string;
    if (scope === 'project' && opts.workspaceDir) {
      basePath = `${opts.workspaceDir}/.claude/agents`;
    } else {
      basePath = `${getHomedir()}/.claude/agents`;
    }
    const filePath = `${basePath}/${slug}.md`;

    const ok = await writeClaudeAgentFile(filePath, content);
    return ok ? { content, filePath } : null;
  } catch (err) {
    console.error('[generateAgentWithAI]', err);
    return null;
  }
}

// ─── Claude Code default upgrade ───────────────────────────────
/**
 * When Claude Code is available, upgrade default agents (non-subagent) to use
 * claude-code as their model/provider so they run through the CLI.
 */
export function upgradeAgentsToClaudeCode(agents: Agent[]): Agent[] {
  const upgraded = agents.map(a => {
    // Skip agents already on claude-code or backed by subagent files
    if (a.provider === 'claude-code' || a.subagentFile) return a;
    return { ...a, model: 'claude-code' as const, provider: 'claude-code' as const };
  });
  saveAgents(upgraded);
  return upgraded;
}

// ─── Claude Code subagent sync ─────────────────────────────────

/**
 * Parse YAML frontmatter from a Claude Code subagent .md file.
 * Returns the parsed SubagentDef + the markdown body (prompt).
 */
export function parseSubagentFrontmatter(content: string): { def: Partial<SubagentDef> & { name?: string; description?: string; 'outworked-name'?: string; 'outworked-role'?: string }; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { def: {}, body: content };
  }
  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { def: {}, body: content };
  }
  const fmText = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 4).trim();

  // Parse full YAML frontmatter using indentation-aware parser
  const raw = parseYamlBlock(fmText);

  // Extract mcpServers: list of strings or {name: {type,command,args,url}} objects
  let mcpServers: SubagentDef['mcpServers'] | undefined;
  if (Array.isArray(raw.mcpServers)) {
    mcpServers = (raw.mcpServers as unknown[]).map(entry => {
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'object' && entry !== null) {
        const obj = entry as Record<string, unknown>;
        const result: Record<string, McpServerInline> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'object' && v !== null) {
            const cfg = v as Record<string, unknown>;
            result[k] = {
              type: (cfg.type as McpServerInline['type']) || 'stdio',
              command: cfg.command as string | undefined,
              args: Array.isArray(cfg.args) ? cfg.args.map(String) : undefined,
              url: cfg.url as string | undefined,
            };
          }
        }
        return result;
      }
      return String(entry);
    });
  }

  // Extract hooks: Record<string, HookMatcher[]>
  let hooks: SubagentDef['hooks'] | undefined;
  if (typeof raw.hooks === 'object' && raw.hooks !== null && !Array.isArray(raw.hooks)) {
    hooks = {};
    const hooksObj = raw.hooks as Record<string, unknown>;
    for (const [event, matcherList] of Object.entries(hooksObj)) {
      if (!Array.isArray(matcherList)) continue;
      hooks[event] = matcherList.map((m: unknown) => {
        const mObj = m as Record<string, unknown>;
        const hookCmds = Array.isArray(mObj.hooks)
          ? (mObj.hooks as Record<string, unknown>[]).map(h => ({
              type: 'command' as const,
              command: String(h.command || ''),
            }))
          : [];
        return {
          matcher: mObj.matcher ? String(mObj.matcher) : undefined,
          hooks: hookCmds,
        };
      });
    }
  }

  return {
    def: {
      name: raw.name as string | undefined,
      description: raw.description as string | undefined,
      tools: Array.isArray(raw.tools) ? raw.tools.map(String) : undefined,
      disallowedTools: Array.isArray(raw.disallowedTools) ? raw.disallowedTools.map(String) : undefined,
      model: raw.model as string | undefined,
      permissionMode: raw.permissionMode as string | undefined,
      maxTurns: typeof raw.maxTurns === 'number' ? raw.maxTurns : undefined,
      skills: Array.isArray(raw.skills) ? raw.skills.map(String) : undefined,
      memory: raw.memory as SubagentDef['memory'] | undefined,
      background: raw.background as boolean | undefined,
      isolation: raw.isolation as SubagentDef['isolation'] | undefined,
      mcpServers,
      hooks,
      'outworked-name': raw['outworked-name'] as string | undefined,
      'outworked-role': raw['outworked-role'] as string | undefined,
    },
    body,
  };
}

/**
 * Simple indentation-aware YAML parser supporting scalars, lists, and nested maps.
 * Handles the subset of YAML used in Claude Code agent frontmatter.
 */
function parseYamlBlock(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  return parseYamlLines(lines, 0).value as Record<string, unknown>;
}

function getIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function parseYamlLines(
  lines: string[],
  startIdx: number,
  parentIndent = -1,
): { value: Record<string, unknown>; endIdx: number } {
  const result: Record<string, unknown> = {};
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const indent = getIndent(line);
    if (indent <= parentIndent) break; // dedented past our level

    // List item: "  - something"
    const listMatch = line.match(/^(\s*)-\s+(.*)/);
    if (listMatch) {
      // This is a list item at the current level — handled by the caller
      break;
    }

    // Key-value: "key: value" or "key:"
    const kvMatch = line.match(/^(\s*)([a-zA-Z_][\w-]*):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[2];
      const rawVal = kvMatch[3].trim();

      if (rawVal) {
        // Inline value
        result[key] = parseScalar(rawVal);
        i++;
      } else {
        // Check what follows: list or nested map
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextTrimmed = nextLine.trim();
          const nextIndent = getIndent(nextLine);
          if (nextIndent > indent && nextTrimmed.startsWith('-')) {
            // It's a list
            const { value, endIdx } = parseYamlList(lines, i + 1, indent);
            result[key] = value;
            i = endIdx;
          } else if (nextIndent > indent) {
            // It's a nested map
            const { value, endIdx } = parseYamlLines(lines, i + 1, indent);
            result[key] = value;
            i = endIdx;
          } else {
            result[key] = '';
            i++;
          }
        } else {
          result[key] = '';
          i++;
        }
      }
    } else {
      i++;
    }
  }

  return { value: result, endIdx: i };
}

function parseYamlList(
  lines: string[],
  startIdx: number,
  parentIndent: number,
): { value: unknown[]; endIdx: number } {
  const result: unknown[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const indent = getIndent(line);
    if (indent <= parentIndent) break;

    const listMatch = line.match(/^(\s*)-\s+(.*)/);
    if (!listMatch) break;

    const itemIndent = getIndent(line);
    const itemVal = listMatch[2].trim();

    // Check if this is "- key: value" (inline map start)
    const inlineKv = itemVal.match(/^([a-zA-Z_][\w-]*):\s*(.*)/);
    if (inlineKv) {
      const key = inlineKv[1];
      const val = inlineKv[2].trim();

      if (val) {
        // "- key: value" — check for nested content below
        const mapItem: Record<string, unknown> = { [key]: parseScalar(val) };
        i++;
        // Collect any sibling keys at the same item indent + 2
        while (i < lines.length) {
          const nextLine = lines[i];
          if (!nextLine.trim()) { i++; continue; }
          const nextIndent = getIndent(nextLine);
          if (nextIndent <= itemIndent) break;
          const sibKv = nextLine.match(/^(\s*)([a-zA-Z_][\w-]*):\s*(.*)/);
          if (sibKv && nextIndent > itemIndent) {
            mapItem[sibKv[2]] = parseScalar(sibKv[3].trim());
            i++;
          } else break;
        }
        result.push(mapItem);
      } else {
        // "- key:" — nested content follows
        i++;
        if (i < lines.length) {
          const nextLine = lines[i];
          const nextIndent = getIndent(nextLine);
          const nextTrimmed = nextLine.trim();
          if (nextIndent > itemIndent && nextTrimmed.startsWith('-')) {
            const { value, endIdx } = parseYamlList(lines, i, itemIndent);
            result.push({ [key]: value });
            i = endIdx;
          } else if (nextIndent > itemIndent) {
            const { value, endIdx } = parseYamlLines(lines, i, itemIndent);
            result.push({ [key]: value });
            i = endIdx;
          } else {
            result.push({ [key]: '' });
          }
        } else {
          result.push({ [key]: '' });
        }
      }
    } else if (itemVal) {
      // Simple scalar list item
      result.push(parseScalar(itemVal));
      i++;
    } else {
      i++;
    }
  }

  return { value: result, endIdx: i };
}

function parseScalar(val: string): string | number | boolean {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  return stripQuotes(val);
}

function stripQuotes(val: string): string {
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

/**
 * Sync Claude Code subagent .md files into the office agent list.
 * Preserves existing manual agents and updates subagent-backed ones.
 * Returns the merged agent list.
 */
export async function syncClaudeSubagents(existingAgents: Agent[], workspaceDir?: string): Promise<Agent[]> {
  let files: AgentFileInfo[];
  try {
    files = await readClaudeAgentFiles(workspaceDir);
  } catch {
    return existingAgents; // Not in Electron or no claude CLI
  }
  if (files.length === 0) return existingAgents;

  // Build a map of existing subagent-backed agents by their file path
  const byFile = new Map<string, Agent>();
  for (const a of existingAgents) {
    if (a.subagentFile) byFile.set(a.subagentFile, a);
  }

  const manual = existingAgents.filter(a => !a.subagentFile);
  const synced: Agent[] = [];
  let colorIdx = manual.length;

  for (const file of files) {
    const { def, body } = parseSubagentFrontmatter(file.content);
    // outworked-name / outworked-role are our display fields;
    // fall back to Claude Code's name / description
    const name = def['outworked-name'] || def.name || file.file.replace(/\.md$/, '');
    const description = def['outworked-role'] || def.description || 'Claude Code Subagent';

    // Build the SubagentDef for runtime use
    const subagentDef: SubagentDef = {
      description,
      prompt: body || undefined,
      tools: def.tools,
      disallowedTools: def.disallowedTools,
      model: def.model,
      permissionMode: def.permissionMode,
      maxTurns: def.maxTurns,
      skills: def.skills,
      memory: def.memory,
      background: def.background,
      isolation: def.isolation,
      mcpServers: def.mcpServers,
      hooks: def.hooks,
    };

    const existing = byFile.get(file.path);
    if (existing) {
      // Update existing subagent agent — preserve history, position, sprite
      synced.push({
        ...existing,
        name,
        role: description,
        personality: body || existing.personality,
        subagentDef,
        subagentFile: file.path,
        agentScope: file.scope,
      });
    } else {
      // Create new office agent from subagent file
      const idx = colorIdx % SPRITE_KEYS.length;
      colorIdx++;
      synced.push({
        id: uuidv4(),
        name,
        role: description,
        personality: body || `You are ${name}, a Claude Code subagent. ${description}`,
        model: 'claude-code',
        provider: 'claude-code',
        skills: [],
        position: {
          x: Math.floor(Math.random() * 10) + 2,
          y: Math.floor(Math.random() * 6) + 2,
        },
        status: 'idle',
        currentThought: '',
        spriteKey: SPRITE_KEYS[idx],
        history: [],
        color: AGENT_COLORS[idx],
        todos: [],
        subagentFile: file.path,
        subagentDef,
        agentScope: file.scope,
      });
    }
  }

  // Merge: manual agents first, then synced subagents
  const result = [...manual, ...synced];
  saveAgents(result);
  return result;
}


export function makeAgentName() {
  const names = ['Alex', 'Sam', 'Charlie', 'Taylor', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Drew'];
  return names[Math.floor(Math.random() * names.length)];
}