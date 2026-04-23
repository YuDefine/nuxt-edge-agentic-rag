import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDocxFixture, createPdfFixture } from '../helpers/document-source-fixtures'
import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const syncRouteMocks = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  bucket: {
    getBytes: vi.fn(),
    getText: vi.fn(),
    put: vi.fn(),
  },
  createDocumentSyncStore: vi.fn(),
  getD1Database: vi.fn(),
  requireRuntimeAdminSession: vi.fn(),
  store: {
    createDocument: vi.fn(),
    createSourceChunks: vi.fn(),
    createVersion: vi.fn(),
    findDocumentBySlug: vi.fn(),
    getNextVersionNumber: vi.fn(),
    setVersionIndexingStatus: vi.fn(),
  },
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.mock('../../server/utils/database', () => ({
  getD1Database: syncRouteMocks.getD1Database,
}))

vi.mock('../../server/utils/document-store', () => ({
  createDocumentSyncStore: syncRouteMocks.createDocumentSyncStore,
}))

installNuxtRouteTestGlobals()

describe('document sync route', () => {
  beforeEach(() => {
    syncRouteMocks.body = {}
    syncRouteMocks.bucket.getBytes.mockReset()
    syncRouteMocks.bucket.getText.mockReset()
    syncRouteMocks.bucket.put.mockReset()
    syncRouteMocks.createDocumentSyncStore.mockReset().mockReturnValue(syncRouteMocks.store)
    syncRouteMocks.getD1Database.mockReset().mockResolvedValue({})
    syncRouteMocks.requireRuntimeAdminSession.mockReset().mockResolvedValue({
      user: { id: 'admin-1' },
    })
    syncRouteMocks.store.createDocument.mockReset().mockResolvedValue({
      accessLevel: 'internal',
      archivedAt: null,
      categorySlug: 'finance',
      createdAt: '2026-04-23T00:00:00.000Z',
      createdByUserId: 'admin-1',
      currentVersionId: null,
      id: 'doc-1',
      slug: 'quarterly-report',
      status: 'draft',
      title: 'Quarterly Report',
      updatedAt: '2026-04-23T00:00:00.000Z',
    })
    syncRouteMocks.store.createSourceChunks.mockReset().mockResolvedValue(undefined)
    syncRouteMocks.store.createVersion.mockReset().mockImplementation(async (input) => ({
      createdAt: '2026-04-23T00:00:00.000Z',
      documentId: input.documentId,
      id: input.id,
      indexStatus: input.indexStatus,
      isCurrent: false,
      metadataJson: input.metadataJson,
      normalizedTextR2Key: input.normalizedTextR2Key,
      publishedAt: null,
      smokeTestQueriesJson: input.smokeTestQueriesJson,
      sourceR2Key: input.sourceR2Key,
      syncStatus: input.syncStatus,
      updatedAt: '2026-04-23T00:00:00.000Z',
      versionNumber: input.versionNumber,
    }))
    syncRouteMocks.store.findDocumentBySlug.mockReset().mockResolvedValue(null)
    syncRouteMocks.store.getNextVersionNumber.mockReset().mockResolvedValue(1)
    syncRouteMocks.store.setVersionIndexingStatus.mockReset().mockResolvedValue(undefined)

    vi.stubGlobal('createR2ObjectAccess', () => syncRouteMocks.bucket)
    vi.stubGlobal('getKnowledgeRuntimeConfig', () => ({
      autoRag: { apiToken: '' },
      bindings: {
        aiSearchIndex: 'agentic-rag',
        rateLimitKv: 'KV',
      },
      environment: 'local',
    }))
    vi.stubGlobal('readZodBody', async () => syncRouteMocks.body)
    vi.stubGlobal('requireRuntimeAdminSession', syncRouteMocks.requireRuntimeAdminSession)
  })

  it('uses getText for direct-text uploads and completes the sync response envelope', async () => {
    syncRouteMocks.body = {
      accessLevel: 'internal',
      categorySlug: 'finance',
      checksumSha256: 'abc123',
      mimeType: 'text/markdown',
      objectKey: 'staged/local/admin-1/upload-1/quarterly-report.md',
      size: 128,
      slug: 'quarterly-report',
      title: 'Quarterly Report',
      uploadId: 'upload-1',
    }
    syncRouteMocks.bucket.getText.mockResolvedValue('# Quarterly Report\n\nRevenue grew 20%.')
    syncRouteMocks.bucket.getBytes.mockResolvedValue(new ArrayBuffer(0))

    const { default: handler } = await import('../../server/api/documents/sync.post')
    const result = await handler(createRouteEvent())

    expect(syncRouteMocks.bucket.getText).toHaveBeenCalledWith(
      'staged/local/admin-1/upload-1/quarterly-report.md',
    )
    expect(syncRouteMocks.bucket.getBytes).not.toHaveBeenCalled()
    expect(result).toEqual({
      data: {
        document: expect.objectContaining({ id: 'doc-1' }),
        smokeTestQueries: ['Quarterly Report'],
        sourceChunkCount: 1,
        version: expect.objectContaining({ id: expect.any(String) }),
      },
    })
  })

  it('uses getBytes for supported rich uploads and writes replay chunk objects', async () => {
    syncRouteMocks.body = {
      accessLevel: 'internal',
      categorySlug: 'finance',
      checksumSha256: 'abc123',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      objectKey: 'staged/local/admin-1/upload-1/quarterly-report.docx',
      size: 128,
      slug: 'quarterly-report',
      title: 'Quarterly Report',
      uploadId: 'upload-1',
    }
    syncRouteMocks.bucket.getBytes.mockResolvedValue(
      createDocxFixture({
        paragraphs: ['Quarterly Report', 'Revenue grew 20%.'],
      }).buffer.slice(0),
    )
    syncRouteMocks.bucket.getText.mockResolvedValue(null)

    const { default: handler } = await import('../../server/api/documents/sync.post')
    const result = await handler(createRouteEvent())

    expect(syncRouteMocks.bucket.getBytes).toHaveBeenCalledWith(
      'staged/local/admin-1/upload-1/quarterly-report.docx',
    )
    expect(syncRouteMocks.bucket.getText).not.toHaveBeenCalled()
    expect(syncRouteMocks.bucket.put).toHaveBeenCalled()
    expect(result.data.sourceChunkCount).toBeGreaterThan(0)
  })

  it('accepts supported rich uploads when the browser only reports application/octet-stream', async () => {
    syncRouteMocks.body = {
      accessLevel: 'internal',
      categorySlug: 'finance',
      checksumSha256: 'abc123',
      mimeType: 'application/octet-stream',
      objectKey: 'staged/local/admin-1/upload-1/quarterly-report.docx',
      size: 128,
      slug: 'quarterly-report',
      title: 'Quarterly Report',
      uploadId: 'upload-1',
    }
    syncRouteMocks.bucket.getBytes.mockResolvedValue(
      createDocxFixture({
        paragraphs: ['Quarterly Report', 'Revenue grew 20%.'],
      }).buffer.slice(0),
    )

    const { default: handler } = await import('../../server/api/documents/sync.post')
    const result = await handler(createRouteEvent())

    expect(syncRouteMocks.bucket.getBytes).toHaveBeenCalledWith(
      'staged/local/admin-1/upload-1/quarterly-report.docx',
    )
    expect(result.data.sourceChunkCount).toBeGreaterThan(0)
  })

  it('rejects deferred legacy formats before document or version rows are created', async () => {
    syncRouteMocks.body = {
      accessLevel: 'internal',
      categorySlug: 'finance',
      checksumSha256: 'abc123',
      mimeType: 'application/msword',
      objectKey: 'staged/local/admin-1/upload-1/legacy-plan.doc',
      size: 128,
      slug: 'legacy-plan',
      title: 'Legacy Plan',
      uploadId: 'upload-1',
    }

    const { default: handler } = await import('../../server/api/documents/sync.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      message: '請先轉成 DOCX、PDF 或文字格式後再同步',
      statusCode: 400,
      statusMessage: 'unsupported-format',
    })
    expect(syncRouteMocks.bucket.getText).not.toHaveBeenCalled()
    expect(syncRouteMocks.bucket.getBytes).not.toHaveBeenCalled()
    expect(syncRouteMocks.store.createDocument).not.toHaveBeenCalled()
    expect(syncRouteMocks.store.createVersion).not.toHaveBeenCalled()
  })

  it('rejects textless rich sources before document or version rows are created', async () => {
    syncRouteMocks.body = {
      accessLevel: 'internal',
      categorySlug: 'finance',
      checksumSha256: 'abc123',
      mimeType: 'application/pdf',
      objectKey: 'staged/local/admin-1/upload-1/scanned.pdf',
      size: 128,
      slug: 'scanned-pdf',
      title: 'Scanned PDF',
      uploadId: 'upload-1',
    }
    syncRouteMocks.bucket.getBytes.mockResolvedValue(
      createPdfFixture({ pages: [[]] }).buffer.slice(0),
    )

    const { default: handler } = await import('../../server/api/documents/sync.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      message:
        '檔案可上傳，但目前無法抽出可引用文字。請改提供可選取文字版本，或先整理成 Markdown 後再同步。',
      statusCode: 422,
      statusMessage: 'non-replayable-source',
    })
    expect(syncRouteMocks.store.createDocument).not.toHaveBeenCalled()
    expect(syncRouteMocks.store.createVersion).not.toHaveBeenCalled()
  })

  it('hides extractor internals when a rich document is structurally invalid', async () => {
    syncRouteMocks.body = {
      accessLevel: 'internal',
      categorySlug: 'finance',
      checksumSha256: 'abc123',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      objectKey: 'staged/local/admin-1/upload-1/broken.docx',
      size: 128,
      slug: 'broken-docx',
      title: 'Broken DOCX',
      uploadId: 'upload-1',
    }
    syncRouteMocks.bucket.getBytes.mockResolvedValue(
      createPdfFixture({
        pages: [['not-a-docx']],
      }).buffer.slice(0),
    )

    const { default: handler } = await import('../../server/api/documents/sync.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      message: '文件同步失敗，請稍後再試',
      statusCode: 500,
      statusMessage: 'Internal Server Error',
    })
    expect(syncRouteMocks.store.createDocument).not.toHaveBeenCalled()
    expect(syncRouteMocks.store.createVersion).not.toHaveBeenCalled()
  })
})
