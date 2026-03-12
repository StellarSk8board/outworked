import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Agent, AgentSkill, ApiKeys } from './lib/types';
import { loadAgents, saveAgents, loadApiKeys, loadSkills, saveSkills, createAgent, resetProject } from './lib/storage';
import AgentList from './components/AgentList';
import AgentEditor from './components/AgentEditor';
import ChatWindow from './components/ChatWindow';
import KeysModal from './components/KeysModal';
import TerminalPanel from './components/TerminalPanel';
import OfficeInstructions, { InstructionRun } from './components/OfficeInstructions';
import AgentTasks from './components/AgentTasks';
import SkillsPanel from './components/SkillsPanel';
import MusicPlayer from './components/MusicPlayer';

const OfficeCanvas = lazy(() => import('./components/OfficeCanvas'));

type RightPanel = 'chat' | 'editor' | 'terminal' | 'instructions' | 'tasks';

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<RightPanel>('chat');
  const [apiKeys, setApiKeys] = useState<ApiKeys>({ openai: '', anthropic: '', gemini: '', github: '' });
  const [showKeys, setShowKeys] = useState(false);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [instructionRuns, setInstructionRuns] = useState<InstructionRun[]>([]);
  const [instructionRouting, setInstructionRouting] = useState(false);

  useEffect(() => {
    setAgents(loadAgents());
    const keys = loadApiKeys();
    setApiKeys(keys);
    // Sync GitHub token to main process so git/gh commands have GH_TOKEN
    (window as Window & { electronAPI?: { setGithubToken?: (t: string) => void } }).electronAPI?.setGithubToken?.(keys.github);
    setSkills(loadSkills());
  }, []);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  const updateAgent = useCallback((updated: Agent) => {
    setAgents((prev) => {
      const next = prev.map((a) => (a.id === updated.id ? updated : a));
      saveAgents(next);
      return next;
    });
  }, []);

  const handleAgentClick = useCallback((agent: Agent) => {
    setSelectedAgentId(agent.id);
    setRightPanel('chat');
  }, []);

  function handleSelectAgent(agent: Agent) {
    setSelectedAgentId(agent.id);
    setRightPanel('chat');
  }

  function handleAddAgent() {
    const agent = createAgent({
      position: { x: Math.floor(Math.random() * 10) + 2, y: Math.floor(Math.random() * 6) + 2 },
    });
    const next = [...agents, agent];
    setAgents(next);
    saveAgents(next);
    setSelectedAgentId(agent.id);
    setRightPanel('editor');
  }

  function handleSaveAgent(updated: Agent) {
    updateAgent(updated);
    setRightPanel('chat');
  }

  function handleDeleteAgent(agentId: string) {
    const agent = agents.find((a) => a.id === agentId);
    if (agent?.isBoss) return; // boss cannot be deleted
    const next = agents.filter((a) => a.id !== agentId);
    setAgents(next);
    saveAgents(next);
    setSelectedAgentId(null);
  }

  const handleAddDynamicAgent = useCallback((agent: Agent) => {
    setAgents((prev) => {
      const next = [...prev, agent];
      saveAgents(next);
      return next;
    });
  }, []);

  const handleUpdateSkills = useCallback((updated: AgentSkill[]) => {
    setSkills(updated);
    saveSkills(updated);
  }, []);

  function handleNewProject() {
    if (!window.confirm('Start a new project? This will clear all chat history, tasks, and working context. Agents and skills will be kept.')) return;
    const cleared = resetProject(agents);
    
    setAgents(cleared);
    setSelectedAgentId(null);
    setInstructionRuns([]);
    setRightPanel('chat');
  }

  const hasKeys = apiKeys.openai || apiKeys.anthropic || apiKeys.gemini;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      <div className="sr-only" aria-live="polite">Workspace loaded</div>
      <aside className="w-56 shrink-0 border-r border-slate-700 flex flex-col bg-slate-900/95">
        <div className="px-3 py-3 border-b border-gray-800">
          <h1 className="text-xs font-pixel text-indigo-300">Outworked</h1>
          <p className="text-[10px] font-pixel text-slate-400 mt-1">AI Agent HQ</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <AgentList
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelect={handleSelectAgent}
            onAdd={handleAddAgent}
          />
          <SkillsPanel skills={skills} onUpdate={handleUpdateSkills} />
        </div>
        <div className="px-2 py-1.5 border-t border-gray-800">
          <MusicPlayer />
        </div>
        <div className="px-3 py-2 border-t border-gray-800 flex flex-col gap-1.5">
          <button
            onClick={handleNewProject}
            className="w-full btn-pixel text-[10px] bg-red-800 hover:bg-red-700 text-red-100"
          >
            New Project
          </button>
          <button
            onClick={() => setShowKeys(true)}
            className={`w-full btn-pixel text-[10px] ${hasKeys ? 'bg-emerald-800 hover:bg-emerald-700 text-emerald-50' : 'bg-amber-700 hover:bg-amber-600 text-amber-50'}`}
          >
            {hasKeys ? 'Keys Set' : 'Add API Keys'}
          </button>
        </div>
      </aside>

      <main className="flex-1 relative overflow-hidden bg-slate-950">
        <Suspense fallback={<div className="w-full h-full bg-gray-950" />}>
          <OfficeCanvas
            agents={agents}
            selectedAgentId={selectedAgentId}
            onAgentClick={handleAgentClick}
          />
        </Suspense>
        <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-slate-950/90 backdrop-blur-sm border-t border-slate-700 flex gap-4 overflow-x-auto">
          {agents.filter((a) => a.status !== 'idle' && a.currentThought).map((a) => (
            <div key={a.id} className="flex items-center gap-1.5 shrink-0">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: a.color }} />
              <span className="text-[10px] font-pixel text-slate-300">
                <span style={{ color: a.color }}>{a.name}:</span>{' '}
                {a.currentThought.slice(0, 50)}{a.currentThought.length > 50 ? '...' : ''}
              </span>
            </div>
          ))}
          {agents.every((a) => a.status === 'idle' || !a.currentThought) && (
            <span className="text-[10px] font-pixel text-slate-400">
              Click an employee to chat!
            </span>
          )}
        </div>
      </main>

      <aside className="w-80 shrink-0 border-l border-slate-700 flex flex-col bg-slate-900/95 overflow-hidden">
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => setRightPanel('chat')}
            className={`flex-1 py-2 text-[10px] font-pixel leading-relaxed transition-colors ${rightPanel === 'chat' ? 'text-white border-b-2 border-indigo-500 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Chat
          </button>
          {selectedAgent && (
            <button
              onClick={() => setRightPanel('editor')}
              className={`flex-1 py-2 text-[10px] font-pixel leading-relaxed transition-colors ${rightPanel === 'editor' ? 'text-white border-b-2 border-indigo-500 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Config
            </button>
          )}
          {selectedAgent && (
            <button
              onClick={() => setRightPanel('tasks')}
              className={`flex-1 py-2 text-[10px] font-pixel leading-relaxed transition-colors ${rightPanel === 'tasks' ? 'text-white border-b-2 border-indigo-500 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Tasks
            </button>
          )}
          <button
            onClick={() => setRightPanel('terminal')}
            className={`flex-1 py-2 text-[10px] font-pixel leading-relaxed transition-colors ${rightPanel === 'terminal' ? 'text-white border-b-2 border-indigo-500 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Term
          </button>
          <button
            onClick={() => setRightPanel('instructions')}
            className={`flex-1 py-2 text-[10px] font-pixel leading-relaxed transition-colors ${rightPanel === 'instructions' ? 'text-white border-b-2 border-indigo-500 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}`}
          >
            Assign
          </button>
        </div>
        <div className="flex-1 overflow-hidden relative">
          {rightPanel !== 'terminal' && (
            rightPanel === 'chat' ? (
              <ChatWindow
                agent={selectedAgent}
                agents={agents}
                apiKeys={apiKeys}
                skills={skills}
                onUpdateAgent={updateAgent}
                onAddAgent={handleAddDynamicAgent}
              />
            ) : rightPanel === 'editor' && selectedAgent ? (
              <AgentEditor
                agent={selectedAgent}
                apiKeys={apiKeys}
                onSave={handleSaveAgent}
                onDelete={handleDeleteAgent}
                onClose={() => setRightPanel('chat')}
              />
            ) : rightPanel === 'tasks' ? (
              <AgentTasks
                agent={selectedAgent}
                onUpdateAgent={updateAgent}
              />
            ) : rightPanel === 'instructions' ? (
              <OfficeInstructions
                agents={agents}
                apiKeys={apiKeys}
                skills={skills}
                onUpdateAgent={updateAgent}
                onAddAgent={handleAddDynamicAgent}
                runs={instructionRuns}
                setRuns={setInstructionRuns}
                routing={instructionRouting}
                setRouting={setInstructionRouting}
              />
            ) : (
              <ChatWindow
                agent={selectedAgent}
                agents={agents}
                apiKeys={apiKeys}
                skills={skills}
                onUpdateAgent={updateAgent}
                onAddAgent={handleAddDynamicAgent}
              />
            )
          )}
          {/* Terminal is always mounted to preserve shell session; hidden when not active */}
          <div className={`absolute inset-0 ${rightPanel === 'terminal' ? '' : 'invisible pointer-events-none'}`}>
            <TerminalPanel agents={agents} />
          </div>
        </div>
      </aside>

      {showKeys && (
        <KeysModal
          keys={apiKeys}
          onSave={(newKeys) => {
            setApiKeys(newKeys);
            (window as Window & { electronAPI?: { setGithubToken?: (t: string) => void } }).electronAPI?.setGithubToken?.(newKeys.github);
          }}
          onClose={() => setShowKeys(false)}
        />
      )}
    </div>
  );
}
