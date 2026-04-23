import { useLogger } from 'evlog'
import { z } from 'zod'

import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import {
  createStagedUploadTarget,
  signR2UploadUrl,
  StagedUploadValidationError,
} from '#server/utils/staged-upload'

const presignRequestSchema = z.object({
  checksumSha256: z.string().min(1, 'checksumSha256 is required'),
  filename: z.string().trim().min(1, 'filename is required').max(255),
  mimeType: z.string().trim().min(1, 'mimeType is required').max(255),
  size: z.number().int().positive('size must be a positive integer'),
})

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const { user } = await requireRuntimeAdminSession(event)
  const body = await readZodBody(event, presignRequestSchema)
  const runtimeConfig = getKnowledgeRuntimeConfig()
  const directUploadConfig = runtimeConfig.uploads
  const documentsBucketBinding = runtimeConfig.bindings.documentsBucket.trim()
  const hasDirectR2Credentials =
    Boolean(documentsBucketBinding) &&
    Boolean(directUploadConfig.accountId) &&
    Boolean(directUploadConfig.accessKeyId) &&
    Boolean(directUploadConfig.bucketName) &&
    Boolean(directUploadConfig.secretAccessKey)

  try {
    if (runtimeConfig.environment === 'local' && !hasDirectR2Credentials) {
      if (!documentsBucketBinding) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Internal Server Error',
          message: '本機上傳 fallback 缺少 documents bucket 綁定，無法建立上傳網址',
        })
      }

      return await createStagedUploadTarget(
        {
          accountId: directUploadConfig.accountId || 'local',
          adminUserId: user.id,
          bucketName: directUploadConfig.bucketName || documentsBucketBinding,
          checksumSha256: body.checksumSha256,
          environment: runtimeConfig.environment,
          expiresInSeconds: directUploadConfig.presignExpiresSeconds,
          filename: body.filename,
          mimeType: body.mimeType,
          size: body.size,
        },
        {
          signUploadUrl: async (input) =>
            `/api/_dev/uploads/local?objectKey=${encodeURIComponent(input.objectKey)}`,
        },
      )
    }

    return await createStagedUploadTarget(
      {
        accountId: directUploadConfig.accountId,
        adminUserId: user.id,
        bucketName: directUploadConfig.bucketName,
        checksumSha256: body.checksumSha256,
        environment: runtimeConfig.environment,
        expiresInSeconds: directUploadConfig.presignExpiresSeconds,
        filename: body.filename,
        mimeType: body.mimeType,
        size: body.size,
      },
      {
        signUploadUrl: (input) =>
          signR2UploadUrl({
            ...input,
            accessKeyId: directUploadConfig.accessKeyId,
            secretAccessKey: directUploadConfig.secretAccessKey,
          }),
      },
    )
  } catch (error) {
    if (error instanceof StagedUploadValidationError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.name,
        message: error.message,
      })
    }

    log.error(error as Error, { step: 'create-staged-upload' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '無法建立上傳網址，請稍後再試',
    })
  }
})
