// Bridge to Electron shell APIs exposed via preload
// Falls back to no-ops when running in a regular browser (npm run dev)

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  code: number;
}

interface ClaudeCodeAPI {
  start: (prompt: string, systemPrompt: string, cwd?: string, timeoutMs?: number) => Promise<number>;
  abort: (reqId: number) => Promise<boolean>;
  onChunk: (cb: (reqId: number, data: string) => void) => () => void;
  onStderr: (cb: (reqId: number, data: string) => void) => () => void;
  onDone: (cb: (reqId: number, code: number, error: string | null) => void) => () => void;
}

interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  shell: {
    spawn: (cwd?: string) => Promise<number>;
    write: (id: number, data: string) => Promise<boolean>;
    kill: (id: number) => Promise<boolean>;
    onStdout: (cb: (id: number, data: string) => void) => () => void;
    onStderr: (cb: (id: number, data: string) => void) => () => void;
    onExit: (cb: (id: number, code: number) => void) => () => void;
  };
  exec: (command: string, cwd?: string, timeoutMs?: number) => Promise<ExecResult>;
  claudeCode?: ClaudeCodeAPI;
}

function getAPI(): ElectronAPI | null {
  const w = window as unknown as { electronAPI?: ElectronAPI };
  return w.electronAPI?.isElectron ? w.electronAPI : null;
}

export function isElectron(): boolean {
  return getAPI() !== null;
}

// ─── Interactive shell ────────────────────────────────────────────

export function spawnShell(cwd?: string): Promise<number> {
  const api = getAPI();
  if (!api) return Promise.resolve(-1);
  return api.shell.spawn(cwd);
}

export function writeShell(id: number, data: string): Promise<boolean> {
  const api = getAPI();
  if (!api) return Promise.resolve(false);
  return api.shell.write(id, data);
}

export function killShell(id: number): Promise<boolean> {
  const api = getAPI();
  if (!api) return Promise.resolve(false);
  return api.shell.kill(id);
}

export function onShellStdout(cb: (id: number, data: string) => void): () => void {
  const api = getAPI();
  if (!api) return () => {};
  return api.shell.onStdout(cb);
}

export function onShellStderr(cb: (id: number, data: string) => void): () => void {
  const api = getAPI();
  if (!api) return () => {};
  return api.shell.onStderr(cb);
}

export function onShellExit(cb: (id: number, code: number) => void): () => void {
  const api = getAPI();
  if (!api) return () => {};
  return api.shell.onExit(cb);
}

// ─── One-shot command execution (for agent tools) ─────────────────

export async function execCommand(
  command: string,
  cwd?: string,
  timeoutMs?: number,
): Promise<ExecResult> {
  const api = getAPI();
  if (!api) {
    return { ok: false, stdout: '', stderr: 'Not running in Electron', code: -1 };
  }
  return api.exec(command, cwd, timeoutMs);
}

// ─── Claude Code CLI execution (streaming) ────────────────────────

export async function runClaudeCode(
  prompt: string,
  systemPrompt: string,
  cwd?: string,
  onData?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const api = getAPI();
  if (!api?.claudeCode) {
    throw new Error('Claude Code requires the Electron app. Make sure `claude` CLI is installed.');
  }

  const reqId = await api.claudeCode.start(prompt, systemPrompt, cwd, 300_000);

  // Abort support
  if (signal) {
    const onAbort = () => api.claudeCode!.abort(reqId);
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return new Promise<string>((resolve, reject) => {
    let fullOutput = '';

    const removeChunk = api.claudeCode!.onChunk((id, chunk) => {
      if (id !== reqId) return;
      fullOutput += chunk;
      onData?.(chunk);
    });

    const removeStderr = api.claudeCode!.onStderr((id, data) => {
      if (id !== reqId) return;
      // stderr is logged but not shown to the user as output
      console.warn('[Claude Code stderr]', data);
    });

    const removeDone = api.claudeCode!.onDone((id, code, error) => {
      if (id !== reqId) return;
      cleanup();
      if (error) {
        reject(new Error(`Claude Code error: ${error}`));
      } else if (code !== 0) {
        reject(new Error(fullOutput || `Claude Code exited with code ${code}. Is the \`claude\` CLI installed?`));
      } else {
        resolve(fullOutput);
      }
    });

    function cleanup() {
      removeChunk();
      removeStderr();
      removeDone();
    }
  });
}
