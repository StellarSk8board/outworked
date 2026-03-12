import { Agent, AgentSkill, AgentTodo, ApiKeys, Message } from './types';
import { sendMessage } from './ai';
import { listFiles, writeFile } from './filesystem';

export interface NewAgentSpec {
  name: string;
  role: string;
  personality: string;
}

export interface TaskAssignment {
  agentId: string;
  agentName: string;
  task: string;
}

export interface OrchestrationResult {
  assignments: TaskAssignment[];
  plan: string;
  newAgents: NewAgentSpec[];
  workingDirectory: string;
}

const ROUTER_SYSTEM = `You are the Office Manager. You receive high-level instructions and break them into tasks assigned to specific employees.

You will be given a list of current employees with their names, roles, and what they're good at. Given the user's instruction, decide which employee(s) should handle which part of the work. Not Every employee needs to be assigned a task — only assign relevant ones. You can also create new employees if needed (see below).

IMPORTANT: If the task requires expertise that NO current employee has, you MUST create new employees with the right skills. For example, if the task needs a backend engineer but only a designer exists, create one.

You will also be given a list of existing project directories in the workspace. If one of them matches the prompt (e.g. same project name or topic), reuse it as the workingDirectory. Otherwise, pick a short, descriptive slug for a NEW workingDirectory (lowercase, hyphens, no spaces — like "recipe-api" or "landing-page").

RESPOND in this exact JSON format and nothing else:
{
  "plan": "Brief summary of the plan",
  "workingDirectory": "short-slug",
  "newAgents": [
    { "name": "UniqueFirstName", "role": "Job Title", "personality": "Detailed system prompt for this specialist" }
  ],
  "assignments": [
    { "agentName": "ExactEmployeeName", "task": "Specific task description for this employee" }
  ]
}

Rules:
- "newAgents" can be an empty array if existing employees are sufficient
- You may only add 5 new employees per instruction — be concise and only create what is necessary
- New agents should have distinct names, clear roles, and detailed personality prompts that define their expertise
- You may assign tasks to both existing AND newly created employees
- Use EXACT employee names (existing or newly created) in assignments
- Each assignment should be a clear, actionable task
- You may assign multiple tasks to one employee or spread across employees
- All employees share the same project working directory — coordinate their work so they don't overwrite each other
- The workingDirectory should be reused if an existing directory is relevant, or a new short slug if not`;

export async function routeTasks(
  instruction: string,
  agents: Agent[],
  keys: ApiKeys,
  routerModel: { model: Agent['model']; provider: Agent['provider'] }
): Promise<OrchestrationResult> {
  const employeeList = agents
    .map((a) => `- ${a.name} (${a.role}): ${a.personality.slice(0, 120)}`)
    .join('\n');

  // List top-level directories in the workspace so the router can reuse one
  const existingDirs = await listFiles();
  const dirList = existingDirs
    .split('\n')
    .filter((p) => p.endsWith('/'))
    .map((p) => p.replace(/\/$/, ''))
    .filter(Boolean);
  const dirsSection = dirList.length > 0
    ? `## Existing project directories\n${dirList.map((d) => `- ${d}`).join('\n')}`
    : '## Existing project directories\n(none)';

  const prompt = `## Employees\n${employeeList}\n\n${dirsSection}\n\n## Instruction\n${instruction}`;

  // Create a temporary "router" agent
  const routerAgent: Agent = {
    id: '__router__',
    name: 'Office Manager',
    role: 'Router',
    personality: ROUTER_SYSTEM,
    model: routerModel.model,
    provider: routerModel.provider,
    skills: [],
    position: { x: 0, y: 0 },
    status: 'thinking',
    currentThought: '',
    spriteKey: '',
    history: [],
    color: '#888',
    todos: [],
  };

  const reply = await sendMessage(
    routerAgent,
    prompt,
    keys,
    () => {},
    undefined,
    { useTools: false },
  );

  try {
    // Extract JSON from reply (handle markdown code blocks)
    const jsonStr = reply.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    // Parse new agent specs
    const newAgents: NewAgentSpec[] = (parsed.newAgents || []).map(
      (a: { name: string; role: string; personality: string }) => ({
        name: a.name,
        role: a.role,
        personality: a.personality,
      })
    );

    const assignments: TaskAssignment[] = (parsed.assignments || []).map(
      (a: { agentName: string; task: string }) => {
        const agent = agents.find(
          (ag) => ag.name.toLowerCase() === a.agentName.toLowerCase()
        );
        return {
          agentId: agent?.id ?? '', // empty string means it's a new agent — resolved after creation
          agentName: a.agentName,
          task: a.task,
        };
      }
    );

    // Ensure the working directory exists
    const workDir = sanitizeSlug(parsed.workingDirectory || 'project');
    await ensureWorkingDirectory(workDir);

    return { assignments, plan: parsed.plan || '', newAgents, workingDirectory: workDir };
  } catch {
    // Fallback: assign the whole thing to the first agent
    const fallbackDir = 'project';
    await ensureWorkingDirectory(fallbackDir);
    return {
      plan: 'Could not parse routing — assigning to first available employee.',
      assignments: agents.length > 0
        ? [{ agentId: agents[0].id, agentName: agents[0].name, task: instruction }]
        : [],
      newAgents: [],
      workingDirectory: fallbackDir,
    };
  }
}

/**
 * Sanitise a router-suggested directory name into a safe slug.
 */
function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'project';
}

/**
 * Create the working directory if it doesn't already exist.
 * Uses writeFile with a marker file since the filesystem auto-creates parent dirs.
 */
async function ensureWorkingDirectory(dir: string): Promise<void> {
  const listing = await listFiles(dir);
  // If the directory already has files, it exists — nothing to do
  if (!listing.startsWith('No files')) return;
  // Create an empty marker so the directory is created
  await writeFile(`${dir}/.outworked`, `# Working directory created ${new Date().toISOString()}\n`);
}

/**
 * Execute a task assignment by sending it to the agent's chat
 */
export async function executeTask(
  agent: Agent,
  task: string,
  keys: ApiKeys,
  onThought: (text: string) => void,
  signal?: AbortSignal,
  skills?: AgentSkill[],
  workingDirectory?: string,
): Promise<{ agent: Agent; reply: string }> {
  // Build a strong system-level directive so agents respect the working directory
  const extraSystemPrompt = workingDirectory
    ? `\n\n## IMPORTANT — Project Directory\nThis project's root is "${workingDirectory}/". You MUST:\n- Prefix EVERY file path with "${workingDirectory}/" (e.g. "${workingDirectory}/src/index.js", NOT "src/index.js")\n- Pass cwd: "${workingDirectory}" to every run_command call\n- NEVER write files to paths outside "${workingDirectory}/"\nViolating this will break the project structure.`
    : undefined;

  const userMsg: Message = {
    role: 'user',
    content: `[OFFICE TASK] ${task}\n\nPlease complete this task. If you need to write code, include it in code blocks. Explain what you did briefly.${workingDirectory ? ` Remember: all files go under ${workingDirectory}/.` : ''}`,
    timestamp: Date.now(),
  };

  const updatedAgent: Agent = {
    ...agent,
    history: [...agent.history, userMsg],
    status: 'working',
    currentThought: 'Working on task...',
  };

  const reply = await sendMessage(
    updatedAgent,
    userMsg.content,
    keys,
    onThought,
    signal,
    { skills, extraSystemPrompt },
  );

  const assistantMsg: Message = {
    role: 'assistant',
    content: reply,
    timestamp: Date.now(),
  };

  return {
    agent: {
      ...updatedAgent,
      history: [...updatedAgent.history, assistantMsg],
      status: 'idle',
      currentThought: reply.slice(0, 80) + (reply.length > 80 ? '...' : ''),
    },
    reply,
  };
}

/**
 * Ask the agent to break a task into a checklist of to-do items.
 */
export async function generateTodoList(
  agent: Agent,
  task: string,
  keys: ApiKeys,
  skills?: AgentSkill[],
): Promise<AgentTodo[]> {
  const prompt = `Break down this task into a short checklist of 3-6 concrete action items. Respond ONLY with a JSON array of strings — no extra text.\n\nTask: ${task}`;

  const tempAgent: Agent = {
    ...agent,
    history: [],
  };

  const reply = await sendMessage(tempAgent, prompt, keys, () => {}, undefined, { useTools: false, skills });

  try {
    const jsonStr = reply.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const items: string[] = JSON.parse(jsonStr);
    if (!Array.isArray(items)) throw new Error('Not an array');
    return items.map((text) => ({
      id: crypto.randomUUID(),
      text: typeof text === 'string' ? text : String(text),
      status: 'pending' as const,
      timestamp: Date.now(),
    }));
  } catch {
    // Fallback: single todo with the whole task
    return [{
      id: crypto.randomUUID(),
      text: task,
      status: 'pending' as const,
      timestamp: Date.now(),
    }];
  }
}
