import { setTimeout as sleep } from 'node:timers/promises'
import { jsonServer, listen, parseJson } from '../src/shared/http.ts'

export const TELEGRAM_TOKEN = '123456:' + 'f'.repeat(35)
export const OWNER_CHAT_ID = '424242'

interface Sent { chat_id: string; text: string; reply_markup: { inline_keyboard: { callback_data: string }[][] } }

/** Stands in for the Telegram Bot API. Tests queue button taps; the broker long-polls for them. */
export async function startFakeTelegram() {
  const sent: Sent[] = []
  const edits: string[] = []
  const answers: string[] = []
  const updates: { update_id: number; callback_query: object }[] = []
  const ok = (result: unknown) => ({ ok: true, result })
  const method = (name: string) => `POST /bot${TELEGRAM_TOKEN}/${name}`

  const server = jsonServer({
    [method('sendMessage')]: async (_req, body) => ok({ message_id: sent.push(parseJson(body) as Sent) }),
    [method('getUpdates')]: async (_req, body) => {
      const { offset = 0 } = parseJson(body) as { offset?: number }
      await sleep(20)
      return ok(updates.filter((u) => u.update_id >= offset))
    },
    [method('answerCallbackQuery')]: async (_req, body) => ok(answers.push((parseJson(body) as { text: string }).text)),
    [method('editMessageText')]: async (_req, body) => ok(edits.push((parseJson(body) as { text: string }).text)),
  }, (err) => console.error('fake telegram error', err))
  const port = await listen(server, 0, '127.0.0.1')

  return {
    url: `http://127.0.0.1:${port}`,
    server, sent, edits, answers,
    /** Taps a button on the latest approval message, as `fromId` in `fromId`'s private chat. */
    tap(verb: 'approve' | 'deny', fromId = OWNER_CHAT_ID) {
      const requestId = sent.at(-1)?.reply_markup.inline_keyboard[0]?.[0]?.callback_data.split(':')[1]
      updates.push({ update_id: updates.length + 1, callback_query: { id: `cb${updates.length}`, from: { id: Number(fromId) }, data: `${verb}:${requestId}`, message: { chat: { id: Number(fromId) } } } })
    },
  }
}

export async function waitFor(condition: () => boolean, timeoutMs = 5000) {
  for (const start = Date.now(); !condition(); await sleep(10)) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
  }
}
