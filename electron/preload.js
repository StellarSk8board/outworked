const { contextBridge, ipcRenderer } = require("electron");

// Expose a minimal API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,

  // Filesystem
  fs: {
    getWorkspace: () => ipcRenderer.invoke("fs:getWorkspace"),
    setWorkspace: (dir) => ipcRenderer.invoke("fs:setWorkspace", dir),
    pickWorkspace: () => ipcRenderer.invoke("fs:pickWorkspace"),
    writeFile: (path, content) =>
      ipcRenderer.invoke("fs:writeFile", path, content),
    readFile: (path) => ipcRenderer.invoke("fs:readFile", path),
    deleteFile: (path) => ipcRenderer.invoke("fs:deleteFile", path),
    listFiles: (dir) => ipcRenderer.invoke("fs:listFiles", dir),
    listAllFiles: () => ipcRenderer.invoke("fs:listAllFiles"),
    getAllFiles: () => ipcRenderer.invoke("fs:getAllFiles"),
  },

  // Interactive shell sessions
  shell: {
    spawn: (cwd) => ipcRenderer.invoke("shell:spawn", cwd),
    write: (id, data) => ipcRenderer.invoke("shell:write", id, data),
    kill: (id) => ipcRenderer.invoke("shell:kill", id),
    onStdout: (cb) => {
      const listener = (_event, id, data) => cb(id, data);
      ipcRenderer.on("shell:stdout", listener);
      return () => ipcRenderer.removeListener("shell:stdout", listener);
    },
    onStderr: (cb) => {
      const listener = (_event, id, data) => cb(id, data);
      ipcRenderer.on("shell:stderr", listener);
      return () => ipcRenderer.removeListener("shell:stderr", listener);
    },
    onExit: (cb) => {
      const listener = (_event, id, code) => cb(id, code);
      ipcRenderer.on("shell:exit", listener);
      return () => ipcRenderer.removeListener("shell:exit", listener);
    },
  },

  // One-shot command execution (for agent tools)
  exec: (command, cwd, timeoutMs) =>
    ipcRenderer.invoke("shell:exec", command, cwd, timeoutMs),

  // Set GitHub token so git/gh commands have GH_TOKEN in their environment
  setGithubToken: (token) => ipcRenderer.invoke("shell:setGithubToken", token),

  // Claude Code integration (streaming)
  claudeCode: {
    start: (prompt, systemPrompt, cwd, timeoutMs) =>
      ipcRenderer.invoke(
        "claude-code:start",
        prompt,
        systemPrompt,
        cwd,
        timeoutMs,
      ),
    abort: (reqId) => ipcRenderer.invoke("claude-code:abort", reqId),
    onChunk: (cb) => {
      const listener = (_event, reqId, data) => cb(reqId, data);
      ipcRenderer.on("claude-code:chunk", listener);
      return () => ipcRenderer.removeListener("claude-code:chunk", listener);
    },
    onStderr: (cb) => {
      const listener = (_event, reqId, data) => cb(reqId, data);
      ipcRenderer.on("claude-code:stderr", listener);
      return () => ipcRenderer.removeListener("claude-code:stderr", listener);
    },
    onDone: (cb) => {
      const listener = (_event, reqId, code, error) => cb(reqId, code, error);
      ipcRenderer.on("claude-code:done", listener);
      return () => ipcRenderer.removeListener("claude-code:done", listener);
    },
  },

  // Music
  music: {
    listTracks: () => ipcRenderer.invoke("music:listTracks"),
  },
});
