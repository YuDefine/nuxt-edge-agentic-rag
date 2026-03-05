import { useLogger } from 'evlog'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { createAdminDashboardStore } from '#server/utils/admin-dashboard-store'
import { getD1Database } from '#server/utils/database'

/**
 * Admin summary dashboard endpoint.
 *
 * Auth order: requireRuntimeAdminSession → feature flag check.
 *
 * When `features.adminDashboard` is false in the active environment, the
 * endpoint responds with 404 (rather than leaking feature-flag state via
 * 403/501). Session auth is still enforced first so unauthenticated callers
 * can never probe flag state.
 */
export default defineEventHandler(async function adminDashboardSummaryHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)

  const config = useRuntimeConfig(event)
  // Dedicated gate for this post-core dashboard (see `nuxt.config.ts`).
  // Defaults to true; set `NUXT_ADMIN_DASHBOARD_ENABLED=false` to disable.
  if (!config.adminDashboardEnabled) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: 'Admin dashboard is not available in this environment',
    })
  }

  log.set({
    operation: 'admin-dashboard-summary',
    table: 'dashboard',
    user: { id: session.user.id ?? null },
  })

  const database = await getD1Database()
  const store = createAdminDashboardStore(database)

  const [documentsTotal, queriesLast30Days, tokensActive, trend] = await Promise.all([
    store.countDocuments(),
    store.countRecentQueryLogs(30),
    store.countActiveTokens(),
    store.listRecentQueryTrend(7),
  ])

  return {
    data: {
      cards: {
        documentsTotal,
        queriesLast30Days,
        tokensActive,
      },
      trend,
    },
  }
})
