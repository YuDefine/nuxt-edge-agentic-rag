import type { DocumentRecord, DocumentVersionRecord } from '#shared/types/knowledge'

export class DocumentPublishStateError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'DocumentPublishStateError'
  }
}

export interface DocumentPublishStore {
  findDocumentById(documentId: string): Promise<DocumentRecord | null>
  findVersionById(versionId: string): Promise<DocumentVersionRecord | null>
  publishVersionAtomic(input: {
    documentId: string
    previousCurrentVersionId: string | null
    promoteToActive: boolean
    publishedAt: string
    versionId: string
  }): Promise<DocumentVersionRecord>
}

export async function publishDocumentVersion(
  input: {
    documentId: string
    versionId: string
  },
  options: {
    now?: () => Date
    store: DocumentPublishStore
  }
): Promise<{
  alreadyCurrent: boolean
  documentId: string
  version: DocumentVersionRecord
}> {
  const document = await options.store.findDocumentById(input.documentId)

  if (!document) {
    throw new DocumentPublishStateError('Document was not found', 404)
  }

  if (document.status === 'archived') {
    throw new DocumentPublishStateError(
      'Cannot publish a version: the document has been archived',
      409
    )
  }

  const isFirstPublish = document.currentVersionId === null
  const canPromoteDraft = document.status === 'draft' && isFirstPublish

  if (document.status !== 'active' && !canPromoteDraft) {
    throw new DocumentPublishStateError('Only active documents can publish versions', 409)
  }

  const version = await options.store.findVersionById(input.versionId)

  if (!version || version.documentId !== input.documentId) {
    throw new DocumentPublishStateError('Document version was not found', 404)
  }

  if (version.isCurrent) {
    return {
      alreadyCurrent: true,
      documentId: document.id,
      version,
    }
  }

  if (version.indexStatus !== 'indexed' || version.syncStatus === 'running') {
    throw new DocumentPublishStateError(
      'Only indexed versions without in-progress sync tasks can be published',
      409
    )
  }

  const publishedAt = (options.now ?? (() => new Date()))().toISOString()
  const publishedVersion = await options.store.publishVersionAtomic({
    documentId: document.id,
    previousCurrentVersionId: document.currentVersionId,
    promoteToActive: canPromoteDraft,
    publishedAt,
    versionId: version.id,
  })

  return {
    alreadyCurrent: false,
    documentId: document.id,
    version: publishedVersion,
  }
}
