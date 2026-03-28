# Windows MVP Plan — Outworked

**Date:** 2026-03-27
**Goal:** A working, installable Windows build of Outworked that covers all core functionality except iMessage.

---

## Windows MVP Scope

### Must Work

| Capability | Status today | Notes |
|-----------|-------------|-------|
| App launch on Windows | 🟡 Needs fix | `process.kill(-pid)` crash; env-var script syntax |
| Dev build (`npm run electron:dev`) | 🟠 Broken | Unix env-var syntax; `cross-env` needed |
| Electron main/preload/renderer boot | 🟡 Needs fix | `better-sqlite3` must be rebuilt |
| Onboarding flow (without iMessage) | 🟠 Needs fix | UI copy and channel list must exclude iMessage |
| Claude CLI detection/setup guidance | 🟠 Needs fix | Unix paths + `which` fallback; needs Windows equivalents |
| Shell/terminal execution on Windows | 🟡 Needs fix | `process.kill(-pid)` crash; otherwise mostly works |
| Local database/storage | 🟡 Needs rebuild | `better-sqlite3` native module for Windows ABI |
| Git-related functionality | ✅ Works | Standard git/gh CLI calls |
| Slack channel | ✅ Works | HTTP/WebSocket, fully portable |
| Skills (browser, Gmail, Drive, etc.) | ✅ Works | All HTTP-based |
| MCP server + cloudflared tunnel | 🟡 Needs test | Win32 binary path handled; needs runtime validation |
| Trigger engine + webhooks | ✅ Works | Platform-neutral |
| File watching | ✅ Works | `fs.watch` recursive works on Windows |
| Auto-updater | 🟡 Needs test | NSIS updater; needs runtime validation |
| Windows NSIS packaging | 🟡 Needs fix | Missing `.ico`; `npmRebuild` must be enabled |

### Must NOT Be Included

| Capability | Reason |
|-----------|--------|
| iMessage channel | Requires macOS-only APIs: `~/Library/Messages`, `osascript`, `sqlite3` CLI |
| macOS code signing / notarization | macOS-specific |
| Homebrew cask update | macOS/Linux only |

---

## iMessage Disable Plan

iMessage is present in six locations. Each must be handled to avoid confusion or runtime errors on Windows:

### 1. Channel registration — `electron/channels/index.js`

**Current behavior:** Registers iMessage channel regardless of platform.

**Fix:** Wrap registration in a platform guard:
```js
// In the channels index (index.js)
if (process.platform === "darwin") {
  const ImessageChannel = require("./imessage-channel");
  channelManager.registerChannelClass(ImessageChannel);
}
```
Do not delete `imessage-channel.js`.

### 2. Channel manager availability — `electron/channels/channel-manager.js`

The `channel-manager.js` already handles channel types dynamically. The platform gate in step 1 is sufficient — the iMessage type will simply never be available on Windows.

### 3. Onboarding modal — `src/components/OnboardingModal.tsx`

**Lines 345, 352:** Text mentions "iMessage and Slack" as example channels.

**Fix:** Make the text conditional. Expose `window.electronAPI.platform` (already exposed via preload.js line ~30) and adjust:
```tsx
// Replace "like iMessage and Slack" with:
const platform = window.electronAPI?.platform;
const channelExamples = platform === "win32" ? "like Slack" : "like iMessage and Slack";
```

### 4. Tool descriptions — `src/lib/tools.ts`

**Lines 322, 334, 522:** `send_message` description and `list_channels` fallback text reference iMessage.

**Fix:** These are runtime strings passed to Claude as tool descriptions. Replace "iMessage, Slack" with "Slack" in these strings when running on Windows, or simply drop the iMessage example unconditionally (it is just an example in a description string, not functional logic):
- Line 322: `'Send a message through a connected messaging channel (Slack, etc).'`
- Line 334: `'Recipient identifier — Slack channel ID, or "CHANNEL_ID:THREAD_TS" for threaded Slack replies'`
- Line 522: `"No messaging channels configured. Ask the user to set up a channel (Slack) in the Channels panel."`

These strings can be made platform-conditional in a single helper or edited directly for simplicity.

### 5. System prompt — `src/lib/orchestrator.ts`

**Line 127:** Mentions iMessage as an example of a channel to share tunnel URLs through.

**Fix:** Remove "iMessage or" from the string, or make it conditional. Simplest: remove iMessage from this example entirely since Slack is a better default for the orchestrator prompt.

### 6. iMessage runtime file — `electron/channels/imessage-channel.js`

**Do not delete this file.** It is the macOS implementation. With the platform gate in step 1, it will not be loaded on Windows.

---

## Implementation Phases

### Phase 2 — Critical Fixes (makes the app launch and be usable on Windows)

**Goal:** App starts, dev workflow functions, no crashes.

| Task | File(s) | Blocker ref |
|------|---------|------------|
| Add `cross-env` devDependency; fix `electron:dev` script | `package.json` | BLOCKER-05 |
| Fix `killShellTree()` to use `taskkill` on Windows | `electron/main.js:244–254` | BLOCKER-02 |
| Fix `HOME` → `os.homedir()` in sdk-bridge.js | `electron/sdk-bridge.js:26` | BLOCKER-06 |
| Fix Claude CLI discovery for Windows (paths + `where`) | `electron/sdk-bridge.js:23–55` | BLOCKER-04 |
| Fix `augmentedEnv()` to add Windows Claude paths | `electron/main.js:223–234` | BLOCKER-08 |

**Test:** `npm install && npm run electron:dev` works on a Windows machine. App window opens, database initializes, no crash on shell kill.

### Phase 3 — iMessage Disable

**Goal:** iMessage never appears or attempts to load on Windows.

| Task | File(s) | Blocker ref |
|------|---------|------------|
| Platform-gate iMessage channel registration | `electron/channels/index.js` | BLOCKER-01 |
| Remove iMessage from onboarding copy on Windows | `src/components/OnboardingModal.tsx` | BLOCKER-01 |
| Remove iMessage from tool descriptions on Windows | `src/lib/tools.ts` | BLOCKER-01 |
| Remove iMessage from orchestrator system prompt | `src/lib/orchestrator.ts` | BLOCKER-01 |

**Test:** Run app on Windows. Channels panel shows only Slack. Onboarding copy does not mention iMessage. Claude tools do not describe iMessage.

### Phase 4 — Native Module & Packaging

**Goal:** The app can be packaged and installed on Windows.

| Task | File(s) | Blocker ref |
|------|---------|------------|
| Set `npmRebuild: true` in electron-builder.yml | `electron-builder.yml` | BLOCKER-03 |
| Generate and add `build/icon.ico` | `build/icon.ico` (new) | BLOCKER-07 |
| Add `win: icon: build/icon.ico` to electron-builder.yml | `electron-builder.yml` | BLOCKER-07 |
| Test `npm run electron:build` produces a working NSIS installer | — | BLOCKER-03 |

**Test:** NSIS installer runs on Windows, app installs and launches, SQLite database initializes, Claude CLI is found.

### Phase 5 — Windows Runtime Validation

**Goal:** All in-scope features work end-to-end on Windows.

| Test scenario | Expected result |
|---------------|----------------|
| Onboarding flow | Completes without iMessage prompts |
| Claude CLI detection | Found at `%USERPROFILE%\.claude\bin\claude.exe` |
| Shell spawn (cmd.exe) | Interactive terminal works |
| Shell exec (one-shot commands) | Git, npm, node commands execute |
| Shell kill | `taskkill` terminates child process tree |
| Git status/diff/commit | Work via Git for Windows |
| `gh pr create` | Works if `gh` CLI is on PATH |
| File watcher | Fires on file changes in workspace |
| SQLite database | Persists settings, memory, costs across restarts |
| Slack channel | Connects and receives/sends messages |
| Skills (browser) | Chromium skill opens and navigates |
| MCP server | Starts on localhost:7823 |
| cloudflared tunnel | Downloads `.exe`, establishes tunnel |
| Auto-update | Checks GitHub releases, prompts for update |

---

## Developer Setup Requirements (Windows)

Document these in the README for Windows contributors:

1. **Node.js 20+** (LTS, x64)
2. **Git for Windows** (includes `bash`, `git`, Unix tools)
3. **GitHub CLI (`gh`)** — for PR creation feature
4. **Visual Studio Build Tools 2022** (or `windows-build-tools` npm package) — for `better-sqlite3` native compilation
5. **Claude CLI** installed at `%USERPROFILE%\.claude\bin\claude.exe`
6. `npm install` — runs `electron-rebuild` for `better-sqlite3`
7. `npm run electron:dev` — launches dev build

---

## Phase Sequence Summary

```
Phase 1 (DONE): Repository audit → these four documents
Phase 2:        Critical fixes — app launches without crashing
Phase 3:        iMessage disable — clean Windows-only UI
Phase 4:        Native module rebuild + packaging
Phase 5:        Windows runtime validation
Post-MVP:       Code signing, Windows PATH onboarding guide, bash script replacement
```

Each phase produces a small, reviewable set of changes. No phase touches more than 5 files. Each ends with a clear test that confirms the phase goal.

---

## Files Changed Per Phase (Projected)

| Phase | Files touched | Approx lines changed |
|-------|--------------|---------------------|
| Phase 2 | `package.json`, `electron/main.js`, `electron/sdk-bridge.js` | ~40 |
| Phase 3 | `electron/channels/index.js`, `OnboardingModal.tsx`, `tools.ts`, `orchestrator.ts` | ~20 |
| Phase 4 | `electron-builder.yml`, `build/icon.ico` (new) | ~5 |
| Phase 5 | (testing only, no code changes) | 0 |
