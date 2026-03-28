# Windows Compatibility Matrix — Outworked

**Legend:**
- ✅ Works on Windows now — no changes needed
- 🟡 Likely works with minor fixes — small, isolated changes
- 🟠 Needs Windows-specific adaptation — non-trivial platform work
- 🔴 Must be disabled on Windows — no viable Windows equivalent
- ❓ Unknown — needs runtime validation on a Windows machine

---

## Renderer Layer

| Component | Status | Notes |
|-----------|--------|-------|
| React + Vite + TypeScript | ✅ Works | Pure web stack, fully portable |
| TailwindCSS | ✅ Works | CSS only |
| Phaser 3 pixel office scene | ✅ Works | Canvas-based, platform-agnostic |
| `src/components/` (all UI) | ✅ Works | No platform-specific code |
| `src/lib/orchestrator.ts` | ✅ Works | Pure JS logic; one iMessage string mention in prompt text |
| `src/lib/tools.ts` | ✅ Works | Tool descriptions mention iMessage in strings only |
| `src/lib/types.ts` | ✅ Works | Type definitions only |
| Audio / music tracks | ✅ Works | Standard HTML5 audio |
| `window.electronAPI` calls | ✅ Works | Bridge is platform-neutral |

---

## Preload Layer

| Component | Status | Notes |
|-----------|--------|-------|
| `electron/preload.js` (context bridge) | ✅ Works | Exposes IPC, no platform logic |
| `homedir` arg parsing | ✅ Works | Reads from `--homedir=` arg passed by main |

---

## Main Process — Shell & Process

| Component | Status | Notes |
|-----------|--------|-------|
| `getShellCmd()` — Win32 branch | 🟡 Minor fix | Returns `cmd.exe` ✓; consider adding PowerShell option |
| `augmentedEnv()` — HOME detection | 🟡 Minor fix | Uses `process.env.HOME`; must add `os.homedir()` or `USERPROFILE` fallback |
| `augmentedEnv()` — PATH extras | 🟡 Minor fix | Adds `/usr/local/bin` (harmless but useless on Windows); add Windows Claude paths |
| `shell:spawn` IPC — cmd.exe branch | 🟡 Minor fix | Correct shell, but `TERM=xterm-256color` passes through unnecessarily |
| `shell:exec` IPC — `shell: true` branch | 🟡 Minor fix | Correct for Windows; escaping differences may surface in edge cases |
| `killShellTree()` — `process.kill(-pid)` | 🟠 Needs adaptation | Unix-only signal group. Windows needs `taskkill /F /T /PID` fallback |
| `TERM` env var in shell env | 🟡 Minor fix | Safe to omit on Windows (or set to `dumb`) |

---

## Main Process — Claude Code SDK

| Component | Status | Notes |
|-----------|--------|-------|
| `@anthropic-ai/claude-agent-sdk` (ESM) | ✅ Works | Pure JS, platform-neutral |
| `getClaudeExecutablePath()` | 🟠 Needs adaptation | Uses `HOME`, hardcoded Unix paths, `which` fallback. Needs Windows paths (`%USERPROFILE%\.claude\bin\claude.exe`) and `where` fallback |
| SDK session streaming | ✅ Works | HTTP-based, platform-neutral |
| Abort / heartbeat logic | ✅ Works | Platform-neutral |
| Permission request flow | ✅ Works | IPC-based, platform-neutral |
| `~/.claude/settings.json` read/write | ✅ Works | Uses `os.homedir()` in most places |
| `~/.claude/agents/*.md` watch | ✅ Works | `fs.watch` is cross-platform |

---

## Main Process — Git Operations

| Component | Status | Notes |
|-----------|--------|-------|
| `git` CLI calls via `execFileSync` | ✅ Works | `git` available on Windows with Git for Windows |
| `git status`, `diff`, `log`, etc. | ✅ Works | Standard git subcommands |
| `git:commit`, `git:push` | ✅ Works | Portable |
| `git:createBranch`, `git:checkoutBranch` | ✅ Works | Portable |
| `gh` CLI for pull requests | 🟡 Minor fix | `gh` must be on Windows PATH; no automatic detection of Windows install location |
| `git:createPr` via `gh pr create` | 🟡 Minor fix | Depends on `gh` CLI being available |
| Git spawn — Win32 branch | 🟡 Minor fix | `shell: true` on Windows; correctly handled but test needed |

---

## Main Process — File System

| Component | Status | Notes |
|-----------|--------|-------|
| `fs.readFile`, `fs.writeFile` | ✅ Works | Node.js standard, portable |
| `fs.watch({ recursive: true })` | ✅ Works | Works on Windows (uses ReadDirectoryChangesW) |
| `fs.accessSync(path, X_OK)` | 🟡 Minor fix | `X_OK` check is meaningful on Unix; on Windows it checks file existence only. Works but doesn't truly verify executability |
| `path.join(...)` for all paths | ✅ Works | Uses `path.join` throughout — correct |
| `os.homedir()` | ✅ Works | Returns `C:\Users\<user>` on Windows |
| `app.getPath("userData")` | ✅ Works | Not used (app uses `~/.outworked` directly) |
| Workspace directory validation | ✅ Works | Uses `path.resolve` and `fs.statSync` |

---

## Main Process — Database

| Component | Status | Notes |
|-----------|--------|-------|
| `better-sqlite3` native module | ✅ Fixed (Phase 4) | `npmRebuild: true` in electron-builder.yml; `asarUnpack: ["**/*.node"]` ensures binary is outside asar. Dev install still requires build tools (MSVC) for local `electron-rebuild`. |
| `~/.outworked/outworked.db` path | ✅ Works | `os.homedir()` resolves correctly on Windows |
| WAL mode, all SQL operations | ✅ Works | SQLite is cross-platform |
| Session JSON files under `~/.outworked/sessions/` | ✅ Works | Standard file I/O |

---

## Channel System

| Component | Status | Notes |
|-----------|--------|-------|
| `channels/base-channel.js` | ✅ Works | Abstract base class, no platform code |
| `channels/channel-manager.js` | ✅ Works | IPC bridge and echo detection, platform-neutral |
| `channels/slack.js` | ✅ Works | HTTP/WebSocket to Slack API |
| `channels/imessage-channel.js` | 🔴 Disable | Requires `~/Library/Messages/chat.db`, `osascript`, `sqlite3` CLI. All macOS-only. Has `process.platform !== "darwin"` guard at runtime. |
| `channels/index.js` — iMessage registration | ✅ Fixed (Phase 1) | `CHANNEL_CAPABILITIES` map gates load on `CAPABILITIES.imessage` |

---

## MCP Server & cloudflared

| Component | Status | Notes |
|-----------|--------|-------|
| HTTP MCP server on localhost:7823 | ✅ Works | Pure Node.js HTTP, portable |
| cloudflared URL selection | ✅ Works | Win32 x64 `.exe` URL already handled |
| cloudflared download | 🟡 Minor fix | Uses `tar -xzf` on macOS, direct `.exe` on Windows — Windows branch already exists |
| cloudflared binary path `~/.outworked/bin/cloudflared.exe` | ✅ Works | `.exe` suffix applied on `win32` |
| Tunnel management | ❓ Unknown | Cloudflared on Windows may behave differently; needs runtime test |

---

## Skills System

| Component | Status | Notes |
|-----------|--------|-------|
| `skills/base-runtime.js` | ✅ Works | Platform-neutral |
| `skills/skill-runtime-manager.js` | ✅ Works | Platform-neutral |
| `skills/oauth-helper.js` | ✅ Works | HTTP-based OAuth flows |
| `skills/browser/` (Chromium) | ✅ Works | Electron embeds Chromium on all platforms |
| `skills/gmail/` | ✅ Works | HTTP API |
| `skills/google-calendar/` | ✅ Works | HTTP API |
| `skills/google-drive/` | ✅ Works | HTTP API |
| `skills/google-sheets/` | ✅ Works | HTTP API |
| `skills/notion/` | ✅ Works | HTTP API |
| `skills/scheduler/` | ✅ Works | Timer-based, platform-neutral |
| `skills/slack/` | ✅ Works | HTTP/WebSocket |

---

## Trigger Engine & Webhooks

| Component | Status | Notes |
|-----------|--------|-------|
| `triggers/trigger-engine.js` | ✅ Works | Timer/cron logic, platform-neutral |
| `triggers/webhook-server.js` | ✅ Works | Node.js HTTP server |

---

## Packaging & Distribution

| Component | Status | Notes |
|-----------|--------|-------|
| `electron-builder` | ✅ Works | Supports Windows |
| NSIS installer target | ✅ Works | Already configured in electron-builder.yml |
| Windows icon (`build/icon.ico`) | 🟠 Needs adaptation | Missing — only `.png` and `.icns` exist. Electron-builder can derive from PNG but a proper `.ico` (multi-size) is needed for best results |
| Code signing | ❓ Unknown | No Windows signing config. Unsigned app will show SmartScreen warning on first run. Acceptable for dev/internal builds; needs certificate for public release |
| `npmRebuild` in electron-builder.yml | ✅ Fixed (Phase 4) | Changed to `true` |
| Auto-update (electron-updater + NSIS) | 🟡 Minor fix | Updater works on Windows; updater delta/full download needs test |
| GitHub releases publish | ✅ Works | Platform-neutral |

---

## Build & Dev Scripts

| Script | Status | Notes |
|--------|--------|-------|
| `npm run dev` (vite) | ✅ Works | Pure Node.js |
| `npm run build` (vite build) | ✅ Works | Pure Node.js |
| `npm run electron:dev` | 🟠 Needs adaptation | Uses `VERBOSE_LOGGING=true electron .` — Unix env-var syntax. Needs `cross-env` package or PowerShell syntax |
| `npm run electron:build` | 🟡 Minor fix | Same `VERBOSE_LOGGING` concern; vite + electron-builder both work on Windows |
| `npm run postinstall` (electron-rebuild) | 🟡 Minor fix | `electron-rebuild` works on Windows with MSVC build tools |
| `npm run version` (bash script) | 🔴 Disable | Calls `bash scripts/bump-version.sh` — not usable from Windows native shell |
| `scripts/update-homebrew-cask.sh` | 🔴 N/A | Homebrew is macOS/Linux only |

---

## Summary Counts

| Status | Count |
|--------|-------|
| ✅ Works on Windows now | 38 |
| 🟡 Likely works with minor fixes | 12 |
| 🟠 Needs Windows-specific adaptation | 7 |
| 🔴 Must be disabled on Windows | 4 |
| ❓ Unknown, needs runtime validation | 3 |
