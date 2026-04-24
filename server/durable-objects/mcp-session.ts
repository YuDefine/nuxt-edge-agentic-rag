/**
 * Task 4.2 / 4.3 — `MCPSessionDurableObject`
 *
 * Per-session Durable Object carrying MCP session state to eliminate the
 * Claude.ai re-init loop (TD-030 / Phase 1 spike root cause analysis in
 * `docs/solutions/mcp-streamable-http-session-durable-objects.md`).
 *
 * Storage schema (`this.ctx.storage`):
 *   session (McpSessionState): metadata object carrying sessionId / timestamps /
 *                              protocolVersion / capabilities / initializedServer
 *
 * Alarm: scheduled at `lastSeenAt + sessionTtlMs`; when it fires without any
 * intervening request, the DO deletes `session` so subsequent requests with
 * the same `Mcp-Session-Id` receive HTTP 404 with re-initialize guidance (per
 * spec requirement "Expired session returns 404 not 401").
 *
 * GET / DELETE are short-circuited to 405 with the same reasoning as the
 * stateless shim (MCP spec 2025-11-25 allows a server to decline SSE stream
 * establishment and client-initiated session termination).
 *
 * NOTE: this module imports from `cloudflare:workers` (module-style DO
 * handler). Tests that exercise the class via TS `new MCPSessionDurableObject`
 * provide a fake `ctx` / `env` — the class only touches ctx.storage and
 * relies on no runtime Cloudflare platform features beyond what we stub.
 */

import { DEFAULT_MCP_SESSION_TTL_MS, parsePositiveInteger } from '#shared/schemas/knowledge-runtime'

export interface McpSessionState {
  sessionId: string
  protocolVersion: string | null
  capabilities: Record<string, unknown>
  createdAt: number
  lastSeenAt: number
  initializedServer: boolean
}

export interface McpSessionDurableObjectEnv {
  NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS?: string | number
  // Additional bindings (DB, KV, AI, BLOB) will be accessed in
  // follow-up work when tool handlers run inside the DO. Keeping the
  // interface minimal here; future extension is non-breaking.
  [key: string]: unknown
}

interface JsonRpcEnvelope {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

const STORAGE_KEY_SESSION = 'session'
const METHOD_NOT_ALLOWED_HEADERS = {
  'Content-Type': 'application/json',
  Allow: 'POST',
} as const
const JSON_RPC_METHOD_NOT_ALLOWED_CODE = -32000
const JSON_RPC_INVALID_REQUEST_CODE = -32600
const JSON_RPC_METHOD_NOT_FOUND_CODE = -32601

function buildMethodNotAllowedBody(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: JSON_RPC_METHOD_NOT_ALLOWED_CODE,
      message:
        'Method Not Allowed. MCP session Durable Object accepts POST only (spec 2025-11-25).',
    },
    id: null,
  })
}

function buildSessionExpiredBody(message: string, requestId: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: JSON_RPC_INVALID_REQUEST_CODE,
      message,
    },
    id: requestId ?? null,
  })
}

function resolveTtlMs(env: McpSessionDurableObjectEnv): number {
  return parsePositiveInteger(env.NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS, DEFAULT_MCP_SESSION_TTL_MS)
}

export class MCPSessionDurableObject {
  private readonly ctx: DurableObjectState
  private readonly env: McpSessionDurableObjectEnv
  private readonly now: () => number

  constructor(
    ctx: DurableObjectState,
    env: McpSessionDurableObjectEnv,
    now: () => number = Date.now,
  ) {
    this.ctx = ctx
    this.env = env
    this.now = now
  }

  async fetch(request: Request): Promise<Response> {
    // GET / DELETE / HEAD / OPTIONS / PUT / PATCH all rejected — MCP spec
    // 2025-11-25 lets a stateless transport decline SSE (GET) and client
    // session termination (DELETE); the DO accepts JSON-RPC POST only.
    if (request.method !== 'POST') {
      return new Response(buildMethodNotAllowedBody(), {
        status: 405,
        headers: METHOD_NOT_ALLOWED_HEADERS,
      })
    }

    const sessionId = request.headers.get('Mcp-Session-Id') ?? this.ctx.id.toString()
    const envelope = await request
      .clone()
      .json()
      .catch(() => null as JsonRpcEnvelope | null)

    if (!envelope || typeof envelope !== 'object') {
      return new Response(
        buildSessionExpiredBody('Invalid JSON-RPC envelope. Re-initialize the session.', null),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const method = typeof envelope.method === 'string' ? envelope.method : ''
    const requestId = 'id' in envelope ? envelope.id : null

    const existing = await this.ctx.storage.get<McpSessionState>(STORAGE_KEY_SESSION)
    const ttlMs = resolveTtlMs(this.env)
    const now = this.now()

    if (method === 'initialize') {
      const session = this.buildInitializedSession(sessionId, envelope, existing, now)
      await this.ctx.storage.put<McpSessionState>(STORAGE_KEY_SESSION, session)
      await this.ctx.storage.setAlarm(now + ttlMs)
      return this.buildInitializeResponse(session, requestId)
    }

    if (!existing) {
      return new Response(
        buildSessionExpiredBody(
          'Session not found. Please re-initialize the MCP session with a new initialize request.',
          requestId,
        ),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    const renewed: McpSessionState = { ...existing, lastSeenAt: now }
    await this.ctx.storage.put<McpSessionState>(STORAGE_KEY_SESSION, renewed)
    await this.ctx.storage.setAlarm(now + ttlMs)

    // @followup[TD-041] — Tool dispatch via DoJsonRpcTransport is out of scope
    // for `upgrade-mcp-to-durable-objects` (C-path scope trim 2026-04-24). This
    // change delivers session lifecycle only (create / touch / alarm GC / 404
    // on missing). Wire-up of `McpServer` + `server.connect(transport)` +
    // auth/env plumbing lands in the follow-up change `wire-do-tool-dispatch`.
    //
    // Until then any non-initialize request returns an explicit JSON-RPC
    // `-32601 Method not found` so an accidental `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`
    // flip in production fails loudly (Claude.ai surfaces "Error occurred
    // during tool execution") instead of silently returning a synthetic ack
    // that would masquerade as success.
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: requestId ?? null,
        error: {
          code: JSON_RPC_METHOD_NOT_FOUND_CODE,
          message:
            'Tool dispatch via MCP Session Durable Object is not yet implemented. ' +
            'Set NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=false to fall back to the stateless ' +
            'MCP handler while the wire-do-tool-dispatch change is pending.',
          data: {
            method,
            followup: 'TD-041',
            sessionLifecycle: 'ok',
            toolDispatch: 'not_implemented',
          },
        },
      }),
      {
        status: 501,
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': renewed.sessionId,
        },
      },
    )
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll()
  }

  private buildInitializedSession(
    sessionId: string,
    envelope: JsonRpcEnvelope,
    existing: McpSessionState | undefined,
    now: number,
  ): McpSessionState {
    const params = (envelope.params ?? {}) as {
      protocolVersion?: unknown
      capabilities?: unknown
    }

    const protocolVersion =
      typeof params.protocolVersion === 'string' ? params.protocolVersion : null
    const capabilities =
      params.capabilities && typeof params.capabilities === 'object'
        ? (params.capabilities as Record<string, unknown>)
        : {}

    return {
      sessionId,
      protocolVersion,
      capabilities,
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
      initializedServer: true,
    }
  }

  private buildInitializeResponse(session: McpSessionState, requestId: unknown): Response {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: requestId ?? null,
        result: {
          protocolVersion: session.protocolVersion ?? '2025-06-18',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'nuxt-edge-agentic-rag',
            version: '0.0.0',
          },
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': session.sessionId,
        },
      },
    )
  }
}
