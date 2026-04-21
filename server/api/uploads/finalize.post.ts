import { useLogger } from 'evlog'
import { z } from 'zod'

const finalizeRequestSchema = z.object({
  checksumSha256: z.string().min(1, 'checksumSha256 is required'),
  mimeType: z.string().trim().min(1, 'mimeType is required').max(255),
  objectKey: z.string().trim().min(1, 'objectKey is required'),
  size: z.number().int().positive('size must be a positive integer'),
  uploadId: z.string().trim().min(1, 'uploadId is required'),
})

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  await requireRuntimeAdminSession(event)

  const body = await readZodBody(event, finalizeRequestSchema)
  const bucket = createR2ObjectAccess(event)

  try {
    const finalizedUpload = validateStagedUploadMetadata({
      expected: {
        checksumSha256: body.checksumSha256,
        mimeType: body.mimeType,
        objectKey: body.objectKey,
        size: body.size,
        uploadId: body.uploadId,
      },
      object: await bucket.head(body.objectKey),
    })

    return {
      ...finalizedUpload,
      finalizedAt: new Date().toISOString(),
      status: 'finalized',
    }
  } catch (error) {
    if (error instanceof StagedUploadValidationError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.name,
        message: error.message,
      })
    }

    log.error(error as Error, { step: 'finalize-upload' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '無法完成上傳驗證，請稍後再試',
    })
  }
})
