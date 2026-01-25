import { useLogger } from 'evlog'

import { getD1Database } from '../../../utils/database'
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

    await pruneKnowledgeRetentionWindow({
      database: await getD1Database(),
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
