import { createServer } from 'node:http'
import { listen, readBody } from '../src/shared/http.ts'

export const DISCORD_TOKEN = 'MTAwMDAwMDAwMDAwMDAwMDAw.GabcDe.' + 'd'.repeat(27)
export const OWNER_DISCORD_ID = '100000000000000000'
export const SHARED_CHANNEL = '400000000000000000'
const BOT_ID = '300000000000000000'
const DM_CHANNEL = '200000000000000000'

/** Stands in for the Discord REST API. Tests add reactions to the latest message; the broker polls for them. */
export async function startFakeDiscord() {
  const sent: string[] = []
  /** Channel id of each sent message, by index. */
  const channels: string[] = []
  const mentions: unknown[] = []
  const edits: string[] = []
  /** Ids of messages edited by anyone, the broker included. */
  const edited = new Set<string>()
  const dmRecipients: string[] = []
  /** User ids per `${messageId} ${emoji}`. */
  const reactions = new Map<string, string[]>()
  const react = (messageId: string, emoji: string, userId: string) => {
    const key = `${messageId} ${emoji}`
    reactions.set(key, [...(reactions.get(key) ?? []), userId])
  }

  const server = createServer(async (req, res) => {
    const body = await readBody(req)
    const reply = (status: number, json?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(json === undefined ? undefined : JSON.stringify(json))
    }
    if (req.headers.authorization !== `Bot ${DISCORD_TOKEN}`) return reply(401, { message: '401: Unauthorized' })
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname)
    const route = `${req.method} ${path}`
    const message = /^\/channels\/\d+\/messages\/(\d+)(?:\/reactions\/([^/]+)(\/@me)?)?$/.exec(path)
    const [, messageId = '', emoji = ''] = message ?? []
    const post = /^POST \/channels\/(\d+)\/messages$/.exec(route)

    if (route === 'POST /users/@me/channels') {
      dmRecipients.push((JSON.parse(body) as { recipient_id: string }).recipient_id)
      return reply(200, { id: DM_CHANNEL })
    }
    if (post?.[1]) {
      const { content, allowed_mentions } = JSON.parse(body) as { content: string; allowed_mentions?: unknown }
      channels.push(post[1])
      mentions.push(allowed_mentions)
      return reply(200, { id: String(sent.push(content)) })
    }
    if (req.method === 'PATCH' && message && !emoji) {
      edited.add(messageId)
      return reply(200, { id: messageId, edited: edits.push((JSON.parse(body) as { content: string }).content) })
    }
    if (req.method === 'GET' && message && !emoji) return reply(200, { id: messageId, edited_timestamp: edited.has(messageId) ? new Date().toISOString() : null })
    if (req.method === 'PUT' && message?.[3]) {
      react(messageId, emoji, BOT_ID)
      return reply(204)
    }
    if (req.method === 'GET' && emoji) return reply(200, (reactions.get(`${messageId} ${emoji}`) ?? []).map((id) => ({ id })))
    reply(404, { message: 'Unknown route' })
  })
  const port = await listen(server, 0, '127.0.0.1')

  return {
    url: `http://127.0.0.1:${port}`,
    server, sent, channels, mentions, edits, dmRecipients,
    /** Edits the latest approval message as another holder of the token would. */
    tamper: () => edited.add(String(sent.length)),
    /** Reacts to the latest approval message as `userId`. */
    react(verb: 'approve' | 'deny', userId = OWNER_DISCORD_ID) {
      react(String(sent.length), verb === 'approve' ? '✅' : '❌', userId)
    },
    /** Who reacted to the latest approval message, keyed by emoji. */
    reactionsOnLatest: () => Object.fromEntries(['✅', '❌'].map((e) => [e, reactions.get(`${sent.length} ${e}`) ?? []])),
  }
}
