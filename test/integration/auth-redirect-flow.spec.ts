import type { RouteLocationNormalized } from 'vue-router'

import { beforeEach, describe, expect, it, vi } from 'vitest'

type HandlerFn = (to: Partial<RouteLocationNormalized>) => unknown

interface MiddlewareModule {
  default: HandlerFn
}

const loggedInRef = { value: false }
const navigateToSpy = vi.fn()
const isAdminRef = { value: false }

function setGlobals(): void {
  vi.stubGlobal('defineNuxtRouteMiddleware', <T>(handler: T) => handler)
  vi.stubGlobal('useUserSession', () => ({ loggedIn: loggedInRef }))
  vi.stubGlobal('useUserRole', () => ({ isAdmin: isAdminRef }))
  vi.stubGlobal('navigateTo', navigateToSpy)
}

function makeRoute(path: string, fullPath?: string): Partial<RouteLocationNormalized> {
  return {
    path,
    fullPath: fullPath ?? path,
    meta: {},
  } as Partial<RouteLocationNormalized>
}

async function importAuthMiddleware(): Promise<HandlerFn> {
  const mod = (await import('../../app/middleware/auth.global')) as unknown as MiddlewareModule
  return mod.default
}

async function importAdminMiddleware(): Promise<HandlerFn> {
  const mod = (await import('../../app/middleware/admin')) as unknown as MiddlewareModule
  return mod.default
}

describe('auth.global middleware — Global Auth Middleware Captures Origin Path', () => {
  beforeEach(() => {
    vi.resetModules()
    navigateToSpy.mockReset()
    loggedInRef.value = false
    isAdminRef.value = false
    setGlobals()
  })

  it('redirects unauthenticated /admin/documents to /auth/login with encoded redirect', async () => {
    const handler = await importAuthMiddleware()
    handler(makeRoute('/admin/documents'))

    expect(navigateToSpy).toHaveBeenCalledOnce()
    expect(navigateToSpy).toHaveBeenCalledWith('/auth/login?redirect=%2Fadmin%2Fdocuments')
  })

  it('redirects unauthenticated root / to /auth/login without redirect qs', async () => {
    const handler = await importAuthMiddleware()
    handler(makeRoute('/'))

    expect(navigateToSpy).toHaveBeenCalledOnce()
    expect(navigateToSpy).toHaveBeenCalledWith('/auth/login')
  })

  it('does not redirect when the user is already on /auth/login (no loop)', async () => {
    const handler = await importAuthMiddleware()
    handler(makeRoute('/auth/login'))

    expect(navigateToSpy).not.toHaveBeenCalled()
  })

  it('does not intercept pages with auth: false', async () => {
    const handler = await importAuthMiddleware()
    const to = makeRoute('/auth/mcp/authorize', '/auth/mcp/authorize?client_id=x') as {
      meta: { auth?: boolean }
    } & Partial<RouteLocationNormalized>
    to.meta = { auth: false }
    handler(to)

    expect(navigateToSpy).not.toHaveBeenCalled()
  })

  it('does not redirect when the user is already authenticated', async () => {
    loggedInRef.value = true
    const handler = await importAuthMiddleware()
    handler(makeRoute('/admin/documents'))

    expect(navigateToSpy).not.toHaveBeenCalled()
  })

  it('encodes query strings in the redirect value (Middleware Redirect URL Composition)', async () => {
    const handler = await importAuthMiddleware()
    handler(makeRoute('/admin/usage', '/admin/usage?filter=x'))

    expect(navigateToSpy).toHaveBeenCalledWith('/auth/login?redirect=%2Fadmin%2Fusage%3Ffilter%3Dx')
  })
})

describe('admin middleware — Admin Middleware Unauthenticated Branch Mirrors Global Behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    navigateToSpy.mockReset()
    loggedInRef.value = false
    isAdminRef.value = false
    setGlobals()
  })

  it('redirects unauthenticated users with encoded redirect (aligns with auth.global)', async () => {
    const handler = await importAdminMiddleware()
    handler(makeRoute('/admin/documents'))

    expect(navigateToSpy).toHaveBeenCalledOnce()
    expect(navigateToSpy).toHaveBeenCalledWith('/auth/login?redirect=%2Fadmin%2Fdocuments')
  })

  it('keeps the unauthorized branch unchanged (Non-Goal): redirects non-admin to /', async () => {
    loggedInRef.value = true
    isAdminRef.value = false
    const handler = await importAdminMiddleware()
    handler(makeRoute('/admin/documents'))

    expect(navigateToSpy).toHaveBeenCalledOnce()
    expect(navigateToSpy).toHaveBeenCalledWith('/')
  })

  it('does nothing when the user is authenticated and an admin', async () => {
    loggedInRef.value = true
    isAdminRef.value = true
    const handler = await importAdminMiddleware()
    handler(makeRoute('/admin/documents'))

    expect(navigateToSpy).not.toHaveBeenCalled()
  })
})
