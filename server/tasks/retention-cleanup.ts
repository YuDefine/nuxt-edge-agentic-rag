/**
 * Scheduled task: coordinated retention cleanup.
 *
 * Triggered by Cloudflare Workers Cron Trigger configured in wrangler.jsonc
 * (`triggers.crons`). Nitro maps the cron payload onto this task via
 * `nuxt.config.ts → nitro.scheduledTasks`.
 *
 * Behavior:
 *   - Reads the shared retention policy (180 days; see
 *     `shared/schemas/retention-policy.ts`).
 *   - Deletes / scrubs audit-chain records in coordinated order so no partial
 *     audit chain is left behind (see `runRetentionCleanup`).
 *   - Fail-safe: a failure in one step does not abort subsequent steps; errors
 *     surface in the returned payload and are logged.
 *
 * This task is idempotent: repeat runs on the same cutoff produce zero deletes.
 */

import { consola } from 'consola'

import { getD1Database } from '#server/utils/database'
import { runRetentionCleanup } from '#server/utils/knowledge-retention'

const log = consola.withTag('scheduled-retention-cleanup')

export default defineTask({
  meta: {
    name: 'retention-cleanup',
    description:
      'Run coordinated retention cleanup for query_logs, citation_records, source_chunks.chunk_text and revoked/expired mcp_tokens.',
  },
  async run() {
    log.info('scheduled retention cleanup starting')

    try {
      const database = await getD1Database()
      const result = await runRetentionCleanup({ database })

      log.info(
        {
          retentionDays: result.retentionDays,
          cutoff: result.cutoff,
          deleted: result.deleted,
          errorCount: result.errors.length,
        },
        'scheduled retention cleanup completed'
      )

      return { result }
    } catch (error) {
      log.error(
        { message: error instanceof Error ? error.message : String(error) },
        'scheduled retention cleanup failed to start'
      )
      throw error
    }
  },
})
