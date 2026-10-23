/** Internal contract between the broker and the browser worker. Never exposed to agents. */
import { z } from 'zod'
import { siteSchema } from './sites.ts'

export const WORKER_TOKEN_HEADER = 'x-av-worker-token'

export const openSessionSchema = z.object({ sessionId: z.string(), site: siteSchema, expiresAt: z.number() })
export const loginSchema = z.object({ sessionId: z.string(), username: z.string(), password: z.string() })
export const extendSchema = z.object({ sessionId: z.string(), expiresAt: z.number() })
export const actionSchema = z.object({
  sessionId: z.string(),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('navigate'), url: z.string() }),
    z.object({ type: z.literal('snapshot') }),
    z.object({ type: z.literal('click'), ref: z.string() }),
    z.object({ type: z.literal('fill'), ref: z.string(), text: z.string() }),
    z.object({ type: z.literal('select'), ref: z.string(), option: z.string() }),
    z.object({ type: z.literal('scroll'), direction: z.enum(['up', 'down']), amount: z.number() }),
    z.object({ type: z.literal('back') }),
    z.object({ type: z.literal('wait'), text: z.string().optional(), timeoutMs: z.number() }),
    z.object({ type: z.literal('screenshot') }),
    z.object({ type: z.literal('order_summary') }),
  ]),
})
export type WorkerAction = z.infer<typeof actionSchema>['action']

/** Broker endpoint the worker calls when it intercepts an order submission. */
export const consumeSchema = z.object({ sessionId: z.string(), summaryHash: z.string() })
export const consumeResultSchema = z.object({ allowed: z.boolean(), reason: z.string() })
