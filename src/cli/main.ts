#!/usr/bin/env node
/**
 * Host-side `agentvault` CLI. Secrets never pass through here: passwords are
 * typed into the native helper's own UI, and broker admin commands run inside
 * the broker container.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { APPROVAL_MODES, isApprovalMode } from '../shared/approval.ts'
import { ask } from '../shared/tty.ts'

const root = join(import.meta.dirname, '../..')
const home = process.env.AGENTVAULT_HOME ?? join(homedir(), '.agentvault')
// The Swift helper on macOS; set AGENTVAULT_HELPER="node src/dev-helper/main.ts" for Linux development.
const helperCommand = (process.env.AGENTVAULT_HELPER ?? join(home, 'bin', 'AgentVaultHelper.app', 'Contents', 'MacOS', 'AgentVaultHelper')).split(' ')

const run = (cmd: string[], input?: string, inherit = false) => {
  const [bin = '', ...args] = cmd
  if (inherit) {
    const result = spawnSync(bin, args, { cwd: root, stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
    return ''
  }
  return execFileSync(bin, args, { cwd: root, input, encoding: 'utf8', stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'inherit'] }).trim()
}
const admin = (args: string[], input?: string) => run(['docker', 'compose', 'exec', '-T', 'broker', 'node', 'src/broker/admin.ts', ...args], input)
const helper = (args: string[], input?: string, inherit = false) => run([...helperCommand, ...args], input, inherit)

const argv = process.argv.slice(2)
const twoWord = argv[0] === 'agent' || argv[0] === 'credential' || argv[0] === 'chat'
const command = argv.slice(0, twoWord ? 2 : 1).join(' ')
const rest = argv.slice(twoWord ? 2 : 1)
const { values, positionals } = parseArgs({
  args: rest, allowPositionals: true, strict: false,
  options: {
    site: { type: 'string' }, username: { type: 'string' }, label: { type: 'string' }, transactions: { type: 'boolean' }, agent: { type: 'string' },
    approval: { type: 'string' }, 'chat-id': { type: 'string' },
  },
})

const agent = typeof values.agent === 'string' ? values.agent : 'hermes'
const optional = (flag: string, value: unknown) => (typeof value === 'string' ? [flag, value] : [])

function siteOrigin(siteId: string): string {
  const sites = JSON.parse(admin(['sites'])) as Record<string, string>
  const origin = sites[siteId]
  if (!origin) throw new Error(`Unknown site ${siteId}. Known: ${Object.keys(sites).join(', ')}`)
  return origin
}

/**
 * The helper keeps its own per-account flag, so a chat or auto grant in the broker alone never
 * releases a password without a prompt. Turning it on asks for confirmation in the helper's UI.
 */
function setUnattended(accountId: string, on: boolean) {
  if (on) return helper(['unattended', '--account', accountId], undefined, true)
  // Clearing is best effort: the credential may already be gone, and a prompt grant never asks for unattended release.
  const [bin = '', ...args] = helperCommand
  const result = spawnSync(bin, [...args, 'unattended', '--account', accountId, '--off'], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) console.warn(`Could not clear the unattended flag for ${accountId} in the helper.`)
}

switch (command) {
  case 'agent add': {
    const name = positionals[0] ?? 'hermes'
    const token = admin(['agent-add', name])
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const file = join(home, name === 'hermes' ? 'agent-token' : `agent-token-${name}`)
    writeFileSync(file, token, { mode: 0o600 })
    chmodSync(file, 0o600)
    console.log(`Agent ${name} created; token written to ${file}`)
    break
  }
  case 'pair': {
    const helperKey = helper(['pair'], admin(['pubkeys']))
    console.log(admin(['pair-helper'], helperKey))
    break
  }
  case 'credential add': {
    const id = positionals[0]
    if (!id || typeof values.site !== 'string') throw new Error('Usage: agentvault credential add <account-id> --site <site-id> [--username <u>] [--label <l>]')
    const origin = siteOrigin(values.site)
    // The helper collects the password in its own trusted UI and stores it in the Keychain.
    const enrolled = JSON.parse(helper(['enroll', '--account', id, '--origin', origin, ...optional('--username', values.username)])) as { username: string }
    admin(['account-add', id, '--site', values.site, '--username', enrolled.username, ...optional('--label', values.label)])
    console.log(`Enrolled ${id} for ${origin}. Grant it with: agentvault grant ${id} [--transactions]`)
    break
  }
  case 'credential rotate': {
    const id = positionals[0]
    if (!id || typeof values.site !== 'string') throw new Error('Usage: agentvault credential rotate <account-id> --site <site-id>')
    helper(['enroll', '--account', id, '--origin', siteOrigin(values.site), ...optional('--username', values.username)])
    console.log(`Rotated ${id}`)
    break
  }
  case 'credential remove': {
    const id = positionals[0]
    if (!id) throw new Error('Usage: agentvault credential remove <account-id>')
    helper(['delete', '--account', id])
    admin(['account-remove', id])
    console.log(`Removed ${id}`)
    break
  }
  case 'grant': {
    const id = positionals[0]
    const approval = values.approval ?? 'prompt'
    if (!id || !isApprovalMode(approval)) {
      throw new Error(`Usage: agentvault grant <account-id> [--transactions] [--approval ${APPROVAL_MODES.join('|')}] [--agent hermes]`)
    }
    const unattended = approval !== 'prompt'
    if (unattended) setUnattended(id, true)
    try {
      admin(['grant', agent, id, ...(values.transactions ? ['--transactions'] : []), '--approval', approval])
    } catch (err) {
      if (unattended) setUnattended(id, false)
      throw err
    }
    if (values.approval === 'prompt') setUnattended(id, false)
    const logins = { prompt: 'on this Mac', chat: 'in Telegram', auto: 'automatically, without asking' }[approval]
    console.log(`Granted ${agent} access to ${id}; logins are approved ${logins}${values.transactions ? '. Transactions allowed, each one still needs your approval on this Mac' : ''}`)
    break
  }
  case 'revoke': {
    const id = positionals[0]
    if (!id) throw new Error('Usage: agentvault revoke <account-id> [--agent hermes]')
    admin(['revoke-grant', agent, id])
    setUnattended(id, false)
    break
  }
  case 'chat telegram': {
    const chatId = values['chat-id']
    if (typeof chatId !== 'string') throw new Error('Usage: agentvault chat telegram --chat-id <your numeric Telegram user id>')
    // The token goes straight to the broker's store and is never echoed or written on the host.
    console.log(admin(['chat-telegram', '--chat-id', chatId], await ask('AgentVault bot token (hidden): ', true)))
    break
  }
  case 'audit':
  case 'sessions':
  case 'accounts':
  case 'grants':
    run(['docker', 'compose', 'exec', '-T', 'broker', 'node', 'src/broker/admin.ts', command, ...rest], undefined, true)
    break
  case 'status':
    run(['docker', 'compose', 'ps'], undefined, true)
    console.log(existsSync(join(home, 'agent-token')) ? 'Agent token: present' : 'Agent token: missing (run `agentvault agent add hermes`)')
    break
  default:
    console.log(`agentvault <command>
  agent add [name]                                   create an agent and write its token to ~/.agentvault
  pair                                               exchange keys between the broker and the native helper
  credential add <id> --site <site> [--username u]   enroll a credential (password typed into the native helper)
  credential rotate <id> --site <site>               replace a stored password
  credential remove <id>                             delete from Keychain and the broker
  grant <id> [--transactions] [--approval mode]      allow an agent to use an account; [--agent name]
                                                     login approval: prompt (default), chat or auto
  revoke <id> [--agent name]                         remove that permission
  chat telegram --chat-id <id>                       set up AgentVault's own bot for chat approvals
  audit [--event e] [--limit n] [--json]             show audit events
  sessions | accounts | grants | status`)
}
