import { createMcpTokenStore } from '#server/utils/mcp-token-store'
import { runMcpMiddleware, type McpTokenStoreLike } from '#server/utils/mcp-middleware'

import type { AcceptanceActorFixture } from '../../acceptance/helpers/auth'

import { createRouteEvent } from './nuxt-route'

/**
 * Runs the `/mcp` JSON-RPC pipeline for an individual tool after the
 * `@nuxtjs/mcp-toolkit` migration:
 *   1. Caller MUST have mocked `nitropack/runtime` in the test module so
 *      `useEvent()` returns the event stored in the provided
 *      `pendingEventHolder` (see `mcp-routes.test.ts` for the hoisted
 *      factory pattern).
 *   2. Execute {@link runMcpMiddleware} to authenticate the Bearer token
 *      and consume the rate limit (writing `event.context.mcpAuth`) —
 *      equivalent to what the toolkit handler does on every `/mcp` request.
 *   3. Invoke the tool handler with the JSON-RPC arguments and return its
 *      raw result. The toolkit wraps the value into `CallToolResult` on the
 *      wire; tests assert the inner payload directly.
 */
export interface McpPendingEventHolder {
  current: unknown
}

export interface McpToolRunOptions {
  /**
   * Acceptance actor fixture; when provided, the runner auto-builds both
   * `authorizationHeader` and an in-memory `tokenStore` stub mapping the
   * actor's `tokenHash` → full `McpTokenRecord`. Takes precedence over
   * the individual `authorizationHeader` / `tokenStore` fields.
   *
   * Why this exists: TD-001 migrated `createMcpTokenStore` to Drizzle,
   * which requires a populated `schema.mcpTokens` table to resolve. The
   * `createHubDbMock` helper returns an empty `schema` object so the
   * real token lookup throws before the bearer token check reaches
   * `event.context.mcpAuth`. Passing `actor` short-circuits this.
   */
  actor?: AcceptanceActorFixture
  authorizationHeader?: string
  cloudflareEnv?: Record<string, unknown>
  contextOverrides?: Record<string, unknown>
  environment?: string
  kvBindingName?: string
  params?: Record<string, string>
  pendingEvent: McpPendingEventHolder
  tokenStore?: McpTokenStoreLike
}

/**
 * Build an in-memory `McpTokenStoreLike` that accepts exactly one token —
 * the one owned by `actor`. Any other hash / environment returns null,
 * matching production behavior. `touchLastUsedAt` is a no-op.
 */
export function createStubMcpTokenStoreFromActor(
  actor: AcceptanceActorFixture,
  environment = 'local',
): McpTokenStoreLike {
  const record = {
    createdAt: '2026-04-16T00:00:00.000Z',
    // B16 §6.2.b role gate bypasses `createdByUserId === null` as legacy
    // system seed. Acceptance tests predate B16 and don't care about the
    // role × guest_policy matrix, so we treat stub tokens as legacy to
    // skip the role lookup (which would require an additional drizzle
    // mock for `user.role`). Tests that DO want to exercise B16 can
    // build their own `McpTokenStoreLike` stub and pass `tokenStore`
    // directly.
    createdByUserId: null,
    environment,
    expiresAt: null,
    id: actor.mcpAuth.tokenId,
    lastUsedAt: null,
    name: actor.mcpToken.record.name,
    revokedAt: null,
    revokedReason: null,
    scopesJson: actor.mcpToken.record.scopesJson,
    status: 'active',
    tokenHash: actor.mcpToken.record.tokenHash,
  }

  return {
    findUsableTokenByHash: async (tokenHash, env) =>
      tokenHash === record.tokenHash && env === record.environment ? record : null,
    touchLastUsedAt: async () => {},
  }
}

interface ToolLike {
  handler: (...args: any[]) => any
  name?: string
}

export async function runMcpTool<TTool extends ToolLike>(
  tool: TTool,
  args: Parameters<TTool['handler']>[0],
  options: McpToolRunOptions,
): Promise<Awaited<ReturnType<TTool['handler']>>> {
  const {
    actor,
    cloudflareEnv,
    contextOverrides,
    environment = 'local',
    kvBindingName = 'KV',
    params,
    pendingEvent,
  } = options
  const authorizationHeader =
    options.authorizationHeader ?? actor?.mcpToken.authorizationHeader ?? ''
  const tokenStore =
    options.tokenStore ??
    (actor ? createStubMcpTokenStoreFromActor(actor, environment) : createMcpTokenStore())

  const event = createRouteEvent({
    context: {
      cloudflare: { env: cloudflareEnv ?? {} },
      params: params ?? {},
      ...contextOverrides,
    },
    headers: {
      authorization: authorizationHeader,
    },
  })

  pendingEvent.current = event

  try {
    await runMcpMiddleware(event, {
      environment,
      extractToolNames: async () => (tool.name ? [tool.name] : []),
      kvBindingName,
      tokenStore,
    })

    return (await tool.handler(args, {} as Parameters<TTool['handler']>[1])) as Awaited<
      ReturnType<TTool['handler']>
    >
  } finally {
    pendingEvent.current = null
  }
}
