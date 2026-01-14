import { afterEach, beforeEach, vi } from 'vitest'

export function installNuxtRouteTestGlobals() {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
    vi.stubGlobal('createError', (input: { message: string }) =>
      Object.assign(new Error(input.message), input)
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })
}

export function createRouteEvent(overrides: Record<string, unknown> = {}) {
  const { context: contextOverride, headers: headersOverride, ...restOverrides } = overrides
  const overrideContext = (contextOverride as Record<string, unknown> | undefined) ?? {}
  const overrideHeaders = headersOverride

  return {
    context: {
      cloudflare: {
        env: {},
      },
      params: {},
      ...overrideContext,
    },
    headers:
      overrideHeaders instanceof Headers
        ? overrideHeaders
        : new Headers(
            Object.entries(
              (overrideHeaders as Record<string, string | undefined> | undefined) ?? {}
            ).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : []))
          ),
    ...restOverrides,
  }
}
