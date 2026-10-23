import type { Db } from './db.ts'
import type { Logger } from '../shared/logger.ts'

export type AuditEvent =
  | 'agent_auth' | 'session_created' | 'session_expired' | 'session_revoked'
  | 'credential_access' | 'login_approval' | 'login_result'
  | 'browser_action' | 'policy_violation'
  | 'transaction_approval' | 'transaction_execution'

export interface AuditEntry {
  event: AuditEvent
  outcome: string
  agentId?: string | null
  sessionId?: string | null
  accountId?: string | null
  /** Must never contain secrets; callers pass identifiers and outcomes only. */
  detail?: Record<string, string | number | boolean | undefined>
}

export type Audit = (entry: AuditEntry) => void

export function createAudit(db: Db, log: Logger): Audit {
  const insert = db.prepare('INSERT INTO audit_events (ts, event, outcome, agent_id, session_id, account_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
  return (entry) => {
    insert.run(Date.now(), entry.event, entry.outcome, entry.agentId ?? null, entry.sessionId ?? null, entry.accountId ?? null, entry.detail ? JSON.stringify(entry.detail) : null)
    log.info({ audit: entry.event, outcome: entry.outcome, agentId: entry.agentId, sessionId: entry.sessionId, accountId: entry.accountId, detail: entry.detail }, 'audit')
  }
}
