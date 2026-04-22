import { describe, expect, it, vi } from 'vitest'

import {
  PasskeyVerifyAuthenticationRouteError,
  forwardPasskeyVerifyAuthentication,
  isPasskeyVerifyAuthenticationEnabled,
  parsePasskeyVerifyAuthenticationBody,
} from '../../server/utils/passkey-verify-authentication'

describe('passkey verify-authentication route hotfix', () => {
  it('forwards a validated plain body through Better Auth handler with a clean Request', async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 })
    const handler = vi.fn().mockResolvedValue(response)
    const auth = {
      handler,
    }
    const headers = new Headers([['origin', 'https://agentic.yudefine.com.tw']])
    const requestUrl = 'https://agentic.yudefine.com.tw/api/auth/passkey/verify-authentication'

    const result = await forwardPasskeyVerifyAuthentication(auth, requestUrl, headers, {
      response: {
        id: 'credential-id',
        nested: { key: 'value' },
      },
    })

    expect(result).toBe(response)
    expect(handler).toHaveBeenCalledTimes(1)
    const [request] = handler.mock.calls[0] as [Request]
    expect(request.url).toBe(requestUrl)
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('origin')).toBe('https://agentic.yudefine.com.tw')
    await expect(request.json()).resolves.toEqual({
      response: {
        id: 'credential-id',
        nested: { key: 'value' },
      },
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

  it('returns service unavailable when the Better Auth handler is missing', async () => {
    const promise = forwardPasskeyVerifyAuthentication(
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
