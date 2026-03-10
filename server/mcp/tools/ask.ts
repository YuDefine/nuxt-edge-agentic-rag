import { z } from 'zod'

import { getCurrentMcpEvent } from '#server/utils/current-mcp-event'
import {
  createCloudflareAiSearchClient,
  type CloudflareAiBindingLike,
} from '#server/utils/ai-search'
import { createCitationStore } from '#server/utils/citation-store'
import { getCloudflareEnv, getRequiredKvBinding } from '#server/utils/cloudflare-bindings'
import { getD1Database } from '#server/utils/database'
import { createKnowledgeAuditStore } from '#server/utils/knowledge-audit'
import { createKnowledgeEvidenceStore } from '#server/utils/knowledge-evidence-store'
import { retrieveVerifiedEvidence } from '#server/utils/knowledge-retrieval'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { askKnowledge, createMcpQueryLogStore } from '#server/utils/mcp-ask'
import { requireMcpScope } from '#server/utils/mcp-auth'

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
    const database = await getD1Database()
    const aiSearchClient = createCloudflareAiSearchClient({
      aiBinding: getRequiredAiBinding(event),
      indexName: getRequiredAiSearchIndex(runtimeConfig.bindings.aiSearchIndex),
    })
    const evidenceStore = createKnowledgeEvidenceStore(database)

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
        answer: createFallbackAnswer,
        auditStore: createKnowledgeAuditStore(database),
        citationStore: createCitationStore(database),
        judge: createFallbackJudge(runtimeConfig.governance.thresholds.answerMin),
        queryLogStore: createMcpQueryLogStore(database),
        retrieve: (input) =>
          retrieveVerifiedEvidence(input, {
            governance: runtimeConfig.governance,
            search: aiSearchClient.search,
            store: evidenceStore,
          }),
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

async function createFallbackAnswer(input: {
  evidence: Array<{
    chunkText: string
    documentTitle: string
  }>
  modelRole: string
  query: string
  retrievalScore: number
}): Promise<string> {
  const uniqueSnippets = [
    ...new Set(input.evidence.map((item) => item.chunkText.trim()).filter(Boolean)),
  ].slice(0, 3)

  if (uniqueSnippets.length === 0) {
    return ''
  }

  if (uniqueSnippets.length === 1) {
    return uniqueSnippets[0] ?? ''
  }

  return uniqueSnippets.join('\n\n')
}

function createFallbackJudge(answerMin: number) {
  return async function fallbackJudge(input: {
    evidence: Array<unknown>
    query: string
    retrievalScore: number
  }): Promise<{
    reformulatedQuery?: string
    shouldAnswer: boolean
  }> {
    return {
      shouldAnswer: input.evidence.length > 0 && input.retrievalScore >= answerMin,
    }
  }
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
