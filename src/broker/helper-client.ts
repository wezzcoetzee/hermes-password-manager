import type { z } from 'zod'
import { open, requestSigningInput, responseSigningInput, signData, verifyData, type Identity } from '../shared/crypto.ts'
import {
  APPROVAL_TIMEOUT_MS, HELPER_PATHS, credentialSchema, loginResultSchema, signedResponseSchema, transactionResultSchema,
  type Credential, type Decision, type LoginRequest, type TransactionRequest,
} from '../shared/helper-protocol.ts'
import { HttpError } from '../shared/http.ts'
import { opaqueId } from '../shared/ids.ts'

export interface HelperClient {
  approveLogin(req: LoginRequest): Promise<{ decision: Decision; credential?: Credential }>
  approveTransaction(req: TransactionRequest): Promise<Decision>
}

/**
 * Talks to the native helper. Every request is signed with the broker's key and
 * every response must carry a valid signature from the pinned helper key; an
 * unsigned or mis-signed answer is never treated as an approval.
 */
export function createHelperClient(baseUrl: string, identity: Identity, helperPublicKey: () => string | undefined): HelperClient {
  async function call<T extends z.ZodType>(path: string, body: object, schema: T, requestId: string): Promise<z.infer<T>> {
    const pinned = helperPublicKey()
    if (!pinned) throw new HttpError(503, 'helper_unpaired', 'Native helper is not paired. Run `agentvault pair`.')
    const raw = JSON.stringify(body)
    const ts = String(Date.now())
    const nonce = opaqueId('req')
    const signature = signData(identity.signing.privateKey, requestSigningInput(path, ts, nonce, raw))
    let response: unknown
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-av-ts': ts, 'x-av-nonce': nonce, 'x-av-signature': signature },
        body: raw,
        signal: AbortSignal.timeout(APPROVAL_TIMEOUT_MS + 10_000),
      }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`helper HTTP ${r.status}`))))
    } catch {
      throw new HttpError(503, 'helper_unavailable', 'Native approval helper is not reachable; nothing was approved.')
    }
    const signed = signedResponseSchema.parse(response)
    if (!verifyData(pinned, responseSigningInput(nonce, signed.payload), signed.signature)) {
      throw new HttpError(502, 'helper_signature_invalid', 'Approval response failed signature verification; treated as denied.')
    }
    const result = schema.parse(JSON.parse(signed.payload))
    if ((result as { requestId: string }).requestId !== requestId) {
      throw new HttpError(502, 'helper_binding_invalid', 'Approval response is bound to a different request; treated as denied.')
    }
    return result
  }

  return {
    async approveLogin(req) {
      const result = await call(HELPER_PATHS.login, req, loginResultSchema, req.requestId)
      if (result.decision !== 'approved') return { decision: result.decision }
      if (!result.sealed) throw new HttpError(502, 'helper_missing_credential', 'Helper approved but returned no credential.')
      const credential = credentialSchema.parse(JSON.parse(open(identity.sealing.privateKey, req.requestId, result.sealed)))
      return { decision: 'approved', credential }
    },
    async approveTransaction(req) {
      return (await call(HELPER_PATHS.transaction, req, transactionResultSchema, req.requestId)).decision
    },
  }
}
