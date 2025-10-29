import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database, { type Database as BetterSqliteDatabase, type RunResult } from 'better-sqlite3'

const HOME_OVERRIDE = process.env.CC_GW_HOME
export const HOME_DIR = path.resolve(HOME_OVERRIDE ?? path.join(os.homedir(), '.cc-gw'))
export const DATA_DIR = path.join(HOME_DIR, 'data')
export const DB_PATH = path.join(DATA_DIR, 'gateway.db')
const DB_WAL_PATH = `${DB_PATH}-wal`
const DB_SHM_PATH = `${DB_PATH}-shm`

type StatementParams = any[] | Record<string, unknown>

let dbPromise: Promise<BetterSqliteDatabase> | null = null
let dbInstance: BetterSqliteDatabase | null = null

function exec(db: BetterSqliteDatabase, sql: string): Promise<void> {
  db.exec(sql)
  return Promise.resolve()
}

function run(
  db: BetterSqliteDatabase,
  sql: string,
  params: StatementParams = []
): Promise<{ lastID: number; changes: number }> {
  const statement = db.prepare(sql)
  const result: RunResult =
    Array.isArray(params) ? statement.run(...params) : statement.run(params as Record<string, unknown>)

  // better-sqlite3 returns bigint for lastInsertRowid when rowid exceeds 2^53-1.
  const lastID = typeof result.lastInsertRowid === 'bigint' ? Number(result.lastInsertRowid) : result.lastInsertRowid
  return Promise.resolve({ lastID, changes: result.changes })
}

function all<T = any>(db: BetterSqliteDatabase, sql: string, params: StatementParams = []): Promise<T[]> {
  const statement = db.prepare(sql)
  const rows = Array.isArray(params) ? statement.all(...params) : statement.all(params as Record<string, unknown>)
  return Promise.resolve(rows as T[])
}

function get<T = any>(
  db: BetterSqliteDatabase,
  sql: string,
  params: StatementParams = []
): Promise<T | undefined> {
  const statement = db.prepare(sql)
  const row = Array.isArray(params) ? statement.get(...params) : statement.get(params as Record<string, unknown>)
  return Promise.resolve(row as T | undefined)
}

async function columnExists(db: BetterSqliteDatabase, table: string, column: string): Promise<boolean> {
  const rows = await all<{ name: string }>(db, `PRAGMA table_info(${table})`)
  return rows.some((row) => row.name === column)
}

async function migrateDailyMetricsTable(db: BetterSqliteDatabase): Promise<void> {
  const columns = await all<{ name: string; pk: number }>(db, 'PRAGMA table_info(daily_metrics)')
  if (columns.length === 0) return

  const hasEndpointColumn = columns.some((column) => column.name === 'endpoint')
  const primaryKeyColumns = columns.filter((column) => column.pk > 0)
  const hasCompositePrimaryKey = primaryKeyColumns.length > 1

  if (!hasEndpointColumn || !hasCompositePrimaryKey) {
    const endpointSelector = hasEndpointColumn ? "COALESCE(endpoint, 'anthropic')" : "'anthropic'"

    // Check if old table has total_cached_tokens column before migration
    const hasCachedTokensColumn = columns.some((column) => column.name === 'total_cached_tokens')
    const cachedTokensSelector = hasCachedTokensColumn ? 'COALESCE(total_cached_tokens, 0)' : '0'

    await exec(
      db,
      `ALTER TABLE daily_metrics RENAME TO daily_metrics_old;
       CREATE TABLE daily_metrics (
         date TEXT NOT NULL,
         endpoint TEXT NOT NULL DEFAULT 'anthropic',
         request_count INTEGER DEFAULT 0,
         total_input_tokens INTEGER DEFAULT 0,
         total_output_tokens INTEGER DEFAULT 0,
         total_cached_tokens INTEGER DEFAULT 0,
         total_latency_ms INTEGER DEFAULT 0,
         PRIMARY KEY (date, endpoint)
       );
       INSERT INTO daily_metrics (date, endpoint, request_count, total_input_tokens, total_output_tokens, total_cached_tokens, total_latency_ms)
         SELECT date,
                ${endpointSelector},
                request_count,
                total_input_tokens,
                total_output_tokens,
                ${cachedTokensSelector},
                total_latency_ms
           FROM daily_metrics_old;
       DROP TABLE daily_metrics_old;`
    )
  } else {
    await run(db, "UPDATE daily_metrics SET endpoint = 'anthropic' WHERE endpoint IS NULL OR endpoint = ''")
  }

  await run(
    db,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_metrics_date_endpoint ON daily_metrics(date, endpoint)'
  )
}

async function maybeAddColumn(db: BetterSqliteDatabase, table: string, column: string, definition: string): Promise<void> {
  const exists = await columnExists(db, table, column)
  if (!exists) {
    await run(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

async function ensureSchema(db: BetterSqliteDatabase): Promise<void> {
  await exec(
    db,
    `CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      session_id TEXT,
      endpoint TEXT NOT NULL DEFAULT 'anthropic',
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
      error TEXT,
      api_key_id INTEGER,
      api_key_name TEXT,
      api_key_value TEXT
    );

    CREATE TABLE IF NOT EXISTS request_payloads (
      request_id INTEGER PRIMARY KEY,
      prompt TEXT,
      response TEXT,
      FOREIGN KEY(request_id) REFERENCES request_logs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_metrics (
      date TEXT NOT NULL,
      endpoint TEXT NOT NULL DEFAULT 'anthropic',
      request_count INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cached_tokens INTEGER DEFAULT 0,
      total_latency_ms INTEGER DEFAULT 0,
      PRIMARY KEY (date, endpoint)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      key_hash TEXT NOT NULL UNIQUE,
      key_ciphertext TEXT,
      key_prefix TEXT,
      key_suffix TEXT,
      is_wildcard INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      last_used_at INTEGER,
      request_count INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS api_key_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER,
      api_key_name TEXT,
      operation TEXT NOT NULL,
      operator TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
    );`
  )

  await maybeAddColumn(db, 'request_logs', 'client_model', 'TEXT')
  await maybeAddColumn(db, 'request_logs', 'cached_tokens', 'INTEGER')
  await maybeAddColumn(db, 'request_logs', 'ttft_ms', 'INTEGER')
  await maybeAddColumn(db, 'request_logs', 'tpot_ms', 'REAL')
  await maybeAddColumn(db, 'request_logs', 'stream', 'INTEGER')
  await maybeAddColumn(db, 'request_logs', 'endpoint', "TEXT DEFAULT 'anthropic'")
  await maybeAddColumn(db, 'request_logs', 'api_key_id', 'INTEGER')
  await maybeAddColumn(db, 'request_logs', 'api_key_name', 'TEXT')
  await maybeAddColumn(db, 'request_logs', 'api_key_value', 'TEXT')

  const hasKeyHash = await columnExists(db, 'api_keys', 'key_hash')
  if (!hasKeyHash) {
    await run(db, 'ALTER TABLE api_keys ADD COLUMN key_hash TEXT')
  }
  await maybeAddColumn(db, 'api_keys', 'key_ciphertext', 'TEXT')
  await maybeAddColumn(db, 'api_keys', 'key_prefix', 'TEXT')
  await maybeAddColumn(db, 'api_keys', 'key_suffix', 'TEXT')
  await maybeAddColumn(db, 'api_keys', 'updated_at', 'INTEGER')
  await maybeAddColumn(db, 'api_keys', 'last_used_at', 'INTEGER')
  await maybeAddColumn(db, 'api_keys', 'description', 'TEXT')
  await maybeAddColumn(db, 'api_keys', 'request_count', 'INTEGER DEFAULT 0')
  await maybeAddColumn(db, 'api_keys', 'total_input_tokens', 'INTEGER DEFAULT 0')
  await maybeAddColumn(db, 'api_keys', 'total_output_tokens', 'INTEGER DEFAULT 0')

  await migrateDailyMetricsTable(db)
  await maybeAddColumn(db, 'daily_metrics', 'total_cached_tokens', 'INTEGER DEFAULT 0')

  await run(db, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE key_hash IS NOT NULL')
  await run(db, "UPDATE api_keys SET key_hash = '*' WHERE is_wildcard = 1 AND (key_hash IS NULL OR key_hash = '')")
  await run(db, 'UPDATE api_keys SET updated_at = created_at WHERE updated_at IS NULL')

  const wildcardRow = await get<{ count: number }>(db, 'SELECT COUNT(*) as count FROM api_keys WHERE is_wildcard = 1')
  if (!wildcardRow || wildcardRow.count === 0) {
    const now = Date.now()
    await run(
      db,
      'INSERT INTO api_keys (name, description, key_hash, is_wildcard, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)',
      ['Any Key', null, '*', now, now]
    )
  }
}

export async function getDb(): Promise<BetterSqliteDatabase> {
  if (dbInstance) {
    return dbInstance
  }

  if (!dbPromise) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    dbPromise = (async () => {
      const instance = new Database(DB_PATH)
      instance.pragma('journal_mode = WAL')
      try {
        await ensureSchema(instance)
        dbInstance = instance
        return instance
      } catch (error) {
        instance.close()
        throw error
      }
    })()
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

  toClose.close()
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

async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.promises.stat(filePath)
    return stats.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0
    }
    throw error
  }
}

export interface DatabaseFileStats {
  mainBytes: number
  walBytes: number
  shmBytes: number
  totalBytes: number
}

export async function getDatabaseFileStats(): Promise<DatabaseFileStats> {
  const [mainBytes, walBytes, shmBytes] = await Promise.all([
    getFileSize(DB_PATH),
    getFileSize(DB_WAL_PATH),
    getFileSize(DB_SHM_PATH)
  ])

  return {
    mainBytes,
    walBytes,
    shmBytes,
    totalBytes: mainBytes + walBytes + shmBytes
  }
}

export interface DatabasePageStats {
  pageCount: number
  pageSize: number
  freelistPages: number
}

export async function getDatabasePageStats(): Promise<DatabasePageStats> {
  const db = await getDb()
  const pageCount = Number(db.pragma('page_count', { simple: true })) || 0
  const pageSize = Number(db.pragma('page_size', { simple: true })) || 0
  const freelistPages = Number(db.pragma('freelist_count', { simple: true })) || 0
  return {
    pageCount,
    pageSize,
    freelistPages
  }
}

export interface CompactResult {
  beforeBytes: number
  afterBytes: number
  reclaimedBytes: number
}

export async function compactDatabase(): Promise<CompactResult> {
  const before = await getDatabaseFileStats()
  const db = await getDb()

  db.pragma('wal_checkpoint(TRUNCATE)')
  db.exec('VACUUM')

  const after = await getDatabaseFileStats()
  const beforeTotal = before.totalBytes
  const afterTotal = after.totalBytes

  return {
    beforeBytes: beforeTotal,
    afterBytes: afterTotal,
    reclaimedBytes: Math.max(0, beforeTotal - afterTotal)
  }
}
