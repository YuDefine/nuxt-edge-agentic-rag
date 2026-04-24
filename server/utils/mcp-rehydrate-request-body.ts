import type { H3Event } from 'h3'
import { readBody } from 'h3'

import { MCP_AUTH_CONTEXT_HEADER } from '#server/utils/mcp-auth-context-codec'

interface WebRequestEventShape {
  context?: {
    mcpAuthEnvelope?: string
  }
  req?: Request
  web?: {
    request?: Request
  }
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
 */
export async function rehydrateMcpRequestBody(event: H3Event): Promise<void> {
  const eventShape = event as unknown as WebRequestEventShape
  const original = eventShape.web?.request ?? eventShape.req
  if (!original) return
  if (original.method === 'GET' || original.method === 'HEAD') return

  const parsed = await readBody(event)
  const bodyText =
    parsed === undefined || parsed === null
      ? ''
      : typeof parsed === 'string'
        ? parsed
        : JSON.stringify(parsed)

  const headers = new Headers(original.headers)
  const envelope = (event as unknown as WebRequestEventShape).context?.mcpAuthEnvelope
  if (envelope) {
    headers.set(MCP_AUTH_CONTEXT_HEADER, envelope)
  }

  const replay = new Request(original.url, {
    method: original.method,
    headers,
    body: bodyText,
    duplex: 'half',
  } as RequestInit)

  const target = event as unknown as { req?: Request; web?: { request?: Request } }
  target.req = replay
  target.web ??= {}
  target.web.request = replay
}
