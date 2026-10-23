import { pino, type Logger } from 'pino'

/**
 * Field names that must never reach a log sink. Secrets should not be passed to
 * the logger at all; this list is the backstop if one slips through.
 */
const REDACT = [
  'password', 'secret', 'token', 'cookie', 'cookies', 'authorization', 'credential', 'sealed',
  'storageState', 'value', 'address', 'paymentMethod',
].flatMap((key) => [key, `*.${key}`, `*.*.${key}`])

export function createLogger(name: string): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT, censor: '[redacted]' },
    // stdio MCP servers must keep stdout clean for the protocol.
  }, pino.destination(name === 'mcp-adapter' ? 2 : 1))
}

export type { Logger }
