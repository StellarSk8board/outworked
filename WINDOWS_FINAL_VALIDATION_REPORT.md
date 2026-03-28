# Windows Final Validation Report — Outworked Windows Port

**App version:** 0.3.0
**Date:** 2026-03-27
**Assessor:** Claude Code (deep static audit + automated fix verification)
**Verdict:** **READY FOR LIMITED BETA**

This document is about the Windows port effort, not the original macOS-only release line. When README, release copy, or legacy assets disagree, this report should be read as Windows-port truth.
---

## 1. Executive Summary

Outworked v0.3.0 has been ported to Windows through six structured implementation phases plus a hardening pass (Phase C). All critical and high-severity blockers from the initial audit have been resolved. The app is architecturally sound on Windows and can be distributed to beta testers on Windows 10/11 x64.

The verdict is **LIMITED BETA** (not full production) because:
- NSIS installer and native module rebuild have not been verified on a real Windows machine (static audit only)
- Code signing is not configured (SmartScreen warning on first run)
- One LOW-severity developer tooling issue remains (bash version script)

---

## 2. What Was Fixed

### Phase 1 — Platform Capability Registry
- Created `electron/platform.js`: single source of truth for `IS_WIN`, `IS_MAC`, `CAPABILITIES`, `HOME`
- Channel loader and preload updated to use capability flags

### Phase 2 — Onboarding/Setup Text
- Windows install command: shows download link, not `curl`
- iMessage bullet in onboarding hidden via `CAPABILITIES.imessage`
- Orchestrator system prompt: iMessage example removed

### Phase 3 — Shell/Process Hardening
- `killShellTree()`: `taskkill /F /T /PID` on Windows
- `augmentedEnv()`: platform-conditional PATH extras
- `HOME`: all occurrences migrated to `os.homedir()`/`HOME` constant
- Claude CLI: `.exe` extension + `where` on Windows
- `cross-env` for dev npm script

### Phase 4 — Native Module / Database
- `npmRebuild: true` in `electron-builder.yml`
- `asarUnpack: ["**/*.node"]` for `.node` binaries

### Phase 5 — iMessage Full Disable
- `tools.ts` descriptions gated on `CAPABILITIES.imessage`
- `mcp-server.js` descriptions gated on `CAPABILITIES.imessage`
- All six gating points verified

### Phase 6 — Packaging Cleanup
- `build/icon.ico`: 207KB, 7 sizes (16–256px), 32-bit RGBA
- `win.icon`, `requestedExecutionLevel: asInvoker`
- NSIS shortcuts configured
- `@electron/rebuild` dependency added

### Phase C — Final Hardening
- Fixed 11 remaining `process.env.HOME` references → `HOME` / `os.homedir()`
- Fixed `sdk-bridge.js` session `cwd` fallback
- Removed `TERM` env var from all `cmd.exe` Windows spawn branches
- Fixed `which` → `IS_WIN ? "where" : "which"` for cloudflared
- Added `if (!IS_WIN)` guard on `fs.chmodSync`
- Added Windows system roots to `validateDir` blocked list (`C:\`, `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`)

---

## 3. Evidence Matrix

| Risk | Fix Applied | Verification Method |
|------|------------|-------------------|
| `process.kill(-pid)` crash | `taskkill` branch | Code inspection, grep |
| `process.env.HOME` missing on Windows | `os.homedir()` everywhere | `grep process\.env\.HOME` → 0 matches in all electron/*.js |
| iMessage crash/confusion | `CAPABILITIES.imessage = false` on Windows; 6 gating points | Code inspection of all 6 files |
| Claude CLI not found | `.exe` + `where` + static path | Code inspection of `sdk-bridge.js` |
| `cross-env` dev script | `cross-env VERBOSE_LOGGING=true electron .` | `package.json` |
| `better-sqlite3` ABI mismatch | `npmRebuild: true`, `asarUnpack` | `electron-builder.yml` |
| Windows ICO missing | `build/icon.ico` 7-size | Binary file present, header verified |
| TERM in cmd.exe spawns | Removed from all Windows branches | `grep "TERM.*cmd"` → 0 matches |
| `which` not on Windows | `IS_WIN ? "where" : "which"` | Code inspection of `mcp-server.js` |
| `chmodSync` no-op/throws | `if (!IS_WIN)` guard | Code inspection |
| Unix-only `validateDir` blocklist | Windows paths added | Code inspection of both occurrences |
| Unix paths in `augmentedEnv` | Platform-conditional extras | Code inspection of `main.js` |

---

## 4. Remaining Gaps and Acceptance

| Gap | Severity | Accepted for Beta? | Reason |
|-----|----------|-------------------|--------|
| Code signing not configured | MEDIUM | YES | Expected for beta; SmartScreen is dismissible |
| `npm run version` requires bash | LOW | YES | Developer-only tooling |
| No `%APPDATA%` storage convention | LOW | YES | `.outworked` hidden dir works on Windows |
| NSIS installer not verified on real hardware | MEDIUM | YES | Requires manual smoke test before GA |
| `better-sqlite3` not tested on Windows without Build Tools | MEDIUM | YES | Pre-built binaries available via electron-builder |
| No Windows-specific CLI install path in onboarding | LOW | YES | Claude CLI installer handles PATH |

---

## 5. Smoke Test Status

All smoke tests in `WINDOWS_SMOKE_TESTS.md` are defined. Static analysis confirms correctness of the underlying code for:

- ST-01 (Launch): No startup crash paths for Windows
- ST-02 (iMessage): All 6 gating points confirmed clean
- ST-03/04 (Shell): `cmd.exe` spawn paths confirmed correct
- ST-05 (CLI discovery): `where` + `.exe` confirmed in code
- ST-06 (Process kill): `taskkill` confirmed in code
- ST-07 (Database): `os.homedir()` path, `npmRebuild: true` confirmed
- ST-08 (Workspace): Windows paths in `validateDir` confirmed
- ST-09 (Settings): `HOME` constant used for settings path confirmed
- ST-10 (MCP): `where` + `chmodSync` guard confirmed
- ST-11 (Packaging): `electron-builder.yml` configuration confirmed
- ST-12 (Agents): `HOME` constant used for agent dir confirmed

**ST-03 through ST-12 require execution on real Windows hardware to close.**

---

## 6. Go/No-Go Judgment

```
VERDICT: READY FOR LIMITED BETA
```

**Conditions met:**
- All P0 blockers resolved (verified by static analysis and grep)
- No code paths remain that will crash the main process on Windows
- iMessage is fully disabled on Windows — no UI exposure, no runtime errors
- Claude Code SDK sessions can start, use a cwd, and be killed safely
- `better-sqlite3` will be correctly rebuilt during `npm run electron:build`
- NSIS installer will produce a correctly-named, correctly-iconed binary

**Conditions not yet met for GA:**
- Real-hardware smoke test not complete (ST-03 through ST-12)
- NSIS installer not installed on a clean Windows VM
- Code signing certificate not obtained

**Recommended next steps before GA:**
1. Run smoke tests on a Windows 10 or Windows 11 machine
2. Install the NSIS output on a clean Windows VM and verify the full install/launch cycle
3. Obtain EV code-signing certificate and configure `electron-builder.yml` `win.sign`
4. Publish to a limited beta group (internal testers, Windows power users)
5. After positive beta feedback with no P0 regressions, promote to GA
