import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

const mocks = vi.hoisted(() => ({
  appendResponseHeader: vi.fn(),
  dbInsertValues: vi.fn(),
  dbSelect: vi.fn(),
  dbSelectResults: [] as Array<Array<Record<string, string>>>,
  getRuntimeAdminAccess: vi.fn(),
  readValidatedBody: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  serverAuth: vi.fn(),
  useRuntimeConfig: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}))

vi.mock('#server/utils/knowledge-runtime', () => ({
  getRuntimeAdminAccess: mocks.getRuntimeAdminAccess,
}))

vi.mock('hub:db', () => {
  const db = {
    insert: vi.fn(() => ({
      values: mocks.dbInsertValues,
    })),
    select: mocks.dbSelect,
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  }

  return {
    db,
    schema: {
      account: {
        id: { name: 'account.id' },
        providerId: { name: 'account.providerId' },
        userId: { name: 'account.userId' },
      },
      user: {
        email: { name: 'user.email' },
        id: { name: 'user.id' },
        role: { name: 'user.role' },
      },
    },
  }
})

installNuxtRouteTestGlobals()

describe('POST /api/_dev/login', () => {
  beforeEach(() => {
    vi.stubGlobal('appendResponseHeader', mocks.appendResponseHeader)
    vi.stubGlobal('readValidatedBody', mocks.readValidatedBody)
    vi.stubGlobal('serverAuth', mocks.serverAuth)
    vi.stubGlobal('useRuntimeConfig', mocks.useRuntimeConfig)

    mocks.appendResponseHeader.mockReset()
    mocks.dbInsertValues.mockReset()
    mocks.dbSelect.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(mocks.dbSelectResults.shift() ?? [])),
        })),
      })),
    }))
    mocks.dbSelectResults.splice(0, mocks.dbSelectResults.length)
    mocks.getRuntimeAdminAccess.mockReset()
    mocks.readValidatedBody.mockReset()
    mocks.serverAuth.mockReset()
    mocks.signInEmail.mockReset()
    mocks.signUpEmail.mockReset()
    mocks.useRuntimeConfig.mockReset()

    mocks.getRuntimeAdminAccess.mockReturnValue(false)
    mocks.useRuntimeConfig.mockReturnValue({
      knowledge: { environment: 'local' },
      devLoginPassword: 'fallback-pass',
    })
    mocks.readValidatedBody.mockResolvedValue({
      email: 'member@test.local',
      password: undefined,
    })
    mocks.signInEmail.mockResolvedValue(
      new Response(
        JSON.stringify({ user: { id: 'user-1', email: 'member@test.local', role: 'user' } }),
        {
          status: 200,
          headers: { 'set-cookie': 'session=abc; Path=/; HttpOnly' },
        },
      ),
    )
    mocks.serverAuth.mockReturnValue({
      api: {
        signInEmail: mocks.signInEmail,
        signUpEmail: mocks.signUpEmail,
      },
    })
    mocks.dbSelectResults.push([], [])
  })

  it('falls back to runtimeConfig.devLoginPassword when password is omitted', async () => {
    const { default: handler } = await import('../../server/api/_dev/login.post')
    const result = (await handler(createRouteEvent())) as {
      action: string
      success: boolean
      user: { email: string; role: string }
    }

    expect(mocks.signInEmail).toHaveBeenCalledWith({
      body: {
        email: 'member@test.local',
        password: 'fallback-pass',
      },
      asResponse: true,
    })
    expect(mocks.signUpEmail).not.toHaveBeenCalled()
    expect(mocks.appendResponseHeader).toHaveBeenCalledWith(
      expect.any(Object),
      'set-cookie',
      'session=abc; Path=/; HttpOnly',
    )
    expect(result).toMatchObject({
      success: true,
      action: 'signed_in',
      user: {
        email: 'member@test.local',
        role: 'user',
      },
    })
  })

  it('creates a credential account for an existing local user before signing in', async () => {
    mocks.readValidatedBody.mockResolvedValueOnce({
      email: 'charles.yudefine@gmail.com',
      password: 'fallback-pass',
    })
    mocks.dbSelectResults.splice(0, mocks.dbSelectResults.length, [{ id: 'user-42' }], [])

    const { default: handler } = await import('../../server/api/_dev/login.post')
    await handler(createRouteEvent())

    expect(mocks.dbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'user-42',
        providerId: 'credential',
        userId: 'user-42',
        password: expect.stringMatching(/^[0-9a-f]{32}:[0-9a-f]{128}$/),
      }),
    )
    expect(mocks.signInEmail).toHaveBeenCalledWith({
      body: {
        email: 'charles.yudefine@gmail.com',
        password: 'fallback-pass',
      },
      asResponse: true,
    })
  })
})
