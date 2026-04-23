/**
 * observability-and-debug §1.3 — single entry point that every internal
 * debug surface (API route, page, component guard) MUST call before showing
 * any observability data.
 *
 * Contract:
 *   1. Caller must already be signed in with runtime admin privileges —
 *      delegates to `requireRuntimeAdminSession()` which throws 403 for
 *      non-admins.
 *   2. In production, the surface is additionally locked behind a runtime
 *      feature flag (`runtimeConfig.debugSurfaceEnabled`). This lets us keep
 *      the route code deployed but inert until an incident needs it.
 *   3. Non-production environments (`local` / `staging`) are always open to
 *      admins so developers can exercise the debug UI without flipping flags.
 *
 * NEVER use this helper on a normal admin endpoint — it is strictly for
 * observability/debug surfaces. Ordinary admin endpoints should continue to
 * call `requireRuntimeAdminSession()` directly.
 */

export interface DebugSurfaceAccessContext {
  /** Authenticated admin user id (from `session.user.id`). */
  userId: string
  /** Resolved `knowledge.environment` at request time. */
  environment: string
  /** True when the production flag was the reason access was granted. */
  enabledByFlag: boolean
}

export async function requireInternalDebugAccess(
  event: Parameters<typeof requireRuntimeAdminSession>[0],
): Promise<DebugSurfaceAccessContext> {
  // Order matters: surface 403 for non-admins before probing env/flag so the
  // flag never leaks to unauthenticated callers.
  const session = await requireRuntimeAdminSession(event)
  const runtimeConfig = useRuntimeConfig()
  const environment = String(runtimeConfig.knowledge?.environment ?? 'local')
  const enabledByFlag = Boolean(runtimeConfig.debugSurfaceEnabled)

  if (environment === 'production' && !enabledByFlag) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'Debug surface is disabled in production',
    })
  }

  return {
    userId: String(session.user?.id ?? ''),
    environment,
    enabledByFlag,
  }
}
