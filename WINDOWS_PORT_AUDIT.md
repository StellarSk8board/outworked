# Windows Port Audit — Outworked

**Audit date:** 2026-03-27
**Auditor:** Claude Code (automated deep audit)
**Repository:** d:\Projects\OfficeCrossing
**App version:** 0.3.0

---

## Implementation Progress

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Centralize platform capability checks | ✅ Done — `electron/platform.js` created; channel loader and preload updated |
| Phase 2 | Fix onboarding/setup text for Windows | ✅ Done — install command, channels copy, iMessage bullet, orchestrator prompt |
| Phase 3 | Harden shell/process execution for Windows | ✅ Done — killShellTree, augmentedEnv, HOME, sdk-bridge paths, cross-env |
| Phase 4 | Validate database/native module assumptions | ✅ Done — npmRebuild enabled, asarUnpack set for .node files; database.js already cross-platform |
| Phase 5 | Disable iMessage on Windows (UI + backend) | ✅ Done — tools.ts and mcp-server.js descriptions gated; all user-facing strings conditional |
| Phase 6 | Windows packaging cleanup | ✅ Done — icon.ico generated (7 sizes, 16–256px), win.icon set, requestedExecutionLevel, NSIS shortcuts, @electron/rebuild dep, png-to-ico + generate-ico script |
| Phase C | Final hardening (production readiness) | ✅ Done — 11× process.env.HOME → os.homedir()/HOME; TERM removed from cmd.exe spawns; which→where for cloudflared; chmodSync guarded; validateDir Windows roots added |

---

## 1. Architecture Overview

Outworked is an Electron desktop app that acts as an AI-agent orchestration shell around the Anthropic Claude Code SDK. It consists of three distinct runtime layers:

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (Chromium)                                    │
│  React + TypeScript + Vite + TailwindCSS                │
│  Phaser 3 pixel-office game scene                       │
│  ↕ contextBridge (electronAPI)                          │
├─────────────────────────────────────────────────────────┤
│  Preload (preload.js)                                   │
│  Bridges ~50 IPC channels to renderer via contextBridge │
├─────────────────────────────────────────────────────────┤
│  Main Process (electron/main.js, 2 603 lines)           │
│  All privileged system operations                       │
└─────────────────────────────────────────────────────────┘
```

**Build system:** Vite builds the renderer to `dist-renderer/`. electron-builder packages everything. The main process is plain CommonJS JavaScript (not TypeScript).

---

## 2. Major Subsystems

| Subsystem | Entry file(s) | Description |
|-----------|--------------|-------------|
| Main process | `electron/main.js` | IPC handlers, process spawning, app lifecycle, menu |
| Preload bridge | `electron/preload.js` | `contextBridge` API exposed to renderer |
| Claude Code SDK | `electron/sdk-bridge.js` | Wraps `@anthropic-ai/claude-agent-sdk` (ESM) |
| SQLite database | `electron/db/database.js` | `better-sqlite3`, persists to `~/.outworked/outworked.db` |
| Channel system | `electron/channels/` | iMessage (macOS-only) + Slack |
| MCP server | `electron/mcp/mcp-server.js` | HTTP MCP on port 7823, cloudflared tunnel |
| Skills | `electron/skills/` | Browser, Gmail, Drive, Calendar, Sheets, Notion, Slack, scheduler |
| Trigger engine | `electron/triggers/trigger-engine.js` | Cron/interval/one-time scheduled agents |
| Webhook server | `electron/triggers/webhook-server.js` | Inbound HTTP webhook triggers |
| Git operations | `electron/main.js` (lines 1507–1800) | Full git/gh CLI integration |
| File watcher | `electron/main.js` (lines 1402–1505) | `fs.watch` recursive workspace watching |
| Auto-updater | `electron/main.js` (lines 2312–2368) | electron-updater from GitHub releases |
| Renderer | `src/` | React UI, Phaser 3, orchestrator, tools layer |

---

## 3. Electron Main/Preload/Renderer Boundaries

**Main process receives** IPC from renderer and executes all privileged operations:
- Shell spawning and execution
- File system reads/writes
- Git / gh CLI calls
- Claude Code SDK session management
- SQLite database operations
- Channel management (iMessage/Slack)
- MCP server lifecycle
- System notifications
- Auto-update

**Preload** exposes ~50 IPC channels grouped as:
`fs.*`, `shell.*`, `exec()`, `claudeCode.*`, `db.*`, `git.*`, `preview.*`, `notifications.*`, `updater.*`, `music.*`, `permissions.*`, `claudeSettings.*`, `watcher.*`, `sessions.*`

**Renderer** is pure React — never touches Node.js directly. All system calls go through `window.electronAPI.*`.

---

## 4. Platform-Specific Logic

### 4.1 Shell selection — `electron/main.js:196–217`
```js
function getShellCmd() {
  if (process.platform === "win32") return "cmd.exe";
  // Falls back through: $SHELL → /bin/zsh → /bin/bash → /usr/bin/bash → /bin/sh
}
```
Windows returns `cmd.exe`. This is the start of correct Windows handling but the calling code has gaps (see §4.2).

### 4.2 Shell spawning — `electron/main.js:324–379`
```js
const proc = isWin
  ? spawn("cmd.exe", [], { cwd, env: augmentedEnv(...) })
  : spawn(SHELL_CMD, ["-l"], { cwd, env: augmentedEnv(...), detached: true });
```
`detached: true` is omitted on Windows (correct). `TERM=xterm-256color` is passed to both (wrong for cmd.exe).

### 4.3 Shell execution — `electron/main.js:403–484`
```js
const proc = isWin
  ? spawn(command, { shell: true, ... })    // cmd /C "command"
  : spawn(SHELL_CMD, ["-l", "-c", command], ...);
```
`shell: true` on Windows correctly invokes `cmd /C`. However `augmentedEnv()` adds Unix-only paths.

### 4.4 Process tree kill — `electron/main.js:244–254`
```js
process.kill(-pid, "SIGTERM");  // Unix process group kill
```
`-pid` syntax is Unix-only. On Windows this throws. No `taskkill` fallback.

### 4.5 Home directory — multiple files
`process.env.HOME` used throughout. Windows uses `USERPROFILE`. Code in `main.js:720` partially handles this: `process.env.HOME || process.env.USERPROFILE`. But `sdk-bridge.js:26` only uses `process.env.HOME`. `database.js` likely uses `os.homedir()` (safe).

### 4.6 PATH augmentation — `electron/main.js:223–234`
Adds `/usr/local/bin` and `~/.local/bin` — meaningless on Windows. The important ones (`~/.claude/bin`, `~/bin`) use `path.join` so they do resolve correctly.

### 4.7 iMessage channel — `electron/channels/imessage-channel.js`
Hard-coded `process.platform !== "darwin"` guard. Uses `~/Library/Messages/chat.db`, `osascript`, `sqlite3` CLI. **Completely macOS-only.**

### 4.8 Build scripts — `scripts/bump-version.sh`, `scripts/update-homebrew-cask.sh`
Shell scripts. Not usable from Windows native shell. Not on the critical path for MVP.

---

## 5. Shell and Process Execution Assumptions

| Pattern | Location | Windows issue |
|---------|----------|---------------|
| `spawn(SHELL_CMD, ["-l", "-c", cmd])` | main.js:448 | Unix login shell flag `-l` invalid for cmd.exe |
| `process.kill(-pid, "SIGTERM")` | main.js:249 | Unix process group syntax, throws on Windows |
| `execFileSync("which", ["claude"])` | sdk-bridge.js:46 | `which` not available; need `where` |
| `execFileSync("tar", ["-xzf", ...])` | mcp-server.js | Requires tar; available in Windows 10 1803+ |
| `osascript` | imessage-channel.js | macOS-only, not present on Windows |
| `sqlite3` CLI | imessage-channel.js | Part of iMessage subsystem; not needed elsewhere |
| `TERM=xterm-256color` in env | main.js:332 | Harmless but meaningless for cmd.exe |
| `bash scripts/bump-version.sh` | package.json | Bash not available in native Windows shell |

---

## 6. Native Module Risks

| Module | Version | Risk | Notes |
|--------|---------|------|-------|
| `better-sqlite3` | ^12.8.0 | **Medium** | C++ native addon; requires `electron-rebuild`. Pre-built binaries are available for Windows x64 via `electron-rebuild` or `@electron/rebuild`. Must be rebuilt against the correct Electron ABI. |

No other `.node` files or `node-gyp` native addons found.

**`package.json` postinstall:**
```json
"postinstall": "electron-rebuild -f -w better-sqlite3"
```
This should work on Windows if build tools are installed (MSVC or `windows-build-tools`). Alternatively, pre-built binaries from electron-builder's platform cache may work without compilation.

---

## 7. Database and Storage Assumptions

| Path | Platform concern |
|------|-----------------|
| `~/.outworked/outworked.db` | Uses `os.homedir()` — safe cross-platform |
| `~/.outworked/sessions/` | Uses `os.homedir()` — safe |
| `~/.outworked/bin/cloudflared[.exe]` | `.exe` suffix applied on Windows in mcp-server.js — correct |
| `~/.claude/settings.json` | Uses `os.homedir()` — safe |
| `~/.claude/agents/*.md` | Uses `os.homedir()` — safe |
| `~/Library/Messages/chat.db` | **macOS-only** — iMessage subsystem only |

The hidden-directory convention (`~/.outworked`) works on Windows (Windows supports dotfiles). Electron's `app.getPath("userData")` is not used; app uses `~/.outworked` directly. This is a minor Windows UX deviation but not a blocker.

---

## 8. Packaging and Build Assumptions

**`electron-builder.yml`** already includes a `win:` target section:
```yaml
win:
  target: [nsis]
nsis:
  oneClick: true
  perMachine: false
```

**Missing from current config:**
- No Windows icon (`build/icon.ico`) — only `.png` and `.icns` exist
- No Windows code signing configuration
- `npmRebuild: false` — prevents automatic native module rebuild during packaging; must be handled manually or changed to `true` for Windows
- `build/entitlements.mac.plist` is referenced only under `mac:` — not a Windows concern

**Build scripts:** `electron:build` uses `vite build && electron-builder`. Works on Windows if Node/npm is installed. The `VERBOSE_LOGGING=true` env var syntax in `electron:dev` is Unix-only (`VERBOSE_LOGGING=true electron .`). Windows needs `cross-env` or `set VERBOSE_LOGGING=true &&`.

---

## 9. Onboarding / Setup Assumptions

**File:** `src/components/OnboardingModal.tsx`

Steps:
1. Welcome
2. Claude Code installation check — uses `claude-code:authStatus` IPC
3. Recommended permissions — applies to `~/.claude/settings.json`
4. Channel setup — mentions "iMessage and Slack" in UI text
5. Ready

**Windows gaps in onboarding:**
- Step 2 checks Claude CLI at Unix paths; Windows paths differ (`%USERPROFILE%\.claude\bin\claude.exe`)
- Step 4 copy ("like iMessage and Slack") is incorrect on Windows — should say "like Slack"
- No guidance on where to install Claude CLI on Windows
- Recommended permission list includes `Bash(git *)`, `Bash(npm *)` etc. — these work on Windows via `shell: true` but Claude Code on Windows may invoke them differently

---

## 10. Features Portable to Windows

- React/Vite renderer — fully portable
- Phaser 3 pixel office scene — fully portable
- SQLite database (via better-sqlite3 rebuilt for Windows) — portable
- All git operations (`git`, `gh` CLI calls via `execFileSync`) — portable if git/gh are on PATH
- Claude Code SDK integration — portable (SDK is pure JS/ESM)
- MCP server (HTTP on localhost:7823) — portable
- cloudflared download — Windows x64 `.exe` URL already handled in mcp-server.js
- Skills system (Gmail, Drive, Calendar, Sheets, Notion, Slack, browser, scheduler) — portable
- Trigger engine (cron/interval) — portable
- Webhook server — portable
- File watcher (`fs.watch` with `recursive: true`) — portable (works on Windows)
- Auto-updater (electron-updater, NSIS) — portable
- System notifications (`new Notification()`) — portable
- Music playback — portable

---

## 11. Features That Are macOS-Only

| Feature | Files | Portability |
|---------|-------|-------------|
| iMessage channel | `electron/channels/imessage-channel.js` | **None** — disable on Windows |
| `~/Library/Messages/chat.db` access | imessage-channel.js:11 | macOS path only |
| AppleScript (`osascript`) | imessage-channel.js | macOS only |
| macOS entitlements (Full Disk Access) | `build/entitlements.mac.plist` | macOS only |
| macOS notarization | electron-builder.yml | macOS only |
| Hardened runtime | electron-builder.yml | macOS only |
| Homebrew cask update script | `scripts/update-homebrew-cask.sh` | macOS only |
| `process.kill(-pid)` process group | main.js:249 | Unix only |

---

## 12. Items Likely to Break on Windows Without Fixes

1. **`process.kill(-pid, "SIGTERM")`** in `killShellTree()` — throws on Windows
2. **`execFileSync("which", ["claude"])`** in sdk-bridge.js — `which` is not available in Windows without Git Bash; need `where`
3. **`HOME` env var** in sdk-bridge.js — must fall back to `USERPROFILE` or use `os.homedir()`
4. **`VERBOSE_LOGGING=true electron .`** in npm script — Unix env-var syntax fails in cmd.exe/PowerShell
5. **`bash scripts/bump-version.sh`** in `version` npm script — fails without WSL/Git Bash
6. **iMessage channel** — will throw at runtime if attempted (has guard, but UI still shows it)
7. **Claude CLI discovery** — paths hardcoded to Unix format; Windows `.exe` extension not checked
8. **`/usr/local/bin`** in PATH augmentation — harmless but wrong on Windows
