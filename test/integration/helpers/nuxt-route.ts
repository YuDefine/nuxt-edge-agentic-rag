import type { EventHandlerRequest, H3Event } from 'h3'

import { afterEach, beforeEach, vi } from 'vitest'

export function installNuxtRouteTestGlobals() {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
    vi.stubGlobal('defineMcpTool', <T>(definition: T) => definition)
    vi.stubGlobal('createError', (input: { message: string }) =>
      Object.assign(new Error(input.message), input)
    )
    vi.stubGlobal(
      'setResponseHeader',
      (_event: unknown, _name: string, _value: string | number | null) => {
        // no-op in unit tests; integration tests that care about headers can
        // override this stub.
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })
}

export function createRouteEvent(
  overrides: Record<string, unknown> = {}
): H3Event<EventHandlerRequest> {
  const { context: contextOverride, headers: headersOverride, ...restOverrides } = overrides
  const overrideContext = (contextOverride as Record<string, unknown> | undefined) ?? {}
  const overrideHeaders = headersOverride
  const headerEntries = Object.entries(
    (overrideHeaders as Record<string, string | undefined> | undefined) ?? {}
  ).reduce<Array<[string, string]>>((entries, [key, value]) => {
    if (typeof value === 'string') {
      entries.push([key, value])
    }
    return entries
  }, [])

  return {
    context: {
      cloudflare: {
        env: {},
      },
      params: {},
      ...overrideContext,
    },
    headers: overrideHeaders instanceof Headers ? overrideHeaders : new Headers(headerEntries),
    ...restOverrides,
  } as unknown as H3Event<EventHandlerRequest>
}
