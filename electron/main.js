const {
  app,
  BrowserWindow,
  Menu,
  shell,
  session,
  ipcMain,
  dialog,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

let mainWindow = null;

// Detect available shell — prefer $SHELL, then zsh, bash, sh
function getShellCmd() {
  if (process.platform === "win32") return "cmd.exe";
  const candidates = [
    process.env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/usr/bin/bash",
    "/bin/sh",
  ].filter(Boolean);
  for (const sh of candidates) {
    try {
      fs.accessSync(sh, fs.constants.X_OK);
      return sh;
    } catch {
      /* not available or not executable */
    }
  }
  return "sh"; // bare name — let the OS resolve via PATH
}

const SHELL_CMD = getShellCmd();

// GitHub token injected by renderer after loading API keys
let githubToken = "";

// ─── Shell process management ─────────────────────────────────────
const shells = new Map(); // id → { proc, cwd }
let shellIdCounter = 0;
const claudeProcs = new Map(); // reqId → ChildProcess
let claudeReqId = 0;

function setupShellIPC() {
  // Spawn a new shell session
  ipcMain.handle("shell:spawn", (_event, cwd) => {
    const id = ++shellIdCounter;
    const isWin = process.platform === "win32";
    const proc = isWin
      ? spawn("cmd.exe", [], {
          cwd: cwd || process.env.HOME,
          env: { ...process.env, TERM: "xterm-256color" },
        })
      : spawn(SHELL_CMD, ["-l"], {
          cwd: cwd || process.env.HOME,
          env: { ...process.env, TERM: "xterm-256color" },
        });
    shells.set(id, { proc, cwd: cwd || process.env.HOME });

    proc.stdout.on("data", (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("shell:stdout", id, data.toString());
      }
    });

    proc.stderr.on("data", (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("shell:stderr", id, data.toString());
      }
    });

    proc.on("error", (err) => {
      console.error(`Shell ${id} error:`, err.message);
      shells.delete(id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          "shell:stderr",
          id,
          `[shell error] ${err.message}\n`,
        );
        mainWindow.webContents.send("shell:exit", id, -1);
      }
    });

    proc.on("exit", (code) => {
      shells.delete(id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("shell:exit", id, code);
      }
    });

    return id;
  });

  // Write to a shell's stdin
  ipcMain.handle("shell:write", (_event, id, data) => {
    const entry = shells.get(id);
    if (entry && entry.proc && !entry.proc.killed) {
      entry.proc.stdin.write(data);
      return true;
    }
    return false;
  });

  // Kill a shell
  ipcMain.handle("shell:kill", (_event, id) => {
    const entry = shells.get(id);
    if (entry && entry.proc) {
      entry.proc.kill();
      shells.delete(id);
      return true;
    }
    return false;
  });

  // Run a single command and return stdout/stderr (for agent tool use)
  ipcMain.handle("shell:exec", (_event, command, cwd, timeoutMs) => {
    return new Promise((resolve) => {
      if (!command || typeof command !== "string") {
        resolve({
          ok: false,
          stdout: "",
          stderr: "",
          error: "No command provided",
          code: -1,
        });
        return;
      }

      const execCwd = cwd || process.env.HOME;

      // Ensure the working directory exists before spawning
      try {
        fs.mkdirSync(execCwd, { recursive: true });
      } catch {
        /* best-effort */
      }

      // Use the user's login shell so PATH from .zprofile / .zshenv is available
      const isWin = process.platform === "win32";
      const proc = isWin
        ? spawn(command, {
            cwd: execCwd,
            env: {
              ...process.env,
              TERM: "dumb",
              ...(githubToken
                ? { GH_TOKEN: githubToken, GITHUB_TOKEN: githubToken }
                : {}),
            },
            timeout: timeoutMs || 30000,
            shell: true,
          })
        : spawn(SHELL_CMD, ["-l", "-c", command], {
            cwd: execCwd,
            env: {
              ...process.env,
              TERM: "dumb",
              ...(githubToken
                ? { GH_TOKEN: githubToken, GITHUB_TOKEN: githubToken }
                : {}),
            },
            timeout: timeoutMs || 30000,
          });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (err) => {
        resolve({ ok: false, stdout, stderr, error: err.message, code: -1 });
      });

      proc.on("close", (code) => {
        resolve({
          ok: code === 0,
          stdout,
          stderr,
          code: code ?? -1,
          ...(code === null
            ? { error: "Process timed out or was killed" }
            : {}),
        });
      });
    });
  });

  // Set GitHub token for use in git/gh commands
  ipcMain.handle("shell:setGithubToken", (_event, token) => {
    githubToken = typeof token === "string" ? token : "";
  });

  // ─── Claude Code integration ──────────────────────────────────
  // Runs `claude -p` (print mode) with streaming stdout chunks sent
  // to the renderer so onThought can update incrementally.
  // Prompt is piped via stdin to avoid shell-escaping pitfalls.
  // System prompt is passed via an env var to avoid quoting issues.

  ipcMain.handle(
    "claude-code:start",
    (_event, prompt, systemPrompt, cwd, timeoutMs) => {
      const reqId = ++claudeReqId;

      const execCwd = cwd || process.env.HOME;
      try {
        fs.mkdirSync(execCwd, { recursive: true });
      } catch {
        /* best-effort */
      }

      const isWin = process.platform === "win32";
      const cmd = systemPrompt
        ? 'claude -p --output-format text --system-prompt "$OUTWORKED_SYS"'
        : "claude -p --output-format text";

      const proc = isWin
        ? spawn("cmd.exe", ["/c", cmd], {
            cwd: execCwd,
            env: {
              ...process.env,
              TERM: "dumb",
              OUTWORKED_SYS: systemPrompt || "",
            },
            timeout: timeoutMs || 300000,
          })
        : spawn(SHELL_CMD, ["-l", "-c", cmd], {
            cwd: execCwd,
            env: {
              ...process.env,
              TERM: "dumb",
              OUTWORKED_SYS: systemPrompt || "",
            },
            timeout: timeoutMs || 300000,
          });

      claudeProcs.set(reqId, proc);

      // Pipe prompt through stdin (no shell escaping needed)
      proc.stdin.write(prompt);
      proc.stdin.end();

      proc.stdout.on("data", (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            "claude-code:chunk",
            reqId,
            data.toString(),
          );
        }
      });

      proc.stderr.on("data", (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            "claude-code:stderr",
            reqId,
            data.toString(),
          );
        }
      });

      proc.on("error", (err) => {
        claudeProcs.delete(reqId);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            "claude-code:done",
            reqId,
            -1,
            err.message,
          );
        }
      });

      proc.on("close", (code) => {
        claudeProcs.delete(reqId);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            "claude-code:done",
            reqId,
            code ?? -1,
            null,
          );
        }
      });

      return reqId;
    },
  );

  ipcMain.handle("claude-code:abort", (_event, reqId) => {
    const proc = claudeProcs.get(reqId);
    if (proc && !proc.killed) {
      proc.kill();
      claudeProcs.delete(reqId);
      return true;
    }
    return false;
  });
}

// Clean up child processes on quit
app.on("before-quit", () => {
  for (const [, entry] of shells) {
    if (entry.proc && !entry.proc.killed) entry.proc.kill();
  }
  shells.clear();
  for (const [, proc] of claudeProcs) {
    if (proc && !proc.killed) proc.kill();
  }
  claudeProcs.clear();
});

// ─── Filesystem IPC ───────────────────────────────────────────────
let workspaceDir = path.join(process.env.HOME || "", "outworked-workspace");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveSafe(relativePath) {
  // Prevent path traversal outside workspace
  const resolved = path.resolve(workspaceDir, relativePath);
  if (!resolved.startsWith(workspaceDir)) {
    throw new Error("Path escapes workspace");
  }
  return resolved;
}

function setupFilesystemIPC() {
  // Get / set workspace directory
  ipcMain.handle("fs:getWorkspace", () => workspaceDir);

  ipcMain.handle("fs:setWorkspace", (_event, dir) => {
    workspaceDir = dir;
    ensureDir(workspaceDir);
    return workspaceDir;
  });

  ipcMain.handle("fs:pickWorkspace", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose workspace folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    workspaceDir = result.filePaths[0];
    return workspaceDir;
  });

  // Write a file (creates parent dirs as needed)
  ipcMain.handle("fs:writeFile", (_event, relPath, content) => {
    const abs = resolveSafe(relPath);
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, content, "utf-8");
    return { ok: true, bytes: Buffer.byteLength(content, "utf-8") };
  });

  // Read a file
  ipcMain.handle("fs:readFile", (_event, relPath) => {
    const abs = resolveSafe(relPath);
    if (!fs.existsSync(abs)) return { ok: false, error: "File not found" };
    return { ok: true, content: fs.readFileSync(abs, "utf-8") };
  });

  // Delete a file
  ipcMain.handle("fs:deleteFile", (_event, relPath) => {
    const abs = resolveSafe(relPath);
    if (!fs.existsSync(abs)) return { ok: false, error: "File not found" };
    fs.unlinkSync(abs);
    return { ok: true };
  });

  // List files recursively
  ipcMain.handle("fs:listFiles", (_event, relDir) => {
    const abs = relDir ? resolveSafe(relDir) : workspaceDir;
    ensureDir(abs);
    const results = [];
    const SKIP_LIST = new Set([
      "node_modules",
      ".git",
      ".hg",
      ".svn",
      "dist",
      "build",
      "out",
      ".next",
      ".nuxt",
      ".cache",
      "__pycache__",
      ".tox",
      ".venv",
      "venv",
      ".gradle",
      ".idea",
      ".vs",
      "coverage",
      "target",
      "bin",
      "obj",
      ".turbo",
      ".parcel-cache",
      ".webpack",
    ]);
    function walk(dir, prefix) {
      if (results.length >= 5000) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= 5000) return;
        const rel = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.isDirectory()) {
          if (SKIP_LIST.has(entry.name) || entry.name.startsWith(".")) continue;
          walk(path.join(dir, entry.name), rel);
        } else {
          const stat = fs.statSync(path.join(dir, entry.name));
          results.push({ path: rel, size: stat.size, updatedAt: stat.mtimeMs });
        }
      }
    }
    walk(abs, relDir || "");
    return results;
  });

  // Directories to skip during recursive walks
  const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    ".hg",
    ".svn",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".cache",
    "__pycache__",
    ".tox",
    ".venv",
    "venv",
    ".gradle",
    ".idea",
    ".vs",
    "coverage",
    "target",
    "bin",
    "obj",
    ".turbo",
    ".parcel-cache",
    ".webpack",
  ]);
  const MAX_FILES = 5000;
  const MAX_DEPTH = 20;

  // List all files (metadata only — no content) for the file browser
  ipcMain.handle("fs:listAllFiles", () => {
    ensureDir(workspaceDir);
    const results = [];
    function walk(dir, prefix, depth) {
      if (depth > MAX_DEPTH || results.length >= MAX_FILES) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= MAX_FILES) return;
        const rel = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
          walk(path.join(dir, entry.name), rel, depth + 1);
        } else {
          try {
            const stat = fs.statSync(path.join(dir, entry.name));
            results.push({
              path: rel,
              size: stat.size,
              updatedAt: stat.mtimeMs,
            });
          } catch {
            /* skip unreadable */
          }
        }
      }
    }
    walk(workspaceDir, "", 0);
    return results;
  });

  // Get all files with content (for file browser panel)
  ipcMain.handle("fs:getAllFiles", () => {
    ensureDir(workspaceDir);
    const results = [];
    function walk(dir, prefix, depth) {
      if (depth > MAX_DEPTH || results.length >= MAX_FILES) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= MAX_FILES) return;
        const rel = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
          walk(path.join(dir, entry.name), rel, depth + 1);
        } else {
          const abs = path.join(dir, entry.name);
          let stat;
          try {
            stat = fs.statSync(abs);
          } catch {
            continue;
          }
          // Skip binary / huge files
          if (stat.size > 512 * 1024) continue;
          try {
            const content = fs.readFileSync(abs, "utf-8");
            results.push({ path: rel, content, updatedAt: stat.mtimeMs });
          } catch {
            // skip unreadable files
          }
        }
      }
    }
    walk(workspaceDir, "", 0);
    return results;
  });
}

// ─── Music IPC ────────────────────────────────────────────────────
function getMusicDir() {
  return path.join(__dirname, "..", "dist-renderer", "music");
}

/** Minimal ID3 tag parser – extracts title from ID3v2 (TIT2) or ID3v1 */
function readTitle(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const stat = fs.fstatSync(fd);

    // Try ID3v2 header (at start of file)
    const header = Buffer.alloc(10);
    fs.readSync(fd, header, 0, 10, 0);
    if (header.toString("ascii", 0, 3) === "ID3") {
      const size =
        ((header[6] & 0x7f) << 21) |
        ((header[7] & 0x7f) << 14) |
        ((header[8] & 0x7f) << 7) |
        (header[9] & 0x7f);
      const tagBuf = Buffer.alloc(Math.min(size, 4096));
      fs.readSync(fd, tagBuf, 0, tagBuf.length, 10);

      // Search for TIT2 frame
      for (let i = 0; i < tagBuf.length - 10; i++) {
        if (tagBuf.toString("ascii", i, i + 4) === "TIT2") {
          const frameSize =
            (tagBuf[i + 4] << 24) |
            (tagBuf[i + 5] << 16) |
            (tagBuf[i + 6] << 8) |
            tagBuf[i + 7];
          if (frameSize > 0 && frameSize < 1024) {
            // Skip 2 flag bytes + 1 encoding byte
            const textStart = i + 11;
            const encoding = tagBuf[i + 10];
            let title;
            if (encoding === 1 || encoding === 2) {
              // UTF-16
              title = tagBuf
                .toString("utf16le", textStart, i + 10 + frameSize)
                .replace(/\0/g, "")
                .trim();
            } else {
              title = tagBuf
                .toString("utf8", textStart, i + 10 + frameSize)
                .replace(/\0/g, "")
                .trim();
            }
            if (title) {
              fs.closeSync(fd);
              return title;
            }
          }
          break;
        }
      }
    }

    // Fallback: ID3v1 (last 128 bytes)
    if (stat.size >= 128) {
      const tail = Buffer.alloc(128);
      fs.readSync(fd, tail, 0, 128, stat.size - 128);
      if (tail.toString("ascii", 0, 3) === "TAG") {
        const title = tail.toString("ascii", 3, 33).replace(/\0/g, "").trim();
        if (title) {
          fs.closeSync(fd);
          return title;
        }
      }
    }

    fs.closeSync(fd);
  } catch {
    // ignore unreadable files
  }
  return null;
}

function setupMusicIPC() {
  ipcMain.handle("music:listTracks", () => {
    const musicDir = getMusicDir();
    if (!fs.existsSync(musicDir)) return [];
    const files = fs
      .readdirSync(musicDir)
      .filter((f) => f.toLowerCase().endsWith(".mp3"))
      .sort();
    return files.map((f) => {
      const absPath = path.join(musicDir, f);
      const id3Title = readTitle(absPath);
      const fallback = f.replace(/\.mp3$/i, "").replace(/[-_]/g, " ");
      return { file: f, title: id3Title || fallback, src: `./music/${f}` };
    });
  });
}

function createWindow() {
  // Allow renderer to reach the AI provider APIs
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self' file:; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "connect-src 'self' https://api.openai.com https://api.anthropic.com; " +
            "img-src 'self' data: blob:; " +
            "worker-src 'self' blob:;",
        ],
      },
    });
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: "Outworked — AI Agent HQ",
    backgroundColor: "#0d0d1a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load the Vite build output
  const indexPath = path.join(__dirname, "..", "dist-renderer", "index.html");
  mainWindow.loadFile(indexPath);

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Set an explicit application menu to suppress macOS
  // "representedObject is not a WeakPtrToElectronMenuModelAsNSObject" warnings
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
      },
    ]),
  );

  setupShellIPC();
  setupFilesystemIPC();
  setupMusicIPC();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
