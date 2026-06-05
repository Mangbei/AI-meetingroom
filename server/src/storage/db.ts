// @ts-ignore — node:sqlite available in Node 22.5+
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const DATA_DIR = join(homedir(), '.making-debate')
const DB_PATH = join(DATA_DIR, 'debate.db')

mkdirSync(DATA_DIR, { recursive: true })

const _db = new DatabaseSync(DB_PATH)
_db.exec('PRAGMA journal_mode = WAL')
_db.exec('PRAGMA foreign_keys = ON')

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql')
const schema = readFileSync(schemaPath, 'utf-8')
_db.exec(schema)

// Migrate existing databases that predate config columns
for (const col of ['deepseek_config', 'claude_config']) {
  try {
    _db.exec(`ALTER TABLE debates ADD COLUMN ${col} TEXT NOT NULL DEFAULT '{}'`)
  } catch { /* column already exists */ }
}
// 5-phase iteration: summaries gains a "dissent" (少数派意见) column.
try {
  _db.exec(`ALTER TABLE summaries ADD COLUMN dissent TEXT NOT NULL DEFAULT ''`)
} catch { /* column already exists */ }

// Orphan cleanup: any debate stuck at 'pending'/'running' belongs to a previous
// server process (it can't be in-flight on a freshly-started server). Mark them
// as 'error' so the UI shows whatever partial messages were captured.
_db.exec(`UPDATE debates SET status = 'error' WHERE status IN ('pending', 'running')`)
_db.exec(`UPDATE meetings SET status = 'error' WHERE status IN ('pending', 'running')`)

// Minimal wrapper matching the better-sqlite3 API used in the codebase
export const db = {
  prepare(sql: string) {
    const stmt = _db.prepare(sql)
    return {
      run(...params: unknown[]) {
        return stmt.run(...params)
      },
      get(...params: unknown[]) {
        return stmt.get(...params)
      },
      all(...params: unknown[]) {
        return stmt.all(...params)
      },
    }
  },
  exec(sql: string) {
    return _db.exec(sql)
  },
}
