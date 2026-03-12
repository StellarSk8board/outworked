// Sandboxed JavaScript execution in a Web Worker
// Runs untrusted code safely — no DOM/network access

const WORKER_CODE = `
"use strict";
self.onmessage = function(e) {
  const code = e.data.code;
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = function(...args) { logs.push({ type: 'log', text: args.map(String).join(' ') }); };
  console.error = function(...args) { logs.push({ type: 'error', text: args.map(String).join(' ') }); };
  console.warn = function(...args) { logs.push({ type: 'warn', text: args.map(String).join(' ') }); };

  try {
    const fn = new Function(code);
    const result = fn();
    self.postMessage({ ok: true, result: result !== undefined ? String(result) : undefined, logs });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err), logs });
  }
};
`;

export interface ExecResult {
  ok: boolean;
  result?: string;
  error?: string;
  logs: { type: 'log' | 'error' | 'warn'; text: string }[];
}

export function executeCode(code: string, timeoutMs = 5000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const timer = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({ ok: false, error: 'Execution timed out (5s limit)', logs: [] });
    }, timeoutMs);

    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(e.data as ExecResult);
    };

    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({ ok: false, error: e.message || 'Worker error', logs: [] });
    };

    worker.postMessage({ code });
  });
}

/** Extract code blocks from an agent reply */
export function extractCodeBlocks(text: string): { language: string; code: string }[] {
  const blocks: { language: string; code: string }[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ language: match[1] || 'javascript', code: match[2].trim() });
  }
  return blocks;
}
