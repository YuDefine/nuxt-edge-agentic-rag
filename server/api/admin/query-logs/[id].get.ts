import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { getD1Database } from '#server/utils/database'
import { createQueryLogAdminStore } from '#server/utils/query-log-admin-store'

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async function getQueryLogDetailHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)

  const params = await getValidatedRouterParams(event, paramsSchema.parse)

  log.set({
    operation: 'admin-query-logs-detail',
    table: 'query_logs',
    queryLogId: params.id,
    user: { id: session.user.id ?? null },
  })

  const database = await getD1Database()
  const store = createQueryLogAdminStore(database)

  const row = await store.getQueryLogById(params.id)

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: '找不到此 query log',
    })
  }

  // Redaction-safe detail response. NEVER include raw / un-redacted query text.
  return {
    data: {
      allowedAccessLevels: row.allowedAccessLevels,
      channel: row.channel,
      configSnapshotVersion: row.configSnapshotVersion,
      createdAt: row.createdAt,
      environment: row.environment,
      id: row.id,
      queryRedactedText: row.queryRedactedText,
      redactionApplied: row.redactionApplied,
      riskFlags: row.riskFlags,
      status: row.status,
    },
  }
})
