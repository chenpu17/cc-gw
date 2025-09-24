import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

export const HOME_DIR = path.join(os.homedir(), '.cc-gw')
export const DATA_DIR = path.join(HOME_DIR, 'data')
export const DB_PATH = path.join(DATA_DIR, 'gateway.db')

let db: Database.Database | null = null

function ensureSchema(instance: Database.Database) {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      session_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      latency_ms INTEGER,
      status_code INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_tokens INTEGER,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS request_payloads (
      request_id INTEGER PRIMARY KEY,
      prompt TEXT,
      response TEXT,
      FOREIGN KEY(request_id) REFERENCES request_logs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_metrics (
      date TEXT PRIMARY KEY,
      request_count INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_latency_ms INTEGER DEFAULT 0
    );
  `)
}

export function getDb(): Database.Database {
  if (db) return db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  db = new Database(DB_PATH)
  ensureSchema(db)
  ensureColumns(db)
  return db
}

function ensureColumns(instance: Database.Database) {
  const columns = instance.prepare('PRAGMA table_info(request_logs)').all() as Array<{ name: string }>
  const hasCachedTokens = columns.some((column) => column.name === 'cached_tokens')
  if (!hasCachedTokens) {
    instance.exec('ALTER TABLE request_logs ADD COLUMN cached_tokens INTEGER')
  }
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
