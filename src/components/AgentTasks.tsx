import { Agent, AgentTodo } from "../lib/types";

interface AgentTasksProps {
  agent: Agent | null;
  onUpdateAgent: (agent: Agent) => void;
}

const STATUS_ICON: Record<AgentTodo["status"], string> = {
  pending: "○",
  "in-progress": "⏳",
  done: "✓",
  error: "✗",
};

const STATUS_COLOR: Record<AgentTodo["status"], string> = {
  pending: "text-slate-400",
  "in-progress": "text-yellow-400",
  done: "text-green-400",
  error: "text-red-400",
};

export default function AgentTasks({ agent, onUpdateAgent }: AgentTasksProps) {
  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[11px] font-pixel text-slate-400">
          Select an employee to view their tasks
        </p>
      </div>
    );
  }

  const todos = agent.todos ?? [];
  const doneCount = todos.filter((t) => t.status === "done").length;

  function clearTodos() {
    onUpdateAgent({ ...agent!, todos: [] });
  }

  function clearDone() {
    onUpdateAgent({
      ...agent!,
      todos: todos.filter((t) => t.status !== "done"),
    });
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-slate-700 bg-slate-900"
        style={{ borderLeftColor: agent.color, borderLeftWidth: 3 }}
      >
        <span className="text-[11px] font-pixel" style={{ color: agent.color }}>
          📋 {agent.name}&apos;s Tasks
        </span>
        {todos.length > 0 && (
          <p className="text-[12px] font-pixel text-slate-400 mt-0.5">
            {doneCount}/{todos.length} complete
          </p>
        )}
      </div>

      {/* Progress bar */}
      {todos.length > 0 && (
        <div className="px-3 py-1.5 bg-slate-900/50 border-b border-slate-700">
          <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(doneCount / todos.length) * 100}%`,
                backgroundColor: agent.color,
              }}
            />
          </div>
        </div>
      )}

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {todos.length === 0 && (
          <div className="text-center pt-8">
            <p className="text-[11px] font-mono text-slate-400">No tasks yet</p>
            <p className="text-[12px] font-mono text-slate-500 mt-1">
              Assign work from the &quot;Assign&quot; tab to create a to-do list
            </p>
          </div>
        )}

        {todos.map((todo) => (
          <div
            key={todo.id}
            className={`flex items-start gap-2 px-2 py-1.5 rounded ${
              todo.status === "done"
                ? "bg-green-900/10"
                : todo.status === "in-progress"
                  ? "bg-yellow-900/15"
                  : todo.status === "error"
                    ? "bg-red-900/15"
                    : "bg-slate-900/30"
            }`}
          >
            <span
              className={`text-[12px] font-mono shrink-0 mt-0.5 ${STATUS_COLOR[todo.status]} ${
                todo.status === "in-progress" ? "animate-pulse" : ""
              }`}
            >
              {STATUS_ICON[todo.status]}
            </span>
            <div className="flex-1 min-w-0">
              <p
                className={`text-[11px] font-mono break-words ${
                  todo.status === "done"
                    ? "text-slate-400 line-through"
                    : "text-slate-200"
                }`}
              >
                {todo.text}
              </p>
              {todo.error && (
                <p className="text-[12px] font-mono text-red-400 mt-0.5">
                  {todo.error}
                </p>
              )}
              {todo.result && (
                <details className="mt-0.5">
                  <summary className="text-[12px] font-mono text-slate-400 cursor-pointer hover:text-slate-300">
                    View result
                  </summary>
                  <pre className="mt-1 text-[12px] text-slate-300 whitespace-pre-wrap break-words max-h-24 overflow-y-auto bg-slate-900 rounded p-1">
                    {todo.result}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Footer actions */}
      {todos.length > 0 && (
        <div className="px-3 py-2 border-t border-slate-700 bg-slate-900 flex gap-2">
          {doneCount > 0 && (
            <button
              onClick={clearDone}
              className="text-[12px] font-pixel text-slate-400 hover:text-slate-200 transition-colors"
            >
              Clear done
            </button>
          )}
          <button
            onClick={clearTodos}
            className="text-[12px] font-pixel text-red-500/60 hover:text-red-400 transition-colors ml-auto"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
