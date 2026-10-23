import { describe, expect, it } from 'vitest'
import { generateKeyPair, open, seal, signData, verifyData } from '../../src/shared/crypto.ts'

describe('helper protocol crypto', () => {
  const recipient = generateKeyPair()
  it('round-trips a sealed credential bound to its request id', () => {
    const sealed = seal(recipient.publicKey, 'req_1', '{"password":"x"}')
    expect(open(recipient.privateKey, 'req_1', sealed)).toBe('{"password":"x"}')
  })
  it('rejects a sealed box opened under a different request id, key, or after tampering', () => {
    const sealed = seal(recipient.publicKey, 'req_1', 'secret')
    expect(() => open(recipient.privateKey, 'req_2', sealed)).toThrow()
    expect(() => open(generateKeyPair().privateKey, 'req_1', sealed)).toThrow()
    const box = Buffer.from(sealed.box, 'base64')
    box[box.length - 20] = (box[box.length - 20] ?? 0) ^ 1
    expect(() => open(recipient.privateKey, 'req_1', { ...sealed, box: box.toString('base64') })).toThrow()
  })
  it('signatures only verify with the matching key and data', () => {
    const sig = signData(recipient.privateKey, 'payload')
    expect(verifyData(recipient.publicKey, 'payload', sig)).toBe(true)
    expect(verifyData(recipient.publicKey, 'payload!', sig)).toBe(false)
    expect(verifyData(generateKeyPair().publicKey, 'payload', sig)).toBe(false)
    expect(verifyData(recipient.publicKey, 'payload', 'garbage')).toBe(false)
  })
})
