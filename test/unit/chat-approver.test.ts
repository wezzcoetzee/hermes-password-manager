import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDiscordApprover } from '../../src/broker/discord-approver.ts'
import { createTelegramApprover } from '../../src/broker/telegram-approver.ts'
import type { LoginRequest } from '../../src/shared/helper-protocol.ts'
import { DISCORD_TOKEN, OWNER_DISCORD_ID, startFakeDiscord } from '../fake-discord.ts'
import { OWNER_CHAT_ID, TELEGRAM_TOKEN, startFakeTelegram, waitFor } from '../fake-telegram.ts'

const log = pino({ level: 'silent' })
const request: LoginRequest = {
  requestId: 'req_' + 'a'.repeat(24), agent: 'hermes', site: { name: 'Shop', origin: 'https://shop.example' },
  account: { id: 'shop-main', username: 'someone@example.test' }, durationMinutes: 15, unattended: true,
}

let telegram: Awaited<ReturnType<typeof startFakeTelegram>>
let discord: Awaited<ReturnType<typeof startFakeDiscord>>
beforeAll(async () => { [telegram, discord] = await Promise.all([startFakeTelegram(), startFakeDiscord()]) })
afterAll(() => {
  telegram.server.close()
  discord.server.close()
})

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

describe('discord approver', () => {
  const approver = (timeoutMs = 5000, apiBase = discord.url) =>
    createDiscordApprover({ log, apiBase, timeoutMs, pollMs: 10, config: () => ({ token: DISCORD_TOKEN, userId: OWNER_DISCORD_ID }) })

  /** Starts an approval and waits until its DM is sent with both reactions in place. Wrapped so awaiting this does not await the decision. */
  async function prompt(timeoutMs?: number) {
    const sent = discord.sent.length
    const decision = approver(timeoutMs).approveLogin(request)
    await waitFor(() => discord.sent.length > sent && discord.reactionsOnLatest()['❌']?.length === 1)
    return { decision }
  }

  it("DMs the owner and counts only the owner's reaction", async () => {
    const { decision } = await prompt()
    expect(discord.dmRecipients.at(-1)).toBe(OWNER_DISCORD_ID)
    expect(discord.sent.at(-1)).toContain('Account: shop-main')
    expect(discord.sent.at(-1)).not.toContain('someone@example.test')

    discord.react('approve', '999999999999999999')
    await new Promise((r) => setTimeout(r, 50))
    discord.react('approve')
    expect(await decision).toBe('approved')
    await expect.poll(() => discord.edits.at(-1)).toMatch(/Approved once\.$/)
  })

  it('treats both reactions as a denial', async () => {
    const { decision } = await prompt()
    discord.react('approve')
    discord.react('deny')
    expect(await decision).toBe('denied')
  })

  it('expires to unavailable when nobody reacts, and says so in the DM', async () => {
    expect(await (await prompt(200)).decision).toBe('unavailable')
    await expect.poll(() => discord.edits.at(-1)).toMatch(/Expired\. Nothing was approved\.$/)
  })

  it('fails closed when the Discord API is unreachable', async () => {
    expect(await approver(5000, 'http://127.0.0.1:1').approveLogin(request)).toBe('unavailable')
  })
})
