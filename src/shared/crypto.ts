/**
 * Broker <-> native helper protocol crypto. Mirrors native/AgentVaultHelper/Sources/Crypto.swift;
 * change both together.
 *
 * - Requests are signed by the broker (ECDSA P-256, raw r||s) and verified against the pinned broker key.
 * - Responses are signed by the helper, bound to the request nonce, and verified against the pinned helper key.
 * - Released credentials are sealed to the broker's sealing key (ephemeral ECDH P-256 + HKDF-SHA256 + AES-256-GCM),
 *   so anything that intercepts or impersonates the transport sees only ciphertext.
 */
import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman,
  generateKeyPairSync, hkdfSync, randomBytes, sign, verify, type KeyObject,
} from 'node:crypto'

export const SEAL_INFO = 'agentvault/credential/v1'
export const MAX_CLOCK_SKEW_MS = 30_000

export interface KeyPairPem { privateKey: string; publicKey: string }
/** The broker owns two keys so signing and key agreement never share key material. */
export interface Identity { signing: KeyPairPem; sealing: KeyPairPem }

export function generateKeyPair(): KeyPairPem {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

export const generateIdentity = (): Identity => ({ signing: generateKeyPair(), sealing: generateKeyPair() })

const digest = (data: string) => createHash('sha256').update(data).digest('hex')

export const requestSigningInput = (path: string, ts: string, nonce: string, body: string) =>
  `POST\n${path}\n${ts}\n${nonce}\n${digest(body)}`

export const responseSigningInput = (nonce: string, payload: string) => `${nonce}\n${digest(payload)}`

export function signData(privateKeyPem: string, data: string): string {
  return sign('sha256', Buffer.from(data), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' }).toString('base64')
}

export function verifyData(publicKeyPem: string, data: string, signature: string): boolean {
  try {
    return verify('sha256', Buffer.from(data), { key: publicKeyPem, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

function publicKeyFromX963(raw: Buffer): KeyObject {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error('Invalid P-256 public key')
  return createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') },
    format: 'jwk',
  })
}

function x963FromPublicKey(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' })
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x ?? '', 'base64url'), Buffer.from(jwk.y ?? '', 'base64url')])
}

export interface Sealed { epk: string; box: string }

const deriveKey = (secret: Buffer, context: string) =>
  Buffer.from(hkdfSync('sha256', secret, Buffer.from(context), Buffer.from(SEAL_INFO), 32))

/** Seal plaintext to a recipient key. `context` (the request id) is bound into key derivation. */
export function seal(recipientPublicPem: string, context: string, plaintext: string): Sealed {
  const ephemeral = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const key = deriveKey(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: createPublicKey(recipientPublicPem) }), context)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  // Same layout as CryptoKit's AES.GCM.SealedBox.combined: nonce || ciphertext || tag.
  return { epk: x963FromPublicKey(ephemeral.publicKey).toString('base64'), box: Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64') }
}

export function open(recipientPrivatePem: string, context: string, sealed: Sealed): string {
  const key = deriveKey(diffieHellman({ privateKey: createPrivateKey(recipientPrivatePem), publicKey: publicKeyFromX963(Buffer.from(sealed.epk, 'base64')) }), context)
  const box = Buffer.from(sealed.box, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, box.subarray(0, 12))
  decipher.setAuthTag(box.subarray(box.length - 16))
  return Buffer.concat([decipher.update(box.subarray(12, box.length - 16)), decipher.final()]).toString('utf8')
}
