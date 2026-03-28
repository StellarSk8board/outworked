import { useState } from "react";
import { ApiKeys } from "../lib/types";
import { setSetting } from "../lib/settings";

interface KeysModalProps {
  keys: ApiKeys;
  onSave: (keys: ApiKeys) => void;
  onClose: () => void;
}

export default function KeysModal({ keys, onSave, onClose }: KeysModalProps) {
  const [draft, setDraft] = useState<ApiKeys>({ ...keys });
  const [show, setShow] = useState({
    openai: false,
    anthropic: false,
    gemini: false,
    github: false,
  });

  function handleSave() {
    setSetting("outworked_key_openai", draft.openai);
    setSetting("outworked_key_anthropic", draft.anthropic);
    setSetting("outworked_key_gemini", draft.gemini);
    onSave(draft);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-600 rounded-lg w-80 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xs font-pixel text-white mb-4">API Keys</h2>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-pixel text-slate-300 block mb-1">
              OpenAI API Key
            </label>
            <div className="flex gap-1">
              <input
                type={show.openai ? "text" : "password"}
                value={draft.openai}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, openai: e.target.value }))
                }
                placeholder="sk-..."
                className="input-mono flex-1"
              />
              <button
                onClick={() => setShow((p) => ({ ...p, openai: !p.openai }))}
                className="px-2 text-[11px] font-pixel text-slate-300 hover:text-white bg-slate-800 rounded border border-gray-600"
              >
                {show.openai ? "hide" : "show"}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-pixel text-slate-300 block mb-1">
              Anthropic API Key
            </label>
            <div className="flex gap-1">
              <input
                type={show.anthropic ? "text" : "password"}
                value={draft.anthropic}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, anthropic: e.target.value }))
                }
                placeholder="sk-ant-..."
                className="input-mono flex-1"
              />
              <button
                onClick={() =>
                  setShow((p) => ({ ...p, anthropic: !p.anthropic }))
                }
                className="px-2 text-[11px] font-pixel text-slate-300 hover:text-white bg-slate-800 rounded border border-gray-600"
              >
                {show.anthropic ? "hide" : "show"}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-pixel text-slate-300 block mb-1">
              Gemini API Key
            </label>
            <div className="flex gap-1">
              <input
                type={show.gemini ? "text" : "password"}
                value={draft.gemini}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, gemini: e.target.value }))
                }
                placeholder="AIza..."
                className="input-mono flex-1"
              />
              <button
                onClick={() => setShow((p) => ({ ...p, gemini: !p.gemini }))}
                className="px-2 text-[11px] font-pixel text-slate-300 hover:text-white bg-slate-800 rounded border border-gray-600"
              >
                {show.gemini ? "hide" : "show"}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-pixel text-slate-300 block mb-1">
              GitHub Personal Access Token
            </label>
            <div className="flex gap-1">
              <input
                type={show.github ? "text" : "password"}
                value={draft.github}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, github: e.target.value }))
                }
                placeholder="ghp_..."
                className="input-mono flex-1"
              />
              <button
                onClick={() => setShow((p) => ({ ...p, github: !p.github }))}
                className="px-2 text-[11px] font-pixel text-slate-300 hover:text-white bg-slate-800 rounded border border-gray-600"
              >
                {show.github ? "hide" : "show"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 p-2.5 bg-slate-800/50 rounded border border-slate-700">
          <p className="text-[11px] font-pixel text-amber-400 mb-1">
            💻 No API keys?
          </p>
          <p className="text-[10px] text-slate-400 leading-relaxed font-mono">
            Select <span className="text-white">Claude Code (local)</span> as
            the model for any agent to use your local{" "}
            <span className="text-white">claude</span> CLI instead of API keys.
            Requires <span className="text-slate-300">claude</span> to be
            installed &amp; authenticated.
          </p>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSave}
            className="btn-pixel bg-indigo-600 hover:bg-indigo-500 flex-1"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="btn-pixel bg-slate-700 hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
