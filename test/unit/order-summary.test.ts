import { describe, expect, it } from 'vitest'
import { orderSummarySchema } from '../../src/shared/sites.ts'

const item = { name: 'ABC Pant', variant: 'Black / 32', quantity: '1', unitPrice: '128.00' }
const summary = { merchant: 'Shop', items: [item], shipping: '5.00', total: '133.00', currency: 'GBP', address: '1 Test St', paymentMethod: 'Visa 4242' }

describe('orderSummarySchema (what the native prompt shows)', () => {
  it('accepts an ordinary order', () => expect(orderSummarySchema.safeParse(summary).success).toBe(true))
  it('rejects padding that could push the total off the prompt', () => {
    expect(orderSummarySchema.safeParse({ ...summary, items: Array(11).fill(item) }).success).toBe(false)
    expect(orderSummarySchema.safeParse({ ...summary, items: [{ ...item, name: 'x'.repeat(121) }] }).success).toBe(false)
  })
  it('rejects bidi overrides, zero-width and control characters', () => {
    for (const total of ['‮00.331', '1​33.00', '133.00\nTotal: 1.00']) {
      expect(orderSummarySchema.safeParse({ ...summary, total }).success, JSON.stringify(total)).toBe(false)
    }
  })
})
