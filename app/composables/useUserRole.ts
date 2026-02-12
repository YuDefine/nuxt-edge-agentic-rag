import { deriveAllowedAccessLevels } from '#shared/schemas/knowledge-runtime'

/**
 * Client-side role composable for UI context only.
 *
 * ⚠️ IMPORTANT: This composable provides role information for **UI hints and display purposes only**.
 * The values returned here are derived from the session's persisted role snapshot, which may become
 * stale if the runtime admin allowlist changes.
 *
 * **Never use these values for actual authorization decisions.** Real authorization happens
 * server-side where:
 * - Admin privileges are verified against the runtime `ADMIN_EMAIL_ALLOWLIST`
 * - Each admin-only request re-evaluates the current session email against the allowlist
 * - `getAllowedAccessLevels()` is called with fresh session data
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
 * @see `server/utils/auth.ts` for server-side authorization utilities
 * @see `Runtime Admin Allowlist` spec for the authoritative role determination logic
 */
export function useUserRole() {
  const { loggedIn, user } = useUserSession()

  /**
   * Client-side role derived from session snapshot.
   * ⚠️ For UI display only — do not use for authorization.
   */
  const role = computed(() => {
    const currentUser = user.value as { role?: string | null } | null

    return currentUser?.role === 'admin' ? 'admin' : 'user'
  })

  /**
   * Whether the current session appears to have admin role.
   * ⚠️ For UI display only — real admin checks happen server-side against runtime allowlist.
   */
  const isAdmin = computed(() => role.value === 'admin')

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
  function hasRole(targetRole: string): boolean {
    return role.value === targetRole
  }

  return { role, isAdmin, allowedAccessLevels, hasRole }
}
