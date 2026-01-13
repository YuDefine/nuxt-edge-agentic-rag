import { useLogger } from 'evlog'

import { getRequiredD1Binding } from '../../../utils/cloudflare-bindings'
import { getKnowledgeRuntimeConfig } from '../../../utils/knowledge-runtime'
import { pruneKnowledgeRetentionWindow } from '../../../utils/knowledge-retention'

export default defineEventHandler(async function pruneRetentionHandler(event) {
  const log = useLogger(event)

  try {
    const session = await requireRuntimeAdminSession(event)
    log.set({
      operation: 'prune-knowledge-retention',
      user: {
        id: session.user.id ?? null,
      },
    })

    const runtimeConfig = getKnowledgeRuntimeConfig()

    await pruneKnowledgeRetentionWindow({
      database: getRequiredD1Binding(event, runtimeConfig.bindings.d1Database),
    })

    log.set({
      result: {
        retentionDays: 180,
      },
    })

    return {
      data: {
        pruned: true,
        retentionDays: 180,
      },
    }
  } catch (error) {
    if (isHandledError(error)) {
      throw error
    }

    log.error(error as Error, { operation: 'prune-knowledge-retention' })

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'Retention prune failed',
    })
  }
})

function isHandledError(error: unknown): error is { statusCode: number } {
  return typeof error === 'object' && error !== null && 'statusCode' in error
}
