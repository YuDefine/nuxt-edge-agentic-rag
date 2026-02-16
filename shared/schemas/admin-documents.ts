import { z } from 'zod'

export const DELETE_DOCUMENT_REJECT_REASON_VALUES = [
  'has-published-history',
  'status-active',
  'status-archived',
] as const

export type DeleteDocumentRejectReason = (typeof DELETE_DOCUMENT_REJECT_REASON_VALUES)[number]

export const DOCUMENT_DELETABILITY_REASON_VALUES = [
  'draft-never-published',
  ...DELETE_DOCUMENT_REJECT_REASON_VALUES,
] as const

export type DocumentDeletabilityReason = (typeof DOCUMENT_DELETABILITY_REASON_VALUES)[number]

export const RETRY_SYNC_REJECT_REASON_VALUES = [
  'already-running',
  'already-completed',
  'upload-pending',
  'preprocessing-incomplete',
] as const

export type RetrySyncRejectReason = (typeof RETRY_SYNC_REJECT_REASON_VALUES)[number]

const documentIdParamSchema = z.object({
  id: z.string().uuid(),
})

const versionScopedParamSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
})

export const retryDocumentSyncParamsSchema = versionScopedParamSchema
export const deleteDocumentParamsSchema = documentIdParamSchema
export const archiveDocumentParamsSchema = documentIdParamSchema
export const unarchiveDocumentParamsSchema = documentIdParamSchema

export const retryDocumentSyncResponseSchema = z.object({
  data: z.object({
    documentId: z.string().uuid(),
    versionId: z.string().uuid(),
    syncStatus: z.literal('running'),
  }),
})

export const deleteDocumentResponseSchema = z.object({
  data: z.object({
    documentId: z.string().uuid(),
    deleted: z.literal(true),
    removedVersionCount: z.number().int().min(0),
    removedSourceChunkCount: z.number().int().min(0),
  }),
})

export const archiveDocumentResponseSchema = z.object({
  data: z.object({
    documentId: z.string().uuid(),
    status: z.literal('archived'),
    archivedAt: z.string(),
    noOp: z.boolean(),
  }),
})

export const unarchiveDocumentResponseSchema = z.object({
  data: z.object({
    documentId: z.string().uuid(),
    status: z.literal('active'),
    archivedAt: z.null(),
    noOp: z.boolean(),
  }),
})

export type RetryDocumentSyncResponse = z.infer<typeof retryDocumentSyncResponseSchema>
export type DeleteDocumentResponse = z.infer<typeof deleteDocumentResponseSchema>
export type ArchiveDocumentResponse = z.infer<typeof archiveDocumentResponseSchema>
export type UnarchiveDocumentResponse = z.infer<typeof unarchiveDocumentResponseSchema>
