import { createMcpTokenStore } from '#server/utils/mcp-token-store'
import { runMcpMiddleware } from '#server/utils/mcp-middleware'

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
  authorizationHeader: string
  cloudflareEnv?: Record<string, unknown>
  contextOverrides?: Record<string, unknown>
  environment?: string
  kvBindingName?: string
  params?: Record<string, string>
  pendingEvent: McpPendingEventHolder
}

interface ToolLike {
  handler: (args: unknown, extra: unknown) => unknown
  name?: string
}

export async function runMcpTool<Result = unknown>(
  tool: ToolLike,
  args: unknown,
  options: McpToolRunOptions
): Promise<Result> {
  const {
    authorizationHeader,
    cloudflareEnv,
    contextOverrides,
    environment = 'local',
    kvBindingName = 'KV',
    params,
    pendingEvent,
  } = options

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
      tokenStore: createMcpTokenStore(),
    })

    return (await tool.handler(args, {} as never)) as Result
  } finally {
    pendingEvent.current = null
  }
}
