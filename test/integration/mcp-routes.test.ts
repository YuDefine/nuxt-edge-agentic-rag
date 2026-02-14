import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mcpRouteMocks = vi.hoisted(() => {
  class MockMcpAuthError extends Error {
    constructor(
      message: string,
      readonly statusCode: number
    ) {
      super(message)
      this.name = 'McpAuthError'
    }
  }

  class MockMcpRateLimitExceededError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
      readonly retryAfterMs: number
    ) {
      super(message)
      this.name = 'McpRateLimitExceededError'
    }
  }

  class MockMcpReplayError extends Error {
    constructor(
      message: string,
      readonly statusCode: number
    ) {
      super(message)
      this.name = 'McpReplayError'
    }
  }

  return {
    MockMcpAuthError,
    MockMcpRateLimitExceededError,
    MockMcpReplayError,
    askKnowledge: vi.fn(),
    consumeMcpToolRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    createCloudflareAiSearchClient: vi.fn().mockReturnValue({ search: vi.fn() }),
    createCitationStore: vi.fn().mockReturnValue({}),
    createKnowledgeAuditStore: vi.fn().mockReturnValue({}),
    createKnowledgeEvidenceStore: vi.fn().mockReturnValue({}),
    createKvRateLimitStore: vi.fn().mockReturnValue({}),
    createMcpCategoryStore: vi.fn().mockReturnValue({}),
    createMcpQueryLogStore: vi.fn().mockReturnValue({}),
    createMcpReplayStore: vi.fn().mockReturnValue({}),
    createMcpTokenStore: vi.fn().mockReturnValue({}),
    getDocumentChunk: vi.fn(),
    getKnowledgeRuntimeConfig: vi.fn(),
    getRequiredD1Binding: vi.fn().mockReturnValue({}),
    getRequiredKvBinding: vi.fn().mockReturnValue({ get: vi.fn(), put: vi.fn() }),
    getValidatedQuery: vi.fn(),
    listCategories: vi.fn(),
    readValidatedBody: vi.fn(),
    readZodBody: vi.fn(),
    requireMcpBearerToken: vi.fn().mockResolvedValue({
      scopes: [
        'knowledge.ask',
        'knowledge.search',
        'knowledge.category.list',
        'knowledge.citation.read',
      ],
      tokenId: 'token-1',
    }),
    requireMcpScope: vi.fn(),
    retrieveVerifiedEvidence: vi.fn(),
    searchKnowledge: vi.fn(),
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('../../server/utils/ai-search', () => ({
  createCloudflareAiSearchClient: mcpRouteMocks.createCloudflareAiSearchClient,
}))

vi.mock('../../server/utils/citation-store', () => ({
  createCitationStore: mcpRouteMocks.createCitationStore,
}))

vi.mock('../../server/utils/cloudflare-bindings', () => ({
  getCloudflareEnv: () => ({
    AI: {
      autorag: vi.fn().mockReturnValue({ search: vi.fn() }),
    },
  }),
  getRequiredD1Binding: mcpRouteMocks.getRequiredD1Binding,
  getRequiredKvBinding: mcpRouteMocks.getRequiredKvBinding,
}))

vi.mock('../../server/utils/knowledge-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/knowledge-audit')>()

  return {
    ...actual,
    createKnowledgeAuditStore: mcpRouteMocks.createKnowledgeAuditStore,
  }
})

vi.mock('../../server/utils/knowledge-evidence-store', () => ({
  createKnowledgeEvidenceStore: mcpRouteMocks.createKnowledgeEvidenceStore,
}))

vi.mock('../../server/utils/knowledge-retrieval', () => ({
  retrieveVerifiedEvidence: mcpRouteMocks.retrieveVerifiedEvidence,
}))

vi.mock('../../server/utils/knowledge-runtime', () => ({
  getAllowedAccessLevels: vi.fn().mockReturnValue(['internal']),
  getKnowledgeRuntimeConfig: mcpRouteMocks.getKnowledgeRuntimeConfig,
}))

vi.mock('../../server/utils/mcp-ask', () => ({
  askKnowledge: mcpRouteMocks.askKnowledge,
  createMcpQueryLogStore: mcpRouteMocks.createMcpQueryLogStore,
}))

vi.mock('../../server/utils/mcp-auth', () => ({
  McpAuthError: mcpRouteMocks.MockMcpAuthError,
  requireMcpBearerToken: mcpRouteMocks.requireMcpBearerToken,
  requireMcpScope: mcpRouteMocks.requireMcpScope,
}))

vi.mock('../../server/utils/mcp-categories', () => ({
  createMcpCategoryStore: mcpRouteMocks.createMcpCategoryStore,
  listCategories: mcpRouteMocks.listCategories,
}))

vi.mock('../../server/utils/mcp-rate-limit', () => ({
  consumeMcpToolRateLimit: mcpRouteMocks.consumeMcpToolRateLimit,
  createKvRateLimitStore: mcpRouteMocks.createKvRateLimitStore,
  McpRateLimitExceededError: mcpRouteMocks.MockMcpRateLimitExceededError,
}))

vi.mock('../../server/utils/mcp-replay', () => ({
  createMcpReplayStore: mcpRouteMocks.createMcpReplayStore,
  getDocumentChunk: mcpRouteMocks.getDocumentChunk,
  McpReplayError: mcpRouteMocks.MockMcpReplayError,
}))

vi.mock('../../server/utils/mcp-search', () => ({
  searchKnowledge: mcpRouteMocks.searchKnowledge,
}))

vi.mock('../../server/utils/mcp-token-store', () => ({
  createMcpTokenStore: mcpRouteMocks.createMcpTokenStore,
}))

vi.mock('../../server/utils/read-zod-body', () => ({
  readZodBody: mcpRouteMocks.readZodBody,
}))

installNuxtRouteTestGlobals()

describe('mcp route handlers', () => {
  beforeEach(() => {
    vi.stubGlobal('getValidatedQuery', mcpRouteMocks.getValidatedQuery)
    vi.stubGlobal('readValidatedBody', mcpRouteMocks.readValidatedBody)

    mcpRouteMocks.getKnowledgeRuntimeConfig.mockReturnValue(
      createKnowledgeRuntimeConfig({
        bindings: {
          aiSearchIndex: 'knowledge-index',
          d1Database: 'DB',
          rateLimitKv: 'RATE_LIMITS',
        },
        environment: 'local',
      })
    )
    mcpRouteMocks.askKnowledge.mockResolvedValue({
      answer: 'Launch moved to Tuesday.',
      citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
      refused: false,
    })
    mcpRouteMocks.getDocumentChunk.mockResolvedValue({
      chunkText: 'Launch moved to Tuesday.',
      citationId: 'citation-1',
      citationLocator: 'lines 1-3',
    })
    mcpRouteMocks.getValidatedQuery.mockResolvedValue({ includeCounts: true })
    mcpRouteMocks.listCategories.mockResolvedValue([{ count: 1, slug: 'launch', title: 'Launch' }])
    mcpRouteMocks.readValidatedBody.mockResolvedValue({ query: 'What changed?' })
    mcpRouteMocks.readZodBody.mockResolvedValue({ query: 'What changed?' })
    mcpRouteMocks.searchKnowledge.mockResolvedValue({
      evidence: [],
      normalizedQuery: 'what changed',
    })
  })

  it('rejects MCP ask requests that try to provide session state', async () => {
    const { default: handler } = await import('../../server/api/mcp/ask.post')

    await expect(
      handler(
        createRouteEvent({
          headers: {
            'mcp-session-id': 'session-1',
          },
        })
      )
    ).rejects.toMatchObject({
      message: 'MCP session state is not supported in v1.0.0',
      statusCode: 400,
    })
  })

  it('maps replay authorization failures to 403', async () => {
    mcpRouteMocks.getDocumentChunk.mockRejectedValue(
      new mcpRouteMocks.MockMcpReplayError(
        'The requested citation requires knowledge.restricted.read',
        403
      )
    )

    const { default: handler } = await import('../../server/api/mcp/chunks/[citationId].get')

    await expect(
      handler(
        createRouteEvent({
          context: {
            cloudflare: { env: {} },
            params: { citationId: 'citation-1' },
          },
        })
      )
    ).rejects.toMatchObject({
      message: 'The requested citation requires knowledge.restricted.read',
      statusCode: 403,
    })
  })

  it('records a blocked query_log when getDocumentChunk returns 403', async () => {
    const createAcceptedQueryLog = vi.fn().mockResolvedValue('log-1')
    mcpRouteMocks.createMcpQueryLogStore.mockReturnValueOnce({ createAcceptedQueryLog })
    mcpRouteMocks.getDocumentChunk.mockRejectedValue(
      new mcpRouteMocks.MockMcpReplayError(
        'The requested citation requires knowledge.restricted.read',
        403
      )
    )

    const { default: handler } = await import('../../server/api/mcp/chunks/[citationId].get')

    await expect(
      handler(
        createRouteEvent({
          context: {
            cloudflare: { env: {} },
            params: { citationId: 'citation-restricted' },
          },
        })
      )
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(createAcceptedQueryLog).toHaveBeenCalledTimes(1)
    expect(createAcceptedQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: 'getDocumentChunk:citation-restricted',
        status: 'blocked',
        tokenId: 'token-1',
      })
    )
  })

  it('returns filtered search results through the unified response envelope', async () => {
    mcpRouteMocks.searchKnowledge.mockResolvedValue({
      evidence: [{ excerpt: 'Launch moved to Tuesday.', sourceChunkId: 'chunk-1' }],
      normalizedQuery: 'what changed',
    })

    const { default: handler } = await import('../../server/api/mcp/search.post')
    const result = await handler(createRouteEvent())

    expect(result).toEqual({
      data: {
        evidence: [{ excerpt: 'Launch moved to Tuesday.', sourceChunkId: 'chunk-1' }],
        normalizedQuery: 'what changed',
      },
    })
  })

  it('returns visible categories with counts', async () => {
    const { default: handler } = await import('../../server/api/mcp/categories.get')
    const result = await handler(createRouteEvent())

    expect(result).toEqual({
      data: [{ count: 1, slug: 'launch', title: 'Launch' }],
    })
  })
})
