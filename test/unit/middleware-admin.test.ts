import { beforeEach, describe, expect, it, vi } from 'vitest'

const middlewareMocks = vi.hoisted(() => ({
  defineNuxtRouteMiddleware: vi.fn((fn) => fn),
  navigateTo: vi.fn((path) => ({ path })),
  useUserRole: vi.fn(),
  useUserSession: vi.fn(),
}))

vi.stubGlobal('defineNuxtRouteMiddleware', middlewareMocks.defineNuxtRouteMiddleware)
vi.stubGlobal('navigateTo', middlewareMocks.navigateTo)
vi.stubGlobal('useUserRole', middlewareMocks.useUserRole)
vi.stubGlobal('useUserSession', middlewareMocks.useUserSession)

describe('admin middleware', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('redirects unauthenticated users to login with redirect param', async () => {
    middlewareMocks.useUserSession.mockReturnValue({
      loggedIn: { value: false },
    })
    middlewareMocks.useUserRole.mockReturnValue({
      isAdmin: { value: false },
    })

    const { default: middleware } = await import('../../app/middleware/admin')

    const to = { fullPath: '/admin/documents' }
    const result = middleware(to as never)

    expect(middlewareMocks.navigateTo).toHaveBeenCalledWith(
      '/auth/login?redirect=%2Fadmin%2Fdocuments'
    )
    expect(result).toEqual({ path: '/auth/login?redirect=%2Fadmin%2Fdocuments' })
  })

  it('redirects authenticated non-admin users to home with unauthorized param', async () => {
    middlewareMocks.useUserSession.mockReturnValue({
      loggedIn: { value: true },
    })
    middlewareMocks.useUserRole.mockReturnValue({
      isAdmin: { value: false },
    })

    const { default: middleware } = await import('../../app/middleware/admin')

    const to = { fullPath: '/admin/documents' }
    const result = middleware(to as never)

    expect(middlewareMocks.navigateTo).toHaveBeenCalledWith('/?unauthorized=admin')
    expect(result).toEqual({ path: '/?unauthorized=admin' })
  })

  it('allows authenticated admin users to proceed', async () => {
    middlewareMocks.useUserSession.mockReturnValue({
      loggedIn: { value: true },
    })
    middlewareMocks.useUserRole.mockReturnValue({
      isAdmin: { value: true },
    })

    const { default: middleware } = await import('../../app/middleware/admin')

    const to = { fullPath: '/admin/documents' }
    const result = middleware(to as never)

    expect(middlewareMocks.navigateTo).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })
})
