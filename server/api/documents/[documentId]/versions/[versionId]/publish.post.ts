import { getD1Database } from '#server/utils/database'
import { publishDocumentVersion, DocumentPublishStateError } from '#server/utils/document-publish'
import { rewriteVersionMetadata } from '#server/utils/document-publish-r2'
import { createDocumentSyncStore } from '#server/utils/document-store'

export default defineEventHandler(async (event) => {
  await requireRuntimeAdminSession(event)

  const database = await getD1Database()
  const documentId = getRouterParam(event, 'documentId')
  const versionId = getRouterParam(event, 'versionId')

  if (!documentId || !versionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'documentId and versionId are required',
    })
  }

  const store = createDocumentSyncStore(database)
  const previousCurrent = (await store.findDocumentById(documentId))?.currentVersionId ?? null

  try {
    const result = await publishDocumentVersion({ documentId, versionId }, { store })

    if (!result.alreadyCurrent) {
      if (previousCurrent && previousCurrent !== versionId) {
        await rewriteVersionMetadata(event, previousCurrent, 'previous')
      }
      await rewriteVersionMetadata(event, versionId, 'current')
    }

    return {
      data: result,
    }
  } catch (error) {
    if (error instanceof DocumentPublishStateError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.name,
        message: error.message,
      })
    }

    throw error
  }
})
