import { createHash, createSign, generateKeyPairSync } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { serializeSignedCookie } from 'better-call'
import { describe, expect, it, vi } from 'vitest'

interface SimpleWebAuthnHelpersModule {
  cose: {
    COSEALG: { ES256: number }
    COSECRV: { P256: number }
    COSEKEYS: { alg: number; crv: number; kty: number; x: number; y: number }
    COSEKTY: { EC2: number }
  }
  isoBase64URL: {
    toBuffer(value: string): Uint8Array
  }
  isoCBOR: {
    encode(value: unknown): Uint8Array
  }
}

const require = createRequire(import.meta.url)
const passkeyEntry = require.resolve('@better-auth/passkey')
const passkeyRequire = createRequire(passkeyEntry)
const simpleWebAuthnHelpersUrl = pathToFileURL(
  passkeyRequire.resolve('@simplewebauthn/server/helpers'),
).href

let simpleWebAuthnHelpersPromise: Promise<SimpleWebAuthnHelpersModule> | null = null

interface MockAuthContext {
  asResponse: boolean
  headers: Headers
  body: {
    response: AuthenticationResponsePayload
  }
  context: {
    adapter: {
      findOne: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
    }
    internalAdapter: {
      findVerificationValue: ReturnType<typeof vi.fn>
      createSession: ReturnType<typeof vi.fn>
      findUserById: ReturnType<typeof vi.fn>
      deleteVerificationByIdentifier: ReturnType<typeof vi.fn>
    }
    authCookies: {
      dontRememberToken: { name: string; attributes: Record<string, unknown> }
      sessionToken: { name: string; attributes: Record<string, unknown> }
      sessionData: { name: string; attributes: Record<string, unknown> }
      accountData: { name: string; attributes: Record<string, unknown> }
    }
    createAuthCookie: ReturnType<typeof vi.fn>
    logger: {
      error: ReturnType<typeof vi.fn>
    }
    options: {
      baseURL: string
      session: {
        cookieCache: {
          enabled: boolean
        }
      }
      account: {
        storeAccountCookie: boolean
      }
      oauthConfig?: {
        storeStateStrategy?: string
      }
    }
    secret: string
    secretConfig: string
    sessionConfig: {
      expiresIn: number
    }
    setNewSession: ReturnType<typeof vi.fn>
  }
}

interface AuthenticationResponsePayload {
  id: string
  rawId: string
  type: 'public-key'
  response: {
    authenticatorData: string
    clientDataJSON: string
    signature: string
  }
}

interface PasskeyAuthenticationFixture {
  credentialId: string
  response: AuthenticationResponsePayload
  storedPublicKeyBase64: string
}

async function loadSimpleWebAuthnHelpers(): Promise<SimpleWebAuthnHelpersModule> {
  simpleWebAuthnHelpersPromise ??= import(
    simpleWebAuthnHelpersUrl
  ) as Promise<SimpleWebAuthnHelpersModule>
  return simpleWebAuthnHelpersPromise
}

async function createPasskeyAuthenticationFixture(): Promise<PasskeyAuthenticationFixture> {
  const { cose, isoBase64URL, isoCBOR } = await loadSimpleWebAuthnHelpers()
  const rpID = 'agentic.yudefine.com.tw'
  const origin = 'https://agentic.yudefine.com.tw'
  const challenge = 'challenge-1'
  const credentialId = Buffer.from('credential-1').toString('base64url')
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey

  if (!publicJwk.x || !publicJwk.y) {
    throw new Error('Expected ES256 fixture public key to export x/y coordinates')
  }

  const credentialPublicKey = Buffer.from(
    isoCBOR.encode(
      new Map([
        [cose.COSEKEYS.kty, cose.COSEKTY.EC2],
        [cose.COSEKEYS.alg, cose.COSEALG.ES256],
        [cose.COSEKEYS.crv, cose.COSECRV.P256],
        [cose.COSEKEYS.x, isoBase64URL.toBuffer(publicJwk.x)],
        [cose.COSEKEYS.y, isoBase64URL.toBuffer(publicJwk.y)],
      ]),
    ),
  )

  const clientDataJSON = Buffer.from(
    JSON.stringify({
      challenge,
      origin,
      type: 'webauthn.get',
    }),
  )
  const authenticatorData = Buffer.alloc(37)
  createHash('sha256').update(rpID).digest().copy(authenticatorData, 0)
  authenticatorData[32] = 0x01
  authenticatorData.writeUInt32BE(8, 33)

  const signatureBase = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientDataJSON).digest(),
  ])
  const signer = createSign('SHA256')
  signer.update(signatureBase)
  signer.end()

  return {
    credentialId,
    response: {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        authenticatorData: authenticatorData.toString('base64url'),
        clientDataJSON: clientDataJSON.toString('base64url'),
        signature: signer.sign(privateKey).toString('base64url'),
      },
    },
    storedPublicKeyBase64: credentialPublicKey.toString('base64'),
  }
}

async function createMockVerifyAuthenticationContext(
  fixture: PasskeyAuthenticationFixture,
): Promise<MockAuthContext> {
  const signedChallengeCookie = await serializeSignedCookie(
    'better-auth-passkey',
    'verification-token-1',
    'test-secret',
    {},
  )

  return {
    asResponse: true,
    headers: new Headers([
      ['origin', 'https://agentic.yudefine.com.tw'],
      ['cookie', signedChallengeCookie],
    ]),
    body: {
      response: fixture.response,
    },
    context: {
      adapter: {
        findOne: vi.fn().mockResolvedValue({
          id: 'passkey-1',
          userId: 'user-1',
          credentialID: fixture.credentialId,
          publicKey: fixture.storedPublicKeyBase64,
          counter: 7,
          transports: 'internal',
        }),
        update: vi.fn().mockResolvedValue({ id: 'passkey-1', counter: 8 }),
      },
      internalAdapter: {
        findVerificationValue: vi.fn().mockResolvedValue({
          value: JSON.stringify({ expectedChallenge: 'challenge-1' }),
        }),
        createSession: vi.fn().mockResolvedValue({
          id: 'session-1',
          token: 'session-token-1',
          userId: 'user-1',
        }),
        findUserById: vi.fn().mockResolvedValue({
          id: 'user-1',
          email: null,
          emailVerified: false,
          name: 'Passkey User',
          displayName: 'Passkey User',
          image: null,
        }),
        deleteVerificationByIdentifier: vi.fn().mockResolvedValue(undefined),
      },
      authCookies: {
        dontRememberToken: { name: 'better-auth.dont-remember', attributes: {} },
        sessionToken: { name: 'better-auth.session_token', attributes: {} },
        sessionData: { name: 'better-auth.session_data', attributes: {} },
        accountData: { name: 'better-auth.account_data', attributes: {} },
      },
      createAuthCookie: vi.fn().mockReturnValue({
        name: 'better-auth-passkey',
        attributes: {},
      }),
      logger: {
        error: vi.fn(),
      },
      options: {
        baseURL: 'https://agentic.yudefine.com.tw',
        session: {
          cookieCache: {
            enabled: false,
          },
        },
        account: {
          storeAccountCookie: false,
        },
      },
      secret: 'test-secret',
      secretConfig: 'test-secret',
      sessionConfig: {
        expiresIn: 60 * 60,
      },
      setNewSession: vi.fn(),
    },
  }
}

describe('passkey verify-authentication hotfix', () => {
  it('completes the endpoint success path without throwing a 500-style runtime error', async () => {
    const { passkey } = await import('@better-auth/passkey')
    const plugin = passkey({
      rpID: 'agentic.yudefine.com.tw',
      rpName: 'Agentic RAG',
    })
    const verifyPasskeyAuthentication = plugin.endpoints.verifyPasskeyAuthentication as unknown as (
      ctx: MockAuthContext,
    ) => Promise<Response>

    const fixture = await createPasskeyAuthenticationFixture()
    const ctx = await createMockVerifyAuthenticationContext(fixture)
    const result = await verifyPasskeyAuthentication(ctx)
    const body = (await result.json()) as {
      session: { token: string }
      user: { id: string }
    }

    expect(result.status).toBe(200)
    expect(body.session.token).toBe('session-token-1')
    expect(body.user.id).toBe('user-1')
    expect(ctx.context.adapter.findOne).toHaveBeenCalledTimes(1)
    expect(ctx.context.adapter.update).toHaveBeenCalledWith({
      model: 'passkey',
      where: [{ field: 'id', value: 'passkey-1' }],
      update: { counter: 8 },
    })
    expect(ctx.context.internalAdapter.createSession).toHaveBeenCalledWith('user-1')
    expect(ctx.context.internalAdapter.findUserById).toHaveBeenCalledWith('user-1')
    expect(result.headers.get('set-cookie')).toContain('better-auth.session_token=')
    expect(ctx.context.setNewSession).toHaveBeenCalledWith({
      session: { id: 'session-1', token: 'session-token-1', userId: 'user-1' },
      user: expect.objectContaining({ id: 'user-1' }),
    })
    expect(ctx.context.internalAdapter.deleteVerificationByIdentifier).toHaveBeenCalledWith(
      'verification-token-1',
    )
    expect(ctx.context.logger.error).not.toHaveBeenCalled()
  })
})
