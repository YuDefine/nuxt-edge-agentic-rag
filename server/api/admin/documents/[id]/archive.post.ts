import { eq } from 'drizzle-orm'
import { useLogger } from 'evlog'

import { archiveDocumentParamsSchema } from '#shared/schemas/admin-documents'

export default defineEventHandler(async function archiveDocumentHandler(event) {
  const log = useLogger(event)
  const session = await requireRuntimeAdminSession(event)

  const params = await getValidatedRouterParams(event, archiveDocumentParamsSchema.parse)

  log.set({
    operation: 'admin-document-archive',
    table: 'documents',
    user: { id: session.user.id ?? null },
    documentId: params.id,
  })

  const { db, schema } = await import('hub:db')

  const [documentRow] = await db
    .select({
      id: schema.documents.id,
      status: schema.documents.status,
      archivedAt: schema.documents.archivedAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, params.id))
    .limit(1)

  if (!documentRow) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: '找不到此文件',
    })
  }

  if (documentRow.status === 'archived') {
    log.set({ result: { documentId: documentRow.id, noOp: true } })
    return {
      data: {
        documentId: documentRow.id,
        status: 'archived' as const,
        archivedAt: documentRow.archivedAt,
        noOp: true,
      },
    }
  }

  const archivedAt = new Date().toISOString()

  // Idempotent write: if two archive calls race, the second overwrites archivedAt
  // with a later timestamp. End-state convergence is guaranteed.
  await db
    .update(schema.documents)
    .set({
      status: 'archived',
      archivedAt,
      updatedAt: archivedAt,
    })
    .where(eq(schema.documents.id, params.id))

  log.set({ result: { documentId: documentRow.id, status: 'archived', archivedAt, noOp: false } })

  return {
    data: {
      documentId: documentRow.id,
      status: 'archived' as const,
      archivedAt,
      noOp: false,
    },
  }
})
