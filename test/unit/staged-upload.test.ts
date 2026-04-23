import { describe, expect, it, vi } from 'vitest'

import {
  createStagedUploadObjectKey,
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
      },
    )

    expect(result).toEqual({
      expiresAt: expect.any(String),
      objectKey: 'staged/local/admin-1/upload-123/Quarterly Report.md',
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
      objectKey: 'staged/local/admin-1/upload-123/Quarterly Report.md',
      size: 128,
    })
  })

  it('rejects legacy Office uploads before presign so operators get conversion guidance', async () => {
    await expect(
      createStagedUploadTarget(
        {
          accountId: 'account-123',
          adminUserId: 'admin-1',
          bucketName: 'knowledge-documents',
          checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
          environment: 'local',
          expiresInSeconds: 600,
          filename: 'Quarterly Report.doc',
          mimeType: 'application/msword',
          size: 128,
        },
        {
          createUploadId: () => 'upload-123',
          signUploadUrl: vi.fn(),
        },
      ),
    ).rejects.toThrowError(
      new StagedUploadValidationError('請先轉成 DOCX、PDF 或文字格式後再上傳', 400),
    )
  })

  it('rejects media uploads before presign with transcript-pipeline guidance', async () => {
    await expect(
      createStagedUploadTarget(
        {
          accountId: 'account-123',
          adminUserId: 'admin-1',
          bucketName: 'knowledge-documents',
          checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
          environment: 'local',
          expiresInSeconds: 600,
          filename: 'Townhall Recording.mp4',
          mimeType: 'video/mp4',
          size: 128,
        },
        {
          createUploadId: () => 'upload-123',
          signUploadUrl: vi.fn(),
        },
      ),
    ).rejects.toThrowError(
      new StagedUploadValidationError(
        '音訊與影片需等待後續 transcript pipeline，暫不支援直接上傳',
        400,
      ),
    )
  })

  describe('sanitize filename via createStagedUploadObjectKey', () => {
    function keyFor(filename: string, uploadId = 'upload-abcdef12') {
      return createStagedUploadObjectKey({
        adminUserId: 'admin-1',
        environment: 'local',
        filename,
        uploadId,
      })
    }

    it('preserves Chinese, Japanese, accented Latin, and emoji characters in filenames', () => {
      expect(keyFor('採購流程.pdf')).toBe('staged/local/admin-1/upload-abcdef12/採購流程.pdf')
      expect(keyFor('日本語のドキュメント.md')).toBe(
        'staged/local/admin-1/upload-abcdef12/日本語のドキュメント.md',
      )
      expect(keyFor('café-menü.txt')).toBe('staged/local/admin-1/upload-abcdef12/café-menü.txt')
      expect(keyFor('🚀launch-plan.pdf')).toBe(
        'staged/local/admin-1/upload-abcdef12/🚀launch-plan.pdf',
      )
    })

    it('strips path separators, shell metacharacters, and control chars while preserving the extension', () => {
      // path separators are split off, taking only the trailing segment
      expect(keyFor('report/2026:Q1*.pdf')).toBe('staged/local/admin-1/upload-abcdef12/2026Q1.pdf')
      // backslash separator on Windows-style path
      expect(keyFor('docs\\plan?.md')).toBe('staged/local/admin-1/upload-abcdef12/plan.md')
      // shell metacharacters get dropped from the bare filename
      expect(keyFor('a"b<c>d|e.txt')).toBe('staged/local/admin-1/upload-abcdef12/abcde.txt')
      // control characters U+0000–U+001F and U+007F get dropped
      expect(keyFor('plan\u0001\u0007\u007f.md')).toBe(
        'staged/local/admin-1/upload-abcdef12/plan.md',
      )
      // bidi/zero-width chars (RLO spoofing, ZWSP/BOM) get dropped
      expect(keyFor('evil\u202Efdp.exe')).toBe('staged/local/admin-1/upload-abcdef12/evilfdp.exe')
      expect(keyFor('a\u200Bb\uFEFFc.txt')).toBe('staged/local/admin-1/upload-abcdef12/abc.txt')
    })

    it('forces fallback when sanitized result is only dots', () => {
      const uploadId = 'upload-feedface'
      // `.`, `..`, `...` are valid filesystem-traversal symbols, not real names
      expect(keyFor('.', uploadId)).toBe('staged/local/admin-1/upload-feedface/upload-feedface.bin')
      expect(keyFor('..', uploadId)).toBe(
        'staged/local/admin-1/upload-feedface/upload-feedface.bin',
      )
      expect(keyFor('...', uploadId)).toBe(
        'staged/local/admin-1/upload-feedface/upload-feedface.bin',
      )
    })

    it('falls back to a deterministic generated name when sanitize leaves only the extension or empty', () => {
      const sameUpload = 'upload-cafebabe'
      // Empty after sanitize → fallback uses upload-id prefix and .bin extension
      expect(keyFor('', sameUpload)).toBe(
        'staged/local/admin-1/upload-cafebabe/upload-cafebabe.bin',
      )
      // Only an extension survives → preserve the extension, generate base from upload id
      expect(keyFor('.pdf', sameUpload)).toBe(
        'staged/local/admin-1/upload-cafebabe/upload-cafebabe.pdf',
      )
      // Only forbidden chars + extension → fallback
      expect(keyFor('<>|.md', sameUpload)).toBe(
        'staged/local/admin-1/upload-cafebabe/upload-cafebabe.md',
      )
      // Same uploadId → same fallback (deterministic)
      expect(keyFor('.pdf', sameUpload)).toBe(keyFor('.pdf', sameUpload))
      // Different uploadId → different fallback
      expect(keyFor('.pdf', 'upload-deadbeef')).not.toBe(keyFor('.pdf', 'upload-cafebabe'))
    })

    it('truncates the base name when the UTF-8 byte length exceeds 255 while preserving the extension', () => {
      // Each Chinese char is 3 bytes UTF-8; 100 chars = 300 bytes > 255 limit
      const longName = '採'.repeat(100) + '.pdf'
      const key = keyFor(longName)
      const filename = key.split('/').at(-1) ?? ''

      // Extension preserved
      expect(filename.endsWith('.pdf')).toBe(true)
      // Total UTF-8 bytes within 255
      expect(new TextEncoder().encode(filename).length).toBeLessThanOrEqual(255)
      // Base name still has Chinese content (truncated, not emptied)
      const base = filename.slice(0, -'.pdf'.length)
      expect(base.length).toBeGreaterThan(0)
      expect(base).toMatch(/^採+$/)
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

  it('accepts finalize when sha256 is only available via customMetadata fallback', () => {
    const result = validateStagedUploadMetadata({
      expected: {
        checksumSha256: 'c2hhMjU2LWRpZ2VzdA==',
        mimeType: 'text/markdown',
        objectKey: 'staged/local/admin-1/upload-123/quarterly-report.md',
        size: 128,
        uploadId: 'upload-123',
      },
      object: {
        customMetadata: {
          upload_checksum_sha256: 'c2hhMjU2LWRpZ2VzdA==',
        },
        httpMetadata: {
          contentType: 'text/markdown',
        },
        key: 'staged/local/admin-1/upload-123/quarterly-report.md',
        size: 128,
      },
    })

    expect(result.uploadId).toBe('upload-123')
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
      }),
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
      }),
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
      }),
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
      }),
    ).toThrowError(new StagedUploadValidationError('Uploaded file checksum did not match', 400))
  })
})
