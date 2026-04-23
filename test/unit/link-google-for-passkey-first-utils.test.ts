import { describe, expect, it } from 'vitest'

import {
  buildGoogleAuthorizationUrl,
  buildLinkGoogleForPasskeyFirstCallbackUrl,
  buildLinkGoogleForPasskeyFirstStateKey,
  LINK_GOOGLE_FOR_PASSKEY_FIRST_KV_PREFIX,
  verifyGoogleIdToken,
} from '../../server/utils/link-google-for-passkey-first'

describe('link-google-for-passkey-first utilities', () => {
  it('建立 Google OAuth 授權網址', () => {
    const authorizationUrl = buildGoogleAuthorizationUrl({
      clientId: 'google-client-id',
      redirectUri:
        'https://agentic.example.com/api/auth/account/link-google-for-passkey-first/callback',
      state: 'nonce-token',
    })

    const url = new URL(authorizationUrl)

    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.pathname).toBe('/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('google-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://agentic.example.com/api/auth/account/link-google-for-passkey-first/callback',
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('state')).toBe('nonce-token')
  })

  it('建立 callback URL 與 KV key', () => {
    expect(buildLinkGoogleForPasskeyFirstCallbackUrl('https://agentic.example.com')).toBe(
      'https://agentic.example.com/api/auth/account/link-google-for-passkey-first/callback',
    )
    expect(buildLinkGoogleForPasskeyFirstStateKey('nonce-token')).toBe(
      `${LINK_GOOGLE_FOR_PASSKEY_FIRST_KV_PREFIX}nonce-token`,
    )
  })

  it('在無效 id token 時回傳 null', async () => {
    await expect(verifyGoogleIdToken('invalid-token', 'google-client-id')).resolves.toBeNull()
  })
})
