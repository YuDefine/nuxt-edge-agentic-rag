import { deriveAllowedAccessLevels } from '#shared/schemas/knowledge-runtime'
import { ROLE_VALUES, type Role } from '#shared/types/auth'

/**
 * Client-side role composable for UI context only.
 *
 * ⚠️ IMPORTANT: This composable provides role information for **UI hints and display purposes only**.
 * The values returned here are derived from the session's persisted role snapshot, which may become
 * stale if the runtime admin allowlist changes.
 *
 * **Never use these values for actual authorization decisions.** Real authorization happens
 * server-side where:
 * - Admin privileges are verified against `session.user.role === 'admin'` (seeded from
 *   `ADMIN_EMAIL_ALLOWLIST` by the better-auth OAuth hook, see B16)
 * - Each Member/Guest-gated request additionally consults `guest_policy`
 *   (see `server/utils/guest-policy.ts` — added in B16 Phase 2)
 *
 * Valid use cases for this composable:
 * - Displaying role badges or labels in the UI
 * - Conditionally showing/hiding UI elements (navigation, buttons)
 * - Filtering client-side data for display purposes
 *
 * Invalid use cases (use server-side checks instead):
 * - Protecting routes or API endpoints
 * - Making authorization decisions
 * - Gating access to sensitive operations
 *
 * @see `server/utils/admin-session.ts` for server-side admin gating
 * @see `shared/types/auth.ts` for the canonical `Role` enum
 * @see B16 `member-and-permission-management` change for the three-tier model
 */
export function useUserRole() {
  const { loggedIn, user } = useUserSession()

  function normalizeRole(value: string | null | undefined): Role {
    if (value && (ROLE_VALUES as readonly string[]).includes(value)) {
      return value as Role
    }
    // Legacy sessions from v0.x stored `role='user'` — treat as 'member' per
    // B16 Phase 0 backfill policy (existing authenticated users map to Member).
    // Unrecognised or missing values fall back to 'guest' (least privilege).
    if (value === 'user') return 'member'
    return 'guest'
  }

  /**
   * Client-side role derived from session snapshot.
   * ⚠️ For UI display only — do not use for authorization.
   */
  const role = computed<Role>(() => {
    const currentUser = user.value as { role?: string | null } | null
    return normalizeRole(currentUser?.role)
  })

  /**
   * Whether the current session appears to have admin role.
   * ⚠️ For UI display only — real admin checks happen server-side against
   * `session.user.role === 'admin'` (written by the better-auth allowlist hook).
   */
  const isAdmin = computed(() => role.value === 'admin')

  /**
   * Whether the current session appears to have member role. Useful for
   * conditionally rendering Member-and-above UI affordances (e.g. Chat input).
   * ⚠️ For UI display only.
   */
  const isMember = computed(() => role.value === 'member')

  /**
   * Whether the current session appears to have guest role. UI surfaces that
   * must respect `guest_policy` should additionally consult the server-side
   * policy value (B16 Phase 4 `GuestAccessGate.vue`).
   * ⚠️ For UI display only.
   */
  const isGuest = computed(() => role.value === 'guest')

  /**
   * Client-side access levels for UI filtering.
   * ⚠️ For client-side UI filtering only (e.g., hiding restricted content in lists).
   * Server-side retrieval and authorization use their own `getAllowedAccessLevels()` call.
   */
  const allowedAccessLevels = computed(() =>
    deriveAllowedAccessLevels({
      channel: 'web',
      isAdmin: isAdmin.value,
      isAuthenticated: loggedIn.value,
    })
  )

  /**
   * Check if user appears to have a specific role.
   * ⚠️ For UI display only — do not use for authorization.
   */
  function hasRole(targetRole: Role): boolean {
    return role.value === targetRole
  }

  return { role, isAdmin, isMember, isGuest, allowedAccessLevels, hasRole }
}
