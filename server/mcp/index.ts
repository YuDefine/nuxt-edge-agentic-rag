import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { runMcpMiddleware } from '#server/utils/mcp-middleware'
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
 */
export default defineMcpHandler({
  middleware: async (event) => {
    const runtimeConfig = getKnowledgeRuntimeConfig()

    await runMcpMiddleware(event, {
      environment: runtimeConfig.environment,
      extractToolNames,
      kvBindingName: runtimeConfig.bindings.rateLimitKv,
      tokenStore: createMcpTokenStore(),
    })
  },
})
