import { Agent, AgentSkill, ApiKeys, AGENT_COLORS, SPRITE_KEYS } from './types';
import { v4 as uuidv4 } from 'uuid';

const AGENTS_KEY = 'outworked_agents';
const SELECTED_AGENT_KEY = 'outworked_selected_agent';
const SKILLS_KEY = 'outworked_skills';

const DEFAULT_AGENTS: Agent[] = [
  {
    id: uuidv4(),
    name: 'Boss',
    role: 'Office Manager',
    personality:
      'You are the Boss, the office orchestrator. You coordinate work across the team, delegate tasks to the right employees, create new specialists when needed, and keep everyone on track. For any non-trivial work request, use route_work to orchestrate the full pipeline. You speak with authority but are fair and encouraging.',
    model: 'gpt-5.4',
    provider: 'openai',
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
  {
    id: uuidv4(),
    name: 'Alex',
    role: 'Product Manager',
    personality:
      'You are Alex, a focused product manager. You are concise, data-driven, and always prioritize user value. You think in terms of roadmaps, user stories, and OKRs.',
    model: 'gpt-5.4',
    provider: 'openai',
    skills: [],
    position: { x: 2, y: 2 },
    status: 'idle',
    currentThought: 'Reviewing the product roadmap...',
    spriteKey: 'char_blue',
    history: [],
    color: AGENT_COLORS[0],
    todos: [],
  },
  {
    id: uuidv4(),
    name: 'Sam',
    role: 'Engineer',
    personality:
      'You are Sam, a senior software engineer. You love clean code, system design, and solving hard problems. You are pragmatic and detail-oriented.',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    skills: [],
    position: { x: 5, y: 2 },
    status: 'idle',
    currentThought: 'Debugging a tricky issue...',
    spriteKey: 'char_green',
    history: [],
    color: AGENT_COLORS[2],
    todos: [],
  },
  {
    id: uuidv4(),
    name: 'Jordan',
    role: 'Designer',
    personality:
      'You are Jordan, a creative UX designer. You care deeply about aesthetics, user experience, and accessibility. You think visually and love pixel art.',
    model: 'gpt-5.4',
    provider: 'openai',
    skills: [],
    position: { x: 8, y: 4 },
    status: 'idle',
    currentThought: 'Sketching a new UI component...',
    spriteKey: 'char_pink',
    history: [],
    color: AGENT_COLORS[6],
    todos: [],
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

export function createAgent(partial: Partial<Agent>): Agent {
  const idx = Math.floor(Math.random() * SPRITE_KEYS.length);
  return {
    id: uuidv4(),
    name: 'New Employee',
    role: 'Assistant',
    personality: 'You are a helpful AI assistant working in the office.',
    model: 'gpt-5.4',
    provider: 'openai',
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

// API keys in sessionStorage so they don't persist after tab close
export function loadApiKeys(): ApiKeys {
  if (typeof window === 'undefined') return { openai: '', anthropic: '', gemini: '', github: '' };
  return {
    openai: localStorage.getItem('outworked_key_openai') ?? '',
    anthropic: localStorage.getItem('outworked_key_anthropic') ?? '',
    gemini: localStorage.getItem('outworked_key_gemini') ?? '',
    github: localStorage.getItem('outworked_key_github') ?? '',
  };
}

export function saveApiKeys(keys: ApiKeys): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('outworked_key_openai', keys.openai);
  localStorage.setItem('outworked_key_anthropic', keys.anthropic);
  localStorage.setItem('outworked_key_gemini', keys.gemini);
  localStorage.setItem('outworked_key_github', keys.github);
}

export function resetProject(agents: Agent[]): Agent[] {
  const cleared = agents.map((a) => ({ ...a, history: [], todos: [], status: 'idle' as const, currentThought: '' }));
  saveAgents(cleared);
  if (typeof window !== 'undefined') localStorage.removeItem(SELECTED_AGENT_KEY);
  return cleared;
}

export function getSelectedAgentId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SELECTED_AGENT_KEY);
}

export function setSelectedAgentId(id: string | null): void {
  if (typeof window === 'undefined') return;
  if (id) {
    localStorage.setItem(SELECTED_AGENT_KEY, id);
  } else {
    localStorage.removeItem(SELECTED_AGENT_KEY);
  }
}
