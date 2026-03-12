import { useState } from 'react';
import { AgentSkill } from '../lib/types';
import { parseOpenClawSkill, isOpenClawFormat } from '../lib/skill-parser';
import { getBundledSkills } from '../lib/bundled-skills';

interface SkillsPanelProps {
  skills: AgentSkill[];
  onUpdate: (skills: AgentSkill[]) => void;
}

type AddMode = 'menu' | 'manual' | 'import' | 'bundled';

export default function SkillsPanel({ skills, onUpdate }: SkillsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [viewingSkill, setViewingSkill] = useState<string | null>(null);

  function addSkill() {
    if (!name.trim() || !content.trim()) return;
    const skill: AgentSkill = {
      id: crypto.randomUUID(),
      name: name.trim(),
      content: content.trim(),
    };
    onUpdate([...skills, skill]);
    resetForm();
  }

  function importSkill() {
    if (!importText.trim()) return;
    setImportError('');

    if (!isOpenClawFormat(importText)) {
      setImportError('Not a valid SKILL.md — must start with --- frontmatter');
      return;
    }

    try {
      const skill = parseOpenClawSkill(importText);
      if (!skill.content && !skill.name) {
        setImportError('Could not parse skill content');
        return;
      }
      onUpdate([...skills, skill]);
      resetForm();
    } catch {
      setImportError('Failed to parse SKILL.md');
    }
  }

  function removeSkill(id: string) {
    onUpdate(skills.filter((s) => s.id !== id));
    if (viewingSkill === id) setViewingSkill(null);
  }

  function toggleBundledSkill(bundled: AgentSkill) {
    const exists = skills.some((s) => s.id === bundled.id);
    if (exists) {
      onUpdate(skills.filter((s) => s.id !== bundled.id));
    } else {
      onUpdate([...skills, bundled]);
    }
  }

  const bundledSkills = getBundledSkills();
  const isBundled = (id: string) => id.startsWith('bundled:');
  const enabledBundledIds = new Set(skills.filter((s) => isBundled(s.id)).map((s) => s.id));
  const userSkills = skills.filter((s) => !isBundled(s.id));

  function resetForm() {
    setAddMode(null);
    setName('');
    setContent('');
    setImportText('');
    setImportError('');
  }

  return (
    <div className="border-t border-slate-600">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-pixel text-slate-300 uppercase tracking-wider hover:text-gray-200 transition-colors"
      >
        <span>Skills ({skills.length})</span>
        <span className="text-[12px]">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {skills.length === 0 && !addMode && (
            <p className="text-[12px] font-pixel text-slate-400 text-center py-1">
              No skills — add or import below
            </p>
          )}

          {/* Active skills list */}
          {skills.map((skill) => (
            <div key={skill.id}>
              <div className="flex items-center gap-1.5 group">
                <button
                  onClick={() => setViewingSkill(viewingSkill === skill.id ? null : skill.id)}
                  className={`text-[12px] font-pixel truncate flex-1 text-left hover:text-indigo-300 transition-colors ${isBundled(skill.id) ? 'text-teal-400' : 'text-indigo-400'}`}
                  title={skill.description || skill.name}
                >
                  {skill.name}
                </button>
                <button
                  onClick={() => removeSkill(skill.id)}
                  className="text-[12px] font-pixel text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  title={isBundled(skill.id) ? 'Disable' : 'Remove'}
                >
                  ✕
                </button>
              </div>
              {viewingSkill === skill.id && (
                <div className="mt-1 mb-1.5 p-1.5 bg-slate-800/60 rounded border border-slate-600">
                  {skill.description && (
                    <p className="text-[11px] font-pixel text-slate-300 mb-1">{skill.description}</p>
                  )}
                  {skill.metadata?.requires?.bins && (
                    <p className="text-[11px] font-pixel text-yellow-600">
                      Requires: {skill.metadata.requires.bins.join(', ')}
                    </p>
                  )}
                  {skill.metadata?.requires?.anyBins && (
                    <p className="text-[11px] font-pixel text-yellow-600">
                      Requires one of: {skill.metadata.requires.anyBins.join(', ')}
                    </p>
                  )}
                  <pre className="text-[11px] font-pixel text-slate-400 mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap">
                    {skill.content.slice(0, 500)}{skill.content.length > 500 ? '…' : ''}
                  </pre>
                </div>
              )}
            </div>
          ))}

          {/* Add mode menu */}
          {addMode === 'menu' && (
            <div className="space-y-1">
              <button
                onClick={() => setAddMode('bundled')}
                className="btn-pixel bg-teal-900 hover:bg-teal-800 w-full text-[12px]"
              >
                📦 Bundled Skills
              </button>
              <button
                onClick={() => setAddMode('manual')}
                className="btn-pixel bg-slate-700 hover:bg-gray-600 w-full text-[12px]"
              >
                ✏️ Create Manually
              </button>
              <button
                onClick={() => setAddMode('import')}
                className="btn-pixel bg-indigo-800 hover:bg-indigo-700 w-full text-[12px]"
              >
                📥 Import from OpenClaw
              </button>
              <button
                onClick={resetForm}
                className="btn-pixel bg-slate-800 hover:bg-slate-700 w-full text-[12px] text-slate-400"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Bundled skills browser */}
          {addMode === 'bundled' && (
            <div className="space-y-1">
              <p className="text-[11px] font-pixel text-slate-400">
                Toggle bundled skills on/off:
              </p>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {bundledSkills.map((bs) => {
                  const enabled = enabledBundledIds.has(bs.id);
                  return (
                    <button
                      key={bs.id}
                      onClick={() => toggleBundledSkill(bs)}
                      className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left transition-colors ${
                        enabled
                          ? 'bg-teal-900/50 hover:bg-teal-900/70'
                          : 'bg-slate-800/40 hover:bg-slate-800/70'
                      }`}
                    >
                      <span className="text-[12px]">{enabled ? '✅' : '⬜'}</span>
                      <span className="text-[12px] font-pixel text-slate-200 truncate flex-1">
                        {bs.name}
                      </span>
                      {bs.metadata?.requires?.bins && (
                        <span className="text-[8px] font-pixel text-yellow-700">
                          {bs.metadata.requires.bins[0]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-1 pt-1">
                <button
                  onClick={() => {
                    const allEnabled = bundledSkills.every((bs) => enabledBundledIds.has(bs.id));
                    if (allEnabled) {
                      onUpdate(userSkills);
                    } else {
                      const newBundled = bundledSkills.filter((bs) => !enabledBundledIds.has(bs.id));
                      onUpdate([...skills, ...newBundled]);
                    }
                  }}
                  className="btn-pixel bg-teal-800 hover:bg-teal-700 text-[11px] flex-1"
                >
                  {bundledSkills.every((bs) => enabledBundledIds.has(bs.id)) ? 'Disable All' : 'Enable All'}
                </button>
                <button onClick={resetForm} className="btn-pixel bg-slate-700 hover:bg-gray-600 text-[12px]">
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Manual add form */}
          {addMode === 'manual' && (
            <div className="space-y-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Skill name"
                className="input-mono text-[12px]"
              />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Skill markdown..."
                rows={4}
                className="input-mono text-[12px] resize-none"
              />
              <div className="flex gap-1">
                <button onClick={addSkill} className="btn-pixel bg-indigo-700 hover:bg-indigo-600 text-[12px] flex-1">
                  Add
                </button>
                <button onClick={resetForm} className="btn-pixel bg-slate-700 hover:bg-gray-600 text-[12px]">
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Import from OpenClaw */}
          {addMode === 'import' && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-pixel text-slate-400">
                Paste an OpenClaw SKILL.md file below:
              </p>
              <textarea
                value={importText}
                onChange={(e) => { setImportText(e.target.value); setImportError(''); }}
                placeholder={"---\nname: my-skill\ndescription: ...\n---\n\n# Skill content..."}
                rows={6}
                className="input-mono text-[12px] resize-none font-mono"
              />
              {importError && (
                <p className="text-[11px] font-pixel text-red-400">{importError}</p>
              )}
              <div className="flex gap-1">
                <button onClick={importSkill} className="btn-pixel bg-indigo-700 hover:bg-indigo-600 text-[12px] flex-1">
                  Import
                </button>
                <button onClick={resetForm} className="btn-pixel bg-slate-700 hover:bg-gray-600 text-[12px]">
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Main add button */}
          {!addMode && (
            <button
              onClick={() => setAddMode('menu')}
              className="btn-pixel bg-slate-700 hover:bg-gray-600 w-full text-[12px]"
            >
              + Add Skill
            </button>
          )}
        </div>
      )}
    </div>
  );
}
