import { z } from 'zod'

import { assertNever } from '../utils/assert-never'

/**
 * Three-tier role model introduced by B16 (member-and-permission-management).
 *
 * - `admin`: Seeded exclusively from `ADMIN_EMAIL_ALLOWLIST` env var via the
 *   better-auth session hook. UI cannot promote or demote Admin.
 * - `member`: Full Web / MCP question-answering privileges. Promotion/demotion
 *   is performed by Admin through `/admin/members`.
 * - `guest`: Default role for any newly-registered Google OAuth user. Effective
 *   privileges are gated by the `guest_policy` system setting.
 *
 * **Invariant**: The only writer of `admin` is the OAuth hook comparing against
 * the env allowlist; all other transitions happen between `member` and `guest`.
 */
export const ROLE_VALUES = ['admin', 'member', 'guest'] as const

export type Role = (typeof ROLE_VALUES)[number]

export const roleSchema = z.enum(ROLE_VALUES)

/**
 * Normalise a raw role string (possibly legacy `'user'`, null, or an unknown
 * value from a stale session) into the canonical three-tier `Role`.
 *
 * - Canonical values (`'admin'` / `'member'` / `'guest'`) pass through.
 * - Legacy `'user'` maps to `'member'` per B16 Phase 0 backfill policy.
 * - Anything else (null, undefined, unknown string) falls back to `'guest'`
 *   (least privilege).
 *
 * Single source of truth for this transition — every code path that reads a
 * role out of the DB / session and needs to route it through the three-tier
 * gates MUST go through this helper so the legacy `'user'` mapping stays
 * consistent across handlers.
 */
export function normaliseRole(raw: string | null | undefined): Role {
  if (raw && (ROLE_VALUES as readonly string[]).includes(raw)) {
    return raw as Role
  }
  if (raw === 'user') return 'member'
  return 'guest'
}

/**
 * Single-dial policy that governs what a Guest can do once logged in.
 *
 * - `same_as_member`: Guest behaves identically to Member (default; lowest
 *   friction — designed for open-registration scenarios where the registration
 *   event itself is considered sufficient gating).
 * - `browse_only`: Guest may browse internal-scope documents but cannot submit
 *   questions through Web Chat or MCP `askKnowledge`.
 * - `no_access`: Guest is shown an "account pending review" surface and all
 *   feature routes / tools return 403 `ACCOUNT_PENDING`.
 *
 * The active value lives in D1 `system_settings('guest_policy')` and is
 * invalidated across Worker instances via a KV version stamp. See design.md
 * "Guest Policy 快取策略".
 */
export const GUEST_POLICY_VALUES = ['same_as_member', 'browse_only', 'no_access'] as const

export type GuestPolicy = (typeof GUEST_POLICY_VALUES)[number]

export const guestPolicySchema = z.enum(GUEST_POLICY_VALUES)

export const DEFAULT_GUEST_POLICY: GuestPolicy = 'same_as_member'

/**
 * Source of record for how an Admin was seeded. Used by `user_profiles` for
 * auxiliary reporting — the authoritative allowlist comparison still happens
 * at session hook time.
 *
 * - `allowlist`: Email was present in `ADMIN_EMAIL_ALLOWLIST` at seed time.
 * - `none`: Non-admin user (Member / Guest).
 */
export const ADMIN_SOURCE_VALUES = ['allowlist', 'none'] as const

export type AdminSource = (typeof ADMIN_SOURCE_VALUES)[number]

export const adminSourceSchema = z.enum(ADMIN_SOURCE_VALUES)

/**
 * Single source of truth for the human-readable Chinese label of a role.
 * Use this everywhere a UI surface renders a role name so the wording
 * stays consistent and a new enum value triggers a compile error here
 * first instead of silently rendering the raw enum string downstream.
 */
export function roleLabel(role: Role): string {
  switch (role) {
    case 'admin':
      return '管理員'
    case 'member':
      return '成員'
    case 'guest':
      return '訪客'
    default:
      return assertNever(role, 'roleLabel')
  }
}

/**
 * Example usage of exhaustive role / guest-policy handling:
 *
 * ```ts
 * import { assertNever } from '~/shared/utils/assert-never'
 *
 * function describeRole(role: Role): string {
 *   switch (role) {
 *     case 'admin': return '管理員'
 *     case 'member': return '成員'
 *     case 'guest': return '訪客'
 *     default: return assertNever(role, 'describeRole')
 *   }
 * }
 *
 * function guestCanAsk(policy: GuestPolicy): boolean {
 *   switch (policy) {
 *     case 'same_as_member': return true
 *     case 'browse_only':
 *     case 'no_access':
 *       return false
 *     default: return assertNever(policy, 'guestCanAsk')
 *   }
 * }
 * ```
 *
 * **NEVER** use `if (role === 'admin') ... else if (role === 'member') ...` —
 * adding a new enum value silently skips branches. The `switch + assertNever`
 * pattern makes the compiler enforce exhaustiveness. See
 * `.claude/rules/ux-completeness.md` Exhaustiveness Rule.
 */
