/**
 * Discord chat approval through reactions instead of buttons. Button clicks reach a bot only over the
 * Gateway WebSocket or a public interactions endpoint, but reactions can be read with outbound REST
 * calls. The bot DMs the configured user, adds ✅ and ❌, and polls who reacted (ADR 0008).
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { APPROVAL_TIMEOUT_MS, type Decision } from '../shared/helper-protocol.ts'
import type { Logger } from '../shared/logger.ts'
import { approvalOutcome, approvalPrompt, type ChatApprover } from './chat-approver.ts'

export interface DiscordConfig { token: string; userId: string }

interface DiscordApproverOptions {
  config: () => DiscordConfig | undefined
  log: Logger
  apiBase?: string
  timeoutMs?: number
  pollMs?: number
}

const APPROVE = '✅'
const DENY = '❌'
const idSchema = z.object({ id: z.string() })
const usersSchema = z.array(idSchema)

export function createDiscordApprover({ config, log, apiBase = 'https://discord.com/api/v10', timeoutMs = APPROVAL_TIMEOUT_MS, pollMs = 2000 }: DiscordApproverOptions): ChatApprover {
  return {
    async approveLogin(req) {
      const cfg = config()
      if (!cfg) return 'unavailable'
      const { token, userId } = cfg

      async function api(method: string, path: string, body?: object): Promise<unknown> {
        const res = await fetch(`${apiBase}${path}`, {
          method,
          headers: {
            authorization: `Bot ${token}`,
            'user-agent': 'DiscordBot (https://github.com/wezzcoetzee/hermes-password-manager, 1)',
            ...(body && { 'content-type': 'application/json' }),
          },
          body: body && JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) throw new Error(`discord ${method} failed with HTTP ${res.status}`)
        return res.status === 204 ? undefined : res.json()
      }

      const text = approvalPrompt(req)
      let messagePath: string
      try {
        const { id: channel } = idSchema.parse(await api('POST', '/users/@me/channels', { recipient_id: userId }))
        const { id: message } = idSchema.parse(await api('POST', `/channels/${channel}/messages`, { content: `${text}\n\nReact ${APPROVE} to approve once or ${DENY} to deny.` }))
        messagePath = `/channels/${channel}/messages/${message}`
        // One at a time: Discord rate-limits reactions on a message.
        for (const emoji of [APPROVE, DENY]) await api('PUT', `${messagePath}/reactions/${encodeURIComponent(emoji)}/@me`)
      } catch {
        log.warn({ provider: 'discord' }, 'discord approval could not be sent')
        return 'unavailable'
      }

      const reactedByOwner = async (emoji: string) =>
        usersSchema.parse(await api('GET', `${messagePath}/reactions/${encodeURIComponent(emoji)}?limit=100`)).some(({ id }) => id === userId)

      let decision: Decision = 'unavailable'
      for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(Math.min(pollMs, deadline - Date.now()))) {
        try {
          // Deny is checked first, so reacting with both fails closed.
          if (await reactedByOwner(DENY)) decision = 'denied'
          else if (await reactedByOwner(APPROVE)) decision = 'approved'
        } catch {
          log.warn({ provider: 'discord' }, 'discord poll failed')
        }
        if (decision !== 'unavailable') break
      }

      void api('PATCH', messagePath, { content: `${text}\n\n${approvalOutcome[decision]}` }).catch(() => undefined)
      return decision
    },
  }
}
