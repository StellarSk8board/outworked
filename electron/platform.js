// ─── Platform capability registry ────────────────────────────────
// Single source of truth for platform detection and feature flags.
// Import this module instead of scattering process.platform checks
// throughout the codebase.
//
// Usage:
//   const { IS_WIN, CAPABILITIES, HOME } = require("./platform");
//   if (CAPABILITIES.imessage) { ... }

const os = require("os");

const PLATFORM = process.platform;
const IS_WIN   = PLATFORM === "win32";
const IS_MAC   = PLATFORM === "darwin";
const IS_LINUX = PLATFORM === "linux";

/**
 * Feature flags — true means the capability is available on this platform.
 *
 * Add new flags here as platform-specific subsystems are audited.
 * Never check process.platform directly; use these instead.
 */
const CAPABILITIES = {
  /**
   * iMessage integration.
   * Requires: ~/Library/Messages/chat.db, osascript, sqlite3 CLI.
   * macOS only.
   */
  imessage: IS_MAC,

  /**
   * Unix process-group kill via process.kill(-pid, signal).
   * Used by killShellTree() to terminate child process trees.
   * Windows requires taskkill instead.
   */
  unixProcessGroup: !IS_WIN,

  /**
   * Login-shell spawning (bash/zsh -l -c "cmd").
   * Windows uses cmd.exe with shell:true instead.
   */
  loginShell: !IS_WIN,

  /**
   * macOS notarization and hardened-runtime entitlements pipeline.
   * Only relevant during packaging on macOS.
   */
  macNotarization: IS_MAC,
};

/**
 * Cross-platform home directory.
 * Always use this instead of process.env.HOME, which is not set on Windows.
 * Equivalent to os.homedir() but exported for consistent import.
 */
const HOME = os.homedir();

module.exports = { PLATFORM, IS_WIN, IS_MAC, IS_LINUX, CAPABILITIES, HOME };
