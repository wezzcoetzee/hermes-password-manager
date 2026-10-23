import type { Identity } from '../shared/crypto.ts'
import type { Logger } from '../shared/logger.ts'
import type { Site } from '../shared/sites.ts'
import { createAudit } from './audit.ts'
import { HELPER_KEY_SETTING } from './config.ts'
import { getSetting, type Db } from './db.ts'
import { createHelperClient } from './helper-client.ts'
import { createAgentServer, createInternalServer } from './server.ts'
import { createBroker } from './service.ts'
import { createWorkerClient } from './worker-client.ts'

export interface BrokerAppOptions {
  db: Db
  identity: Identity
  sites: Map<string, Site>
  helperUrl: string
  workerUrl: string
  workerToken: string
  log: Logger
}

/** Wires the broker together. Shared by the container entrypoint and the e2e tests. */
export function createBrokerApp({ db, identity, sites, helperUrl, workerUrl, workerToken, log }: BrokerAppOptions) {
  const audit = createAudit(db, log)
  const helper = createHelperClient(helperUrl, identity, () => getSetting(db, HELPER_KEY_SETTING))
  const worker = createWorkerClient(workerUrl, workerToken)
  const broker = createBroker({ db, sites, helper, worker, audit })
  broker.terminateStaleSessions()
  const sweeper = setInterval(broker.expireSessions, 15_000)
  sweeper.unref()
  return {
    broker,
    worker,
    agentServer: createAgentServer(db, broker, audit, log),
    internalServer: createInternalServer(broker, workerToken, log),
    stop: () => clearInterval(sweeper),
  }
}
