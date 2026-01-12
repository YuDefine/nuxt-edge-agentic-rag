export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()

  // Pages with auth: false are public
  if (to.meta.auth === false) return

  // Redirect to login if not authenticated, preserving the intended destination
  if (!loggedIn.value) {
    return navigateTo(`/auth/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
