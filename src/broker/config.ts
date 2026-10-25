import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { generateIdentity, type Identity } from '../shared/crypto.ts'
import { loadSites } from '../shared/sites.ts'
import { openDb } from './db.ts'

const root = join(import.meta.dirname, '../..')

export const brokerConfig = {
  dataDir: process.env.DATA_DIR ?? join(root, 'data'),
  sitesDir: process.env.SITES_DIR ?? join(root, 'sites'),
  migrationsDir: join(root, 'migrations'),
  helperUrl: process.env.HELPER_URL ?? 'http://host.docker.internal:47800',
  workerUrl: process.env.WORKER_URL ?? 'http://browser-worker:7900',
  workerTokenFile: process.env.WORKER_TOKEN_FILE ?? '/run/secrets/worker_token',
  agentPort: Number(process.env.AGENT_PORT ?? 7800),
  internalPort: Number(process.env.INTERNAL_PORT ?? 7801),
}

/** The broker's keys live only in its own data volume, never on the macOS filesystem. */
export function loadOrCreateIdentity(path: string): Identity {
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Identity
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const identity = generateIdentity()
  writeFileSync(path, JSON.stringify(identity), { mode: 0o600, flag: 'wx' })
  return identity
}

export function openBrokerState() {
  mkdirSync(brokerConfig.dataDir, { recursive: true, mode: 0o700 })
  return {
    db: openDb(join(brokerConfig.dataDir, 'agentvault.db'), brokerConfig.migrationsDir),
    identity: loadOrCreateIdentity(join(brokerConfig.dataDir, 'keys', 'identity.json')),
    sites: loadSites(brokerConfig.sitesDir),
  }
}

export const HELPER_KEY_SETTING = 'helper_public_key'
/** Bot for chat login approvals. The provider set up last is active. Telegram's must be AgentVault's own; Discord may reuse Hermes' bot when it posts in a channel (ADR 0009). */
export const CHAT_PROVIDER_SETTING = 'chat_provider'
export const TELEGRAM_TOKEN_SETTING = 'telegram_bot_token'
export const TELEGRAM_CHAT_SETTING = 'telegram_chat_id'
export const DISCORD_TOKEN_SETTING = 'discord_bot_token'
export const DISCORD_USER_SETTING = 'discord_user_id'
/** Optional; without it the bot DMs the user. */
export const DISCORD_CHANNEL_SETTING = 'discord_channel_id'
