# Windows Production Readiness — Outworked

**App version:** 0.3.0
**Assessment date:** 2026-03-27
**Assessor:** Claude Code (automated deep audit + Phase C hardening)

---

## 1. Readiness Checklist

### 1.1 Critical Runtime Correctness

| Item | Status | Evidence |
|------|--------|----------|
| `process.kill(-pid)` replaced with `taskkill` | ✅ DONE | `electron/main.js` `killShellTree()` |
| `HOME` env var uses `os.homedir()` everywhere | ✅ DONE | All 11 occurrences replaced; `platform.js` `HOME` constant |
| Claude CLI discovery works on Windows | ✅ DONE | `sdk-bridge.js` `getClaudeExecutablePath()` with `.exe` + `where` |
| iMessage disabled on Windows (all 6 locations) | ✅ DONE | Channel loader, preload, onboarding, orchestrator, tools.ts, mcp-server |
| `which` → `where` for cloudflared on Windows | ✅ DONE | `mcp-server.js` line 106 |
| `chmodSync` guarded on Windows | ✅ DONE | `mcp-server.js` line 144 |
| TERM env var not passed to cmd.exe | ✅ DONE | All Windows `cmd.exe` spawn branches use `augmentedEnv()` or `augmentedEnv(extraEnv)` |
| `validateDir` blocks Windows system roots | ✅ DONE | `C:\`, `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)` |

### 1.2 Build and Packaging

| Item | Status | Evidence |
|------|--------|----------|
| `cross-env` for dev script | ✅ DONE | `package.json` `electron:dev` |
| `npmRebuild: true` for `better-sqlite3` | ✅ DONE | `electron-builder.yml` |
| `asarUnpack: ["**/*.node"]` | ✅ DONE | `electron-builder.yml` |
| Windows NSIS target configured | ✅ DONE | `electron-builder.yml` `win.target: nsis` |
| `build/icon.ico` present (7 sizes) | ✅ DONE | 207KB, 16–256px, 32-bit RGBA |
| `win.icon: build/icon.ico` in builder config | ✅ DONE | `electron-builder.yml` |
| `requestedExecutionLevel: asInvoker` | ✅ DONE | No unnecessary UAC prompts |
| Desktop and Start Menu shortcuts | ✅ DONE | NSIS `createDesktopShortcut: true`, `createStartMenuShortcut: true` |
| `@electron/rebuild` dependency present | ✅ DONE | `package.json` devDependencies |
| `postinstall` warns if rebuild fails | ✅ DONE | `|| echo "WARN: ..."` fallback |

### 1.3 Platform Capability Architecture

| Item | Status | Evidence |
|------|--------|----------|
| Central `electron/platform.js` capability registry | ✅ DONE | `IS_WIN`, `IS_MAC`, `CAPABILITIES`, `HOME` |
| `CAPABILITIES.imessage` flag used in all gating points | ✅ DONE | Channel loader, preload, renderer, MCP server |
| `window.electronAPI.capabilities` exposed to renderer | ✅ DONE | `preload.js` contextBridge |
| `getCapabilities()` / `getPlatform()` exported from `src/lib/terminal.ts` | ✅ DONE | Used in OnboardingModal, tools.ts, orchestrator |

### 1.4 Onboarding / Setup UX

| Item | Status | Evidence |
|------|--------|----------|
| Install command shows "Download from claude.ai/code" on Windows | ✅ DONE | `OnboardingModal.tsx` |
| iMessage bullet hidden on Windows | ✅ DONE | `capabilities.imessage` guard |
| Channels copy correct on Windows ("like Slack") | ✅ DONE | Ternary on `capabilities.imessage` |
| System prompt does not mention iMessage on Windows | ✅ DONE | `orchestrator.ts` |
| Agent tool descriptions do not mention iMessage on Windows | ✅ DONE | `tools.ts` |

### 1.5 Storage and Database

| Item | Status | Evidence |
|------|--------|----------|
| `better-sqlite3` uses `os.homedir()` for DB path | ✅ DONE | `electron/db/database.js` |
| `~/.outworked/` storage convention works on Windows | ✅ DONE | Windows supports dotfiles |
| `cloudflared.exe` (not `cloudflared`) used on Windows | ✅ DONE | `mcp-server.js` conditional binary name |

### 1.6 Outstanding Gaps (Non-Blocking)

| Item | Priority | Notes |
|------|----------|-------|
| Code signing not configured | MEDIUM | SmartScreen warning on first run; acceptable for beta |
| `npm run version` requires bash | LOW | Developer-only; use Git Bash as workaround |
| No Windows-specific Claude CLI install path guidance in onboarding | LOW | Claude CLI installer handles PATH |
| App data in `~/.outworked` vs `%APPDATA%` | LOW | UX deviation, not a bug |

---

## 2. Risk Assessment

### 2.1 HIGH confidence areas

- **Process management:** `killShellTree` uses `taskkill /F /T /PID` — battle-tested Windows API.
- **Home directory:** All 11 `process.env.HOME` instances replaced with `os.homedir()` which is the Node.js canonical source.
- **Native module rebuild:** `npmRebuild: true` + `asarUnpack` is the correct electron-builder pattern; well-documented.
- **iMessage gating:** Six independent gating points all use the same `CAPABILITIES.imessage` flag; the flag is `false` on Windows by construction in `platform.js`.

### 2.2 MEDIUM confidence areas

- **Claude CLI discovery:** Static path `~/.claude/bin/claude.exe` + `where claude` fallback covers the standard install. Non-standard installs (e.g., Scoop, Winget to AppData\Local) would rely on `where` working, which requires the install path to be on the user's PATH. The Claude CLI installer should handle this.
- **`better-sqlite3` native rebuild:** Requires Visual Studio Build Tools. The `postinstall` script emits a helpful WARN if it fails. Pre-built binaries via electron-builder's `npmRebuild: true` should work without manual compilation during packaging.
- **Shell execution:** `cmd.exe` with `shell: true` works for most commands. Complex bash-specific syntax in agent-generated commands would fail. This is an inherent limitation of cmd.exe vs bash, not a code defect.

### 2.3 LOW confidence areas

- **NSIS installer behaviour:** Not tested in this automated audit. Icon quality, shortcut creation, and uninstallation need manual verification.
- **`better-sqlite3` cold install on Windows without pre-built binaries:** The `electron-rebuild` postinstall is best-effort. If it fails and no pre-built binary is available for the ABI, the app will fail to launch. This requires a Windows machine with Build Tools to verify.

---

## 3. Pre-Ship Checklist

Before declaring Outworked Windows ready for production/beta distribution:

- [ ] Run all P0 smoke tests from `WINDOWS_SMOKE_TESTS.md` on a real Windows 10/11 machine
- [ ] Run `npm run electron:build` and install the produced NSIS installer on a clean Windows VM
- [ ] Verify icon renders correctly in taskbar, Start Menu, and file explorer
- [ ] Verify SmartScreen warning appears but is dismissible (expected without code signing)
- [ ] Verify no `claude.exe` zombie processes after session kill
- [ ] Verify `%USERPROFILE%\.outworked\outworked.db` is created on first run
- [ ] Verify onboarding shows Slack-only channels copy (no iMessage)
- [ ] Review `WINDOWS_KNOWN_ISSUES.md` and confirm all items are understood and accepted

---

## 4. Dependency Prerequisites for Windows Developers

Documented here for onboarding new Windows contributors:

```
1. Node.js 20 LTS (https://nodejs.org)
2. Git for Windows (https://git-scm.com/download/win)
3. Visual Studio Build Tools 2022 — "Desktop development with C++" workload
   (required for better-sqlite3 native module compilation)
   Download: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
4. Claude CLI for Windows — install from https://claude.ai/code
5. npm install  (runs electron-rebuild automatically via postinstall)
6. npm run electron:dev
```
