/**
 * Broker policy core. Every decision about who may do what is made here, from
 * server-side state; nothing the agent sends is trusted beyond its validated shape.
 */
import { HttpError } from '../shared/http.ts'
import { opaqueId } from '../shared/ids.ts'
import { siteOrigins, type Site } from '../shared/sites.ts'
import type { ToolInput, ToolName } from '../shared/tools.ts'
import type { WorkerAction } from '../shared/worker-protocol.ts'
import type { Audit } from './audit.ts'
import type { AccountRow, AgentRow, ApprovalRow, Db, GrantRow, SessionRow } from './db.ts'
import type { HelperClient } from './helper-client.ts'
import type { WorkerClient } from './worker-client.ts'

export const ANONYMOUS_SESSION_MINUTES = 30
export const TRANSACTION_APPROVAL_TTL_MS = 120_000
const LIVE_STATES = new Set(['anonymous', 'authenticated'])

export interface BrokerDeps { db: Db; sites: Map<string, Site>; helper: HelperClient; worker: WorkerClient; audit: Audit; now?: () => number }

function maskUsername(username: string) {
  const [local = '', domain] = username.split('@')
  return `${local.slice(0, 1)}***${domain ? `@${domain}` : ''}`
}

export function createBroker({ db, sites, helper, worker, audit, now = Date.now }: BrokerDeps) {
  /** One native prompt per session at a time, so an agent cannot flood the user with approvals. */
  const prompting = new Set<string>()
  async function withPrompt<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    if (prompting.has(sessionId)) throw new HttpError(409, 'approval_pending', 'An approval for this session is already waiting for the user')
    prompting.add(sessionId)
    try {
      return await fn()
    } finally {
      prompting.delete(sessionId)
    }
  }

  const forbidden = (agent: AgentRow, message: string, entry: { sessionId?: string; accountId?: string; detail?: Record<string, string> } = {}) => {
    audit({ event: 'policy_violation', outcome: 'rejected', agentId: agent.id, ...entry, detail: { ...entry.detail, message } })
    return new HttpError(403, 'forbidden', message)
  }

  const siteFor = (id: string) => {
    const site = sites.get(id)
    if (!site) throw new HttpError(500, 'site_missing', `Site config ${id} is missing`)
    return site
  }

  const grantsFor = (agent: AgentRow) => db.prepare(
    'SELECT a.id, a.site_id, a.username, a.label, a.max_session_minutes, g.allow_transactions FROM grants g JOIN accounts a ON a.id = g.account_id WHERE g.agent_id = ?',
  ).all(agent.id) as unknown as (AccountRow & GrantRow)[]

  const grant = (agent: AgentRow, accountId: string) => db.prepare(
    'SELECT a.id, a.site_id, a.username, a.label, a.max_session_minutes, g.allow_transactions FROM grants g JOIN accounts a ON a.id = g.account_id WHERE g.agent_id = ? AND a.id = ?',
  ).get(agent.id, accountId) as (AccountRow & GrantRow) | undefined

  /** Loads a session the agent owns and that is still live. Cross-agent ids look identical to unknown ids. */
  function liveSession(agent: AgentRow, sessionId: string): SessionRow {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND agent_id = ?').get(sessionId, agent.id) as SessionRow | undefined
    if (!session) throw new HttpError(404, 'session_not_found', 'Unknown session')
    if (LIVE_STATES.has(session.state) && session.expires_at <= now()) {
      db.prepare("UPDATE sessions SET state = 'expired' WHERE id = ?").run(session.id)
      audit({ event: 'session_expired', outcome: 'expired', agentId: agent.id, sessionId })
      void worker.close(session.id).catch(() => undefined)
      session.state = 'expired'
    }
    if (!LIVE_STATES.has(session.state)) throw new HttpError(410, `session_${session.state}`, `Session is ${session.state}`)
    return session
  }

  async function openSession(agent: AgentRow, site: Site) {
    const id = opaqueId('ses')
    const expiresAt = now() + ANONYMOUS_SESSION_MINUTES * 60_000
    await worker.open(id, site, expiresAt)
    db.prepare("INSERT INTO sessions (id, agent_id, site_id, state, created_at, expires_at) VALUES (?, ?, ?, 'anonymous', ?, ?)").run(id, agent.id, site.id, now(), expiresAt)
    audit({ event: 'session_created', outcome: 'anonymous', agentId: agent.id, sessionId: id, detail: { site: site.id } })
    return id
  }

  async function act(agent: AgentRow, session: SessionRow, action: WorkerAction) {
    const result = await worker.act(session.id, action)
    audit({ event: 'browser_action', outcome: 'ok', agentId: agent.id, sessionId: session.id, accountId: session.account_id, detail: { action: action.type, ...('ref' in action ? { ref: action.ref } : {}) } })
    for (const blocked of result.blocked ?? []) {
      audit({ event: 'policy_violation', outcome: 'blocked', agentId: agent.id, sessionId: session.id, detail: { reason: blocked.reason, origin: blocked.url } })
    }
    if (result.transaction) {
      audit({ event: 'transaction_execution', outcome: result.transaction.status, agentId: agent.id, sessionId: session.id, accountId: session.account_id, detail: { reason: result.transaction.reason } })
    }
    return result
  }

  async function requestLogin(agent: AgentRow, { sessionId, accountId, durationMinutes }: ToolInput<'request_login'>) {
    const session = liveSession(agent, sessionId)
    const account = grant(agent, accountId)
    if (!account) throw forbidden(agent, 'Agent has no grant for this account', { sessionId, accountId })
    if (account.site_id !== session.site_id) throw forbidden(agent, 'Account belongs to a different site than this session', { sessionId, accountId })
    if (session.state !== 'anonymous') throw new HttpError(409, 'already_authenticated', 'Session is already signed in; open a new session for another account')
    const site = siteFor(session.site_id)
    const minutes = Math.min(durationMinutes, account.max_session_minutes)
    const requestId = opaqueId('req')

    audit({ event: 'credential_access', outcome: 'requested', agentId: agent.id, sessionId, accountId, detail: { requestId, minutes } })
    const { decision, credential } = await helper.approveLogin({
      requestId, agent: agent.name, site: { name: site.name, origin: site.origin },
      account: { id: account.id, username: account.username }, durationMinutes: minutes,
    })
    audit({ event: 'login_approval', outcome: decision, agentId: agent.id, sessionId, accountId, detail: { requestId } })
    if (decision !== 'approved' || !credential) return { status: decision === 'unavailable' ? 'approval_unavailable' : 'denied' }

    const { ok } = await worker.login(sessionId, credential.username, credential.password)
    audit({ event: 'login_result', outcome: ok ? 'authenticated' : 'failed', agentId: agent.id, sessionId, accountId })
    if (!ok) return { status: 'login_failed' }

    const expiresAt = now() + minutes * 60_000
    const upgraded = db.prepare("UPDATE sessions SET state = 'authenticated', account_id = ?, expires_at = ? WHERE id = ? AND state = 'anonymous'").run(accountId, expiresAt, sessionId)
    if (upgraded.changes !== 1) throw new HttpError(409, 'session_changed', 'Session changed during sign-in')
    await worker.extend(sessionId, expiresAt)
    return { status: 'authenticated', expiresAt: new Date(expiresAt).toISOString() }
  }

  async function requestTransactionApproval(agent: AgentRow, { sessionId }: ToolInput<'request_transaction_approval'>) {
    const session = liveSession(agent, sessionId)
    const account = session.account_id ? grant(agent, session.account_id) : undefined
    if (session.state !== 'authenticated' || !account) throw forbidden(agent, 'Transactions require an authenticated session', { sessionId })
    if (!account.allow_transactions) throw forbidden(agent, 'This agent is not permitted to make transactions on this account', { sessionId, accountId: account.id })
    const site = siteFor(session.site_id)
    if (!site.checkout) return { status: 'manual_checkout_required', message: `${site.name} has no verified checkout adapter. Ask the user to complete checkout themselves.` }

    const { orderSummary, summaryHash } = await worker.act(sessionId, { type: 'order_summary' })
    if (!orderSummary || !summaryHash) throw new HttpError(422, 'summary_unavailable', 'Could not read the order summary from the checkout page')
    const id = opaqueId('txn')
    db.prepare("INSERT INTO transaction_approvals (id, session_id, agent_id, summary_hash, merchant, total, currency, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)")
      .run(id, sessionId, agent.id, summaryHash, orderSummary.merchant, orderSummary.total, orderSummary.currency, now(), now() + TRANSACTION_APPROVAL_TTL_MS)
    audit({ event: 'transaction_approval', outcome: 'requested', agentId: agent.id, sessionId, accountId: account.id, detail: { approvalId: id, total: orderSummary.total, currency: orderSummary.currency } })

    const decision = await helper.approveTransaction({ requestId: id, agent: agent.name, site: { name: site.name, origin: site.origin }, summary: orderSummary })
    // The TTL starts when the user decides, not when the prompt appeared.
    const expiresAt = now() + TRANSACTION_APPROVAL_TTL_MS
    db.prepare('UPDATE transaction_approvals SET status = ?, expires_at = ? WHERE id = ?').run(decision === 'approved' ? 'approved' : 'denied', expiresAt, id)
    audit({ event: 'transaction_approval', outcome: decision, agentId: agent.id, sessionId, accountId: account.id, detail: { approvalId: id } })
    return { approvalId: id, status: decision === 'approved' ? 'approved' : 'denied', summary: orderSummary, ...(decision === 'approved' ? { expiresAt: new Date(expiresAt).toISOString(), next: 'Click the merchant\'s place-order button now. The approval works once.' } : {}) }
  }

  const handlers: { [K in ToolName]: (agent: AgentRow, input: ToolInput<K>) => Promise<unknown> } = {
    async list_accounts(agent) {
      return {
        accounts: grantsFor(agent).map((a) => {
          const site = siteFor(a.site_id)
          return { accountId: a.id, label: a.label, site: site.name, origin: site.origin, username: maskUsername(a.username), transactionsAllowed: Boolean(a.allow_transactions), automatedCheckout: Boolean(site.checkout) }
        }),
      }
    },

    async browser_navigate(agent, { url, sessionId }) {
      const origin = new URL(url).origin
      if (!sessionId) {
        const site = grantsFor(agent).map((a) => siteFor(a.site_id)).find((s) => siteOrigins(s).includes(origin))
        if (!site) throw forbidden(agent, `Origin ${origin} is not allowlisted for this agent`, { detail: { origin } })
        sessionId = await openSession(agent, site)
      }
    const session = liveSession(agent, sessionId)
      if (!siteOrigins(siteFor(session.site_id)).includes(origin)) throw forbidden(agent, `Origin ${origin} is not allowed in this session`, { sessionId, detail: { origin } })
      return { sessionId, ...(await act(agent, session, { type: 'navigate', url })) }
    },

    request_login: (agent, input) => withPrompt(input.sessionId, () => requestLogin(agent, input)),
    request_transaction_approval: (agent, input) => withPrompt(input.sessionId, () => requestTransactionApproval(agent, input)),


    async get_session_status(agent, { sessionId }) {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ? AND agent_id = ?').get(sessionId, agent.id) as SessionRow | undefined
      if (!row) throw new HttpError(404, 'session_not_found', 'Unknown session')
      const state = LIVE_STATES.has(row.state) && row.expires_at <= now() ? 'expired' : row.state
      return { sessionId, state, site: siteFor(row.site_id).name, accountId: row.account_id, expiresAt: new Date(row.expires_at).toISOString() }
    },

    async revoke_session(agent, { sessionId }) {
      const row = db.prepare('SELECT id FROM sessions WHERE id = ? AND agent_id = ?').get(sessionId, agent.id)
      if (!row) throw new HttpError(404, 'session_not_found', 'Unknown session')
      db.prepare("UPDATE sessions SET state = 'revoked' WHERE id = ? AND state IN ('anonymous', 'authenticated')").run(sessionId)
      db.prepare("UPDATE transaction_approvals SET status = 'expired' WHERE session_id = ? AND status IN ('pending', 'approved')").run(sessionId)
      await worker.close(sessionId)
      audit({ event: 'session_revoked', outcome: 'revoked', agentId: agent.id, sessionId })
      return { sessionId, state: 'revoked' }
    },

    browser_snapshot: async (agent, { sessionId }) => (await act(agent, liveSession(agent, sessionId), { type: 'snapshot' })).snapshot,
    browser_click: async (agent, { sessionId, ref }) => act(agent, liveSession(agent, sessionId), { type: 'click', ref }),
    browser_fill: async (agent, { sessionId, ref, text }) => act(agent, liveSession(agent, sessionId), { type: 'fill', ref, text }),
    browser_select: async (agent, { sessionId, ref, option }) => act(agent, liveSession(agent, sessionId), { type: 'select', ref, option }),
    browser_scroll: async (agent, { sessionId, direction, amount }) => act(agent, liveSession(agent, sessionId), { type: 'scroll', direction, amount }),
    browser_back: async (agent, { sessionId }) => act(agent, liveSession(agent, sessionId), { type: 'back' }),
    browser_wait: async (agent, { sessionId, text, timeoutMs }) => act(agent, liveSession(agent, sessionId), { type: 'wait', text, timeoutMs }),
    browser_screenshot: async (agent, { sessionId }) => act(agent, liveSession(agent, sessionId), { type: 'screenshot' }),

    async get_transaction_status(agent, { approvalId }) {
      const row = db.prepare('SELECT * FROM transaction_approvals WHERE id = ? AND agent_id = ?').get(approvalId, agent.id) as ApprovalRow | undefined
      if (!row) throw new HttpError(404, 'approval_not_found', 'Unknown approval')
      const status = row.status === 'approved' && row.expires_at <= now() ? 'expired' : row.status
      return { approvalId, status, merchant: row.merchant, total: row.total, currency: row.currency }
    },
  }

  /** Called by the browser worker when the page tries to submit an order. Single-use by construction. */
  function consumeTransaction(sessionId: string, summaryHash: string): { allowed: boolean; reason: string } {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined
    const deny = (reason: string) => {
      audit({ event: 'transaction_execution', outcome: 'blocked', agentId: session?.agent_id, sessionId, accountId: session?.account_id, detail: { reason } })
      return { allowed: false, reason }
    }
    if (!session || session.state !== 'authenticated' || session.expires_at <= now()) return deny('session_not_authenticated')
    const approval = db.prepare("SELECT * FROM transaction_approvals WHERE session_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 1").get(sessionId) as ApprovalRow | undefined
    if (!approval) return deny('no_valid_approval')
    if (approval.expires_at <= now()) {
      db.prepare("UPDATE transaction_approvals SET status = 'expired' WHERE id = ?").run(approval.id)
      return deny('approval_expired')
    }
    if (approval.summary_hash !== summaryHash) return deny('order_changed_since_approval')
    const claimed = db.prepare("UPDATE transaction_approvals SET status = 'consumed', consumed_at = ? WHERE id = ? AND status = 'approved'").run(now(), approval.id)
    if (claimed.changes !== 1) return deny('approval_already_used')
    audit({ event: 'transaction_execution', outcome: 'allowed', agentId: session.agent_id, sessionId, accountId: session.account_id, detail: { approvalId: approval.id } })
    return { allowed: true, reason: 'approved' }
  }

  /** On boot nothing from a previous run is trusted: the worker lost its contexts, so sessions end. */
  function terminateStaleSessions() {
    db.prepare("UPDATE sessions SET state = 'terminated' WHERE state IN ('anonymous', 'authenticated')").run()
    db.prepare("UPDATE transaction_approvals SET status = 'expired' WHERE status IN ('pending', 'approved')").run()
  }

  function expireSessions() {
    const stale = db.prepare("SELECT id, agent_id FROM sessions WHERE state IN ('anonymous', 'authenticated') AND expires_at <= ?").all(now()) as { id: string; agent_id: string }[]
    for (const s of stale) {
      db.prepare("UPDATE sessions SET state = 'expired' WHERE id = ?").run(s.id)
      audit({ event: 'session_expired', outcome: 'expired', agentId: s.agent_id, sessionId: s.id })
      void worker.close(s.id).catch(() => undefined)
    }
  }

  return { handlers, consumeTransaction, terminateStaleSessions, expireSessions }
}

export type Broker = ReturnType<typeof createBroker>
