import { Buffer } from 'node:buffer'

import { useLogger } from 'evlog'
import { isError, readRawBody } from 'h3'
import { z } from 'zod'

import { getRequiredR2Binding } from '#server/utils/cloudflare-bindings'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'

const localUploadQuerySchema = z.object({
  objectKey: z.string().trim().min(1, 'objectKey is required'),
})

export default defineEventHandler(async (event) => {
  const log = useLogger(event)
  const runtimeConfig = getKnowledgeRuntimeConfig()

  if (runtimeConfig.environment !== 'local') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Local upload fallback is only available in local environment',
    })
  }

  const { user } = await requireRuntimeAdminSession(event)
  const query = await getValidatedQuery(event, localUploadQuerySchema.parse)
  const expectedPrefix = `staged/local/${user.id}/`

  if (!query.objectKey.startsWith(expectedPrefix)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Cannot write uploads outside the current admin namespace',
    })
  }

  const checksumSha256 = getRequestHeader(event, 'x-amz-checksum-sha256')
  const mimeType = getRequestHeader(event, 'content-type') || 'application/octet-stream'

  if (!checksumSha256) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'x-amz-checksum-sha256 header is required',
    })
  }

  try {
    const body = await readRawBody(event, false)

    if (!body || body.byteLength === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'Uploaded file body is required',
      })
    }

    const bodyBytes = Uint8Array.from(body)
    const uploadedChecksum = Buffer.from(await crypto.subtle.digest('SHA-256', bodyBytes)).toString(
      'base64',
    )

    if (uploadedChecksum !== checksumSha256) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'Uploaded file checksum did not match',
      })
    }

    const bucket = getRequiredR2Binding(event, runtimeConfig.bindings.documentsBucket)
    await bucket.put(query.objectKey, bodyBytes, {
      customMetadata: {
        upload_checksum_sha256: checksumSha256,
      },
      httpMetadata: {
        contentType: mimeType,
      },
    })

    return {
      objectKey: query.objectKey,
      status: 'uploaded',
    }
  } catch (error) {
    if (isError(error)) {
      throw error
    }

    log.error(error as Error, { step: 'local-staged-upload' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '無法完成本地上傳，請稍後再試',
    })
  }
})
