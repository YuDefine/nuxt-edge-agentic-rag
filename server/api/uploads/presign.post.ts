import { z } from 'zod'

const presignRequestSchema = z.object({
  checksumSha256: z.string().min(1, 'checksumSha256 is required'),
  filename: z.string().trim().min(1, 'filename is required').max(255),
  mimeType: z.string().trim().min(1, 'mimeType is required').max(255),
  size: z.number().int().positive('size must be a positive integer'),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireRuntimeAdminSession(event)
  const body = await readZodBody(event, presignRequestSchema)
  const uploadConfig = loadKnowledgeUploadsConfig()

  return createStagedUploadTarget(
    {
      accountId: uploadConfig.accountId,
      adminUserId: user.id,
      bucketName: uploadConfig.bucketName,
      checksumSha256: body.checksumSha256,
      environment: uploadConfig.environment,
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
