import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKnowledgeRuntimeConfig } from '#shared/schemas/knowledge-runtime'
import { createHubDbMock } from './helpers/database'
import { runMcpTool } from './helpers/mcp-tool-runner'
import { installNuxtRouteTestGlobals } from './helpers/nuxt-route'

// §3.1 Tool Migration (TDD red → green).
//
// After migrating the 4 HTTP endpoints to `defineMcpTool` definitions under
// `server/mcp/tools/*`, these contract tests MUST exercise the same shape
// through the JSON-RPC tool pipeline:
//   - Auth + rate limit live in the middleware (runMcpMiddleware)
//   - Per-tool scope checks + business logic live in the tool handler
// The test runner (`runMcpTool`) stands in for the toolkit's `/mcp` handler,
// running middleware → tool handler with a crafted H3 event.

const pendingEvent = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('nitropack/runtime', () => ({
  useEvent: () => pendingEvent.current,
}))

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
      readonly statusCode: number,
      readonly reason = 'chunk_not_found'
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
    createMcpTokenStore: vi.fn().mockReturnValue({
      findUsableTokenByHash: vi.fn(),
      touchLastUsedAt: vi.fn(),
    }),
    getDocumentChunk: vi.fn(),
    getKnowledgeRuntimeConfig: vi.fn(),
    getRequiredD1Binding: vi.fn().mockReturnValue({}),
    getRequiredKvBinding: vi.fn().mockReturnValue({ get: vi.fn(), put: vi.fn() }),
    listCategories: vi.fn(),
    requireMcpBearerToken: vi.fn().mockResolvedValue({
      scopes: [
        'knowledge.ask',
        'knowledge.search',
        'knowledge.category.list',
        'knowledge.citation.read',
      ],
      token: {},
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

installNuxtRouteTestGlobals()

describe('mcp tool contract handlers (toolkit-native)', () => {
  beforeEach(() => {
    mcpRouteMocks.getKnowledgeRuntimeConfig.mockReturnValue(
      createKnowledgeRuntimeConfig({
        bindings: {
          aiSearchIndex: 'knowledge-index',
          d1Database: 'DB',
          rateLimitKv: 'KV',
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
    mcpRouteMocks.listCategories.mockResolvedValue([{ count: 1, slug: 'launch', title: 'Launch' }])
    mcpRouteMocks.searchKnowledge.mockResolvedValue({
      evidence: [],
      normalizedQuery: 'what changed',
    })
  })

  it('surfaces replay 403 errors from the getDocumentChunk tool', async () => {
    mcpRouteMocks.getDocumentChunk.mockRejectedValue(
      new mcpRouteMocks.MockMcpReplayError(
        'The requested citation requires knowledge.restricted.read',
        403,
        'restricted_scope_required'
      )
    )

    const { default: tool } = await import('#server/mcp/tools/get-document-chunk')

    await expect(
      runMcpTool(
        tool,
        { citationId: 'citation-1' },
        {
          authorizationHeader: 'Bearer test-token',
          cloudflareEnv: {},
          pendingEvent,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'The requested citation requires knowledge.restricted.read',
    })
  })

  it('records a blocked query_log when getDocumentChunk tool returns 403', async () => {
    // `mcp-restricted-audit-trail` spec — the blocked row is now written
    // through the dedicated `createBlockedRestrictedScopeQueryLog` method so
    // the row lands with `risk_flags_json = ["restricted_scope_violation"]`.
    // The handler wires that write into the `onRestrictedScopeViolation`
    // hook of `getDocumentChunk`; we simulate that contract here by
    // invoking the hook on the mocked util before rejecting with 403.
    const createBlockedRestrictedScopeQueryLog = vi.fn().mockResolvedValue('log-1')
    const createAcceptedQueryLog = vi.fn().mockResolvedValue('log-1')
    mcpRouteMocks.createMcpQueryLogStore.mockReturnValue({
      createAcceptedQueryLog,
      createBlockedRestrictedScopeQueryLog,
    })
    mcpRouteMocks.getDocumentChunk.mockImplementation(async (_input, options) => {
      await options.onRestrictedScopeViolation?.({
        attemptedCitationId: _input.citationId,
        tokenId: _input.auth.tokenId,
        tokenScopes: _input.auth.scopes,
      })
      throw new mcpRouteMocks.MockMcpReplayError(
        'The requested citation requires knowledge.restricted.read',
        403,
        'restricted_scope_required'
      )
    })

    const { default: tool } = await import('#server/mcp/tools/get-document-chunk')

    await expect(
      runMcpTool(
        tool,
        { citationId: 'citation-restricted' },
        {
          authorizationHeader: 'Bearer test-token',
          cloudflareEnv: {},
          pendingEvent,
        }
      )
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(createBlockedRestrictedScopeQueryLog).toHaveBeenCalledTimes(1)
    expect(createBlockedRestrictedScopeQueryLog).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: 'getDocumentChunk:citation-restricted',
        tokenId: 'token-1',
      })
    )
    // Spec Scenario 3: the legacy accepted-path writer must NOT fire on the
    // 403 branch so auditors never see two rows for the same blocked call.
    expect(createAcceptedQueryLog).not.toHaveBeenCalled()
  })

  it('returns filtered search results through the searchKnowledge tool', async () => {
    mcpRouteMocks.searchKnowledge.mockResolvedValue({
      evidence: [{ excerpt: 'Launch moved to Tuesday.', sourceChunkId: 'chunk-1' }],
      normalizedQuery: 'what changed',
    })

    const { default: tool } = await import('#server/mcp/tools/search')
    const result = await runMcpTool(
      tool,
      { query: 'What changed?' },
      {
        authorizationHeader: 'Bearer test-token',
        cloudflareEnv: {},
        pendingEvent,
      }
    )

    expect(result).toEqual({
      evidence: [{ excerpt: 'Launch moved to Tuesday.', sourceChunkId: 'chunk-1' }],
      normalizedQuery: 'what changed',
    })
  })

  it('returns visible categories through the listCategories tool', async () => {
    const { default: tool } = await import('#server/mcp/tools/categories')
    const result = await runMcpTool(
      tool,
      { includeCounts: true },
      {
        authorizationHeader: 'Bearer test-token',
        cloudflareEnv: {},
        pendingEvent,
      }
    )

    expect(result).toEqual([{ count: 1, slug: 'launch', title: 'Launch' }])
  })

  it('exposes the askKnowledge tool through the middleware pipeline', async () => {
    const { default: tool } = await import('#server/mcp/tools/ask')

    const result = await runMcpTool(
      tool,
      { query: 'What changed?' },
      {
        authorizationHeader: 'Bearer test-token',
        cloudflareEnv: {},
        pendingEvent,
      }
    )

    expect(result).toEqual({
      answer: 'Launch moved to Tuesday.',
      citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
      refused: false,
    })

    expect(mcpRouteMocks.askKnowledge).toHaveBeenCalledTimes(1)
  })
})
