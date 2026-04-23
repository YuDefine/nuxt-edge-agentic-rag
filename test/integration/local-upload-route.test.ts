import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const localUploadRouteMocks = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  getValidatedQuery: vi.fn(),
  readRawBody: vi.fn(),
  requireRuntimeAdminSession: vi.fn(),
  runtimeConfig: {
    bindings: {
      documentsBucket: 'BLOB',
    },
    environment: 'local',
    uploads: {
      accessKeyId: '',
      accountId: '',
      bucketName: '',
      presignExpiresSeconds: 900,
      secretAccessKey: '',
    },
  },
}))

vi.mock('#server/utils/knowledge-runtime', () => ({
  getKnowledgeRuntimeConfig: () => localUploadRouteMocks.runtimeConfig,
}))

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()

  return {
    ...actual,
    readRawBody: localUploadRouteMocks.readRawBody,
  }
})

installNuxtRouteTestGlobals()

describe('local staged upload routes', () => {
  beforeEach(() => {
    localUploadRouteMocks.body = {}
    localUploadRouteMocks.runtimeConfig.bindings.documentsBucket = 'BLOB'
    localUploadRouteMocks.getValidatedQuery
      .mockReset()
      .mockImplementation(async (_event, parse) =>
        parse({ objectKey: 'staged/local/admin-1/upload-1/Quarterly Report.pdf' }),
      )
    localUploadRouteMocks.readRawBody.mockReset()
    localUploadRouteMocks.requireRuntimeAdminSession.mockReset().mockResolvedValue({
      user: { id: 'admin-1' },
    })

    vi.stubGlobal('readZodBody', async () => localUploadRouteMocks.body)
    vi.stubGlobal('requireRuntimeAdminSession', localUploadRouteMocks.requireRuntimeAdminSession)
    vi.stubGlobal('getValidatedQuery', localUploadRouteMocks.getValidatedQuery)
    vi.stubGlobal(
      'getRequestHeader',
      (event: { headers?: Headers }, name: string) => event.headers?.get(name) ?? undefined,
    )
  })

  it('returns a same-origin upload URL when local env has no R2 S3 credentials', async () => {
    localUploadRouteMocks.body = {
      checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
      filename: 'Quarterly Report.pdf',
      mimeType: 'application/pdf',
      size: 128,
    }

    const { default: handler } = await import('../../server/api/uploads/presign.post')
    const result = (await handler(createRouteEvent())) as {
      objectKey: string
      uploadId: string
      uploadUrl: string
    }

    expect(result.objectKey).toBe(`staged/local/admin-1/${result.uploadId}/Quarterly Report.pdf`)
    expect(result.uploadUrl).toBe(
      `/api/_dev/uploads/local?objectKey=${encodeURIComponent(result.objectKey)}`,
    )
  })

  it('fails fast when local fallback is enabled but documents bucket binding is missing', async () => {
    localUploadRouteMocks.body = {
      checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
      filename: 'Quarterly Report.pdf',
      mimeType: 'application/pdf',
      size: 128,
    }
    localUploadRouteMocks.runtimeConfig.bindings.documentsBucket = ''

    const { default: handler } = await import('../../server/api/uploads/presign.post')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
    })
  })

  it('stores uploaded bytes in the local documents bucket with checksum metadata', async () => {
    const bucket = {
      get: vi.fn(),
      head: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    }
    const body = Uint8Array.from(Buffer.from('Quarterly Report body')).buffer
    const checksumSha256 = createHash('sha256').update(Buffer.from(body)).digest('base64')
    localUploadRouteMocks.getValidatedQuery.mockResolvedValue({
      objectKey: 'staged/local/admin-1/upload-1/Quarterly Report.pdf',
    })
    localUploadRouteMocks.readRawBody.mockResolvedValue(Buffer.from(body))

    const { default: handler } = await import('../../server/api/_dev/uploads/local.put')
    await handler(
      createRouteEvent({
        context: {
          cloudflare: {
            env: {
              BLOB: bucket,
            },
          },
        },
        headers: {
          'content-type': 'application/pdf',
          'x-amz-checksum-sha256': checksumSha256,
        },
      }),
    )

    const [objectKey, bytes, options] = bucket.put.mock.calls[0] ?? []

    expect(objectKey).toBe('staged/local/admin-1/upload-1/Quarterly Report.pdf')
    expect(bytes).toEqual(new Uint8Array(body))
    expect(options).toEqual({
      customMetadata: {
        upload_checksum_sha256: checksumSha256,
      },
      httpMetadata: {
        contentType: 'application/pdf',
      },
    })
  })

  it('rejects uploads outside the current admin namespace', async () => {
    const body = Uint8Array.from(Buffer.from('Quarterly Report body')).buffer
    const checksumSha256 = createHash('sha256').update(Buffer.from(body)).digest('base64')
    localUploadRouteMocks.getValidatedQuery.mockResolvedValue({
      objectKey: 'staged/local/admin-2/upload-1/Quarterly Report.pdf',
    })
    localUploadRouteMocks.readRawBody.mockResolvedValue(Buffer.from(body))

    const { default: handler } = await import('../../server/api/_dev/uploads/local.put')

    await expect(
      handler(
        createRouteEvent({
          headers: {
            'content-type': 'application/pdf',
            'x-amz-checksum-sha256': checksumSha256,
          },
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Forbidden',
    })
  })

  it('returns the validation error when objectKey query is missing', async () => {
    localUploadRouteMocks.getValidatedQuery.mockRejectedValue(
      createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'objectKey is required',
      }),
    )

    const { default: handler } = await import('../../server/api/_dev/uploads/local.put')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'objectKey is required',
    })
  })
})
