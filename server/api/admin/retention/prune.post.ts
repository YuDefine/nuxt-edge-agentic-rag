import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { getD1Database } from '#server/utils/database'
import { runRetentionCleanup } from '#server/utils/knowledge-retention'
import { getKnowledgeRuntimeConfig } from '#server/utils/knowledge-runtime'
import { DEFAULT_RETENTION_DAYS } from '#shared/schemas/retention-policy'

/**
 * Request body schema for governance §2.4 verification path.
 *
 * `retentionDays` is an OPTIONAL shortened-TTL override intended for local smoke
 * verification of retention cleanup behaviour. The handler rejects
 * any override when the runtime environment is `production` — production MUST
 * use the configured 180-day retention (see governance §2.5, "Production
 * verifies configuration without fake expiry runs").
 *
 * Constraints:
 *   - Integer, > 0
 *   - <= DEFAULT_RETENTION_DAYS (180); the override is only meant to shorten
 *     the window, never to extend it beyond the governance ceiling.
 */
const requestSchema = z
  .object({
    retentionDays: z.number().int().positive().max(DEFAULT_RETENTION_DAYS).optional(),
  })
  .strict()
  .default({})

export default defineEventHandler(async function pruneRetentionHandler(event) {
  const log = useLogger(event)

  try {
    const session = await requireRuntimeAdminSession(event)

    // Best-effort body parse — empty / missing body counts as no override.
    const rawBody = (await readBody(event).catch(() => ({}))) ?? {}
    const parseResult = requestSchema.safeParse(rawBody)
    if (!parseResult.success) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message:
          'Invalid retention prune request. `retentionDays` must be a positive integer <= 180.',
      })
    }
    const { retentionDays: overrideRetentionDays } = parseResult.data

    // Gate: reject shortened-TTL override in production.
    if (overrideRetentionDays !== undefined) {
      const environment = getKnowledgeRuntimeConfig().environment
      if (environment === 'production') {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          message:
            'retentionDays override is not allowed in production. ' +
            'Shortened-TTL verification is limited to the local environment (governance §2.4).',
        })
      }
    }

    log.set({
      operation: 'prune-knowledge-retention',
      user: {
        id: session.user.id ?? null,
      },
      retentionDaysOverride: overrideRetentionDays ?? null,
    })

    const cleanup = await runRetentionCleanup({
      database: await getD1Database(),
      retentionDays: overrideRetentionDays,
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
