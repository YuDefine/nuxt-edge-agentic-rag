import type { KnowledgeSearchCandidate } from './knowledge-retrieval'

/**
 * AI Search namespace binding shape exposed by `ai_search_namespaces`
 * wrangler config. The runtime provides `env.AI_SEARCH.get(instanceId)`
 * which returns an instance handle with `.search()`.
 *
 * [D-BIND]: Uses `ai_search_namespaces` + `AI_SEARCH.get(instanceId)`.
 */
export interface CloudflareAiSearchBindingLike {
  get(instanceId: string): {
    search(request: {
      query: string
      ai_search_options?: {
        retrieval?: {
          max_num_results?: number
          match_threshold?: number
          filters?: Record<string, unknown>
        }
        query_rewrite?: {
          enabled: boolean
        }
      }
    }): Promise<{
      chunks?: Array<{
        text?: string
        score?: number
        item?: {
          metadata?: Record<string, unknown>
        }
      }>
    }>
  }
}

export interface AiGatewayRuntimeConfig {
  id: string
  cacheEnabled: boolean
}

/**
 * [D-REQUEST] [D-RESPONSE]: The adapter accepts the legacy-shaped request
 * from `retrieveVerifiedEvidence` (query, max_num_results, ranking_options,
 * filters, rewrite_query) and internally translates it to the AI Search
 * request shape, then maps `chunks[]` back to `KnowledgeSearchCandidate[]`.
 */
export function createCloudflareAiSearchClient(input: {
  aiSearchBinding: CloudflareAiSearchBindingLike
  instanceId: string
  gatewayConfig?: AiGatewayRuntimeConfig
  skipCache?: boolean
}) {
  return {
    async search(request: {
      filters: Record<string, unknown>
      max_num_results: number
      query: string
      ranking_options: {
        score_threshold: number
      }
      rewrite_query: false
    }): Promise<KnowledgeSearchCandidate[]> {
      const instance = input.aiSearchBinding.get(input.instanceId)

      // [D-REQUEST]: Translate legacy request shape → AI Search shape.
      // Empty filters are not sent to avoid Cloudflare validator edge cases.
      const hasFilters = Object.keys(request.filters).length > 0

      const aiSearchRequest: Parameters<typeof instance.search>[0] = {
        query: request.query,
        ai_search_options: {
          retrieval: {
            max_num_results: request.max_num_results,
            match_threshold: request.ranking_options.score_threshold,
            ...(hasFilters ? { filters: request.filters } : {}),
          },
          query_rewrite: { enabled: false },
        },
      }

      const response = await instance.search(aiSearchRequest)

      // [D-RESPONSE]: Map `chunks[]` to `KnowledgeSearchCandidate[]`.
      // Chunks missing required metadata are discarded (fail closed).
      return (response.chunks ?? [])
        .map((chunk) => {
          const metadata = chunk.item?.metadata ?? {}
          const text = chunk.text
          const documentVersionId = readString(metadata.document_version_id)
          const citationLocator = readString(metadata.citation_locator)
          const accessLevel = readString(metadata.access_level)

          if (!text || !documentVersionId || !citationLocator || !accessLevel) {
            return null
          }

          return {
            accessLevel,
            citationLocator,
            documentVersionId,
            excerpt: text,
            score: typeof chunk.score === 'number' ? chunk.score : 0,
          } satisfies KnowledgeSearchCandidate
        })
        .filter((candidate): candidate is KnowledgeSearchCandidate => candidate !== null)
    },
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
