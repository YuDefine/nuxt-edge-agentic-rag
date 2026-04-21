import { useLogger } from 'evlog'

import { createDocumentListStore } from '#server/utils/document-list-store'

export default defineEventHandler(async function listAdminDocumentsHandler(event) {
  const log = useLogger(event)
  await requireRuntimeAdminSession(event)

  const store = createDocumentListStore()
  try {
    const documents = await store.listDocumentsWithCurrentVersion()

    return {
      data: documents,
    }
  } catch (error) {
    log.error(error as Error, { step: 'list-admin-documents' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入文件清單，請稍後再試',
    })
  }
})
