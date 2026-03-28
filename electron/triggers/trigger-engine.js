// ─── Trigger Engine ──────────────────────────────────────────────
// Main-process singleton that evaluates inbound events (channel messages,
// skill events, webhooks) against enabled triggers and fires matched ones
// by sending a 'trigger:fire' IPC event to the renderer.

const db = require('../db/database');

class TriggerEngine {
  constructor() {
    this.mainWindow = null;
    /** @type {Map<string, RegExp>} triggerId -> compiled RegExp */
    this._compiledPatterns = new Map();
  }

  /**
   * Attach the main BrowserWindow so trigger:fire events can be sent.
   * @param {Electron.BrowserWindow} mainWindow
   */
  setWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * (Re-)compile regex patterns for all enabled message-pattern triggers.
   * Call this after triggers are created, updated, or deleted.
   */
  refreshPatterns() {
    this._compiledPatterns.clear();
    const triggers = db.triggerList();
    for (const t of triggers) {
      if (t.pattern && t.enabled) {
        try {
          this._compiledPatterns.set(t.id, new RegExp(t.pattern, 'i'));
        } catch (err) {
          console.warn(
            `[TriggerEngine] Skipping trigger "${t.name}" (${t.id}): invalid regex pattern "${t.pattern}" — ${err.message}`,
          );
        }
      }
    }
  }

  /**
   * Evaluate a channel message against all enabled message-pattern triggers.
   * Fires the first matching trigger and returns true; returns false if none matched.
   *
   * @param {{ channelId: string, sender?: string, content: string }} message
   * @returns {boolean}
   */
  evaluateMessage(message) {
    const triggers = db.triggerList().filter(
      (t) => t.enabled && t.type === 'message-pattern',
    );

    for (const trigger of triggers) {
      // Channel filter — skip if the trigger is scoped to a different channel
      if (trigger.channelId && trigger.channelId !== message.channelId) continue;

      // Sender allowlist — '*' is a wildcard that permits any sender
      if (
        trigger.senderAllowlist?.length > 0 &&
        !trigger.senderAllowlist.includes('*') &&
        !trigger.senderAllowlist.includes(message.sender)
      ) {
        continue;
      }

      // Pattern match
      const regex = this._compiledPatterns.get(trigger.id);
      if (!regex) continue;

      const match = message.content.match(regex);
      if (match) {
        this.fireTrigger(trigger, message, match);
        return true; // first match wins
      }
    }

    return false;
  }

  /**
   * Evaluate a skill event against all enabled skill-event triggers.
   * Fires every matching trigger (multiple can listen to the same event type).
   *
   * @param {{ type: string, data: Record<string, unknown> }} event
   */
  evaluateSkillEvent(event) {
    const triggers = db.triggerList().filter(
      (t) => t.enabled && t.type === 'skill-event' && t.pattern === event.type,
    );

    for (const trigger of triggers) {
      this.fireTrigger(trigger, event.data, null);
    }
  }

  /**
   * Evaluate an inbound webhook request for a specific trigger ID.
   * Returns true if the trigger was found and fired, false otherwise.
   *
   * @param {string} triggerId
   * @param {Record<string, unknown>} body - Parsed JSON body from the request
   * @returns {boolean}
   */
  evaluateWebhook(triggerId, body) {
    const trigger = db.triggerGet(triggerId);
    if (!trigger || !trigger.enabled || trigger.type !== 'webhook') return false;
    this.fireTrigger(trigger, body, null);
    return true;
  }

  /**
   * Resolve the trigger's prompt template and send 'trigger:fire' to the renderer.
   *
   * Template substitution supports:
   *   - Regex capture groups: $1, $2, …  (when regexMatch is provided)
   *   - Named placeholders: {{key}}       (replaced with matching keys from context)
   *
   * @param {import('../../src/lib/types').Trigger} trigger
   * @param {Record<string, unknown> | null} context
   * @param {RegExpMatchArray | null} regexMatch
   */
  fireTrigger(trigger, context, regexMatch) {
    let prompt = trigger.prompt;

    // Substitute regex capture groups ($1, $2, …)
    if (regexMatch) {
      for (let i = 1; i < regexMatch.length; i++) {
        prompt = prompt.replace(
          new RegExp(`\\$${i}`, 'g'),
          regexMatch[i] ?? '',
        );
      }
    }

    // Substitute named placeholders ({{key}})
    if (context && typeof context === 'object') {
      for (const [key, val] of Object.entries(context)) {
        prompt = prompt.replace(
          new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
          String(val),
        );
      }
    }

    // Persist the fire event in the DB counter
    db.triggerIncrementCount(trigger.id);

    // Notify the renderer
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('trigger:fire', {
        triggerId: trigger.id,
        triggerName: trigger.name,
        agentId: trigger.agentId,
        prompt,
        context,
      });
    }
  }

  /**
   * Register IPC handlers that belong to the trigger engine.
   * Call this once from main.js during app initialisation.
   *
   * @param {Electron.IpcMain} ipcMain
   */
  setupTriggerIPC(ipcMain) {
    // Allow the renderer (or devtools) to test-fire a trigger by ID
    ipcMain.handle('trigger:test', (_event, triggerId) => {
      const trigger = db.triggerGet(triggerId);
      if (!trigger) return { ok: false, error: 'Trigger not found' };
      this.fireTrigger(trigger, { content: 'Test message', sender: 'test' }, null);
      return { ok: true };
    });
  }
}

module.exports = new TriggerEngine(); // singleton
