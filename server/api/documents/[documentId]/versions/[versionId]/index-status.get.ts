import { useLogger } from 'evlog'

import { getAutoRagJobStatus } from '#server/utils/autorag-sync'
import { getD1Database } from '#server/utils/database'
import { createDocumentSyncStore } from '#server/utils/document-store'

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  await requireRuntimeAdminSession(event)

  const documentId = getRouterParam(event, 'documentId')
  const versionId = getRouterParam(event, 'versionId')

  if (!documentId || !versionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'documentId and versionId are required',
    })
  }

  const database = await getD1Database()
  const store = createDocumentSyncStore(database)
  let version = await store.findVersionById(versionId)

  if (!version || version.documentId !== documentId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Document version was not found',
    })
  }

  const isTerminal =
    version.indexStatus === 'indexed' ||
    version.syncStatus === 'failed' ||
    version.syncStatus === 'completed'

  if (!isTerminal) {
    const runtimeConfig = getKnowledgeRuntimeConfig()
    if (runtimeConfig.autoRag.apiToken) {
      const kvBinding = getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)
      const jobId = await kvBinding.get(`autorag-job:${versionId}`)
      if (jobId) {
        try {
          const jobStatus = await getAutoRagJobStatus(
            {
              accountId: runtimeConfig.uploads.accountId,
              apiToken: runtimeConfig.autoRag.apiToken,
              instanceName: runtimeConfig.bindings.aiSearchIndex,
            },
            jobId,
          )
          if (jobStatus.status === 'completed') {
            await store.setVersionIndexingStatus(versionId, {
              indexStatus: 'indexed',
              syncStatus: 'completed',
            })
            version = (await store.findVersionById(versionId)) ?? version
          } else if (jobStatus.status === 'failed') {
            await store.setVersionIndexingStatus(versionId, {
              indexStatus: 'preprocessing',
              syncStatus: 'failed',
            })
            version = (await store.findVersionById(versionId)) ?? version
          }
        } catch (error) {
          log.error(error as Error, { jobId, step: 'autorag-job-status' })
        }
      }
    }
  }

  return {
    data: {
      indexStatus: version.indexStatus,
      syncStatus: version.syncStatus,
      versionId: version.id,
    },
  }
})
