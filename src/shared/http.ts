import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { z } from 'zod'

const MAX_BODY_BYTES = 256 * 1024

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body_too_large', 'Request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function parseWith<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new HttpError(400, 'invalid_input', result.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '))
  }
  return result.data
}

export function parseJson(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    throw new HttpError(400, 'invalid_json', 'Body is not valid JSON')
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(payload)
}

export type Route = (req: IncomingMessage, body: string, url: URL) => Promise<unknown>

/**
 * Minimal JSON router. Every handler returns a JSON-serialisable value or throws
 * an HttpError; anything else becomes an opaque 500 so internals never leak.
 */
export function jsonServer(routes: Record<string, Route>, onError: (err: unknown) => void): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local')
      if (req.method === 'GET' && url.pathname === '/healthz') return sendJson(res, 200, { ok: true })
      const route = routes[`${req.method} ${url.pathname}`]
      if (!route) throw new HttpError(404, 'not_found', 'Unknown endpoint')
      sendJson(res, 200, await route(req, await readBody(req), url))
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.code, message: err.message })
      onError(err)
      sendJson(res, 500, { error: 'internal', message: 'Internal error' })
    }
  })
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string }
  if (!res.ok) throw new HttpError(res.status, json.error ?? 'upstream_error', json.message ?? `HTTP ${res.status}`)
  return json
}

export const listen = (server: Server, port: number, host: string) =>
  new Promise<number>((resolve) => server.listen(port, host, () => {
    const addr = server.address()
    resolve(typeof addr === 'object' && addr ? addr.port : port)
  }))
