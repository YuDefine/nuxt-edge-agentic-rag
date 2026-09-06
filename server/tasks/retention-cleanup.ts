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

import { createRequestLogger } from 'evlog'

import { getD1Database } from '#server/utils/database'
import { runRetentionCleanup } from '#server/utils/knowledge-retention'
import { runWideEventDrain } from '#server/utils/sse-child-logger'

export default defineTask({
  meta: {
    name: 'retention-cleanup',
    description:
      'Run coordinated retention cleanup for query_logs, citation_records, source_chunks.chunk_text and revoked/expired mcp_tokens.',
  },
  async run() {
    // Cron invocations have no H3 event, so `useLogger(event)` is unavailable
    // and this run left no wide event at all — a scheduled job that deletes
    // audit-chain rows was the one code path with no record of having run.
    //
    // `createRequestLogger` is evlog's standalone entry point: it needs an
    // explicit `emit()`, and emitting alone is not enough. Nitro's evlog plugin
    // drives `evlog:enrich` / `evlog:drain` itself for request-scope events
    // (`initLogger` there is deliberately configured without a drain), so a
    // standalone event only reaches the NuxtHub D1 drain if we run that chain
    // ourselves — `runWideEventDrain` is the same helper the SSE/MCP child
    // loggers use. `_forceKeep` opts the run out of `sampling.rates.info: 50`;
    // a once-a-day job is not something to sample.
    const log = createRequestLogger({ method: 'CRON', path: '/_tasks/retention-cleanup' })

    try {
      const database = await getD1Database()
      const result = await runRetentionCleanup({ database })

      log.set({
        retention: {
          days: result.retentionDays,
          cutoff: result.cutoff,
          deleted: result.deleted,
          errorCount: result.errors.length,
          errors: result.errors,
        },
      })

      // `runRetentionCleanup` is fail-safe by design: a failing step is
      // recorded in `result.errors` and the remaining steps still run, so this
      // function returns normally even when every step failed. Counting them
      // is not enough — without an explicit level, a wholly failed cleanup
      // emits at `info` and never shows up in error monitoring.
      if (result.errors.length > 0) log.setLevel('error')

      return { result }
    } catch (error) {
      log.error(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      const emitted = log.emit({ _forceKeep: true })
      if (emitted) await runWideEventDrain(emitted)
    }
  },
})
