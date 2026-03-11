/**
 * Server-side admin gate.
 *
 * **B16 Phase 2 migration (Q2 = A)**: this used to re-evaluate
 * `ADMIN_EMAIL_ALLOWLIST` against `session.user.email` on every admin
 * request. Under the three-tier model, `session.user.role` is the single
 * source of truth (written by the better-auth hook in `auth.config.ts`
 * after comparing against the same allowlist at session-create time).
 *
 * The function name and signature are preserved so every one of the ~20
 * existing call sites migrates transparently — callers that previously
 * received `{ user: { id, email } }` still receive the same shape.
 *
 * **Allowlist fallback**: if the session snapshot is missing `role`
 * entirely (unlikely outside the very first request after a fresh
 * deploy, or a session predating migration 0002), we fall back to the
 * allowlist-based check so admins are never locked out during the
 * transition. This safety net is temporary — Phase 3 will add a session
 * hook assertion that guarantees `role` is always populated, and the
 * fallback can then be deleted.
 */

import { getRuntimeAdminAccess } from '#server/utils/knowledge-runtime'

export async function requireRuntimeAdminSession(event: Parameters<typeof requireUserSession>[0]) {
  const session = await requireUserSession(event)
  // AuthUser (from nuxt-better-auth + admin plugin) exposes `role?: string`.
  // Index access through a loose view keeps this helper free of the
  // per-deployment type graph, which changes when plugins are added.
  const user = session.user as unknown as {
    email?: string | null
    role?: string | null
  }

  // Q2 = A primary path: role is the authoritative signal.
  if (user.role === 'admin') {
    return session
  }

  // Transitional safety net: role missing (legacy session) → consult the
  // allowlist directly. NOT a drift check — drift reconciliation happens
  // in `server/auth.config.ts` `databaseHooks.session.create.before` so
  // the *next* login writes the correct role. Only covers the edge case
  // where a session exists but was minted before the role column.
  if (
    (user.role === null || user.role === undefined) &&
    getRuntimeAdminAccess(user.email ?? null)
  ) {
    return session
  }

  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: 'Runtime admin access is required',
  })
}
