import { beforeEach, describe, expect, it, vi } from 'vitest'

// §2.1 Tool Migration (TDD red → green).
//
// The toolkit wrapper in `server/mcp/tools/ask.ts` must:
// 1. Expose a name `askKnowledge` and the Zod `inputSchema` matching the
//    legacy POST /api/mcp/ask body schema.
// 2. Read `event.context.mcpAuth` populated by the middleware (auth / rate
//    limit already enforced upstream) and call `requireMcpScope` for
//    `knowledge.ask`.
// 3. Delegate to the existing `askKnowledge` util for business logic.
// 4. Return the unchanged result shape — callers receive the same payload the
//    legacy POST endpoint wrapped under `data`.

describe('mcp ask tool definition', () => {
  const askKnowledgeMock = vi.fn()
  const useEventMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    askKnowledgeMock.mockReset()
    useEventMock.mockReset()

    vi.stubGlobal('defineMcpTool', <T>(definition: T) => definition)
    vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
      Object.assign(new Error(input.message), input)
    )

    vi.doMock('nitropack/runtime', () => ({
      useEvent: useEventMock,
    }))
    vi.doMock('#server/utils/mcp-ask', () => ({
      askKnowledge: askKnowledgeMock,
      createMcpQueryLogStore: vi.fn().mockReturnValue({}),
    }))
    vi.doMock('#server/utils/ai-search', () => ({
      createCloudflareAiSearchClient: vi.fn().mockReturnValue({ search: vi.fn() }),
    }))
    vi.doMock('#server/utils/citation-store', () => ({
      createCitationStore: vi.fn().mockReturnValue({}),
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
    vi.doMock('#server/utils/knowledge-audit', () => ({
      auditKnowledgeText: vi.fn().mockReturnValue({ redactedText: '', shouldBlock: false }),
      createKnowledgeAuditStore: vi.fn().mockReturnValue({}),
    }))
    vi.doMock('#server/utils/knowledge-evidence-store', () => ({
      createKnowledgeEvidenceStore: vi.fn().mockReturnValue({}),
    }))
    vi.doMock('#server/utils/knowledge-retrieval', () => ({
      retrieveVerifiedEvidence: vi.fn(),
    }))
    vi.doMock('#server/utils/knowledge-runtime', () => ({
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

  it('exposes name `askKnowledge` and a Zod inputSchema with the `query` field', async () => {
    const mod = await import('#server/mcp/tools/ask')
    const tool = mod.default

    expect(tool.name).toBe('askKnowledge')
    expect(tool.inputSchema).toBeDefined()
    expect(tool.inputSchema.query).toBeDefined()
  })

  it('calls requireMcpScope for knowledge.ask before invoking askKnowledge util', async () => {
    const mod = await import('#server/mcp/tools/ask')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        mcpAuth: {
          scopes: ['knowledge.search'], // missing knowledge.ask
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    await expect(tool.handler({ query: 'What changed?' }, {} as never)).rejects.toMatchObject({
      statusCode: 403,
    })

    expect(askKnowledgeMock).not.toHaveBeenCalled()
  })

  it('delegates to askKnowledge util and returns the result payload unchanged', async () => {
    askKnowledgeMock.mockResolvedValue({
      answer: 'Launch moved to Tuesday.',
      citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
      refused: false,
    })

    const mod = await import('#server/mcp/tools/ask')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        cloudflare: { env: {} },
        mcpAuth: {
          scopes: ['knowledge.ask'],
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    const result = await tool.handler({ query: 'What changed?' }, {} as never)

    expect(askKnowledgeMock).toHaveBeenCalledTimes(1)
    expect(askKnowledgeMock.mock.calls[0]?.[0]).toMatchObject({
      query: 'What changed?',
      auth: expect.objectContaining({ tokenId: 'token-1' }),
    })
    expect(result).toEqual({
      answer: 'Launch moved to Tuesday.',
      citations: [{ citationId: 'citation-1', sourceChunkId: 'chunk-1' }],
      refused: false,
    })
  })
})
