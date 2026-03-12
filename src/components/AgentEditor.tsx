import { useMemo, useState } from 'react';
import { Agent, ApiKeys, MODELS, SPRITE_KEYS, AGENT_COLORS } from '../lib/types';

interface AgentEditorProps {
  agent: Agent;
  apiKeys: ApiKeys;
  onSave: (agent: Agent) => void;
  onDelete: (agentId: string) => void;
  onClose: () => void;
}

const PROVIDER_KEY_MAP: Record<string, keyof ApiKeys | null> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'gemini',
  'claude-code': null, // local CLI, no key needed
};

export default function AgentEditor({ agent, apiKeys, onSave, onDelete, onClose }: AgentEditorProps) {
  const [draft, setDraft] = useState<Agent>({ ...agent });
  const [tab, setTab] = useState<'profile' | 'history'>('profile');

  const availableModels = useMemo(() =>
    MODELS.filter((m) => {
      const keyField = PROVIDER_KEY_MAP[m.provider];
      return keyField === null || !!apiKeys[keyField];
    }),
    [apiKeys],
  );

  function update<K extends keyof Agent>(key: K, value: Agent[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    // Auto-set provider based on model
    if (key === 'model') {
      const m = MODELS.find((m) => m.id === value);
      if (m) setDraft((prev) => ({ ...prev, model: value as Agent['model'], provider: m.provider }));
    }
  }

  function clearHistory() {
    setDraft((prev) => ({ ...prev, history: [], currentThought: '' }));
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 text-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-600" style={{ borderLeftColor: draft.color, borderLeftWidth: 3 }}>
        <div className="flex-1 min-w-0">
          <h2 className="text-xs font-pixel text-white truncate">Edit: {draft.name}</h2>
          <p className="text-[11px] font-pixel mt-0.5" style={{ color: draft.color }}>{draft.role}</p>
        </div>
        <button onClick={onClose} className="text-slate-300 hover:text-white text-xs font-pixel transition-colors px-1">✕</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-600">
        {(['profile', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[11px] font-pixel transition-colors ${tab === t ? 'text-white border-b-2' : 'text-slate-400 hover:text-slate-200'}`}
            style={tab === t ? { borderBottomColor: draft.color } : {}}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {tab === 'profile' && (
          <>
            <Field label="Name">
              <input
                value={draft.name}
                onChange={(e) => update('name', e.target.value)}
                className="input-mono"
              />
            </Field>

            <Field label="Job Title">
              <input
                value={draft.role}
                onChange={(e) => update('role', e.target.value)}
                className="input-mono"
              />
            </Field>

            <Field label="Model">
              <select
                value={draft.model}
                onChange={(e) => update('model', e.target.value as Agent['model'])}
                className="input-mono"
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>
                ))}
              </select>
            </Field>

            <Field label="Personality (System Prompt)">
              <textarea
                value={draft.personality}
                onChange={(e) => update('personality', e.target.value)}
                rows={6}
                className="input-mono resize-none"
                disabled={draft.isBoss} // Boss personality is fixed
              />
            </Field>

            <Field label="Appearance">
              <div className="flex gap-2 flex-wrap">
                {SPRITE_KEYS.map((key, i) => (
                  <button
                    key={key}
                    onClick={() => setDraft((prev) => ({ ...prev, spriteKey: key, color: AGENT_COLORS[i] }))}
                    className={`w-6 h-6 rounded border-2 transition-all ${draft.spriteKey === key ? 'scale-125' : 'opacity-60 hover:opacity-100'}`}
                    style={{ backgroundColor: AGENT_COLORS[i], borderColor: draft.spriteKey === key ? '#fff' : 'transparent' }}
                  />
                ))}
              </div>
            </Field>
          </>
        )}

        {tab === 'history' && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-pixel text-slate-300">{draft.history.length} messages</span>
              {draft.history.length > 0 && (
                <button onClick={clearHistory} className="text-[11px] font-pixel text-red-400 hover:text-red-300">
                  Clear History
                </button>
              )}
            </div>
            {draft.history.length === 0 && (
              <p className="text-[11px] font-pixel text-slate-400 text-center py-4">No conversation history.</p>
            )}
            {draft.history.map((msg, i) => (
              <div key={i} className={`text-[11px] font-mono rounded p-2 ${msg.role === 'user' ? 'bg-indigo-900/50 text-indigo-200' : 'bg-slate-800 text-slate-200'}`}>
                <span className="text-[12px] text-slate-400 block mb-1">{msg.role}</span>
                <p className="whitespace-pre-wrap break-words line-clamp-4">{msg.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-600 flex gap-2">
        <button
          onClick={() => onSave(draft)}
          className="btn-pixel bg-indigo-600 hover:bg-indigo-500 flex-1"
        >
          Save
        </button>
        {!agent.isBoss && (
          <button
            onClick={() => { if (confirm(`Delete ${agent.name}?`)) onDelete(agent.id); }}
            className="btn-pixel bg-red-800 hover:bg-red-700"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-pixel text-slate-300 block">{label}</label>
      {children}
    </div>
  );
}
