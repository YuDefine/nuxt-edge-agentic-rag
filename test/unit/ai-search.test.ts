import { describe, expect, it } from 'vitest'

import {
  createCloudflareAiSearchClient,
  type CloudflareAiSearchBindingLike,
} from '#server/utils/ai-search'

function createBindingSpy(responses: Record<string, unknown[]> = {}): {
  getCalls: Array<{ instanceId: string }>
  searchCalls: Array<{ instanceId: string; request: unknown }>
  binding: CloudflareAiSearchBindingLike
} {
  const getCalls: Array<{ instanceId: string }> = []
  const searchCalls: Array<{ instanceId: string; request: unknown }> = []

  const binding: CloudflareAiSearchBindingLike = {
    get(instanceId) {
      getCalls.push({ instanceId })

      return {
        async search(request) {
          searchCalls.push({ instanceId, request })

          return { chunks: (responses[instanceId] ?? []) as never }
        },
      }
    },
  }

  return { getCalls, searchCalls, binding }
}

const baseRequest = {
  filters: {},
  max_num_results: 8,
  query: 'hello',
  ranking_options: { score_threshold: 0.5 },
  rewrite_query: false,
} as const

describe('createCloudflareAiSearchClient — AI Search binding', () => {
  it('calls AI_SEARCH.get(instanceId).search() with translated request shape', async () => {
    const { getCalls, searchCalls, binding } = createBindingSpy()

    const client = createCloudflareAiSearchClient({
      aiSearchBinding: binding,
      instanceId: 'agentic-rag-staging',
    })

    await client.search({ ...baseRequest })

    expect(getCalls).toHaveLength(1)
    expect(getCalls[0]).toEqual({ instanceId: 'agentic-rag-staging' })

    expect(searchCalls).toHaveLength(1)
    expect(searchCalls[0]!.request).toEqual({
      query: 'hello',
      ai_search_options: {
        retrieval: {
          max_num_results: 8,
          match_threshold: 0.5,
        },
        query_rewrite: { enabled: false },
      },
    })
  })

  it('does not include filters in request when filters are empty', async () => {
    const { searchCalls, binding } = createBindingSpy()

    const client = createCloudflareAiSearchClient({
      aiSearchBinding: binding,
      instanceId: 'test-instance',
    })

    await client.search({ ...baseRequest, filters: {} })

    const request = searchCalls[0]!.request as {
      ai_search_options: { retrieval: Record<string, unknown> }
    }
    expect(request.ai_search_options.retrieval).not.toHaveProperty('filters')
  })

  it('includes filters in retrieval options when non-empty', async () => {
    const { searchCalls, binding } = createBindingSpy()

    const client = createCloudflareAiSearchClient({
      aiSearchBinding: binding,
      instanceId: 'test-instance',
    })

    await client.search({
      ...baseRequest,
      filters: { folder: 'customer-a/' },
    })

    const request = searchCalls[0]!.request as {
      ai_search_options: { retrieval: { filters: unknown } }
    }
    expect(request.ai_search_options.retrieval.filters).toEqual({
      folder: 'customer-a/',
    })
  })

  it('does not send top-level max_num_results, ranking_options, or rewrite_query', async () => {
    const { searchCalls, binding } = createBindingSpy()

    const client = createCloudflareAiSearchClient({
      aiSearchBinding: binding,
      instanceId: 'test-instance',
    })

    await client.search({ ...baseRequest })

    const request = searchCalls[0]!.request as Record<string, unknown>
    expect(request).not.toHaveProperty('max_num_results')
    expect(request).not.toHaveProperty('ranking_options')
    expect(request).not.toHaveProperty('rewrite_query')
  })

  it('maps chunks response to KnowledgeSearchCandidate shape', async () => {
    const { binding } = createBindingSpy({
      'test-instance': [
        {
          text: 'Excerpt text',
          score: 0.85,
          item: {
            metadata: {
              access_level: 'internal',
              citation_locator: 'lines 10-20',
              document_version_id: 'doc-v-1',
            },
          },
        },
      ],
    })

    const client = createCloudflareAiSearchClient({
      aiSearchBinding: binding,
      instanceId: 'test-instance',
    })

    const results = await client.search({ ...baseRequest })

    expect(results).toEqual([
      {
        accessLevel: 'internal',
        citationLocator: 'lines 10-20',
        documentVersionId: 'doc-v-1',
        excerpt: 'Excerpt text',
        score: 0.85,
      },
    ])
  })

  it('discards chunks with missing metadata (fail closed)', async () => {
    const { binding } = createBindingSpy({
      'test-instance': [
        {
          text: 'Valid chunk',
          score: 0.9,
          item: {
            metadata: {
              access_level: 'public',
              citation_locator: 'lines 1-5',
              document_version_id: 'ver-1',
            },
          },
        },
        {
          text: 'Missing document_version_id',
          score: 0.8,
          item: {
            metadata: {
              access_level: 'internal',
              citation_locator: 'lines 6-10',
            },
          },
        },
        {
          text: null,
          score: 0.72,
          item: {
            metadata: {
              access_level: 'internal',
              citation_locator: 'lines 11-15',
              document_version_id: 'ver-3',
            },
          },
        },
        {
          score: 0.6,
          item: {
            metadata: {
              access_level: 'internal',
              citation_locator: 'lines 16-20',
              document_version_id: 'ver-4',
            },
          },
        },
      ],
    })

    const client = createCloudflareAiSearchClient({
      aiSearchBinding: binding,
      instanceId: 'test-instance',
    })

    const results = await client.search({ ...baseRequest })

    expect(results).toHaveLength(1)
    expect(results[0]!.documentVersionId).toBe('ver-1')
  })

  it('surfaces Cloudflare search errors without swallowing', async () => {
    const binding: CloudflareAiSearchBindingLike = {
      get: () => ({
        search: async () => {
          throw new Error('Cloudflare AI Search returned 502 Bad Gateway')
        },
      }),
    }

    const client = createCloudflareAiSearchClient({
      aiSearchBinding: binding,
      instanceId: 'test-instance',
    })

    await expect(client.search({ ...baseRequest })).rejects.toThrow(
      /Cloudflare AI Search returned 502/,
    )
  })

  it('returns empty array when response has no chunks', async () => {
    const binding: CloudflareAiSearchBindingLike = {
      get: () => ({
        search: async () => ({}),
      }),
    }

    const client = createCloudflareAiSearchClient({
      aiSearchBinding: binding,
      instanceId: 'test-instance',
    })

    const results = await client.search({ ...baseRequest })
    expect(results).toEqual([])
  })

  it('defaults score to 0 when chunk.score is not a number', async () => {
    const { binding } = createBindingSpy({
      'test-instance': [
        {
          text: 'Some text',
          score: 'not-a-number',
          item: {
            metadata: {
              access_level: 'public',
              citation_locator: 'lines 1-5',
              document_version_id: 'ver-1',
            },
          },
        },
      ],
    })

    const client = createCloudflareAiSearchClient({
      aiSearchBinding: binding,
      instanceId: 'test-instance',
    })

    const results = await client.search({ ...baseRequest })

    expect(results[0]!.score).toBe(0)
  })
})
