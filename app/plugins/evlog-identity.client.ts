/**
 * T3 evlog adoption (adopt-evlog-nuxthub-ai-t3) — client identity sync.
 *
 * Watches `useUserSession()` from `@onmax/nuxt-better-auth` and mirrors
 * the resolved user id into evlog's client-side identity store via
 * `setIdentity` / `clearIdentity`. Every browser-emitted wide event
 * (transport.enabled path) then carries `actor.id` automatically without
 * each component reaching into the session composable.
 *
 * Why client-side: evlog client transport batches `log.info` / `log.warn`
 * /  `log.error` calls fired from Vue components or composables to the
 * server. Without a stamped identity, those events arrive anonymous and
 * can't be joined with server-side wide events for the same user.
 */
import { clearIdentity, setIdentity } from 'evlog/client'

export default defineNuxtPlugin(() => {
  const session = useUserSession()

  watch(
    () => session.user.value?.id,
    (userId) => {
      if (userId) {
        setIdentity({ userId })
      } else {
        clearIdentity()
      }
    },
    { immediate: true },
  )
})
