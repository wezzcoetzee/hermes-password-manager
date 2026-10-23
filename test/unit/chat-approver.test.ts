import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTelegramApprover } from '../../src/broker/chat-approver.ts'
import type { LoginRequest } from '../../src/shared/helper-protocol.ts'
import { OWNER_CHAT_ID, TELEGRAM_TOKEN, startFakeTelegram } from '../fake-telegram.ts'

const log = pino({ level: 'silent' })
const request: LoginRequest = {
  requestId: 'req_' + 'a'.repeat(24), agent: 'hermes', site: { name: 'Shop', origin: 'https://shop.example' },
  account: { id: 'shop-main', username: 'someone@example.test' }, durationMinutes: 15, unattended: true,
}

let telegram: Awaited<ReturnType<typeof startFakeTelegram>>
beforeAll(async () => { telegram = await startFakeTelegram() })
afterAll(() => { telegram.server.close() })

describe('telegram approver', () => {
  it('expires to unavailable when nobody taps, and says so in the chat', async () => {
    const approver = createTelegramApprover({ log, apiBase: telegram.url, timeoutMs: 200, config: () => ({ token: TELEGRAM_TOKEN, chatId: OWNER_CHAT_ID }) })
    expect(await approver.approveLogin(request)).toBe('unavailable')
    await expect.poll(() => telegram.edits.at(-1)).toMatch(/Expired\. Nothing was approved\.$/)
  })

  it('fails closed when the Telegram API is unreachable', async () => {
    const approver = createTelegramApprover({ log, apiBase: 'http://127.0.0.1:1', config: () => ({ token: TELEGRAM_TOKEN, chatId: OWNER_CHAT_ID }) })
    expect(await approver.approveLogin(request)).toBe('unavailable')
  })
})
