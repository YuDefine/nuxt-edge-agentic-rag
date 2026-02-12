import type { DocumentRecord, DocumentVersionRecord } from '#shared/types/knowledge'

import { prepareDocumentVersionAssets } from './document-preprocessing'

export interface SyncDocumentVersionSnapshotInput {
  accessLevel: string
  adminUserId: string
  categorySlug: string
  checksumSha256: string
  environment: string
  mimeType: string
  objectKey: string
  size: number
  slug: string
  title: string
  uploadId: string
}

export interface DocumentSyncStore {
  createDocument(input: {
    accessLevel: string
    categorySlug: string
    createdByUserId: string
    slug: string
    status: string
    title: string
  }): Promise<DocumentRecord>
  createSourceChunks(
    documentVersionId: string,
    chunks: Array<{
      accessLevel: string
      chunkHash: string
      chunkIndex: number
      chunkText: string
      citationLocator: string
      metadata: Record<string, number>
    }>
  ): Promise<void>
  createVersion(input: {
    documentId: string
    id: string
    indexStatus: string
    metadataJson: string
    normalizedTextR2Key: string
    sourceR2Key: string
    smokeTestQueriesJson: string
    syncStatus: string
    versionNumber: number
  }): Promise<DocumentVersionRecord>
  findDocumentBySlug(slug: string): Promise<DocumentRecord | null>
  getNextVersionNumber(documentId: string): Promise<number>
}

export interface SyncDocumentVersionSnapshotOptions {
  createId?: () => string
  loadSourceText: (objectKey: string) => Promise<string>
  now?: () => Date
  store: DocumentSyncStore
  writeNormalizedText: (objectKey: string, normalizedText: string) => Promise<void>
}

function defaultCreateId(): string {
  return crypto.randomUUID()
}

export async function syncDocumentVersionSnapshot(
  input: SyncDocumentVersionSnapshotInput,
  options: SyncDocumentVersionSnapshotOptions
): Promise<{
  document: DocumentRecord
  smokeTestQueries: string[]
  sourceChunkCount: number
  version: DocumentVersionRecord
}> {
  const existingDocument = await options.store.findDocumentBySlug(input.slug)
  const document =
    existingDocument ??
    (await options.store.createDocument({
      accessLevel: input.accessLevel,
      categorySlug: input.categorySlug,
      createdByUserId: input.adminUserId,
      slug: input.slug,
      status: 'draft',
      title: input.title,
    }))
  const versionId = (options.createId ?? defaultCreateId)()
  const versionNumber = await options.store.getNextVersionNumber(document.id)
  const sourceText = await options.loadSourceText(input.objectKey)
  const assets = await prepareDocumentVersionAssets({
    accessLevel: input.accessLevel,
    categorySlug: input.categorySlug,
    documentId: document.id,
    environment: input.environment,
    sourceMimeType: input.mimeType,
    sourceObjectKey: input.objectKey,
    sourceText,
    title: input.title,
    versionId,
    versionNumber,
  })

  await options.writeNormalizedText(assets.normalizedTextR2Key, assets.normalizedText)

  const version = await options.store.createVersion({
    documentId: document.id,
    id: versionId,
    indexStatus: 'preprocessing',
    metadataJson: JSON.stringify(assets.metadata),
    normalizedTextR2Key: assets.normalizedTextR2Key,
    sourceR2Key: input.objectKey,
    smokeTestQueriesJson: JSON.stringify(assets.smokeTestQueries),
    syncStatus: 'pending',
    versionNumber,
  })

  await options.store.createSourceChunks(version.id, assets.sourceChunks)

  return {
    document,
    smokeTestQueries: assets.smokeTestQueries,
    sourceChunkCount: assets.sourceChunks.length,
    version,
  }
}
