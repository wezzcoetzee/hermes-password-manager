/** Wire contract between the broker and the native macOS helper (or the dev helper). */
import { z } from 'zod'
import { orderSummarySchema } from './sites.ts'

export const decisionSchema = z.enum(['approved', 'denied', 'unavailable'])
export type Decision = z.infer<typeof decisionSchema>

export const loginRequestSchema = z.object({
  requestId: z.string(),
  agent: z.string(),
  site: z.object({ name: z.string(), origin: z.string() }),
  account: z.object({ id: z.string(), username: z.string() }),
  durationMinutes: z.number().int(),
  /**
   * The broker already has consent (chat or auto grant). The helper skips its prompt only if the
   * account was also marked unattended on the helper itself; otherwise it prompts as usual.
   */
  unattended: z.boolean().default(false),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

export const transactionRequestSchema = z.object({
  requestId: z.string(),
  agent: z.string(),
  site: z.object({ name: z.string(), origin: z.string() }),
  summary: orderSummarySchema,
})
export type TransactionRequest = z.infer<typeof transactionRequestSchema>

const sealedSchema = z.object({ epk: z.string(), box: z.string() })

export const loginResultSchema = z.object({ requestId: z.string(), decision: decisionSchema, sealed: sealedSchema.optional() })
export const transactionResultSchema = z.object({ requestId: z.string(), decision: decisionSchema })

export const credentialSchema = z.object({ username: z.string(), password: z.string() })
export type Credential = z.infer<typeof credentialSchema>

export const signedResponseSchema = z.object({ payload: z.string(), signature: z.string() })

export const HELPER_PATHS = { login: '/v1/login', transaction: '/v1/transaction' } as const
/** How long the user has to decide before the request is treated as denied. */
export const APPROVAL_TIMEOUT_MS = 120_000
