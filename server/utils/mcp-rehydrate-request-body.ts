import type { H3Event } from 'h3'
import { getRequestURL, readBody } from 'h3'

import { MCP_AUTH_CONTEXT_HEADER } from '#server/utils/mcp-auth-context-codec'

interface WebRequestEventShape {
  context?: {
    mcpAuthEnvelope?: string
  }
  req?: RequestLike
  web?: {
    request?: RequestLike
  }
}

interface RequestLike {
  headers: HeadersInit
  method: string
  url: string
}

/**
 * After `@nuxtjs/mcp-toolkit`'s `tagEvlogContext` and our middleware's
 * `extractToolNames` have read the JSON-RPC body, the Worker-native
 * `event.web.request` body stream is disturbed. Replace it with a fresh
 * `Request` whose body stream has not been consumed so the downstream MCP
 * transport (`toWebRequest(event)` → `transport.handleRequest(request)`) can
 * parse the JSON-RPC payload again.
 *
 * Uses `readBody(event)` which hits the H3 body cache populated by the
 * earlier reads — it does NOT re-drain the original stream.
 *
 * GET / HEAD / DELETE have no body to rehydrate, but the worker shim still
 * needs to forward `event.context.mcpAuthEnvelope` as the
 * `X-Mcp-Auth-Context` header so the DO can verify the auth context. Without
 * this injection, `mcp-agents-compat`'s GET/DELETE → DO branch falls through
 * to the stateless 405 path because the incoming client request only carries
 * `Authorization: Bearer` — the envelope header is added by us, not the
 * client. Skip the replay entirely when no envelope is present so legitimate
 * stateless 405 fallback (flag=false / no auth) still works.
 */
export async function rehydrateMcpRequestBody(event: H3Event): Promise<void> {
  const eventShape = event as unknown as WebRequestEventShape
  const original = eventShape.web?.request ?? eventShape.req
  if (!original) return

  const envelope = eventShape.context?.mcpAuthEnvelope
  const headers = new Headers(original.headers)
  if (envelope) {
    headers.set(MCP_AUTH_CONTEXT_HEADER, envelope)
  }

  if (original.method === 'GET' || original.method === 'HEAD' || original.method === 'DELETE') {
    if (!envelope) return
    // MCP Streamable HTTP spec 2025-11-25 confirms DELETE /mcp carries no body
    // (client-initiated session termination is signaled by method + Mcp-Session-Id
    // alone), so we drop body from the replay even though HTTP technically allows it.
    const replay = new Request(resolveReplayUrl(original.url, event), {
      method: original.method,
      headers,
    })
    installReplayRequest(event, replay)
    return
  }

  const parsed = await readBody(event)
  const bodyText =
    parsed === undefined || parsed === null
      ? ''
      : typeof parsed === 'string'
        ? parsed
        : JSON.stringify(parsed)

  const replay = new Request(resolveReplayUrl(original.url, event), {
    method: original.method,
    headers,
    body: bodyText,
    duplex: 'half',
  } as RequestInit)

  installReplayRequest(event, replay)
}

function resolveReplayUrl(url: string, event: H3Event): string {
  try {
    return new URL(url).href
  } catch {
    return new URL(url, resolveRequestOrigin(event)).href
  }
}

function resolveRequestOrigin(event: H3Event): string {
  try {
    return getRequestURL(event).origin
  } catch {
    const headers = (event as unknown as { headers?: Headers }).headers
    const host = headers?.get('host')
    if (!host) {
      throw new Error('Cannot resolve MCP replay request origin')
    }
    const protocol = headers?.get('x-forwarded-proto') ?? 'https'
    return `${protocol}://${host}`
  }
}

function installReplayRequest(event: H3Event, replay: Request): void {
  const target = event as unknown as { req?: Request; web?: { request?: Request } }

  try {
    target.req = replay
  } catch {
    Object.defineProperty(target, 'req', {
      configurable: true,
      enumerable: true,
      value: replay,
      writable: true,
    })
  }

  target.web ??= {}
  target.web.request = replay
}
