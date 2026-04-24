import { buildLoginRedirectUrl, LOGIN_PATH } from '~/utils/auth-return-to'

export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()

  // Bounce authenticated users off the login page so they don't see a
  // useless login UI (and cannot accidentally re-authenticate). The
  // `?redirect=` query is ignored on purpose — see design decision
  // "Login Route Is Independent And Publicly Accessible".
  if (loggedIn.value && to.path === LOGIN_PATH) {
    return navigateTo('/', { replace: true })
  }

  // Pages with auth: false are public
  if (to.meta.auth === false) return

  if (!loggedIn.value) {
    const loginUrl = buildLoginRedirectUrl({ path: to.path, fullPath: to.fullPath })
    if (loginUrl === null) return
    return navigateTo(loginUrl)
  }
})
