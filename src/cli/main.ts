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
const twoWord = argv[0] === 'agent' || argv[0] === 'credential'
const command = argv.slice(0, twoWord ? 2 : 1).join(' ')
const rest = argv.slice(twoWord ? 2 : 1)
const { values, positionals } = parseArgs({
  args: rest, allowPositionals: true, strict: false,
  options: { site: { type: 'string' }, username: { type: 'string' }, label: { type: 'string' }, transactions: { type: 'boolean' }, agent: { type: 'string' } },
})

const agent = typeof values.agent === 'string' ? values.agent : 'hermes'
const optional = (flag: string, value: unknown) => (typeof value === 'string' ? [flag, value] : [])

function siteOrigin(siteId: string): string {
  const sites = JSON.parse(admin(['sites'])) as Record<string, string>
  const origin = sites[siteId]
  if (!origin) throw new Error(`Unknown site ${siteId}. Known: ${Object.keys(sites).join(', ')}`)
  return origin
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
    if (!id) throw new Error('Usage: agentvault grant <account-id> [--transactions] [--agent hermes]')
    admin(['grant', agent, id, ...(values.transactions ? ['--transactions'] : [])])
    console.log(`Granted ${agent} access to ${id}${values.transactions ? ' (transactions allowed, each one still needs your approval)' : ''}`)
    break
  }
  case 'revoke': {
    const id = positionals[0]
    if (!id) throw new Error('Usage: agentvault revoke <account-id> [--agent hermes]')
    admin(['revoke-grant', agent, id])
    break
  }
  case 'audit':
  case 'sessions':
  case 'accounts':
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
  grant <id> [--transactions] [--agent name]         allow an agent to use an account
  revoke <id> [--agent name]                         remove that permission
  audit [--event e] [--limit n] [--json]             show audit events
  sessions | accounts | status`)
}
