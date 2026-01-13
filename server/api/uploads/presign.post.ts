import { z } from 'zod'

const presignRequestSchema = z.object({
  checksumSha256: z.string().min(1, 'checksumSha256 is required'),
  filename: z.string().trim().min(1, 'filename is required').max(255),
  mimeType: z.string().trim().min(1, 'mimeType is required').max(255),
  size: z.number().int().positive('size must be a positive integer'),
})

function getConfiguredUploadSigning() {
  const runtimeConfig = getKnowledgeRuntimeConfig()
  const uploadConfig = runtimeConfig.uploads
  const missing = [
    ['bindings.documentsBucket', runtimeConfig.bindings.documentsBucket],
    ['uploads.accountId', uploadConfig.accountId],
    ['uploads.accessKeyId', uploadConfig.accessKeyId],
    ['uploads.bucketName', uploadConfig.bucketName],
    ['uploads.secretAccessKey', uploadConfig.secretAccessKey],
  ].filter(([, value]) => !value)

  if (missing.length > 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: `Knowledge uploads are not configured: ${missing.map(([key]) => key).join(', ')}`,
    })
  }

  return uploadConfig
}

export default defineEventHandler(async (event) => {
  const { user } = await requireRuntimeAdminSession(event)
  const body = await readZodBody(event, presignRequestSchema)
  const uploadConfig = getConfiguredUploadSigning()

  return createStagedUploadTarget(
    {
      accountId: uploadConfig.accountId,
      adminUserId: user.id,
      bucketName: uploadConfig.bucketName,
      checksumSha256: body.checksumSha256,
      environment: getKnowledgeRuntimeConfig().environment,
      expiresInSeconds: uploadConfig.presignExpiresSeconds,
      filename: body.filename,
      mimeType: body.mimeType,
      size: body.size,
    },
    {
      signUploadUrl: (input) =>
        signR2UploadUrl({
          ...input,
          accessKeyId: uploadConfig.accessKeyId,
          secretAccessKey: uploadConfig.secretAccessKey,
        }),
    }
  )
})
