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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DurableObject } from 'cloudflare:workers'

import { DEFAULT_MCP_SESSION_TTL_MS, parsePositiveInteger } from '#shared/schemas/knowledge-runtime'
import { DoJsonRpcTransport } from '#server/durable-objects/mcp-do-transport'
import {
  clearAllSseEvents,
  cleanupExpiredEvents,
  createDoMcpEventShim,
  decodeEventId,
  encodeEventId,
  enqueueSseEvent,
  enforceEventQuota,
  getActiveDoMcpEventShim,
  installEnumerableSafeDoEnv,
  listEventsAfter,
  runWithDoMcpEventShim,
  SSE_EVENT_TTL_MS,
  type SseEventRow,
} from '#server/durable-objects/mcp-event-shim'
import {
  MCP_AUTH_CONTEXT_HEADER,
  resolveMcpAuthSigningKey,
  verifyAuthContextEnvelope,
} from '#server/utils/mcp-auth-context-codec'
import {
  MCP_INVALIDATE_HEADER,
  verifyInvalidateHeader,
} from '#server/utils/mcp-internal-invalidate'
import { appendSessionId } from '#server/utils/mcp-token-session-index'

import type { KvBindingLike } from '#server/utils/cloudflare-bindings'

import type { CallToolResult, JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

export interface McpSessionState {
  sessionId: string
  protocolVersion: string | null
  capabilities: Record<string, unknown>
  createdAt: number
  lastSeenAt: number
  initializedServer: boolean
  // Bound at initialize from the verified MCP auth-context envelope. Subsequent
  // POST/GET/DELETE on this session ID MUST present an envelope whose
  // principal.userId matches; mismatches are rejected with 403 to defend
  // against Mcp-Session-Id leakage (log scrape, browser-shared link).
  ownerUserId: string
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

interface McpToolDefinition {
  _meta?: Record<string, unknown>
  annotations?: Record<string, unknown>
  description?: string
  handler: (...args: never[]) => unknown
  inputExamples?: unknown[]
  inputSchema?: Record<string, unknown>
  name: string
  outputSchema?: Record<string, unknown>
  tags?: string[]
  title?: string
}

const STORAGE_KEY_SESSION = 'session'
const METHOD_NOT_ALLOWED_HEADERS = {
  'Content-Type': 'application/json',
  Allow: 'POST, GET, DELETE',
} as const
const SSE_HEARTBEAT_INTERVAL_MS = 25_000
const SSE_RETRY_HINT_MS = 3_000
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const
const JSON_RPC_METHOD_NOT_ALLOWED_CODE = -32000
const JSON_RPC_INVALID_REQUEST_CODE = -32600
const JSON_RPC_AUTH_CONTEXT_CODE = -32001
const JSON_RPC_INTERNAL_ERROR_CODE = -32603
const TOOL_EXECUTION_FAILED_MESSAGE = 'Tool execution failed. Please retry later.'
const DO_DISPATCH_FAILED_MESSAGE = 'MCP request failed. Please retry later.'

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

function buildJsonRpcErrorBody(code: number, message: string, requestId: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code,
      message,
    },
    id: requestId ?? null,
  })
}

function isCallToolResult(value: Record<string, unknown>): boolean {
  return (
    ('content' in value && Array.isArray(value.content)) ||
    'structuredContent' in value ||
    'isError' in value
  )
}

function normalizeToolResult(result: unknown): CallToolResult {
  if (typeof result === 'string') {
    return { content: [{ type: 'text', text: result }] }
  }

  if (typeof result === 'number' || typeof result === 'boolean') {
    return { content: [{ type: 'text', text: String(result) }] }
  }

  if (typeof result === 'object' && result !== null && !isCallToolResult(result as never)) {
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }

  const callResult = result as CallToolResult
  if (callResult.isError && !callResult.content?.length) {
    const fallbackText = callResult.structuredContent
      ? JSON.stringify(callResult.structuredContent)
      : 'Tool execution failed'
    return { ...callResult, content: [{ type: 'text', text: fallbackText }] }
  }

  if (callResult.structuredContent && !callResult.content?.length) {
    return {
      ...callResult,
      content: [{ type: 'text', text: JSON.stringify(callResult.structuredContent) }],
    }
  }

  return callResult
}

function normalizeErrorToResult(error: unknown): CallToolResult {
  logDoError(error, 'mcp-do-tool-handler')
  return { content: [{ type: 'text', text: TOOL_EXECUTION_FAILED_MESSAGE }], isError: true }
}

function logDoError(error: unknown, step: string): void {
  const log = getActiveDoMcpEventShim()?.context?.log as
    | { error?: (error: Error, fields?: Record<string, unknown>) => void }
    | undefined
  if (!log?.error) {
    return
  }

  log.error(error instanceof Error ? error : new Error(String(error)), { step })
}

function registerToolFromDefinition(server: McpServer, tool: McpToolDefinition): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as never,
      outputSchema: tool.outputSchema as never,
      annotations: tool.annotations as never,
      _meta: {
        ...tool._meta,
        ...(tool.inputExamples ? { inputExamples: tool.inputExamples } : {}),
        ...(tool.tags?.length ? { tags: tool.tags } : {}),
      },
    },
    async (...args: never[]) => {
      try {
        return normalizeToolResult(await tool.handler(...args))
      } catch (error) {
        return normalizeErrorToResult(error)
      }
    },
  )
}

function ensureDefineMcpToolGlobal(): void {
  const globals = globalThis as typeof globalThis & {
    defineMcpTool?: (definition: McpToolDefinition) => McpToolDefinition
  }
  globals.defineMcpTool ??= (definition) => definition
}

async function loadKnowledgeToolDefinitions(): Promise<McpToolDefinition[]> {
  ensureDefineMcpToolGlobal()
  const [askKnowledge, searchKnowledge, getDocumentChunk, listCategories] = await Promise.all([
    import('#server/mcp/tools/ask'),
    import('#server/mcp/tools/search'),
    import('#server/mcp/tools/get-document-chunk'),
    import('#server/mcp/tools/categories'),
  ])

  return [
    askKnowledge.default,
    searchKnowledge.default,
    getDocumentChunk.default,
    listCategories.default,
  ] as McpToolDefinition[]
}

function resolveTtlMs(env: McpSessionDurableObjectEnv): number {
  return parsePositiveInteger(env.NUXT_KNOWLEDGE_MCP_SESSION_TTL_MS, DEFAULT_MCP_SESSION_TTL_MS)
}

interface SseWriterEntry {
  connectionId: string
  // Underlying ReadableStream controller. Synchronous `enqueue(chunk)` does
  // not block on backpressure or interact with the workerd integer-coercion
  // path that broke the previous TransformStream/writer pattern (v0.44.0
  // staging trace). The default controller is exposed by `start(controller)`
  // and survives the closure scope until cleanup.
  controller: ReadableStreamDefaultController<Uint8Array>
  heartbeatAlive: boolean
  // Settled when this connection ends (write failure / explicit close / session
  // expiry). Used as `ctx.waitUntil(lifetime)` to keep the DO instance alive
  // for the duration of the SSE stream — without it the runtime may GC pending
  // setTimeout/heartbeat promises after fetch returns the Response. See
  // design.md `## SSE Architecture` invariant on stream lifecycle.
  lifetime: Promise<void>
  resolveLifetime: () => void
}

export class MCPSessionDurableObject extends DurableObject<McpSessionDurableObjectEnv> {
  private readonly ctx: DurableObjectState
  private readonly env: McpSessionDurableObjectEnv
  private readonly now: () => number
  private readonly encoder = new TextEncoder()
  private mcpServer: McpServer | null = null
  private transport: DoJsonRpcTransport | null = null
  private readonly writers = new Map<string, SseWriterEntry>()
  private activeConnectionId: string | null = null

  constructor(
    ctx: DurableObjectState,
    env: McpSessionDurableObjectEnv,
    now: () => number = Date.now,
  ) {
    super(ctx, env)
    this.ctx = ctx
    this.env = env
    this.now = now
  }

  async fetch(request: Request): Promise<Response> {
    // Internal invalidate bypass — used by the admin token-revoke cascade
    // cleanup path (`server/api/admin/mcp-tokens/[id].delete.ts`). Trust
    // anchor: HMAC over `<sessionId>|<timestampMs>` using the shared
    // `NUXT_MCP_AUTH_SIGNING_KEY`. Bypasses the forwarded auth-context check
    // because admin/system flow has no user session envelope; HMAC + 60s skew
    // window is the trust boundary instead. Method-agnostic so callers can
    // POST a body-less invalidate request without coordinating verbs.
    const invalidateHeaderValue = request.headers.get(MCP_INVALIDATE_HEADER)
    if (invalidateHeaderValue) {
      return this.handleInvalidate(request, invalidateHeaderValue)
    }

    // Streamable HTTP (spec 2025-11-25) supports POST for JSON-RPC requests,
    // GET for server-initiated SSE streams, and DELETE for client-initiated
    // session termination. All other methods are rejected.
    if (request.method === 'GET') {
      return this.handleGet(request)
    }
    if (request.method === 'DELETE') {
      return this.handleDelete(request)
    }
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
      // Trust boundary: DO independently validates the forwarded auth-context
      // envelope on initialize too — worker shim already validates, but direct
      // DO hits must not bypass.
      const authResult = await this.verifyForwardedAuthContext(request, requestId, now)
      if (!authResult.ok) {
        return authResult.response
      }
      const callerUserId = authResult.auth.principal.userId
      // If a session already exists with a different owner, reject. Prevents
      // an attacker who learned a Mcp-Session-Id from re-initializing it under
      // their own user.
      if (existing && existing.ownerUserId !== callerUserId) {
        return this.buildOwnershipMismatchResponse(requestId)
      }
      const session = this.buildInitializedSession(sessionId, envelope, existing, now, callerUserId)
      await this.ctx.storage.put<McpSessionState>(STORAGE_KEY_SESSION, session)
      await this.ctx.storage.setAlarm(now + ttlMs)
      // Best-effort token→session index for the admin revoke cascade-cleanup
      // path (TD-040). KV failures are swallowed; the DO TTL alarm is the
      // safety net if cascade cleanup never reaches this session.
      await this.recordSessionForToken(authResult.auth.tokenId, session.sessionId)
      return this.buildInitializeResponse(session, requestId)
    }

    // Non-initialize on a missing session — short-circuit 404 without
    // auth verification. There is no state to protect; the sessionId is
    // a 122-bit random UUID that is not enumerable, so 404 leaks nothing.
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

    const authResult = await this.verifyForwardedAuthContext(request, requestId, now)
    if (!authResult.ok) {
      return authResult.response
    }
    if (existing.ownerUserId !== authResult.auth.principal.userId) {
      return this.buildOwnershipMismatchResponse(requestId)
    }

    const renewed: McpSessionState = { ...existing, lastSeenAt: now }
    await this.ctx.storage.put<McpSessionState>(STORAGE_KEY_SESSION, renewed)
    await this.ctx.storage.setAlarm(now + ttlMs)

    try {
      const transport = await this.getOrCreateTransport(renewed.sessionId)
      const shimEvent = createDoMcpEventShim({
        auth: authResult.auth,
        doEnv: this.env,
        request,
      })
      const responseMessage = await runWithDoMcpEventShim(shimEvent, () =>
        transport.dispatch(
          envelope as JSONRPCMessage,
          {
            authInfo: authResult.auth,
            requestInfo: {
              headers: Object.fromEntries(request.headers.entries()),
            },
          } as never,
        ),
      )

      return new Response(JSON.stringify(responseMessage), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': renewed.sessionId,
        },
      })
    } catch (error) {
      logDoError(error, 'mcp-do-dispatch')

      return new Response(
        buildJsonRpcErrorBody(JSON_RPC_INTERNAL_ERROR_CODE, DO_DISPATCH_FAILED_MESSAGE, requestId),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Mcp-Session-Id': renewed.sessionId,
          },
        },
      )
    }
  }

  async alarm(): Promise<void> {
    const session = await this.ctx.storage.get<McpSessionState>(STORAGE_KEY_SESSION)
    if (!session) {
      return
    }

    // Housekeeping on every alarm fire: drop events older than the TTL so that
    // reconnecting clients with a stale `Last-Event-Id` see `events_dropped`
    // promptly instead of depending on session expiration alone.
    await cleanupExpiredEvents(this.ctx.storage, SSE_EVENT_TTL_MS, this.now())

    const expiresAt = session.lastSeenAt + resolveTtlMs(this.env)
    if (this.now() < expiresAt) {
      await this.ctx.storage.setAlarm(expiresAt)
      return
    }

    await this.closeAllSseWriters('session_expired')
    await this.closeTransport()
    await this.ctx.storage.deleteAll()
  }

  private async handleGet(request: Request): Promise<Response> {
    const existing = await this.ctx.storage.get<McpSessionState>(STORAGE_KEY_SESSION)
    if (!existing) {
      return new Response(
        buildSessionExpiredBody(
          'Session not found. Please re-initialize the MCP session with a new initialize request.',
          null,
        ),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const authResult = await this.verifyForwardedAuthContext(request, null, this.now())
    if (!authResult.ok) {
      return authResult.response
    }
    if (existing.ownerUserId !== authResult.auth.principal.userId) {
      return this.buildOwnershipMismatchResponse(null)
    }

    // Renew session lastSeenAt + alarm so long-lived SSE keeps the DO alive.
    const now = this.now()
    const renewed: McpSessionState = { ...existing, lastSeenAt: now }
    await this.ctx.storage.put<McpSessionState>(STORAGE_KEY_SESSION, renewed)
    await this.ctx.storage.setAlarm(now + resolveTtlMs(this.env))

    const connectionId = crypto.randomUUID()
    let resolveLifetime!: () => void
    const lifetime = new Promise<void>((resolve) => {
      resolveLifetime = resolve
    })

    // Use a plain ReadableStream with a `start(controller)` callback rather
    // than a TransformStream + writer.write pair. Reasons:
    //
    // 1. `controller.enqueue()` is synchronous — it never awaits backpressure
    //    or runs through the workerd internal integer-coercion path that
    //    rejected `TransformStream` highWaterMark=Infinity (v0.44.0 staging
    //    `TypeError: The value cannot be converted because it is not an integer.`
    //    cause: { remote: true }`).
    //
    // 2. `await writer.write(...)` blocks the fetch handler until the chunk
    //    is processed; in workerd that path can hang indefinitely waiting
    //    for the readable side to be drained, but the readable side is
    //    drained by the HTTP layer only AFTER the fetch handler returns the
    //    Response. The result is a deadlock observed empirically on
    //    v0.44.1 staging (5-minute timeout, 0 bytes received).
    //
    // 3. This mirrors the SDK reference implementation
    //    (@modelcontextprotocol/sdk webStandardStreamableHttp.js
    //    `handleGetRequest`) which has been validated in production
    //    Cloudflare Worker setups.
    //
    // Server-initiated push (`enqueueAndPushServerNotification`) and
    // heartbeat (`scheduleHeartbeat`) call `writeSseFrame` which now wraps
    // the synchronous `controller.enqueue()` call.
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const lastEventIdHeader = request.headers.get('Last-Event-Id')
    const eventsCapture: SseEventRow[] = []
    const invalidLastEventIdHeader =
      lastEventIdHeader && decodeEventId(lastEventIdHeader) === null ? lastEventIdHeader : null
    const lastCounter =
      lastEventIdHeader && !invalidLastEventIdHeader ? decodeEventId(lastEventIdHeader) : null
    if (lastCounter !== null) {
      eventsCapture.push(...(await listEventsAfter(this.ctx.storage, lastCounter)))
    }

    const readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        streamController = controller
        // Initial `: connected` comment per spec 2025-11-25 — synchronous
        // enqueue, no backpressure await, no workerd integer coercion.
        controller.enqueue(this.encoder.encode(`: connected\nretry: ${SSE_RETRY_HINT_MS}\n\n`))
        if (invalidLastEventIdHeader) {
          controller.enqueue(
            this.encoder.encode(
              this.formatEventRow({
                counter: 0,
                message: {
                  jsonrpc: '2.0',
                  method: 'notifications/events_dropped',
                  params: { reason: 'invalid_last_event_id', header: invalidLastEventIdHeader },
                },
                timestamp: now,
              } as SseEventRow),
            ),
          )
        }
        for (const row of eventsCapture) {
          controller.enqueue(this.encoder.encode(this.formatEventRow(row)))
        }
      },
      cancel: () => {
        this.removeWriter(connectionId)
      },
    })

    const entry: SseWriterEntry = {
      connectionId,
      controller: streamController,
      heartbeatAlive: true,
      lifetime,
      resolveLifetime,
    }
    this.writers.set(connectionId, entry)
    this.activeConnectionId = connectionId

    this.scheduleHeartbeat(connectionId)

    // Keep DO instance alive for the duration of the SSE stream. Without
    // ctx.waitUntil the runtime may GC the heartbeat / pending writes after
    // fetch returns. lifetime resolves when removeWriter / closeAllSseWriters
    // marks this connection as ended.
    this.ctx.waitUntil(lifetime)

    return new Response(readable, {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        'Mcp-Session-Id': renewed.sessionId,
      },
    })
  }

  private async recordSessionForToken(tokenId: string, sessionId: string): Promise<void> {
    if (!tokenId || !sessionId) {
      return
    }
    // The DO has direct access to the platform `env` so it skips Nitro's
    // `getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)` indirection.
    // The binding name must stay in lockstep with the admin revoke endpoint
    // (`server/api/admin/mcp-tokens/[id].delete.ts`) which reads from
    // `runtimeConfig.bindings.rateLimitKv` (defaults to `'KV'`,
    // overridable via `NUXT_KNOWLEDGE_RATE_LIMIT_KV`). Honour the override
    // so a non-default binding stays consistent end-to-end.
    const bindingName =
      typeof this.env.NUXT_KNOWLEDGE_RATE_LIMIT_KV === 'string' &&
      this.env.NUXT_KNOWLEDGE_RATE_LIMIT_KV.length > 0
        ? this.env.NUXT_KNOWLEDGE_RATE_LIMIT_KV
        : 'KV'
    const candidate = this.env[bindingName]
    if (
      !candidate ||
      typeof (candidate as { get?: unknown }).get !== 'function' ||
      typeof (candidate as { put?: unknown }).put !== 'function'
    ) {
      return
    }

    try {
      await appendSessionId(candidate as KvBindingLike, tokenId, sessionId)
    } catch (error) {
      logDoError(error, 'mcp-session-index-append')
    }
  }

  private async handleInvalidate(request: Request, headerValue: string): Promise<Response> {
    const signingKey = resolveMcpAuthSigningKey(this.env.NUXT_MCP_AUTH_SIGNING_KEY)
    const sessionId = request.headers.get('Mcp-Session-Id') ?? this.ctx.id.toString()
    const verified = await verifyInvalidateHeader(headerValue, {
      sessionId,
      secret: signingKey,
      now: this.now(),
    })

    if (!verified) {
      return new Response(JSON.stringify({ error: 'invalidate verification failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Cleanup mirrors `handleDelete` but without forwarded-auth verification:
    // close streams, drop transport, wipe SSE event log, deleteAll, deleteAlarm.
    await this.closeAllSseWriters('session_invalidated')
    await this.closeTransport()
    await clearAllSseEvents(this.ctx.storage)
    await this.ctx.storage.deleteAll()
    await this.ctx.storage.deleteAlarm()

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async handleDelete(request: Request): Promise<Response> {
    const existing = await this.ctx.storage.get<McpSessionState>(STORAGE_KEY_SESSION)
    if (!existing) {
      return new Response(null, { status: 204 })
    }

    const authResult = await this.verifyForwardedAuthContext(request, null, this.now())
    if (!authResult.ok) {
      return authResult.response
    }
    if (existing.ownerUserId !== authResult.auth.principal.userId) {
      return this.buildOwnershipMismatchResponse(null)
    }

    await this.closeAllSseWriters('session_deleted')
    await this.closeTransport()
    await clearAllSseEvents(this.ctx.storage)
    await this.ctx.storage.deleteAll()
    await this.ctx.storage.deleteAlarm()
    return new Response(null, { status: 204 })
  }

  private formatEventRow(row: SseEventRow): string {
    const id = encodeEventId(row.counter)
    const data = JSON.stringify(row.message)
    const eventLine = row.eventType ? `event: ${row.eventType}\n` : ''
    return `id: ${id}\n${eventLine}data: ${data}\n\n`
  }

  private writeSseFrame(entry: SseWriterEntry, frame: string): void {
    try {
      entry.controller.enqueue(this.encoder.encode(frame))
    } catch {
      // Controller throws if already closed/cancelled.
      this.removeWriter(entry.connectionId)
    }
  }

  private removeWriter(connectionId: string): void {
    const entry = this.writers.get(connectionId)
    if (entry) {
      entry.heartbeatAlive = false
      entry.resolveLifetime()
      this.writers.delete(connectionId)
    }
    if (this.activeConnectionId === connectionId) {
      this.activeConnectionId = this.pickNewestConnection()
    }
  }

  private pickNewestConnection(): string | null {
    // Map preserves insertion order; last inserted = newest active.
    let newest: string | null = null
    for (const key of this.writers.keys()) {
      newest = key
    }
    return newest
  }

  private scheduleHeartbeat(connectionId: string): void {
    const tick = async () => {
      await new Promise((resolve) => setTimeout(resolve, SSE_HEARTBEAT_INTERVAL_MS))
      const entry = this.writers.get(connectionId)
      if (!entry || !entry.heartbeatAlive) return
      this.writeSseFrame(entry, ': heartbeat\n\n')
      if (this.writers.has(connectionId)) {
        void tick()
      }
    }
    void tick()
  }

  private async closeAllSseWriters(reason: string): Promise<void> {
    const closeFrame = this.formatEventRow({
      counter: 0,
      message: {
        jsonrpc: '2.0',
        method: 'notifications/stream_closed',
        params: { reason },
      },
      timestamp: this.now(),
    } as SseEventRow)

    for (const entry of this.writers.values()) {
      entry.heartbeatAlive = false
      try {
        entry.controller.enqueue(this.encoder.encode(closeFrame))
        entry.controller.close()
      } catch {
        // Best-effort close; controller may already be closed/cancelled.
      } finally {
        entry.resolveLifetime()
      }
    }
    this.writers.clear()
    this.activeConnectionId = null
  }

  private async enqueueAndPushServerNotification(message: JSONRPCMessage): Promise<void> {
    // Notification delivery MUST NOT break the main RPC. Storage / quota
    // errors (D1 limit, eviction churn) are swallowed; a write failure on a
    // single SSE writer falls back to per-connection cleanup via writeSseFrame.
    try {
      const now = this.now()
      const { counter } = await enqueueSseEvent(this.ctx.storage, message, now)
      await enforceEventQuota(this.ctx.storage)

      const row: SseEventRow = { counter, message, timestamp: now }
      const frame = this.formatEventRow(row)

      // Broadcast to every active SSE writer (per spec MAY duplicate; client
      // is expected to dedupe by event id). Newest-active routing was rejected
      // because clients with multiple streams would silently miss events on
      // the non-newest stream.
      for (const entry of this.writers.values()) {
        this.writeSseFrame(entry, frame)
      }
    } catch (error) {
      logDoError(error, 'sse-enqueue-push')
    }
  }

  private async verifyForwardedAuthContext(
    request: Request,
    requestId: unknown,
    now: number,
  ): Promise<
    | { auth: NonNullable<Awaited<ReturnType<typeof verifyAuthContextEnvelope>>['auth']>; ok: true }
    | { ok: false; response: Response }
  > {
    const signingKey = resolveMcpAuthSigningKey(this.env.NUXT_MCP_AUTH_SIGNING_KEY)
    const header = request.headers.get(MCP_AUTH_CONTEXT_HEADER)
    const result = await verifyAuthContextEnvelope(header, signingKey, now)
    if (result.ok) {
      return { auth: result.auth, ok: true }
    }

    const status =
      result.reason === 'missing_header' || result.reason === 'malformed_envelope' ? 400 : 401
    const message =
      result.reason === 'expired'
        ? 'MCP auth context envelope expired'
        : `MCP auth context envelope verification failed: ${result.reason}`

    return {
      ok: false,
      response: new Response(
        buildJsonRpcErrorBody(JSON_RPC_AUTH_CONTEXT_CODE, message, requestId),
        {
          status,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    }
  }

  private async getOrCreateTransport(sessionId: string): Promise<DoJsonRpcTransport> {
    if (this.transport) {
      return this.transport
    }

    installEnumerableSafeDoEnv(this.env)

    const mcpServer = new McpServer({
      name: 'nuxt-edge-agentic-rag',
      version: '0.0.0',
    })
    for (const tool of await loadKnowledgeToolDefinitions()) {
      registerToolFromDefinition(mcpServer, tool)
    }

    const transport = new DoJsonRpcTransport({
      onServerNotification: async (message: JSONRPCMessage) => {
        await this.enqueueAndPushServerNotification(message)
      },
    })
    transport.sessionId = sessionId
    await mcpServer.connect(transport)

    this.mcpServer = mcpServer
    this.transport = transport

    return transport
  }

  private async closeTransport(): Promise<void> {
    await this.transport?.close()
    await this.mcpServer?.close()
    this.transport = null
    this.mcpServer = null
  }

  private buildInitializedSession(
    sessionId: string,
    envelope: JsonRpcEnvelope,
    existing: McpSessionState | undefined,
    now: number,
    ownerUserId: string,
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
      ownerUserId,
    }
  }

  private buildOwnershipMismatchResponse(requestId: unknown): Response {
    return new Response(
      buildJsonRpcErrorBody(
        JSON_RPC_AUTH_CONTEXT_CODE,
        'Session ownership mismatch. Re-initialize the MCP session.',
        requestId,
      ),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
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
