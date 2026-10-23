/**
 * Drives the running Docker stack through the real stdio MCP adapter, with a dev helper
 * standing in for the native prompts. Run from the repo root: `pnpm test:docker`.
 *
 * Host phase: provisions an agent, account and helper key via the admin CLI, then re-runs
 * this file inside a container on the host-link network (the "inside" phase) so the broker
 * can reach the helper without depending on host firewall rules.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { TEST_USER } from '../../mock-shop/shop.ts'
import { createDevHelper } from '../../src/dev-helper/helper.ts'
import { generateKeyPair, type KeyPairPem } from '../../src/shared/crypto.ts'
import { listen } from '../../src/shared/http.ts'

const root = join(import.meta.dirname, '../..')
const SHOP = 'http://mock-shop:4000'
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(`FAIL: ${message}`) }
interface Plan { token: string; accountId: string; helperKey: KeyPairPem; brokerKeys: { signing: string; sealing: string } }

if (process.argv[2] === '--inside') await inside(JSON.parse(readFileSync(process.argv[3] ?? '', 'utf8')) as Plan)
else hostPhase()

function hostPhase() {
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { cwd: root, input, encoding: 'utf8' }).trim()
  const compose = ['compose', '-f', 'docker-compose.yml', '-f', 'test/docker/compose.smoke.yml', '--profile', 'dev']
  const admin = (args: string[], input?: string) => docker([...compose, 'exec', '-T', 'broker', 'node', 'src/broker/admin.ts', ...args], input)
  docker([...compose, 'up', '-d', '--wait'])

  const runId = Date.now()
  const helperKey = generateKeyPair()
  const plan: Plan = { token: admin(['agent-add', `smoke-${runId}`]), accountId: `smoke-${runId}`, helperKey, brokerKeys: JSON.parse(admin(['pubkeys'])) }
  admin(['account-add', plan.accountId, '--site', 'test-shop', '--username', TEST_USER.email])
  admin(['grant', `smoke-${runId}`, plan.accountId, '--transactions'])
  admin(['pair-helper'], helperKey.publicKey)

  const dir = mkdtempSync(join(tmpdir(), 'av-smoke-'))
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan), { mode: 0o644 })
  execFileSync('docker', ['run', '--rm', '--name', 'smoke-runner', '--network', 'agentvault_host-link', '-v', `${root}:/repo:ro`, '-v', `${dir}:/plan:ro`, '-w', '/repo',
    'agentvault/broker:local', 'node', 'test/docker/smoke.ts', '--inside', '/plan/plan.json'], { stdio: 'inherit' })

  const logs = docker([...compose, 'logs', 'broker', 'browser-worker'])
  assert(!logs.includes(TEST_USER.password), 'password never appears in container logs')
  console.log('docker smoke: OK (logs clean)')
}

async function inside(plan: Plan) {
  const helper = createDevHelper({
    key: plan.helperKey, brokerSigningKey: plan.brokerKeys.signing, brokerSealingKey: plan.brokerKeys.sealing,
    credentials: new Map([[plan.accountId, { username: TEST_USER.email, password: TEST_USER.password, origin: SHOP }]]),
    decide: async () => 'approved',
  })
  await listen(helper.server, 47800, '0.0.0.0')
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'av-')), 'token')
  writeFileSync(tokenFile, plan.token, { mode: 0o600 })
  const client = new Client({ name: 'smoke', version: '0' })
  await client.connect(new StdioClientTransport({
    command: 'node', args: ['src/mcp-adapter/main.ts'],
    env: { PATH: process.env.PATH ?? '', AGENTVAULT_TOKEN_FILE: tokenFile, AGENTVAULT_BROKER_URL: 'http://broker:7800' },
  }))

  const transcript: string[] = []
  type Snap = Record<string, unknown> & { elements: { ref: string; role: string; name: string }[]; transaction?: { status: string } }
  async function tool(name: string, args: Record<string, unknown> = {}): Promise<Snap> {
    const result = await client.callTool({ name, arguments: args })
    const text = (result.content as { text?: string }[])[0]?.text ?? ''
    transcript.push(text)
    if (result.isError) throw new Error(`${name}: ${text}`)
    return JSON.parse(text) as Snap
  }
  const find = (snap: Snap, role: string, name: string) => {
    const el = snap.elements.find((e) => e.role === role && e.name === name)
    if (!el) throw new Error(`missing ${role} ${name}`)
    return el.ref
  }

  const { sessionId } = await tool('browser_navigate', { url: `${SHOP}/` })
  assert((await tool('request_login', { sessionId, accountId: plan.accountId })).status === 'authenticated', 'login approved and performed')
  await tool('browser_navigate', { sessionId, url: `${SHOP}/product/abc-pant` })
  let snap = await tool('browser_snapshot', { sessionId })
  await tool('browser_select', { sessionId, ref: find(snap, 'select', 'Size'), option: '32' })
  await tool('browser_click', { sessionId, ref: find(snap, 'button', 'Add to basket') })
  await tool('browser_navigate', { sessionId, url: `${SHOP}/checkout` })
  snap = await tool('browser_snapshot', { sessionId })
  assert((await tool('browser_click', { sessionId, ref: find(snap, 'button', 'Place order') })).transaction?.status === 'blocked', 'order blocked before approval')
  assert((await tool('request_transaction_approval', { sessionId })).status === 'approved', 'transaction approved')
  snap = await tool('browser_snapshot', { sessionId })
  assert((await tool('browser_click', { sessionId, ref: find(snap, 'button', 'Place order') })).transaction?.status === 'submitted', 'order submitted after approval')
  assert(String((await tool('browser_snapshot', { sessionId })).text).includes('confirmed'), 'confirmation shown')
  const escape = await tool('browser_navigate', { sessionId, url: 'https://example.com/' }).then(() => 'allowed', () => 'refused')
  assert(escape === 'refused', 'non-allowlisted origin refused')
  await tool('revoke_session', { sessionId })
  assert(!transcript.join('\n').includes(TEST_USER.password), 'password never in tool output')
  console.log('docker smoke (inside): purchase flow OK')
  await client.close()
  helper.server.close()
}
