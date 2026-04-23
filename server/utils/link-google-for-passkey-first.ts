import { createRemoteJWKSet, jwtVerify } from 'jose'

import {
  LINK_GOOGLE_FOR_PASSKEY_FIRST_CALLBACK_PATH,
  buildLinkGoogleForPasskeyFirstErrorRedirect,
  buildLinkGoogleForPasskeyFirstSuccessRedirect,
  getLinkGoogleForPasskeyFirstMessage,
  getLinkGoogleForPasskeyFirstStatusCode,
  type LinkGoogleForPasskeyFirstErrorCode,
} from '#shared/utils/link-google-for-passkey-first'

export const LINK_GOOGLE_FOR_PASSKEY_FIRST_COOKIE_NAME = '__Host-oauth-link-state'
export const LINK_GOOGLE_FOR_PASSKEY_FIRST_KV_PREFIX = 'oauth-link-state:'
export const LINK_GOOGLE_FOR_PASSKEY_FIRST_TTL_SECONDS = 600

export interface LinkGoogleForPasskeyFirstStatePayload {
  createdAt: string
  nonce: string
  redirectOrigin: string
  userId: string
}

interface KvBindingLike {
  delete?: (key: string) => Promise<void>
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface GoogleIdTokenPayload {
  aud: string | string[]
  email?: string
  email_verified?: boolean
  exp: number
  iat?: number
  iss: 'https://accounts.google.com' | 'accounts.google.com'
  picture?: string | null
  sub?: string
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export function createLinkGoogleForPasskeyFirstError(
  code: LinkGoogleForPasskeyFirstErrorCode,
  input: { email?: string | null } = {},
) {
  return createError({
    statusCode: getLinkGoogleForPasskeyFirstStatusCode(code),
    statusMessage: code,
    message: getLinkGoogleForPasskeyFirstMessage(code, input),
  })
}

export function createLinkGoogleForPasskeyFirstStateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)

  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

export function buildLinkGoogleForPasskeyFirstStateKey(token: string): string {
  return `${LINK_GOOGLE_FOR_PASSKEY_FIRST_KV_PREFIX}${token}`
}

export function buildLinkGoogleForPasskeyFirstCallbackUrl(origin: string): string {
  return `${origin}${LINK_GOOGLE_FOR_PASSKEY_FIRST_CALLBACK_PATH}`
}

export function buildGoogleAuthorizationUrl(input: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')

  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', input.state)

  return url.toString()
}

export async function clearLinkGoogleForPasskeyFirstState(
  kv: KvBindingLike,
  token: string,
): Promise<void> {
  const key = buildLinkGoogleForPasskeyFirstStateKey(token)

  if (typeof kv.delete === 'function') {
    await kv.delete(key)
    return
  }

  await kv.put(key, '', { expirationTtl: 1 })
}

export function parseLinkGoogleForPasskeyFirstStatePayload(
  value: string | null,
): LinkGoogleForPasskeyFirstStatePayload | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as Partial<LinkGoogleForPasskeyFirstStatePayload>

    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.redirectOrigin !== 'string'
    ) {
      return null
    }

    return {
      createdAt: parsed.createdAt,
      nonce: parsed.nonce,
      redirectOrigin: parsed.redirectOrigin,
      userId: parsed.userId,
    }
  } catch {
    return null
  }
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<GoogleIdTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      audience: clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    })

    if (
      (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') ||
      typeof payload.exp !== 'number' ||
      (payload.iat !== undefined && typeof payload.iat !== 'number')
    ) {
      return null
    }

    const audience = payload.aud
    if (!(typeof audience === 'string' || Array.isArray(audience))) {
      return null
    }

    return {
      aud: audience,
      email:
        typeof payload.email === 'string' && payload.email.length > 0 ? payload.email : undefined,
      email_verified: payload.email_verified === true,
      exp: payload.exp,
      iat: payload.iat,
      iss: payload.iss,
      picture: typeof payload.picture === 'string' ? payload.picture : null,
      sub: typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : undefined,
    }
  } catch {
    return null
  }
}

export function redirectToLinkGoogleForPasskeyFirstError(
  event: Parameters<typeof sendRedirect>[0],
  code: LinkGoogleForPasskeyFirstErrorCode,
  input: { email?: string | null } = {},
) {
  return sendRedirect(event, buildLinkGoogleForPasskeyFirstErrorRedirect(code, input), 302)
}

export function redirectToLinkGoogleForPasskeyFirstSuccess(
  event: Parameters<typeof sendRedirect>[0],
) {
  return sendRedirect(event, buildLinkGoogleForPasskeyFirstSuccessRedirect(), 302)
}
