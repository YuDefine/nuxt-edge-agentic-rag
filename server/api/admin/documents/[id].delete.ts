import { and, count, eq, sql } from 'drizzle-orm'
import { useLogger } from 'evlog'

import {
  deleteDocumentParamsSchema,
  type DeleteDocumentRejectReason,
} from '#shared/schemas/admin-documents'
import { assertNever } from '#shared/utils/assert-never'
import { evaluateDocumentDeletability } from '#server/utils/document-deletability'

export default defineEventHandler(async function deleteDocumentHandler(event) {
  const log = useLogger(event)
  const session = await requireRuntimeAdminSession(event)

  const params = await getValidatedRouterParams(event, deleteDocumentParamsSchema.parse)

  log.set({
    operation: 'admin-document-delete',
    table: 'documents',
    user: { id: session.user.id ?? null },
    documentId: params.id,
  })

  const { db, schema } = await import('hub:db')

  const [[documentRow], versionRows] = await Promise.all([
    db
      .select({
        id: schema.documents.id,
        status: schema.documents.status,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, params.id))
      .limit(1),
    db
      .select({
        id: schema.documentVersions.id,
        publishedAt: schema.documentVersions.publishedAt,
      })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, params.id)),
  ])

  if (!documentRow) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: '找不到此文件',
    })
  }

  const normalizedStatus = normalizeDocumentStatus(documentRow.status)
  const decision = evaluateDocumentDeletability({
    documentStatus: normalizedStatus,
    versions: versionRows,
  })

  if (!decision.deletable) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: rejectReasonMessage(decision.reason as DeleteDocumentRejectReason),
      data: { reason: decision.reason },
    })
  }

  const [chunkCountRow] = await db
    .select({ count: count() })
    .from(schema.sourceChunks)
    .innerJoin(
      schema.documentVersions,
      eq(schema.sourceChunks.documentVersionId, schema.documentVersions.id)
    )
    .where(eq(schema.documentVersions.documentId, params.id))

  const removedSourceChunkCount = chunkCountRow?.count ?? 0

  // Guard against TOCTOU: delete only if the document is still in 'draft' status
  // AND still has no published versions. A concurrent publish could have flipped
  // status to 'active' or set published_at between our read and this write; the
  // compound WHERE ensures we never silently delete a document that is no longer
  // eligible. We check affected rows via returning().
  const deleted = await db
    .delete(schema.documents)
    .where(
      and(
        eq(schema.documents.id, params.id),
        eq(schema.documents.status, 'draft'),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.documentVersions} WHERE ${schema.documentVersions.documentId} = ${schema.documents.id} AND ${schema.documentVersions.publishedAt} IS NOT NULL)`
      )
    )
    .returning({ id: schema.documents.id })

  if (deleted.length === 0) {
    // Another admin or background flow changed state between our check and this
    // delete. Surface as 409 so the caller re-fetches and retries with fresh
    // state.
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: '文件狀態已變更，請重新整理後再試',
      data: { reason: 'state-changed' },
    })
  }

  log.set({
    result: {
      documentId: params.id,
      removedVersionCount: versionRows.length,
      removedSourceChunkCount,
    },
  })

  // NOTE: R2 source objects (source_r2_key / normalized_text_r2_key) are left in
  // place; their cleanup is deferred to the retention job. See
  // openspec/changes/admin-document-lifecycle-ops/design.md for the rationale.

  return {
    data: {
      documentId: params.id,
      deleted: true as const,
      removedVersionCount: versionRows.length,
      removedSourceChunkCount,
    },
  }
})

function normalizeDocumentStatus(value: string): 'draft' | 'active' | 'archived' {
  switch (value) {
    case 'draft':
    case 'active':
    case 'archived':
      return value
    default:
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: '文件狀態資料異常',
      })
  }
}

function rejectReasonMessage(reason: DeleteDocumentRejectReason): string {
  switch (reason) {
    case 'has-published-history':
      return '此文件曾發布過版本，請改用封存操作'
    case 'status-active':
      return '已發布的文件無法刪除，請改用封存操作'
    case 'status-archived':
      return '封存的文件由保留期限管理，無法手動刪除'
    default:
      return assertNever(reason, 'rejectReasonMessage')
  }
}
