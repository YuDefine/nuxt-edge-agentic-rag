import { useLogger } from 'evlog'
import { z } from 'zod'

import { triggerAutoRagSync } from '#server/utils/autorag-sync'
import { getD1Database } from '#server/utils/database'
import { createDocumentSyncStore } from '#server/utils/document-store'
import { syncDocumentVersionSnapshot } from '#server/utils/document-sync'

const syncDocumentSchema = z.object({
  accessLevel: z.enum(['internal', 'restricted']),
  categorySlug: z.string().trim().max(255).default(''),
  checksumSha256: z.string().trim().min(1, 'checksumSha256 is required'),
  mimeType: z.string().trim().min(1, 'mimeType is required').max(255),
  objectKey: z.string().trim().min(1, 'objectKey is required'),
  size: z.number().int().positive('size must be a positive integer'),
  slug: z.string().trim().min(1, 'slug is required').max(255),
  title: z.string().trim().min(1, 'title is required').max(255),
  uploadId: z.string().trim().min(1, 'uploadId is required'),
})

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const { user } = await requireRuntimeAdminSession(event)
  const body = await readZodBody(event, syncDocumentSchema)
  const runtimeConfig = getKnowledgeRuntimeConfig()
  const environment = runtimeConfig.environment
  const bucket = createR2ObjectAccess(event)
  const database = await getD1Database()
  const store = createDocumentSyncStore(database)

  const result = await syncDocumentVersionSnapshot(
    {
      accessLevel: body.accessLevel,
      adminUserId: user.id,
      categorySlug: body.categorySlug,
      checksumSha256: body.checksumSha256,
      environment,
      mimeType: body.mimeType,
      objectKey: body.objectKey,
      size: body.size,
      slug: body.slug,
      title: body.title,
      uploadId: body.uploadId,
    },
    {
      loadSourceText: async (objectKey) => {
        const text = await bucket.getText(objectKey)

        if (text === null) {
          throw createError({
            statusCode: 404,
            statusMessage: 'Not Found',
            message: 'Uploaded source file was not found',
          })
        }

        return text
      },
      store,
      writeChunkObjects: async (objects) => {
        await Promise.all(
          objects.map((object) =>
            bucket.put(object.key, object.text, 'text/plain; charset=utf-8', object.customMetadata)
          )
        )
      },
    }
  )

  if (runtimeConfig.autoRag.apiToken) {
    const kvBinding = getRequiredKvBinding(event, runtimeConfig.bindings.rateLimitKv)
    try {
      const job = await triggerAutoRagSync({
        accountId: runtimeConfig.uploads.accountId,
        apiToken: runtimeConfig.autoRag.apiToken,
        instanceName: runtimeConfig.bindings.aiSearchIndex,
      })
      await kvBinding.put(`autorag-job:${result.version.id}`, job.jobId, {
        expirationTtl: 3600,
      })
      await store.setVersionIndexingStatus(result.version.id, {
        indexStatus: 'preprocessing',
        syncStatus: 'running',
      })
    } catch (error) {
      log.error(error as Error, { step: 'autorag-trigger' })
      await store.setVersionIndexingStatus(result.version.id, {
        indexStatus: 'preprocessing',
        syncStatus: 'failed',
      })
      throw createError({
        statusCode: 502,
        statusMessage: 'Bad Gateway',
        message: 'AutoRAG sync 觸發失敗，請稍後重試或聯絡管理員',
      })
    }
  } else {
    await store.setVersionIndexingStatus(result.version.id, {
      indexStatus: 'indexed',
      syncStatus: 'completed',
    })
  }

  return {
    data: {
      document: result.document,
      smokeTestQueries: result.smokeTestQueries,
      sourceChunkCount: result.sourceChunkCount,
      version: result.version,
    },
  }
})
