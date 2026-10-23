/**
 * Login approval over Telegram, through a bot that belongs to AgentVault rather than Hermes.
 * The broker fetches the decision from Telegram itself, with a bot token the agent never sees,
 * and counts it only when it comes from the configured user in their private chat with the bot.
 * No agent tool reaches this path, so the agent cannot approve its own request.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { APPROVAL_TIMEOUT_MS, type Decision, type LoginRequest } from '../shared/helper-protocol.ts'
import type { Logger } from '../shared/logger.ts'

export interface ChatApprover { approveLogin(req: LoginRequest): Promise<Decision> }
export interface TelegramConfig { token: string; chatId: string }

interface TelegramApproverOptions {
  config: () => TelegramConfig | undefined
  log: Logger
  apiBase?: string
  timeoutMs?: number
}

const POLL_SECONDS = 20

const updatesSchema = z.array(z.object({
  update_id: z.number(),
  callback_query: z.object({
    id: z.string(),
    from: z.object({ id: z.number() }),
    data: z.string().optional(),
    message: z.object({ chat: z.object({ id: z.number() }) }).optional(),
  }).optional(),
}))
const sentSchema = z.object({ message_id: z.number() })

export function createTelegramApprover({ config, log, apiBase = 'https://api.telegram.org', timeoutMs = APPROVAL_TIMEOUT_MS }: TelegramApproverOptions): ChatApprover {
  /** Requests waiting for a tap, keyed by request id. Removed on the first decision, so each is single use. */
  const pending = new Map<string, (decision: Decision) => void>()
  let offset = 0
  let polling = false

  async function api<T extends z.ZodType>(token: string, method: string, body: object, schema: T, timeout = 10_000): Promise<z.infer<T>> {
    const res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    const json = (await res.json()) as { ok?: boolean; result?: unknown }
    // Never include the URL in errors or logs: it carries the bot token.
    if (!json.ok) throw new Error(`telegram ${method} failed with HTTP ${res.status}`)
    return schema.parse(json.result)
  }

  /** One long-poll loop at a time (Telegram rejects concurrent getUpdates), running only while something is pending. */
  async function poll({ token, chatId }: TelegramConfig) {
    polling = true
    try {
      while (pending.size > 0) {
        const updates = await api(token, 'getUpdates', { offset, timeout: POLL_SECONDS, allowed_updates: ['callback_query'] }, updatesSchema, (POLL_SECONDS + 10) * 1000)
          .catch(async () => {
            log.warn({ method: 'getUpdates' }, 'telegram poll failed')
            await sleep(2000)
            return []
          })
        for (const { update_id: updateId, callback_query: query } of updates) {
          offset = updateId + 1
          if (!query) continue
          const [verb, requestId = ''] = (query.data ?? '').split(':')
          const fromOwner = String(query.from.id) === chatId && String(query.message?.chat.id) === chatId
          const decide = fromOwner && (verb === 'approve' || verb === 'deny') ? pending.get(requestId) : undefined
          decide?.(verb === 'approve' ? 'approved' : 'denied')
          void api(token, 'answerCallbackQuery', { callback_query_id: query.id, text: decide ? 'Recorded' : 'This request is no longer pending' }, z.unknown()).catch(() => undefined)
        }
      }
    } finally {
      polling = false
    }
  }

  return {
    async approveLogin(req) {
      const cfg = config()
      if (!cfg) return 'unavailable'
      // Operator-chosen account id instead of the username, so no PII is sent to Telegram.
      const text = [
        `AgentVault: ${req.agent} wants to sign in`,
        `Site: ${req.site.name} (${req.site.origin})`,
        `Account: ${req.account.id}`,
        `Session: ${req.durationMinutes} minutes`,
        `Request: ${req.requestId}`,
      ].join('\n')
      let messageId: number
      try {
        ;({ message_id: messageId } = await api(cfg.token, 'sendMessage', {
          chat_id: cfg.chatId,
          text,
          reply_markup: { inline_keyboard: [[{ text: 'Approve once', callback_data: `approve:${req.requestId}` }, { text: 'Deny', callback_data: `deny:${req.requestId}` }]] },
        }, sentSchema))
      } catch {
        log.warn({ method: 'sendMessage' }, 'telegram approval could not be sent')
        return 'unavailable'
      }

      const decision = await new Promise<Decision>((resolve) => {
        const timer = setTimeout(() => resolve('unavailable'), timeoutMs)
        pending.set(req.requestId, (d) => {
          clearTimeout(timer)
          resolve(d)
        })
        if (!polling) void poll(cfg)
      })
      pending.delete(req.requestId)
      const outcome = { approved: 'Approved once.', denied: 'Denied.', unavailable: 'Expired. Nothing was approved.' }[decision]
      void api(cfg.token, 'editMessageText', { chat_id: cfg.chatId, message_id: messageId, text: `${text}\n\n${outcome}` }, z.unknown()).catch(() => undefined)
      return decision
    },
  }
}
