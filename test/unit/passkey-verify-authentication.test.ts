import { describe, expect, it, vi } from 'vitest'

const { verifyAuthenticationResponseMock } = vi.hoisted(() => ({
  verifyAuthenticationResponseMock: vi.fn(),
}))

vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: verifyAuthenticationResponseMock,
}))

import {
  handlePasskeyVerifyAuthentication,
  PasskeyVerifyAuthenticationRouteError,
  isPasskeyVerifyAuthenticationEnabled,
  parsePasskeyVerifyAuthenticationBody,
} from '../../server/utils/passkey-verify-authentication'

function createOpaqueProxy<T extends Record<string, unknown>>(value: T): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      return Reflect.get(target, property, receiver)
    },
    ownKeys() {
      throw new TypeError('ownKeys exploded')
    },
  })
}

async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  const signatureBase64 = Buffer.from(signature).toString('base64')

  return encodeURIComponent(`${value}.${signatureBase64}`)
}

describe('passkey verify-authentication route hotfix', () => {
  it('completes manual verification without enumerating proxy-like adapter rows', async () => {
    verifyAuthenticationResponseMock.mockResolvedValue({
      authenticationInfo: {
        newCounter: 8,
      },
      verified: true,
    })

    const auth = {
      $context: Promise.resolve({
        adapter: {
          findOne: vi.fn().mockResolvedValue(
            createOpaqueProxy({
              counter: 7,
              credentialID: 'credential-id',
              id: 'passkey-1',
              publicKey: Buffer.from('public-key-bytes').toString('base64'),
              transports: 'internal',
              userId: 'user-1',
            }),
          ),
          update: vi.fn().mockResolvedValue(undefined),
        },
        authCookies: {
          dontRememberToken: {
            attributes: { httpOnly: true, path: '/' },
            name: 'better-auth.dont-remember',
          },
          sessionToken: {
            attributes: { httpOnly: true, path: '/', sameSite: 'lax', secure: true },
            name: 'better-auth.session_token',
          },
        },
        createAuthCookie: vi.fn().mockReturnValue({
          attributes: { httpOnly: true, path: '/' },
          name: 'better-auth-passkey',
        }),
        internalAdapter: {
          createSession: vi.fn().mockResolvedValue(
            createOpaqueProxy({
              createdAt: new Date('2026-04-23T00:00:00.000Z'),
              expiresAt: new Date('2026-04-23T01:00:00.000Z'),
              id: 'session-1',
              token: 'session-token-1',
              updatedAt: new Date('2026-04-23T00:00:00.000Z'),
              userId: 'user-1',
            }),
          ),
          deleteVerificationByIdentifier: vi.fn().mockResolvedValue(undefined),
          findUserById: vi.fn().mockResolvedValue(
            createOpaqueProxy({
              createdAt: new Date('2026-04-23T00:00:00.000Z'),
              displayName: 'Passkey User',
              email: null,
              emailVerified: false,
              id: 'user-1',
              image: null,
              name: 'Passkey User',
              role: 'guest',
              updatedAt: new Date('2026-04-23T00:00:00.000Z'),
            }),
          ),
          findVerificationValue: vi.fn().mockResolvedValue({
            value: JSON.stringify({ expectedChallenge: 'challenge-1' }),
          }),
        },
        secret: 'test-secret',
        sessionConfig: {
          expiresIn: 60 * 60,
        },
      }),
      options: {
        plugins: [
          {
            id: 'passkey',
            options: {
              rpID: 'agentic.yudefine.com.tw',
            },
          },
        ],
      },
    }
    const headers = new Headers([
      [
        'cookie',
        `better-auth-passkey=${await signCookieValue('verification-token-1', 'test-secret')}`,
      ],
      ['origin', 'https://agentic.yudefine.com.tw'],
    ])
    const requestUrl = 'https://agentic.yudefine.com.tw/api/auth/passkey/verify-authentication'

    const result = await handlePasskeyVerifyAuthentication(auth, requestUrl, headers, {
      response: {
        clientExtensionResults: {},
        id: 'credential-id',
        rawId: 'credential-id',
        response: {
          authenticatorData: 'auth-data',
          clientDataJSON: 'client-data',
          signature: 'signature',
        },
        type: 'public-key',
      },
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      session: expect.objectContaining({
        id: 'session-1',
        token: 'session-token-1',
        userId: 'user-1',
      }),
      user: expect.objectContaining({
        displayName: 'Passkey User',
        id: 'user-1',
        role: 'guest',
      }),
    })
    expect(result.headers.get('set-cookie')).toContain('better-auth.session_token=')

    const context = await auth.$context
    expect(context.adapter.findOne).toHaveBeenCalledWith({
      model: 'passkey',
      where: [{ field: 'credentialID', value: 'credential-id' }],
    })
    expect(context.adapter.update).toHaveBeenCalledWith({
      model: 'passkey',
      update: { counter: 8 },
      where: [{ field: 'id', value: 'passkey-1' }],
    })
    expect(context.internalAdapter.createSession).toHaveBeenCalledWith('user-1')
    expect(context.internalAdapter.findUserById).toHaveBeenCalledWith('user-1')
    expect(context.internalAdapter.deleteVerificationByIdentifier).toHaveBeenCalledWith(
      'verification-token-1',
    )
    expect(verifyAuthenticationResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'challenge-1',
        expectedOrigin: 'https://agentic.yudefine.com.tw',
        expectedRPID: 'agentic.yudefine.com.tw',
      }),
    )
  })

  it('rejects payloads without a response record', () => {
    expect(() => parsePasskeyVerifyAuthenticationBody({})).toThrowError(
      'Passkey authentication payload invalid',
    )
    expect(() => parsePasskeyVerifyAuthenticationBody({ response: null })).toThrowError(
      'Passkey authentication payload invalid',
    )
    expect(() => parsePasskeyVerifyAuthenticationBody({ response: [] })).toThrowError(
      'Passkey authentication payload invalid',
    )
  })

  it('returns service unavailable when the Better Auth context is missing', async () => {
    const promise = handlePasskeyVerifyAuthentication(
      {},
      'https://agentic.yudefine.com.tw/api/auth/passkey/verify-authentication',
      new Headers(),
      {
        response: {
          id: 'credential-id',
        },
      },
    )

    await expect(promise).rejects.toBeInstanceOf(PasskeyVerifyAuthenticationRouteError)
    await expect(promise).rejects.toMatchObject({
      message: 'Passkey authentication unavailable',
      statusCode: 503,
      statusMessage: 'Service Unavailable',
    })
  })

  it('only enables the route when the flag and RP config are both present', () => {
    expect(
      isPasskeyVerifyAuthenticationEnabled({
        knowledge: {
          features: {
            passkey: true,
          },
        },
        passkey: {
          rpId: 'yudefine.com.tw',
          rpName: '知識問答系統',
        },
      }),
    ).toBe(true)

    expect(
      isPasskeyVerifyAuthenticationEnabled({
        knowledge: {
          features: {
            passkey: false,
          },
        },
        passkey: {
          rpId: 'yudefine.com.tw',
          rpName: '知識問答系統',
        },
      }),
    ).toBe(false)

    expect(
      isPasskeyVerifyAuthenticationEnabled({
        knowledge: {
          features: {
            passkey: true,
          },
        },
        passkey: {
          rpId: 'yudefine.com.tw',
        },
      }),
    ).toBe(false)
  })
})
