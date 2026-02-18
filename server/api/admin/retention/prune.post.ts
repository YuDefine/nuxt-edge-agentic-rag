import { useLogger } from 'evlog'

import { getD1Database } from '#server/utils/database'
import { runRetentionCleanup } from '#server/utils/knowledge-retention'

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

    const cleanup = await runRetentionCleanup({
      database: await getD1Database(),
    })

    log.set({
      result: {
        retentionDays: cleanup.retentionDays,
        deleted: cleanup.deleted,
        errorCount: cleanup.errors.length,
      },
    })

    return {
      data: {
        pruned: true,
        retentionDays: cleanup.retentionDays,
        cutoff: cleanup.cutoff,
        deleted: cleanup.deleted,
        errors: cleanup.errors,
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
