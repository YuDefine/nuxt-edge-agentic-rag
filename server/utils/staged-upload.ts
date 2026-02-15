export interface StagedUploadSignerInput {
  accountId: string
  bucketName: string
  checksumSha256: string
  expiresInSeconds: number
  mimeType: string
  objectKey: string
  size: number
}

export interface CreateStagedUploadTargetInput extends Omit<StagedUploadSignerInput, 'objectKey'> {
  adminUserId: string
  environment: string
  filename: string
}

export interface CreateStagedUploadTargetOptions {
  createUploadId?: () => string
  now?: () => Date
  signUploadUrl?: (input: StagedUploadSignerInput) => Promise<string>
}

export interface StagedUploadTarget {
  expiresAt: string
  objectKey: string
  requiredHeaders: {
    'content-type': string
    'x-amz-checksum-sha256': string
  }
  uploadId: string
  uploadUrl: string
}

export interface FinalizeStagedUploadInput {
  checksumSha256: string
  mimeType: string
  objectKey: string
  size: number
  uploadId: string
}

export interface UploadedObjectMetadata {
  checksums?: {
    sha256?: ArrayBuffer | null
  }
  httpMetadata?: {
    contentType?: string | null
  }
  key: string
  size: number
}

export class StagedUploadValidationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'StagedUploadValidationError'
  }
}

function defaultCreateUploadId(): string {
  return crypto.randomUUID()
}

function defaultNow(): Date {
  return new Date()
}

function missingSigner(): never {
  throw new Error('A staged upload signer must be provided')
}

/* eslint-disable no-control-regex -- intentional: filenames must reject control chars */
const FORBIDDEN_FILENAME_CHARS =
  /[/\\:*?"<>|\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g
/* eslint-enable no-control-regex */
const MAX_FILENAME_BYTES = 255
const FILENAME_ENCODER = new TextEncoder()

function splitNameAndExt(filename: string): { base: string; ext: string } {
  const dotIndex = filename.lastIndexOf('.')
  // Leading dot only (e.g. ".pdf"): treat as extension-only, empty base.
  if (dotIndex === 0 && filename.length > 1) {
    return { base: '', ext: filename.slice(1) }
  }
  // No dot, or trailing dot — no extension.
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return { base: filename, ext: '' }
  }
  return { base: filename.slice(0, dotIndex), ext: filename.slice(dotIndex + 1) }
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  const encoded = FILENAME_ENCODER.encode(value)
  if (encoded.length <= maxBytes) return value

  // Cut at maxBytes, then back off to a valid UTF-8 codepoint boundary.
  // UTF-8 continuation bytes match 0b10xxxxxx (0x80–0xBF).
  let cut = maxBytes
  while (cut > 0 && ((encoded[cut] ?? 0) & 0xc0) === 0x80) {
    cut--
  }
  return new TextDecoder().decode(encoded.subarray(0, cut))
}

function fallbackFilename(uploadId: string, safeExt: string): string {
  const base = `upload-${uploadId.replace(/^upload-/, '').slice(0, 8)}`
  return safeExt ? `${base}.${safeExt}` : `${base}.bin`
}

function sanitizeFilename(filename: string, uploadId: string): string {
  const lastSegment = filename.split(/[/\\]/).at(-1)?.normalize('NFC').trim() ?? ''
  const cleaned = lastSegment.replace(FORBIDDEN_FILENAME_CHARS, '').trim()

  // Pure-dot names (`.`, `..`, `...`) survive cleaning but are unsafe as filesystem
  // path segments and as Content-Disposition values; force fallback.
  if (/^\.+$/.test(cleaned)) return fallbackFilename(uploadId, '')

  const { base, ext } = splitNameAndExt(cleaned)
  const safeExt = ext.replace(FORBIDDEN_FILENAME_CHARS, '')
  const trimmedBase = base.trim()

  if (!trimmedBase) return fallbackFilename(uploadId, safeExt)

  const extWithDot = safeExt ? `.${safeExt}` : ''
  const extByteLength = FILENAME_ENCODER.encode(extWithDot).length
  const truncatedBase = truncateToBytes(trimmedBase, MAX_FILENAME_BYTES - extByteLength)

  if (!truncatedBase) return fallbackFilename(uploadId, safeExt)

  return `${truncatedBase}${extWithDot}`
}

function encodeBase64(value: ArrayBuffer): string {
  return Buffer.from(new Uint8Array(value)).toString('base64')
}

export function createStagedUploadObjectKey(input: {
  adminUserId: string
  environment: string
  filename: string
  uploadId: string
}): string {
  const safeFilename = sanitizeFilename(input.filename, input.uploadId)

  return ['staged', input.environment, input.adminUserId, input.uploadId, safeFilename].join('/')
}

export async function signR2UploadUrl(input: {
  accessKeyId: string
  accountId: string
  bucketName: string
  checksumSha256: string
  expiresInSeconds: number
  mimeType: string
  objectKey: string
  secretAccessKey: string
  size: number
}): Promise<string> {
  const [{ S3Client, PutObjectCommand }, { getSignedUrl }] = await Promise.all([
    import('@aws-sdk/client-s3'),
    import('@aws-sdk/s3-request-presigner'),
  ])

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${input.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  })

  const command = new PutObjectCommand({
    Bucket: input.bucketName,
    Key: input.objectKey,
    ChecksumSHA256: input.checksumSha256,
    ContentType: input.mimeType,
  })

  // Cast via Parameters<>: @smithy/types is duplicated across versions in lockfile
  // (v4.14.0 + v4.14.1), causing structural type mismatch between S3Client and
  // getSignedUrl's expected Client<any, InputTypesUnion, ...>. Runtime is unaffected.
  return getSignedUrl(
    client as unknown as Parameters<typeof getSignedUrl>[0],
    command as unknown as Parameters<typeof getSignedUrl>[1],
    {
      expiresIn: input.expiresInSeconds,
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    }
  )
}

export async function createStagedUploadTarget(
  input: CreateStagedUploadTargetInput,
  options: CreateStagedUploadTargetOptions = {}
): Promise<StagedUploadTarget> {
  const uploadId = (options.createUploadId ?? defaultCreateUploadId)()
  const objectKey = createStagedUploadObjectKey({
    adminUserId: input.adminUserId,
    environment: input.environment,
    filename: input.filename,
    uploadId,
  })
  const uploadUrl = await (options.signUploadUrl ?? missingSigner)({
    accountId: input.accountId,
    bucketName: input.bucketName,
    checksumSha256: input.checksumSha256,
    expiresInSeconds: input.expiresInSeconds,
    mimeType: input.mimeType,
    objectKey,
    size: input.size,
  })
  const issuedAt = options.now ?? defaultNow

  return {
    expiresAt: new Date(issuedAt().getTime() + input.expiresInSeconds * 1000).toISOString(),
    objectKey,
    requiredHeaders: {
      'content-type': input.mimeType,
      'x-amz-checksum-sha256': input.checksumSha256,
    },
    uploadId,
    uploadUrl,
  }
}

export function validateStagedUploadMetadata(input: {
  expected: FinalizeStagedUploadInput
  object: UploadedObjectMetadata | null
}): FinalizeStagedUploadInput {
  if (!input.object) {
    throw new StagedUploadValidationError('Uploaded file was not found', 404)
  }

  if (input.object.key !== input.expected.objectKey) {
    throw new StagedUploadValidationError('Uploaded file key did not match', 400)
  }

  if (input.object.size !== input.expected.size) {
    throw new StagedUploadValidationError('Uploaded file size did not match', 400)
  }

  if (input.object.httpMetadata?.contentType !== input.expected.mimeType) {
    throw new StagedUploadValidationError('Uploaded file MIME type did not match', 400)
  }

  const uploadedChecksum = input.object.checksums?.sha256
    ? encodeBase64(input.object.checksums.sha256)
    : null

  if (uploadedChecksum !== input.expected.checksumSha256) {
    throw new StagedUploadValidationError('Uploaded file checksum did not match', 400)
  }

  if (!input.expected.objectKey.includes(`/${input.expected.uploadId}/`)) {
    throw new StagedUploadValidationError('Upload ID did not match the staged object key', 400)
  }

  return input.expected
}
