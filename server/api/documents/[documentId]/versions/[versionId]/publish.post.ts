import {
  publishDocumentVersion,
  DocumentPublishStateError,
} from '../../../../../utils/document-publish'
import { createDocumentSyncStore } from '../../../../../utils/document-store'

export default defineEventHandler(async (event) => {
  await requireRuntimeAdminSession(event)

  const runtimeConfig = getKnowledgeRuntimeConfig()
  const database = getRequiredD1Binding(event, runtimeConfig.bindings.d1Database)
  const documentId = getRouterParam(event, 'documentId')
  const versionId = getRouterParam(event, 'versionId')

  if (!documentId || !versionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'documentId and versionId are required',
    })
  }

  try {
    const result = await publishDocumentVersion(
      {
        documentId,
        versionId,
      },
      {
        store: createDocumentSyncStore(database),
      }
    )

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
