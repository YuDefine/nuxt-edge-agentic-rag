import { describe, expect, it, vi } from 'vitest'

import {
  PasskeyVerifyAuthenticationRouteError,
  forwardPasskeyVerifyAuthentication,
  isPasskeyVerifyAuthenticationEnabled,
  parsePasskeyVerifyAuthenticationBody,
} from '../../server/utils/passkey-verify-authentication'

describe('passkey verify-authentication route hotfix', () => {
  it('forwards a validated plain body to Better Auth direct API', async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 })
    const verifyPasskeyAuthentication = vi.fn().mockResolvedValue(response)
    const auth = {
      api: {
        verifyPasskeyAuthentication,
      },
    }
    const headers = new Headers([['origin', 'https://agentic.yudefine.com.tw']])

    const result = await forwardPasskeyVerifyAuthentication(auth, headers, {
      response: {
        id: 'credential-id',
        nested: { key: 'value' },
      },
    })

    expect(result).toBe(response)
    expect(verifyPasskeyAuthentication).toHaveBeenCalledWith({
      asResponse: true,
      body: {
        response: {
          id: 'credential-id',
          nested: { key: 'value' },
        },
      },
      headers,
    })
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

  it('returns service unavailable when the direct auth endpoint is missing', async () => {
    const promise = forwardPasskeyVerifyAuthentication({}, new Headers(), {
      response: {
        id: 'credential-id',
      },
    })

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
