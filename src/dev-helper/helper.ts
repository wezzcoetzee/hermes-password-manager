/**
 * TypeScript implementation of the native helper protocol for Linux development
 * and automated tests. It holds FAKE credentials only and uses a pluggable
 * decision function instead of a native prompt. The production helper is the
 * Swift app in native/AgentVaultHelper; both must pass the same broker checks.
 */
import type { IncomingMessage, Server } from 'node:http'
import { MAX_CLOCK_SKEW_MS, generateKeyPair, requestSigningInput, responseSigningInput, seal, signData, verifyData, type KeyPairPem } from '../shared/crypto.ts'
import {
  HELPER_PATHS, loginRequestSchema, transactionRequestSchema,
  type Credential, type Decision, type LoginRequest, type TransactionRequest,
} from '../shared/helper-protocol.ts'
import { HttpError, jsonServer, parseJson, parseWith } from '../shared/http.ts'

export type Prompt =
  | { kind: 'login'; request: LoginRequest }
  | { kind: 'transaction'; request: TransactionRequest }

/** `unattended` mirrors the Swift helper's per-account flag: release without a prompt when the broker already has consent. */
export type StoredCredential = Credential & { origin: string; unattended?: boolean }

export interface DevHelperOptions {
  brokerSigningKey: string
  brokerSealingKey: string
  credentials: Map<string, StoredCredential>
  decide: (prompt: Prompt) => Promise<Decision>
  key?: KeyPairPem
}

export function createDevHelper(options: DevHelperOptions): { server: Server; publicKey: string; prompts: Prompt[] } {
  const key = options.key ?? generateKeyPair()
  const seenNonces = new Map<string, number>()
  const prompts: Prompt[] = []

  function authenticate(req: IncomingMessage, path: string, body: string): string {
    const ts = String(req.headers['x-av-ts'] ?? '')
    const nonce = String(req.headers['x-av-nonce'] ?? '')
    const signature = String(req.headers['x-av-signature'] ?? '')
    if (Math.abs(Date.now() - Number(ts)) > MAX_CLOCK_SKEW_MS) throw new HttpError(401, 'stale', 'Request timestamp outside allowed window')
    if (!nonce || seenNonces.has(nonce)) throw new HttpError(401, 'replay', 'Nonce already used')
    if (!verifyData(options.brokerSigningKey, requestSigningInput(path, ts, nonce, body), signature)) {
      throw new HttpError(401, 'bad_signature', 'Request not signed by the paired broker')
    }
    for (const [n, at] of seenNonces) if (Date.now() - at > MAX_CLOCK_SKEW_MS * 2) seenNonces.delete(n)
    seenNonces.set(nonce, Date.now())
    return nonce
  }

  const respond = (nonce: string, payload: object) => {
    const raw = JSON.stringify(payload)
    return { payload: raw, signature: signData(key.privateKey, responseSigningInput(nonce, raw)) }
  }

  const server = jsonServer({
    [`POST ${HELPER_PATHS.login}`]: async (req, body) => {
      const nonce = authenticate(req, HELPER_PATHS.login, body)
      const request = parseWith(loginRequestSchema, parseJson(body))
      const stored = options.credentials.get(request.account.id)
      // The helper, not the broker, decides which origin a credential belongs to.
      if (!stored || stored.origin !== request.site.origin || stored.username !== request.account.username) {
        return respond(nonce, { requestId: request.requestId, decision: 'denied' })
      }
      const unattended = request.unattended && stored.unattended === true
      if (!unattended) prompts.push({ kind: 'login', request })
      const decision = unattended ? 'approved' : await options.decide({ kind: 'login', request })
      if (decision !== 'approved') return respond(nonce, { requestId: request.requestId, decision })
      const sealed = seal(options.brokerSealingKey, request.requestId, JSON.stringify({ username: stored.username, password: stored.password }))
      return respond(nonce, { requestId: request.requestId, decision, sealed })
    },
    [`POST ${HELPER_PATHS.transaction}`]: async (req, body) => {
      const nonce = authenticate(req, HELPER_PATHS.transaction, body)
      const request = parseWith(transactionRequestSchema, parseJson(body))
      prompts.push({ kind: 'transaction', request })
      return respond(nonce, { requestId: request.requestId, decision: await options.decide({ kind: 'transaction', request }) })
    },
  }, (err) => console.error('dev-helper error', err))

  return { server, publicKey: key.publicKey, prompts }
}
