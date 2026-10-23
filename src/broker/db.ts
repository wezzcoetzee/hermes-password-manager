import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

export function openDb(path: string, migrationsDir: string): Db {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => Number(r.version)))
  for (const file of readdirSync(migrationsDir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
    const version = Number.parseInt(file, 10)
    if (applied.has(version)) continue
    db.exec('BEGIN')
    try {
      db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now())
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return db
}

export interface AgentRow { id: string; name: string }
export interface AccountRow { id: string; site_id: string; username: string; label: string; max_session_minutes: number }
export interface GrantRow { allow_transactions: number }
export interface SessionRow { id: string; agent_id: string; site_id: string; account_id: string | null; state: string; expires_at: number }
export interface ApprovalRow { id: string; session_id: string; agent_id: string; summary_hash: string; status: string; expires_at: number; merchant: string; total: string; currency: string }

export const getSetting = (db: Db, key: string) =>
  (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value

export const setSetting = (db: Db, key: string, value: string) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
