// Filesystem layer — uses real local filesystem via Electron IPC,
// falls back to in-memory (localStorage) when running in browser (npm run dev)

export interface FileEntry {
  path: string;
  content: string;
  updatedAt: number;
}

export interface FileMeta {
  path: string;
  size: number;
  updatedAt: number;
}

// ─── Electron bridge types ────────────────────────────────────────

interface ElectronFsAPI {
  getWorkspace: () => Promise<string>;
  setWorkspace: (dir: string) => Promise<string>;
  pickWorkspace: () => Promise<string | null>;
  writeFile: (path: string, content: string) => Promise<{ ok: boolean; bytes: number }>;
  readFile: (path: string) => Promise<{ ok: boolean; content?: string; error?: string }>;
  deleteFile: (path: string) => Promise<{ ok: boolean; error?: string }>;
  listFiles: (dir?: string) => Promise<{ path: string; size: number; updatedAt: number }[]>;
  listAllFiles: () => Promise<FileMeta[]>;
  getAllFiles: () => Promise<FileEntry[]>;
}

function getElectronFs(): ElectronFsAPI | null {
  const w = window as unknown as { electronAPI?: { isElectron: boolean; fs: ElectronFsAPI } };
  return w.electronAPI?.isElectron ? w.electronAPI.fs : null;
}

export function isRealFs(): boolean {
  return getElectronFs() !== null;
}

// ─── Workspace helpers ────────────────────────────────────────────

export async function getWorkspace(): Promise<string> {
  const api = getElectronFs();
  if (!api) return '(in-memory)';
  return api.getWorkspace();
}

export async function setWorkspace(dir: string): Promise<string> {
  const api = getElectronFs();
  if (!api) return '(in-memory)';
  return api.setWorkspace(dir);
}

export async function pickWorkspace(): Promise<string | null> {
  const api = getElectronFs();
  if (!api) return null;
  return api.pickWorkspace();
}

// ─── Core file operations ─────────────────────────────────────────

export async function writeFile(path: string, content: string): Promise<string> {
  const api = getElectronFs();
  if (api) {
    const result = await api.writeFile(path, content);
    return `Wrote ${result.bytes} bytes to ${path}`;
  }
  // Browser fallback
  fallbackWrite(path, content);
  return `Wrote ${content.length} bytes to ${path}`;
}

export async function readFile(path: string): Promise<string> {
  const api = getElectronFs();
  if (api) {
    const result = await api.readFile(path);
    if (!result.ok) return `Error: ${result.error}`;
    return result.content!;
  }
  return fallbackRead(path);
}

export async function listFiles(directory?: string): Promise<string> {
  const api = getElectronFs();
  if (api) {
    const entries = await api.listFiles(directory);
    const paths = entries.map(e => e.path).sort();
    return paths.length > 0 ? paths.join('\n') : directory ? `No files in ${directory}` : 'No files yet';
  }
  return fallbackList(directory);
}

export async function deleteFile(path: string): Promise<string> {
  const api = getElectronFs();
  if (api) {
    const result = await api.deleteFile(path);
    if (!result.ok) return `Error: ${result.error}`;
    return `Deleted ${path}`;
  }
  return fallbackDelete(path);
}

export async function getAllFiles(): Promise<FileEntry[]> {
  const api = getElectronFs();
  if (api) {
    return api.getAllFiles();
  }
  return fallbackGetAll();
}

export async function listAllFiles(): Promise<FileMeta[]> {
  const api = getElectronFs();
  if (api) {
    return api.listAllFiles();
  }
  // Browser fallback: derive metadata from stored entries
  return fallbackGetAll().map(f => ({ path: f.path, size: f.content.length, updatedAt: f.updatedAt }));
}

// ─── Browser fallback (localStorage) ──────────────────────────────

const STORAGE_KEY = 'outworked_files';

function fallbackLoad(): Map<string, FileEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const arr: FileEntry[] = JSON.parse(raw);
    return new Map(arr.map(f => [f.path, f]));
  } catch {
    return new Map();
  }
}

function fallbackPersist(files: Map<string, FileEntry>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...files.values()]));
}

function fallbackWrite(p: string, content: string) {
  const files = fallbackLoad();
  files.set(p, { path: p, content, updatedAt: Date.now() });
  fallbackPersist(files);
}

function fallbackRead(p: string): string {
  const file = fallbackLoad().get(p);
  return file ? file.content : `Error: File not found: ${p}`;
}

function fallbackList(directory?: string): string {
  let paths = [...fallbackLoad().keys()].sort();
  if (directory) {
    const prefix = directory.endsWith('/') ? directory : directory + '/';
    paths = paths.filter(p => p.startsWith(prefix));
  }
  return paths.length > 0 ? paths.join('\n') : directory ? `No files in ${directory}` : 'No files yet';
}

function fallbackDelete(p: string): string {
  const files = fallbackLoad();
  if (!files.has(p)) return `Error: File not found: ${p}`;
  files.delete(p);
  fallbackPersist(files);
  return `Deleted ${p}`;
}

function fallbackGetAll(): FileEntry[] {
  return [...fallbackLoad().values()].sort((a, b) => a.path.localeCompare(b.path));
}
