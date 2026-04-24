import type { H3Event } from 'h3'

import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { getMcpAuthSigningKey } from '#server/utils/mcp-auth-context-codec'
import { runMcpMiddleware } from '#server/utils/mcp-middleware'
import { rehydrateMcpRequestBody } from '#server/utils/mcp-rehydrate-request-body'
import { createMcpTokenStore } from '#server/utils/mcp-token-store'

/**
 * Default handler for the `/mcp` MCP JSON-RPC endpoint.
 *
 * The handler composes three layers:
 *
 * 1. `middleware` — authenticates the Bearer token, extracts the target tool
 *    name from the JSON-RPC body, and enforces the per-token rate limit.
 *    Throws 401 / 429 directly to the client before any tool handler runs.
 * 2. `resolveDynamicDefinitions` — picks up tool definitions discovered from
 *    `server/mcp/tools/` (populated during §2 of the migration change).
 * 3. Tool handler — individual tools enforce their own scope using the
 *    `event.context.mcpAuth` populated by the middleware.
 *
 * After the middleware, `rehydrateMcpRequestBody` replaces `event.web.request`
 * with a fresh `Request` whose body stream has not been consumed. The upstream
 * toolkit (and our middleware) call `readBody(event)` for audit / rate-limit /
 * tool-name extraction, which drains the Worker-native Request's body stream.
 * Without this rehydration the downstream MCP transport calls
 * `toWebRequest(event)` → `handleRequest(request)` and the SDK fails to parse
 * JSON-RPC from the disturbed stream, returning HTTP 400 / parse_error.
 */
export default defineMcpHandler({
  middleware: async (event) => {
    const runtimeConfig = getKnowledgeRuntimeConfig()

    await runMcpMiddleware(event, {
      authSigningKey: getMcpAuthSigningKey(event as unknown as H3Event),
      environment: runtimeConfig.environment,
      extractToolNames,
      kvBindingName: runtimeConfig.bindings.rateLimitKv,
      tokenStore: createMcpTokenStore(),
    })

    await rehydrateMcpRequestBody(event as unknown as H3Event)
  },
})
