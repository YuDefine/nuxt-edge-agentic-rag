import { describe, expect, it, vi } from 'vitest'

import {
  createStagedUploadTarget,
  signR2UploadUrl,
  StagedUploadValidationError,
  validateStagedUploadMetadata,
} from '#server/utils/staged-upload'

describe('staged upload', () => {
  it('creates a signed upload target scoped to the current environment and admin', async () => {
    const signUploadUrl = vi.fn().mockResolvedValue('https://signed.example/upload')

    const result = await createStagedUploadTarget(
      {
        accountId: 'account-123',
        adminUserId: 'admin-1',
        bucketName: 'knowledge-documents',
        checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
        environment: 'local',
        expiresInSeconds: 600,
        filename: '../Quarterly Report.md',
        mimeType: 'text/markdown',
        size: 128,
      },
      {
        createUploadId: () => 'upload-123',
        signUploadUrl,
      }
    )

    expect(result).toEqual({
      expiresAt: expect.any(String),
      objectKey: 'staged/local/admin-1/upload-123/quarterly-report.md',
      requiredHeaders: {
        'content-type': 'text/markdown',
        'x-amz-checksum-sha256': 'c2hhMjU2LWRpZ2VzdA==',
      },
      uploadId: 'upload-123',
      uploadUrl: 'https://signed.example/upload',
    })

    expect(signUploadUrl).toHaveBeenCalledWith({
      accountId: 'account-123',
      bucketName: 'knowledge-documents',
      checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
      expiresInSeconds: 600,
      mimeType: 'text/markdown',
      objectKey: 'staged/local/admin-1/upload-123/quarterly-report.md',
      size: 128,
    })
  })

  it('accepts uploaded object metadata only when checksum, size, and mime type all match', () => {
    const checksumBuffer = Uint8Array.from(Buffer.from('sha256-digest')).buffer

    const result = validateStagedUploadMetadata({
      expected: {
        checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
        mimeType: 'text/markdown',
        objectKey: 'staged/local/admin-1/upload-123/quarterly-report.md',
        size: 128,
        uploadId: 'upload-123',
      },
      object: {
        checksums: {
          sha256: checksumBuffer,
        },
        httpMetadata: {
          contentType: 'text/markdown',
        },
        key: 'staged/local/admin-1/upload-123/quarterly-report.md',
        size: 128,
      },
    })

    expect(result).toEqual({
      checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
      mimeType: 'text/markdown',
      objectKey: 'staged/local/admin-1/upload-123/quarterly-report.md',
      size: 128,
      uploadId: 'upload-123',
    })
  })

  it('rejects finalize when the uploaded object is missing', () => {
    expect(() =>
      validateStagedUploadMetadata({
        expected: {
          checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
          mimeType: 'text/markdown',
          objectKey: 'staged/local/admin-1/upload-123/quarterly-report.md',
          size: 128,
          uploadId: 'upload-123',
        },
        object: null,
      })
    ).toThrowError(new StagedUploadValidationError('Uploaded file was not found', 404))
  })

  it('rejects finalize when the uploaded size does not match the finalize payload', () => {
    expect(() =>
      validateStagedUploadMetadata({
        expected: {
          checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
          mimeType: 'text/markdown',
          objectKey: 'staged/local/admin-1/upload-123/quarterly-report.md',
          size: 128,
          uploadId: 'upload-123',
        },
        object: {
          checksums: {
            sha256: Uint8Array.from(Buffer.from('sha256-digest')).buffer,
          },
          httpMetadata: {
            contentType: 'text/markdown',
          },
          key: 'staged/local/admin-1/upload-123/quarterly-report.md',
          size: 64,
        },
      })
    ).toThrowError(new StagedUploadValidationError('Uploaded file size did not match', 400))
  })

  it('rejects finalize when the uploaded mime type does not match the finalize payload', () => {
    expect(() =>
      validateStagedUploadMetadata({
        expected: {
          checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
          mimeType: 'text/markdown',
          objectKey: 'staged/local/admin-1/upload-123/quarterly-report.md',
          size: 128,
          uploadId: 'upload-123',
        },
        object: {
          checksums: {
            sha256: Uint8Array.from(Buffer.from('sha256-digest')).buffer,
          },
          httpMetadata: {
            contentType: 'text/plain',
          },
          key: 'staged/local/admin-1/upload-123/quarterly-report.md',
          size: 128,
        },
      })
    ).toThrowError(new StagedUploadValidationError('Uploaded file MIME type did not match', 400))
  })

  it('signs presigned upload URL with checksum header in SignedHeaders (not hoisted to query)', async () => {
    const url = await signR2UploadUrl({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      accountId: 'abc123',
      bucketName: 'knowledge-documents',
      checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
      expiresInSeconds: 600,
      mimeType: 'text/markdown',
      objectKey: 'staged/local/admin-1/upload-123/report.md',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      size: 128,
    })

    const parsed = new URL(url)
    const signedHeaders = parsed.searchParams.get('X-Amz-SignedHeaders') ?? ''

    expect(signedHeaders.split(';')).toContain('x-amz-checksum-sha256')
    expect(signedHeaders.split(';')).not.toContain('content-length')
    expect(parsed.searchParams.has('x-amz-checksum-sha256')).toBe(false)
    expect(parsed.hostname).toBe('knowledge-documents.abc123.r2.cloudflarestorage.com')
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects finalize when the uploaded checksum does not match the finalize payload', () => {
    expect(() =>
      validateStagedUploadMetadata({
        expected: {
          checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
          mimeType: 'text/markdown',
          objectKey: 'staged/local/admin-1/upload-123/quarterly-report.md',
          size: 128,
          uploadId: 'upload-123',
        },
        object: {
          checksums: {
            sha256: Uint8Array.from(Buffer.from('different-digest')).buffer,
          },
          httpMetadata: {
            contentType: 'text/markdown',
          },
          key: 'staged/local/admin-1/upload-123/quarterly-report.md',
          size: 128,
        },
      })
    ).toThrowError(new StagedUploadValidationError('Uploaded file checksum did not match', 400))
  })
})
