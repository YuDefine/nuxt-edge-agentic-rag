import { beforeEach, describe, expect, it, vi } from 'vitest'

// §2.3 Tool Migration (TDD red → green).
//
// `server/mcp/tools/categories.ts` must:
// 1. Export name `listCategories` and an input schema with a boolean
//    `includeCounts` field.
// 2. Call `requireMcpScope` for `knowledge.category.list` (the scope used by
//    the legacy category-list HTTP surface before the toolkit migration).
// 3. Delegate to the existing `listCategories` util using the allowed access
//    levels derived from the authenticated token.

describe('mcp categories tool definition', () => {
  const listCategoriesMock = vi.fn()
  const useEventMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    listCategoriesMock.mockReset()
    useEventMock.mockReset()

    vi.stubGlobal('defineMcpTool', <T>(definition: T) => definition)
    vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
      Object.assign(new Error(input.message), input),
    )

    vi.doMock('nitropack/runtime', () => ({
      useEvent: useEventMock,
    }))
    vi.doMock('#server/utils/mcp-categories', () => ({
      createMcpCategoryStore: vi.fn().mockReturnValue({}),
      listCategories: listCategoriesMock,
    }))
    vi.doMock('#server/utils/cloudflare-bindings', () => ({
      getRequiredKvBinding: vi.fn().mockReturnValue({}),
    }))
    vi.doMock('#server/utils/database', () => ({
      getD1Database: vi.fn().mockResolvedValue({}),
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
          thresholds: {
            answerMin: 0.51,
            directAnswerMin: 0.71,
            judgeMin: 0.46,
          },
        },
      }),
    }))
  })

  it('exposes name `listCategories` and an includeCounts inputSchema field', async () => {
    const mod = await import('#server/mcp/tools/categories')
    const tool = mod.default

    expect(tool.name).toBe('listCategories')
    expect(tool.inputSchema).toBeDefined()
    expect(tool.inputSchema.includeCounts).toBeDefined()
  })

  it('enforces knowledge.category.list scope before invoking the util', async () => {
    const mod = await import('#server/mcp/tools/categories')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        mcpAuth: {
          scopes: ['knowledge.ask'], // missing knowledge.category.list
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    await expect(tool.handler({ includeCounts: false }, {} as never)).rejects.toMatchObject({
      statusCode: 403,
    })

    expect(listCategoriesMock).not.toHaveBeenCalled()
  })

  it('delegates to listCategories util with allowedAccessLevels', async () => {
    listCategoriesMock.mockResolvedValue({
      categories: [{ count: 3, name: 'launch' }],
    })

    const mod = await import('#server/mcp/tools/categories')
    const tool = mod.default

    useEventMock.mockReturnValue({
      context: {
        cloudflare: { env: {} },
        mcpAuth: {
          scopes: ['knowledge.category.list'],
          token: {},
          tokenId: 'token-1',
        },
      },
    })

    const result = await tool.handler({ includeCounts: true }, {} as never)

    expect(listCategoriesMock).toHaveBeenCalledTimes(1)
    expect(listCategoriesMock.mock.calls[0]?.[0]).toMatchObject({
      allowedAccessLevels: ['internal'],
      includeCounts: true,
    })
    expect(result).toEqual({
      categories: [{ count: 3, name: 'launch' }],
    })
  })
})
