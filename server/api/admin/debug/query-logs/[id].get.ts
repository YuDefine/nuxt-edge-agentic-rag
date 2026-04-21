/**
 * observability-and-debug §2 — internal debug detail for a single query_log.
 *
 * - Admin + production-flag gated via `requireInternalDebugAccess`.
 * - Returns 6 debug fields (latency / score / path / reason) in addition to
 *   the redaction-safe admin projection.
 * - NEVER returns raw query text.
 */

import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireInternalDebugAccess } from '#server/utils/debug-surface-guard'
import { createQueryLogDebugStore } from '#server/utils/query-log-debug-store'

const paramsSchema = z.object({ id: z.string().min(1) })

export default defineEventHandler(async function getDebugQueryLogDetailHandler(event) {
  const log = useLogger(event)

  const access = await requireInternalDebugAccess(event)
  const params = await getValidatedRouterParams(event, paramsSchema.parse)

  log.set({
    operation: 'admin-debug-query-logs-detail',
    table: 'query_logs',
    queryLogId: params.id,
    debug: {
      environment: access.environment,
      enabledByFlag: access.enabledByFlag,
    },
    user: { id: access.userId },
  })

  const store = createQueryLogDebugStore()
  let row
  try {
    row = await store.getDebugQueryLogById(params.id)
  } catch (error) {
    log.error(error as Error, { step: 'fetch-debug-query-log' })
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '暫時無法載入 query log，請稍後再試',
    })
  }

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: '找不到此 query log',
    })
  }

  // Redaction-safe detail — NEVER include raw / un-redacted query text. The
  // store layer already projects only debug-safe columns.
  return {
    data: {
      allowedAccessLevels: row.allowedAccessLevels,
      channel: row.channel,
      citationsJson: row.citationsJson,
      completionLatencyMs: row.completionLatencyMs,
      configSnapshotVersion: row.configSnapshotVersion,
      createdAt: row.createdAt,
      decisionPath: row.decisionPath,
      environment: row.environment,
      firstTokenLatencyMs: row.firstTokenLatencyMs,
      id: row.id,
      judgeScore: row.judgeScore,
      queryRedactedText: row.queryRedactedText,
      redactionApplied: row.redactionApplied,
      refusalReason: row.refusalReason,
      retrievalScore: row.retrievalScore,
      riskFlags: row.riskFlags,
      status: row.status,
    },
  }
})
