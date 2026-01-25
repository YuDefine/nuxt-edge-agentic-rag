import { z } from 'zod'
import { createDocumentListStore } from '../../../utils/document-list-store'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export default defineEventHandler(async function getAdminDocumentHandler(event) {
  await requireRuntimeAdminSession(event)

  const params = await getValidatedRouterParams(event, paramsSchema.parse)

  const store = createDocumentListStore()

  const document = await store.getDocumentWithVersions(params.id)

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
