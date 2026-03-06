/**
 * observability-and-debug §3 — aggregate latency + outcome summary.
 *
 * - Admin + production-flag gated.
 * - Returns per-channel first-token / completion p50+p95 (null-safe) plus an
 *   outcome breakdown (answered / refused / forbidden / error).
 * - Never joins to message content — response is pure numeric aggregation, no
 *   raw query text can leak.
 */

import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireInternalDebugAccess } from '#server/utils/debug-surface-guard'
import { createQueryLogDebugStore } from '#server/utils/query-log-debug-store'

const querySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((v) => v === 7 || v === 30, {
      message: 'days must be 7 or 30',
    })
    .default(7),
})

export default defineEventHandler(async function getDebugLatencySummaryHandler(event) {
  const log = useLogger(event)

  const access = await requireInternalDebugAccess(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  log.set({
    operation: 'admin-debug-latency-summary',
    table: 'query_logs',
    debug: {
      environment: access.environment,
      enabledByFlag: access.enabledByFlag,
      days: query.days,
    },
    user: { id: access.userId },
  })

  const store = createQueryLogDebugStore()
  const summary = await store.summarizeLatency({ days: query.days })

  return {
    data: {
      channels: summary.channels,
      days: summary.days,
    },
  }
})
