import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

interface DocumentRow {
  id: string
  status: 'draft' | 'active' | 'archived'
}

interface VersionRow {
  id: string
  publishedAt: string | null
}

interface MockState {
  document: DocumentRow | null
  versions: VersionRow[]
  sourceChunkCount: number
  deletedDocumentIds: string[]
}

const deleteMocks = vi.hoisted(() => ({
  state: {
    document: null,
    versions: [],
    sourceChunkCount: 0,
    deletedDocumentIds: [],
  } as MockState,
  getRouterParams: vi.fn(),
  readBody: vi.fn(),
  requireRuntimeAdminSession: vi.fn(),
}))

const DOC_ID = 'd1111111-1111-4111-8111-111111111111'

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('hub:db', () => {
  const schema = {
    documents: { id: 'doc-id' },
    documentVersions: { id: 'dv-id', documentId: 'dv-doc-id', publishedAt: 'dv-published-at' },
    sourceChunks: { documentVersionId: 'sc-dv-id' },
  }

  function selectBuilder(projection: Record<string, unknown>) {
    const keys = Object.keys(projection)
    if (keys.includes('status')) {
      // documents query
      return {
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve(
                deleteMocks.state.document
                  ? [
                      {
                        id: deleteMocks.state.document.id,
                        status: deleteMocks.state.document.status,
                      },
                    ]
                  : [],
              ),
          }),
        }),
      }
    }
    if (keys.includes('publishedAt')) {
      // document_versions query
      return {
        from: () => ({
          where: () =>
            Promise.resolve(
              deleteMocks.state.versions.map((v) => ({ id: v.id, publishedAt: v.publishedAt })),
            ),
        }),
      }
    }
    if (keys.includes('count')) {
      // source_chunks count query (we use a simple count projection)
      return {
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve([{ count: deleteMocks.state.sourceChunkCount }]),
          }),
        }),
      }
    }
    throw new Error(`Unexpected projection: ${JSON.stringify(projection)}`)
  }

  const mockDb = {
    select: selectBuilder,
    delete: () => ({
      where: () => ({
        returning: () => {
          // TOCTOU guard: only delete if status is still 'draft' and no published history.
          const doc = deleteMocks.state.document
          if (!doc) return Promise.resolve([])
          if (doc.status !== 'draft') return Promise.resolve([])
          const hasPublished = deleteMocks.state.versions.some((v) => v.publishedAt !== null)
          if (hasPublished) return Promise.resolve([])
          deleteMocks.state.deletedDocumentIds.push(doc.id)
          return Promise.resolve([{ id: doc.id }])
        },
      }),
    }),
  }

  return { db: mockDb, schema }
})

installNuxtRouteTestGlobals()

describe('DELETE /api/admin/documents/[id]', () => {
  beforeEach(() => {
    deleteMocks.state.document = null
    deleteMocks.state.versions = []
    deleteMocks.state.sourceChunkCount = 0
    deleteMocks.state.deletedDocumentIds = []
    deleteMocks.readBody.mockResolvedValue({})
    deleteMocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
    deleteMocks.getRouterParams.mockReturnValue({ id: DOC_ID })

    vi.stubGlobal('readBody', deleteMocks.readBody)
    vi.stubGlobal(
      'getValidatedRouterParams',
      async (_event: unknown, parse: (v: unknown) => unknown) =>
        parse(deleteMocks.getRouterParams()),
    )
    vi.stubGlobal('requireRuntimeAdminSession', deleteMocks.requireRuntimeAdminSession)
  })

  it('deletes a draft document that was never published', async () => {
    deleteMocks.state.document = { id: DOC_ID, status: 'draft' }
    deleteMocks.state.versions = [
      { id: 'v1', publishedAt: null },
      { id: 'v2', publishedAt: null },
    ]
    deleteMocks.state.sourceChunkCount = 7

    const { default: handler } = await import('../../server/api/admin/documents/[id].delete')
    const result = await handler(createRouteEvent())

    expect(deleteMocks.state.deletedDocumentIds).toEqual([DOC_ID])
    expect(result).toEqual({
      data: {
        documentId: DOC_ID,
        deleted: true,
        removedVersionCount: 2,
        removedSourceChunkCount: 7,
      },
    })
  })

  it('rejects when document has published history', async () => {
    deleteMocks.state.document = { id: DOC_ID, status: 'draft' }
    deleteMocks.state.versions = [
      { id: 'v1', publishedAt: null },
      { id: 'v2', publishedAt: '2026-01-01T00:00:00Z' },
    ]

    const { default: handler } = await import('../../server/api/admin/documents/[id].delete')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 409,
      data: { reason: 'has-published-history' },
    })
    expect(deleteMocks.state.deletedDocumentIds).toEqual([])
  })

  it('rejects when document status is active', async () => {
    deleteMocks.state.document = { id: DOC_ID, status: 'active' }
    deleteMocks.state.versions = [{ id: 'v1', publishedAt: null }]

    const { default: handler } = await import('../../server/api/admin/documents/[id].delete')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 409,
      data: { reason: 'status-active' },
    })
    expect(deleteMocks.state.deletedDocumentIds).toEqual([])
  })

  it('rejects when document status is archived', async () => {
    deleteMocks.state.document = { id: DOC_ID, status: 'archived' }
    deleteMocks.state.versions = [{ id: 'v1', publishedAt: null }]

    const { default: handler } = await import('../../server/api/admin/documents/[id].delete')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 409,
      data: { reason: 'status-archived' },
    })
    expect(deleteMocks.state.deletedDocumentIds).toEqual([])
  })

  it('ignores client-supplied force flag', async () => {
    deleteMocks.state.document = { id: DOC_ID, status: 'active' }
    deleteMocks.state.versions = [{ id: 'v1', publishedAt: null }]
    deleteMocks.readBody.mockResolvedValue({ force: true, confirm: 'yes' })

    const { default: handler } = await import('../../server/api/admin/documents/[id].delete')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 409,
      data: { reason: 'status-active' },
    })
    expect(deleteMocks.state.deletedDocumentIds).toEqual([])
  })
})
