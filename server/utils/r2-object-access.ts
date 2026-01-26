import { Buffer } from 'node:buffer'

import type { UploadedObjectMetadata } from './staged-upload'

export interface KnowledgeUploadsS3Config {
  accessKeyId: string
  accountId: string
  bucketName: string
  environment: string
  presignExpiresSeconds: number
  secretAccessKey: string
}

export function loadKnowledgeUploadsConfig(): KnowledgeUploadsS3Config {
  const runtimeConfig = getKnowledgeRuntimeConfig()
  const uploads = runtimeConfig.uploads
  const missing = [
    ['bindings.documentsBucket', runtimeConfig.bindings.documentsBucket],
    ['uploads.accountId', uploads.accountId],
    ['uploads.accessKeyId', uploads.accessKeyId],
    ['uploads.bucketName', uploads.bucketName],
    ['uploads.secretAccessKey', uploads.secretAccessKey],
  ].filter(([, value]) => !value)

  if (missing.length > 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: `Knowledge uploads are not configured: ${missing.map(([key]) => key).join(', ')}`,
    })
  }

  return {
    accessKeyId: uploads.accessKeyId,
    accountId: uploads.accountId,
    bucketName: uploads.bucketName,
    environment: runtimeConfig.environment,
    presignExpiresSeconds: uploads.presignExpiresSeconds,
    secretAccessKey: uploads.secretAccessKey,
  }
}

export interface R2ObjectAccess {
  getText(key: string): Promise<string | null>
  head(key: string): Promise<UploadedObjectMetadata | null>
  put(key: string, value: string, contentType: string): Promise<void>
}

export type R2ObjectAccessConfig = Pick<
  KnowledgeUploadsS3Config,
  'accessKeyId' | 'accountId' | 'bucketName' | 'secretAccessKey'
>

let s3ModulePromise: Promise<typeof import('@aws-sdk/client-s3')> | null = null

function loadS3Module() {
  s3ModulePromise ??= import('@aws-sdk/client-s3')
  return s3ModulePromise
}

export async function createR2ObjectAccess(config: R2ObjectAccessConfig): Promise<R2ObjectAccess> {
  const { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } = await loadS3Module()

  const client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
  })

  return {
    async getText(key) {
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: config.bucketName, Key: key })
        )

        return (await response.Body?.transformToString()) ?? ''
      } catch (error) {
        if (isNotFoundError(error)) return null
        throw error
      }
    },
    async head(key) {
      try {
        const response = await client.send(
          new HeadObjectCommand({
            Bucket: config.bucketName,
            ChecksumMode: 'ENABLED',
            Key: key,
          })
        )

        const metadata: UploadedObjectMetadata = {
          httpMetadata: {
            contentType: response.ContentType ?? null,
          },
          key,
          size: response.ContentLength ?? 0,
        }

        if (response.ChecksumSHA256) {
          metadata.checksums = {
            sha256: decodeBase64ToArrayBuffer(response.ChecksumSHA256),
          }
        }

        return metadata
      } catch (error) {
        if (isNotFoundError(error)) return null
        throw error
      }
    },
    async put(key, value, contentType) {
      await client.send(
        new PutObjectCommand({
          Body: value,
          Bucket: config.bucketName,
          ContentType: contentType,
          Key: key,
        })
      )
    },
  }
}

export function decodeBase64ToArrayBuffer(value: string): ArrayBuffer {
  const bytes = Buffer.from(value, 'base64')
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

export function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  const code = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode

  return name === 'NotFound' || name === 'NoSuchKey' || code === 404
}
