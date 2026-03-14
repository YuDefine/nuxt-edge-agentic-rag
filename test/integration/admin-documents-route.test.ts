import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const adminDocumentsMocks = vi.hoisted(() => ({
  createDocumentListStore: vi.fn().mockReturnValue({
    listDocumentsWithCurrentVersion: vi.fn(),
  }),
  getKnowledgeRuntimeConfig: vi.fn().mockReturnValue({
    bindings: {
      d1Database: 'DB',
    },
  }),
  getRequiredD1Binding: vi.fn().mockReturnValue({}),
  requireRuntimeAdminSession: vi.fn().mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@example.com' },
  }),
}))

vi.mock('../../server/utils/document-list-store', () => ({
  createDocumentListStore: adminDocumentsMocks.createDocumentListStore,
}))

installNuxtRouteTestGlobals()

describe('GET /api/admin/documents', () => {
  beforeEach(() => {
    vi.stubGlobal('getKnowledgeRuntimeConfig', adminDocumentsMocks.getKnowledgeRuntimeConfig)
    vi.stubGlobal('getRequiredD1Binding', adminDocumentsMocks.getRequiredD1Binding)
    vi.stubGlobal('requireRuntimeAdminSession', adminDocumentsMocks.requireRuntimeAdminSession)
  })

  it('requires admin session', async () => {
    adminDocumentsMocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { statusCode: 401 }),
    )

    const { default: handler } = await import('../../server/api/admin/documents/index.get')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('returns documents with current version info in unified response envelope', async () => {
    const mockDocuments = [
      {
        id: 'doc-1',
        title: 'Document 1',
        slug: 'doc-1',
        categorySlug: 'general',
        accessLevel: 'internal',
        status: 'active',
        currentVersionId: 'ver-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        currentVersion: {
          id: 'ver-1',
          versionNumber: 1,
          syncStatus: 'synced',
          indexStatus: 'indexed',
          publishedAt: '2024-01-02T00:00:00Z',
        },
      },
    ]

    const mockStore = {
      listDocumentsWithCurrentVersion: vi.fn().mockResolvedValue(mockDocuments),
    }
    adminDocumentsMocks.createDocumentListStore.mockReturnValue(mockStore)

    const { default: handler } = await import('../../server/api/admin/documents/index.get')
    const result = await handler(createRouteEvent())

    expect(adminDocumentsMocks.requireRuntimeAdminSession).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      data: mockDocuments,
    })
  })

  it('returns empty array when no documents exist', async () => {
    const mockStore = {
      listDocumentsWithCurrentVersion: vi.fn().mockResolvedValue([]),
    }
    adminDocumentsMocks.createDocumentListStore.mockReturnValue(mockStore)

    const { default: handler } = await import('../../server/api/admin/documents/index.get')
    const result = await handler(createRouteEvent())

    expect(result).toEqual({
      data: [],
    })
  })
})
