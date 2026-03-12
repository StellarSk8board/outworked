export type ModelId =
  | 'gpt-5.4'
  | 'gpt-5.3-codex'
  | 'gpt-5.2'
  | 'gpt-5-mini'
  | 'claude-opus-4-6'
  | 'claude-sonnet-4-6'
  | 'claude-code'
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash'
  | 'gemini-2.0-flash'

export type Provider = 'openai' | 'anthropic' | 'google' | 'claude-code';

export interface SkillMetadata {
  emoji?: string;
  description?: string;
  requires?: {
    bins?: string[];
    anyBins?: string[];
    config?: string[];
  };
  install?: {
    id: string;
    kind: string;
    formula?: string;
    package?: string;
    bins?: string[];
    label: string;
  }[];
  os?: string[];
}

export interface AgentSkill {
  id: string;
  name: string;
  content: string; // markdown content
  description?: string;
  metadata?: SkillMetadata;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'speaking';

export interface AgentTodo {
  id: string;
  text: string;
  status: 'pending' | 'in-progress' | 'done' | 'error';
  result?: string;
  error?: string;
  timestamp: number;
}

export interface Agent {
  id: string;
  name: string;
  role: string; // job title shown under their sprite
  personality: string; // system prompt
  model: ModelId;
  provider: Provider;
  skills: AgentSkill[];
  position: { x: number; y: number }; // tile position in office grid
  status: AgentStatus;
  currentThought: string;
  spriteKey: string; // which 8-bit character to use
  history: Message[]; // conversation history
  color: string; // accent color for the employee card
  todos: AgentTodo[]; // per-agent task checklist
  isBoss?: boolean; // boss character — cannot be deleted
}

export interface ApiKeys {
  openai: string;
  anthropic: string;
  gemini: string;
  github: string;
}

export const MODELS: { id: ModelId; label: string; provider: Provider }[] = [
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', provider: 'openai' },
  { id: 'gpt-5.2', label: 'GPT-5.2', provider: 'openai' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini', provider: 'openai' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'google' },
  { id: 'claude-code', label: 'Claude Code (local)', provider: 'claude-code' },
];

export const SPRITE_KEYS = [
  'char_blue',
  'char_red',
  'char_green',
  'char_yellow',
  'char_purple',
  'char_orange',
  'char_pink',
  'char_teal',
];

export const AGENT_COLORS = [
  '#6366f1', // indigo
  '#ef4444', // red
  '#22c55e', // green
  '#eab308', // yellow
  '#a855f7', // purple
  '#f97316', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
];
