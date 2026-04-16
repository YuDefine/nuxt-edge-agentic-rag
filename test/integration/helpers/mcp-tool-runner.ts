import { createMcpTokenStore } from '#server/utils/mcp-token-store'
import {
  runMcpMiddleware,
  type McpTokenStoreLike,
  type UserRoleLookupLike,
} from '#server/utils/mcp-middleware'

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
  /**
   * Override the B16 §6.2.b role lookup so contract tests that mock
   * `requireMcpBearerToken` (instead of providing a real `actor`) can
   * pass the role gate without hitting better-auth.
   */
  userRoleLookup?: UserRoleLookupLike
}

/**
 * Shared `UserRoleLookupLike` stub for contract tests that mock
 * `requireMcpBearerToken` upstream and just need the B16 §6.2.b role gate
 * to resolve to `admin` regardless of the stubbed `createdByUserId`.
 */
export const adminRoleLookup: UserRoleLookupLike = {
  async lookupRoleByUserId() {
    return 'admin'
  },
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
    // Migration 0008 made `created_by_user_id` NOT NULL. We key the stub
    // off the actor's web-session user id so the role gate (wired up by
    // `runMcpTool` with a stub `userRoleLookup`) can resolve the actor's
    // role without touching real better-auth state.
    createdByUserId: actor.webSession.user.id,
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
  // Match the stub token's `createdByUserId` so the B16 §6.2.b role gate
  // resolves to the actor's role instead of hitting better-auth. Contract
  // tests that mock `requireMcpBearerToken` upstream can pass their own
  // `userRoleLookup` to short-circuit the gate instead.
  const userRoleLookup: UserRoleLookupLike | undefined =
    options.userRoleLookup ??
    (actor
      ? {
          async lookupRoleByUserId(userId: string) {
            return userId === actor.webSession.user.id ? actor.webSession.user.role : null
          },
        }
      : undefined)

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
      userRoleLookup,
    })

    return (await tool.handler(args, {} as Parameters<TTool['handler']>[1])) as Awaited<
      ReturnType<TTool['handler']>
    >
  } finally {
    pendingEvent.current = null
  }
}
