import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

interface DocumentRow {
  id: string
  status: 'draft' | 'active' | 'archived'
  archivedAt: string | null
}

interface VersionRow {
  id: string
  isCurrent: boolean
  indexStatus: string
}

interface MockState {
  document: DocumentRow | null
  versions: VersionRow[]
  updates: Array<{
    documentId: string
    status?: string
    archivedAt?: string | null
  }>
  versionWrites: Array<{ versionId: string; isCurrent: boolean; indexStatus: string }>
}

const archiveMocks = vi.hoisted(() => ({
  state: {
    document: null,
    versions: [],
    updates: [],
    versionWrites: [],
  } as MockState,
  getRouterParams: vi.fn(),
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
    documents: {
      id: 'doc-id',
      status: 'doc-status',
      archivedAt: 'doc-archived-at',
      updatedAt: 'doc-updated-at',
    },
    documentVersions: {
      id: 'dv-id',
      documentId: 'dv-doc-id',
      isCurrent: 'dv-is-current',
      indexStatus: 'dv-index-status',
    },
  }

  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              archiveMocks.state.document
                ? [
                    {
                      id: archiveMocks.state.document.id,
                      status: archiveMocks.state.document.status,
                      archivedAt: archiveMocks.state.document.archivedAt,
                    },
                  ]
                : []
            ),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: {
        status?: string
        archivedAt?: string | null
        isCurrent?: boolean
        indexStatus?: string
      }) => ({
        where: () => {
          if (table === schema.documents) {
            if (archiveMocks.state.document) {
              archiveMocks.state.updates.push({
                documentId: archiveMocks.state.document.id,
                status: values.status,
                archivedAt: values.archivedAt,
              })
              if (values.status) {
                archiveMocks.state.document.status = values.status as DocumentRow['status']
              }
              if (values.archivedAt !== undefined) {
                archiveMocks.state.document.archivedAt = values.archivedAt
              }
            }
          } else if (table === schema.documentVersions) {
            archiveMocks.state.versionWrites.push({
              versionId: 'any',
              isCurrent: Boolean(values.isCurrent),
              indexStatus: values.indexStatus ?? 'unchanged',
            })
          }
          return Promise.resolve()
        },
      }),
    }),
  }

  return { db: mockDb, schema }
})

installNuxtRouteTestGlobals()

describe('Document archive & unarchive', () => {
  beforeEach(() => {
    archiveMocks.state.document = null
    archiveMocks.state.versions = []
    archiveMocks.state.updates = []
    archiveMocks.state.versionWrites = []
    archiveMocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
    archiveMocks.getRouterParams.mockReturnValue({ id: DOC_ID })

    vi.stubGlobal(
      'getValidatedRouterParams',
      async (_event: unknown, parse: (v: unknown) => unknown) =>
        parse(archiveMocks.getRouterParams())
    )
    vi.stubGlobal('requireRuntimeAdminSession', archiveMocks.requireRuntimeAdminSession)
  })

  describe('POST /api/admin/documents/[id]/archive', () => {
    it('archives an active document and sets archivedAt', async () => {
      archiveMocks.state.document = { id: DOC_ID, status: 'active', archivedAt: null }

      const { default: handler } =
        await import('../../server/api/admin/documents/[id]/archive.post')
      const result = await handler(createRouteEvent())

      expect(archiveMocks.state.updates.length).toBe(1)
      expect(archiveMocks.state.updates[0]).toMatchObject({
        documentId: DOC_ID,
        status: 'archived',
      })
      expect(archiveMocks.state.updates[0]?.archivedAt).toBeTruthy()
      expect(archiveMocks.state.versionWrites).toEqual([])

      expect(result.data.documentId).toBe(DOC_ID)
      expect(result.data.status).toBe('archived')
      expect(result.data.noOp).toBe(false)
      expect(result.data.archivedAt).toBeTruthy()
    })

    it('returns no-op success when document is already archived', async () => {
      archiveMocks.state.document = {
        id: DOC_ID,
        status: 'archived',
        archivedAt: '2026-01-01T00:00:00Z',
      }

      const { default: handler } =
        await import('../../server/api/admin/documents/[id]/archive.post')
      const result = await handler(createRouteEvent())

      expect(archiveMocks.state.updates).toEqual([])
      expect(result).toEqual({
        data: {
          documentId: DOC_ID,
          status: 'archived',
          archivedAt: '2026-01-01T00:00:00Z',
          noOp: true,
        },
      })
    })

    it('does not touch document_versions when archiving', async () => {
      archiveMocks.state.document = { id: DOC_ID, status: 'active', archivedAt: null }

      const { default: handler } =
        await import('../../server/api/admin/documents/[id]/archive.post')
      await handler(createRouteEvent())

      expect(archiveMocks.state.versionWrites).toEqual([])
    })

    it('returns 404 when document does not exist', async () => {
      archiveMocks.state.document = null

      const { default: handler } =
        await import('../../server/api/admin/documents/[id]/archive.post')
      await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('POST /api/admin/documents/[id]/unarchive', () => {
    it('unarchives an archived document and clears archivedAt', async () => {
      archiveMocks.state.document = {
        id: DOC_ID,
        status: 'archived',
        archivedAt: '2026-01-01T00:00:00Z',
      }

      const { default: handler } =
        await import('../../server/api/admin/documents/[id]/unarchive.post')
      const result = await handler(createRouteEvent())

      expect(archiveMocks.state.updates).toEqual([
        {
          documentId: DOC_ID,
          status: 'active',
          archivedAt: null,
        },
      ])
      expect(archiveMocks.state.versionWrites).toEqual([])
      expect(result).toEqual({
        data: {
          documentId: DOC_ID,
          status: 'active',
          archivedAt: null,
          noOp: false,
        },
      })
    })

    it('returns no-op success when document is already active', async () => {
      archiveMocks.state.document = { id: DOC_ID, status: 'active', archivedAt: null }

      const { default: handler } =
        await import('../../server/api/admin/documents/[id]/unarchive.post')
      const result = await handler(createRouteEvent())

      expect(archiveMocks.state.updates).toEqual([])
      expect(result).toEqual({
        data: {
          documentId: DOC_ID,
          status: 'active',
          archivedAt: null,
          noOp: true,
        },
      })
    })

    it('does not check index_status before unarchiving', async () => {
      // Spec: Unarchive does not re-validate index state (Decision).
      archiveMocks.state.document = {
        id: DOC_ID,
        status: 'archived',
        archivedAt: '2026-01-01T00:00:00Z',
      }

      const { default: handler } =
        await import('../../server/api/admin/documents/[id]/unarchive.post')
      const result = await handler(createRouteEvent())

      expect(result.data.status).toBe('active')
      expect(archiveMocks.state.updates.length).toBe(1)
    })
  })
})
