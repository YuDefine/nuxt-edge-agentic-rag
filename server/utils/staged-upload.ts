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

function sanitizeFilename(filename: string): string {
  const candidate = filename.split(/[/\\]/).at(-1)?.trim().toLowerCase() ?? ''
  const normalized = candidate
    .normalize('NFKD')
    .replace(/[^\p{ASCII}]/gu, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized || 'upload.bin'
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
  const safeFilename = sanitizeFilename(input.filename)

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
