import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDevHelper } from '../../src/dev-helper/helper.ts'
import { generateIdentity, requestSigningInput, signData } from '../../src/shared/crypto.ts'
import { HELPER_PATHS } from '../../src/shared/helper-protocol.ts'
import { listen } from '../../src/shared/http.ts'

const broker = generateIdentity()
const helper = createDevHelper({ brokerSigningKey: broker.signing.publicKey, brokerSealingKey: broker.sealing.publicKey, credentials: new Map(), decide: async () => 'approved' })
let url = ''
beforeAll(async () => { url = `http://127.0.0.1:${await listen(helper.server, 0, '127.0.0.1')}${HELPER_PATHS.transaction}` })
afterAll(() => { helper.server.close() })

const body = JSON.stringify({ requestId: 'txn_1', agent: 'a', site: { name: 's', origin: 'https://s' }, summary: { merchant: 'm', items: [{ name: 'n', variant: 'v', quantity: '1', unitPrice: '1' }], shipping: '0', total: '1', currency: 'GBP', address: 'a', paymentMethod: 'p' } })
const send = (key: string, ts: number, nonce: string) => fetch(url, {
  method: 'POST', body,
  headers: { 'x-av-ts': String(ts), 'x-av-nonce': nonce, 'x-av-signature': signData(key, requestSigningInput(HELPER_PATHS.transaction, String(ts), nonce, body)) },
})

describe('helper request authentication', () => {
  it('accepts a fresh signed request once, then rejects its replay', async () => {
    expect((await send(broker.signing.privateKey, Date.now(), 'n1')).status).toBe(200)
    expect((await send(broker.signing.privateKey, Date.now(), 'n1')).status).toBe(401)
  })
  it('rejects stale timestamps and requests signed by anyone but the paired broker', async () => {
    expect((await send(broker.signing.privateKey, Date.now() - 60_000, 'n2')).status).toBe(401)
    expect((await send(generateIdentity().signing.privateKey, Date.now(), 'n3')).status).toBe(401)
  })
})
