import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Opaque, unguessable identifier with a readable type prefix. */
export const opaqueId = (prefix: 'ses' | 'txn' | 'req' | 'agt') => `${prefix}_${randomBytes(18).toString('base64url')}`

export const sha256 = (input: string) => createHash('sha256').update(input).digest('hex')

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
