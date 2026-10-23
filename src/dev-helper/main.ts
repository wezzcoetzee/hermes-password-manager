#!/usr/bin/env node
/**
 * Dev helper CLI for Linux and CI. Same commands as the Swift helper:
 *   pair (broker keys JSON on stdin) | enroll --account --origin --username | delete --account | serve
 * Stores credentials in a plaintext JSON file, so it refuses to run without
 * AGENTVAULT_DEV_HELPER=1. Use fake credentials only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { generateKeyPair, type KeyPairPem } from '../shared/crypto.ts'
import type { Credential, Decision } from '../shared/helper-protocol.ts'
import { listen } from '../shared/http.ts'
import { createDevHelper, type Prompt } from './helper.ts'

if (process.env.AGENTVAULT_DEV_HELPER !== '1') {
  console.error('The dev helper stores credentials in plaintext and is for fake test credentials only. Set AGENTVAULT_DEV_HELPER=1 to use it.')
  process.exit(1)
}

const dir = join(process.env.AGENTVAULT_HOME ?? join(homedir(), '.agentvault'), 'dev-helper')
mkdirSync(dir, { recursive: true, mode: 0o700 })
const file = (name: string) => join(dir, name)
const readJson = <T>(name: string, fallback: T): T => (existsSync(file(name)) ? (JSON.parse(readFileSync(file(name), 'utf8')) as T) : fallback)
const writeJson = (name: string, value: unknown) => writeFileSync(file(name), JSON.stringify(value, null, 2), { mode: 0o600 })

type Store = Record<string, Credential & { origin: string }>
const key = readJson<KeyPairPem | null>('key.json', null) ?? (() => {
  const created = generateKeyPair()
  writeJson('key.json', created)
  return created
})()

const [command, ...rest] = process.argv.slice(2)
const { values } = parseArgs({ args: rest, options: { account: { type: 'string' }, origin: { type: 'string' }, username: { type: 'string' } } })

async function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined
  const answer = await rl.question(question)
  rl.close()
  if (hidden) process.stdout.write('\n')
  return answer.trim()
}

function describe(prompt: Prompt): string {
  if (prompt.kind === 'login') {
    const r = prompt.request
    return `\n[AgentVault] ${r.agent} wants to sign in\n  Site:     ${r.site.name} (${r.site.origin})\n  Account:  ${r.account.username}\n  Duration: ${r.durationMinutes} min\n`
  }
  const { summary: s, agent } = prompt.request
  return `\n[AgentVault] ${agent} wants to place an order\n  Merchant: ${s.merchant}\n${s.items.map((i) => `  Item:     ${i.name} (${i.variant}) x${i.quantity} @ ${i.unitPrice}`).join('\n')}\n  Shipping: ${s.shipping}\n  Total:    ${s.total} ${s.currency}\n  Deliver:  ${s.address}\n  Payment:  ${s.paymentMethod}\n`
}

switch (command) {
  case 'pair': {
    const brokerKeys = JSON.parse(readFileSync(0, 'utf8')) as { signing: string; sealing: string }
    writeJson('broker-keys.json', brokerKeys)
    process.stdout.write(key.publicKey)
    break
  }
  case 'enroll': {
    if (!values.account || !values.origin) throw new Error('enroll needs --account and --origin')
    const username = values.username ?? await ask('Username: ')
    const password = await ask('Password (hidden): ', true)
    writeJson('credentials.json', { ...readJson<Store>('credentials.json', {}), [values.account]: { username, password, origin: new URL(values.origin).origin } })
    console.log(JSON.stringify({ account: values.account, username }))
    break
  }
  case 'delete': {
    const store = readJson<Store>('credentials.json', {})
    writeJson('credentials.json', Object.fromEntries(Object.entries(store).filter(([id]) => id !== values.account)))
    break
  }
  case 'serve': {
    const brokerKeys = readJson<{ signing: string; sealing: string } | null>('broker-keys.json', null)
    if (!brokerKeys) throw new Error('Not paired. Run `agentvault pair` first.')
    const helper = createDevHelper({
      key, brokerSigningKey: brokerKeys.signing, brokerSealingKey: brokerKeys.sealing,
      credentials: new Map(Object.entries(readJson<Store>('credentials.json', {}))),
      async decide(prompt): Promise<Decision> {
        if (!process.stdin.isTTY) return 'unavailable' // nobody is there to ask: never approve silently
        console.log(describe(prompt))
        return (await ask('Approve once? [y/N] ')).toLowerCase() === 'y' ? 'approved' : 'denied'
      },
    })
    const host = process.env.HELPER_BIND ?? '127.0.0.1'
    console.log(`dev helper listening on ${host}:${await listen(helper.server, Number(process.env.HELPER_PORT ?? 47800), host)}`)
    break
  }
  default:
    console.log('Usage: pair | enroll --account <id> --origin <url> [--username <u>] | delete --account <id> | serve')
}
