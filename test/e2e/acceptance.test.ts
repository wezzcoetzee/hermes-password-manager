/**
 * MVP acceptance: "go to the test shop, find black pants in size 32, and buy them",
 * driven exactly as Hermes would, through the MCP tools.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_USER } from '../../mock-shop/shop.ts'
import { call, ref, startSystem, type System } from '../harness.ts'

let sys: System
beforeAll(async () => { sys = await startSystem() })
afterAll(async () => { await sys.stop() })

describe('MVP purchase flow', () => {
  it('finds, signs in, and buys only after explicit approval, without leaking secrets', async () => {
    const hermes = await sys.connect()
    const transcript: string[] = []
    const step = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await call(hermes, name, args)
      transcript.push(result.raw)
      return result
    }

    // 1-3. Open the shop, find the product, choose colour and size.
    const opened = await step('browser_navigate', { url: `${sys.origin}/` })
    const sessionId = opened.data.sessionId as string
    let snap = (await step('browser_snapshot', { sessionId })).data
    await step('browser_fill', { sessionId, ref: ref(snap, 'input', 'Search products'), text: 'black pant' })
    await step('browser_click', { sessionId, ref: ref(snap, 'button', 'Search') })
    snap = (await step('browser_snapshot', { sessionId })).data
    await step('browser_click', { sessionId, ref: ref(snap, 'a', 'ABC Classic Pant') })
    snap = (await step('browser_snapshot', { sessionId })).data
    await step('browser_select', { sessionId, ref: ref(snap, 'select', 'Colour'), option: 'Black' })
    await step('browser_select', { sessionId, ref: ref(snap, 'select', 'Size'), option: '32' })
    await step('browser_click', { sessionId, ref: ref(snap, 'button', 'Add to basket') })

    // 4. Adding to basket needs an account: the shop bounced us to sign in.
    const status = (await step('browser_snapshot', { sessionId })).data
    expect(status.url).toMatch(/\/login$/)
    const accounts = (await step('list_accounts')).data.accounts
    expect(accounts).toContainEqual(expect.objectContaining({ accountId: 'test-shop-main', username: 's***@example.test', automatedCheckout: true }))

    // 5-8. Native approval, Keychain credential, AgentVault signs in.
    sys.decisions.push('approved')
    const login = await step('request_login', { sessionId, accountId: 'test-shop-main', durationMinutes: 15 })
    expect(login.data.status).toBe('authenticated')
    const loginPrompt = sys.helper.prompts.at(-1)
    expect(loginPrompt).toMatchObject({ kind: 'login', request: { agent: 'hermes', site: { origin: sys.origin }, account: { id: 'test-shop-main' }, durationMinutes: 15 } })

    // 9. Add to basket now that we are signed in.
    await step('browser_navigate', { sessionId, url: `${sys.origin}/product/abc-pant` })
    snap = (await step('browser_snapshot', { sessionId })).data
    await step('browser_select', { sessionId, ref: ref(snap, 'select', 'Colour'), option: 'Black' })
    await step('browser_select', { sessionId, ref: ref(snap, 'select', 'Size'), option: '32' })
    await step('browser_click', { sessionId, ref: ref(snap, 'button', 'Add to basket') })

    // 10. Proceed to checkout.
    snap = (await step('browser_snapshot', { sessionId })).data
    await step('browser_click', { sessionId, ref: ref(snap, 'a', 'Proceed to checkout') })
    snap = (await step('browser_snapshot', { sessionId })).data
    expect(snap.url).toMatch(/\/checkout$/)

    // Checkout cannot proceed without approval.
    const premature = await step('browser_click', { sessionId, ref: ref(snap, 'button', 'Place order') })
    expect(premature.error).toBeUndefined()
    expect(premature.data.transaction).toEqual({ status: 'blocked', reason: 'no_valid_approval' })
    expect(sys.shop.orders).toHaveLength(0)

    // 11-13. Transaction boundary, purchase summary shown natively, user approves.
    sys.decisions.push('approved')
    const approval = await step('request_transaction_approval', { sessionId })
    expect(approval.error).toBeUndefined()
    expect(approval.data.status).toBe('approved')
    expect(sys.helper.prompts.at(-1)).toMatchObject({
      kind: 'transaction',
      request: { summary: { merchant: 'AgentVault Test Shop', items: [{ name: 'ABC Classic Pant', variant: 'Black / 32', quantity: '1', unitPrice: '128.00' }], shipping: '5.00', total: '133.00', currency: 'GBP', address: '1 Test Street, London, E1 6AN', paymentMethod: 'Visa ending 4242' } },
    })

    // 14-15. Submit and read back the simulated confirmation.
    snap = (await step('browser_snapshot', { sessionId })).data
    const placed = await step('browser_click', { sessionId, ref: ref(snap, 'button', 'Place order') })
    expect(placed.data.transaction).toEqual({ status: 'submitted', reason: 'approved' })
    const confirmation = (await step('browser_snapshot', { sessionId })).data
    expect(confirmation.text).toMatch(/Order TS-[0-9A-F]{8} confirmed\. Total £133\.00/)
    expect(sys.shop.orders).toHaveLength(1)
    expect(sys.shop.orders[0]?.lines).toEqual([{ productId: 'abc-pant', colour: 'Black', size: '32', quantity: 1 }])
    expect((await step('get_transaction_status', { approvalId: approval.data.approvalId })).data.status).toBe('consumed')

    // Hermes never received the password or the session cookie; neither did the logs.
    const all = transcript.join('\n')
    expect(all).not.toContain(TEST_USER.password)
    expect(all).not.toMatch(/sid=/)
    expect(sys.logLines.join('\n')).not.toContain(TEST_USER.password)
  })
})
