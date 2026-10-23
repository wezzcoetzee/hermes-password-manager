import { describe, expect, it } from 'vitest'
import { createGuard, resolvesToPrivate } from '../../src/browser-worker/guard.ts'
import { siteSchema } from '../../src/shared/sites.ts'

const base = {
  id: 'shop', name: 'Shop', origin: 'https://shop.example', extraOrigins: ['https://cdn.shop.example'],
  login: { url: 'https://shop.example/login', username: '#u', password: '#p', submit: '#s', successPath: '^/account$' },
}
const withCheckout = siteSchema.parse({
  ...base,
  checkout: { pagePath: '^/checkout$', submitPath: '^/checkout/submit$', summary: Object.fromEntries(['item', 'name', 'variant', 'quantity', 'unitPrice', 'shipping', 'total', 'currency', 'address', 'paymentMethod'].map((k) => [k, `#${k}`])) },
})
const manual = siteSchema.parse({ ...base, checkout: null })

describe('resolvesToPrivate', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.72.52.5', '0.0.0.0', '[::1]', '[fd00::1]', '[::ffff:127.0.0.1]', 'localhost', 'host.docker.internal', 'mac.local'])(
    '%s is private', async (host) => expect(await resolvesToPrivate(host)).toBe(true))
  it('public addresses are not private', async () => expect(await resolvesToPrivate('93.184.215.14')).toBe(false))
  it('unresolvable hosts fail closed', async () => expect(await resolvesToPrivate('does-not-exist.invalid')).toBe(true))
})

describe('createGuard', () => {
  const check = createGuard(withCheckout)
  it('allows only allowlisted origins', async () => {
    expect(await check('https://cdn.shop.example/app.js', 'GET')).toEqual({ allow: false, reason: 'private_network' }) // .example does not resolve
    expect(await check('https://evil.example/', 'GET')).toEqual({ allow: false, reason: 'origin_not_allowed' })
    expect(await check('https://shop.example.evil.example/', 'GET')).toEqual({ allow: false, reason: 'origin_not_allowed' })
    expect(await check('http://shop.example/', 'GET')).toEqual({ allow: false, reason: 'origin_not_allowed' }) // scheme downgrade
  })
  it('rejects non-web schemes', async () => {
    for (const url of ['file:///etc/passwd', 'chrome://settings', 'ftp://shop.example/']) expect((await check(url, 'GET')).allow).toBe(false)
  })
  it('marks the adapter submit path as the transaction boundary, for any method', async () => {
    const dev = createGuard({ ...withCheckout, allowPrivateNetwork: true })
    expect(await dev('https://shop.example/checkout/submit', 'POST')).toEqual({ allow: 'transaction' })
    expect(await dev('https://shop.example/checkout/submit', 'GET')).toEqual({ allow: 'transaction' })
  })
  it('without an adapter, checkout-like submissions require manual checkout', async () => {
    const dev = createGuard({ ...manual, allowPrivateNetwork: true })
    expect(await dev('https://shop.example/api/place-order', 'POST')).toEqual({ allow: false, reason: 'manual_checkout_required' })
    expect(await dev('https://shop.example/basket/add', 'POST')).toEqual({ allow: true })
  })
})
