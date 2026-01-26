import { z } from 'zod'

import { getD1Database } from '../../utils/database'
import { createDocumentSyncStore } from '../../utils/document-store'
import { syncDocumentVersionSnapshot } from '../../utils/document-sync'

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
  const { user } = await requireRuntimeAdminSession(event)
  const body = await readZodBody(event, syncDocumentSchema)
  const uploadConfig = loadKnowledgeUploadsConfig()
  const bucket = await createR2ObjectAccess(uploadConfig)
  const database = await getD1Database()
  const store = createDocumentSyncStore(database)

  const result = await syncDocumentVersionSnapshot(
    {
      accessLevel: body.accessLevel,
      adminUserId: user.id,
      categorySlug: body.categorySlug,
      checksumSha256: body.checksumSha256,
      environment: uploadConfig.environment,
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
      writeNormalizedText: async (objectKey, normalizedText) => {
        await bucket.put(objectKey, normalizedText, 'text/plain; charset=utf-8')
      },
    }
  )

  return {
    data: {
      document: result.document,
      smokeTestQueries: result.smokeTestQueries,
      sourceChunkCount: result.sourceChunkCount,
      version: result.version,
    },
  }
})
