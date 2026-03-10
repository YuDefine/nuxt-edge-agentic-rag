import { z } from 'zod'

import { getCurrentMcpEvent } from '#server/utils/current-mcp-event'
import { getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getD1Database } from '#server/utils/database'
import { getAllowedAccessLevels, getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { requireMcpScope } from '#server/utils/mcp-auth'
import { createMcpCategoryStore, listCategories } from '#server/utils/mcp-categories'

import type { McpAuthContext } from '#server/utils/mcp-middleware'

const inputShape = {
  includeCounts: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include document counts per category when true.'),
}

export default defineMcpTool({
  name: 'listCategories',
  title: 'List knowledge categories',
  description:
    'List the knowledge categories visible to the caller, optionally including document counts per category.',
  inputSchema: inputShape,
  handler: async (args: { includeCounts?: boolean }) => {
    const event = await getCurrentMcpEvent()
    const auth = requireMcpAuth(event)

    requireMcpScope(auth, 'knowledge.category.list')

    const runtimeConfig = getKnowledgeRuntimeConfig()
    const database = await getD1Database()

    // Touch KV binding to mirror the legacy handler's binding-health signal.
    getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)

    const allowedAccessLevels = getAllowedAccessLevels({
      channel: 'mcp',
      isAuthenticated: true,
      tokenScopes: auth.scopes,
    })

    return listCategories(
      {
        allowedAccessLevels,
        includeCounts: args.includeCounts ?? false,
      },
      {
        store: createMcpCategoryStore(database),
      }
    )
  },
})

function requireMcpAuth(event: {
  context: Record<string, unknown> & { mcpAuth?: McpAuthContext }
}): McpAuthContext {
  const auth = event.context.mcpAuth
  if (!auth) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'MCP auth context is missing',
    })
  }

  return auth
}
