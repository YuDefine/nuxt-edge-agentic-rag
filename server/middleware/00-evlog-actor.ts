/**
 * T3 evlog adoption (adopt-evlog-nuxthub-ai-t3) — actor identity injector.
 *
 * Stamps `actor.id` onto every authed request's wide event so dashboards
 * and downstream queries can group by user without each handler having to
 * remember to call `log.set({ user })` themselves.
 *
 * Cheap path: we DO NOT call `auth.api.getSession()` here — that adds a
 * full session lookup to every request including unauthenticated public
 * endpoints. Instead, we look at the better-auth session cookie presence
 * + read the cached session from `event.context.session` if a downstream
 * middleware (e.g. `requireRole`) has already populated it. When neither
 * is true the wide event simply carries no actor (correct semantics).
 *
 * For per-handler explicit identity, `requireRole(event, 'member')`
 * already calls `log.set({ user: { id } })` in `chat.post.ts` etc. This
 * middleware is the wide net that catches every other authed code path.
 */
import { useLogger } from 'evlog'

export default defineEventHandler((event) => {
  // Skip non-API and internal routes — wide event filtering already
  // limits to `/api/**` via `nuxt.config.evlog.include`, but the cheap
  // early return keeps middleware overhead near zero for static asset
  // and SSR bootstrap requests.
  if (!event.path.startsWith('/api/')) return

  const session = (
    event.context as {
      session?: { user?: { id?: string | null } | null } | null
    }
  ).session

  const userId = session?.user?.id
  if (!userId) return

  try {
    const log = useLogger(event)
    log.set({ actor: { id: userId } })
  } catch {
    // useLogger throws when called outside the evlog request scope (e.g.
    // routes filtered out via nuxt.config.evlog.include). Silent skip —
    // this is the wide net, not the authoritative gate.
  }
})
