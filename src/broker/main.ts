import { readFileSync } from 'node:fs'
import { listen } from '../shared/http.ts'
import { createLogger } from '../shared/logger.ts'
import { createBrokerApp } from './app.ts'
import { brokerConfig, openBrokerState } from './config.ts'

const log = createLogger('credential-broker')
const { db, identity, sites } = openBrokerState()
const app = createBrokerApp({
  db, identity, sites, log,
  helperUrl: brokerConfig.helperUrl,
  workerUrl: brokerConfig.workerUrl,
  workerToken: readFileSync(brokerConfig.workerTokenFile, 'utf8').trim(),
})

await listen(app.agentServer, brokerConfig.agentPort, '0.0.0.0')
await listen(app.internalServer, brokerConfig.internalPort, '0.0.0.0')
log.info({ sites: [...sites.keys()], agentPort: brokerConfig.agentPort }, 'credential broker listening')

// The worker may have outlived a broker restart; its sessions are no longer trusted.
const resetWorker = async (attempt = 0): Promise<void> => {
  try {
    await app.worker.closeAll()
  } catch {
    if (attempt < 20) return new Promise((r) => setTimeout(r, 3000)).then(() => resetWorker(attempt + 1))
  }
}
void resetWorker()

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    log.info({ signal }, 'shutting down')
    app.stop()
    await app.worker.closeAll().catch(() => undefined)
    app.agentServer.close()
    app.internalServer.close()
    db.close()
    process.exit(0)
  })
}
