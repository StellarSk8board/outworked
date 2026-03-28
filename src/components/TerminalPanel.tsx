import { useState, useRef, useEffect, useCallback } from "react";
import {
  listAllFiles,
  readFile,
  FileMeta,
  getWorkspace,
  pickWorkspace,
  isRealFs,
} from "../lib/filesystem";
import { Agent } from "../lib/types";
import {
  isElectron,
  spawnShell,
  writeShell,
  killShell,
  onShellStdout,
  onShellStderr,
  onShellExit,
} from "../lib/terminal";

interface TerminalPanelProps {
  agents: Agent[];
  workspaceDir?: string | null;
}

type TabMode = "terminal" | "files";

interface ShellLine {
  id: number;
  type: "stdout" | "stderr" | "input" | "info";
  text: string;
}

// ─── Tree helpers ────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string; // full relative path
  isDir: boolean;
  children: TreeNode[];
  meta?: FileMeta; // only for leaf files
}

function buildTree(files: FileMeta[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const file of files) {
    const parts = file.path.replace(/^\/+/, "").split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join("/");
      let child = current.children.find(
        (c) => c.name === part && c.isDir === !isLast,
      );
      if (!child) {
        child = {
          name: part,
          path: childPath,
          isDir: !isLast,
          children: [],
          meta: isLast ? file : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Sort: directories first, then alphabetical
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.isDir) sortNodes(n.children);
  };
  sortNodes(root.children);
  return root.children;
}

// ─── File icon helper ────────────────────────────────────────────

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "🟦",
    tsx: "⚛️",
    js: "🟨",
    jsx: "⚛️",
    json: "📋",
    md: "📝",
    css: "🎨",
    html: "🌐",
    py: "🐍",
    sh: "⚙️",
    yml: "📄",
    yaml: "📄",
    txt: "📄",
    toml: "📄",
    lock: "🔒",
    env: "🔑",
  };
  return map[ext] ?? "📄";
}

let lineIdCounter = 0;

export default function TerminalPanel({
  agents,
  workspaceDir: wsDirProp,
}: TerminalPanelProps) {
  const [mode, setMode] = useState<TabMode>("terminal");
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [workspace, setWorkspaceDir] = useState<string>(wsDirProp || "");
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [expandedFileContent, setExpandedFileContent] = useState<string | null>(
    null,
  );
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Shell state
  const [shellId, setShellId] = useState<number | null>(null);
  const [lines, setLines] = useState<ShellLine[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // Sync workspace from parent prop; fall back to getWorkspace() if no prop
  useEffect(() => {
    if (wsDirProp) {
      setWorkspaceDir(wsDirProp);
    } else {
      getWorkspace().then(setWorkspaceDir);
    }
  }, [wsDirProp]);

  // Refresh files periodically (only when files tab is active)
  useEffect(() => {
    if (mode !== "files") return;
    listAllFiles().then(setFiles);
    const interval = setInterval(() => {
      listAllFiles().then(setFiles);
    }, 10000);
    return () => clearInterval(interval);
  }, [agents, mode]);

  // Spawn shell once the workspace is known (Electron only); re-spawn when workspace changes
  useEffect(() => {
    if (!workspace) return; // wait until workspace is resolved

    if (!isElectron()) {
      setLines([
        {
          id: ++lineIdCounter,
          type: "info",
          text: "Terminal requires Electron. Use `npm run electron:dev` to launch.",
        },
      ]);
      return;
    }

    let mounted = true;

    // Kill any existing shell before spawning in the new cwd
    setShellId((prev) => {
      if (prev !== null) killShell(prev);
      return null;
    });

    spawnShell(workspace).then((id) => {
      if (!mounted) {
        killShell(id);
        return;
      }
      setShellId(id);
      setLines([
        {
          id: ++lineIdCounter,
          type: "info",
          text: `Shell started in ${workspace} (session ${id})`,
        },
      ]);
    });

    return () => {
      mounted = false;
    };
  }, [workspace]);

  // Listen for shell output
  useEffect(() => {
    if (shellId === null) return;

    const unsub1 = onShellStdout((id, data) => {
      if (id !== shellId) return;
      setLines((prev) => [
        ...prev,
        { id: ++lineIdCounter, type: "stdout", text: data },
      ]);
    });

    const unsub2 = onShellStderr((id, data) => {
      if (id !== shellId) return;
      setLines((prev) => [
        ...prev,
        { id: ++lineIdCounter, type: "stderr", text: data },
      ]);
    });

    const unsub3 = onShellExit((id, code) => {
      if (id !== shellId) return;
      setLines((prev) => [
        ...prev,
        {
          id: ++lineIdCounter,
          type: "info",
          text: `Shell exited (code ${code})`,
        },
      ]);
      setShellId(null);
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [shellId]);

  const handleSend = useCallback(() => {
    if (!input.trim() || shellId === null) return;
    const cmd = input;
    setLines((prev) => [
      ...prev,
      { id: ++lineIdCounter, type: "input", text: `$ ${cmd}` },
    ]);
    writeShell(shellId, cmd + "\n");
    setHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);
    setInput("");
  }, [input, shellId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next =
        historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setInput(history[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx < 0) return;
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(-1);
        setInput("");
      } else {
        setHistoryIdx(next);
        setInput(history[next]);
      }
    } else if (e.key === "c" && e.ctrlKey) {
      if (shellId !== null) writeShell(shellId, "\x03");
    }
  }

  function handleRestart() {
    if (shellId !== null) killShell(shellId);
    setLines([]);
    spawnShell(workspace || undefined).then((id) => {
      setShellId(id);
      setLines([
        {
          id: ++lineIdCounter,
          type: "info",
          text: `Shell restarted (session ${id})`,
        },
      ]);
    });
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 text-gray-200">
      {/* Sub-tabs */}
      <div className="flex border-b border-slate-700 bg-slate-900">
        <button
          onClick={() => setMode("terminal")}
          className={`flex-1 py-1.5 text-[11px] font-pixel transition-colors ${mode === "terminal" ? "text-green-400 border-b-2 border-green-500 bg-slate-800" : "text-slate-400 hover:text-slate-200"}`}
        >
          {">"} Terminal
        </button>
        <button
          onClick={() => setMode("files")}
          className={`flex-1 py-1.5 text-[11px] font-pixel transition-colors ${mode === "files" ? "text-green-400 border-b-2 border-green-500 bg-slate-800" : "text-slate-400 hover:text-slate-200"}`}
        >
          📁 Files ({files.length})
        </button>
      </div>

      {/* Workspace indicator */}
      {isRealFs() && (
        <div className="flex items-center gap-2 px-3 py-1 bg-slate-900/60 border-b border-slate-700">
          <span
            className="text-[12px] font-mono text-slate-400 truncate flex-1"
            title={workspace}
          >
            📂 {workspace}
          </span>
          <button
            onClick={() =>
              pickWorkspace().then((dir) => {
                if (dir) {
                  setWorkspaceDir(dir);
                  listAllFiles().then(setFiles);
                }
              })
            }
            className="text-[12px] font-pixel text-slate-400 hover:text-green-400 transition-colors shrink-0"
          >
            change
          </button>
        </div>
      )}

      {mode === "files" ? (
        /* ─── File Browser (Tree View) ─── */
        <div className="flex-1 overflow-y-auto">
          {files.length === 0 ? (
            <div className="text-slate-400 text-[11px] font-mono text-center pt-8 px-3">
              No files yet.
              <br />
              Ask an agent to write code and files will appear here.
            </div>
          ) : (
            <div className="py-1">
              {buildTree(files).map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  expandedDirs={expandedDirs}
                  toggleDir={toggleDir}
                  expandedFile={expandedFile}
                  setExpandedFile={setExpandedFile}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ─── Local Terminal ─── */
        <>
          <div className="flex items-center justify-between px-3 py-1 bg-slate-900 border-b border-slate-700">
            <span className="text-[12px] font-mono text-slate-400">
              {shellId !== null ? `zsh · session ${shellId}` : "disconnected"}
            </span>
            <button
              onClick={handleRestart}
              className="text-[12px] font-pixel text-slate-400 hover:text-green-400 transition-colors"
            >
              ↻ restart
            </button>
          </div>
          <div
            className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-7 cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {lines.map((line) => (
              <div
                key={line.id}
                className={`whitespace-pre-wrap break-all ${
                  line.type === "stderr"
                    ? "text-red-400"
                    : line.type === "input"
                      ? "text-cyan-400"
                      : line.type === "info"
                        ? "text-slate-400 italic"
                        : "text-slate-200"
                }`}
              >
                {line.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="px-3 py-2 border-t border-slate-700 bg-slate-900">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-mono text-green-400 shrink-0">
                $
              </span>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  shellId !== null ? "Type a command..." : "Shell not connected"
                }
                disabled={shellId === null}
                className="flex-1 bg-transparent border-none text-[12px] font-mono text-green-300 placeholder-slate-400 focus:outline-none disabled:opacity-50"
                autoFocus
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Recursive tree node component ──────────────────────────────

interface FileTreeNodeProps {
  node: TreeNode;
  depth: number;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
  expandedFile: string | null;
  setExpandedFile: (path: string | null) => void;
}

function FileTreeNode({
  node,
  depth,
  expandedDirs,
  toggleDir,
  expandedFile,
  setExpandedFile,
}: FileTreeNodeProps) {
  const indent = depth * 16;
  const isOpen = expandedDirs.has(node.path);
  const [fileContent, setFileContent] = useState<string | null>(null);

  const isExpanded = !node.isDir && expandedFile === node.path;

  useEffect(() => {
    if (!isExpanded) {
      setFileContent(null);
      return;
    }
    readFile(node.path).then(setFileContent).catch(() => setFileContent(null));
  }, [isExpanded, node.path]);

  if (node.isDir) {
    return (
      <>
        <button
          onClick={() => toggleDir(node.path)}
          className="w-full flex items-center gap-1.5 py-[3px] hover:bg-slate-800/60 transition-colors text-left group"
          style={{ paddingLeft: `${8 + indent}px` }}
        >
          <span className="text-[11px] text-slate-400 w-3 text-center shrink-0">
            {isOpen ? "▾" : "▸"}
          </span>
          <span className="text-[12px] shrink-0">{isOpen ? "📂" : "📁"}</span>
          <span className="text-[12px] font-mono text-slate-200 truncate">
            {node.name}
          </span>
          <span className="text-[12px] font-mono text-slate-400 ml-auto pr-3 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.children.length}
          </span>
        </button>
        {isOpen &&
          node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              expandedFile={expandedFile}
              setExpandedFile={setExpandedFile}
            />
          ))}
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setExpandedFile(isExpanded ? null : node.path)}
        className={`w-full flex items-center gap-1.5 py-[3px] hover:bg-slate-800/60 transition-colors text-left ${isExpanded ? "bg-slate-800/40" : ""}`}
        style={{ paddingLeft: `${8 + indent + 16}px` }}
      >
        <span className="text-[12px] shrink-0">{fileIcon(node.name)}</span>
        <span
          className={`text-[12px] font-mono truncate ${isExpanded ? "text-green-400" : "text-slate-300"}`}
        >
          {node.name}
        </span>
        {node.meta && (
          <span className="text-[12px] font-mono text-slate-400 ml-auto pr-3 shrink-0">
            {node.meta.size}b
          </span>
        )}
      </button>
      {isExpanded && fileContent !== null && (
        <pre
          className="bg-slate-900/80 text-[12px] font-mono text-slate-200 overflow-x-auto whitespace-pre-wrap break-all leading-7 max-h-64 overflow-y-auto border-t border-b border-slate-700/50"
          style={{
            paddingLeft: `${8 + indent + 16}px`,
            paddingRight: 12,
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          {fileContent}
        </pre>
      )}
    </>
  );
}
