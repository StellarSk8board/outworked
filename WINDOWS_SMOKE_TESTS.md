# Windows Smoke Tests — Outworked

**App version:** 0.3.0
**Platform:** Windows 10 1909+ / Windows 11
**Last updated:** 2026-03-27

These are the minimum tests to run after any Windows build before declaring the build shippable. Execute in order. A failure at any P0 test is a ship-stopper.

---

## Pre-conditions

- Visual Studio Build Tools 2022 (or later) installed (required for `better-sqlite3` native rebuild)
- Node.js 20 LTS installed
- Git installed and on PATH
- Claude CLI installed at `%USERPROFILE%\.claude\bin\claude.exe`
- Logged in: `claude login` completed

---

## ST-01 — Install and Launch  (P0)

**Goal:** App starts without crashing.

1. `git clone <repo> outworked && cd outworked`
2. `npm install` — observe: `postinstall` runs `electron-rebuild`, should complete without errors. Accept WARN if Build Tools are absent (fallback message prints, not a crash).
3. `npm run electron:dev`
4. **Pass:** Main window opens, game canvas renders, no console errors mentioning "process.kill", "SIGTERM", "HOME", "imessage", or "which".

---

## ST-02 — iMessage Hidden  (P0)

**Goal:** iMessage channel does not appear anywhere in the Windows UI.

1. Launch app.
2. Open onboarding (if not already shown) or open Settings/Channels.
3. **Pass:** No "iMessage" label, bullet, or option visible in onboarding or channels panel.
4. Open DevTools → Console. **Pass:** No error mentioning `imessage-channel.js`, `osascript`, or `chat.db`.

---

## ST-03 — Shell Spawn  (P0)

**Goal:** Integrated terminal opens and accepts input.

1. Click "New Terminal" or equivalent in the app.
2. Type `echo hello` and press Enter.
3. **Pass:** Output `hello` appears. No crash. No "SIGTERM" or "process.kill" error in main process log.

---

## ST-04 — Shell Execute (P0)

**Goal:** `shell:exec` IPC works — agent can run a command and get output.

1. Start a Claude Code session with prompt: `Run the command: echo windows-test`.
2. **Pass:** Agent output includes `windows-test`. Session completes without error.

---

## ST-05 — Claude CLI Discovery  (P0)

**Goal:** App finds `claude.exe` on Windows.

1. Open DevTools → Network or check main-process log for `[sdk-bridge]`.
2. Trigger onboarding step 2 (auth check) or start a Claude Code session.
3. **Pass:** No "claude executable not found" error. Version check returns a version string.

---

## ST-06 — Process Kill (P0)

**Goal:** Killing a running session does not crash the main process.

1. Start a Claude Code session with a long-running prompt (e.g., `Count to 1000 slowly`).
2. While it is running, click "Stop" or close the session.
3. **Pass:** Session stops cleanly. Main process stays alive. No uncaught exception in log.
4. **Verify:** `tasklist | findstr claude` shows no zombie `claude.exe` processes.

---

## ST-07 — Database Persistence  (P1)

**Goal:** SQLite database is created and persists sessions.

1. Complete one Claude Code session.
2. Close and reopen the app.
3. **Pass:** Session history is visible. No "better-sqlite3" native module error in log.

---

## ST-08 — Workspace Set/Get  (P1)

**Goal:** `fs:setWorkspace` / `fs:getWorkspace` work on Windows paths.

1. In app, pick a workspace folder (e.g., `C:\Users\<you>\Documents\test-project`).
2. **Pass:** Workspace is set. No "validateDir" exception. App does not crash.
3. Try to set workspace to `C:\Windows`. **Pass:** App rejects it with an error.

---

## ST-09 — Claude Settings Read/Write  (P1)

**Goal:** `~/.claude/settings.json` is read and written correctly on Windows.

1. Open app settings → Claude permissions.
2. Toggle any permission on/off and save.
3. **Pass:** `%USERPROFILE%\.claude\settings.json` contains the updated value. No error.

---

## ST-10 — MCP Server Start  (P1)

**Goal:** MCP HTTP server starts on port 7823.

1. Launch app.
2. From DevTools console: `await window.electronAPI.claudeCode.start("list all mcp tools", null, null, 30000)`.
3. **Pass:** No "EADDRINUSE" or "failed to start MCP server" error. Port 7823 is listening (`netstat -ano | findstr 7823`).

---

## ST-11 — Packaging (P1)

**Goal:** `npm run electron:build` produces a working NSIS installer.

1. `npm run electron:build`
2. **Pass:** `dist/Outworked Setup 0.3.0.exe` is created with no errors.
3. Run the installer. **Pass:** App installs, shortcut appears on Desktop and in Start Menu, icon is correct (multi-res ICO, not blank/default).
4. Launch from shortcut. **Pass:** App starts correctly.

---

## ST-12 — Agent Files  (P1)

**Goal:** Agent `.md` files in `%USERPROFILE%\.claude\agents\` are discovered.

1. Create `%USERPROFILE%\.claude\agents\test-agent.md` with content `# Test Agent\nA test.`
2. In app, open the agents panel.
3. **Pass:** `test-agent` appears in the list.

---

## Pass/Fail Summary Table

| Test | Priority | Status |
|------|----------|--------|
| ST-01 Install and Launch | P0 | |
| ST-02 iMessage Hidden | P0 | |
| ST-03 Shell Spawn | P0 | |
| ST-04 Shell Execute | P0 | |
| ST-05 Claude CLI Discovery | P0 | |
| ST-06 Process Kill | P0 | |
| ST-07 Database Persistence | P1 | |
| ST-08 Workspace Set/Get | P1 | |
| ST-09 Claude Settings R/W | P1 | |
| ST-10 MCP Server Start | P1 | |
| ST-11 Packaging | P1 | |
| ST-12 Agent Files | P1 | |
