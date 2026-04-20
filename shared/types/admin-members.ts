import type { Role } from './auth'

/**
 * passkey-authentication §13.1 — Credential type enum.
 *
 * Drives the credential badge list rendered in `/admin/members`. The
 * enum is closed and case-sensitive; the SELECT in
 * `server/api/admin/members/index.get.ts` converts presence checks on
 * `account` (providerId = 'google') and `passkey` into this literal
 * union.
 */
export const CREDENTIAL_TYPE_VALUES = ['google', 'passkey'] as const

export type CredentialType = (typeof CREDENTIAL_TYPE_VALUES)[number]

/**
 * B16 shared row shape for the admin members list UI.
 *
 * Mirrored by the response of `GET /api/admin/members` (see
 * `server/api/admin/members/index.get.ts`). Kept in `shared/` so the
 * page component and the per-row action components type against a
 * single canonical `AdminMemberRow` instead of each declaring a local
 * structural interface that happens to diverge.
 *
 * passkey-authentication §13 additions:
 *   - `displayName`: primary identifier in the member list header now
 *     that email can be NULL for passkey-first users.
 *   - `credentialTypes`: closed enum list of {google, passkey}. Empty
 *     array means the user has an active better-auth `user` row but
 *     no linked credential rows yet (edge case: mid-registration).
 *   - `registeredAt` / `lastActivityAt`: separate from `createdAt` /
 *     `updatedAt` so the page can render a "last seen" column
 *     without confusing it with audit-column timestamps on the
 *     `user` row itself.
 */
export interface AdminMemberRow {
  id: string
  email: string | null
  name: string | null
  displayName: string | null
  image?: string | null
  role: Role
  credentialTypes: CredentialType[]
  registeredAt: string | null
  lastActivityAt: string | null
  createdAt: string
  updatedAt: string
}
