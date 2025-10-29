#!/usr/bin/env node

import Database from 'better-sqlite3'
import { existsSync, copyFileSync } from 'fs'

const originalDb = `${process.env.HOME}/.cc-gw/data/gateway.db`
const testDb = `${process.env.HOME}/.cc-gw/data/gateway-test.db`

// Backup original
if (existsSync(originalDb)) {
  console.log('📦 Backing up original database...')
  copyFileSync(originalDb, `${originalDb}.backup`)
}

// Create test database with old schema (no total_cached_tokens, no endpoint column, single PK)
console.log('🔧 Creating test database with old schema (pre-0.4.x)...')
const db = new Database(testDb)

// Create all necessary tables with old schema
db.exec(`
  -- Old daily_metrics schema (no endpoint, no total_cached_tokens, single PK)
  DROP TABLE IF EXISTS daily_metrics;
  CREATE TABLE daily_metrics (
    date TEXT PRIMARY KEY,
    request_count INTEGER DEFAULT 0,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_latency_ms INTEGER DEFAULT 0
  );

  INSERT INTO daily_metrics VALUES
    ('2025-10-27', 80, 40000, 1500, 120000),
    ('2025-10-28', 100, 50000, 2000, 150000),
    ('2025-10-29', 150, 75000, 3000, 200000);

  -- Create other required tables
  DROP TABLE IF EXISTS request_logs;
  CREATE TABLE request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    session_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    latency_ms INTEGER,
    status_code INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    error TEXT,
    cached_tokens INTEGER,
    client_model TEXT,
    ttft_ms INTEGER,
    tpot_ms REAL,
    stream INTEGER,
    api_key_id INTEGER,
    api_key_raw TEXT,
    api_key_name TEXT,
    api_key_value TEXT,
    endpoint TEXT DEFAULT 'anthropic'
  );

  DROP TABLE IF EXISTS request_payloads;
  CREATE TABLE request_payloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL UNIQUE,
    request_payload TEXT,
    response_payload TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (request_id) REFERENCES request_logs(id) ON DELETE CASCADE
  );

  DROP TABLE IF EXISTS api_keys;
  CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    key_value TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    request_count INTEGER DEFAULT 0,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_cached_tokens INTEGER DEFAULT 0
  );
`)

console.log('✅ Test database created with old schema (pre-0.4.x)')
console.log('📊 daily_metrics schema:')
const schema = db.prepare('PRAGMA table_info(daily_metrics)').all()
console.table(schema)

console.log('\n📝 Test data:')
const data = db.prepare('SELECT * FROM daily_metrics').all()
console.table(data)

console.log('\n🔑 Primary key info:')
const pk = db.prepare("SELECT name, pk FROM pragma_table_info('daily_metrics') WHERE pk > 0").all()
console.table(pk)

db.close()

console.log('\n✨ Test database ready at:', testDb)
console.log('\n💡 To test migration:')
console.log('   1. Stop cc-gw (already done)')
console.log(`   2. Replace database: mv ${testDb} ${originalDb}`)
console.log('   3. Start cc-gw: cc-gw start')
console.log('   4. Check if migration succeeds')
console.log(`   5. Restore backup if needed: mv ${originalDb}.backup ${originalDb}`)
