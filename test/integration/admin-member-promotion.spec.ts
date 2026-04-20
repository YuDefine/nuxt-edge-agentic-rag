import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * passkey-authentication §14.4 — PATCH /api/admin/members/:userId
 * promotion matrix.
 *
 * Four paths:
 *
 *   (A) passkey-only (email NULL) → member  ✓
 *   (B) passkey-only (email NULL) → admin   ✗ (explicit §14.1 message)
 *   (C) google user (email present, not allowlisted) → admin ✗
 *   (D) google user (email present, allowlisted)     → admin ✓
 *
 * Plus §14.3: unknown fields in body (e.g. displayName) must 400 via
 * `.strict()`.
 */

const ADMIN_SESSION = {
  user: { id: 'admin-self', email: 'admin@example.com' },
}

const mocks = vi.hoisted(() => ({
  requireRuntimeAdminSession: vi.fn(),
  getValidatedRouterParams: vi.fn(),
  readValidatedBody: vi.fn(),
  targetRow: null as Record<string, unknown> | null,
  updateCalled: false,
  auditCalled: false,
  auditArgs: null as unknown,
  runtimeAllowlist: [] as string[],
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ error: vi.fn(), set: vi.fn() }),
}))

vi.mock('hub:db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.targetRow ? [mocks.targetRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          mocks.updateCalled = true
          return Promise.resolve()
        },
      }),
    }),
  },
  schema: {
    user: {
      id: { __col: 'id' },
      email: { __col: 'email' },
      role: { __col: 'role' },
    },
    memberRoleChanges: { __col: 'memberRoleChanges' },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, value: unknown) => ({ __eq: [col, value] }),
}))

vi.mock('../../server/utils/admin-session', () => ({
  requireRuntimeAdminSession: mocks.requireRuntimeAdminSession,
}))

vi.mock('../../server/utils/knowledge-runtime', () => ({
  getKnowledgeRuntimeConfig: () => ({ adminEmailAllowlist: mocks.runtimeAllowlist }),
}))

vi.mock('../../server/utils/member-role-changes', () => ({
  recordRoleChange: vi.fn((_db: unknown, args: unknown) => {
    mocks.auditCalled = true
    mocks.auditArgs = args
    return Promise.resolve({ id: 'audit-1' })
  }),
  ROLE_CHANGE_SYSTEM_ACTOR: 'system',
}))

installNuxtRouteTestGlobals()

describe('PATCH /api/admin/members/:userId — promotion matrix', () => {
  beforeEach(() => {
    mocks.requireRuntimeAdminSession.mockReset()
    mocks.getValidatedRouterParams.mockReset()
    mocks.readValidatedBody.mockReset()
    mocks.targetRow = null
    mocks.updateCalled = false
    mocks.auditCalled = false
    mocks.auditArgs = null
    mocks.runtimeAllowlist = []

    vi.stubGlobal('requireRuntimeAdminSession', mocks.requireRuntimeAdminSession)
    vi.stubGlobal('getValidatedRouterParams', mocks.getValidatedRouterParams)
    vi.stubGlobal('readValidatedBody', mocks.readValidatedBody)
    mocks.requireRuntimeAdminSession.mockResolvedValue(ADMIN_SESSION)
    mocks.getValidatedRouterParams.mockResolvedValue({ userId: 'target-1' })
  })

  it('(A) passkey-only user → member: allowed, audit written', async () => {
    mocks.targetRow = { id: 'target-1', email: null, role: 'guest' }
    mocks.readValidatedBody.mockResolvedValue({ role: 'member' })

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')
    const result = (await handler(createRouteEvent())) as {
      data: { role: string; changed: boolean }
    }

    expect(result.data.role).toBe('member')
    expect(result.data.changed).toBe(true)
    expect(mocks.updateCalled).toBe(true)
    expect(mocks.auditCalled).toBe(true)
    expect((mocks.auditArgs as { toRole: string }).toRole).toBe('member')
  })

  it('(B) passkey-only user → admin: 403 with "沒有 email" message', async () => {
    mocks.targetRow = { id: 'target-1', email: null, role: 'guest' }
    mocks.readValidatedBody.mockResolvedValue({ role: 'admin' })

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')
    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('沒有 email'),
    })
    expect(mocks.updateCalled).toBe(false)
    expect(mocks.auditCalled).toBe(false)
  })

  it('(C) google user (not allowlisted) → admin: 403 (generic allowlist message)', async () => {
    mocks.targetRow = { id: 'target-1', email: 'alice@example.com', role: 'guest' }
    mocks.runtimeAllowlist = ['boss@example.com']
    mocks.readValidatedBody.mockResolvedValue({ role: 'admin' })

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')
    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('ADMIN_EMAIL_ALLOWLIST'),
    })
    expect(mocks.updateCalled).toBe(false)
  })

  it('(D) google user (allowlisted) → admin: allowed (no-op when already admin)', async () => {
    mocks.targetRow = { id: 'target-1', email: 'boss@example.com', role: 'admin' }
    mocks.runtimeAllowlist = ['boss@example.com']
    mocks.readValidatedBody.mockResolvedValue({ role: 'admin' })

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')
    const result = (await handler(createRouteEvent())) as {
      data: { role: string; changed: boolean }
    }

    expect(result.data.role).toBe('admin')
    // No-op: current == target, no update / audit write.
    expect(result.data.changed).toBe(false)
    expect(mocks.updateCalled).toBe(false)
  })

  it('(D) google user (allowlisted) member → admin: transitions succeed', async () => {
    mocks.targetRow = { id: 'target-1', email: 'boss@example.com', role: 'member' }
    mocks.runtimeAllowlist = ['boss@example.com']
    mocks.readValidatedBody.mockResolvedValue({ role: 'admin' })

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')
    const result = (await handler(createRouteEvent())) as {
      data: { role: string; changed: boolean }
    }

    expect(result.data.role).toBe('admin')
    expect(result.data.changed).toBe(true)
    expect(mocks.updateCalled).toBe(true)
  })
})
