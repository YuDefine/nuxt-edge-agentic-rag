import { assertNever } from '#shared/utils/assert-never'
import { normaliseRole, type GuestPolicy, type Role } from '#shared/types/auth'

import { getGuestPolicy } from '#server/utils/guest-policy'

/**
 * B16 member-and-permission-management: server-side role gate.
 *
 * Authoritative authorisation helper — reads `session.user.role` (written
 * by the better-auth OAuth hook in `server/auth.config.ts` based on
 * `ADMIN_EMAIL_ALLOWLIST`) and, when the gate is Member-level, cross-checks
 * `guest_policy` so a Guest with `same_as_member` policy is accepted.
 *
 * **Design reference**: openspec/changes/member-and-permission-management/
 * design.md "權限檢查的 server helper 設計".
 *
 * **Q2 = A**: allowlist is no longer consulted on every request. The
 * session is the single source of truth; `requireRuntimeAdminSession`
 * delegates here (Phase 2 migration).
 */

/**
 * The runtime event accepted by `requireUserSession`. Using the same
 * `Parameters<typeof requireUserSession>[0]` indirection that
 * `admin-session.ts` already uses keeps us aligned with whatever H3 /
 * nuxt-better-auth promote in the future.
 */
type EventLike = Parameters<typeof requireUserSession>[0]

/**
 * Loose session view — we only read `user.id`, `user.email`, `user.role`.
 * Typed via `unknown` cast at the call site (not a structural interface)
 * so the better-auth `AuthUser` inferred type can flow through without
 * index-signature collisions.
 */
export interface SessionWithRole {
  user: {
    id?: string | null
    email?: string | null
    role?: string | null
  }
}

export type RequiredRole = 'admin' | 'member'

function forbidden(message: string): never {
  throw createError({ statusCode: 403, statusMessage: 'Forbidden', message })
}

/**
 * Resolve whether a Guest is allowed to act at Member level under the
 * current `guest_policy`. Exhaustively switched so adding a new policy
 * value forces a compile error here before the check silently lets
 * traffic through.
 */
function guestIsMemberEquivalent(policy: GuestPolicy): boolean {
  switch (policy) {
    case 'same_as_member':
      return true
    case 'browse_only':
    case 'no_access':
      return false
    default:
      return assertNever(policy, 'guestIsMemberEquivalent')
  }
}

/**
 * Map Guest policy states to the 403 message the Web / MCP layer should
 * surface. Centralised here so the UI and MCP middleware don't diverge
 * on wording.
 */
function guestDenialMessage(policy: GuestPolicy): string {
  switch (policy) {
    case 'same_as_member':
      // same_as_member should never produce a denial message; kept for
      // exhaustiveness. If this ever fires, something called
      // `guestDenialMessage` before confirming `guestIsMemberEquivalent`
      // was false — treat as bug.
      return '訪客權限狀態異常，請稍後再試'
    case 'browse_only':
      return '訪客僅可瀏覽，無法提問'
    case 'no_access':
      return '帳號待管理員審核'
    default:
      return assertNever(policy, 'guestDenialMessage')
  }
}

/**
 * The full session shape returned by `requireUserSession` (resolved via
 * `Awaited<ReturnType<...>>`). Callers that previously called
 * `requireUserSession` a second time to recover the narrow `AuthUser` type
 * should read `fullSession` from `RequireRoleResult` instead.
 */
export type FullUserSession = Awaited<ReturnType<typeof requireUserSession>>

export interface RequireRoleResult {
  role: Role
  /**
   * Active `guest_policy` at the moment of this check. Present only when
   * the caller asked for `'member'` and the user is a Guest; callers
   * that need the policy for their own branching (e.g. a Chat handler
   * that returns both answer + banner state) can read it here instead
   * of calling `getGuestPolicy()` again.
   */
  policy?: GuestPolicy
  /**
   * Structurally-typed view used for role-checking logic inside this
   * helper. Prefer `fullSession` at call sites that need the richer
   * better-auth `AuthUser` fields (e.g. `user.id` as a non-nullable
   * string for downstream stores).
   */
  session: SessionWithRole
  /**
   * Full better-auth session, i.e. the exact object `requireUserSession`
   * would return. Exposed so handlers don't have to re-invoke
   * `requireUserSession(event)` just to widen the narrow `SessionWithRole`
   * type — each `requireUserSession` call goes through
   * `auth.api.getSession(headers)` again (no caching), so avoiding the
   * duplicate call saves one session parse per request.
   */
  fullSession: FullUserSession
}

/**
 * Primary entry point.
 *
 * - `requireRole(event, 'admin')` → passes iff `session.user.role === 'admin'`.
 *   Non-admins get 403 with "需 Admin 權限".
 * - `requireRole(event, 'member')` → passes if the role is `'admin'` or
 *   `'member'`, OR the role is `'guest'` and the active `guest_policy` is
 *   `same_as_member`. Other Guests get 403 with the policy-specific
 *   message produced by `guestDenialMessage`.
 *
 * Returns the resolved session + role so callers can log / branch without
 * re-reading the session.
 */
export async function requireRole(
  event: EventLike,
  role: RequiredRole
): Promise<RequireRoleResult> {
  const fullSession = await requireUserSession(event)
  // Narrow via `unknown` — `AuthUser` and `SessionWithRole.user` differ
  // only by extra nominal fields we don't read here.
  const session = fullSession as unknown as SessionWithRole
  const effectiveRole = normaliseRole(session.user?.role ?? null)

  switch (role) {
    case 'admin': {
      if (effectiveRole !== 'admin') {
        forbidden('需 Admin 權限')
      }
      return { role: effectiveRole, session, fullSession }
    }
    case 'member': {
      if (effectiveRole === 'admin' || effectiveRole === 'member') {
        return { role: effectiveRole, session, fullSession }
      }
      // Guest branch.
      const policy = await getGuestPolicy(event)
      if (!guestIsMemberEquivalent(policy)) {
        forbidden(guestDenialMessage(policy))
      }
      return { role: effectiveRole, session, policy, fullSession }
    }
    default:
      return assertNever(role, 'requireRole')
  }
}
