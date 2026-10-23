import type { IncomingMessage } from 'node:http'
import { chromium, type Browser } from 'playwright'
import { HttpError, jsonServer, parseJson, parseWith, postJson } from '../shared/http.ts'
import { safeEqual } from '../shared/ids.ts'
import type { Logger } from '../shared/logger.ts'
import {
  WORKER_TOKEN_HEADER, actionSchema, consumeResultSchema, extendSchema, loginSchema, openSessionSchema,
} from '../shared/worker-protocol.ts'
import { BrowserSession } from './session.ts'

export interface WorkerOptions { token: string; brokerInternalUrl: string; log: Logger; maxSessions?: number }

export async function createWorker(options: WorkerOptions) {
  const { token, log, maxSessions = 8 } = options
  const browser: Browser = await chromium.launch({
    headless: true,
    // Playwright talks to Chromium over a pipe; no remote debugging port is ever opened.
    args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--no-first-run', '--disable-features=Translate,MediaRouter'],
  })
  const sessions = new Map<string, BrowserSession>()

  const consume = (sessionId: string, summaryHash: string) =>
    postJson(`${options.brokerInternalUrl}/internal/transactions/consume`, { sessionId, summaryHash }, { [WORKER_TOKEN_HEADER]: token })
      .then((r) => consumeResultSchema.parse(r))
      .catch(() => ({ allowed: false, reason: 'broker_unreachable' }))

  const authorize = (req: IncomingMessage) => {
    if (!safeEqual(String(req.headers[WORKER_TOKEN_HEADER] ?? ''), token)) throw new HttpError(401, 'unauthorized', 'Unauthorized')
  }
  const get = (id: string) => {
    const session = sessions.get(id)
    if (!session) throw new HttpError(404, 'session_not_found', 'Session not found or already closed')
    return session
  }
  async function close(id: string) {
    const session = sessions.get(id)
    sessions.delete(id)
    await session?.close()
  }

  const server = jsonServer({
    'POST /sessions/open': async (req, body) => {
      authorize(req)
      const { sessionId, site, expiresAt } = parseWith(openSessionSchema, parseJson(body))
      if (sessions.size >= maxSessions) throw new HttpError(429, 'too_many_sessions', 'Too many concurrent sessions')
      const session = await BrowserSession.open(browser, sessionId, site, expiresAt, consume, log, () => {
        log.info({ sessionId }, 'session expired')
        void close(sessionId)
      })
      sessions.set(sessionId, session)
      return { ok: true }
    },
    'POST /sessions/login': async (req, body) => {
      authorize(req)
      const { sessionId, username, password } = parseWith(loginSchema, parseJson(body))
      const session = get(sessionId)
      return { ok: await session.run(() => session.login(username, password)) }
    },
    'POST /sessions/extend': async (req, body) => {
      authorize(req)
      const { sessionId, expiresAt } = parseWith(extendSchema, parseJson(body))
      get(sessionId).setExpiry(expiresAt, () => void close(sessionId))
      return { ok: true }
    },
    'POST /sessions/action': async (req, body) => {
      authorize(req)
      const { sessionId, action } = parseWith(actionSchema, parseJson(body))
      const session = get(sessionId)
      try {
        return await session.run(() => session.act(action))
      } catch (err) {
        if (session.closed) throw new HttpError(410, 'session_closed', 'Session was closed')
        throw new HttpError(422, 'action_failed', String(err instanceof Error ? err.message : err).split('\n')[0]?.slice(0, 300) ?? 'Action failed')
      }
    },
    'POST /sessions/close': async (req, body) => {
      authorize(req)
      await close(String((parseJson(body) as { sessionId?: unknown }).sessionId))
      return { ok: true }
    },
    'POST /sessions/close-all': async (req) => {
      authorize(req)
      await Promise.all([...sessions.keys()].map(close))
      return { ok: true }
    },
  }, (err) => log.error({ err }, 'worker error'))

  return {
    server,
    sessions,
    async shutdown() {
      await Promise.all([...sessions.keys()].map(close))
      await browser.close()
      server.close()
    },
  }
}
