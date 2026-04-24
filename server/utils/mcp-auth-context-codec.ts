import { getRequestHeader, type H3Event } from 'h3'

import type { McpAuthContext } from '#server/utils/mcp-middleware'

export const MCP_AUTH_CONTEXT_HEADER = 'X-Mcp-Auth-Context'
export const MCP_AUTH_CONTEXT_TTL_MS = 60_000
export const DEV_MCP_AUTH_SIGNING_KEY =
  'dev-only-mcp-auth-context-signing-key-keep-out-of-production'

export type McpAuthContextVerifyFailureReason =
  | 'missing_header'
  | 'malformed_envelope'
  | 'invalid_signature'
  | 'expired'

export type McpAuthContextVerifyResult =
  | { auth: McpAuthContext; ok: true }
  | { auth: null; ok: false; reason: McpAuthContextVerifyFailureReason }

interface SignedAuthContextPayload {
  auth: McpAuthContext
  issuedAt: number
}

interface SignedAuthContextEnvelope {
  payload: string
  signature: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class McpAuthSigningKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpAuthSigningKeyError'
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    return null
  }

  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')

  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

function encodeJsonBase64Url(value: unknown): string {
  return encodeBase64Url(encoder.encode(JSON.stringify(value)))
}

function decodeJsonBase64Url<T>(value: string): T | null {
  const bytes = decodeBase64Url(value)
  if (!bytes) {
    return null
  }

  try {
    return JSON.parse(decoder.decode(bytes)) as T
  } catch {
    return null
  }
}

async function importSigningKey(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
}

async function signPayload(payload: string, key: string): Promise<string> {
  const cryptoKey = await importSigningKey(key)
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(payload))

  return encodeBase64Url(new Uint8Array(signature))
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false
  }

  let diff = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index]! ^ right[index]!
  }

  return diff === 0
}

function isAuthContext(value: unknown): value is McpAuthContext {
  if (!value || typeof value !== 'object') {
    return false
  }

  const auth = value as Partial<McpAuthContext>
  return (
    typeof auth.tokenId === 'string' &&
    Array.isArray(auth.scopes) &&
    auth.scopes.every((scope) => typeof scope === 'string') &&
    !!auth.principal &&
    typeof auth.principal === 'object' &&
    (auth.principal.authSource === 'legacy_token' ||
      auth.principal.authSource === 'oauth_access_token') &&
    typeof auth.principal.userId === 'string'
  )
}

function isSignedPayload(value: unknown): value is SignedAuthContextPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as Partial<SignedAuthContextPayload>
  return Number.isFinite(payload.issuedAt) && isAuthContext(payload.auth)
}

function isEnvelope(value: unknown): value is SignedAuthContextEnvelope {
  if (!value || typeof value !== 'object') {
    return false
  }

  const envelope = value as Partial<SignedAuthContextEnvelope>
  return typeof envelope.payload === 'string' && typeof envelope.signature === 'string'
}

export async function signAuthContext(
  auth: McpAuthContext,
  key: string,
  issuedAt = Date.now(),
): Promise<string> {
  const payload = encodeJsonBase64Url({ auth, issuedAt } satisfies SignedAuthContextPayload)
  const signature = await signPayload(payload, key)

  return encodeJsonBase64Url({ payload, signature } satisfies SignedAuthContextEnvelope)
}

export async function verifyAuthContextEnvelope(
  header: string | null | undefined,
  key: string,
  nowMs = Date.now(),
): Promise<McpAuthContextVerifyResult> {
  if (!header) {
    return { auth: null, ok: false, reason: 'missing_header' }
  }

  const envelope = decodeJsonBase64Url<unknown>(header)
  if (!isEnvelope(envelope)) {
    return { auth: null, ok: false, reason: 'malformed_envelope' }
  }

  const expectedSignature = await signPayload(envelope.payload, key)
  const actualSignatureBytes = decodeBase64Url(envelope.signature)
  const expectedSignatureBytes = decodeBase64Url(expectedSignature)
  if (
    !actualSignatureBytes ||
    !expectedSignatureBytes ||
    !timingSafeEqual(actualSignatureBytes, expectedSignatureBytes)
  ) {
    return { auth: null, ok: false, reason: 'invalid_signature' }
  }

  const payload = decodeJsonBase64Url<unknown>(envelope.payload)
  if (!isSignedPayload(payload)) {
    return { auth: null, ok: false, reason: 'malformed_envelope' }
  }

  if (nowMs - payload.issuedAt > MCP_AUTH_CONTEXT_TTL_MS) {
    return { auth: null, ok: false, reason: 'expired' }
  }

  return { auth: payload.auth, ok: true }
}

export async function verifyAuthContext(
  header: string | null | undefined,
  key: string,
  nowMs = Date.now(),
): Promise<McpAuthContext | null> {
  const result = await verifyAuthContextEnvelope(header, key, nowMs)

  return result.ok ? result.auth : null
}

export function getMcpAuthContextHeader(event: H3Event): string | null {
  return getRequestHeader(event, MCP_AUTH_CONTEXT_HEADER) ?? null
}

export function resolveMcpAuthSigningKey(value: unknown): string {
  const key = typeof value === 'string' ? value : ''
  if (!key) {
    throw new McpAuthSigningKeyError('NUXT_MCP_AUTH_SIGNING_KEY must be configured')
  }

  if (encoder.encode(key).byteLength < 32) {
    throw new McpAuthSigningKeyError('NUXT_MCP_AUTH_SIGNING_KEY must be at least 32 bytes')
  }

  return key
}

export function getMcpAuthSigningKey(event?: H3Event): string {
  const runtimeConfig = event ? useRuntimeConfig(event) : useRuntimeConfig()

  return resolveMcpAuthSigningKey(runtimeConfig.mcpAuthSigningKey)
}
