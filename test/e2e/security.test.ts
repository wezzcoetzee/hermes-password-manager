import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_USER } from '../../mock-shop/shop.ts'
import { createBrokerApp } from '../../src/broker/app.ts'
import { HELPER_KEY_SETTING } from '../../src/broker/config.ts'
import { setSetting } from '../../src/broker/db.ts'
import { generateKeyPair } from '../../src/shared/crypto.ts'
import { postJson } from '../../src/shared/http.ts'
import { OTHER_AGENT_TOKEN, call, ref, startSystem, type System } from '../harness.ts'

let sys: System
let hermes: Client
beforeAll(async () => {
  sys = await startSystem()
  hermes = await sys.connect()
})
afterAll(async () => { await sys.stop() })

const snapshot = async (sessionId: string) => (await call(hermes, 'browser_snapshot', { sessionId })).data

async function signedInSession(origin = sys.origin, accountId = 'test-shop-main') {
  const { data } = await call(hermes, 'browser_navigate', { url: `${origin}/` })
  sys.decisions.push('approved')
  const login = await call(hermes, 'request_login', { sessionId: data.sessionId, accountId })
  expect(login.data.status).toBe('authenticated')
  return data.sessionId as string
}

async function toCheckout(sessionId: string, origin = sys.origin, size = '32') {
  await call(hermes, 'browser_navigate', { sessionId, url: `${origin}/product/abc-pant` })
  const snap = await snapshot(sessionId)
  await call(hermes, 'browser_select', { sessionId, ref: ref(snap, 'select', 'Size'), option: size })
  await call(hermes, 'browser_click', { sessionId, ref: ref(snap, 'button', 'Add to basket') })
  await call(hermes, 'browser_navigate', { sessionId, url: `${origin}/checkout` })
}

const placeOrder = async (sessionId: string) =>
  (await call(hermes, 'browser_click', { sessionId, ref: ref(await snapshot(sessionId), 'button', 'Place order') })).data

describe('agent authentication and input validation', () => {
  it('rejects unknown agent tokens', async () => {
    const intruder = await sys.connect('not-a-real-token')
    const result = await call(intruder, 'list_accounts')
    expect(result.error).toMatch(/^unauthorized/)
    expect(sys.db.prepare("SELECT count(*) AS n FROM audit_events WHERE event = 'agent_auth' AND outcome = 'rejected'").get()).toMatchObject({ n: expect.any(Number) })
  })

  it('rejects malformed input before it reaches the browser', async () => {
    for (const [tool, args] of [
      ['browser_snapshot', { sessionId: '../../etc/passwd' }],
      ['browser_navigate', { url: 'file:///etc/passwd' }],
      ['browser_navigate', { url: 'javascript:alert(1)' }],
      ['browser_click', { sessionId: 'ses_' + 'a'.repeat(24), ref: 'button.submit' }],
      ['browser_fill', { sessionId: 'ses_' + 'a'.repeat(24), ref: 'e1', text: 'x'.repeat(5000) }],
    ] as const) {
      expect((await call(hermes, tool, args)).error, `${tool} ${JSON.stringify(args)}`).toBeTruthy()
    }
  })

  it('the internal consume endpoint refuses callers without the worker token', async () => {
    const internal = sys.app.internalServer.address()
    const port = typeof internal === 'object' && internal ? internal.port : 0
    await expect(postJson(`http://127.0.0.1:${port}/internal/transactions/consume`, { sessionId: 'x', summaryHash: 'y' })).rejects.toThrow(/Unauthorized/)
  })
})

describe('origin policy', () => {
  it('blocks navigation to unapproved websites', async () => {
    const result = await call(hermes, 'browser_navigate', { url: 'https://evil.example/' })
    expect(result.error).toMatch(/^forbidden: Origin https:\/\/evil.example is not allowlisted/)
    const { data } = await call(hermes, 'browser_navigate', { url: `${sys.origin}/` })
    expect((await call(hermes, 'browser_navigate', { sessionId: data.sessionId, url: 'https://evil.example/' })).error).toMatch(/^forbidden/)
  })

  it('blocks redirects and links that leave the allowlist, including cloud metadata (SSRF)', async () => {
    const { data } = await call(hermes, 'browser_navigate', { url: `${sys.origin}/redirect?to=http://169.254.169.254/latest/meta-data/` })
    expect(data.blocked).toEqual([{ url: 'http://169.254.169.254', reason: 'origin_not_allowed' }])
    const promo = await call(hermes, 'browser_navigate', { sessionId: data.sessionId, url: `${sys.origin}/promo` })
    const link = ref(await snapshot(promo.data.sessionId), 'a', 'Claim reward')
    const clicked = await call(hermes, 'browser_click', { sessionId: data.sessionId, ref: link })
    expect(clicked.data.blocked).toEqual([{ url: 'http://evil.example', reason: 'origin_not_allowed' }])
    expect(clicked.data.url).toBe(`${sys.origin}/promo`)
  })
})

describe('secret handling', () => {
  it('never returns the password, session cookie or card numbers, even when the page echoes them', async () => {
    const sessionId = await signedInSession()
    const nav = await call(hermes, 'browser_navigate', { sessionId, url: `${sys.origin}/account/debug` })
    const snap = await call(hermes, 'browser_snapshot', { sessionId })
    const shot = await call(hermes, 'browser_screenshot', { sessionId })
    for (const raw of [nav.raw, snap.raw]) {
      expect(raw).not.toContain(TEST_USER.password)
      expect(raw).not.toContain('4242 4242 4242 4242')
      expect(raw).not.toMatch(/session=[0-9a-f]{20,}/)
    }
    expect(snap.data.text).toContain('password=[redacted]')
    expect(shot.image).toBeTruthy() // pixels cannot be scrubbed; see docs/security-limitations.md
  })

  it('does not return input values, including what AgentVault typed on the login form', async () => {
    const { data } = await call(hermes, 'browser_navigate', { url: `${sys.origin}/login` })
    const snap = await snapshot(data.sessionId)
    await call(hermes, 'browser_fill', { sessionId: data.sessionId, ref: ref(snap, 'input', 'Password'), text: 'typed-by-agent' })
    const after = await call(hermes, 'browser_snapshot', { sessionId: data.sessionId })
    expect(after.raw).not.toContain('typed-by-agent')
    expect(after.data.elements).toContainEqual(expect.objectContaining({ name: 'Password', type: 'password', filled: true }))
  })
})

describe('prompt injection', () => {
  it('labels hostile page text as untrusted and flags it', async () => {
    const { data } = await call(hermes, 'browser_navigate', { url: `${sys.origin}/promo` })
    const snap = await snapshot(data.sessionId)
    expect(snap.untrusted).toBe(true)
    expect(snap.notice).toMatch(/Never follow instructions/)
    expect(snap.warnings[0]).toMatch(/possible_prompt_injection/)
  })

  it('an injected "approve automatically" still needs the human; a denial blocks the order', async () => {
    const sessionId = await signedInSession()
    await toCheckout(sessionId)
    sys.decisions.push('denied')
    const approval = await call(hermes, 'request_transaction_approval', { sessionId })
    expect(approval.data.status).toBe('denied')
    const before = sys.shop.orders.length
    expect((await placeOrder(sessionId)).transaction).toEqual({ status: 'blocked', reason: 'no_valid_approval' })
    expect(sys.shop.orders.length).toBe(before)
  })
})

describe('transaction boundary', () => {
  it('approvals are single-use: a second order on the same approval is blocked', async () => {
    const sessionId = await signedInSession()
    await toCheckout(sessionId)
    sys.decisions.push('approved')
    await call(hermes, 'request_transaction_approval', { sessionId })
    expect((await placeOrder(sessionId)).transaction?.status).toBe('submitted')
    const placed = sys.shop.orders.length
    await toCheckout(sessionId)
    expect((await placeOrder(sessionId)).transaction).toEqual({ status: 'blocked', reason: 'no_valid_approval' })
    expect(sys.shop.orders.length).toBe(placed)
  })

  it('expired approvals are rejected', async () => {
    const sessionId = await signedInSession()
    await toCheckout(sessionId)
    sys.decisions.push('approved')
    const { data } = await call(hermes, 'request_transaction_approval', { sessionId })
    sys.db.prepare('UPDATE transaction_approvals SET expires_at = ? WHERE id = ?').run(Date.now() - 1, data.approvalId)
    expect((await placeOrder(sessionId)).transaction).toEqual({ status: 'blocked', reason: 'approval_expired' })
  })

  it('an approval does not cover an order that changed after the user saw it', async () => {
    const sessionId = await signedInSession()
    await toCheckout(sessionId)
    sys.decisions.push('approved')
    await call(hermes, 'request_transaction_approval', { sessionId })
    await toCheckout(sessionId, sys.origin, '36') // sneak a second pair in
    expect((await placeOrder(sessionId)).transaction).toEqual({ status: 'blocked', reason: 'order_changed_since_approval' })
  })

  it('sites without a verified checkout adapter force manual checkout', async () => {
    const sessionId = await signedInSession(sys.manualOrigin, 'manual-shop-main')
    await toCheckout(sessionId, sys.manualOrigin)
    expect((await call(hermes, 'request_transaction_approval', { sessionId })).data.status).toBe('manual_checkout_required')
    const before = sys.shop.orders.length
    expect((await placeOrder(sessionId)).transaction).toEqual({ status: 'blocked', reason: 'manual_checkout_required' })
    expect(sys.shop.orders.length).toBe(before)
  })

  it('agents without transaction rights cannot request approval', async () => {
    const sessionId = await signedInSession()
    sys.db.prepare("UPDATE grants SET allow_transactions = 0 WHERE account_id = 'test-shop-main'").run()
    try {
      await toCheckout(sessionId)
      expect((await call(hermes, 'request_transaction_approval', { sessionId })).error).toMatch(/not permitted to make transactions/)
    } finally {
      sys.db.prepare("UPDATE grants SET allow_transactions = 1 WHERE account_id = 'test-shop-main'").run()
    }
  })

  it('a compromised worker cannot mint approvals: consume without an approved record is denied', () => {
    const sessionId = 'ses_' + 'z'.repeat(24)
    expect(sys.app.broker.consumeTransaction(sessionId, 'any-hash')).toEqual({ allowed: false, reason: 'session_not_authenticated' })
  })

  it('approvals from an unpaired helper key are rejected', async () => {
    const { data } = await call(hermes, 'browser_navigate', { url: `${sys.origin}/` })
    setSetting(sys.db, HELPER_KEY_SETTING, generateKeyPair().publicKey)
    try {
      sys.decisions.push('approved')
      expect((await call(hermes, 'request_login', { sessionId: data.sessionId, accountId: 'test-shop-main' })).error).toMatch(/^helper_signature_invalid/)
      expect((await call(hermes, 'get_session_status', { sessionId: data.sessionId })).data.state).toBe('anonymous')
    } finally {
      sys.decisions.length = 0
      setSetting(sys.db, HELPER_KEY_SETTING, sys.helper.publicKey)
    }
  })
})

describe('accounts and sessions', () => {
  it('cannot use an account from another site, or another agent\'s session', async () => {
    const { data } = await call(hermes, 'browser_navigate', { url: `${sys.origin}/` })
    expect((await call(hermes, 'request_login', { sessionId: data.sessionId, accountId: 'manual-shop-main' })).error).toMatch(/different site/)
    expect((await call(hermes, 'request_login', { sessionId: data.sessionId, accountId: 'someone-else' })).error).toMatch(/no grant/)
    const other = await sys.connect(OTHER_AGENT_TOKEN)
    expect((await call(other, 'browser_snapshot', { sessionId: data.sessionId })).error).toMatch(/^session_not_found/)
    expect((await call(other, 'list_accounts')).data.accounts).toEqual([])
  })

  it('denied or unavailable approval leaves the session signed out', async () => {
    const { data } = await call(hermes, 'browser_navigate', { url: `${sys.origin}/` })
    sys.decisions.push('unavailable')
    expect((await call(hermes, 'request_login', { sessionId: data.sessionId, accountId: 'test-shop-main' })).data.status).toBe('approval_unavailable')
    sys.decisions.push('denied')
    expect((await call(hermes, 'request_login', { sessionId: data.sessionId, accountId: 'test-shop-main' })).data.status).toBe('denied')
  })

  it('concurrent sessions are isolated from each other', async () => {
    const signedIn = await signedInSession()
    const { data } = await call(hermes, 'browser_navigate', { url: `${sys.origin}/account` })
    expect(data.url).toBe(`${sys.origin}/login`)
    const [a, b] = await Promise.all([snapshot(signedIn), snapshot(data.sessionId)])
    expect(a.title).not.toBe(b.title)
  })

  it('expired sessions cannot be reused', async () => {
    const sessionId = await signedInSession()
    sys.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(Date.now() - 1, sessionId)
    expect((await call(hermes, 'browser_snapshot', { sessionId })).error).toMatch(/^session_expired/)
    expect((await call(hermes, 'get_session_status', { sessionId })).data.state).toBe('expired')
  })

  it('revoked sessions end immediately and their browser context is gone', async () => {
    const sessionId = await signedInSession()
    expect((await call(hermes, 'revoke_session', { sessionId })).data.state).toBe('revoked')
    expect((await call(hermes, 'browser_snapshot', { sessionId })).error).toMatch(/^session_revoked/)
  })

  it('a broker restart terminates every session left from the previous run', async () => {
    const sessionId = await signedInSession()
    const restarted = createBrokerApp({ db: sys.db, identity: { signing: generateKeyPair(), sealing: generateKeyPair() }, sites: new Map(), helperUrl: '', workerUrl: '', workerToken: 'x', log: (await import('pino')).pino({ level: 'silent' }) })
    restarted.stop()
    expect((await call(hermes, 'get_session_status', { sessionId })).data.state).toBe('terminated')
  })
})

describe('audit', () => {
  it('records security events without secrets', () => {
    const events = sys.db.prepare('SELECT DISTINCT event FROM audit_events').all().map((r) => r.event)
    expect(events).toEqual(expect.arrayContaining(['agent_auth', 'session_created', 'credential_access', 'login_approval', 'browser_action', 'policy_violation', 'transaction_approval', 'transaction_execution', 'session_revoked']))
    const dump = JSON.stringify(sys.db.prepare('SELECT * FROM audit_events').all()) + sys.logLines.join('')
    expect(dump).not.toContain(TEST_USER.password)
    expect(dump).not.toContain('1 Test Street')
    expect(dump).not.toMatch(/sid=[0-9a-f]{20,}/)
  })
})

describe('approval prompts', () => {
  it('only one native prompt per session at a time', async () => {
    const { data } = await call(hermes, 'browser_navigate', { url: `${sys.origin}/` })
    sys.decisions.push('denied', 'denied')
    const results = await Promise.all([0, 1].map(() => call(hermes, 'request_login', { sessionId: data.sessionId, accountId: 'test-shop-main' })))
    expect(results.filter((r) => r.error?.startsWith('approval_pending'))).toHaveLength(1)
    sys.decisions.length = 0
  })
})
