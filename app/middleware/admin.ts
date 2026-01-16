/**
 * Admin page guard middleware.
 *
 * Use this middleware on admin-only pages to improve UX:
 * - Redirects unauthenticated users to login
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
    return navigateTo(`/auth/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }

  if (!isAdmin.value) {
    return navigateTo('/?unauthorized=admin')
  }
})
