import { Buffer } from 'node:buffer'

import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createR2ObjectAccess,
  decodeBase64ToArrayBuffer,
  isNotFoundError,
  loadKnowledgeUploadsConfig,
} from '../../server/utils/r2-object-access'

interface FakeBucket {
  get: ReturnType<typeof vi.fn>
  head: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

function makeEvent(bucket: unknown): H3Event {
  return {
    context: {
      cloudflare: {
        env: bucket === undefined ? {} : { BLOB: bucket },
      },
    },
  } as unknown as H3Event
}

function makeBucket(): FakeBucket {
  return {
    get: vi.fn(),
    head: vi.fn(),
    put: vi.fn(),
  }
}

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

beforeEach(() => {
  vi.stubGlobal('createError', (input: { message: string; statusCode: number }) => {
    const error = new Error(input.message)
    Object.assign(error, { statusCode: input.statusCode })
    return error
  })
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
  beforeEach(() => {
    stubRuntime()
  })

  it('throws 503 when the R2 binding is not available', () => {
    expect(() => createR2ObjectAccess(makeEvent(undefined))).toThrowError(
      /R2 binding "BLOB" is not available/
    )
  })

  describe('head', () => {
    it('returns metadata including sha256 checksum when R2 provides it', async () => {
      const bucket = makeBucket()
      const sha256 = Buffer.from('sha256-digest').buffer.slice(0)
      bucket.head.mockResolvedValueOnce({
        checksums: { sha256 },
        httpMetadata: { contentType: 'text/markdown' },
        size: 128,
      })

      const access = createR2ObjectAccess(makeEvent(bucket))
      const metadata = await access.head('staged/some-key.md')

      expect(bucket.head).toHaveBeenCalledWith('staged/some-key.md')
      expect(metadata).toEqual({
        checksums: { sha256 },
        httpMetadata: { contentType: 'text/markdown' },
        key: 'staged/some-key.md',
        size: 128,
      })
    })

    it('omits checksums when R2 did not populate sha256', async () => {
      const bucket = makeBucket()
      bucket.head.mockResolvedValueOnce({
        httpMetadata: { contentType: 'text/plain' },
        size: 10,
      })

      const access = createR2ObjectAccess(makeEvent(bucket))
      const metadata = await access.head('key')

      expect(metadata?.checksums).toBeUndefined()
    })

    it('returns null when the object is missing', async () => {
      const bucket = makeBucket()
      bucket.head.mockResolvedValueOnce(null)

      const access = createR2ObjectAccess(makeEvent(bucket))

      expect(await access.head('missing-key')).toBeNull()
    })
  })

  describe('getText', () => {
    it('returns the body text on success', async () => {
      const bucket = makeBucket()
      bucket.get.mockResolvedValueOnce({
        text: () => Promise.resolve('hello world'),
      })

      const access = createR2ObjectAccess(makeEvent(bucket))

      expect(await access.getText('key')).toBe('hello world')
    })

    it('returns null when the object is missing', async () => {
      const bucket = makeBucket()
      bucket.get.mockResolvedValueOnce(null)

      const access = createR2ObjectAccess(makeEvent(bucket))

      expect(await access.getText('missing')).toBeNull()
    })
  })

  describe('put', () => {
    it('stores the value with the supplied contentType', async () => {
      const bucket = makeBucket()
      bucket.put.mockResolvedValueOnce(undefined)

      const access = createR2ObjectAccess(makeEvent(bucket))
      await access.put('some/key.txt', 'body-content', 'text/plain; charset=utf-8')

      expect(bucket.put).toHaveBeenCalledWith('some/key.txt', 'body-content', {
        httpMetadata: { contentType: 'text/plain; charset=utf-8' },
      })
    })
  })
})
