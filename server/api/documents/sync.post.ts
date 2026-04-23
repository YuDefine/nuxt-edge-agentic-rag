import { useLogger } from 'evlog'
import { z } from 'zod'

import { AutoRagCooldownError, triggerAutoRagSync } from '#server/utils/autorag-sync'
import { getD1Database } from '#server/utils/database'
import { DocumentSourceExtractionError } from '#server/utils/document-source-extractor'
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

  let result
  try {
    result = await syncDocumentVersionSnapshot(
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
        loadSourceBytes: async (objectKey) => {
          const bytes = await bucket.getBytes(objectKey)

          if (bytes === null) {
            throw createError({
              statusCode: 404,
              statusMessage: 'Not Found',
              message: 'Uploaded source file was not found',
            })
          }

          return bytes
        },
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
              bucket.put(
                object.key,
                object.text,
                'text/plain; charset=utf-8',
                object.customMetadata,
              ),
            ),
          )
        },
      },
    )
  } catch (error) {
    if (error instanceof DocumentSourceExtractionError) {
      if (error.clientMessage) {
        throw createError({
          statusCode: error.statusCode,
          statusMessage: error.code,
          message: error.clientMessage,
        })
      }

      log.error(error, { code: error.code, step: 'sync-document-snapshot-extraction' })
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: '文件同步失敗，請稍後再試',
      })
    }
    if (isHttpError(error)) {
      throw error
    }
    log.error(error as Error, { step: 'sync-document-snapshot' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '文件同步失敗，請稍後再試',
    })
  }

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
      if (error instanceof AutoRagCooldownError) {
        try {
          await store.setVersionIndexingStatus(result.version.id, {
            indexStatus: 'preprocessing',
            syncStatus: 'pending',
          })
        } catch (storeError) {
          log.error(storeError as Error, { step: 'set-version-pending' })
          throw createError({
            statusCode: 500,
            statusMessage: 'Internal Server Error',
            message: '暫時無法更新版本狀態，請稍後再試',
          })
        }
      } else {
        log.error(error as Error, { step: 'autorag-trigger' })
        try {
          await store.setVersionIndexingStatus(result.version.id, {
            indexStatus: 'preprocessing',
            syncStatus: 'failed',
          })
        } catch (storeError) {
          log.error(storeError as Error, { step: 'set-version-failed' })
        }
        throw createError({
          statusCode: 502,
          statusMessage: 'Bad Gateway',
          message: 'AutoRAG sync 觸發失敗，請稍後重試或聯絡管理員',
        })
      }
    }
  } else {
    try {
      await store.setVersionIndexingStatus(result.version.id, {
        indexStatus: 'indexed',
        syncStatus: 'completed',
      })
    } catch (error) {
      log.error(error as Error, { step: 'set-version-completed' })
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: '暫時無法更新版本狀態，請稍後再試',
      })
    }
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

function isHttpError(error: unknown): error is { statusCode: number } {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}
