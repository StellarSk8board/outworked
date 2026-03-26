// ─── Channel Manager ─────────────────────────────────────────────
// Main-process singleton that owns channel lifecycle, routes outbound
// messages, persists all traffic to SQLite, and bridges inbound events
// to the renderer via IPC.

const db = require("../db/database");
const verbose = process.env.VERBOSE_LOGGING === "true";

/** @type {Map<string, import('./base-channel')>} id → channel instance */
const _registry = new Map();

/** @type {Electron.WebContents | null} */
let _mainWindowContents = null;

/** @type {(() => void) | null} */
let _onStatusChange = null;

/**
 * Track recently sent outbound messages so we can ignore them if they
 * echo back as "inbound" (e.g. iMessage DB race conditions).
 * Key: "channelId:conversationId:contentHash", Value: expiry timestamp
 * @type {Map<string, number>}
 */
const _recentOutbound = new Map();
const OUTBOUND_ECHO_WINDOW_MS = 30_000; // 30 seconds

// ─── Registry management ──────────────────────────────────────

/**
 * Register a channel instance with the manager.
 * Does NOT automatically connect it — call connectChannel() separately.
 *
 * @param {import('./base-channel')} channel
 */
function registerChannel(channel) {
  if (_registry.has(channel.id)) {
    console.warn(
      `[ChannelManager] Channel '${channel.id}' is already registered; replacing.`,
    );
  }

  // Wire up inbound message handling before we register.
  channel.onMessage((msg) => _handleInbound(channel.id, msg));

  _registry.set(channel.id, channel);
}

/**
 * Return all registered channel instances as an array.
 *
 * @returns {import('./base-channel')[]}
 */
function getChannels() {
  return Array.from(_registry.values());
}

// ─── Lifecycle ────────────────────────────────────────────────

/**
 * Connect a registered channel by ID.
 * Updates the channel_configs row in SQLite to reflect the new status.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
async function connectChannel(id) {
  const channel = _getOrThrow(id);

  try {
    await channel.connect();
    _persistStatus(channel);
    _onStatusChange?.();
    verbose &&
      console.log(
        `[ChannelManager] Connected channel '${id}' (${channel.type})`,
      );
  } catch (err) {
    channel.status = "error";
    channel.errorMessage = err.message;
    _persistStatus(channel);
    _onStatusChange?.();
    console.error(
      `[ChannelManager] Failed to connect channel '${id}': ${err.message}`,
    );
    throw err;
  }
}

/**
 * Disconnect a registered channel by ID.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
async function disconnectChannel(id) {
  const channel = _getOrThrow(id);
  await channel.disconnect();
  _persistStatus(channel);
  _onStatusChange?.();
  verbose && console.log(`[ChannelManager] Disconnected channel '${id}'`);
}

// ─── Outbound messaging ───────────────────────────────────────

/**
 * Send a message via the specified channel and persist it as an outbound
 * record in channel_messages.
 *
 * @param {string} channelId
 * @param {string} conversationId
 * @param {string} content
 * @returns {Promise<void>}
 */
async function sendMessage(channelId, conversationId, content) {
  const channel = _getOrThrow(channelId);

  if (channel.status !== "connected") {
    throw new Error(
      `Channel '${channelId}' is not connected (status: ${channel.status})`,
    );
  }

  await channel.sendMessage(conversationId, content);

  // Track this outbound so we can detect echo-back in inbound polling
  const echoKey = `${channelId}:${conversationId}:${_hashContent(content)}`;
  _recentOutbound.set(echoKey, Date.now() + OUTBOUND_ECHO_WINDOW_MS);

  // Persist the outbound record.
  db.channelMessageSave({
    channelId,
    direction: "outbound",
    conversationId,
    sender: null,
    content,
    metadata: {},
    timestamp: Date.now(),
  });
}

// ─── IPC bridge ───────────────────────────────────────────────

/**
 * Register all channel-manager IPC handlers and store a reference to the
 * main window's webContents for push notifications.
 *
 * Call this from main.js after the main window has been created.
 *
 * Exposes:
 *   channel:register    — create + register a channel from a saved ChannelConfig
 *   channel:connect     — connect by id
 *   channel:disconnect  — disconnect by id
 *   channel:send        — send an outbound message
 *   channel:list        — return all registered channel summaries
 *   channel:loadAll     — load all saved configs from DB and register them
 *
 * @param {Electron.IpcMain}     ipcMain
 * @param {Electron.BrowserWindow} mainWindow
 */
function setupChannelIPC(ipcMain, mainWindow) {
  _mainWindowContents = mainWindow.webContents;

  const { ImessageChannel, SlackChannel } = require("./index");

  // ── channel:register ──────────────────────────────────────────
  // Create a channel instance from a ChannelConfig object and register it.
  ipcMain.handle("channel:register", (_event, config) => {
    const channel = _buildChannel(config, { ImessageChannel, SlackChannel });
    registerChannel(channel);
    // Persist to DB so it survives restarts.
    db.channelConfigSave({
      id: config.id,
      type: config.type,
      name: config.name,
      config: config.config || {},
      status: "disconnected",
    });
    return { ok: true };
  });

  // ── channel:connect ───────────────────────────────────────────
  ipcMain.handle("channel:connect", async (_event, id) => {
    try {
      await connectChannel(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── channel:disconnect ────────────────────────────────────────
  ipcMain.handle("channel:disconnect", async (_event, id) => {
    try {
      await disconnectChannel(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── channel:send ──────────────────────────────────────────────
  ipcMain.handle(
    "channel:send",
    async (_event, channelId, conversationId, content) => {
      try {
        await sendMessage(channelId, conversationId, content);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  );

  // ── channel:list ──────────────────────────────────────────────
  ipcMain.handle("channel:list", () => {
    return getChannels().map((ch) => ({
      id: ch.id,
      type: ch.type,
      name: ch.name,
      status: ch.status,
      errorMessage: ch.errorMessage || null,
    }));
  });

  // ── channel:loadAll ───────────────────────────────────────────
  // Load all persisted ChannelConfig rows and register (but don't connect)
  // the corresponding channel instances.  Useful on app startup.
  ipcMain.handle("channel:loadAll", () => {
    const configs = db.channelConfigList();
    for (const config of configs) {
      if (!_registry.has(config.id)) {
        try {
          const channel = _buildChannel(config, {
            ImessageChannel,
            SlackChannel,
          });
          registerChannel(channel);
        } catch (err) {
          console.error(
            `[ChannelManager] Could not build channel '${config.id}': ${err.message}`,
          );
        }
      }
    }
    return { ok: true, count: configs.length };
  });
}

// ─── Private helpers ──────────────────────────────────────────

/**
 * Handle an inbound message from any channel:
 *   1. Persist it to channel_messages.
 *   2. Push it to the renderer over the 'channel:inbound' IPC event.
 *
 * @param {string} channelId
 * @param {object} msg
 */
function _handleInbound(channelId, msg) {
  const full = {
    channelId,
    direction: "inbound",
    conversationId: msg.conversationId || null,
    sender: msg.sender || null,
    content: msg.content,
    metadata: msg.metadata || {},
    timestamp: msg.timestamp || Date.now(),
  };

  // ── Echo detection: skip messages that match a recent outbound ──
  _pruneExpiredOutbound();
  const echoKey = `${channelId}:${full.conversationId || ""}:${_hashContent(full.content)}`;
  if (_recentOutbound.has(echoKey)) {
    verbose && console.log(`[ChannelManager] Skipping echo-back: ${echoKey}`);
    _recentOutbound.delete(echoKey);
    return;
  }

  // ── Sender allowlist: drop messages from unknown senders ──
  const channel = _registry.get(channelId);
  const allowedSenders = channel?.config?.allowedSenders;
  if (Array.isArray(allowedSenders) && allowedSenders.length > 0) {
    const hasWildcard = allowedSenders.includes("*");
    if (!hasWildcard && full.sender) {
      const senderNorm = full.sender.replace(/[\s\-()]/g, "");
      const isAllowed = allowedSenders.some((s) => {
        const norm = s.replace(/[\s\-()]/g, "");
        return (
          senderNorm === norm ||
          senderNorm.endsWith(norm) ||
          norm.endsWith(senderNorm)
        );
      });
      if (!isAllowed) {
        verbose &&
          console.log(
            `[ChannelManager] Blocked message from ${full.sender} — not in allowedSenders`,
          );
        return;
      }
    }
  }

  // Persist
  try {
    db.channelMessageSave(full);
  } catch (err) {
    console.error(
      `[ChannelManager] Failed to persist inbound message: ${err.message}`,
    );
  }

  // Push to renderer
  if (_mainWindowContents && !_mainWindowContents.isDestroyed()) {
    _mainWindowContents.send("channel:inbound", full);
  }

  // Evaluate against triggers — if no trigger matches, fire to boss as default
  try {
    const triggerEngine = require("../triggers/trigger-engine");
    const matched = triggerEngine.evaluateMessage(full);
    if (!matched && _mainWindowContents && !_mainWindowContents.isDestroyed()) {
      // No trigger matched — send a default trigger:fire to the boss
      _mainWindowContents.send("trigger:fire", {
        triggerId: "__default_channel_message",
        triggerName: "Channel Message (default)",
        agentId: null, // null signals "use the boss"
        prompt:
          `You received a message via ${_registry.get(channelId)?.type || "messaging channel"}.\n\n` +
          `From: ${full.sender || "unknown"}\n` +
          `Channel: ${channelId}\n` +
          `Conversation: ${full.conversationId || "unknown"}\n\n` +
          `Message:\n${full.content}\n\n` +
          `You can reply using the send_message tool with channelId="${channelId}" and conversationId="${full.conversationId || full.sender}".`,
        context: full,
      });
    }
  } catch (err) {
    console.error(`[ChannelManager] Trigger evaluation failed: ${err.message}`);
  }
}

/**
 * Persist the current status of a channel back to channel_configs.
 *
 * @param {import('./base-channel')} channel
 */
function _persistStatus(channel) {
  try {
    db.channelConfigSave({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      config: channel.config || {},
      status: channel.status,
    });
  } catch (err) {
    console.error(
      `[ChannelManager] Failed to persist status for '${channel.id}': ${err.message}`,
    );
  }
}

/**
 * Retrieve a registered channel or throw a descriptive error.
 *
 * @param {string} id
 * @returns {import('./base-channel')}
 */
function _getOrThrow(id) {
  const channel = _registry.get(id);
  if (!channel) {
    throw new Error(
      `Channel '${id}' is not registered. Call registerChannel() or channel:loadAll first.`,
    );
  }
  return channel;
}

/**
 * Instantiate the correct BaseChannel subclass for a given ChannelConfig.
 *
 * @param {object} config
 * @param {{ ImessageChannel: Function, SlackChannel: Function }} classes
 * @returns {import('./base-channel')}
 */
function _buildChannel(config, { ImessageChannel, SlackChannel }) {
  switch (config.type) {
    case "imessage":
      return new ImessageChannel(config.id, config.name, config.config || {});
    case "slack":
      return new SlackChannel(config.id, config.name, config.config || {});
    default:
      throw new Error(`Unknown channel type: '${config.type}'`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/** Simple string hash for echo detection (not cryptographic). */
function _hashContent(text) {
  let hash = 0;
  const str = (text || "").slice(0, 200); // only hash first 200 chars
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** Remove expired entries from the outbound echo tracker. */
function _pruneExpiredOutbound() {
  const now = Date.now();
  for (const [key, expiry] of _recentOutbound) {
    if (now > expiry) _recentOutbound.delete(key);
  }
}

// ─── Exports ──────────────────────────────────────────────────

/**
 * Set a callback invoked whenever a channel's connection status changes.
 * @param {() => void} fn
 */
function setOnStatusChange(fn) {
  _onStatusChange = fn;
}

module.exports = {
  registerChannel,
  connectChannel,
  disconnectChannel,
  sendMessage,
  getChannels,
  setupChannelIPC,
  setOnStatusChange,
};
