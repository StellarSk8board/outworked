import { useState, useRef, useEffect } from 'react';
import { Agent, AgentSkill, AgentTodo, /* ApiKeys, */ Message, MODELS, ToolCall } from '../lib/types';
import { sendMessage } from '../lib/ai';
import { executeTask, generateTodoList, routeTasks } from '../lib/orchestrator';
import { createAgent, createClaudeAgentFile } from '../lib/storage';
import { sendClaudeCodeInput, PermissionRequest } from '../lib/terminal';

export interface OrchestrationDoneEvent {
  success: number;
  failed: number;
  plan: string;
  agents: string[];
}

interface ChatWindowProps {
  agent: Agent | null;
  agents: Agent[];
  skills: AgentSkill[];
  onUpdateAgent: (agent: Agent) => void;
  onAddAgent: (agent: Agent) => void;
  agentTeamsEnabled?: boolean;
  onOrchestrationDone?: (event: OrchestrationDoneEvent) => void;
}

const EMPTY_KEYS = { openai: '', anthropic: '', gemini: '', github: '' };

export default function ChatWindow({ agent, agents, skills, onUpdateAgent, onAddAgent, agentTeamsEnabled, onOrchestrationDone }: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('outworked_debug') === '1');
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const debugBottomRef = useRef<HTMLDivElement>(null);

  function addDebug(line: string) {
    const ts = new Date().toISOString().slice(11, 23);
    setDebugLog(prev => [...prev.slice(-500), `[${ts}] ${line}`]);
  }

  function toggleDebug() {
    const next = !debugMode;
    setDebugMode(next);
    localStorage.setItem('outworked_debug', next ? '1' : '0');
    if (next) setShowDebug(true);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent?.history, streamingText]);

  useEffect(() => {
    debugBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debugLog]);

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
        <div className="text-4xl">🖥️</div>
        <p className="text-xs font-pixel text-slate-300">Click on an employee in the office to start chatting</p>
      </div>
    );
  }

  async function handleSend() {
    if (!input.trim() || isStreaming || !agent) return;
    const userText = input.trim();
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    const userMsg: Message = { role: 'user', content: userText, timestamp: Date.now() };
    const updatedWithUser: Agent = {
      ...agent,
      history: [...agent.history, userMsg],
      status: 'thinking',
      currentThought: 'Thinking...',
    };
    onUpdateAgent(updatedWithUser);

    abortRef.current = new AbortController();

    const isBoss = !!agent.isBoss;
    if (debugMode) {
      setDebugLog([]);
      setShowDebug(true);
      addDebug(`--- New message to ${agent.name} (${isBoss ? 'boss' : 'agent'}) ---`);
      addDebug(`User: ${userText.slice(0, 200)}`);
    }

    try {
      let reply: string;

      if (isBoss) {
        // Boss = orchestrator. Route the user's message through the orchestrator pipeline.
        reply = await handleBossOrchestrate(updatedWithUser, userText);
      } else {
        // Regular agent: direct chat with tools
        reply = await handleRegularChat(updatedWithUser, userText);
      }

      const assistantMsg: Message = { role: 'assistant', content: reply, timestamp: Date.now() };
      onUpdateAgent({
        ...updatedWithUser,
        history: [...updatedWithUser.history, assistantMsg],
        status: 'idle',
        currentThought: reply.slice(0, 80) + (reply.length > 80 ? '...' : ''),
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      if (errorMsg !== 'AbortError') {
        const errMsg: Message = { role: 'assistant', content: `⚠️ Error: ${errorMsg}`, timestamp: Date.now() };
        onUpdateAgent({
          ...updatedWithUser,
          history: [...updatedWithUser.history, errMsg],
          status: 'idle',
          currentThought: '',
        });
      } else {
        onUpdateAgent({ ...updatedWithUser, status: 'idle', currentThought: '' });
      }
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      abortRef.current = null;
    }

    // ── Boss orchestrator flow ───────────────────────────────────
    // The Boss ALWAYS delegates: plans tasks via JSON, then dispatches
    // each task to the assigned employee as a separate Claude Code process.
    async function handleBossOrchestrate(bossAgent: Agent, userText: string): Promise<string> {
      const employees = agents.filter(a => !a.isBoss);

      // ── Step 1: Plan ──
      onUpdateAgent({ ...bossAgent, status: 'thinking', currentThought: '🧠 Planning task assignments...' });
      setStreamingText('🧠 Analyzing the request and creating a plan...\n');
      if (debugMode) addDebug(`[boss] Planning with ${employees.length} employees`);

      const routerModel = { model: bossAgent.model, provider: bossAgent.provider };
      const result = await routeTasks(userText, employees, EMPTY_KEYS, routerModel);

      if (debugMode) addDebug(`[boss] Plan: ${result.plan}, ${result.assignments.length} assignments, ${result.newAgents.length} new agents`);

      // ── Step 2: Create new agents if needed ──
      const newAgents: Agent[] = [];
      const wsDir = localStorage.getItem('outworked_workspace_dir') || undefined;
      for (const spec of result.newAgents) {
        if (employees.find(a => a.name.toLowerCase() === spec.name.toLowerCase())) continue;
        if (newAgents.find(a => a.name.toLowerCase() === spec.name.toLowerCase())) continue;
        const newAgent = createAgent({
          name: spec.name,
          role: spec.role,
          personality: spec.personality,
          position: { x: Math.floor(Math.random() * 10) + 2, y: Math.floor(Math.random() * 6) + 2 },
        }, true);
        newAgents.push(newAgent);
        onAddAgent(newAgent);
        // Persist agent file so Claude Code can use it
        createClaudeAgentFile(newAgent, wsDir);
      }

      const allEmployees = [...employees, ...newAgents];

      // ── Step 3: Resolve assignments ──
      const assignments = result.assignments
        .map(a => {
          const match = allEmployees.find(ag => ag.name.toLowerCase() === a.agentName.toLowerCase());
          return { ...a, agentId: match?.id ?? '' };
        })
        .filter(a => a.agentId);

      if (assignments.length === 0) {
        onUpdateAgent({ ...bossAgent, status: 'idle', currentThought: '' });
        return 'I couldn\'t assign any tasks. Try hiring employees with the right skills first, then tell me what you need.';
      }

      // ── Step 4: Create todos on Boss ──
      const bossTodos: AgentTodo[] = assignments.map((a, i) => ({
        id: `boss-${Date.now()}-${i}`,
        text: `→ ${a.agentName}: ${a.task}`,
        status: 'pending' as const,
        timestamp: Date.now(),
      }));
      onUpdateAgent({
        ...bossAgent,
        todos: [...(bossAgent.todos || []), ...bossTodos],
        status: 'working',
        currentThought: `📋 ${assignments.length} tasks to delegate`,
      });

      // ── Show plan ──
      let progress = `📝 **Plan:** ${result.plan}\n`;
      if (newAgents.length > 0) {
        progress += `👥 **New hires:** ${newAgents.map(a => `${a.name} (${a.role})`).join(', ')}\n`;
      }
      progress += `\n**Tasks:**\n${assignments.map(a => `- **${a.agentName}**: ${a.task}`).join('\n')}\n\n⏳ Executing tasks...\n`;
      setStreamingText(progress);

      // ── Step 5: Execute tasks sequentially ──
      const taskResults: { agentName: string; success: boolean; reply: string }[] = new Array(assignments.length);

      for (let idx = 0; idx < assignments.length; idx++) {
        const assignment = assignments[idx];
        const emp = allEmployees.find(a => a.id === assignment.agentId);
        if (!emp) {
          taskResults[idx] = { agentName: assignment.agentName, success: false, reply: 'Agent not found' };
          continue;
        }

        // Mark boss todo in-progress
        bossTodos[idx] = { ...bossTodos[idx], status: 'in-progress' };
        onUpdateAgent({
          ...bossAgent,
          todos: [...(bossAgent.todos || []).filter(t => !bossTodos.some(bt => bt.id === t.id)), ...bossTodos],
        });

        // Generate sub-task checklist for the employee
        onUpdateAgent({ ...emp, status: 'working', currentThought: `Planning: ${assignment.task.slice(0, 60)}...` });
        if (debugMode) addDebug(`[boss] Generating todo list for ${emp.name}: ${assignment.task.slice(0, 100)}`);

        let empTodos: AgentTodo[] = [];
        try {
          empTodos = await generateTodoList(emp, assignment.task, EMPTY_KEYS, skills);
        } catch {
          // Fallback: single todo
          empTodos = [{ id: crypto.randomUUID(), text: assignment.task, status: 'pending', timestamp: Date.now() }];
        }

        // Start with all todos as pending
        let currentAgent: Agent = {
          ...emp,
          todos: [...(emp.todos ?? []), ...empTodos.map(t => ({ ...t, status: 'pending' as const }))],
        };
        onUpdateAgent({ ...currentAgent, status: 'working', currentThought: `Starting: ${assignment.task.slice(0, 60)}...` });

        // Execute each sub-task one at a time
        const replies: string[] = [];
        let hadError = false;

        for (let ti = 0; ti < empTodos.length; ti++) {
          const todo = empTodos[ti];
          if (debugMode) addDebug(`[boss] ${emp.name} step ${ti + 1}/${empTodos.length}: ${todo.text.slice(0, 80)}`);

          // Mark this todo in-progress
          currentAgent = {
            ...currentAgent,
            todos: currentAgent.todos.map(t => t.id === todo.id ? { ...t, status: 'in-progress' as const } : t),
          };
          onUpdateAgent({ ...currentAgent, status: 'working', currentThought: `[${ti + 1}/${empTodos.length}] ${todo.text.slice(0, 60)}` });

          try {
            const context = ti > 0
              ? `\n\nContext from previous steps:\n${replies.map((r, i) => `Step ${i + 1}: ${r.slice(0, 200)}`).join('\n')}`
              : '';
            const { agent: updatedAgent, reply } = await executeTask(
              currentAgent,
              `[Step ${ti + 1}/${empTodos.length}] ${todo.text}${context}`,
              EMPTY_KEYS,
              (partial) => onUpdateAgent({ ...currentAgent, status: 'working', currentThought: `[${ti + 1}/${empTodos.length}] ${partial.slice(0, 70)}` }),
              abortRef.current?.signal, skills,
            );
            replies.push(reply);

            // Mark this todo done, update agent with new history
            currentAgent = {
              ...updatedAgent,
              todos: updatedAgent.todos.map(t => t.id === todo.id ? { ...t, status: 'done' as const } : t),
            };
            onUpdateAgent(currentAgent);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Unknown error';
            currentAgent = {
              ...currentAgent,
              todos: currentAgent.todos.map(t => t.id === todo.id ? { ...t, status: 'error' as const, error: errMsg } : t),
            };
            onUpdateAgent({ ...currentAgent, status: 'idle', currentThought: '' });
            replies.push(`Error: ${errMsg}`);
            hadError = true;
            if (debugMode) addDebug(`[boss] ${emp.name} step ${ti + 1} failed: ${errMsg}`);
            break; // Stop remaining steps on error
          }
        }

        // Final state for this employee
        onUpdateAgent({ ...currentAgent, status: 'idle', currentThought: '' });

        if (!hadError) {
          bossTodos[idx] = { ...bossTodos[idx], status: 'done' };
          taskResults[idx] = { agentName: assignment.agentName, success: true, reply: replies.join('\n\n') };
          if (debugMode) addDebug(`[boss] ${emp.name} completed all ${empTodos.length} steps`);
        } else {
          bossTodos[idx] = { ...bossTodos[idx], status: 'error' };
          taskResults[idx] = { agentName: assignment.agentName, success: false, reply: replies.join('\n\n') };
          if (debugMode) addDebug(`[boss] ${emp.name} failed`);
        }
      }

      // ── Step 6: Summary ──
      // Update boss todos (bossAgent is stale but bossTodos were mutated with correct statuses)
      onUpdateAgent({
        ...bossAgent,
        todos: [...(bossAgent.todos || []).filter(t => !bossTodos.some(bt => bt.id === t.id)), ...bossTodos],
        status: 'idle',
        currentThought: 'All tasks completed',
      });

      // NOTE: Do NOT reset employees here — the individual task handlers above
      // already set each agent to idle with the correct todos/history.
      // Spreading stale `emp` refs would overwrite their completed todos.

      const successCount = taskResults.filter(t => t?.success).length;
      const failCount = taskResults.filter(t => t && !t.success).length;

      const summaryParts = [progress, '\n---\n\n**Results:**\n'];
      for (const tr of taskResults) {
        if (!tr) continue;
        const icon = tr.success ? '✅' : '❌';
        summaryParts.push(`${icon} **${tr.agentName}:** ${tr.reply.slice(0, 500)}\n`);
      }
      summaryParts.push(`\n---\n`);
      summaryParts.push(failCount === 0
        ? `✅ **All ${successCount} task${successCount !== 1 ? 's' : ''} completed successfully!**`
        : `⚠️ **${successCount}/${successCount + failCount} tasks completed.** ${failCount} failed.`);

      const finalText = summaryParts.join('');
      setStreamingText(finalText);

      // Notify parent so it can show a toast over the office
      onOrchestrationDone?.({
        success: successCount,
        failed: failCount,
        plan: result.plan,
        agents: assignments.map(a => a.agentName),
      });

      return finalText;
    }

    // ── Regular agent chat flow ──────────────────────────────────
    async function handleRegularChat(agentState: Agent, userText: string): Promise<string> {
      return await sendMessage(
        agentState,
        userText,
        EMPTY_KEYS,
        (partial) => {
          setStreamingText(partial);
          onUpdateAgent({
            ...agentState,
            status: 'speaking',
            currentThought: partial.slice(0, 80) + (partial.length > 80 ? '...' : ''),
          });
        },
        abortRef.current!.signal,
        {
          skills,
          onToolCall: (call) => {
            // Handle todo updates directly
            if (call.name === 'update_todos') {
              const raw = call.args.todos as AgentTodo[];
              if (Array.isArray(raw)) {
                const todos: AgentTodo[] = raw.map((t: AgentTodo) => ({
                  id: String(t.id),
                  text: t.text,
                  status: t.status,
                  timestamp: Date.now(),
                }));
                onUpdateAgent({ ...agentState, todos, status: 'working', currentThought: `📋 Planning ${todos.length} tasks` });
              }
              return;
            }

            const toolLabel =
              call.name === 'run_command' ? `$ ${call.args.command}` :
              call.name === 'write_file' ? `Writing ${call.args.path}` :
              call.name === 'read_file' ? `Reading ${call.args.path}` :
              call.name === 'delete_file' ? `Deleting ${call.args.path}` :
              call.name === 'execute_code' ? 'Running code' :
              call.name === 'list_files' ? 'Listing files' :
              call.name;
            onUpdateAgent({
              ...agentState,
              status: 'working',
              currentThought: `🔧 ${toolLabel}`,
            });
            if (debugMode) addDebug(`[event] tool_call: ${call.name} ${JSON.stringify(call.args).slice(0, 200)}`);
          },
          // Claude Code stream events for subagent employees
          onClaudeCodeEvent: agentState.subagentDef ? (event) => {
            if (event.type === 'tool_use' && event.toolName) {
              onUpdateAgent({
                ...agentState,
                status: 'working',
                currentThought: `🔧 ${event.toolName}${event.toolInput?.file_path ? ` ${event.toolInput.file_path}` : ''}`,
              });
            }
          } : undefined,
          onPermissionRequest: (request) => {
            setPendingPermission(request);
          },
          onStderr: debugMode ? (text) => addDebug(`[stderr] ${text.trim()}`) : undefined,
        },
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  async function handlePermissionResponse(allow: boolean) {
    if (!pendingPermission) return;
    const { reqId } = pendingPermission;
    setPendingPermission(null);
    // Send "yes" or "no" followed by newline to the Claude Code process stdin
    await sendClaudeCodeInput(reqId, allow ? 'yes\n' : 'no\n');
  }

  const model = MODELS.find((m) => m.id === agent.model);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-600 bg-slate-900">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: agent.color }} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-pixel text-white truncate">{agent.name}</p>
          <p className="text-[11px] font-pixel truncate" style={{ color: agent.color }}>{agent.role}</p>
        </div>
        <span className="text-[11px] font-pixel text-slate-400 shrink-0">
          {agent.subagentFile ? '⚡ Claude Code' : model?.label ?? agent.model}
        </span>
        <button
          onClick={toggleDebug}
          className={`text-[9px] px-1.5 py-0.5 rounded font-pixel transition-colors ${
            debugMode ? 'bg-amber-700 text-amber-100' : 'bg-slate-800 text-slate-500 hover:text-slate-300'
          }`}
          title={debugMode ? 'Debug ON — click to disable' : 'Enable debug mode'}
        >
          🐛
        </button>
      </div>

      {/* Status — enhanced for waiting/stuck states */}
      {(agent.status === 'stuck' || agent.status === 'waiting-input' || agent.status === 'waiting-approval') && (
        <div className={`px-3 py-2 border-b border-slate-600 ${
          agent.status === 'stuck' ? 'bg-red-900/30 border-red-700/40' :
          agent.status === 'waiting-approval' ? 'bg-amber-900/30 border-amber-700/40' :
          'bg-orange-900/30 border-orange-700/40'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${agent.status === 'stuck' ? 'animate-pulse' : ''}`}>
              {agent.status === 'stuck' ? '⚠️' : agent.status === 'waiting-approval' ? '🔒' : '⏸️'}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`text-[11px] font-pixel ${
                agent.status === 'stuck' ? 'text-red-300' :
                agent.status === 'waiting-approval' ? 'text-amber-300' :
                'text-orange-300'
              }`}>
                {agent.status === 'stuck' ? 'Agent is stuck — no progress detected' :
                 agent.status === 'waiting-approval' ? 'Waiting for permission approval' :
                 'Waiting for more instructions'}
              </p>
              {agent.currentThought && (
                <p className="text-[10px] font-mono text-slate-400 truncate mt-0.5">{agent.currentThought}</p>
              )}
            </div>
            {agent.status === 'stuck' && (
              <button
                onClick={() => {
                  setInput(`The previous task seems stuck. Please try a different approach or let me know what's blocking you.`);
                }}
                className="btn-pixel text-[9px] bg-red-700 hover:bg-red-600 text-white px-2 py-0.5 shrink-0"
              >
                Nudge
              </button>
            )}
            {agent.status === 'waiting-input' && (
              <button
                onClick={() => {
                  const textarea = document.querySelector('textarea');
                  textarea?.focus();
                }}
                className="btn-pixel text-[9px] bg-orange-700 hover:bg-orange-600 text-white px-2 py-0.5 shrink-0"
              >
                Reply
              </button>
            )}
          </div>
        </div>
      )}
      {agent.currentThought && agent.status !== 'stuck' && agent.status !== 'waiting-input' && agent.status !== 'waiting-approval' && (
        <div className="px-3 py-1.5 bg-slate-800 border-b border-slate-600">
          <p className="text-[11px] font-mono text-yellow-400 truncate">💭 {agent.currentThought}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 font-mono overflow-y-auto px-3 py-2 space-y-2">
        {agent.isBoss && (
          <div className="text-center pt-4">
            <p className="text-[11px] font-pixel text-slate-400">Boss will assign tasks to the right agents. Just tell Boss what you need.</p>
            <p className="text-[11px] font-pixel text-slate-400">Boss can also hire new agents if needed.</p>
          </div>
        )}

        {agent.history.length === 0 && (
          <div className="text-center pt-4">
            <p className="text-[11px] font-pixel text-slate-400">Say hi to {agent.name}!</p>
          </div>
        )}

        {agent.history.map((msg, i) => {
          // Detect boss orchestration results for special rendering
          const isBossResult = msg.role === 'assistant' && agent.isBoss && msg.content.includes('**Results:**');
          const allSucceeded = isBossResult && msg.content.includes('All') && msg.content.includes('completed successfully');

          if (isBossResult) {
            return (
              <div key={i} className="flex justify-start">
                <div className={`max-w-[90%] rounded-lg border overflow-hidden ${
                  allSucceeded
                    ? 'border-emerald-600/40 bg-emerald-950/30'
                    : 'border-amber-600/40 bg-amber-950/20'
                }`}>
                  <div className={`px-3 py-1.5 border-b ${
                    allSucceeded
                      ? 'bg-emerald-900/30 border-emerald-700/30'
                      : 'bg-amber-900/20 border-amber-700/30'
                  }`}>
                    <span className="text-[11px] font-pixel" style={{ color: allSucceeded ? '#34d399' : '#fbbf24' }}>
                      {allSucceeded ? '✅ Tasks Complete' : '⚠️ Tasks Finished'}
                    </span>
                  </div>
                  <div className="px-3 py-2 text-[12px] font-mono leading-7 whitespace-pre-wrap break-words text-gray-100">
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] px-2.5 py-1.5 rounded text-[12px] font-mono leading-7 whitespace-pre-wrap break-words ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-700 text-gray-100'
                }`}
              >
                {msg.content}
              </div>
            </div>
          );
        })}
        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div className={`max-w-[85%] px-2.5 py-1.5 rounded text-[12px] font-mono leading-7 whitespace-pre-wrap break-words ${
              streamingText.includes('completed successfully')
                ? 'bg-emerald-950/30 border border-emerald-600/40 text-gray-100'
                : 'bg-slate-700 text-gray-100'
            }`}>
              {streamingText}
              {!streamingText.includes('completed successfully') && !streamingText.includes('tasks completed') && (
                <span className="inline-block w-1.5 h-3 bg-gray-400 ml-0.5 animate-pulse align-middle" />
              )}
            </div>
          </div>
        )}
        {isStreaming && !streamingText && (
          <div className="flex justify-start">
            <div className="px-2.5 py-1.5 rounded bg-slate-700">
              <span className="text-[11px] font-mono text-slate-300 animate-pulse">thinking...</span>
            </div>
          </div>
        )}
        {pendingPermission && (
          <div className="mx-auto max-w-[90%] bg-amber-900/40 border border-amber-600/50 rounded-lg p-3 animate-slide-up">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-amber-400 text-sm">🔒</span>
              <span className="text-[11px] font-pixel text-amber-200">Permission Requested</span>
            </div>
            <p className="text-[11px] text-amber-100/80 font-mono mb-1">
              <span className="text-amber-300 font-bold">{pendingPermission.tool}</span>
            </p>
            <p className="text-[10px] text-amber-200/60 mb-2">{pendingPermission.description}</p>
            <div className="flex gap-2">
              <button
                onClick={() => handlePermissionResponse(true)}
                className="btn-pixel text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-0.5"
              >
                ✓ Allow
              </button>
              <button
                onClick={() => handlePermissionResponse(false)}
                className="btn-pixel text-[10px] bg-red-700 hover:bg-red-600 text-white px-3 py-0.5"
              >
                ✕ Deny
              </button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Debug log panel */}
      {debugMode && showDebug && debugLog.length > 0 && (
        <div className="border-t border-amber-800/50 bg-slate-950 max-h-40 overflow-y-auto">
          <div className="flex items-center justify-between px-2 py-1 bg-amber-900/30 border-b border-amber-800/40 sticky top-0">
            <span className="text-[9px] font-pixel text-amber-400">🐛 Debug Log ({debugLog.length})</span>
            <div className="flex gap-1">
              <button onClick={() => setDebugLog([])} className="text-[9px] text-slate-500 hover:text-amber-300 px-1">Clear</button>
              <button onClick={() => setShowDebug(false)} className="text-[9px] text-slate-500 hover:text-amber-300 px-1">Hide</button>
            </div>
          </div>
          <div className="px-2 py-1 space-y-0">
            {debugLog.map((line, i) => (
              <pre key={i} className={`text-[9px] font-mono leading-tight whitespace-pre-wrap break-all ${
                line.includes('[stderr]') ? 'text-red-400/80' :
                line.includes('[raw]') ? 'text-cyan-400/60' :
                line.includes('[team]') ? 'text-amber-400/70' :
                line.includes('[event]') ? 'text-purple-400/70' :
                'text-slate-500'
              }`}>{line}</pre>
            ))}
            <div ref={debugBottomRef} />
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2 border-t border-slate-600 bg-slate-900">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agent.name}...`}
            disabled={isStreaming}
            rows={2}
            className="input-mono flex-1 bg-slate-800 border border-gray-600 rounded-md px-3 py-2 text-sm font-sans text-white placeholder-slate-400 resize-none focus:outline-none focus:border-indigo-500 disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-[11px] font-pixel rounded transition-colors"
            >
              stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-pixel rounded transition-colors"
            >
              send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
