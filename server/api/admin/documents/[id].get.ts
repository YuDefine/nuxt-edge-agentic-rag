import { useLogger } from 'evlog'
import { documentIdOrSlugParamSchema } from '#shared/schemas/admin-documents'
import { createDocumentListStore } from '#server/utils/document-list-store'

const UUID_PREFIX_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/

export default defineEventHandler(async function getAdminDocumentHandler(event) {
  const log = useLogger(event)
  await requireRuntimeAdminSession(event)

  const params = await getValidatedRouterParams(event, documentIdOrSlugParamSchema.parse)

  const store = createDocumentListStore()

  let documentId = params.id
  if (!UUID_PREFIX_RE.test(documentId)) {
    const resolved = await store.findDocumentIdBySlugOrId(documentId)
    if (!resolved) {
      throw createError({
        statusCode: 404,
        statusMessage: '找不到此文件',
      })
    }
    documentId = resolved
  }

  let document
  try {
    document = await store.getDocumentWithVersions(documentId)
  } catch (error) {
    log.error(error as Error, { step: 'fetch-document-with-versions' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入文件資訊，請稍後再試',
    })
  }

  if (!document) {
    throw createError({
      statusCode: 404,
      statusMessage: '找不到此文件',
    })
  }

  return {
    data: document,
  }
})
