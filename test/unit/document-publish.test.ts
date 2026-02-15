import { describe, expect, it, vi } from 'vitest'

import { DocumentPublishStateError, publishDocumentVersion } from '#server/utils/document-publish'

describe('document publish', () => {
  it('publishes an indexed replacement version and atomically switches current version', async () => {
    const store = {
      findDocumentById: vi.fn().mockResolvedValue({
        accessLevel: 'internal',
        archivedAt: null,
        categorySlug: 'finance',
        createdAt: '2026-04-10T00:00:00.000Z',
        createdByUserId: 'admin-1',
        currentVersionId: 'ver-1',
        id: 'doc-1',
        slug: 'quarterly-report',
        status: 'active',
        title: 'Quarterly Report',
        updatedAt: '2026-04-10T00:00:00.000Z',
      }),
      findVersionById: vi.fn().mockResolvedValue({
        createdAt: '2026-04-16T00:00:00.000Z',
        documentId: 'doc-1',
        id: 'ver-2',
        indexStatus: 'indexed',
        isCurrent: false,
        metadataJson: '{}',
        normalizedTextR2Key: 'normalized/local/doc-1/ver-2.txt',
        publishedAt: null,
        smokeTestQueriesJson: '[]',
        sourceR2Key: 'staged/local/admin-1/upload-2/report.txt',
        syncStatus: 'completed',
        updatedAt: '2026-04-16T00:00:00.000Z',
        versionNumber: 2,
      }),
      publishVersionAtomic: vi.fn().mockResolvedValue({
        createdAt: '2026-04-16T00:00:00.000Z',
        documentId: 'doc-1',
        id: 'ver-2',
        indexStatus: 'indexed',
        isCurrent: true,
        metadataJson: '{}',
        normalizedTextR2Key: 'normalized/local/doc-1/ver-2.txt',
        publishedAt: '2026-04-16T01:00:00.000Z',
        smokeTestQueriesJson: '[]',
        sourceR2Key: 'staged/local/admin-1/upload-2/report.txt',
        syncStatus: 'completed',
        updatedAt: '2026-04-16T01:00:00.000Z',
        versionNumber: 2,
      }),
    }

    const result = await publishDocumentVersion(
      {
        documentId: 'doc-1',
        versionId: 'ver-2',
      },
      {
        now: () => new Date('2026-04-16T01:00:00.000Z'),
        store,
      }
    )

    expect(store.publishVersionAtomic).toHaveBeenCalledWith({
      documentId: 'doc-1',
      previousCurrentVersionId: 'ver-1',
      promoteToActive: false,
      publishedAt: '2026-04-16T01:00:00.000Z',
      versionId: 'ver-2',
    })
    expect(result).toEqual({
      alreadyCurrent: false,
      documentId: 'doc-1',
      version: expect.objectContaining({
        id: 'ver-2',
        isCurrent: true,
        publishedAt: '2026-04-16T01:00:00.000Z',
      }),
    })
  })

  it('returns a no-op success when the target version is already current', async () => {
    const store = {
      findDocumentById: vi.fn().mockResolvedValue({
        accessLevel: 'internal',
        archivedAt: null,
        categorySlug: 'finance',
        createdAt: '2026-04-10T00:00:00.000Z',
        createdByUserId: 'admin-1',
        currentVersionId: 'ver-2',
        id: 'doc-1',
        slug: 'quarterly-report',
        status: 'active',
        title: 'Quarterly Report',
        updatedAt: '2026-04-10T00:00:00.000Z',
      }),
      findVersionById: vi.fn().mockResolvedValue({
        createdAt: '2026-04-16T00:00:00.000Z',
        documentId: 'doc-1',
        id: 'ver-2',
        indexStatus: 'indexed',
        isCurrent: true,
        metadataJson: '{}',
        normalizedTextR2Key: 'normalized/local/doc-1/ver-2.txt',
        publishedAt: '2026-04-16T01:00:00.000Z',
        smokeTestQueriesJson: '[]',
        sourceR2Key: 'staged/local/admin-1/upload-2/report.txt',
        syncStatus: 'completed',
        updatedAt: '2026-04-16T01:00:00.000Z',
        versionNumber: 2,
      }),
      publishVersionAtomic: vi.fn(),
    }

    const result = await publishDocumentVersion(
      {
        documentId: 'doc-1',
        versionId: 'ver-2',
      },
      { store }
    )

    expect(store.publishVersionAtomic).not.toHaveBeenCalled()
    expect(result).toEqual({
      alreadyCurrent: true,
      documentId: 'doc-1',
      version: expect.objectContaining({
        id: 'ver-2',
        isCurrent: true,
      }),
    })
  })

  it('promotes a draft document to active on first publish', async () => {
    const store = {
      findDocumentById: vi.fn().mockResolvedValue({
        accessLevel: 'internal',
        archivedAt: null,
        categorySlug: 'finance',
        createdAt: '2026-04-18T00:00:00.000Z',
        createdByUserId: 'admin-1',
        currentVersionId: null,
        id: 'doc-draft',
        slug: 'first-doc',
        status: 'draft',
        title: 'First Doc',
        updatedAt: '2026-04-18T00:00:00.000Z',
      }),
      findVersionById: vi.fn().mockResolvedValue({
        createdAt: '2026-04-18T00:00:00.000Z',
        documentId: 'doc-draft',
        id: 'ver-1',
        indexStatus: 'indexed',
        isCurrent: false,
        metadataJson: '{}',
        normalizedTextR2Key: 'normalized/local/doc-draft/ver-1.txt',
        publishedAt: null,
        smokeTestQueriesJson: '[]',
        sourceR2Key: 'staged/local/admin-1/upload-1/first.txt',
        syncStatus: 'completed',
        updatedAt: '2026-04-18T00:00:00.000Z',
        versionNumber: 1,
      }),
      publishVersionAtomic: vi.fn().mockResolvedValue({
        createdAt: '2026-04-18T00:00:00.000Z',
        documentId: 'doc-draft',
        id: 'ver-1',
        indexStatus: 'indexed',
        isCurrent: true,
        metadataJson: '{}',
        normalizedTextR2Key: 'normalized/local/doc-draft/ver-1.txt',
        publishedAt: '2026-04-18T01:00:00.000Z',
        smokeTestQueriesJson: '[]',
        sourceR2Key: 'staged/local/admin-1/upload-1/first.txt',
        syncStatus: 'completed',
        updatedAt: '2026-04-18T01:00:00.000Z',
        versionNumber: 1,
      }),
    }

    const result = await publishDocumentVersion(
      {
        documentId: 'doc-draft',
        versionId: 'ver-1',
      },
      {
        now: () => new Date('2026-04-18T01:00:00.000Z'),
        store,
      }
    )

    expect(store.publishVersionAtomic).toHaveBeenCalledWith({
      documentId: 'doc-draft',
      previousCurrentVersionId: null,
      promoteToActive: true,
      publishedAt: '2026-04-18T01:00:00.000Z',
      versionId: 'ver-1',
    })
    expect(result.alreadyCurrent).toBe(false)
    expect(result.documentId).toBe('doc-draft')
  })

  it('rejects publish when the document is archived with a distinct error message', async () => {
    const store = {
      findDocumentById: vi.fn().mockResolvedValue({
        accessLevel: 'internal',
        archivedAt: '2026-04-17T00:00:00.000Z',
        categorySlug: 'finance',
        createdAt: '2026-04-10T00:00:00.000Z',
        createdByUserId: 'admin-1',
        currentVersionId: 'ver-old',
        id: 'doc-archived',
        slug: 'old-doc',
        status: 'archived',
        title: 'Archived Doc',
        updatedAt: '2026-04-17T00:00:00.000Z',
      }),
      findVersionById: vi.fn(),
      publishVersionAtomic: vi.fn(),
    }

    await expect(
      publishDocumentVersion(
        {
          documentId: 'doc-archived',
          versionId: 'ver-2',
        },
        { store }
      )
    ).rejects.toMatchObject({
      message: expect.stringContaining('archived'),
      name: 'DocumentPublishStateError',
      statusCode: 409,
    })

    expect(store.findVersionById).not.toHaveBeenCalled()
    expect(store.publishVersionAtomic).not.toHaveBeenCalled()
  })

  it('rejects publish when the version is not indexed or still syncing', async () => {
    const store = {
      findDocumentById: vi.fn().mockResolvedValue({
        accessLevel: 'internal',
        archivedAt: null,
        categorySlug: 'finance',
        createdAt: '2026-04-10T00:00:00.000Z',
        createdByUserId: 'admin-1',
        currentVersionId: 'ver-1',
        id: 'doc-1',
        slug: 'quarterly-report',
        status: 'active',
        title: 'Quarterly Report',
        updatedAt: '2026-04-10T00:00:00.000Z',
      }),
      findVersionById: vi.fn().mockResolvedValue({
        createdAt: '2026-04-16T00:00:00.000Z',
        documentId: 'doc-1',
        id: 'ver-2',
        indexStatus: 'smoke_pending',
        isCurrent: false,
        metadataJson: '{}',
        normalizedTextR2Key: 'normalized/local/doc-1/ver-2.txt',
        publishedAt: null,
        smokeTestQueriesJson: '[]',
        sourceR2Key: 'staged/local/admin-1/upload-2/report.txt',
        syncStatus: 'running',
        updatedAt: '2026-04-16T01:00:00.000Z',
        versionNumber: 2,
      }),
      publishVersionAtomic: vi.fn(),
    }

    await expect(
      publishDocumentVersion(
        {
          documentId: 'doc-1',
          versionId: 'ver-2',
        },
        { store }
      )
    ).rejects.toThrowError(
      new DocumentPublishStateError(
        'Only indexed versions without in-progress sync tasks can be published',
        409
      )
    )
  })
})
