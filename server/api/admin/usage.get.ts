import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { aggregateUsage, fetchAnalyticsLogs } from '#server/utils/usage-analytics'
import { USAGE_RANGE_VALUES, type UsageResponse } from '#shared/types/usage'

const usageQuerySchema = z
  .object({
    range: z.enum(USAGE_RANGE_VALUES).default('today'),
  })
  .strict()

export default defineEventHandler(async function adminUsageHandler(event): Promise<UsageResponse> {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)
  const { range } = await getValidatedQuery(event, usageQuerySchema.parse)

  log.set({
    operation: 'admin-usage',
    user: { id: session.user.id ?? null },
  })

  const runtimeConfig = useRuntimeConfig(event)
  const cloudflare = runtimeConfig.cloudflare as
    | { accountId?: string; analyticsApiToken?: string }
    | undefined
  const knowledge = getKnowledgeRuntimeConfig()
  const gatewayId = knowledge.aiGateway.id

  if (!gatewayId || !cloudflare?.accountId || !cloudflare.analyticsApiToken) {
    // Gateway not yet provisioned in this environment, or the Analytics
    // secret was never set. Return 503 so the admin UI can surface a
    // clear "not configured" message rather than leaking env state.
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: 'AI Gateway 用量分析尚未設定完成，請先建立 gateway 與 Analytics token。',
    })
  }

  try {
    const logs = await fetchAnalyticsLogs({
      accountId: cloudflare.accountId,
      apiToken: cloudflare.analyticsApiToken,
      gatewayId,
      range,
    })
    const snapshot = aggregateUsage(logs, { range })

    return { data: snapshot }
  } catch (error) {
    log.error(error as Error, { step: 'fetch-cloudflare-analytics' })
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      message: '用量資料服務暫時無法使用，請稍後再試。',
    })
  }
})
