# Windows Known Issues — Outworked

**App version:** 0.3.0
**Last updated:** 2026-03-27

Known issues on Windows that have been evaluated but not fixed in the current MVP. All items below are non-blocking for the MVP unless marked otherwise.

---

## KI-01 — `bash scripts/bump-version.sh` fails natively

**Severity:** LOW (developer convenience only)
**Affects:** `npm run version`
**Workaround:** Run from Git Bash: `bash scripts/bump-version.sh`. Does not affect end users.

---

## KI-02 — `fs.constants.X_OK` does not check executability on Windows

**Severity:** LOW (post-MVP)
**Affects:** `getShellCmd()` in `electron/main.js` and `getClaudeExecutablePath()` in `electron/sdk-bridge.js`
**Detail:** On Windows, `fs.constants.X_OK === fs.constants.F_OK` — both check existence, not executable permission. The current code uses `X_OK` for existence checks, which works correctly. True executability checking would require spawning the binary with `--version` and catching errors.
**Impact:** None in practice — the binaries returned (cmd.exe, claude.exe) are always executable on Windows.

---

## KI-03 — `TERM` env var still passed to Unix `SHELL_CMD` branches

**Severity:** INFO (not an issue)
**Detail:** All `TERM` removal in Phase C was applied only to `cmd.exe` Windows branches. Unix branches (`SHELL_CMD, ["-l", ...]`) still pass `TERM: "xterm-256color"` or `TERM: "dumb"` as intended. This is correct behaviour and is not an issue.

---

## KI-04 — Windows Code Signing not configured

**Severity:** MEDIUM (Windows SmartScreen warning on first run)
**Affects:** `npm run electron:build`
**Detail:** `electron-builder.yml` has no `win.certificateFile` or `win.signingHashAlgorithms` configured. Packaged `.exe` and NSIS installer will be unsigned. Windows SmartScreen will show a "Windows protected your PC" warning on first run.
**Workaround:** User clicks "More info" → "Run anyway". For production distribution, obtain an EV code-signing certificate and add `win.sign` config to `electron-builder.yml`.

---

## KI-05 — `cloudflared` `.tgz` path untested on Windows

**Severity:** LOW
**Affects:** `electron/mcp/mcp-server.js` cloudflared download
**Detail:** The `.tgz` download path (macOS) calls `execFileSync("tar", [...])`. Windows 10 1803+ ships `tar.exe`, so this would work, but the `.tgz` path is only taken on macOS/Linux — Windows gets a direct binary download. No action needed unless cloudflared changes its Windows distribution format.

---

## KI-06 — App data in `~/.outworked` instead of `%APPDATA%`

**Severity:** LOW (UX deviation)
**Detail:** The app stores data in `%USERPROFILE%\.outworked\outworked.db` rather than the Windows-conventional `%APPDATA%\Outworked`. Both locations work. The `.outworked` hidden directory is invisible in Windows Explorer by default.
**Impact:** None for functionality. Power users may find it non-standard.

---

## KI-07 — `VERBOSE_LOGGING=true` not set in packaged production build

**Severity:** INFO
**Detail:** `electron:dev` uses `cross-env VERBOSE_LOGGING=true electron .` for verbose logs. The production build (`electron:build`) does not set this. This is intentional — verbose logging is for development only.

---

## KI-08 — No Windows-specific onboarding for Claude CLI install path

**Severity:** LOW
**Affects:** Onboarding step 2 (Claude Code installation check)
**Detail:** The onboarding modal now shows `Download from claude.ai/code` on Windows instead of the `curl` command, which is correct. However, it does not explicitly state the expected install path (`%USERPROFILE%\.claude\bin\claude.exe`) or verify that the PATH is set correctly post-install.
**Mitigation:** Claude Code for Windows installer handles PATH setup automatically.

---

## KI-09 — `augmentedEnv` does not add Windows Claude AppData path

**Severity:** LOW
**Affects:** `electron/main.js` `augmentedEnv()`
**Detail:** The PATH augmentation adds `%USERPROFILE%\.claude\bin` on Windows, which covers the standard Claude CLI install location. It does not add `%LOCALAPPDATA%\Programs\claude\bin`. If the user installed Claude CLI to AppData\Local, the PATH may not include it.
**Mitigation:** `sdk-bridge.js` `getClaudeExecutablePath()` only checks `~/.claude/bin/claude.exe` as a static path candidate and falls back to `where claude` which will find any PATH location. Main process shell commands rely on the augmented PATH.

---

## Resolved Issues (for reference)

All items from `WINDOWS_BLOCKERS.md` are resolved as of Phase 6:

| Blocker | Resolution |
|---------|-----------|
| BLOCKER-01: iMessage on Windows | Platform-gated across all 6 locations |
| BLOCKER-02: `process.kill(-pid)` crash | `taskkill /F /T /PID` on Windows |
| BLOCKER-03: `better-sqlite3` rebuild | `npmRebuild: true`, `asarUnpack: ["**/*.node"]` |
| BLOCKER-04: Claude CLI discovery | `where` + `.exe` extension on Windows |
| BLOCKER-05: Dev script env-var syntax | `cross-env` |
| BLOCKER-06: `HOME` in sdk-bridge.js | `os.homedir()` throughout |
| BLOCKER-07: Windows `.ico` icon | 207KB multi-res ICO, 7 sizes |
| BLOCKER-08: `augmentedEnv` Unix paths | Platform-conditional PATH extras |
| BLOCKER-09: bash version script | Post-MVP (KI-01 above) |
| BLOCKER-10: `X_OK` on Windows | Non-blocking (KI-02 above) |
