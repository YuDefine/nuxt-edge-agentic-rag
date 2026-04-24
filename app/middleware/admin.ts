import { buildLoginRedirectUrl } from '~/utils/auth-return-to'

/**
 * Admin page guard middleware.
 *
 * Use this middleware on admin-only pages to improve UX:
 * - Redirects unauthenticated users to login with origin path preserved
 * - Redirects authenticated non-admin users to home with unauthorized feedback
 *
 * Usage in page component:
 * ```ts
 * definePageMeta({
 *   middleware: ['admin'],
 * })
 * ```
 *
 * ⚠️ This is a UX improvement only. Real authorization happens server-side.
 * The admin API endpoints verify admin access using runtime allowlist.
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  const { isAdmin } = useUserRole()

  if (!loggedIn.value) {
    const loginUrl = buildLoginRedirectUrl({ path: to.path, fullPath: to.fullPath })
    if (loginUrl === null) return
    return navigateTo(loginUrl)
  }

  if (!isAdmin.value) {
    // Show toast on client side instead of query param
    // NOTE: Unauthorized-branch UX improvement is tracked as a separate change
    // (`admin-unauthorized-feedback`) — out of scope for auth-redirect-refactor.
    return navigateTo('/')
  }
})
