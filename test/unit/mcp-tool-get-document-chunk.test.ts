import { beforeEach, describe, expect, it, vi } from 'vitest'

// §2.4 Tool Migration (TDD red → green).
//
// `server/mcp/tools/get-document-chunk.ts` must:
// 1. Export name `getDocumentChunk` and an input schema with a `citationId`
//    field matching the legacy `[citationId].get.ts` endpoint.
// 2. Call `requireMcpScope` for `knowledge.citation.read`.
// 3. Delegate to the existing `getDocumentChunk` util.
// 4. CRITICAL: when the util throws an `McpReplayError` with `statusCode === 403`,
//    the tool MUST write a `query_logs` row with `status='blocked'` BEFORE
//    re-throwing, matching the spec in `mcp-knowledge-tools` and the legacy
//    handler at `server/api/mcp/chunks/[citationId].get.ts`.

class MockMcpReplayError extends Error {
  readonly reason: string
  readonly statusCode: number
  constructor(message: string, statusCode: number, reason = 'chunk_not_found') {
    super(message)
    this.name = 'McpReplayError'
    this.reason = reason
    this.statusCode = statusCode
  }
}

describe('mcp get-document-chunk tool definition', () => {
  const getDocumentChunkUtilMock = vi.fn()
  const createAcceptedQueryLogMock = vi.fn()
  const useEventMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    getDocumentChunkUtilMock.mockReset()
    createAcceptedQueryLogMock.mockReset()
    createAcceptedQueryLogMock.mockResolvedValue('log-1')
    useEventMock.mockReset()

    vi.stubGlobal('defineMcpTool', <T>(definition: T) => definition)
    vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
      Object.assign(new Error(input.message), input)
    )

    vi.doMock('nitropack/runtime', () => ({
      useEvent: useEventMock,
    }))
    vi.doMock('#server/utils/mcp-replay', () => ({
      createMcpReplayStore: vi.fn().mockReturnValue({}),
      getDocumentChunk: getDocumentChunkUtilMock,
      McpReplayError: MockMcpReplayError,
    }))
    vi.doMock('#server/utils/mcp-ask', () => ({
      createMcpQueryLogStore: vi.fn().mockReturnValue({
        createAcceptedQueryLog: createAcceptedQueryLogMock,
      }),
    }))
    vi.doMock('#server/utils/cloudflare-bindings', () => ({
      getRequiredKvBinding: vi.fn().mockReturnValue({}),
    }))
    vi.doMock('#server/utils/database', () => ({
      getD1Database: vi.fn().mockResolvedValue({}),
    }))
    vi.doMock('#server/utils/knowledge-audit', () => ({
      auditKnowledgeText: vi.fn((input: string) => ({
        redactedText: input,
        shouldBlock: false,
      })),
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

  it('exposes name `getDocumentChunk` and a Zod inputSchema with `citationId`', async () => {
    const mod = await import('#server/mcp/tools/get-document-chunk')
    const tool = mod.default

    expect(tool.name).toBe('getDocumentChunk')
    expect(tool.inputSchema).toBeDefined()
    expect(tool.inputSchema.citationId).toBeDefined()
  })

  it('enforces knowledge.citation.read scope before invoking the util', async () => {
    const mod = await import('#server/mcp/tools/get-document-chunk')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        mcpAuth: {
          scopes: ['knowledge.search'], // missing knowledge.citation.read
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    await expect(tool.handler({ citationId: 'cid-1' }, {} as never)).rejects.toMatchObject({
      statusCode: 403,
    })

    expect(getDocumentChunkUtilMock).not.toHaveBeenCalled()
  })

  it('delegates to getDocumentChunk util on the happy path', async () => {
    getDocumentChunkUtilMock.mockResolvedValue({
      chunkText: 'Launch moved to Tuesday.',
      citationId: 'cid-1',
      citationLocator: 'lines 1-3',
    })

    const mod = await import('#server/mcp/tools/get-document-chunk')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        cloudflare: { env: {} },
        mcpAuth: {
          scopes: ['knowledge.citation.read'],
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    const result = await tool.handler({ citationId: 'cid-1' }, {} as never)

    expect(getDocumentChunkUtilMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      chunkText: 'Launch moved to Tuesday.',
      citationId: 'cid-1',
      citationLocator: 'lines 1-3',
    })
    expect(createAcceptedQueryLogMock).not.toHaveBeenCalled()
  })

  it('writes a blocked query_logs row BEFORE re-throwing the 403 replay error', async () => {
    getDocumentChunkUtilMock.mockRejectedValue(
      new MockMcpReplayError(
        'The requested citation requires knowledge.restricted.read',
        403,
        'restricted_scope_required'
      )
    )

    const mod = await import('#server/mcp/tools/get-document-chunk')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        cloudflare: { env: {} },
        mcpAuth: {
          scopes: ['knowledge.citation.read'],
          token: {},
          tokenId: 'token-blocked',
        },
      },
    })

    await expect(tool.handler({ citationId: 'cid-restricted' }, {} as never)).rejects.toMatchObject(
      { statusCode: 403 }
    )

    expect(createAcceptedQueryLogMock).toHaveBeenCalledTimes(1)
    expect(createAcceptedQueryLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: 'getDocumentChunk:cid-restricted',
        status: 'blocked',
        tokenId: 'token-blocked',
      })
    )
  })

  it('does NOT write a query_logs row when the replay error is 404', async () => {
    getDocumentChunkUtilMock.mockRejectedValue(
      new MockMcpReplayError('The requested citation was not found', 404, 'chunk_not_found')
    )

    const mod = await import('#server/mcp/tools/get-document-chunk')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        cloudflare: { env: {} },
        mcpAuth: {
          scopes: ['knowledge.citation.read'],
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    await expect(tool.handler({ citationId: 'cid-missing' }, {} as never)).rejects.toMatchObject({
      statusCode: 404,
    })

    expect(createAcceptedQueryLogMock).not.toHaveBeenCalled()
  })
})
