import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

interface VersionRow {
  id: string
  documentId: string
  syncStatus: 'pending' | 'running' | 'completed' | 'failed'
  indexStatus: 'upload_pending' | 'preprocessing' | 'smoke_pending' | 'indexed' | 'failed'
  normalizedTextR2Key: string | null
  hasSourceChunks: boolean
}

interface MockDb {
  version: VersionRow | null
  updates: Array<{ versionId: string; syncStatus: string }>
}

function makeChainableSelect(state: MockDb) {
  function makeSourceChunkChain() {
    return {
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.version?.hasSourceChunks ? [{ exists: 1 }] : []),
        }),
      }),
    }
  }

  function makeVersionChain() {
    return {
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              state.version
                ? [
                    {
                      id: state.version.id,
                      documentId: state.version.documentId,
                      syncStatus: state.version.syncStatus,
                      indexStatus: state.version.indexStatus,
                      normalizedTextR2Key: state.version.normalizedTextR2Key,
                    },
                  ]
                : []
            ),
        }),
      }),
    }
  }

  return (projection: Record<string, unknown>) => {
    const keys = Object.keys(projection)
    if (keys.includes('exists') || keys.includes('chunkExists')) {
      return makeSourceChunkChain()
    }
    return makeVersionChain()
  }
}

const retrySyncMocks = vi.hoisted(() => ({
  dbState: {
    version: null,
    updates: [],
  } as MockDb,
  getRouterParams: vi.fn(),
  requireRuntimeAdminSession: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('hub:db', () => {
  const schema = {
    documentVersions: { id: 'id-col', documentId: 'doc-id-col' },
    sourceChunks: { documentVersionId: 'dv-id-col' },
  }
  const mockDb = {
    select: (projection: Record<string, unknown>) => {
      const builder = makeChainableSelect(retrySyncMocks.dbState)(projection)
      return builder
    },
    update: () => ({
      set: (values: { syncStatus: string }) => ({
        where: () => ({
          returning: () => {
            // TOCTOU guard: only allow transition if current status is 'pending' or 'failed'
            const v = retrySyncMocks.dbState.version
            if (!v) return Promise.resolve([])
            if (v.syncStatus !== 'pending' && v.syncStatus !== 'failed') {
              return Promise.resolve([])
            }
            retrySyncMocks.dbState.updates.push({
              versionId: v.id,
              syncStatus: values.syncStatus,
            })
            v.syncStatus = values.syncStatus as VersionRow['syncStatus']
            return Promise.resolve([{ id: v.id }])
          },
        }),
      }),
    }),
  }
  return { db: mockDb, schema }
})

installNuxtRouteTestGlobals()

describe('POST /api/admin/documents/[id]/versions/[versionId]/retry-sync', () => {
  beforeEach(() => {
    retrySyncMocks.dbState.version = null
    retrySyncMocks.dbState.updates = []
    retrySyncMocks.requireRuntimeAdminSession.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
    retrySyncMocks.getRouterParams.mockReturnValue({
      id: 'd1111111-1111-4111-8111-111111111111',
      versionId: 'd2222222-2222-4222-8222-222222222222',
    })

    vi.stubGlobal(
      'getValidatedRouterParams',
      async (_event: unknown, parse: (v: unknown) => unknown) =>
        parse(retrySyncMocks.getRouterParams())
    )
    vi.stubGlobal('requireRuntimeAdminSession', retrySyncMocks.requireRuntimeAdminSession)
  })

  it('advances sync_status from failed to running', async () => {
    retrySyncMocks.dbState.version = {
      id: 'd2222222-2222-4222-8222-222222222222',
      documentId: 'd1111111-1111-4111-8111-111111111111',
      syncStatus: 'failed',
      indexStatus: 'indexed',
      normalizedTextR2Key: 'keys/abc.txt',
      hasSourceChunks: true,
    }

    const { default: handler } =
      await import('../../server/api/admin/documents/[id]/versions/[versionId]/retry-sync.post')
    const result = await handler(createRouteEvent())

    expect(retrySyncMocks.dbState.updates).toEqual([
      {
        versionId: 'd2222222-2222-4222-8222-222222222222',
        syncStatus: 'running',
      },
    ])
    expect(result).toEqual({
      data: {
        documentId: 'd1111111-1111-4111-8111-111111111111',
        versionId: 'd2222222-2222-4222-8222-222222222222',
        syncStatus: 'running',
      },
    })
  })

  it('rejects when preprocessing artifacts are missing', async () => {
    retrySyncMocks.dbState.version = {
      id: 'd2222222-2222-4222-8222-222222222222',
      documentId: 'd1111111-1111-4111-8111-111111111111',
      syncStatus: 'failed',
      indexStatus: 'preprocessing',
      normalizedTextR2Key: null,
      hasSourceChunks: false,
    }

    const { default: handler } =
      await import('../../server/api/admin/documents/[id]/versions/[versionId]/retry-sync.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 409 })
    expect(retrySyncMocks.dbState.updates).toEqual([])
  })

  it('rejects when sync is already running', async () => {
    retrySyncMocks.dbState.version = {
      id: 'd2222222-2222-4222-8222-222222222222',
      documentId: 'd1111111-1111-4111-8111-111111111111',
      syncStatus: 'running',
      indexStatus: 'preprocessing',
      normalizedTextR2Key: 'keys/abc.txt',
      hasSourceChunks: true,
    }

    const { default: handler } =
      await import('../../server/api/admin/documents/[id]/versions/[versionId]/retry-sync.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 409 })
    expect(retrySyncMocks.dbState.updates).toEqual([])
  })

  it('rejects when sync is completed', async () => {
    retrySyncMocks.dbState.version = {
      id: 'd2222222-2222-4222-8222-222222222222',
      documentId: 'd1111111-1111-4111-8111-111111111111',
      syncStatus: 'completed',
      indexStatus: 'indexed',
      normalizedTextR2Key: 'keys/abc.txt',
      hasSourceChunks: true,
    }

    const { default: handler } =
      await import('../../server/api/admin/documents/[id]/versions/[versionId]/retry-sync.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 409 })
    expect(retrySyncMocks.dbState.updates).toEqual([])
  })

  it('rejects non-admin callers', async () => {
    retrySyncMocks.requireRuntimeAdminSession.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    )

    const { default: handler } =
      await import('../../server/api/admin/documents/[id]/versions/[versionId]/retry-sync.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({ statusCode: 403 })
    expect(retrySyncMocks.dbState.updates).toEqual([])
  })
})
