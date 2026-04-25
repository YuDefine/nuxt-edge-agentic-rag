/**
 * HMAC-signed header codec for the MCP DO `__invalidate` bypass channel.
 *
 * Trust anchor: `runtimeConfig.mcpAuthSigningKey` (env `NUXT_MCP_AUTH_SIGNING_KEY`),
 * already shared with the auth-context forward path so we add zero new secret
 * surface. Headers bind to a specific `sessionId` + millisecond timestamp so a
 * leaked header expires with the 60s skew window and cannot be replayed against
 * a different DO.
 *
 * Header shape: `v1.<sessionId>.<timestampMs>.<hex(HMAC-SHA256(secret, "<sessionId>|<timestampMs>"))>`
 */

const HEADER_VERSION = 'v1'
const DEFAULT_MAX_SKEW_MS = 60_000

const encoder = new TextEncoder()

export class McpInvalidateHeaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpInvalidateHeaderError'
  }
}

export interface SignInvalidateHeaderInput {
  sessionId: string
  secret: string
  now?: number
}

export interface VerifyInvalidateHeaderInput {
  sessionId: string
  secret: string
  now?: number
  maxSkewMs?: number
}

export async function signInvalidateHeader(input: SignInvalidateHeaderInput): Promise<string> {
  const { sessionId, secret } = input
  if (!sessionId) {
    throw new McpInvalidateHeaderError('sessionId is required')
  }
  if (!secret) {
    throw new McpInvalidateHeaderError('secret is required')
  }

  const timestampMs = input.now ?? Date.now()
  const payload = `${sessionId}|${timestampMs}`
  const signature = await hmacSha256Hex(payload, secret)

  return `${HEADER_VERSION}.${sessionId}.${timestampMs}.${signature}`
}

export async function verifyInvalidateHeader(
  headerValue: string | null | undefined,
  input: VerifyInvalidateHeaderInput,
): Promise<boolean> {
  if (!headerValue) {
    return false
  }

  const parts = headerValue.split('.')
  if (parts.length !== 4) {
    return false
  }

  const [version, sessionId, timestampStr, signature] = parts as [string, string, string, string]
  if (version !== HEADER_VERSION) {
    return false
  }
  if (!sessionId || sessionId !== input.sessionId) {
    return false
  }
  if (!signature || !/^[0-9a-f]+$/.test(signature)) {
    return false
  }

  const timestampMs = Number(timestampStr)
  if (!Number.isFinite(timestampMs)) {
    return false
  }

  const now = input.now ?? Date.now()
  const maxSkewMs = input.maxSkewMs ?? DEFAULT_MAX_SKEW_MS
  if (Math.abs(now - timestampMs) > maxSkewMs) {
    return false
  }

  const payload = `${sessionId}|${timestampMs}`
  const expectedSignature = await hmacSha256Hex(payload, input.secret)

  return timingSafeEqualHex(signature, expectedSignature)
}

async function hmacSha256Hex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }

  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

export const MCP_INVALIDATE_HEADER = 'X-Mcp-Internal-Invalidate'
