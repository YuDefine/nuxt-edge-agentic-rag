import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { requireInternalDebugAccess } from '#server/utils/debug-surface-guard'

/**
 * observability-and-debug §1.3 — debug surfaces are Admin + flag-gated.
 *
 *   production  + flag off            → 403
 *   production  + debugSurfaceEnabled → ok
 *   non-production (local / staging)  → ok (admin only)
 *   non-admin                         → 403 (via requireRuntimeAdminSession)
 *
 * The helper is the single entry point for every future debug API / page,
 * so the gate lives here rather than being re-implemented in each route.
 */

function stubRuntimeConfig(overrides: Record<string, unknown>) {
  vi.stubGlobal(
    'useRuntimeConfig',
    vi.fn(() => ({
      debugSurfaceEnabled: false,
      knowledge: { environment: 'local' },
      ...overrides,
    }))
  )
}

function stubRequireRuntimeAdminSession(result: unknown, reject = false) {
  vi.stubGlobal(
    'requireRuntimeAdminSession',
    reject
      ? vi.fn().mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403 }))
      : vi.fn().mockResolvedValue(result)
  )
}

function stubCreateError() {
  vi.stubGlobal(
    'createError',
    vi.fn((opts: { statusCode?: number; statusMessage?: string; message?: string }) => {
      const err = new Error(opts.message ?? opts.statusMessage ?? 'error')
      Object.assign(err, opts)
      return err
    })
  )
}

describe('requireInternalDebugAccess (§1.3 internal gating)', () => {
  const fakeEvent = { __fake: true } as unknown as Parameters<typeof requireInternalDebugAccess>[0]

  beforeEach(() => {
    stubCreateError()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('non-admin → rethrows 403 from requireRuntimeAdminSession', async () => {
    stubRuntimeConfig({ knowledge: { environment: 'local' }, debugSurfaceEnabled: false })
    stubRequireRuntimeAdminSession({}, true)

    await expect(requireInternalDebugAccess(fakeEvent)).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('admin + production + flag off → 403 even for admins', async () => {
    stubRuntimeConfig({
      knowledge: { environment: 'production' },
      debugSurfaceEnabled: false,
    })
    stubRequireRuntimeAdminSession({
      user: { email: 'admin@example.com', id: 'admin-1' },
    })

    await expect(requireInternalDebugAccess(fakeEvent)).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('admin + production + debugSurfaceEnabled=true → ok', async () => {
    stubRuntimeConfig({
      knowledge: { environment: 'production' },
      debugSurfaceEnabled: true,
    })
    stubRequireRuntimeAdminSession({
      user: { email: 'admin@example.com', id: 'admin-2' },
    })

    const result = await requireInternalDebugAccess(fakeEvent)

    expect(result).toEqual({
      userId: 'admin-2',
      environment: 'production',
      enabledByFlag: true,
    })
  })

  it('admin + staging environment → ok even without flag (non-prod is always open to admin)', async () => {
    stubRuntimeConfig({
      knowledge: { environment: 'staging' },
      debugSurfaceEnabled: false,
    })
    stubRequireRuntimeAdminSession({
      user: { email: 'admin@example.com', id: 'admin-3' },
    })

    const result = await requireInternalDebugAccess(fakeEvent)

    expect(result).toEqual({
      userId: 'admin-3',
      environment: 'staging',
      enabledByFlag: false,
    })
  })

  it('admin + local environment → ok', async () => {
    stubRuntimeConfig({
      knowledge: { environment: 'local' },
      debugSurfaceEnabled: false,
    })
    stubRequireRuntimeAdminSession({
      user: { email: 'admin@example.com', id: 'admin-4' },
    })

    const result = await requireInternalDebugAccess(fakeEvent)

    expect(result.environment).toBe('local')
    expect(result.userId).toBe('admin-4')
  })
})
