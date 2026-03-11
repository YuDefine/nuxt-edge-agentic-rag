import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B16 §9.1 — role × guest_policy gating unit tests.
 *
 * Covers the full 3 × 3 matrix of `session.user.role` ∈ { admin, member,
 * guest } × `guest_policy` ∈ { same_as_member, browse_only, no_access }
 * for both `requireRole(event, 'admin')` and `requireRole(event, 'member')`.
 *
 * - Admin gate passes only when `role === 'admin'` regardless of policy.
 * - Member gate passes for Admin / Member always, and for Guest only when
 *   `guest_policy === 'same_as_member'`; other policies return 403 with
 *   the user-facing message defined in `require-role.ts`.
 */

const mocks = vi.hoisted(() => ({
  requireUserSession: vi.fn(),
  getGuestPolicy: vi.fn(),
  createError: vi.fn(),
}))

vi.mock('#server/utils/guest-policy', () => ({
  getGuestPolicy: mocks.getGuestPolicy,
}))

function installGlobals() {
  vi.stubGlobal('requireUserSession', mocks.requireUserSession)
  vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
    Object.assign(new Error(input.message), input)
  )
}

function fakeEvent() {
  return { context: { cloudflare: { env: {} } } } as unknown as Parameters<
    typeof requireUserSession
  >[0]
}

function mockSession(role: string | null) {
  mocks.requireUserSession.mockResolvedValue({
    user: { id: 'u-1', email: 'u-1@example.com', role },
  })
}

describe('requireRole (B16 §9.1)', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.requireUserSession.mockReset()
    mocks.getGuestPolicy.mockReset()
    installGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('admin gate', () => {
    it('passes when role === admin', async () => {
      mockSession('admin')
      const { requireRole } = await import('../../server/utils/require-role')
      const result = await requireRole(fakeEvent(), 'admin')
      expect(result.role).toBe('admin')
    })

    it('rejects member', async () => {
      mockSession('member')
      const { requireRole } = await import('../../server/utils/require-role')
      await expect(requireRole(fakeEvent(), 'admin')).rejects.toMatchObject({
        statusCode: 403,
        message: '需 Admin 權限',
      })
    })

    it('rejects guest', async () => {
      mockSession('guest')
      const { requireRole } = await import('../../server/utils/require-role')
      await expect(requireRole(fakeEvent(), 'admin')).rejects.toMatchObject({
        statusCode: 403,
        message: '需 Admin 權限',
      })
    })

    it('admin gate never consults guest_policy (perf)', async () => {
      mockSession('admin')
      const { requireRole } = await import('../../server/utils/require-role')
      await requireRole(fakeEvent(), 'admin')
      expect(mocks.getGuestPolicy).not.toHaveBeenCalled()
    })
  })

  describe('member gate — admin passes under every policy', () => {
    it.each(['same_as_member', 'browse_only', 'no_access'] as const)(
      'admin × %s → PASS without consulting policy',
      async (policy) => {
        mockSession('admin')
        mocks.getGuestPolicy.mockResolvedValue(policy)
        const { requireRole } = await import('../../server/utils/require-role')
        const result = await requireRole(fakeEvent(), 'member')
        expect(result.role).toBe('admin')
        // Admin / Member short-circuit before calling getGuestPolicy —
        // this keeps the chat hot-path from paying the KV read.
        expect(mocks.getGuestPolicy).not.toHaveBeenCalled()
      }
    )
  })

  describe('member gate — member passes under every policy', () => {
    it.each(['same_as_member', 'browse_only', 'no_access'] as const)(
      'member × %s → PASS without consulting policy',
      async (policy) => {
        mockSession('member')
        mocks.getGuestPolicy.mockResolvedValue(policy)
        const { requireRole } = await import('../../server/utils/require-role')
        const result = await requireRole(fakeEvent(), 'member')
        expect(result.role).toBe('member')
        expect(mocks.getGuestPolicy).not.toHaveBeenCalled()
      }
    )
  })

  describe('member gate — guest × guest_policy', () => {
    it('guest × same_as_member → PASS, policy returned in result', async () => {
      mockSession('guest')
      mocks.getGuestPolicy.mockResolvedValue('same_as_member')
      const { requireRole } = await import('../../server/utils/require-role')
      const result = await requireRole(fakeEvent(), 'member')
      expect(result.role).toBe('guest')
      expect(result.policy).toBe('same_as_member')
      expect(mocks.getGuestPolicy).toHaveBeenCalledTimes(1)
    })

    it('guest × browse_only → 403 "訪客僅可瀏覽"', async () => {
      mockSession('guest')
      mocks.getGuestPolicy.mockResolvedValue('browse_only')
      const { requireRole } = await import('../../server/utils/require-role')
      await expect(requireRole(fakeEvent(), 'member')).rejects.toMatchObject({
        statusCode: 403,
        message: '訪客僅可瀏覽，無法提問',
      })
    })

    it('guest × no_access → 403 "帳號待管理員審核"', async () => {
      mockSession('guest')
      mocks.getGuestPolicy.mockResolvedValue('no_access')
      const { requireRole } = await import('../../server/utils/require-role')
      await expect(requireRole(fakeEvent(), 'member')).rejects.toMatchObject({
        statusCode: 403,
        message: '帳號待管理員審核',
      })
    })
  })

  describe('legacy role normalisation', () => {
    it("legacy role='user' is treated as member under member gate", async () => {
      mockSession('user')
      const { requireRole } = await import('../../server/utils/require-role')
      const result = await requireRole(fakeEvent(), 'member')
      expect(result.role).toBe('member')
      expect(mocks.getGuestPolicy).not.toHaveBeenCalled()
    })

    it('missing role defaults to guest (least privilege) under admin gate', async () => {
      mockSession(null)
      const { requireRole } = await import('../../server/utils/require-role')
      await expect(requireRole(fakeEvent(), 'admin')).rejects.toMatchObject({
        statusCode: 403,
      })
    })

    it('missing role defaults to guest under member gate, guest_policy consulted', async () => {
      mockSession(null)
      mocks.getGuestPolicy.mockResolvedValue('browse_only')
      const { requireRole } = await import('../../server/utils/require-role')
      await expect(requireRole(fakeEvent(), 'member')).rejects.toMatchObject({
        statusCode: 403,
        message: '訪客僅可瀏覽，無法提問',
      })
    })
  })
})
