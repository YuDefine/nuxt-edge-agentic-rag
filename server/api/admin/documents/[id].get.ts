import { useLogger } from 'evlog'
import { z } from 'zod'
import { createDocumentListStore } from '#server/utils/document-list-store'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export default defineEventHandler(async function getAdminDocumentHandler(event) {
  const log = useLogger(event)
  await requireRuntimeAdminSession(event)

  const params = await getValidatedRouterParams(event, paramsSchema.parse)

  const store = createDocumentListStore()

  let document
  try {
    document = await store.getDocumentWithVersions(params.id)
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
