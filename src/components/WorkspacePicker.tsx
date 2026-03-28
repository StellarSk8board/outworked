import { useState } from "react";
import { pickWorkspace, getWorkspace } from "../lib/filesystem";
import { isElectron } from "../lib/terminal";

interface WorkspacePickerProps {
  onSelect: (dir: string) => void;
  onSkip?: () => void;
  currentDir?: string;
  showSkip?: boolean;
}

export default function WorkspacePicker({
  onSelect,
  onSkip,
  currentDir,
  showSkip = true,
}: WorkspacePickerProps) {
  const [picking, setPicking] = useState(false);

  async function handlePick() {
    if (!isElectron()) return;
    setPicking(true);
    try {
      const dir = await pickWorkspace();
      if (dir) {
        onSelect(dir);
      }
    } finally {
      setPicking(false);
    }
  }

  async function handleUseCurrent() {
    const dir = currentDir || (await getWorkspace());
    onSelect(dir);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-6 max-w-md w-full mx-4">
        <h2 className="text-sm font-pixel text-indigo-300 mb-1">
          Choose Working Directory
        </h2>
        <p className="text-[10px] font-pixel text-slate-400 mb-4">
          Select the folder where your agents will read and write files.
        </p>

        {currentDir && (
          <div className="mb-4 bg-slate-800 rounded p-2">
            <p className="text-[10px] font-pixel text-slate-500 mb-0.5">
              Current directory
            </p>
            <p className="text-[11px] font-mono text-slate-300 truncate">
              {currentDir}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={handlePick}
            disabled={picking}
            className="w-full py-2 text-[11px] font-pixel rounded bg-indigo-700 hover:bg-indigo-600 text-indigo-50 disabled:opacity-50 transition-colors"
          >
            {picking ? "⏳ Opening…" : "📂 Browse for Folder"}
          </button>

          {currentDir && (
            <button
              onClick={handleUseCurrent}
              className="w-full py-2 text-[11px] font-pixel rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
            >
              Keep Current Directory
            </button>
          )}

          {showSkip && onSkip && (
            <button
              onClick={onSkip}
              className="w-full py-1.5 text-[10px] font-pixel text-slate-500 hover:text-slate-300 transition-colors"
            >
              Skip (use default)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
