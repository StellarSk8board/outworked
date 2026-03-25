#!/usr/bin/env node
// ─── Migration system smoke tests ──────────────────────────────
// Run: node electron/db/test-migrations.js

const Database = require("better-sqlite3");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function tableExists(db, name) {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
}

function columnExists(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function getSchemaVersion(db) {
  return (
    db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v || 0
  );
}

// We need to load ensureSchema without it auto-connecting to the real DB.
// The module caches a singleton, so we re-require a fresh copy each time
// by clearing the require cache and patching internals. Instead, we just
// inline the two functions we need: ensureSchema reads from MIGRATIONS.

// Pull the module source to get MIGRATIONS + ensureSchema
const mod = require("./database.js");

// Helper: build a fresh in-memory db and run ensureSchema on it
function freshDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// We can't call ensureSchema directly since it's not exported, so we
// re-implement the call path: extract it from the module source.
// Simpler approach: just load the raw file and eval the two pieces we need.
const fs = require("fs");
const src = fs.readFileSync(path.join(__dirname, "database.js"), "utf8");

// Extract MIGRATIONS array and ensureSchema function via a mini module
const sandbox = new Function(
  "require",
  "console",
  `
  ${src.match(/const MIGRATIONS = \[[\s\S]*?\n\];/)[0]}
  ${src.match(/function ensureSchema\(db\) \{[\s\S]*?\n\}/)[0]}
  return { MIGRATIONS, ensureSchema };
`,
);
const { MIGRATIONS, ensureSchema } = sandbox(require, console);

// ─── Test 1: Fresh database ─────────────────────────────────────
console.log("\n1. Fresh database — all migrations applied");
{
  const db = freshDb();
  ensureSchema(db);

  assert(tableExists(db, "schema_migrations"), "schema_migrations table exists");
  assert(tableExists(db, "memory_entries"), "memory_entries table exists");
  assert(tableExists(db, "scheduled_tasks"), "scheduled_tasks table exists");
  assert(tableExists(db, "task_run_logs"), "task_run_logs table exists");
  assert(tableExists(db, "channel_configs"), "channel_configs table exists");
  assert(tableExists(db, "channel_messages"), "channel_messages table exists");
  assert(tableExists(db, "triggers"), "triggers table exists");
  assert(tableExists(db, "skill_auth"), "skill_auth table exists");
  assert(tableExists(db, "app_settings"), "app_settings table exists");
  assert(tableExists(db, "cost_records"), "cost_records table exists");
  assert(tableExists(db, "cost_cumulative"), "cost_cumulative table exists");
  assert(tableExists(db, "cost_budgets"), "cost_budgets table exists");

  const version = getSchemaVersion(db);
  assert(version === MIGRATIONS.length, `schema version is ${version} (expected ${MIGRATIONS.length})`);

  db.close();
}

// ─── Test 2: Pre-existing database (no migration table) ────────
console.log("\n2. Pre-existing database — seeds version 1, skips re-run");
{
  const db = freshDb();
  // Simulate a database created before the migration system
  db.exec(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE memory_entries (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, key TEXT NOT NULL,
      value TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(scope, key)
    );
  `);
  // Insert some data to prove it survives
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run(
    "theme",
    "dark",
  );

  ensureSchema(db);

  assert(tableExists(db, "schema_migrations"), "schema_migrations created");
  const version = getSchemaVersion(db);
  assert(version >= 1, `schema version is ${version} (>= 1)`);

  // Data survived
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get("theme");
  assert(row && row.value === "dark", "existing data preserved");

  db.close();
}

// ─── Test 3: Already up-to-date — idempotent ───────────────────
console.log("\n3. Already up-to-date — no-op on second run");
{
  const db = freshDb();
  ensureSchema(db);
  const vBefore = getSchemaVersion(db);
  const countBefore = db
    .prepare("SELECT COUNT(*) AS cnt FROM schema_migrations")
    .get().cnt;

  // Run again
  ensureSchema(db);
  const vAfter = getSchemaVersion(db);
  const countAfter = db
    .prepare("SELECT COUNT(*) AS cnt FROM schema_migrations")
    .get().cnt;

  assert(vBefore === vAfter, `version unchanged (${vAfter})`);
  assert(countBefore === countAfter, `migration count unchanged (${countAfter})`);

  db.close();
}

// ─── Test 4: Incremental migration ─────────────────────────────
console.log("\n4. Incremental migration — version 2 adds a column");
{
  const db = freshDb();
  ensureSchema(db);
  assert(!columnExists(db, "cost_records", "model"), "model column does not exist yet");

  // Simulate adding migration 2
  MIGRATIONS.push({
    version: 2,
    description: "Add model column to cost_records",
    up: `ALTER TABLE cost_records ADD COLUMN model TEXT;`,
  });

  ensureSchema(db);
  assert(columnExists(db, "cost_records", "model"), "model column added by migration 2");
  assert(getSchemaVersion(db) === 2, "schema version is 2");

  // Clean up so other tests aren't affected
  MIGRATIONS.pop();

  db.close();
}

// ─── Summary ────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
