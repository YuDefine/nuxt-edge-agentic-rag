import { beforeEach, describe, expect, it, vi } from 'vitest'

// §2.2 Tool Migration (TDD red → green).
//
// `server/mcp/tools/search.ts` must:
// 1. Export name `searchKnowledge` and a Zod `inputSchema` with a `query`
//    field matching the legacy search HTTP body schema (trim / max 2000).
// 2. Call `requireMcpScope` for `knowledge.search` using
//    `event.context.mcpAuth`.
// 3. Delegate to the existing `searchKnowledge` util with evidence retrieval.

describe('mcp search tool definition', () => {
  const searchKnowledgeMock = vi.fn()
  const useEventMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    searchKnowledgeMock.mockReset()
    useEventMock.mockReset()

    vi.stubGlobal('defineMcpTool', <T>(definition: T) => definition)
    vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
      Object.assign(new Error(input.message), input)
    )

    vi.doMock('nitropack/runtime', () => ({
      useEvent: useEventMock,
    }))
    vi.doMock('#server/utils/mcp-search', () => ({
      searchKnowledge: searchKnowledgeMock,
    }))
    vi.doMock('#server/utils/ai-search', () => ({
      createCloudflareAiSearchClient: vi.fn().mockReturnValue({ search: vi.fn() }),
    }))
    vi.doMock('#server/utils/cloudflare-bindings', () => ({
      getCloudflareEnv: () => ({
        AI: {
          autorag: vi.fn().mockReturnValue({ search: vi.fn() }),
        },
      }),
      getRequiredKvBinding: vi.fn().mockReturnValue({}),
    }))
    vi.doMock('#server/utils/database', () => ({
      getD1Database: vi.fn().mockResolvedValue({}),
    }))
    vi.doMock('#server/utils/knowledge-evidence-store', () => ({
      createKnowledgeEvidenceStore: vi.fn().mockReturnValue({}),
    }))
    vi.doMock('#server/utils/knowledge-retrieval', () => ({
      retrieveVerifiedEvidence: vi.fn(),
    }))
    vi.doMock('#server/utils/knowledge-runtime', () => ({
      getAllowedAccessLevels: vi.fn().mockReturnValue(['internal']),
      getKnowledgeRuntimeConfig: vi.fn().mockReturnValue({
        bindings: {
          aiSearchIndex: 'knowledge-index',
          d1Database: 'DB',
          rateLimitKv: 'RATE_LIMITS',
        },
        environment: 'local',
        governance: {
          configSnapshotVersion: 'v1',
          models: {},
          thresholds: { answerMin: 0.5 },
        },
      }),
    }))
  })

  it('exposes name `searchKnowledge` and a Zod inputSchema with `query`', async () => {
    const mod = await import('#server/mcp/tools/search')
    const tool = mod.default

    expect(tool.name).toBe('searchKnowledge')
    expect(tool.inputSchema).toBeDefined()
    expect(tool.inputSchema.query).toBeDefined()
  })

  it('enforces knowledge.search scope before invoking the util', async () => {
    const mod = await import('#server/mcp/tools/search')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        mcpAuth: {
          scopes: ['knowledge.ask'], // missing knowledge.search
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    await expect(tool.handler({ query: 'policy' }, {} as never)).rejects.toMatchObject({
      statusCode: 403,
    })

    expect(searchKnowledgeMock).not.toHaveBeenCalled()
  })

  it('delegates to searchKnowledge util and returns its result', async () => {
    searchKnowledgeMock.mockResolvedValue({
      results: [
        {
          accessLevel: 'internal',
          categorySlug: 'launch',
          citationLocator: 'lines 1-3',
          excerpt: 'Launch moved to Tuesday.',
          title: 'Launch Plan',
        },
      ],
    })

    const mod = await import('#server/mcp/tools/search')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        cloudflare: { env: {} },
        mcpAuth: {
          scopes: ['knowledge.search'],
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    const result = await tool.handler({ query: 'what changed?' }, {} as never)

    expect(searchKnowledgeMock).toHaveBeenCalledTimes(1)
    expect(searchKnowledgeMock.mock.calls[0]?.[0]).toMatchObject({
      query: 'what changed?',
      allowedAccessLevels: ['internal'],
    })
    expect(result).toEqual({
      results: [
        {
          accessLevel: 'internal',
          categorySlug: 'launch',
          citationLocator: 'lines 1-3',
          excerpt: 'Launch moved to Tuesday.',
          title: 'Launch Plan',
        },
      ],
    })
  })
})
