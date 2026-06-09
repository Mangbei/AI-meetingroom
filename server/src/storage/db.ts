// @ts-ignore node:sqlite is available in Node 22.5+
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DATA_DIR = join(PROJECT_ROOT, '.local-data', 'db')
const DB_PATH = join(DATA_DIR, 'meetingroom.db')

mkdirSync(DATA_DIR, { recursive: true })

const _db = new DatabaseSync(DB_PATH)
_db.exec('PRAGMA journal_mode = WAL')
_db.exec('PRAGMA foreign_keys = ON')

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql')
const schema = readFileSync(schemaPath, 'utf-8')
_db.exec(schema)

try {
  _db.exec(`ALTER TABLE meeting_files ADD COLUMN original_path TEXT NOT NULL DEFAULT ''`)
} catch {
  // Column already exists.
}

try {
  _db.exec(`ALTER TABLE meetings ADD COLUMN agenda_rounds INTEGER NOT NULL DEFAULT 1`)
} catch {
  // Column already exists.
}

try {
  _db.exec(`ALTER TABLE meetings ADD COLUMN model_postures_json TEXT NOT NULL DEFAULT '{}'`)
} catch {
  // Column already exists.
}

try {
  _db.exec(`ALTER TABLE meeting_messages ADD COLUMN round_index INTEGER NOT NULL DEFAULT 0`)
} catch {
  // Column already exists.
}

try {
  _db.exec(`ALTER TABLE meeting_artifacts ADD COLUMN structured_json TEXT NOT NULL DEFAULT ''`)
} catch {
  // Column already exists.
}

// Any meeting stuck at 'pending'/'running' belongs to a previous server process.
// Mark it as 'error' so the UI shows captured partial output.
_db.exec(`UPDATE meetings SET status = 'error' WHERE status IN ('pending', 'running')`)

// Minimal wrapper matching the better-sqlite3 API used in the codebase.
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
