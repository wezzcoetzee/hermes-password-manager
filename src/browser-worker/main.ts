import { readFileSync } from 'node:fs'
import { listen } from '../shared/http.ts'
import { createLogger } from '../shared/logger.ts'
import { createWorker } from './worker.ts'

const log = createLogger('browser-worker')
const token = readFileSync(process.env.WORKER_TOKEN_FILE ?? '/run/secrets/worker_token', 'utf8').trim()
const worker = await createWorker({ token, brokerInternalUrl: process.env.BROKER_INTERNAL_URL ?? 'http://broker:7801', log })
const port = await listen(worker.server, Number(process.env.PORT ?? 7900), '0.0.0.0')
log.info({ port }, 'browser worker listening')

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    log.info({ signal }, 'shutting down; closing all sessions')
    await worker.shutdown()
    process.exit(0)
  })
}
