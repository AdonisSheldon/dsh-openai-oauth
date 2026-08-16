import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { AuthStatus, LoginMethod, PendingStatus } from './auth-controller.js'
import { AuthControllerError } from './auth-controller.js'
import { OAUTH_ROUTE_PATH } from './protocol.js'
export { OAUTH_ROUTE_PATH } from './protocol.js'
const MAX_BODY_BYTES = 4096

export interface OAuthHttpController {
  status(): Promise<AuthStatus>
  start(method: LoginMethod): Promise<PendingStatus>
  cancel(attemptId: string): Promise<AuthStatus>
  logout(): Promise<AuthStatus>
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Return true only for literal IPv4, mapped IPv4, or IPv6 loopback addresses. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  if (address === '::1') return true
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address
  return isIP(ipv4) === 4 && ipv4.startsWith('127.')
}

function localHostname(hostname: string): boolean {
  const plain = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return plain === 'localhost' || isLoopbackAddress(plain)
}

function authority(req: IncomingMessage): URL | undefined {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return undefined
  const host = req.headers.host
  if (host === undefined) return undefined
  try {
    const value = new URL(`http://${host}`)
    if (!localHostname(value.hostname) || value.username.length > 0 || value.password.length > 0) return undefined
    return value
  } catch {
    return undefined
  }
}

function mutationTrusted(req: IncomingMessage, host: URL): boolean {
  if (req.headers['sec-fetch-site'] !== 'same-origin') return false
  const origin = req.headers.origin
  if (origin === undefined) return false
  try {
    return new URL(origin).origin === host.origin
  } catch {
    return false
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

function errorBody(error: HttpError): { error: { code: string; message: string } } {
  return { error: { code: error.code, message: error.message } }
}

function mappedControllerError(error: AuthControllerError): HttpError {
  switch (error.code) {
    case 'INVALID_LOGIN_METHOD':
    case 'UNSAFE_CALLBACK_HOST':
      return new HttpError(400, error.code, error.message)
    case 'AUTH_IN_PROGRESS':
    case 'STALE_ATTEMPT':
      return new HttpError(409, error.code, error.message)
    case 'AUTH_DISPOSED':
      return new HttpError(503, error.code, error.message)
    case 'AUTH_CANCELLED':
      return new HttpError(409, error.code, error.message)
    default:
      return new HttpError(502, error.code, error.message)
  }
}

function contentTypeIsJson(req: IncomingMessage): boolean {
  const header = req.headers['content-type']
  if (typeof header !== 'string') return false
  return header.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!contentTypeIsJson(req)) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'OAuth mutations require application/json.')
  }
  const declared = req.headers['content-length']
  if (declared !== undefined) {
    const bytes = Number(declared)
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new HttpError(400, 'INVALID_BODY', 'Invalid JSON request body.')
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE', 'OAuth request body is too large.')
  }
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_BODY_BYTES) {
      req.resume()
      throw new HttpError(413, 'BODY_TOO_LARGE', 'OAuth request body is too large.')
    }
    chunks.push(buffer)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'INVALID_BODY', 'Invalid JSON request body.')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_BODY', 'JSON request body must be an object.')
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function startMethod(body: Record<string, unknown>): LoginMethod {
  if (!exactKeys(body, ['method']) || (body['method'] !== 'browser' && body['method'] !== 'device_code')) {
    throw new HttpError(400, 'INVALID_LOGIN_METHOD', 'Login method must be browser or device_code.')
  }
  return body['method']
}

function attemptId(body: Record<string, unknown>): string {
  if (!exactKeys(body, ['attemptId']) || typeof body['attemptId'] !== 'string'
    || body['attemptId'].length === 0 || body['attemptId'].length > 200) {
    throw new HttpError(400, 'INVALID_ATTEMPT_ID', 'A current OAuth attempt id is required.')
  }
  return body['attemptId']
}

/** Build the local-only OAuth route without registering it. */
export function oauthRoute(
  controller: OAuthHttpController,
): WebRoute {
  return {
    kind: 'prefix',
    path: OAUTH_ROUTE_PATH,
    handler: async (req, res) => {
      const host = authority(req)
      if (host === undefined) {
        writeJson(res, 403, errorBody(new HttpError(
          403,
          'LOCAL_ONLY',
          'OpenAI OAuth controls are available only from the local Harness Web Host.',
        )))
        return
      }
      const path = new URL(req.url ?? '/', host).pathname
      const mutating = req.method === 'POST'
      if (mutating && !mutationTrusted(req, host)) {
        writeJson(res, 403, errorBody(new HttpError(403, 'SAME_ORIGIN_REQUIRED', 'OAuth mutations require the local Harness origin.')))
        return
      }
      try {
        if (path === `${OAUTH_ROUTE_PATH}/status`) {
          if (req.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This OAuth endpoint accepts only GET.')
          writeJson(res, 200, await controller.status())
          return
        }
        if (path === `${OAUTH_ROUTE_PATH}/start`) {
          if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This OAuth endpoint accepts only POST.')
          writeJson(res, 200, await controller.start(startMethod(await readJson(req))))
          return
        }
        if (path === `${OAUTH_ROUTE_PATH}/cancel`) {
          if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This OAuth endpoint accepts only POST.')
          writeJson(res, 200, await controller.cancel(attemptId(await readJson(req))))
          return
        }
        if (path === `${OAUTH_ROUTE_PATH}/logout`) {
          if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This OAuth endpoint accepts only POST.')
          const body = await readJson(req)
          if (!exactKeys(body, [])) throw new HttpError(400, 'INVALID_BODY', 'Logout request body must be empty.')
          writeJson(res, 200, await controller.logout())
          return
        }
        throw new HttpError(404, 'NOT_FOUND', 'OAuth endpoint not found.')
      } catch (error) {
        const mapped = error instanceof HttpError
          ? error
          : error instanceof AuthControllerError
            ? mappedControllerError(error)
            : new HttpError(500, 'OAUTH_INTERNAL_ERROR', 'OpenAI OAuth operation failed.')
        writeJson(res, mapped.status, errorBody(mapped), mapped.status === 405 ? { allow: path.endsWith('/status') ? 'GET' : 'POST' } : {})
      }
    },
  }
}
