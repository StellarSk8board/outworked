import { useState, useRef, useEffect } from 'react';
import { Agent, AgentSkill, AgentTodo, ApiKeys, Message, MODELS, ToolCall } from '../lib/types';
import { sendMessage } from '../lib/ai';
import { executeTask, generateTodoList, routeTasks } from '../lib/orchestrator';
import { createAgent } from '../lib/storage';

interface ChatWindowProps {
  agent: Agent | null;
  agents: Agent[];
  apiKeys: ApiKeys;
  skills: AgentSkill[];
  onUpdateAgent: (agent: Agent) => void;
  onAddAgent: (agent: Agent) => void;
}

export default function ChatWindow({ agent, agents, apiKeys, skills, onUpdateAgent, onAddAgent }: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent?.history, streamingText]);

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
    async function handleBossOrchestrate(bossAgent: Agent, userText: string): Promise<string> {
      const routerModel = { model: agent!.model, provider: agent!.provider };

      // Step 1: Route through orchestrator
      onUpdateAgent({ ...bossAgent, status: 'thinking', currentThought: '🧠 Analyzing and planning...' });
      setStreamingText('🧠 Analyzing the request and planning task assignments...\n');

      const result = await routeTasks(
        userText,
        agents.filter(a => !a.isBoss),
        apiKeys,
        routerModel,
      );

      // Step 2: Create any new agents
      const createdAgents: Agent[] = [];
      for (const spec of result.newAgents) {
        const exists = agents.find(a => a.name.toLowerCase() === spec.name.toLowerCase());
        if (exists) continue;
        const newAgent = createAgent({
          name: spec.name,
          role: spec.role,
          personality: spec.personality,
          model: routerModel.model,
          provider: routerModel.provider,
          position: {
            x: Math.floor(Math.random() * 10) + 2,
            y: Math.floor(Math.random() * 6) + 2,
          },
        });
        createdAgents.push(newAgent);
        onAddAgent(newAgent);
      }

      const allAgents = [...agents, ...createdAgents];

      // Step 3: Resolve assignments
      const resolvedAssignments = result.assignments.map(a => {
        if (a.agentId) return a;
        const match = allAgents.find(ag => ag.name.toLowerCase() === a.agentName.toLowerCase());
        return { ...a, agentId: match?.id ?? '' };
      });

      // Stream progress
      let progress = `📝 **Plan:** ${result.plan}\n📁 **Working directory:** ${result.workingDirectory}/\n`;
      if (createdAgents.length > 0) {
        progress += `👥 **New hires:** ${createdAgents.map(a => `${a.name} (${a.role})`).join(', ')}\n`;
      }
      progress += `\n**Assignments:**\n${resolvedAssignments.map(a => `- ${a.agentName}: ${a.task}`).join('\n')}\n`;

      if (resolvedAssignments.length === 0) {
        // Nothing to assign — let the Boss respond conversationally
        return await handleBossFallbackChat(bossAgent, userText);
      }

      setStreamingText(progress + '\n⏳ Executing tasks...\n');
      onUpdateAgent({ ...bossAgent, status: 'working', currentThought: `📋 ${resolvedAssignments.length} tasks in progress...` });

      // Step 4: Execute all tasks in parallel
      const taskResults: { agentName: string; success: boolean; reply: string }[] = [];

      const taskPromises = resolvedAssignments.map(async (assignment) => {
        const targetAgent = allAgents.find(a => a.id === assignment.agentId);
        if (!targetAgent) {
          taskResults.push({ agentName: assignment.agentName, success: false, reply: 'Agent not found' });
          return;
        }

        onUpdateAgent({ ...targetAgent, status: 'working', currentThought: `Planning: ${assignment.task.slice(0, 60)}...` });

        try {
          const todos = await generateTodoList(targetAgent, assignment.task, apiKeys, skills);
          const agentWithTodos: Agent = {
            ...targetAgent,
            todos: [...(targetAgent.todos ?? []), ...todos.map(t => ({ ...t, status: 'in-progress' as const }))],
          };
          onUpdateAgent({ ...agentWithTodos, status: 'working', currentThought: `Working: ${assignment.task.slice(0, 60)}...` });

          const { agent: updatedAgent, reply } = await executeTask(
            agentWithTodos, assignment.task, apiKeys,
            (partial) => onUpdateAgent({ ...agentWithTodos, status: 'working', currentThought: partial.slice(0, 80) + (partial.length > 80 ? '...' : '') }),
            undefined, skills, result.workingDirectory,
          );

          const todoIds = new Set(todos.map(t => t.id));
          const finalAgent: Agent = {
            ...updatedAgent,
            todos: (updatedAgent.todos ?? []).map(t => todoIds.has(t.id) ? { ...t, status: 'done' as const } : t),
          };
          onUpdateAgent(finalAgent);
          taskResults.push({ agentName: assignment.agentName, success: true, reply });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          onUpdateAgent({ ...targetAgent, status: 'idle', currentThought: '' });
          taskResults.push({ agentName: assignment.agentName, success: false, reply: errMsg });
        }
      });

      await Promise.all(taskPromises);

      // Step 5: Have the Boss summarize results
      const summaryParts = [progress, '\n---\n\n**Results:**\n'];
      for (const tr of taskResults) {
        const icon = tr.success ? '✅' : '❌';
        summaryParts.push(`${icon} **${tr.agentName}:** ${tr.reply.slice(0, 400)}\n`);
      }

      setStreamingText(summaryParts.join(''));
      onUpdateAgent({ ...bossAgent, status: 'speaking', currentThought: 'Summarizing results...' });

      // Let the Boss write a final summary via LLM
      const summaryPrompt = `You just orchestrated the following work. Summarize what was accomplished for the user in a clear, concise report.\n\nPlan: ${result.plan}\n\nResults:\n${taskResults.map(tr => `- ${tr.agentName}: ${tr.success ? 'SUCCESS' : 'FAILED'} — ${tr.reply.slice(0, 500)}`).join('\n')}`;
      const bossForSummary: Agent = { ...bossAgent, history: [] };
      const summary = await sendMessage(bossForSummary, summaryPrompt, apiKeys, (partial) => setStreamingText(partial), abortRef.current?.signal, { useTools: false });

      return summary;
    }

    // Boss fallback: conversational response when there's nothing to orchestrate
    async function handleBossFallbackChat(bossAgent: Agent, userText: string): Promise<string> {
      const otherAgents = agents.filter(a => a.id !== agent!.id);
      const roster = otherAgents.map(a => `- ${a.name} (${a.role})`).join('\n');
      const extraSystemPrompt = `\n\n## Your Team\nCurrent employees:\n${roster}\n\nThe user's request doesn't seem to require delegating work. Respond conversationally.`;

      return await sendMessage(
        bossAgent,
        userText,
        apiKeys,
        (partial) => {
          setStreamingText(partial);
          onUpdateAgent({ ...bossAgent, status: 'speaking', currentThought: partial.slice(0, 80) + (partial.length > 80 ? '...' : '') });
        },
        abortRef.current?.signal,
        { skills, extraSystemPrompt, useTools: false },
      );
    }

    // ── Regular agent chat flow ──────────────────────────────────
    async function handleRegularChat(agentState: Agent, userText: string): Promise<string> {
      return await sendMessage(
        agentState,
        userText,
        apiKeys,
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
          },
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
        <span className="text-[11px] font-pixel text-slate-400 shrink-0">{model?.label ?? agent.model}</span>
      </div>

      {/* Status */}
      {agent.currentThought && (
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

        {agent.history.map((msg, i) => (
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
        ))}
        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] px-2.5 py-1.5 rounded text-[12px] font-mono leading-7 bg-slate-700 text-gray-100 whitespace-pre-wrap break-words">
              {streamingText}
              <span className="inline-block w-1.5 h-3 bg-gray-400 ml-0.5 animate-pulse align-middle" />
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
        <div ref={bottomRef} />
      </div>

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
