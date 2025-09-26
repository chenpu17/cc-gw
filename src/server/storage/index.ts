import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sqlite3 from 'sqlite3'

export const HOME_DIR = path.join(os.homedir(), '.cc-gw')
export const DATA_DIR = path.join(HOME_DIR, 'data')
export const DB_PATH = path.join(DATA_DIR, 'gateway.db')

type StatementParams = any[] | Record<string, unknown>

sqlite3.verbose()

let dbPromise: Promise<sqlite3.Database> | null = null
let dbInstance: sqlite3.Database | null = null

function exec(db: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function run(
  db: sqlite3.Database,
  sql: string,
  params: StatementParams = []
): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    const handler = function (this: sqlite3.RunResult, error: Error | null) {
      if (error) {
        reject(error)
        return
      }
      resolve({ lastID: this.lastID, changes: this.changes })
    }

    if (Array.isArray(params)) {
      db.run(sql, params, handler)
    } else {
      db.run(sql, params, handler)
    }
  })
}

function all<T = any>(db: sqlite3.Database, sql: string, params: StatementParams = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, rows: T[]) => {
      if (error) {
        reject(error)
        return
      }
      resolve(rows)
    }

    if (Array.isArray(params)) {
      db.all(sql, params, callback)
    } else {
      db.all(sql, params, callback)
    }
  })
}

function get<T = any>(db: sqlite3.Database, sql: string, params: StatementParams = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, row: T | undefined) => {
      if (error) {
        reject(error)
        return
      }
      resolve(row)
    }

    if (Array.isArray(params)) {
      db.get(sql, params, callback)
    } else {
      db.get(sql, params, callback)
    }
  })
}

async function columnExists(db: sqlite3.Database, table: string, column: string): Promise<boolean> {
  const rows = await all<{ name: string }>(db, `PRAGMA table_info(${table})`)
  return rows.some((row) => row.name === column)
}

async function maybeAddColumn(db: sqlite3.Database, table: string, column: string, definition: string): Promise<void> {
  const exists = await columnExists(db, table, column)
  if (!exists) {
    await run(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

async function ensureSchema(db: sqlite3.Database): Promise<void> {
  await exec(
    db,
    `CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      session_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      client_model TEXT,
      stream INTEGER,
      latency_ms INTEGER,
      status_code INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_tokens INTEGER,
      ttft_ms INTEGER,
      tpot_ms REAL,
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
    );`
  )

  await maybeAddColumn(db, 'request_logs', 'client_model', 'TEXT')
  await maybeAddColumn(db, 'request_logs', 'cached_tokens', 'INTEGER')
  await maybeAddColumn(db, 'request_logs', 'ttft_ms', 'INTEGER')
  await maybeAddColumn(db, 'request_logs', 'tpot_ms', 'REAL')
  await maybeAddColumn(db, 'request_logs', 'stream', 'INTEGER')
}

export async function getDb(): Promise<sqlite3.Database> {
  if (dbInstance) {
    return dbInstance
  }

  if (!dbPromise) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    dbPromise = new Promise((resolve, reject) => {
      const instance = new sqlite3.Database(DB_PATH, (error) => {
        if (error) {
          reject(error)
          return
        }

        ensureSchema(instance)
          .then(() => {
            dbInstance = instance
            resolve(instance)
          })
          .catch((schemaError) => {
            instance.close(() => reject(schemaError))
          })
      })
    })
  }

  return dbPromise
}

export async function closeDb(): Promise<void> {
  if (!dbInstance) {
    dbPromise = null
    return
  }

  const toClose = dbInstance
  dbInstance = null
  dbPromise = null

  await new Promise<void>((resolve, reject) => {
    toClose.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export async function runQuery(sql: string, params: StatementParams = []): Promise<{ lastID: number; changes: number }> {
  const db = await getDb()
  return run(db, sql, params)
}

export async function getOne<T = any>(sql: string, params: StatementParams = []): Promise<T | undefined> {
  const db = await getDb()
  return get<T>(db, sql, params)
}

export async function getAll<T = any>(sql: string, params: StatementParams = []): Promise<T[]> {
  const db = await getDb()
  return all<T>(db, sql, params)
}

export async function execQuery(sql: string): Promise<void> {
  const db = await getDb()
  await exec(db, sql)
}
