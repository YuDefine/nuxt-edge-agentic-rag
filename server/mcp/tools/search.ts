import { z } from 'zod'

import { getCurrentMcpEvent } from '#server/utils/current-mcp-event'
import {
  createCloudflareAiSearchClient,
  type CloudflareAiBindingLike,
} from '#server/utils/ai-search'
import {
  getCloudflareEnv,
  getRequiredD1Binding,
  getRequiredKvBinding,
} from '#server/utils/cloudflare-bindings'
import { createKnowledgeEvidenceStore } from '#server/utils/knowledge-evidence-store'
import { retrieveVerifiedEvidence } from '#server/utils/knowledge-retrieval'
import { getAllowedAccessLevels, getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { requireMcpScope } from '#server/utils/mcp-auth'
import { searchKnowledge } from '#server/utils/mcp-search'

import type { McpAuthContext } from '#server/utils/mcp-middleware'

const inputShape = {
  query: z
    .string()
    .trim()
    .min(1, 'query is required')
    .max(2000, 'query must be 2000 characters or fewer'),
}

export default defineMcpTool({
  name: 'searchKnowledge',
  title: 'Search the knowledge base',
  description:
    'Search governed knowledge sources for the most relevant passages given a natural-language query.',
  inputSchema: inputShape,
  handler: async (args: { query: string }) => {
    const event = await getCurrentMcpEvent()
    const auth = requireMcpAuth(event)

    requireMcpScope(auth, 'knowledge.search')

    const runtimeConfig = getKnowledgeRuntimeConfig()
    const database = getRequiredD1Binding(event, runtimeConfig.bindings.d1Database)

    // Touch KV binding to mirror the legacy handler's binding-health signal;
    // rate limiting itself runs in the middleware.
    getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)

    const allowedAccessLevels = getAllowedAccessLevels({
      channel: 'mcp',
      isAuthenticated: true,
      tokenScopes: auth.scopes,
    })

    const aiBinding = getRequiredAiBinding(event)

    return searchKnowledge(
      {
        allowedAccessLevels,
        query: args.query,
      },
      {
        retrieve: (input) =>
          retrieveVerifiedEvidence(input, {
            governance: runtimeConfig.governance,
            search: createCloudflareAiSearchClient({
              aiBinding,
              indexName: runtimeConfig.bindings.aiSearchIndex,
              gatewayConfig: runtimeConfig.aiGateway,
            }).search,
            store: createKnowledgeEvidenceStore(database),
          }),
      },
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

function getRequiredAiBinding(event: {
  context: Record<string, unknown> & { cloudflare?: { env?: Record<string, unknown> } }
}): CloudflareAiBindingLike {
  const binding = getCloudflareEnv(event).AI

  if (!binding || typeof (binding as { autorag?: unknown }).autorag !== 'function') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Cloudflare AI binding "AI" is not available',
    })
  }

  return binding as CloudflareAiBindingLike
}
