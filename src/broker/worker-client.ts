import { postJson } from '../shared/http.ts'
import type { Site } from '../shared/sites.ts'
import { WORKER_TOKEN_HEADER, type ActionResult, type WorkerAction } from '../shared/worker-protocol.ts'

export function createWorkerClient(baseUrl: string, token: string) {
  const call = <T>(path: string, body: object, timeoutMs = 45_000) =>
    postJson<T>(`${baseUrl}${path}`, body, { [WORKER_TOKEN_HEADER]: token }, timeoutMs)
  return {
    open: (sessionId: string, site: Site, expiresAt: number) => call('/sessions/open', { sessionId, site, expiresAt }),
    login: (sessionId: string, username: string, password: string) => call<{ ok: boolean }>('/sessions/login', { sessionId, username, password }),
    extend: (sessionId: string, expiresAt: number) => call('/sessions/extend', { sessionId, expiresAt }),
    act: (sessionId: string, action: WorkerAction) => call<ActionResult>('/sessions/action', { sessionId, action }),
    close: (sessionId: string) => call('/sessions/close', { sessionId }),
    closeAll: () => call('/sessions/close-all', {}),
  }
}

export type WorkerClient = ReturnType<typeof createWorkerClient>
