import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { getCloudflareEnv } from '#server/utils/cloudflare-bindings'
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

  // Workers runtime env (wrangler vars + secrets) only reaches useRuntimeConfig
  // when the env var is `NUXT_`-prefixed AND maps to a flat runtimeConfig key.
  // Our secrets (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN_ANALYTICS`) and
  // the nested `knowledge.aiGateway.id` don't satisfy either, so read from the
  // raw Cloudflare env with runtimeConfig as a local-dev fallback.
  const cfEnv = getCloudflareEnv(event) as Record<string, string | undefined>
  const runtimeConfig = useRuntimeConfig(event)
  const cloudflare = runtimeConfig.cloudflare as
    | { accountId?: string; analyticsApiToken?: string }
    | undefined
  const knowledge = getKnowledgeRuntimeConfig()

  const accountId = cfEnv.CLOUDFLARE_ACCOUNT_ID || cloudflare?.accountId || ''
  const analyticsApiToken =
    cfEnv.CLOUDFLARE_API_TOKEN_ANALYTICS || cloudflare?.analyticsApiToken || ''
  const gatewayId = cfEnv.NUXT_KNOWLEDGE_AI_GATEWAY_ID || knowledge.aiGateway.id || ''

  if (!gatewayId || !accountId || !analyticsApiToken) {
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
      accountId,
      apiToken: analyticsApiToken,
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
