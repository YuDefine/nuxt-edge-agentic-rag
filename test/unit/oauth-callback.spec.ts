import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B16 §9.2 — OAuth callback databaseHooks three-behaviour coverage.
 *
 * Targets the role-lifecycle hooks defined in `server/auth.config.ts`:
 *
 *   (a) New guest signup — `user.create.before` stamps `role='guest'`
 *       and `user.create.after` does NOT write an audit row (guest→guest
 *       is a no-op by design).
 *
 *   (b) Allowlist hit on signup — `user.create.before` stamps
 *       `role='admin'` and `user.create.after` writes a
 *       `guest → admin` audit row with `reason='allowlist-seed'`.
 *
 *   (c) Allowlist removed — `session.create.before` downgrades an
 *       existing admin whose email is no longer on the allowlist to
 *       `'member'` (NOT `'guest'`) and writes a `admin → member` audit
 *       row with `reason='allowlist-removed'`.
 *
 * The hooks resolve `hub:db` and `server/utils/member-role-changes`
 * lazily so the test can stub both before importing `auth.config.ts`.
 */

const mocks = vi.hoisted(() => ({
  recordRoleChange: vi.fn(),
  hubDbSelect: vi.fn(),
  hubDbUpdate: vi.fn(),
  hubDbInsertProfile: vi.fn(),
}))

// Stub the relative-path `recordRoleChange` import inside `auth.config.ts`
// (it cannot use the `#server` alias because jiti loads the config without
// resolving virtual aliases — see the comment at the top of
// `server/auth.config.ts`).
vi.mock('../../server/utils/member-role-changes', () => ({
  recordRoleChange: mocks.recordRoleChange,
  ROLE_CHANGE_SYSTEM_ACTOR: 'system',
  ROLE_CHANGE_DB_DIRECT_ACTOR: 'db-direct',
}))

// hub:db is imported dynamically at runtime inside the hook bodies. The
// mock returns minimal chainable builders that forward the fake select /
// update / insert calls to the captured `mocks.*` functions.
const schemaFake = {
  user: {
    id: { __col: 'id' },
    email: { __col: 'email' },
    role: { __col: 'role' },
  },
  userProfiles: {
    id: { __col: 'id' },
    emailNormalized: { __col: 'email_normalized' },
    roleSnapshot: { __col: 'role_snapshot' },
    adminSource: { __col: 'admin_source' },
  },
  memberRoleChanges: { __tbl: 'member_role_changes' },
}

function buildHubDb() {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => mocks.hubDbSelect(),
          }),
        }),
      }),
      update: () => ({
        set: (patch: { role: string }) => ({
          where: async () => {
            mocks.hubDbUpdate(patch)
          },
        }),
      }),
      insert: () => ({
        values: (row: unknown) => ({
          onConflictDoUpdate: async () => {
            mocks.hubDbInsertProfile(row)
          },
        }),
      }),
    },
    schema: schemaFake,
  }
}

vi.mock('hub:db', () => buildHubDb())

vi.mock('drizzle-orm', () => ({
  eq: () => ({ __op: 'eq' }),
}))

// `defineServerAuth` is a thin wrapper — keep the real implementation so
// the config exports a callable factory.

interface ConfigFactoryResult {
  databaseHooks: {
    user: {
      create: {
        before: (user: { email: string; id?: string }) => Promise<{ data: unknown }>
        after: (created: { email: string; id: string }) => Promise<void>
      }
    }
    session: {
      create: {
        before: (session: { userId: string }) => Promise<void>
      }
    }
  }
}

async function loadHooks(allowlistRaw: string): Promise<ConfigFactoryResult> {
  // Dynamic import so each test can reset mocks first.
  const mod = (await import('../../server/auth.config')) as {
    default: (ctx: {
      db: unknown
      runtimeConfig: { knowledge?: unknown; oauth?: unknown }
    }) => unknown
  }
  const config = mod.default({
    db: {},
    runtimeConfig: {
      knowledge: {
        adminEmailAllowlist: allowlistRaw,
        environment: 'production',
      },
      oauth: {},
    },
  }) as ConfigFactoryResult
  return config
}

describe('auth.config databaseHooks (B16 §9.2)', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.recordRoleChange.mockReset()
    mocks.hubDbSelect.mockReset()
    mocks.hubDbUpdate.mockReset()
    mocks.hubDbInsertProfile.mockReset()
    mocks.recordRoleChange.mockResolvedValue({ id: 'audit-1' })
  })

  describe('(a) new non-allowlist user → role=guest, no audit', () => {
    it('user.create.before stamps role="guest"', async () => {
      const { databaseHooks } = await loadHooks('admin@example.com')

      const result = await databaseHooks.user.create.before({
        email: 'stranger@example.com',
        id: 'new-1',
      })

      expect(result.data).toMatchObject({
        email: 'stranger@example.com',
        id: 'new-1',
        role: 'guest',
      })
    })

    it('user.create.after skips audit row for non-admin seed', async () => {
      const { databaseHooks } = await loadHooks('admin@example.com')

      await databaseHooks.user.create.after({
        email: 'stranger@example.com',
        id: 'new-1',
      })

      // Guest→Guest audit would be pure noise: the hook must not write it.
      expect(mocks.recordRoleChange).not.toHaveBeenCalled()
    })
  })

  describe('(b) allowlist hit → role=admin, audit reason=allowlist-seed', () => {
    it('user.create.before stamps role="admin"', async () => {
      const { databaseHooks } = await loadHooks('admin@example.com')

      const result = await databaseHooks.user.create.before({
        email: 'admin@example.com',
        id: 'admin-seed-1',
      })

      expect(result.data).toMatchObject({
        email: 'admin@example.com',
        id: 'admin-seed-1',
        role: 'admin',
      })
    })

    it('user.create.after writes guest→admin audit with reason=allowlist-seed', async () => {
      const { databaseHooks } = await loadHooks('admin@example.com')

      await databaseHooks.user.create.after({
        email: 'admin@example.com',
        id: 'admin-seed-1',
      })

      expect(mocks.recordRoleChange).toHaveBeenCalledTimes(1)
      expect(mocks.recordRoleChange).toHaveBeenCalledWith(
        expect.objectContaining({ db: expect.anything(), schema: expect.anything() }),
        expect.objectContaining({
          userId: 'admin-seed-1',
          fromRole: 'guest',
          toRole: 'admin',
          changedBy: 'system',
          reason: 'allowlist-seed',
        }),
      )
    })

    it('allowlist comparison is case-insensitive and trims whitespace', async () => {
      const { databaseHooks } = await loadHooks(' Admin@EXAMPLE.com ')

      const result = await databaseHooks.user.create.before({
        email: 'admin@example.com',
        id: 'admin-seed-2',
      })

      expect((result.data as { role: string }).role).toBe('admin')
    })
  })

  describe('(c) allowlist removed → downgrade admin to member, audit reason=allowlist-removed', () => {
    it('session.create.before downgrades admin to member and writes audit', async () => {
      const { databaseHooks } = await loadHooks('new-admin@example.com')

      // Existing user row: the email was previously on the allowlist and
      // the user was stamped 'admin', but the allowlist has since changed.
      mocks.hubDbSelect.mockResolvedValue([{ email: 'removed-admin@example.com', role: 'admin' }])

      await databaseHooks.session.create.before({ userId: 'removed-admin-1' })

      // Role downgrade was written to the user table.
      expect(mocks.hubDbUpdate).toHaveBeenCalledTimes(1)
      expect(mocks.hubDbUpdate).toHaveBeenCalledWith({ role: 'member' })

      // Audit row reflects admin→member (NOT admin→guest) per design.md:
      // demoting to Guest would strip privileges the user had on the way
      // up; we stop at Member instead.
      expect(mocks.recordRoleChange).toHaveBeenCalledTimes(1)
      expect(mocks.recordRoleChange).toHaveBeenCalledWith(
        expect.objectContaining({ db: expect.anything(), schema: expect.anything() }),
        expect.objectContaining({
          userId: 'removed-admin-1',
          fromRole: 'admin',
          toRole: 'member',
          changedBy: 'system',
          reason: 'allowlist-removed',
        }),
      )
    })

    it('session hook promotes to admin when allowlist matches but role has drifted', async () => {
      const { databaseHooks } = await loadHooks('promote-me@example.com')

      mocks.hubDbSelect.mockResolvedValue([{ email: 'promote-me@example.com', role: 'member' }])

      await databaseHooks.session.create.before({ userId: 'promote-me-1' })

      expect(mocks.hubDbUpdate).toHaveBeenCalledWith({ role: 'admin' })
      expect(mocks.recordRoleChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'promote-me-1',
          fromRole: 'member',
          toRole: 'admin',
          changedBy: 'system',
          reason: 'allowlist-seed',
        }),
      )
    })

    it('session hook is a no-op when role already matches allowlist membership', async () => {
      const { databaseHooks } = await loadHooks('still-admin@example.com')

      mocks.hubDbSelect.mockResolvedValue([{ email: 'still-admin@example.com', role: 'admin' }])

      await databaseHooks.session.create.before({ userId: 'still-admin-1' })

      expect(mocks.hubDbUpdate).not.toHaveBeenCalled()
      expect(mocks.recordRoleChange).not.toHaveBeenCalled()
    })

    it('session hook silently migrates legacy role="user" to "member" without audit', async () => {
      const { databaseHooks } = await loadHooks('new-admin@example.com')

      mocks.hubDbSelect.mockResolvedValue([{ email: 'legacy@example.com', role: 'user' }])

      await databaseHooks.session.create.before({ userId: 'legacy-1' })

      // Role column updated but no audit row — this mirrors the one-shot
      // UPDATE in migration 0006 for sessions that predate it.
      expect(mocks.hubDbUpdate).toHaveBeenCalledWith({ role: 'member' })
      expect(mocks.recordRoleChange).not.toHaveBeenCalled()
    })
  })
})
