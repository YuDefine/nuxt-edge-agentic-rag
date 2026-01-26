import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSend = vi.fn()

class FakeS3Client {
  send = mockSend
}

class FakeHeadObjectCommand {
  constructor(public input: unknown) {}
  readonly __type = 'head'
}

class FakeGetObjectCommand {
  constructor(public input: unknown) {}
  readonly __type = 'get'
}

class FakePutObjectCommand {
  constructor(public input: unknown) {}
  readonly __type = 'put'
}

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: FakeGetObjectCommand,
  HeadObjectCommand: FakeHeadObjectCommand,
  PutObjectCommand: FakePutObjectCommand,
  S3Client: FakeS3Client,
}))

import {
  createR2ObjectAccess,
  decodeBase64ToArrayBuffer,
  isNotFoundError,
  loadKnowledgeUploadsConfig,
} from '../../server/utils/r2-object-access'

interface RuntimeOverrides {
  bindings?: {
    documentsBucket?: string
  }
  uploads?: {
    accessKeyId?: string
    accountId?: string
    bucketName?: string
    presignExpiresSeconds?: number
    secretAccessKey?: string
  }
}

function stubRuntime(overrides: RuntimeOverrides = {}) {
  const runtime = {
    bindings: {
      documentsBucket: 'BLOB',
      ...overrides.bindings,
    },
    environment: 'local',
    uploads: {
      accessKeyId: 'ak-1',
      accountId: 'acct-1',
      bucketName: 'bkt-1',
      presignExpiresSeconds: 900,
      secretAccessKey: 'sk-1',
      ...overrides.uploads,
    },
  }

  vi.stubGlobal('getKnowledgeRuntimeConfig', () => runtime)
  vi.stubGlobal('createError', (input: { message: string; statusCode: number }) => {
    const error = new Error(input.message)
    Object.assign(error, { statusCode: input.statusCode })
    return error
  })
}

const accessConfig = {
  accessKeyId: 'ak-1',
  accountId: 'acct-1',
  bucketName: 'bkt-1',
  secretAccessKey: 'sk-1',
}

beforeEach(() => {
  mockSend.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('decodeBase64ToArrayBuffer', () => {
  it('round-trips base64 back to bytes', () => {
    const buffer = decodeBase64ToArrayBuffer('aGVsbG8=')
    expect(Buffer.from(new Uint8Array(buffer)).toString('utf8')).toBe('hello')
  })

  it('returns an empty buffer for an empty string', () => {
    const buffer = decodeBase64ToArrayBuffer('')
    expect(buffer.byteLength).toBe(0)
  })
})

describe('isNotFoundError', () => {
  it('returns true for NotFound error name', () => {
    expect(isNotFoundError({ name: 'NotFound' })).toBe(true)
  })

  it('returns true for NoSuchKey error name', () => {
    expect(isNotFoundError({ name: 'NoSuchKey' })).toBe(true)
  })

  it('returns true for 404 status code in $metadata', () => {
    expect(isNotFoundError({ $metadata: { httpStatusCode: 404 } })).toBe(true)
  })

  it('returns false for other error names and codes', () => {
    expect(isNotFoundError({ name: 'AccessDenied' })).toBe(false)
    expect(isNotFoundError({ $metadata: { httpStatusCode: 500 } })).toBe(false)
  })

  it('returns false for non-object inputs', () => {
    expect(isNotFoundError(null)).toBe(false)
    expect(isNotFoundError(undefined)).toBe(false)
    expect(isNotFoundError('string')).toBe(false)
    expect(isNotFoundError(404)).toBe(false)
  })
})

describe('loadKnowledgeUploadsConfig', () => {
  it('returns the parsed config when every field is populated', () => {
    stubRuntime()

    expect(loadKnowledgeUploadsConfig()).toEqual({
      accessKeyId: 'ak-1',
      accountId: 'acct-1',
      bucketName: 'bkt-1',
      environment: 'local',
      presignExpiresSeconds: 900,
      secretAccessKey: 'sk-1',
    })
  })

  it('throws 503 when a single upload field is missing', () => {
    stubRuntime({ uploads: { accessKeyId: '' } })

    expect(() => loadKnowledgeUploadsConfig()).toThrowError(/uploads\.accessKeyId/)
  })

  it('lists every missing field in the error message', () => {
    stubRuntime({
      bindings: { documentsBucket: '' },
      uploads: { accountId: '', secretAccessKey: '' },
    })

    expect(() => loadKnowledgeUploadsConfig()).toThrowError(
      /bindings\.documentsBucket.*uploads\.accountId.*uploads\.secretAccessKey/
    )
  })
})

describe('createR2ObjectAccess', () => {
  describe('head', () => {
    it('returns metadata with decoded checksum when the object exists', async () => {
      const checksumBase64 = Buffer.from('sha256-digest').toString('base64')
      mockSend.mockResolvedValueOnce({
        ChecksumSHA256: checksumBase64,
        ContentLength: 128,
        ContentType: 'text/markdown',
      })

      const access = await createR2ObjectAccess(accessConfig)
      const metadata = await access.head('staged/some-key.md')

      expect(metadata).toEqual({
        checksums: {
          sha256: expect.any(ArrayBuffer),
        },
        httpMetadata: {
          contentType: 'text/markdown',
        },
        key: 'staged/some-key.md',
        size: 128,
      })
      expect(Buffer.from(new Uint8Array(metadata!.checksums!.sha256!)).toString('utf8')).toBe(
        'sha256-digest'
      )
    })

    it('omits checksums when R2 did not return ChecksumSHA256', async () => {
      mockSend.mockResolvedValueOnce({
        ContentLength: 10,
        ContentType: 'text/plain',
      })

      const access = await createR2ObjectAccess(accessConfig)
      const metadata = await access.head('key')

      expect(metadata?.checksums).toBeUndefined()
    })

    it('returns null when the object is not found', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'NotFound' }))

      const access = await createR2ObjectAccess(accessConfig)

      expect(await access.head('missing-key')).toBeNull()
    })

    it('rethrows non-404 errors', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied' }))

      const access = await createR2ObjectAccess(accessConfig)

      await expect(access.head('key')).rejects.toThrow('denied')
    })
  })

  describe('getText', () => {
    it('returns the body text on success', async () => {
      mockSend.mockResolvedValueOnce({
        Body: {
          transformToString: () => Promise.resolve('hello world'),
        },
      })

      const access = await createR2ObjectAccess(accessConfig)

      expect(await access.getText('key')).toBe('hello world')
    })

    it('returns an empty string when the body is missing', async () => {
      mockSend.mockResolvedValueOnce({ Body: undefined })

      const access = await createR2ObjectAccess(accessConfig)

      expect(await access.getText('key')).toBe('')
    })

    it('returns null when the object is not found', async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error('gone'), { $metadata: { httpStatusCode: 404 } })
      )

      const access = await createR2ObjectAccess(accessConfig)

      expect(await access.getText('missing')).toBeNull()
    })
  })

  describe('put', () => {
    it('sends a PutObjectCommand with the supplied contentType', async () => {
      mockSend.mockResolvedValueOnce({})

      const access = await createR2ObjectAccess(accessConfig)
      await access.put('some/key.txt', 'body-content', 'text/plain; charset=utf-8')

      expect(mockSend).toHaveBeenCalledTimes(1)
      const command = mockSend.mock.calls[0]?.[0] as {
        __type: string
        input: Record<string, unknown>
      }
      expect(command.__type).toBe('put')
      expect(command.input).toMatchObject({
        Body: 'body-content',
        Bucket: 'bkt-1',
        ContentType: 'text/plain; charset=utf-8',
        Key: 'some/key.txt',
      })
    })
  })
})
