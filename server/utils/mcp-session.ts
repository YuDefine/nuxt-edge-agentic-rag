/**
 * Session-awareness helpers (Task 4.6 + Requirement "Stateless MCP
 * Authentication" expired-session scenario).
 *
 * When `features.mcpSession=true`, the stateful path is:
 *   Bearer auth (runMcpMiddleware)  →  forward to MCPSessionDurableObject
 *   ──────── 401 lives here ──────  ──────── 404 lives here ────────
 *
 * The middleware MUST return `401` only for token problems, never for
 * session-state staleness. A valid token paired with an expired / revoked /
 * unknown `Mcp-Session-Id` is handled by the Durable Object, which responds
 * with `404` + re-initialize guidance. This helper exposes the session-id
 * extraction used by both layers so the contract stays consistent.
 *
 * Active session invalidation on token revoke (e.g. admin UI flips a token to
 * `revoked`) is tracked as `@followup[TD-040]` — idle TTL alarm will GC the
 * session naturally, but immediate teardown needs a token → sessionId index
 * that today does not exist.
 */

interface McpHeaderCarrier {
  headers: Headers
}

export function extractMcpSessionIdFromEvent(event: McpHeaderCarrier): string | null {
  return event.headers.get('Mcp-Session-Id')
}
