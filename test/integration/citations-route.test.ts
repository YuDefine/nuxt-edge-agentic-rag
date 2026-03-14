import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const citationMocks = vi.hoisted(() => ({
  createMcpReplayStore: vi.fn().mockReturnValue({
    findWebReplayableCitationById: vi.fn(),
  }),
  getKnowledgeRuntimeConfig: vi.fn().mockReturnValue({
    bindings: {
      d1Database: 'DB',
    },
  }),
  getRequiredD1Binding: vi.fn().mockReturnValue({}),
  getRouterParam: vi.fn(),
  getRuntimeAdminAccess: vi.fn().mockReturnValue(false),
  requireUserSession: vi.fn().mockResolvedValue({
    user: { id: 'user-1', email: 'user@example.com' },
  }),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('../../server/utils/mcp-replay', () => ({
  createMcpReplayStore: citationMocks.createMcpReplayStore,
  McpReplayError: class McpReplayError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message)
      this.name = 'McpReplayError'
    }
  },
}))

installNuxtRouteTestGlobals()

describe('GET /api/citations/:citationId', () => {
  beforeEach(() => {
    vi.stubGlobal('getKnowledgeRuntimeConfig', citationMocks.getKnowledgeRuntimeConfig)
    vi.stubGlobal('getRequiredD1Binding', citationMocks.getRequiredD1Binding)
    vi.stubGlobal('getRouterParam', citationMocks.getRouterParam)
    vi.stubGlobal('getRuntimeAdminAccess', citationMocks.getRuntimeAdminAccess)
    vi.stubGlobal('requireUserSession', citationMocks.requireUserSession)
  })

  it('requires authentication', async () => {
    citationMocks.requireUserSession.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
    )
    citationMocks.getRouterParam.mockReturnValue('cite-1')

    const { default: handler } = await import('../../server/api/citations/[citationId].get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('returns citation chunk in unified response envelope', async () => {
    citationMocks.getRouterParam.mockReturnValue('cite-1')
    citationMocks.getRuntimeAdminAccess.mockReturnValue(false)

    const mockStore = {
      findWebReplayableCitationById: vi.fn().mockResolvedValue({
        accessLevel: 'internal',
        chunkTextSnapshot: 'This is the cited text.',
        citationId: 'cite-1',
        citationLocator: 'doc-1:section:2',
        documentId: 'doc-1',
        documentTitle: 'Doc 1',
        documentVersionId: 'dv-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        isCurrentVersion: true,
        queryLogId: 'query-log-1',
        sourceChunkId: 'chunk-1',
        versionNumber: 2,
      }),
    }
    citationMocks.createMcpReplayStore.mockReturnValue(mockStore)

    const { default: handler } = await import('../../server/api/citations/[citationId].get')
    const result = await handler(createRouteEvent())

    expect(result).toEqual({
      data: {
        chunkText: 'This is the cited text.',
        citationId: 'cite-1',
        citationLocator: 'doc-1:section:2',
        documentId: 'doc-1',
        documentTitle: 'Doc 1',
        isCurrentVersion: true,
        versionNumber: 2,
      },
    })
  })

  it('returns 404 when citation is not found or expired', async () => {
    citationMocks.getRouterParam.mockReturnValue('cite-missing')

    const mockStore = {
      findWebReplayableCitationById: vi.fn().mockResolvedValue(null),
    }
    citationMocks.createMcpReplayStore.mockReturnValue(mockStore)

    const { default: handler } = await import('../../server/api/citations/[citationId].get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('returns 403 when user does not have access to restricted content', async () => {
    citationMocks.getRouterParam.mockReturnValue('cite-restricted')
    citationMocks.getRuntimeAdminAccess.mockReturnValue(false)

    const mockStore = {
      findWebReplayableCitationById: vi.fn().mockResolvedValue({
        accessLevel: 'restricted',
        chunkTextSnapshot: 'Restricted content.',
        citationId: 'cite-restricted',
        citationLocator: 'doc-1:section:1',
        documentId: 'doc-1',
        documentTitle: 'Doc 1',
        documentVersionId: 'dv-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        isCurrentVersion: true,
        queryLogId: 'query-log-1',
        sourceChunkId: 'chunk-1',
        versionNumber: 1,
      }),
    }
    citationMocks.createMcpReplayStore.mockReturnValue(mockStore)

    const { default: handler } = await import('../../server/api/citations/[citationId].get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('allows admin to access restricted content', async () => {
    citationMocks.getRouterParam.mockReturnValue('cite-restricted')
    citationMocks.getRuntimeAdminAccess.mockReturnValue(true)

    const mockStore = {
      findWebReplayableCitationById: vi.fn().mockResolvedValue({
        accessLevel: 'restricted',
        chunkTextSnapshot: 'Restricted content for admin.',
        citationId: 'cite-restricted',
        citationLocator: 'doc-1:section:1',
        documentId: 'doc-1',
        documentTitle: 'Doc 1',
        documentVersionId: 'dv-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
        isCurrentVersion: true,
        queryLogId: 'query-log-1',
        sourceChunkId: 'chunk-1',
        versionNumber: 1,
      }),
    }
    citationMocks.createMcpReplayStore.mockReturnValue(mockStore)

    const { default: handler } = await import('../../server/api/citations/[citationId].get')
    const result = await handler(createRouteEvent())

    expect(result).toEqual({
      data: {
        chunkText: 'Restricted content for admin.',
        citationId: 'cite-restricted',
        citationLocator: 'doc-1:section:1',
        documentId: 'doc-1',
        documentTitle: 'Doc 1',
        isCurrentVersion: true,
        versionNumber: 1,
        admin: {
          documentVersionId: 'dv-1',
          expiresAt: '2099-01-01T00:00:00.000Z',
          queryLogId: 'query-log-1',
          sourceChunkId: 'chunk-1',
        },
      },
    })
  })
})
