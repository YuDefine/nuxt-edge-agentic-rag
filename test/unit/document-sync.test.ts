import { describe, expect, it, vi } from 'vitest'

import { syncDocumentVersionSnapshot } from '#server/utils/document-sync'

describe('document sync', () => {
  it('creates a draft document, version snapshot, and source chunks for a finalized upload', async () => {
    const store = {
      createDocument: vi.fn().mockResolvedValue({
        accessLevel: 'restricted',
        categorySlug: 'finance',
        createdAt: '2026-04-16T00:00:00.000Z',
        createdByUserId: 'admin-1',
        currentVersionId: null,
        id: 'doc-1',
        slug: 'quarterly-report',
        status: 'draft',
        title: 'Quarterly Report',
        updatedAt: '2026-04-16T00:00:00.000Z',
      }),
      createSourceChunks: vi.fn().mockResolvedValue(undefined),
      createVersion: vi.fn().mockResolvedValue({
        createdAt: '2026-04-16T00:00:00.000Z',
        documentId: 'doc-1',
        id: 'ver-1',
        indexStatus: 'preprocessing',
        isCurrent: false,
        metadataJson: JSON.stringify({
          accessLevel: 'restricted',
          categorySlug: 'finance',
          sourceMimeType: 'text/markdown',
          sourceObjectKey: 'staged/staging/admin-1/upload-1/quarterly-report.md',
          title: 'Quarterly Report',
          versionNumber: 1,
        }),
        normalizedTextR2Key: 'normalized-text/ver-1/',
        publishedAt: null,
        smokeTestQueriesJson: JSON.stringify(['Quarterly Report', 'Executive Summary']),
        sourceR2Key: 'staged/staging/admin-1/upload-1/quarterly-report.md',
        syncStatus: 'pending',
        updatedAt: '2026-04-16T00:00:00.000Z',
        versionNumber: 1,
      }),
      findDocumentBySlug: vi.fn().mockResolvedValue(null),
      getNextVersionNumber: vi.fn().mockResolvedValue(1),
    }
    const loadSourceText = vi
      .fn()
      .mockResolvedValue(
        ['# Quarterly Report', '', '## Executive Summary', 'Revenue grew 20%.'].join('\n')
      )
    const writeChunkObjects = vi.fn().mockResolvedValue(undefined)

    const result = await syncDocumentVersionSnapshot(
      {
        accessLevel: 'restricted',
        adminUserId: 'admin-1',
        categorySlug: 'finance',
        checksumSha256: 'abc123',
        environment: 'local',
        mimeType: 'text/markdown',
        objectKey: 'staged/staging/admin-1/upload-1/quarterly-report.md',
        size: 128,
        slug: 'quarterly-report',
        title: 'Quarterly Report',
        uploadId: 'upload-1',
      },
      {
        createId: () => 'ver-1',
        loadSourceText,
        now: () => new Date('2026-04-16T00:00:00.000Z'),
        store,
        writeChunkObjects,
      }
    )

    expect(store.findDocumentBySlug).toHaveBeenCalledWith('quarterly-report')
    expect(store.createDocument).toHaveBeenCalledWith({
      accessLevel: 'restricted',
      categorySlug: 'finance',
      createdByUserId: 'admin-1',
      slug: 'quarterly-report',
      status: 'draft',
      title: 'Quarterly Report',
    })
    expect(writeChunkObjects).toHaveBeenCalledWith([
      {
        customMetadata: {
          access_level: 'restricted',
          citation_locator: 'lines 1-3',
          document_version_id: 'ver-1',
          status: 'active',
          version_state: 'current',
        },
        key: 'normalized-text/ver-1/0001.txt',
        text: ['Quarterly Report', 'Executive Summary', 'Revenue grew 20%.'].join('\n'),
      },
    ])
    expect(store.createVersion).toHaveBeenCalledWith({
      documentId: 'doc-1',
      id: 'ver-1',
      indexStatus: 'preprocessing',
      metadataJson: JSON.stringify({
        accessLevel: 'restricted',
        categorySlug: 'finance',
        sourceMimeType: 'text/markdown',
        sourceObjectKey: 'staged/staging/admin-1/upload-1/quarterly-report.md',
        title: 'Quarterly Report',
        versionNumber: 1,
      }),
      normalizedTextR2Key: 'normalized-text/ver-1/',
      sourceR2Key: 'staged/staging/admin-1/upload-1/quarterly-report.md',
      smokeTestQueriesJson: JSON.stringify(['Quarterly Report', 'Executive Summary']),
      syncStatus: 'pending',
      versionNumber: 1,
    })
    expect(store.createSourceChunks).toHaveBeenCalledWith(
      'ver-1',
      expect.arrayContaining([
        expect.objectContaining({
          chunkIndex: 0,
          citationLocator: 'lines 1-3',
        }),
      ])
    )
    expect(result.document.id).toBe('doc-1')
    expect(result.version.id).toBe('ver-1')
    expect(result.sourceChunkCount).toBe(1)
  })

  it('creates a replacement version for an existing document without mutating current pointers', async () => {
    const store = {
      createDocument: vi.fn(),
      createSourceChunks: vi.fn().mockResolvedValue(undefined),
      createVersion: vi.fn().mockResolvedValue({
        createdAt: '2026-04-16T00:00:00.000Z',
        documentId: 'doc-1',
        id: 'ver-2',
        indexStatus: 'preprocessing',
        isCurrent: false,
        metadataJson: '{}',
        normalizedTextR2Key: 'normalized-text/ver-2/',
        publishedAt: null,
        smokeTestQueriesJson: JSON.stringify(['Ops Playbook']),
        sourceR2Key: 'staged/local/admin-1/upload-2/playbook.txt',
        syncStatus: 'pending',
        updatedAt: '2026-04-16T00:00:00.000Z',
        versionNumber: 3,
      }),
      findDocumentBySlug: vi.fn().mockResolvedValue({
        accessLevel: 'internal',
        archivedAt: null,
        categorySlug: 'ops',
        createdAt: '2026-04-10T00:00:00.000Z',
        createdByUserId: 'admin-1',
        currentVersionId: 'ver-current',
        id: 'doc-1',
        slug: 'ops-playbook',
        status: 'active',
        title: 'Ops Playbook',
        updatedAt: '2026-04-10T00:00:00.000Z',
      }),
      getNextVersionNumber: vi.fn().mockResolvedValue(3),
    }

    await syncDocumentVersionSnapshot(
      {
        accessLevel: 'internal',
        adminUserId: 'admin-1',
        categorySlug: 'ops',
        checksumSha256: 'abc123',
        environment: 'local',
        mimeType: 'text/plain',
        objectKey: 'staged/local/admin-1/upload-2/playbook.txt',
        size: 128,
        slug: 'ops-playbook',
        title: 'Ops Playbook',
        uploadId: 'upload-2',
      },
      {
        createId: () => 'ver-2',
        loadSourceText: () => Promise.resolve('Ops Playbook\nEscalate incidents quickly.'),
        store,
        writeChunkObjects: () => Promise.resolve(),
      }
    )

    expect(store.createDocument).not.toHaveBeenCalled()
    expect(store.getNextVersionNumber).toHaveBeenCalledWith('doc-1')
    expect(store.createVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        id: 'ver-2',
        versionNumber: 3,
      })
    )
  })
})
