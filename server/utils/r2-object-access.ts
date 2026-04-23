import { Buffer } from 'node:buffer'

import type { H3Event } from 'h3'

import { getRequiredR2Binding } from './cloudflare-bindings'
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
  getBytes(key: string): Promise<ArrayBuffer | null>
  getText(key: string): Promise<string | null>
  head(key: string): Promise<UploadedObjectMetadata | null>
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    contentType: string,
    customMetadata?: Record<string, string>,
  ): Promise<void>
}

export function createR2ObjectAccess(event: H3Event): R2ObjectAccess {
  const bindingName = getKnowledgeRuntimeConfig().bindings.documentsBucket
  const bucket = getRequiredR2Binding(event, bindingName)

  return {
    async getBytes(key) {
      const obj = await bucket.get(key)
      if (!obj) return null

      return obj.arrayBuffer()
    },
    async getText(key) {
      const obj = await bucket.get(key)
      if (!obj) return null

      return obj.text()
    },
    async head(key) {
      const obj = await bucket.head(key)
      if (!obj) return null

      const metadata: UploadedObjectMetadata = {
        customMetadata: obj.customMetadata,
        httpMetadata: {
          contentType: obj.httpMetadata?.contentType ?? null,
        },
        key,
        size: obj.size,
      }

      if (obj.checksums?.sha256) {
        metadata.checksums = { sha256: obj.checksums.sha256 }
      }

      return metadata
    },
    async put(key, value, contentType, customMetadata) {
      const options: {
        customMetadata?: Record<string, string>
        httpMetadata: { contentType: string }
      } = { httpMetadata: { contentType } }
      if (customMetadata) options.customMetadata = customMetadata
      await bucket.put(key, value, options)
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
