// ─── BaseRuntime ────────────────────────────────────────────────
// Base class for all skill runtimes.
// Subclasses register tools via registerTool() and optionally
// override lifecycle hooks (init, destroy, healthCheck, beforeExecute).

class BaseRuntime {
  /**
   * @param {string} name - Matches the 'runtime' field in SKILL.md frontmatter.
   */
  constructor(name) {
    this.name = name;
    this.status = 'disconnected'; // 'disconnected' | 'connected' | 'error' | 'expired'
    this.eventHandler = null;
    this._tools = new Map(); // name -> { schema, handler, timeout }
  }

  // ── Tool Registration ──────────────────────────────────────────

  /**
   * Register a tool on this runtime.
   * @param {string} name - Tool name (e.g. 'gmail:search')
   * @param {{ name: string, description: string, parameters: object }} schema
   * @param {(params: object) => Promise<unknown>} handler
   * @param {{ timeout?: number }} [opts]
   */
  registerTool(name, schema, handler, opts = {}) {
    this._tools.set(name, {
      schema,
      handler: handler.bind(this),
      timeout: opts.timeout || null,
    });
  }

  /**
   * Return tool definitions for this runtime.
   * @returns {Array<{ name: string, description: string, parameters: object }>}
   */
  getTools() {
    return Array.from(this._tools.values()).map((t) => ({
      name: t.schema.name,
      description: t.schema.description,
      parameters: t.schema.parameters,
    }));
  }

  /**
   * Get the configured timeout for a specific tool (or null for default).
   * @param {string} toolName
   * @returns {number | null}
   */
  getToolTimeout(toolName) {
    return this._tools.get(toolName)?.timeout || null;
  }

  /**
   * Execute a named tool with parameters.
   * Validates params and calls beforeExecute() before dispatching.
   * @param {string} toolName
   * @param {object} params
   * @returns {Promise<unknown>}
   */
  async executeTool(toolName, params) {
    const tool = this._tools.get(toolName);
    if (!tool) {
      throw new Error(`${this.name}: unknown tool '${toolName}'`);
    }
    _validateParams(toolName, tool.schema.parameters, params);
    await this.beforeExecute(toolName, params);
    return tool.handler(params);
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /**
   * Called once after construction, before auth restore.
   * Override for async setup (resource allocation, etc.).
   */
  async init() {}

  /**
   * Called on app quit or runtime removal.
   * Override to clean up resources (stop polling, close connections, etc.).
   */
  async destroy() {
    await this.disconnect();
  }

  /**
   * Returns the health status of this runtime.
   * Override for deeper checks (e.g. test API connectivity).
   * @returns {Promise<{ healthy: boolean, details?: string }>}
   */
  async healthCheck() {
    return { healthy: this.status === 'connected' };
  }

  /**
   * Hook that runs before every tool execution.
   * Override to do pre-flight checks (e.g. token refresh).
   * @param {string} _toolName
   * @param {object} _params
   */
  async beforeExecute(_toolName, _params) {}

  // ── Auth ──────────────────────────────────────────────────────

  /**
   * Describe the auth requirements for this runtime.
   * @returns {{ type: string, provider?: string, scopes?: string[] } | null}
   */
  getAuthConfig() {
    return null;
  }

  /**
   * Perform authentication with the given credentials.
   * @param {object} credentials
   * @param {{ silent?: boolean }} [opts]
   * @returns {Promise<void>}
   */
  async authenticate(credentials, opts) {
    throw new Error(`${this.name}: authenticate() not implemented`);
  }

  /**
   * Refresh an expired access token using the stored refresh token.
   * @returns {Promise<void>}
   */
  async refreshAuth() {}

  /**
   * Disconnect and clear auth state.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.status = 'disconnected';
  }

  // ── Triggers / Events ────────────────────────────────────────

  /**
   * Return the event type strings this runtime can emit.
   * @returns {string[]}
   */
  getTriggerTypes() {
    return [];
  }

  /**
   * Register a handler to receive events from this runtime.
   * @param {(eventType: string, data: object) => void} handler
   */
  onEvent(handler) {
    this.eventHandler = handler;
  }

  /**
   * Emit an event to the registered handler.
   * @param {string} eventType
   * @param {object} data
   */
  _emit(eventType, data) {
    if (this.eventHandler) {
      try {
        this.eventHandler(eventType, data);
      } catch (err) {
        console.error(`[${this.name}] eventHandler threw for '${eventType}':`, err.message);
      }
    }
  }
}

// ── Parameter Validation ──────────────────────────────────────────
// Simple JSON Schema validator covering the subset used by skill tools:
// required fields and type checks for string, number, boolean, array, object.

const TYPE_CHECKERS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

function _validateParams(toolName, schema, params) {
  if (!schema || schema.type !== 'object') return;

  // Check required fields
  if (schema.required && schema.required.length > 0) {
    for (const field of schema.required) {
      if (params[field] === undefined || params[field] === null) {
        throw new ValidationError(`Tool '${toolName}': missing required parameter '${field}'`);
      }
    }
  }

  // Check types for provided fields
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (params[key] === undefined || params[key] === null) continue;
      const checker = TYPE_CHECKERS[propSchema.type];
      if (checker && !checker(params[key])) {
        throw new ValidationError(
          `Tool '${toolName}': parameter '${key}' expected type '${propSchema.type}', got '${typeof params[key]}'`
        );
      }
    }
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION';
  }
}

module.exports = BaseRuntime;
module.exports.ValidationError = ValidationError;
