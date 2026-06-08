import { z } from 'zod/v4'

import { getCurrentMcpEvent } from '#server/utils/current-mcp-event'
import {
  createCloudflareAiSearchClient,
  type CloudflareAiSearchBindingLike,
} from '#server/utils/ai-search'
import { requireAiBinding, requireAiSearchBinding } from '#server/utils/ai-binding'
import { getRequiredD1Binding, getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { createKnowledgeEvidenceStore } from '#server/utils/knowledge-evidence-store'
import {
  isQueryRewritingEnabled,
  rewriteForRetrieval,
} from '#server/utils/knowledge-query-rewriter'
import { retrieveVerifiedEvidence } from '#server/utils/knowledge-retrieval'
import { getAllowedAccessLevels, getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { requireMcpScope } from '#server/utils/mcp-auth'
import { searchKnowledge } from '#server/utils/mcp-search'
import type { WorkersAiBindingLike } from '#server/utils/workers-ai'

import type { McpAuthContext } from '#server/utils/mcp-middleware'

const inputShape = {
  query: z
    .string()
    .trim()
    .min(1, 'query is required')
    .max(2000, 'query must be 2000 characters or fewer')
    .describe(
      'Natural-language search query for ranked passages from the governed knowledge corpus. Use when you need source snippets rather than a synthesized answer; maximum 2000 characters.',
    ),
}

export default defineMcpTool({
  name: 'searchKnowledge',
  title: 'Search the knowledge base',
  description:
    'Search governed knowledge sources for the most relevant passages given a natural-language query.',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  },
  inputSchema: inputShape,
  inputExamples: [
    { query: 'April launch readiness risks' },
    { query: 'Governance policy evidence publishing requirements' },
  ],
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

    const aiSearchBinding = getRequiredAiSearchBinding(event)

    return searchKnowledge(
      {
        allowedAccessLevels,
        query: args.query,
      },
      {
        retrieve: async (input) => {
          const useRewriter = input.useRewriter !== false && isQueryRewritingEnabled(runtimeConfig)
          // §S-FF (change rag-query-rewriting): only require the Workers AI
          // binding when the rewriter actually runs. Production keeps the
          // flag false, so deployments without the binding must not regress.
          const rewriter = useRewriter
            ? async function (normalized: string) {
                const workersAiBinding = getRequiredWorkersAiBinding(event)
                // searchKnowledge has no audit sink for rewriter telemetry,
                // so onUsage is omitted here on purpose.
                return rewriteForRetrieval(normalized, {
                  ai: workersAiBinding,
                  runtimeConfig,
                })
              }
            : undefined
          return retrieveVerifiedEvidence(
            {
              allowedAccessLevels: input.allowedAccessLevels,
              query: input.query,
            },
            {
              governance: runtimeConfig.governance,
              rewriter,
              search: createCloudflareAiSearchClient({
                aiSearchBinding,
                instanceId: getRequiredAiSearchInstanceId(runtimeConfig.bindings.aiSearchIndex),
                gatewayConfig: runtimeConfig.aiGateway,
              }).search,
              store: createKnowledgeEvidenceStore(database),
            },
          )
        },
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

function getRequiredAiSearchBinding(event: {
  context: Record<string, unknown> & { cloudflare?: { env?: Record<string, unknown> } }
}): CloudflareAiSearchBindingLike {
  return requireAiSearchBinding<CloudflareAiSearchBindingLike>(event)
}

function getRequiredWorkersAiBinding(event: {
  context: Record<string, unknown> & { cloudflare?: { env?: Record<string, unknown> } }
}): WorkersAiBindingLike {
  return requireAiBinding<WorkersAiBindingLike>(event, {
    method: 'run',
    message: 'Cloudflare Workers AI binding "AI" is not available',
  })
}

function getRequiredAiSearchInstanceId(instanceId: string): string {
  if (!instanceId) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Knowledge AI Search instance id is not configured',
    })
  }

  return instanceId
}
