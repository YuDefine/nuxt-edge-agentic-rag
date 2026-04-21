import { useLogger } from 'evlog'

import { getD1Database } from '#server/utils/database'
import { publishDocumentVersion, DocumentPublishStateError } from '#server/utils/document-publish'
import { rewriteVersionMetadata } from '#server/utils/document-publish-r2'
import { createDocumentSyncStore } from '#server/utils/document-store'

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
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

  let previousCurrent: string | null = null
  try {
    previousCurrent = (await store.findDocumentById(documentId))?.currentVersionId ?? null
  } catch (error) {
    log.error(error as Error, { step: 'find-document' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入文件資訊，請稍後再試',
    })
  }

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

    log.error(error as Error, { step: 'publish-document-version' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '發布版本失敗，請稍後再試',
    })
  }
})
