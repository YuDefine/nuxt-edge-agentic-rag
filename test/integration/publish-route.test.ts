import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHubDbMock } from './helpers/database'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const publishRouteMocks = vi.hoisted(() => ({
  createDocumentSyncStore: vi.fn().mockReturnValue({
    findDocumentById: vi.fn().mockResolvedValue(null),
  }),
  getKnowledgeRuntimeConfig: vi.fn().mockReturnValue({
    bindings: {
      d1Database: 'DB',
    },
  }),
  getRequiredD1Binding: vi.fn().mockReturnValue({}),
  getRouterParam: vi.fn(),
  publishDocumentVersion: vi.fn(),
  requireRuntimeAdminSession: vi.fn().mockResolvedValue(undefined),
  rewriteVersionMetadata: vi.fn().mockResolvedValue(undefined),
}))

class MockDocumentPublishStateError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'DocumentPublishStateError'
  }
}

vi.mock('../../server/utils/database', () => createHubDbMock())

vi.mock('../../server/utils/document-publish', () => ({
  DocumentPublishStateError: MockDocumentPublishStateError,
  publishDocumentVersion: publishRouteMocks.publishDocumentVersion,
}))

vi.mock('../../server/utils/document-store', () => ({
  createDocumentSyncStore: publishRouteMocks.createDocumentSyncStore,
}))

vi.mock('../../server/utils/document-publish-r2', () => ({
  rewriteVersionMetadata: publishRouteMocks.rewriteVersionMetadata,
}))

installNuxtRouteTestGlobals()

describe('publish route', () => {
  beforeEach(() => {
    vi.stubGlobal('getKnowledgeRuntimeConfig', publishRouteMocks.getKnowledgeRuntimeConfig)
    vi.stubGlobal('getRequiredD1Binding', publishRouteMocks.getRequiredD1Binding)
    vi.stubGlobal('getRouterParam', publishRouteMocks.getRouterParam)
    vi.stubGlobal('requireRuntimeAdminSession', publishRouteMocks.requireRuntimeAdminSession)
  })

  it('rejects requests without both route params', async () => {
    publishRouteMocks.getRouterParam.mockImplementation((_event: unknown, key: string) =>
      key === 'documentId' ? 'doc-1' : undefined
    )

    const { default: handler } =
      await import('../../server/api/documents/[documentId]/versions/[versionId]/publish.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      message: 'documentId and versionId are required',
      statusCode: 400,
    })
  })

  it('returns publish results through the unified response envelope', async () => {
    publishRouteMocks.getRouterParam.mockImplementation((_event: unknown, key: string) =>
      key === 'documentId' ? 'doc-1' : 'ver-1'
    )
    publishRouteMocks.publishDocumentVersion.mockResolvedValue({
      alreadyCurrent: false,
      documentId: 'doc-1',
      publishedVersionId: 'ver-1',
      status: 'published',
    })

    const { default: handler } =
      await import('../../server/api/documents/[documentId]/versions/[versionId]/publish.post')
    const result = await handler(createRouteEvent())

    expect(publishRouteMocks.requireRuntimeAdminSession).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      data: {
        alreadyCurrent: false,
        documentId: 'doc-1',
        publishedVersionId: 'ver-1',
        status: 'published',
      },
    })
  })
})
