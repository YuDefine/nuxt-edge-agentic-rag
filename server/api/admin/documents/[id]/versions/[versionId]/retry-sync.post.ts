import { and, eq, inArray } from 'drizzle-orm'
import { useLogger } from 'evlog'

import { retryDocumentSyncParamsSchema } from '#shared/schemas/admin-documents'

export default defineEventHandler(async function retryDocumentSyncHandler(event) {
  const log = useLogger(event)
  const session = await requireRuntimeAdminSession(event)

  const params = await getValidatedRouterParams(event, retryDocumentSyncParamsSchema.parse)

  log.set({
    operation: 'admin-document-retry-sync',
    table: 'document_versions',
    user: { id: session.user.id ?? null },
    documentId: params.id,
    versionId: params.versionId,
  })

  const { db, schema } = await import('hub:db')

  const [version] = await db
    .select({
      id: schema.documentVersions.id,
      documentId: schema.documentVersions.documentId,
      syncStatus: schema.documentVersions.syncStatus,
      indexStatus: schema.documentVersions.indexStatus,
      normalizedTextR2Key: schema.documentVersions.normalizedTextR2Key,
    })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.id, params.versionId),
        eq(schema.documentVersions.documentId, params.id),
      ),
    )
    .limit(1)

  if (!version) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: '找不到此版本',
    })
  }

  if (version.syncStatus === 'running') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: '同步已在進行中',
    })
  }

  if (version.syncStatus === 'completed' || version.syncStatus === 'synced') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: '此版本同步已完成，無須重試',
    })
  }

  if (version.indexStatus === 'upload_pending') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: '此版本仍在等待上傳完成，請重新上傳',
    })
  }

  if (version.indexStatus === 'preprocessing') {
    const normalizedTextMissing = !version.normalizedTextR2Key

    if (!normalizedTextMissing) {
      const [chunkRow] = await db
        .select({ chunkExists: schema.sourceChunks.id })
        .from(schema.sourceChunks)
        .where(eq(schema.sourceChunks.documentVersionId, version.id))
        .limit(1)

      if (!chunkRow) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Conflict',
          message: '前處理資料不完整，請重新上傳以觸發前處理',
        })
      }
    } else {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: '前處理資料不完整，請重新上傳以觸發前處理',
      })
    }
  }

  // TOCTOU guard: only flip to 'running' if sync_status is still a retryable
  // value. A concurrent sync completion or concurrent retry could have updated
  // the row since we read it above; the compound WHERE prevents us from
  // regressing a completed sync back to 'running' and from double-enqueueing.
  const updated = await db
    .update(schema.documentVersions)
    .set({
      syncStatus: 'running',
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.documentVersions.id, version.id),
        inArray(schema.documentVersions.syncStatus, ['pending', 'failed']),
      ),
    )
    .returning({ id: schema.documentVersions.id })

  if (updated.length === 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: '同步狀態已變更，請重新整理後再試',
    })
  }

  log.set({
    result: {
      versionId: version.id,
      documentId: version.documentId,
      syncStatus: 'running',
    },
  })

  return {
    data: {
      documentId: version.documentId,
      versionId: version.id,
      syncStatus: 'running' as const,
    },
  }
})
