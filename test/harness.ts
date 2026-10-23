import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { pino } from 'pino'
import { createBrokerApp } from '../src/broker/app.ts'
import { HELPER_KEY_SETTING, TELEGRAM_CHAT_SETTING, TELEGRAM_TOKEN_SETTING, loadOrCreateIdentity } from '../src/broker/config.ts'
import { openDb, setSetting } from '../src/broker/db.ts'
import { createWorker } from '../src/browser-worker/worker.ts'
import { createDevHelper, type Prompt, type StoredCredential } from '../src/dev-helper/helper.ts'
import type { Decision } from '../src/shared/helper-protocol.ts'
import { listen } from '../src/shared/http.ts'
import { sha256 } from '../src/shared/ids.ts'
import { siteSchema, type Site } from '../src/shared/sites.ts'
import { createMcpServer } from '../src/mcp-adapter/adapter.ts'
import { TEST_USER, createShop } from '../mock-shop/shop.ts'
import { OWNER_CHAT_ID, TELEGRAM_TOKEN, startFakeTelegram } from './fake-telegram.ts'

export const AGENT_TOKEN = 'test-agent-token-' + 'x'.repeat(20)
export const OTHER_AGENT_TOKEN = 'other-agent-token-' + 'y'.repeat(20)
const WORKER_TOKEN = 'worker-token-for-tests'

/** Boots the whole system in-process with a real Chromium. Every log line is captured for leak checks. */
export async function startSystem() {
  const logLines: string[] = []
  const sink = new Writable({ write(chunk, _enc, cb) { logLines.push(String(chunk)); cb() } })
  const log = pino({ level: 'debug', redact: { paths: ['password', '*.password'], censor: '[redacted]' } }, sink)

  const shop = createShop()
  const shopPort = await listen(shop.server, 0, '127.0.0.1')
  const origin = `http://127.0.0.1:${shopPort}`
  const base = JSON.parse(readFileSync(join(import.meta.dirname, '../sites/test-shop.json'), 'utf8')) as Site
  const site = siteSchema.parse({ ...base, origin, login: { ...base.login, url: `${origin}/login` } })
  // Same server on a different origin, standing in for a site without a verified checkout adapter.
  const manualOrigin = `http://localhost:${shopPort}`
  const manualSite = siteSchema.parse({ ...site, id: 'manual-shop', name: 'Manual Shop', origin: manualOrigin, login: { ...site.login, url: `${manualOrigin}/login` }, checkout: null })
  const sites = new Map([[site.id, site], [manualSite.id, manualSite]])

  const dir = mkdtempSync(join(tmpdir(), 'agentvault-'))
  const db = openDb(join(dir, 'test.db'), join(import.meta.dirname, '../migrations'))
  const identity = loadOrCreateIdentity(join(dir, 'identity.json'))

  const decisions: Decision[] = []
  const credentials = new Map<string, StoredCredential>([
    ['test-shop-main', { username: TEST_USER.email, password: TEST_USER.password, origin }],
    ['manual-shop-main', { username: TEST_USER.email, password: TEST_USER.password, origin: manualOrigin }],
  ])
  const helper = createDevHelper({
    brokerSigningKey: identity.signing.publicKey,
    brokerSealingKey: identity.sealing.publicKey,
    credentials,
    decide: async (_prompt: Prompt) => decisions.shift() ?? 'denied',
  })
  const helperPort = await listen(helper.server, 0, '127.0.0.1')
  setSetting(db, HELPER_KEY_SETTING, helper.publicKey)
  const telegram = await startFakeTelegram()
  setSetting(db, TELEGRAM_TOKEN_SETTING, TELEGRAM_TOKEN)
  setSetting(db, TELEGRAM_CHAT_SETTING, OWNER_CHAT_ID)

  const workerOptions = { token: WORKER_TOKEN, brokerInternalUrl: '', log, maxSessions: 64 }
  const worker = await createWorker(workerOptions)
  const workerPort = await listen(worker.server, 0, '127.0.0.1')
  const app = createBrokerApp({ db, identity, sites, log, helperUrl: `http://127.0.0.1:${helperPort}`, workerUrl: `http://127.0.0.1:${workerPort}`, workerToken: WORKER_TOKEN, telegramApiUrl: telegram.url })
  workerOptions.brokerInternalUrl = `http://127.0.0.1:${await listen(app.internalServer, 0, '127.0.0.1')}`
  const brokerPort = await listen(app.agentServer, 0, '127.0.0.1')

  const now = Date.now()
  for (const [id, name, token] of [['agt_hermes', 'hermes', AGENT_TOKEN], ['agt_other', 'other', OTHER_AGENT_TOKEN]] as const) {
    db.prepare('INSERT INTO agents (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').run(id, name, sha256(token), now)
  }
  db.prepare('INSERT INTO accounts (id, site_id, username, label, created_at) VALUES (?, ?, ?, ?, ?)').run('test-shop-main', 'test-shop', TEST_USER.email, 'Test shop', now)
  db.prepare('INSERT INTO accounts (id, site_id, username, label, created_at) VALUES (?, ?, ?, ?, ?)').run('manual-shop-main', 'manual-shop', TEST_USER.email, 'Manual shop', now)
  db.prepare('INSERT INTO grants (agent_id, account_id, allow_transactions) VALUES (?, ?, 1)').run('agt_hermes', 'test-shop-main')
  db.prepare('INSERT INTO grants (agent_id, account_id, allow_transactions) VALUES (?, ?, 1)').run('agt_hermes', 'manual-shop-main')

  const brokerUrl = `http://127.0.0.1:${brokerPort}`
  async function connect(agentToken = AGENT_TOKEN) {
    const mcp = createMcpServer({ brokerUrl, agentToken })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await mcp.connect(serverSide)
    const client = new Client({ name: 'hermes-test', version: '0' })
    await client.connect(clientSide)
    return client
  }

  return {
    origin, manualOrigin, shop, db, app, helper, credentials, decisions, telegram, brokerUrl, logLines, connect,
    async stop() {
      await worker.shutdown()
      app.stop()
      app.agentServer.close()
      app.internalServer.close()
      helper.server.close()
      telegram.server.close()
      shop.server.close()
    },
  }
}

export type System = Awaited<ReturnType<typeof startSystem>>

interface Element { ref: string; role: string; name: string; type?: string; filled?: boolean }
/** The union of result fields the tests assert on. */
export interface ToolData {
  sessionId: string; status: string; state: string; approvalId: string; url: string; title: string; text: string
  untrusted: boolean; notice: string; warnings: string[]; elements: Element[]
  blocked?: { url: string; reason: string }[]; transaction?: { status: string; reason: string }
  accounts: Record<string, unknown>[]
}

/** Calls a tool and returns parsed JSON (or the error text) plus the raw MCP payload for leak checks. */
export async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as { type: string; text?: string; data?: string }[]
  const text = content.find((c) => c.type === 'text')?.text ?? ''
  const raw = JSON.stringify(result)
  if (result.isError) return { error: text, raw, data: undefined as unknown as ToolData, image: undefined }
  return { data: JSON.parse(text) as ToolData, raw, error: undefined, image: content.find((c) => c.type === 'image')?.data }
}

/** Finds an element ref in a snapshot by role and name. */
export function ref(snapshot: Pick<ToolData, 'elements'>, role: string, name: string | RegExp): string {
  const match = snapshot.elements.find((e) => e.role === role && (typeof name === 'string' ? e.name === name : name.test(e.name)))
  if (!match) throw new Error(`No ${role} "${name}" in snapshot: ${JSON.stringify(snapshot.elements.map((e) => `${e.role}:${e.name}`))}`)
  return match.ref
}
