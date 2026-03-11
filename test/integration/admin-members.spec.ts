import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteEvent, installNuxtRouteTestGlobals } from './helpers/nuxt-route'

/**
 * B16 §9.3 — Admin members PATCH four-layer hard checks + happy path.
 *
 * Targets `server/api/admin/members/[userId].patch.ts`:
 *   (1) self-demote blocked
 *   (2) allowlist seed demotion blocked
 *   (3) non-allowlist promotion to admin blocked
 *   (4) happy path: guest → member, audit row written
 *
 * The handler queries the `user` table via the drizzle proxy returned by
 * `import('hub:db')`. We mock that module entirely so no D1 binding is
 * needed and the suite stays in the `integration` project (node env).
 */

const ADMIN_SESSION = {
  user: { id: 'admin-self', email: 'admin@example.com' },
}

const mocks = vi.hoisted(() => ({
  requireRuntimeAdminSession: vi.fn(),
  getValidatedRouterParams: vi.fn(),
  readValidatedBody: vi.fn(),
  recordRoleChange: vi.fn(),
  getKnowledgeRuntimeConfig: vi.fn(),
  selectRows: [] as Array<{ id: string; email: string; role: string | null }>,
  updateRuns: [] as Array<{ id: string; role: string }>,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    error: vi.fn(),
    set: vi.fn(),
  }),
}))

// Hub DB mock: chainable select + update + eq. Only the minimum the
// handler uses. `select` returns whatever `mocks.selectRows` is set to.
const schemaFake = {
  user: {
    id: { __col: 'id' },
    email: { __col: 'email' },
    role: { __col: 'role' },
  },
  memberRoleChanges: { __tbl: 'member_role_changes' },
}

function buildHubDb() {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => mocks.selectRows,
          }),
        }),
      }),
      update: () => ({
        set: (patch: { role: string }) => ({
          where: async () => {
            mocks.updateRuns.push({ id: 'written', role: patch.role })
          },
        }),
      }),
    },
    schema: schemaFake,
  }
}

vi.mock('hub:db', () => buildHubDb())

vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, _value: unknown) => ({ __op: 'eq' }),
}))

vi.mock('../../server/utils/admin-session', () => ({
  requireRuntimeAdminSession: mocks.requireRuntimeAdminSession,
}))

vi.mock('../../server/utils/member-role-changes', () => ({
  recordRoleChange: mocks.recordRoleChange,
  ROLE_CHANGE_SYSTEM_ACTOR: 'system',
  ROLE_CHANGE_DB_DIRECT_ACTOR: 'db-direct',
}))

vi.mock('../../server/utils/knowledge-runtime', () => ({
  getKnowledgeRuntimeConfig: mocks.getKnowledgeRuntimeConfig,
}))

// The handler imports `isAdminEmailAllowlisted` directly from the shared
// schema — we let the real implementation run so allowlist comparisons
// exercise the same code that production uses, but feed it the allowlist
// via getKnowledgeRuntimeConfig mock.

installNuxtRouteTestGlobals()

describe('PATCH /api/admin/members/[userId] (B16 §9.3)', () => {
  beforeEach(() => {
    mocks.requireRuntimeAdminSession.mockReset()
    mocks.getValidatedRouterParams.mockReset()
    mocks.readValidatedBody.mockReset()
    mocks.recordRoleChange.mockReset()
    mocks.getKnowledgeRuntimeConfig.mockReset()
    mocks.selectRows = []
    mocks.updateRuns = []

    vi.stubGlobal('requireRuntimeAdminSession', mocks.requireRuntimeAdminSession)
    vi.stubGlobal('getValidatedRouterParams', mocks.getValidatedRouterParams)
    vi.stubGlobal('readValidatedBody', mocks.readValidatedBody)

    mocks.requireRuntimeAdminSession.mockResolvedValue(ADMIN_SESSION)
    mocks.getKnowledgeRuntimeConfig.mockReturnValue({
      adminEmailAllowlist: ['admin@example.com', 'seed@example.com'],
    })
    mocks.recordRoleChange.mockResolvedValue({ id: 'audit-1' })
  })

  it('(1) self-demote from admin → member is blocked with actionable message', async () => {
    mocks.getValidatedRouterParams.mockResolvedValue({ userId: 'admin-self' })
    mocks.readValidatedBody.mockResolvedValue({ role: 'member' })
    mocks.selectRows = [{ id: 'admin-self', email: 'admin@example.com', role: 'admin' }]

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('不可降低自己的 Admin 權限'),
    })
    expect(mocks.recordRoleChange).not.toHaveBeenCalled()
    expect(mocks.updateRuns).toEqual([])
  })

  it('(2) allowlist-seed demotion is blocked, even by a different admin', async () => {
    mocks.getValidatedRouterParams.mockResolvedValue({ userId: 'seed-user' })
    mocks.readValidatedBody.mockResolvedValue({ role: 'member' })
    mocks.selectRows = [{ id: 'seed-user', email: 'seed@example.com', role: 'admin' }]

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('此使用者為 Admin seed'),
    })
    expect(mocks.recordRoleChange).not.toHaveBeenCalled()
    expect(mocks.updateRuns).toEqual([])
  })

  it('(3) promoting a non-allowlist user to admin is blocked', async () => {
    mocks.getValidatedRouterParams.mockResolvedValue({ userId: 'stranger-1' })
    mocks.readValidatedBody.mockResolvedValue({ role: 'admin' })
    mocks.selectRows = [{ id: 'stranger-1', email: 'stranger@example.com', role: 'member' }]

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining('Admin 權限僅由 ADMIN_EMAIL_ALLOWLIST env var 控制'),
    })
    expect(mocks.recordRoleChange).not.toHaveBeenCalled()
    expect(mocks.updateRuns).toEqual([])
  })

  it('(4) happy path: guest → member succeeds and writes audit row', async () => {
    mocks.getValidatedRouterParams.mockResolvedValue({ userId: 'guest-1' })
    mocks.readValidatedBody.mockResolvedValue({ role: 'member' })
    mocks.selectRows = [{ id: 'guest-1', email: 'guest@example.com', role: 'guest' }]

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')

    const result = (await handler(createRouteEvent())) as {
      data: {
        id: string
        role: string
        changed: boolean
        auditId: string
      }
    }

    expect(result.data).toMatchObject({
      id: 'guest-1',
      role: 'member',
      changed: true,
      auditId: 'audit-1',
    })
    expect(mocks.updateRuns).toHaveLength(1)
    expect(mocks.updateRuns[0]).toEqual({ id: 'written', role: 'member' })
    expect(mocks.recordRoleChange).toHaveBeenCalledTimes(1)
    expect(mocks.recordRoleChange).toHaveBeenCalledWith(
      expect.objectContaining({ db: expect.anything(), schema: expect.anything() }),
      expect.objectContaining({
        userId: 'guest-1',
        fromRole: 'guest',
        toRole: 'member',
        changedBy: 'admin-self',
        reason: 'admin-ui',
      })
    )
  })

  it('(4b) happy path: member → guest (legal demotion of non-allowlist user)', async () => {
    mocks.getValidatedRouterParams.mockResolvedValue({ userId: 'member-1' })
    mocks.readValidatedBody.mockResolvedValue({ role: 'guest' })
    mocks.selectRows = [{ id: 'member-1', email: 'member@example.com', role: 'member' }]

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')

    const result = (await handler(createRouteEvent())) as {
      data: { id: string; role: string; changed: boolean }
    }

    expect(result.data.role).toBe('guest')
    expect(result.data.changed).toBe(true)
    expect(mocks.recordRoleChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fromRole: 'member',
        toRole: 'guest',
        changedBy: 'admin-self',
      })
    )
  })

  it('no-op write (same role) returns changed=false and skips audit', async () => {
    mocks.getValidatedRouterParams.mockResolvedValue({ userId: 'member-1' })
    mocks.readValidatedBody.mockResolvedValue({ role: 'member' })
    mocks.selectRows = [{ id: 'member-1', email: 'member@example.com', role: 'member' }]

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')

    const result = (await handler(createRouteEvent())) as {
      data: { role: string; changed: boolean }
    }
    expect(result.data.role).toBe('member')
    expect(result.data.changed).toBe(false)
    expect(mocks.recordRoleChange).not.toHaveBeenCalled()
    expect(mocks.updateRuns).toEqual([])
  })

  it('404 when target user not found', async () => {
    mocks.getValidatedRouterParams.mockResolvedValue({ userId: 'missing' })
    mocks.readValidatedBody.mockResolvedValue({ role: 'member' })
    mocks.selectRows = []

    const { default: handler } = await import('../../server/api/admin/members/[userId].patch')

    await expect(handler(createRouteEvent())).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(mocks.recordRoleChange).not.toHaveBeenCalled()
  })
})
