import { z } from 'zod/v4'

import { getCurrentMcpEvent } from '#server/utils/current-mcp-event'
import {
  createCloudflareAiSearchClient,
  type CloudflareAiBindingLike,
} from '#server/utils/ai-search'
import { createCitationStore } from '#server/utils/citation-store'
import {
  getCloudflareEnv,
  getRequiredD1Binding,
  getRequiredKvBinding,
} from '#server/utils/cloudflare-bindings'
import { createKnowledgeAuditStore } from '#server/utils/knowledge-audit'
import { createKnowledgeEvidenceStore } from '#server/utils/knowledge-evidence-store'
import { retrieveVerifiedEvidence } from '#server/utils/knowledge-retrieval'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { askKnowledge, createMcpQueryLogStore } from '#server/utils/mcp-ask'
import { requireMcpScope } from '#server/utils/mcp-auth'
import {
  createWorkersAiRunRecorder,
  createWorkersAiAnswerAdapter,
  createWorkersAiJudgeAdapter,
  type WorkersAiBindingLike,
} from '#server/utils/workers-ai'

import type { McpAuthContext } from '#server/utils/mcp-middleware'

const inputShape = {
  query: z.string().trim().min(1, 'query is required').max(4000, 'query is too long'),
}

export default defineMcpTool({
  name: 'askKnowledge',
  title: 'Ask the knowledge base',
  description:
    'Answer a natural-language question from the governed knowledge base, returning a grounded response and citations.',
  inputSchema: inputShape,
  handler: async (args: { query: string }) => {
    const event = await getCurrentMcpEvent()
    const auth = requireMcpAuth(event)

    requireMcpScope(auth, 'knowledge.ask')

    const runtimeConfig = getKnowledgeRuntimeConfig()
    const database = getRequiredD1Binding(event, runtimeConfig.bindings.d1Database)
    const aiSearchClient = createCloudflareAiSearchClient({
      aiBinding: getRequiredAiSearchBinding(event),
      indexName: getRequiredAiSearchIndex(runtimeConfig.bindings.aiSearchIndex),
      gatewayConfig: runtimeConfig.aiGateway,
    })
    const workersAiBinding = getRequiredWorkersAiBinding(event)
    const workersAiRuns = createWorkersAiRunRecorder()
    const evidenceStore = createKnowledgeEvidenceStore(database)
    const auditStore = createKnowledgeAuditStore(database)
    const queryLogStore = createMcpQueryLogStore(database)

    // Touch KV binding to ensure it's wired; rate limiting itself is handled
    // by the middleware. Leaving the lookup here keeps parity with the legacy
    // handler's binding-health signal.
    getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)

    return askKnowledge(
      {
        auth,
        environment: runtimeConfig.environment,
        governance: runtimeConfig.governance,
        query: args.query,
      },
      {
        answer: createWorkersAiAnswerAdapter({
          binding: workersAiBinding,
          onUsage: workersAiRuns.record,
        }),
        auditStore: {
          ...auditStore,
          updateQueryLog: auditStore.updateQueryLog
            ? (input) =>
                auditStore.updateQueryLog({
                  ...input,
                  workersAiRunsJson: workersAiRuns.serialize(),
                })
            : undefined,
        },
        citationStore: createCitationStore(database),
        judge: createWorkersAiJudgeAdapter({
          binding: workersAiBinding,
          onUsage: workersAiRuns.record,
        }),
        queryLogStore: {
          ...queryLogStore,
          updateQueryLog: queryLogStore.updateQueryLog
            ? (input) =>
                queryLogStore.updateQueryLog({
                  ...input,
                  workersAiRunsJson: workersAiRuns.serialize(),
                })
            : undefined,
        },
        retrieve: (input) =>
          retrieveVerifiedEvidence(input, {
            governance: runtimeConfig.governance,
            search: aiSearchClient.search,
            store: evidenceStore,
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

function getRequiredAiSearchBinding(event: {
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

function getRequiredWorkersAiBinding(event: {
  context: Record<string, unknown> & { cloudflare?: { env?: Record<string, unknown> } }
}): WorkersAiBindingLike {
  const binding = getCloudflareEnv(event).AI

  if (!binding || typeof (binding as { run?: unknown }).run !== 'function') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Cloudflare Workers AI binding "AI" is not available',
    })
  }

  return binding as WorkersAiBindingLike
}

function getRequiredAiSearchIndex(indexName: string): string {
  if (!indexName) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'Knowledge AI Search index is not configured',
    })
  }

  return indexName
}
