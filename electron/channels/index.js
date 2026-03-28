// ─── Channels barrel export ───────────────────────────────────────
// Auto-discovers all *-channel.js files in this directory (excluding
// base-channel.js) and exports them keyed by their metadata type.
// Platform-specific channels (e.g. iMessage) are skipped on platforms
// that do not support them — see electron/platform.js for capability flags.

const fs = require("fs");
const path = require("path");
const { CAPABILITIES } = require("../platform");

// Map each channel filename to the capability it requires.
// If the capability is false on this platform, the file is not loaded.
const CHANNEL_CAPABILITIES = {
  "imessage-channel.js": CAPABILITIES.imessage,
};

/** @type {Map<string, typeof import('./base-channel')>} type → ChannelClass */
const channelClasses = new Map();

const dir = __dirname;
const files = fs.readdirSync(dir);

for (const file of files) {
  if (
    !file.endsWith("-channel.js") ||
    file === "base-channel.js"
  ) {
    continue;
  }

  // Skip channels whose required platform capability is unavailable.
  if (file in CHANNEL_CAPABILITIES && !CHANNEL_CAPABILITIES[file]) {
    console.log(`[Channels] Skipping ${file} (not supported on ${process.platform})`);
    continue;
  }

  try {
    const ChannelClass = require(path.join(dir, file));
    if (ChannelClass?.metadata?.type) {
      channelClasses.set(ChannelClass.metadata.type, ChannelClass);
    }
  } catch (err) {
    console.error(`[Channels] Failed to load ${file}: ${err.message}`);
  }
}

/**
 * Get all discovered channel classes keyed by type.
 * @returns {Map<string, typeof import('./base-channel')>}
 */
function getChannelClasses() {
  return channelClasses;
}

/**
 * Get metadata for all available channel types.
 * @returns {Array<object>}
 */
function getAvailableTypes() {
  return Array.from(channelClasses.values()).map((C) => C.metadata);
}

module.exports = { getChannelClasses, getAvailableTypes };
