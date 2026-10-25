/**
 * Administrative commands. Runs inside the broker container via `docker compose exec`,
 * so it is reachable only by someone with access to the Docker runtime, never over the network.
 * The host-side `agentvault` CLI wraps these.
 */
import { createPublicKey, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { opaqueId, sha256 } from '../shared/ids.ts'
import { CHAT_PROVIDER_SETTING, DISCORD_CHANNEL_SETTING, DISCORD_TOKEN_SETTING, DISCORD_USER_SETTING, HELPER_KEY_SETTING, TELEGRAM_CHAT_SETTING, TELEGRAM_TOKEN_SETTING, openBrokerState } from './config.ts'
import { APPROVAL_MODES, isApprovalMode } from '../shared/approval.ts'
import { deleteSetting, setSetting } from './db.ts'

const [command = 'help', ...rest] = process.argv.slice(2)
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    site: { type: 'string' }, username: { type: 'string' }, label: { type: 'string' }, 'max-minutes': { type: 'string' },
    transactions: { type: 'boolean', default: false }, approval: { type: 'string', default: 'prompt' }, 'chat-id': { type: 'string' }, 'user-id': { type: 'string' }, 'channel-id': { type: 'string' }, limit: { type: 'string', default: '50' }, event: { type: 'string' }, json: { type: 'boolean', default: false },
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
  case 'account-remove': {
    // Sessions keep their history but must stop referencing the account, or the foreign key blocks the delete.
    const id = need(positionals[0], '<account-id>')
    db.exec('BEGIN')
    try {
      db.prepare("UPDATE sessions SET state = 'revoked' WHERE account_id = ? AND state IN ('anonymous', 'authenticated')").run(id)
      db.prepare('UPDATE sessions SET account_id = NULL WHERE account_id = ?').run(id)
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    break
  }
  case 'grant': {
    const [agentName, accountId] = [need(positionals[0], '<agent>'), need(positionals[1], '<account-id>')]
    const agent = db.prepare('SELECT id FROM agents WHERE name = ?').get(agentName) as { id: string } | undefined
    if (!agent) fail(`Unknown agent ${agentName}`)
    const { approval } = values
    if (!isApprovalMode(approval)) fail(`--approval must be one of ${APPROVAL_MODES.join(', ')}`)
    db.prepare('INSERT INTO grants (agent_id, account_id, allow_transactions, approval) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET allow_transactions = excluded.allow_transactions, approval = excluded.approval')
      .run(agent?.id ?? '', accountId, values.transactions ? 1 : 0, approval)
    break
  }
  case 'grants':
    console.table(db.prepare('SELECT ag.name AS agent, g.account_id, g.allow_transactions, g.approval FROM grants g JOIN agents ag ON ag.id = g.agent_id ORDER BY ag.name, g.account_id').all())
    break
  case 'chat-telegram': {
    const chatId = need(values['chat-id'], '--chat-id')
    if (!/^\d{1,20}$/.test(chatId)) fail('--chat-id must be your numeric Telegram user id')
    const token = readFileSync(0, 'utf8').trim()
    if (!/^\d+:[\w-]{30,}$/.test(token)) fail('Expected a Telegram bot token on stdin')
    setSetting(db, TELEGRAM_TOKEN_SETTING, token)
    setSetting(db, TELEGRAM_CHAT_SETTING, chatId)
    setSetting(db, CHAT_PROVIDER_SETTING, 'telegram')
    console.log('Telegram approvals configured')
    break
  }
  case 'chat-discord': {
    const userId = need(values['user-id'], '--user-id')
    if (!/^\d{17,20}$/.test(userId)) fail('--user-id must be your numeric Discord user id')
    const channelId = values['channel-id']
    if (channelId !== undefined && !/^\d{17,20}$/.test(channelId)) fail('--channel-id must be a numeric Discord channel id')
    const token = readFileSync(0, 'utf8').trim()
    if (!/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(token)) fail('Expected a Discord bot token on stdin')
    setSetting(db, DISCORD_TOKEN_SETTING, token)
    setSetting(db, DISCORD_USER_SETTING, userId)
    if (channelId) setSetting(db, DISCORD_CHANNEL_SETTING, channelId)
    else deleteSetting(db, DISCORD_CHANNEL_SETTING)
    setSetting(db, CHAT_PROVIDER_SETTING, 'discord')
    console.log(`Discord approvals configured (${channelId ? `channel ${channelId}` : 'direct messages'})`)
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
          account-remove <id> | grant <agent> <account> [--transactions] [--approval prompt|chat|auto] | revoke-grant <agent> <account>
          grants | chat-telegram --chat-id <id> | chat-discord --user-id <id> [--channel-id <id>] (bot token on stdin)
          pubkeys | pair-helper (PEM on stdin) | sites | accounts | sessions | audit [--event] [--limit] [--json]`)
}
db.close()
