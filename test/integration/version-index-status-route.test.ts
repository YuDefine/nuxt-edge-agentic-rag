import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const routeMocks = vi.hoisted(() => ({
  createDocumentSyncStore: vi.fn().mockReturnValue({}),
  findVersionById: vi.fn(),
  getKnowledgeRuntimeConfig: vi.fn().mockReturnValue({
    autoRag: { apiToken: '' },
    bindings: { aiSearchIndex: 'agentic-rag', d1Database: 'DB', rateLimitKv: 'KV' },
    uploads: { accountId: 'acct-1' },
  }),
  getRequiredD1Binding: vi.fn().mockReturnValue({}),
  getRequiredKvBinding: vi.fn().mockReturnValue({
    get: vi.fn(),
    put: vi.fn(),
  }),
  getRouterParam: vi.fn(),
  requireRuntimeAdminSession: vi.fn().mockResolvedValue(undefined),
  setVersionIndexingStatus: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('../../server/utils/document-store', () => ({
  createDocumentSyncStore: () => ({
    findVersionById: routeMocks.findVersionById,
    setVersionIndexingStatus: routeMocks.setVersionIndexingStatus,
  }),
}))

installNuxtRouteTestGlobals()

describe('version index-status route', () => {
  beforeEach(() => {
    vi.stubGlobal('getKnowledgeRuntimeConfig', routeMocks.getKnowledgeRuntimeConfig)
    vi.stubGlobal('getRequiredD1Binding', routeMocks.getRequiredD1Binding)
    vi.stubGlobal('getRequiredKvBinding', routeMocks.getRequiredKvBinding)
    vi.stubGlobal('getRouterParam', routeMocks.getRouterParam)
    vi.stubGlobal('requireRuntimeAdminSession', routeMocks.requireRuntimeAdminSession)
    routeMocks.findVersionById.mockReset()
    routeMocks.setVersionIndexingStatus.mockReset()
  })

  it('rejects requests missing route params', async () => {
    routeMocks.getRouterParam.mockImplementation((_event: unknown, key: string) =>
      key === 'documentId' ? 'doc-1' : undefined
    )

    const { default: handler } =
      await import('../../server/api/documents/[documentId]/versions/[versionId]/index-status.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      message: 'documentId and versionId are required',
      statusCode: 400,
    })
  })

  it('returns 404 when the version does not belong to the requested document', async () => {
    routeMocks.getRouterParam.mockImplementation((_event: unknown, key: string) =>
      key === 'documentId' ? 'doc-1' : 'ver-1'
    )
    routeMocks.findVersionById.mockResolvedValue({
      documentId: 'doc-other',
      id: 'ver-1',
      indexStatus: 'indexed',
      syncStatus: 'completed',
    })

    const { default: handler } =
      await import('../../server/api/documents/[documentId]/versions/[versionId]/index-status.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('returns index and sync status through the unified response envelope', async () => {
    routeMocks.getRouterParam.mockImplementation((_event: unknown, key: string) =>
      key === 'documentId' ? 'doc-1' : 'ver-1'
    )
    routeMocks.findVersionById.mockResolvedValue({
      documentId: 'doc-1',
      id: 'ver-1',
      indexStatus: 'smoke_pending',
      syncStatus: 'running',
    })

    const { default: handler } =
      await import('../../server/api/documents/[documentId]/versions/[versionId]/index-status.get')
    const result = await handler(createRouteEvent())

    expect(routeMocks.requireRuntimeAdminSession).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      data: {
        indexStatus: 'smoke_pending',
        syncStatus: 'running',
        versionId: 'ver-1',
      },
    })
  })
})
