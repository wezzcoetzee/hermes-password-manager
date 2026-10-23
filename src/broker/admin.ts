/**
 * Administrative commands. Runs inside the broker container via `docker compose exec`,
 * so it is reachable only by someone with access to the Docker runtime, never over the network.
 * The host-side `agentvault` CLI wraps these.
 */
import { createPublicKey, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { opaqueId, sha256 } from '../shared/ids.ts'
import { HELPER_KEY_SETTING, openBrokerState } from './config.ts'
import { setSetting } from './db.ts'

const [command = 'help', ...rest] = process.argv.slice(2)
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    site: { type: 'string' }, username: { type: 'string' }, label: { type: 'string' }, 'max-minutes': { type: 'string' },
    transactions: { type: 'boolean', default: false }, limit: { type: 'string', default: '50' }, event: { type: 'string' }, json: { type: 'boolean', default: false },
  },
})
const { db, identity, sites } = openBrokerState()
const now = Date.now()
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
const need = (value: string | undefined, name: string) => value ?? fail(`Missing ${name}`)

switch (command) {
  case 'agent-add': {
    const name = need(positionals[0], '<name>')
    const token = randomBytes(32).toString('base64url')
    db.prepare('INSERT INTO agents (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').run(opaqueId('agt'), name, sha256(token), now)
    console.log(token) // printed once; the installer writes it straight to a 0600 file
    break
  }
  case 'agent-disable':
    db.prepare('UPDATE agents SET disabled = 1 WHERE name = ?').run(need(positionals[0], '<name>'))
    break
  case 'account-add': {
    const id = need(positionals[0], '<account-id>')
    const site = need(values.site, '--site')
    if (!sites.has(site)) fail(`Unknown site ${site}. Known: ${[...sites.keys()].join(', ')}`)
    db.prepare('INSERT INTO accounts (id, site_id, username, label, max_session_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, site, need(values.username, '--username'), values.label ?? id, Number(values['max-minutes'] ?? 60), now)
    console.log(JSON.stringify({ id, origin: sites.get(site)?.origin }))
    break
  }
  case 'account-remove':
    db.prepare('DELETE FROM accounts WHERE id = ?').run(need(positionals[0], '<account-id>'))
    break
  case 'grant': {
    const [agentName, accountId] = [need(positionals[0], '<agent>'), need(positionals[1], '<account-id>')]
    const agent = db.prepare('SELECT id FROM agents WHERE name = ?').get(agentName) as { id: string } | undefined
    if (!agent) fail(`Unknown agent ${agentName}`)
    db.prepare('INSERT INTO grants (agent_id, account_id, allow_transactions) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET allow_transactions = excluded.allow_transactions')
      .run(agent?.id ?? '', accountId, values.transactions ? 1 : 0)
    break
  }
  case 'revoke-grant':
    db.prepare('DELETE FROM grants WHERE agent_id = (SELECT id FROM agents WHERE name = ?) AND account_id = ?').run(need(positionals[0], '<agent>'), need(positionals[1], '<account-id>'))
    break
  case 'pubkeys':
    console.log(JSON.stringify({ signing: identity.signing.publicKey, sealing: identity.sealing.publicKey }))
    break
  case 'pair-helper': {
    const pem = readFileSync(0, 'utf8').trim()
    createPublicKey(pem) // reject anything that is not a valid public key
    setSetting(db, HELPER_KEY_SETTING, pem)
    console.log('Helper key pinned')
    break
  }
  case 'sites':
    console.log(JSON.stringify(Object.fromEntries([...sites.values()].map((site) => [site.id, site.origin]))))
    break
  case 'accounts':
    console.table(db.prepare('SELECT id, site_id, label, max_session_minutes FROM accounts').all())
    break
  case 'sessions':
    console.table(db.prepare('SELECT id, site_id, account_id, state, datetime(expires_at / 1000, \'unixepoch\') AS expires FROM sessions ORDER BY created_at DESC LIMIT 20').all())
    break
  case 'audit': {
    const rows = db.prepare(`SELECT datetime(ts / 1000, 'unixepoch') AS time, event, outcome, agent_id, session_id, account_id, detail FROM audit_events
      ${values.event ? 'WHERE event = ?' : ''} ORDER BY id DESC LIMIT ?`).all(...(values.event ? [values.event] : []), Number(values.limit))
    if (values.json) console.log(JSON.stringify(rows, null, 2))
    else console.table(rows)
    break
  }
  default:
    console.log(`Commands: agent-add <name> | agent-disable <name> | account-add <id> --site --username [--label] [--max-minutes]
          account-remove <id> | grant <agent> <account> [--transactions] | revoke-grant <agent> <account>
          pubkeys | pair-helper (PEM on stdin) | sites | accounts | sessions | audit [--event] [--limit] [--json]`)
}
db.close()
