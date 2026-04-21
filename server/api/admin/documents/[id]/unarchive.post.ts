import { eq } from 'drizzle-orm'
import { useLogger } from 'evlog'

import { unarchiveDocumentParamsSchema } from '#shared/schemas/admin-documents'

export default defineEventHandler(async function unarchiveDocumentHandler(event) {
  const log = useLogger(event)
  const session = await requireRuntimeAdminSession(event)

  const params = await getValidatedRouterParams(event, unarchiveDocumentParamsSchema.parse)

  log.set({
    operation: 'admin-document-unarchive',
    table: 'documents',
    user: { id: session.user.id ?? null },
    documentId: params.id,
  })

  const { db, schema } = await import('hub:db')

  let documentRow
  try {
    ;[documentRow] = await db
      .select({
        id: schema.documents.id,
        status: schema.documents.status,
        archivedAt: schema.documents.archivedAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, params.id))
      .limit(1)
  } catch (error) {
    log.error(error as Error, { step: 'fetch-document' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入文件資訊，請稍後再試',
    })
  }

  if (!documentRow) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: '找不到此文件',
    })
  }

  if (documentRow.status !== 'archived') {
    log.set({ result: { documentId: documentRow.id, noOp: true } })
    return {
      data: {
        documentId: documentRow.id,
        status: 'active' as const,
        archivedAt: null,
        noOp: true,
      },
    }
  }

  try {
    await db
      .update(schema.documents)
      .set({
        status: 'active',
        archivedAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.documents.id, params.id))
  } catch (error) {
    log.error(error as Error, { step: 'unarchive-document' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法取消封存，請稍後再試',
    })
  }

  log.set({ result: { documentId: documentRow.id, status: 'active', noOp: false } })

  return {
    data: {
      documentId: documentRow.id,
      status: 'active' as const,
      archivedAt: null,
      noOp: false,
    },
  }
})
