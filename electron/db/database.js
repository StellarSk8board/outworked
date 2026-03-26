// ─── SQLite Database Module ──────────────────────────────────────
// Central persistence layer using better-sqlite3.
// All tables are created lazily on first access via ensureSchema().

const path = require("path");
const os = require("os");
const fs = require("fs");
const verbose = process.env.VERBOSE_LOGGING === "true";

const DB_DIR = path.join(os.homedir(), ".outworked");
const DB_PATH = path.join(DB_DIR, "outworked.db");

let _db = null;

/**
 * Get or create the singleton database connection.
 */
function getDb() {
  if (_db) return _db;

  // Ensure directory exists
  fs.mkdirSync(DB_DIR, { recursive: true, mode: 0o755 });

  let Database;
  try {
    Database = require("better-sqlite3");
  } catch (err) {
    console.error(
      "[database] Failed to load better-sqlite3. Run: npx electron-rebuild -f -w better-sqlite3",
    );
    console.error("[database]", err.message);
    throw err;
  }
  _db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  ensureSchema(_db);
  return _db;
}

/**
 * Ordered list of schema migrations.
 * Each entry has a `version` (monotonically increasing integer) and an `up`
 * SQL string that moves the schema from (version - 1) → version.
 *
 * Rules for adding migrations:
 *  1. Always append to the end — never reorder or modify existing entries.
 *  2. Use IF NOT EXISTS / IF EXISTS guards so migrations are safe to re-run
 *     against databases that were partially migrated.
 *  3. Wrap destructive changes (column drops, renames) in a transaction with a
 *     backup step when possible.
 */
const MIGRATIONS = [
  {
    version: 1,
    description: "Initial schema",
    up: `
      -- Agent memory (key-value with scoping)
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(scope, key)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_entries(scope);

      -- Scheduled tasks
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('one-time', 'interval', 'cron')),
        schedule TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER NOT NULL,
        run_count INTEGER NOT NULL DEFAULT 0,
        max_runs INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Task execution logs
      CREATE TABLE IF NOT EXISTS task_run_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        duration_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'running',
        result TEXT,
        error TEXT,
        FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_task_run_logs_task_id ON task_run_logs(task_id);

      -- Channel configurations
      CREATE TABLE IF NOT EXISTS channel_configs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'disconnected',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Channel messages (inbound + outbound)
      CREATE TABLE IF NOT EXISTS channel_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
        conversation_id TEXT,
        sender TEXT,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (channel_id) REFERENCES channel_configs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_channel_msg_ts ON channel_messages(channel_id, timestamp);

      -- Trigger definitions
      CREATE TABLE IF NOT EXISTS triggers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        type TEXT NOT NULL,
        pattern TEXT,
        channel_id TEXT,
        sender_allowlist TEXT DEFAULT '[]',
        agent_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_triggered_at INTEGER,
        trigger_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_triggers_agent_id ON triggers(agent_id);

      -- Skill integration auth state
      CREATE TABLE IF NOT EXISTS skill_auth (
        skill_runtime TEXT PRIMARY KEY,
        credentials TEXT,
        config TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'disconnected',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Generic app settings (key-value store, replaces localStorage)
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Cost records (migrated from localStorage)
      CREATE TABLE IF NOT EXISTS cost_records (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        session_id TEXT,
        timestamp INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cost_agent ON cost_records(agent_id);
      CREATE INDEX IF NOT EXISTS idx_cost_ts ON cost_records(timestamp);

      -- Cost cumulative state (for delta tracking)
      CREATE TABLE IF NOT EXISTS cost_cumulative (
        session_key TEXT PRIMARY KEY,
        cost REAL NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0
      );

      -- Cost budgets
      CREATE TABLE IF NOT EXISTS cost_budgets (
        agent_id TEXT PRIMARY KEY,
        daily_limit_usd REAL,
        total_limit_usd REAL
      );
    `,
  },
  // ── Add new migrations here ───────────────────────────────────
  {
    version: 2,
    description: "Custom skills table",
    up: `
      CREATE TABLE IF NOT EXISTS custom_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        emoji TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

/**
 * Run pending migrations in order.
 *
 * On a brand-new database the migrations table won't exist yet, so we create
 * it first.  For databases that pre-date the migration system (they already
 * have tables but no schema_migrations table) we detect that by checking for
 * the existence of any application table and seed schema_migrations with
 * version 1 so that migration 1 (the initial schema) is skipped — its
 * CREATE IF NOT EXISTS statements are idempotent anyway, but skipping avoids
 * unnecessary work.
 */
function ensureSchema(db) {
  // 1. Bootstrap the migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT,
      applied_at INTEGER NOT NULL
    );
  `);

  // 2. Detect pre-migration databases: if app tables exist but no migration
  //    records, seed version 1 so we don't re-run the initial schema.
  const hasRecords = db
    .prepare("SELECT COUNT(*) AS cnt FROM schema_migrations")
    .get().cnt;

  if (hasRecords === 0) {
    const preExisting = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'",
      )
      .get();
    if (preExisting) {
      // Existing database created before the migration system — mark the
      // initial schema as already applied.
      db.prepare(
        "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
      ).run(1, "Initial schema (pre-existing)", Date.now());
      verbose &&
        console.log(
          "[database] Detected pre-migration database — seeded schema_migrations at version 1",
        );
    }
  }

  // 3. Determine current version
  const currentVersion =
    db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v || 0;

  // 4. Apply pending migrations in a transaction per migration
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    verbose &&
      console.log(
        `[database] Applying migration ${migration.version}: ${migration.description}`,
      );
    db.transaction(() => {
      db.exec(migration.up);
      db.prepare(
        "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.description, Date.now());
    })();
    verbose &&
      console.log(
        `[database] Migration ${migration.version} applied successfully`,
      );
  }
}

// ─── Memory operations ──────────────────────────────────────────

function memorySet(scope, key, value) {
  const db = getDb();
  const now = Date.now();
  const id = `${scope}:${key}`;
  db.prepare(
    `
    INSERT INTO memory_entries (id, scope, key, value, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  ).run(id, scope, key, value, now, now);
  return { id, scope, key, value };
}

function memoryGet(scope, key) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM memory_entries WHERE scope = ? AND key = ?")
    .get(scope, key);
}

function memorySearch(scope, query, { limit = 200, offset = 0 } = {}) {
  const db = getDb();
  if (query) {
    // Escape LIKE wildcards so user input is matched literally
    const escaped = query.replace(/[%_\\]/g, "\\$&");
    return db
      .prepare(
        "SELECT * FROM memory_entries WHERE scope = ? AND (key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT ? OFFSET ?",
      )
      .all(scope, `%${escaped}%`, `%${escaped}%`, limit, offset);
  }
  return db
    .prepare(
      "SELECT * FROM memory_entries WHERE scope = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
    )
    .all(scope, limit, offset);
}

function memoryList(scope, { limit = 200, offset = 0 } = {}) {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM memory_entries WHERE scope = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
    )
    .all(scope, limit, offset);
}

function memoryDelete(scope, key) {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM memory_entries WHERE scope = ? AND key = ?")
    .run(scope, key);
  return result.changes > 0;
}

// ─── Cost record operations ─────────────────────────────────────

function costAddRecord(record) {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO cost_records (id, agent_id, agent_name, session_id, timestamp, cost_usd, input_tokens, output_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    record.id,
    record.agentId,
    record.agentName,
    record.sessionId || null,
    record.timestamp,
    record.costUsd,
    record.inputTokens,
    record.outputTokens,
  );
}

function costGetAll() {
  const db = getDb();
  return db
    .prepare("SELECT * FROM cost_records ORDER BY timestamp DESC")
    .all()
    .map(rowToCostRecord);
}

function costGetByAgent(agentId) {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM cost_records WHERE agent_id = ? ORDER BY timestamp DESC",
    )
    .all(agentId)
    .map(rowToCostRecord);
}

function costGetSince(sinceMs) {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM cost_records WHERE timestamp >= ? ORDER BY timestamp DESC",
    )
    .all(sinceMs)
    .map(rowToCostRecord);
}

function costClear() {
  const db = getDb();
  db.prepare("DELETE FROM cost_records").run();
}

function costGetCumulative(sessionKey) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM cost_cumulative WHERE session_key = ?")
    .get(sessionKey);
}

function costSetCumulative(sessionKey, cost, inputTokens, outputTokens) {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO cost_cumulative (session_key, cost, input_tokens, output_tokens)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET cost = excluded.cost, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens
  `,
  ).run(sessionKey, cost, inputTokens, outputTokens);
}

function costDeleteCumulative(sessionKey) {
  const db = getDb();
  db.prepare("DELETE FROM cost_cumulative WHERE session_key = ?").run(
    sessionKey,
  );
}

function costGetBudgets() {
  const db = getDb();
  return db.prepare("SELECT * FROM cost_budgets").all().map(rowToBudget);
}

function costSetBudget(agentId, dailyLimitUsd, totalLimitUsd) {
  const db = getDb();
  if (dailyLimitUsd == null && totalLimitUsd == null) {
    db.prepare("DELETE FROM cost_budgets WHERE agent_id = ?").run(agentId);
  } else {
    db.prepare(
      `
      INSERT INTO cost_budgets (agent_id, daily_limit_usd, total_limit_usd)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET daily_limit_usd = excluded.daily_limit_usd, total_limit_usd = excluded.total_limit_usd
    `,
    ).run(agentId, dailyLimitUsd || null, totalLimitUsd || null);
  }
}

/**
 * Atomically compute the delta from cumulative totals, update the cumulative
 * state, and insert a cost record — all in one transaction.
 * Returns the new CostRecord or null if the delta was zero.
 */
function costRecordDelta(
  sessionKey,
  record,
  cumulativeCost,
  cumulativeInputTokens,
  cumulativeOutputTokens,
) {
  const db = getDb();
  return db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM cost_cumulative WHERE session_key = ?")
      .get(sessionKey);
    const prevCost = row?.cost ?? 0;
    const prevInput = row?.input_tokens ?? 0;
    const prevOutput = row?.output_tokens ?? 0;

    const deltaCost = Math.max(0, cumulativeCost - prevCost);
    const deltaInput = Math.max(0, cumulativeInputTokens - prevInput);
    const deltaOutput = Math.max(0, cumulativeOutputTokens - prevOutput);

    // Update cumulative state
    db.prepare(
      `
      INSERT INTO cost_cumulative (session_key, cost, input_tokens, output_tokens)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET cost = excluded.cost, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens
    `,
    ).run(
      sessionKey,
      cumulativeCost,
      cumulativeInputTokens,
      cumulativeOutputTokens,
    );

    if (deltaCost <= 0 && deltaInput <= 0 && deltaOutput <= 0) return null;

    // Insert the delta as a cost record
    const costRecord = {
      id: record.id,
      agentId: record.agentId,
      agentName: record.agentName,
      sessionId: record.sessionId || null,
      timestamp: record.timestamp,
      costUsd: deltaCost,
      inputTokens: deltaInput,
      outputTokens: deltaOutput,
    };
    db.prepare(
      `
      INSERT INTO cost_records (id, agent_id, agent_name, session_id, timestamp, cost_usd, input_tokens, output_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      costRecord.id,
      costRecord.agentId,
      costRecord.agentName,
      costRecord.sessionId,
      costRecord.timestamp,
      costRecord.costUsd,
      costRecord.inputTokens,
      costRecord.outputTokens,
    );

    return costRecord;
  })();
}

// ─── App settings operations ─────────────────────────────────────

function settingGet(key) {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key);
  return row ? row.value : null;
}

function settingSet(key, value) {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run(key, value);
}

function settingDelete(key) {
  const db = getDb();
  db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
}

function settingList() {
  const db = getDb();
  return db.prepare("SELECT key, value FROM app_settings ORDER BY key").all();
}

// ─── Row mappers ────────────────────────────────────────────────

function rowToCostRecord(row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    costUsd: row.cost_usd,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
  };
}

function rowToBudget(row) {
  return {
    agentId: row.agent_id,
    dailyLimitUsd: row.daily_limit_usd,
    totalLimitUsd: row.total_limit_usd,
  };
}

// ─── Scheduled task operations ──────────────────────────────────

function schedulerCreate(task) {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, name, type, schedule, agent_id, prompt, enabled, next_run_at, max_runs, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.name,
    task.type,
    task.schedule,
    task.agentId,
    task.prompt,
    task.enabled ? 1 : 0,
    task.nextRunAt,
    task.maxRuns || null,
    task.createdAt,
    task.updatedAt || task.createdAt,
  );
}

function schedulerList() {
  const db = getDb();
  return db
    .prepare("SELECT * FROM scheduled_tasks ORDER BY created_at DESC")
    .all()
    .map(rowToScheduledTask);
}

function schedulerGet(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id);
  return row ? rowToScheduledTask(row) : null;
}

function schedulerUpdate(id, updates) {
  const db = getDb();
  const fields = [];
  const values = [];
  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.schedule !== undefined) {
    fields.push("schedule = ?");
    values.push(updates.schedule);
  }
  if (updates.prompt !== undefined) {
    fields.push("prompt = ?");
    values.push(updates.prompt);
  }
  if (updates.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }
  if (updates.lastRunAt !== undefined) {
    fields.push("last_run_at = ?");
    values.push(updates.lastRunAt);
  }
  if (updates.nextRunAt !== undefined) {
    fields.push("next_run_at = ?");
    values.push(updates.nextRunAt);
  }
  if (updates.runCount !== undefined) {
    fields.push("run_count = ?");
    values.push(updates.runCount);
  }
  fields.push("updated_at = ?");
  values.push(Date.now());
  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(", ")} WHERE id = ?`,
  ).run(...values);
}

function schedulerDelete(id) {
  const db = getDb();
  db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
}

function schedulerGetDue(now) {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run_at <= ?",
    )
    .all(now)
    .map(rowToScheduledTask);
}

/**
 * Atomically claim all due tasks in a single transaction: read them, insert
 * run-log entries, and advance their state so they won't be picked up again.
 *
 * @param {number} now          - Current timestamp in ms.
 * @param {function} calcNextRun - (task) => number — computes next run timestamp.
 * @returns {Array<{task: object, logId: number, updates: object}>}
 */
function schedulerClaimDueTasks(now, calcNextRun) {
  const db = getDb();
  return db.transaction(() => {
    const rows = db
      .prepare(
        "SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run_at <= ?",
      )
      .all(now);

    const claimed = [];
    for (const row of rows) {
      const task = rowToScheduledTask(row);
      const nextRunAt = calcNextRun(task);
      const newRunCount = task.runCount + 1;
      const exhausted =
        task.type === "one-time" ||
        (task.maxRuns != null && newRunCount >= task.maxRuns);

      const updates = {
        lastRunAt: now,
        runCount: newRunCount,
        nextRunAt: exhausted ? 0 : nextRunAt,
        enabled: exhausted ? false : task.enabled,
      };

      // Insert run log
      const logId = db
        .prepare(
          `INSERT INTO task_run_logs (task_id, agent_id, started_at, status)
           VALUES (?, ?, ?, 'running')`,
        )
        .run(task.id, task.agentId, now).lastInsertRowid;

      // Update task state
      db.prepare(
        `UPDATE scheduled_tasks
         SET last_run_at = ?, run_count = ?, next_run_at = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        updates.lastRunAt,
        updates.runCount,
        updates.nextRunAt,
        updates.enabled ? 1 : 0,
        Date.now(),
        task.id,
      );

      claimed.push({ task, logId, updates });
    }
    return claimed;
  })();
}

function schedulerLogRun(log) {
  const db = getDb();
  return db
    .prepare(
      `
    INSERT INTO task_run_logs (task_id, agent_id, started_at, status)
    VALUES (?, ?, ?, 'running')
  `,
    )
    .run(log.taskId, log.agentId, log.startedAt).lastInsertRowid;
}

function schedulerCompleteRun(logId, status, result, error) {
  const db = getDb();
  db.transaction(() => {
    const now = Date.now();
    const row = db
      .prepare("SELECT started_at FROM task_run_logs WHERE id = ?")
      .get(logId);
    const duration = row ? now - row.started_at : 0;
    db.prepare(
      `
      UPDATE task_run_logs SET completed_at = ?, duration_ms = ?, status = ?, result = ?, error = ?
      WHERE id = ?
    `,
    ).run(now, duration, status, result || null, error || null, logId);
  })();
}

function schedulerFireTask(taskId, agentId, startedAt, updates) {
  const db = getDb();
  return db.transaction(() => {
    const logId = db
      .prepare(
        `
        INSERT INTO task_run_logs (task_id, agent_id, started_at, status)
        VALUES (?, ?, ?, 'running')
      `,
      )
      .run(taskId, agentId, startedAt).lastInsertRowid;

    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      const col = key.replace(/([A-Z])/g, "_$1").toLowerCase();
      fields.push(`${col} = ?`);
      values.push(typeof val === "boolean" ? (val ? 1 : 0) : val);
    }
    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(taskId);
    db.prepare(
      `UPDATE scheduled_tasks SET ${fields.join(", ")} WHERE id = ?`,
    ).run(...values);

    return logId;
  })();
}

function schedulerGetHistory(taskId, limit = 20) {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?",
    )
    .all(taskId, limit);
}

function rowToScheduledTask(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    schedule: row.schedule,
    agentId: row.agent_id,
    prompt: row.prompt,
    enabled: !!row.enabled,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    runCount: row.run_count,
    maxRuns: row.max_runs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Trigger operations ─────────────────────────────────────────

function triggerCreate(trigger) {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO triggers (id, name, enabled, type, pattern, channel_id, sender_allowlist, agent_id, prompt, created_at, trigger_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `,
  ).run(
    trigger.id,
    trigger.name,
    trigger.enabled ? 1 : 0,
    trigger.type,
    trigger.pattern || null,
    trigger.channelId || null,
    JSON.stringify(trigger.senderAllowlist || []),
    trigger.agentId,
    trigger.prompt,
    trigger.createdAt || Date.now(),
  );
}

function triggerGet(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM triggers WHERE id = ?").get(id);
  return row ? rowToTrigger(row) : null;
}

function triggerList() {
  const db = getDb();
  return db
    .prepare("SELECT * FROM triggers ORDER BY created_at DESC")
    .all()
    .map(rowToTrigger);
}

const TRIGGER_COLUMN_MAP = {
  name: "name",
  enabled: "enabled",
  type: "type",
  pattern: "pattern",
  channelId: "channel_id",
  senderAllowlist: "sender_allowlist",
  agentId: "agent_id",
  prompt: "prompt",
};

function triggerUpdate(id, updates) {
  const db = getDb();
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    const col = TRIGGER_COLUMN_MAP[k];
    if (!col) continue;
    if (col === "sender_allowlist") {
      fields.push(`${col} = ?`);
      values.push(JSON.stringify(v));
    } else if (col === "enabled") {
      fields.push(`${col} = ?`);
      values.push(v ? 1 : 0);
    } else {
      fields.push(`${col} = ?`);
      values.push(v);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE triggers SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
}

function triggerDelete(id) {
  const db = getDb();
  db.prepare("DELETE FROM triggers WHERE id = ?").run(id);
}

function triggerIncrementCount(id) {
  const db = getDb();
  db.prepare(
    "UPDATE triggers SET trigger_count = trigger_count + 1, last_triggered_at = ? WHERE id = ?",
  ).run(Date.now(), id);
}

function rowToTrigger(row) {
  return {
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    type: row.type,
    pattern: row.pattern,
    channelId: row.channel_id,
    senderAllowlist: JSON.parse(row.sender_allowlist || "[]"),
    agentId: row.agent_id,
    prompt: row.prompt,
    createdAt: row.created_at,
    lastTriggeredAt: row.last_triggered_at,
    triggerCount: row.trigger_count,
  };
}

// ─── Channel config operations ──────────────────────────────────

function channelConfigSave(config) {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO channel_configs (id, type, name, config, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, config = excluded.config, status = excluded.status, updated_at = excluded.updated_at
  `,
  ).run(
    config.id,
    config.type,
    config.name,
    JSON.stringify(config.config || {}),
    config.status || "disconnected",
    now,
    now,
  );
}

function channelConfigList() {
  const db = getDb();
  return db
    .prepare("SELECT * FROM channel_configs ORDER BY created_at DESC")
    .all()
    .map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      config: JSON.parse(row.config || "{}"),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

function channelConfigDelete(id) {
  const db = getDb();
  db.prepare("DELETE FROM channel_configs WHERE id = ?").run(id);
}

// ─── Channel message operations ─────────────────────────────────

function channelMessageSave(msg) {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO channel_messages (channel_id, direction, conversation_id, sender, content, metadata, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    msg.channelId,
    msg.direction,
    msg.conversationId || null,
    msg.sender || null,
    msg.content,
    JSON.stringify(msg.metadata || {}),
    msg.timestamp || Date.now(),
  );
}

function channelMessageList(channelId, limit = 50) {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM channel_messages WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?",
    )
    .all(channelId, limit);
}

// ─── Skill auth operations ──────────────────────────────────────

function skillAuthGet(runtime) {
  const db = getDb();
  return db
    .prepare("SELECT * FROM skill_auth WHERE skill_runtime = ?")
    .get(runtime);
}

function skillAuthSave(runtime, credentials, config, status) {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO skill_auth (skill_runtime, credentials, config, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(skill_runtime) DO UPDATE SET credentials = excluded.credentials, config = excluded.config, status = excluded.status, updated_at = excluded.updated_at
  `,
  ).run(runtime, credentials, JSON.stringify(config || {}), status, now, now);
}

function skillAuthDelete(runtime) {
  const db = getDb();
  db.prepare("DELETE FROM skill_auth WHERE skill_runtime = ?").run(runtime);
}

// ─── Custom skill operations ─────────────────────────────────────

function customSkillCreate(skill) {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO custom_skills (id, name, description, content, emoji, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    skill.id,
    skill.name,
    skill.description || "",
    skill.content || "",
    skill.emoji || null,
    now,
    now,
  );
  return { ...skill, createdAt: now, updatedAt: now };
}

function customSkillList() {
  const db = getDb();
  return db
    .prepare("SELECT * FROM custom_skills ORDER BY created_at DESC")
    .all()
    .map(rowToCustomSkill);
}

function customSkillGet(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM custom_skills WHERE id = ?").get(id);
  return row ? rowToCustomSkill(row) : null;
}

function customSkillUpdate(id, updates) {
  const db = getDb();
  const fields = [];
  const values = [];
  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    values.push(updates.description);
  }
  if (updates.content !== undefined) {
    fields.push("content = ?");
    values.push(updates.content);
  }
  if (updates.emoji !== undefined) {
    fields.push("emoji = ?");
    values.push(updates.emoji || null);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = ?");
  values.push(Date.now());
  values.push(id);
  db.prepare(`UPDATE custom_skills SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values,
  );
}

function customSkillDelete(id) {
  const db = getDb();
  db.prepare("DELETE FROM custom_skills WHERE id = ?").run(id);
}

function rowToCustomSkill(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    emoji: row.emoji,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Lifecycle ──────────────────────────────────────────────────

function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = {
  getDb,
  close,

  // App settings
  settingGet,
  settingSet,
  settingDelete,
  settingList,

  // Memory
  memorySet,
  memoryGet,
  memorySearch,
  memoryList,
  memoryDelete,

  // Cost records
  costAddRecord,
  costGetAll,
  costGetByAgent,
  costGetSince,
  costClear,
  costGetCumulative,
  costSetCumulative,
  costDeleteCumulative,
  costGetBudgets,
  costSetBudget,
  costRecordDelta,

  // Scheduler
  schedulerCreate,
  schedulerList,
  schedulerGet,
  schedulerUpdate,
  schedulerDelete,
  schedulerGetDue,
  schedulerClaimDueTasks,
  schedulerLogRun,
  schedulerCompleteRun,
  schedulerFireTask,
  schedulerGetHistory,

  // Triggers
  triggerCreate,
  triggerGet,
  triggerList,
  triggerUpdate,
  triggerDelete,
  triggerIncrementCount,

  // Channel configs
  channelConfigSave,
  channelConfigList,
  channelConfigDelete,

  // Channel messages
  channelMessageSave,
  channelMessageList,

  // Skill auth
  skillAuthGet,
  skillAuthSave,
  skillAuthDelete,

  // Custom skills
  customSkillCreate,
  customSkillList,
  customSkillGet,
  customSkillUpdate,
  customSkillDelete,
};
