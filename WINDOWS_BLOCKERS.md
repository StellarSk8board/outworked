# Windows Blockers — Outworked

**Date:** 2026-03-27
**Severity scale:** CRITICAL / HIGH / MEDIUM / LOW

---

## CRITICAL Blockers

---

### BLOCKER-01: iMessage channel crashes / shows on Windows

**Severity:** CRITICAL
**MVP scope:** Must fix in MVP (disable/hide)

**Why it blocks Windows:**
The iMessage channel uses `~/Library/Messages/chat.db` (macOS path), the `osascript` CLI, and the `sqlite3` CLI, none of which exist on Windows. Although the runtime has a `process.platform !== "darwin"` guard that throws an error before any damage, the channel still appears in the UI (onboarding, channels panel) on Windows, causing confusion and failed setup attempts.

**Affected files:**
- `electron/channels/imessage-channel.js` (entire file)
- `electron/channels/index.js` — registers iMessage channel regardless of platform
- `src/components/OnboardingModal.tsx` — line 345, 352 mention iMessage in UI copy
- `src/lib/tools.ts` — lines 322, 334, 522 mention iMessage in agent tool descriptions
- `src/lib/orchestrator.ts` — line 127 mentions iMessage in system prompt

**Recommended fix:**
1. In `electron/channels/index.js`: wrap iMessage registration in `if (process.platform === "darwin")`.
2. In `OnboardingModal.tsx`: replace "iMessage and Slack" with "Slack" when `window.electronAPI.platform === "win32"`.
3. In `src/lib/tools.ts` send_message description: remove iMessage from the string on Windows (or make description dynamic).
4. In `src/lib/orchestrator.ts`: remove iMessage from system prompt on Windows.
5. Expose `process.platform` via preload (it may already be exposed — check `preload.js`).

---

### BLOCKER-02: `process.kill(-pid)` crashes the process on Windows

**Severity:** CRITICAL
**MVP scope:** Must fix in MVP

**Why it blocks Windows:**
`killShellTree()` uses `process.kill(-pid, "SIGTERM")` to kill the entire Unix process group. On Windows, negative PIDs are not valid and this throws an uncaught exception, crashing the main process.

**Affected files:**
- `electron/main.js` lines 244–254 (`killShellTree` function)

**Recommended fix:**
```js
function killShellTree(proc) {
  if (!proc || proc.killed) return;
  const pid = proc.pid;
  if (!pid) { proc.kill(); return; }
  if (process.platform === "win32") {
    // taskkill kills the process tree including spawned children
    try {
      require("child_process").execFileSync(
        "taskkill", ["/F", "/T", "/PID", String(pid)], { timeout: 5000 }
      );
    } catch { /* already dead */ }
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try { proc.kill("SIGTERM"); } catch { /* already dead */ }
    }
  }
}
```

---

## HIGH Blockers

---

### BLOCKER-03: `better-sqlite3` native module not built for Windows

**Severity:** HIGH
**MVP scope:** Must fix in MVP

**Why it blocks Windows:**
`better-sqlite3` is a C++ native addon. The current `postinstall` script runs `electron-rebuild` which will compile it — but on a Windows machine that lacks MSVC build tools or `windows-build-tools`, this will fail silently or with a cryptic error. If the module is not rebuilt for the correct Electron ABI, the app will fail to launch.

Additionally, `electron-builder.yml` has `npmRebuild: false`, which disables automatic native module rebuild during packaging. This means a packaged Windows build will contain the wrong `.node` binary.

**Affected files:**
- `package.json` — `postinstall` script
- `electron-builder.yml` — `npmRebuild: false`

**Recommended fix:**
1. Change `npmRebuild: false` to `npmRebuild: true` in `electron-builder.yml` (or remove the line — `true` is the default).
2. Document that Windows developers need Visual Studio Build Tools or `npm install --global windows-build-tools` before `npm install`.
3. Alternatively, configure electron-builder to use pre-built binaries from `@electron/rebuild` cache.

---

### BLOCKER-04: Claude CLI not found on Windows

**Severity:** HIGH
**MVP scope:** Must fix in MVP

**Why it blocks Windows:**
`getClaudeExecutablePath()` in `sdk-bridge.js` checks:
- `~/.claude/bin/claude` (no `.exe` extension)
- `~/.local/bin/claude` (Unix path, doesn't exist on Windows)
- `/usr/local/bin/claude` (Unix path, doesn't exist on Windows)
- Falls back to `execFileSync("which", ["claude"])` — `which` doesn't exist on Windows

If none found, the SDK tries its built-in path, which is inside the `.asar` archive and cannot be spawned. Result: Claude Code sessions fail to start.

**Affected files:**
- `electron/sdk-bridge.js` lines 23–55

**Recommended fix:**
```js
function getClaudeExecutablePath() {
  if (_claudeExePath) return _claudeExePath;
  const home = require("os").homedir();
  const isWin = process.platform === "win32";
  const ext = isWin ? ".exe" : "";
  const candidates = [
    path.join(home, ".claude", "bin", `claude${ext}`),
    path.join(home, ".local", "bin", `claude${ext}`),   // Linux
    "/usr/local/bin/claude",                               // macOS/Linux
  ].filter(Boolean);

  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.F_OK); _claudeExePath = p; return p; } catch {}
  }

  // Fallback: find via shell
  const finder = isWin ? "where" : "which";
  try {
    _claudeExePath = execFileSync(finder, ["claude"], { encoding: "utf8", timeout: 3000 }).trim().split("\n")[0];
    if (_claudeExePath) return _claudeExePath;
  } catch {}

  return undefined;
}
```

---

### BLOCKER-05: Dev script env-var syntax breaks on Windows

**Severity:** HIGH
**MVP scope:** Must fix in MVP (blocks `npm run electron:dev`)

**Why it blocks Windows:**
`package.json` scripts use Unix inline env-var assignment:
```json
"electron:dev": "vite build && VERBOSE_LOGGING=true electron ."
```
In cmd.exe and PowerShell, `VERBOSE_LOGGING=true electron .` is not valid syntax. This blocks the primary development workflow.

**Affected files:**
- `package.json` — `electron:dev` script

**Recommended fix:**
Install `cross-env` and rewrite:
```json
"electron:dev": "vite build && cross-env VERBOSE_LOGGING=true electron ."
```
Or split into platform scripts using npm's `--` forwarding if `cross-env` is undesirable.

---

### BLOCKER-06: `HOME` env var missing in `sdk-bridge.js`

**Severity:** HIGH
**MVP scope:** Must fix in MVP

**Why it blocks Windows:**
`sdk-bridge.js:26` reads `process.env.HOME || ""`. On Windows, `HOME` is not set by default — the correct variable is `USERPROFILE` or `HOMEPATH`. An empty string means all Claude CLI candidate paths resolve to invalid locations like `\.claude\bin\claude`.

`main.js:720` already handles this correctly (`process.env.HOME || process.env.USERPROFILE`), but `sdk-bridge.js` does not.

**Affected files:**
- `electron/sdk-bridge.js` line 26

**Recommended fix:**
Replace:
```js
const home = process.env.HOME || "";
```
With:
```js
const home = require("os").homedir();
```
`os.homedir()` is cross-platform and always returns the correct value.

---

## MEDIUM Blockers

---

### BLOCKER-07: Windows `.ico` icon missing for packaging

**Severity:** MEDIUM
**MVP scope:** Should fix for MVP packaging

**Why it blocks Windows:**
`electron-builder` on Windows requires a `.ico` file for the NSIS installer and taskbar icon. The repo only has `build/icon.png` (PNG) and `build/icon.icns` (macOS). electron-builder can auto-convert from PNG, but the result may be lower quality (missing sizes). Without a proper multi-size `.ico`, the packaged app will have a degraded or missing icon.

**Affected files:**
- `build/` directory — no `icon.ico`
- `electron-builder.yml` — no `win.icon` specified

**Recommended fix:**
Generate `build/icon.ico` from `build/icon.png` using an online converter or `sharp`/`to-ico` npm package. Add `win: icon: build/icon.ico` to `electron-builder.yml`.

---

### BLOCKER-08: `augmentedEnv()` adds non-existent Unix paths to Windows PATH

**Severity:** MEDIUM
**MVP scope:** Minor fix for MVP

**Why it blocks Windows:**
`augmentedEnv()` always prepends `/usr/local/bin` and `~/.local/bin` to PATH. On Windows these paths don't exist, so they don't cause errors — but they add noise to the environment and may mask the fact that Windows Claude paths are not being added.

**Affected files:**
- `electron/main.js` lines 223–234

**Recommended fix:**
Make the extra paths platform-conditional:
```js
const extraPaths = process.platform === "win32"
  ? [
      path.join(home, ".claude", "bin"),
      path.join(home, "AppData", "Local", "Programs", "claude", "bin"),
    ]
  : [
      path.join(home, ".local", "bin"),
      path.join(home, ".claude", "bin"),
      path.join(home, "bin"),
      "/usr/local/bin",
    ];
```

---

### BLOCKER-09: `npm run version` uses bash script

**Severity:** LOW
**MVP scope:** Post-MVP

**Why it blocks Windows:**
`"version": "bash scripts/bump-version.sh"` — requires bash. This is a developer convenience script for version bumping, not required to run or package the app.

**Affected files:**
- `package.json` — `version` script
- `scripts/bump-version.sh`

**Recommended fix:** Post-MVP. Replace with a cross-platform Node.js script, or document that developers on Windows should use Git Bash to run version bumps.

---

### BLOCKER-10: `fs.accessSync(path, X_OK)` doesn't verify executability on Windows

**Severity:** LOW
**MVP scope:** Post-MVP / non-blocking

**Why it blocks Windows:**
`fs.constants.X_OK` on Windows is an alias for `fs.constants.F_OK` — it checks existence, not executable permission. This means `getShellCmd()` will always "succeed" on the first candidate that exists, even if it's not executable. This is actually fine for the current use case (finding Claude binary or shell), but it's a subtle correctness issue.

**Affected files:**
- `electron/main.js` lines 207–211
- `electron/sdk-bridge.js` lines 35–40

**Recommended fix:** Document the behavior difference. If executability matters, spawn the binary with `--version` and catch errors. Post-MVP concern.

---

## iMessage-Specific Blockers Summary

All iMessage blockers are consolidated under BLOCKER-01. The specific technical components that must be disabled or hidden:

| Item | Location | Action |
|------|----------|--------|
| `ImessageChannel` class | `electron/channels/imessage-channel.js` | Do not instantiate on Windows |
| iMessage channel registration | `electron/channels/index.js` | Platform-gate with `process.platform === "darwin"` |
| iMessage in onboarding copy | `OnboardingModal.tsx:345,352` | ✅ Fixed (Phase 2) — conditional render via `capabilities.imessage` |
| iMessage in tool descriptions | `src/lib/tools.ts:322,334,522` | ✅ Fixed (Phase 5) — gated on `capabilities.imessage` |
| iMessage in system prompt | `src/lib/orchestrator.ts:127` | ✅ Fixed (Phase 2) — iMessage example removed from string |

Do **not** delete `imessage-channel.js` — keep it so macOS functionality is preserved. Use platform gating.

---

## Blocker Priority for Windows MVP

| Priority | Blocker | Effort |
|----------|---------|--------|
| P0 | BLOCKER-02: `process.kill(-pid)` crash | ✅ Fixed Phase 3 |
| P0 | BLOCKER-05: Dev script env-var syntax | ✅ Fixed Phase 3 |
| P1 | BLOCKER-01: iMessage disable/hide | Partial — onboarding done (Ph2), channel load done (Ph1), tools.ts remaining (Ph5) |
| P1 | BLOCKER-03: better-sqlite3 rebuild | ✅ Fixed Phase 4 |
| P1 | BLOCKER-04: Claude CLI discovery | ✅ Fixed Phase 3 |
| P1 | BLOCKER-06: `HOME` in sdk-bridge.js | ✅ Fixed Phase 3 |
| P2 | BLOCKER-07: Windows .ico icon | ✅ Fixed Phase 6 — build/icon.ico generated (7 sizes: 16–256px, 32-bit RGBA); npm run generate-ico for future regeneration |
| P2 | BLOCKER-08: augmentedEnv paths | ✅ Fixed Phase 3 |
| P3 | BLOCKER-09: bash version script | Post-MVP |
| P3 | BLOCKER-10: X_OK on Windows | Post-MVP |
