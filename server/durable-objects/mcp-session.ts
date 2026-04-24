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

import { DEFAULT_MCP_SESSION_TTL_MS, parsePositiveInteger } from '#shared/schemas/knowledge-runtime'
import { DoJsonRpcTransport } from '#server/durable-objects/mcp-do-transport'
import {
  createDoMcpEventShim,
  getActiveDoMcpEventShim,
  installEnumerableSafeDoEnv,
  runWithDoMcpEventShim,
} from '#server/durable-objects/mcp-event-shim'
import {
  MCP_AUTH_CONTEXT_HEADER,
  resolveMcpAuthSigningKey,
  verifyAuthContextEnvelope,
} from '#server/utils/mcp-auth-context-codec'

import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

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
  Allow: 'POST',
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

export class MCPSessionDurableObject {
  private readonly ctx: DurableObjectState
  private readonly env: McpSessionDurableObjectEnv
  private readonly now: () => number
  private mcpServer: McpServer | null = null
  private transport: DoJsonRpcTransport | null = null

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

    const authResult = await this.verifyForwardedAuthContext(request, requestId, now)
    if (!authResult.ok) {
      return authResult.response
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

    const expiresAt = session.lastSeenAt + resolveTtlMs(this.env)
    if (this.now() < expiresAt) {
      await this.ctx.storage.setAlarm(expiresAt)
      return
    }

    await this.closeTransport()
    await this.ctx.storage.deleteAll()
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

    const transport = new DoJsonRpcTransport()
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
