/**
 * Server-side admin gate.
 *
 * `session.user.role` is the single source of truth under the three-tier
 * model. The role column is populated by:
 *   1. `user.create.before` hook (new signups, derived from
 *      `ADMIN_EMAIL_ALLOWLIST`);
 *   2. `session.create.before` hook (drift reconciliation — allowlist
 *      added/removed since last login rewrites the role before the
 *      session snapshot is minted).
 *
 * The function name and signature are preserved so every one of the ~20
 * existing call sites migrates transparently — callers that previously
 * received `{ user: { id, email } }` still receive the same shape.
 */

export async function requireRuntimeAdminSession(event: Parameters<typeof requireUserSession>[0]) {
  const session = await requireUserSession(event)
  // AuthUser (from nuxt-better-auth + admin plugin) exposes `role?: string`.
  // Index access through a loose view keeps this helper free of the
  // per-deployment type graph, which changes when plugins are added.
  const user = session.user as unknown as {
    role?: string | null
  }

  if (user.role === 'admin') {
    return session
  }

  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: 'Runtime admin access is required',
  })
}
