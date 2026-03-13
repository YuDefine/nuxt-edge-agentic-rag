import type { Role } from './auth'

/**
 * B16 shared row shape for the admin members list UI.
 *
 * Mirrored by the response of `GET /api/admin/members` (see
 * `server/api/admin/members/index.get.ts`). Kept in `shared/` so the
 * page component and the per-row action components type against a
 * single canonical `AdminMemberRow` instead of each declaring a local
 * structural interface that happens to diverge.
 */
export interface AdminMemberRow {
  id: string
  email: string | null
  name: string | null
  image?: string | null
  role: Role
  createdAt: string
  updatedAt: string
}
