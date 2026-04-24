import { LOGIN_PATH } from '~/utils/auth-return-to'

/**
 * Sign out and force a full page reload to `/auth/login`.
 *
 * Why a full reload (not `navigateTo`)? `useUserSession().signOut` clears
 * our local state but the nanostore atom backing `@onmax/nuxt-better-auth`
 * lags a tick. The global middleware bounce
 * (`loggedIn && path === /auth/login → /`) sees the stale atom during
 * that tick and sends the user back to the page they were on — with
 * `replace: true` this looks like "the button did nothing". A full reload
 * resets both the SPA state and the atom so middleware sees
 * `loggedIn=false` and renders the login UI cleanly.
 *
 * The `catch` branch covers the network-blip case: even if the server
 * sign-out throws, the local session atom has already been cleared, so
 * we still redirect to give the user the logged-out UI.
 */
export function useSignOutRedirect() {
  const { signOut } = useUserSession()

  function redirectToLogin(): void {
    if (import.meta.client) window.location.replace(LOGIN_PATH)
  }

  async function signOutAndRedirect(): Promise<void> {
    try {
      await signOut({
        onSuccess: () => {
          redirectToLogin()
        },
      })
    } catch {
      redirectToLogin()
    }
  }

  return { signOutAndRedirect }
}
