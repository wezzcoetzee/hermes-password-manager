import type { IncomingMessage } from 'node:http'
import { HttpError, jsonServer, parseJson, parseWith, type Route } from '../shared/http.ts'
import { safeEqual, sha256 } from '../shared/ids.ts'
import type { Logger } from '../shared/logger.ts'
import { toolDefinitions, type ToolName } from '../shared/tools.ts'
import { WORKER_TOKEN_HEADER, consumeSchema } from '../shared/worker-protocol.ts'
import type { Audit } from './audit.ts'
import type { AgentRow, Db } from './db.ts'
import type { Broker } from './service.ts'

/** Agent-facing API. The only broker surface reachable from the host. */
export function createAgentServer(db: Db, broker: Broker, audit: Audit, log: Logger) {
  const findAgent = db.prepare('SELECT id, name FROM agents WHERE token_hash = ? AND disabled = 0')

  function authenticate(req: IncomingMessage): AgentRow {
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]
    const agent = token ? (findAgent.get(sha256(token)) as AgentRow | undefined) : undefined
    if (!agent) {
      audit({ event: 'agent_auth', outcome: 'rejected', detail: { reason: token ? 'unknown_token' : 'missing_token' } })
      throw new HttpError(401, 'unauthorized', 'Unknown or missing agent token')
    }
    return agent
  }

  const routes = Object.fromEntries((Object.keys(toolDefinitions) as ToolName[]).map((name) => {
    const route: Route = async (req, body) => {
      const agent = authenticate(req)
      const input = parseWith(toolDefinitions[name].input, parseJson(body))
      const handler = broker.handlers[name] as (agent: AgentRow, input: unknown) => Promise<unknown>
      return handler(agent, input)
    }
    return [`POST /v1/tools/${name}`, route]
  }))

  return jsonServer(routes, (err) => log.error({ err }, 'broker error'))
}

/** Worker-facing API on the private Docker network only. */
export function createInternalServer(broker: Broker, workerToken: string, log: Logger) {
  return jsonServer({
    'POST /internal/transactions/consume': async (req, body) => {
      if (!safeEqual(String(req.headers[WORKER_TOKEN_HEADER] ?? ''), workerToken)) throw new HttpError(401, 'unauthorized', 'Unauthorized')
      const { sessionId, summaryHash } = parseWith(consumeSchema, parseJson(body))
      return broker.consumeTransaction(sessionId, summaryHash)
    },
  }, (err) => log.error({ err }, 'internal error'))
}
