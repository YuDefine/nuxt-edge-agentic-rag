import { consola } from 'consola'

import {
  computeRetentionCutoff,
  DEFAULT_RETENTION_DAYS,
  type RetentionPolicyKey,
} from '#shared/schemas/retention-policy'

const log = consola.withTag('retention-cleanup')

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  run(): Promise<{ meta?: { changes?: number } } | unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export interface RetentionCleanupResult {
  retentionDays: number
  cutoff: string
  nowIso: string
  deleted: Record<RetentionPolicyKey, number>
  errors: Array<{ step: RetentionPolicyKey; message: string }>
}

function extractChangeCount(runResult: unknown): number {
  if (
    runResult !== null &&
    typeof runResult === 'object' &&
    'meta' in runResult &&
    runResult.meta !== null &&
    typeof runResult.meta === 'object' &&
    'changes' in runResult.meta &&
    typeof runResult.meta.changes === 'number'
  ) {
    return runResult.meta.changes
  }

  return 0
}

async function runStep(
  step: RetentionPolicyKey,
  fn: () => Promise<number>,
  result: RetentionCleanupResult
): Promise<void> {
  try {
    const changes = await fn()
    result.deleted[step] = changes
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ step, message }, 'retention cleanup step failed')
    result.errors.push({ step, message })
  }
}

/**
 * Coordinated retention cleanup across the four audit-chain categories.
 *
 * Ordering rationale (audit chain):
 *   1. citation_records  — safe to delete first; `query_logs → citation_records`
 *      cascades, but we delete citation_records explicitly so the step is
 *      measurable and does not silently vanish via cascade.
 *   2. query_logs        — after citation_records so FK cascade is a no-op.
 *   3. source_chunks.chunk_text — scrub text only after citation_records that
 *      referenced those chunks are gone (they no longer need the snapshot row
 *      since `citation_records.chunk_text_snapshot` is self-contained, and
 *      remaining live citations still point at source_chunks rows for locator
 *      metadata).
 *   4. mcp_tokens (revoked/expired) — redact token_hash / name / scopes_json
 *      on tokens that are already non-live past the retention window.
 *
 * Guarantees:
 *   - Idempotent: re-running with the same cutoff yields zero additional
 *     deletes.
 *   - Fail-safe: a failure in any step is logged, recorded in result.errors,
 *     and does not abort subsequent steps.
 *
 * @param input.database      D1 client (typically `await getD1Database()`)
 * @param input.now           Optional clock override for testing.
 * @param input.retentionDays Optional override for testing (staging backdated
 *                            verification). Defaults to DEFAULT_RETENTION_DAYS.
 */
export async function runRetentionCleanup(input: {
  database: D1DatabaseLike
  now?: Date
  retentionDays?: number
}): Promise<RetentionCleanupResult> {
  const now = input.now ?? new Date()
  const retentionDays = input.retentionDays ?? DEFAULT_RETENTION_DAYS
  const cutoff = computeRetentionCutoff({ retentionDays }, now)
  const nowIso = now.toISOString()

  const result: RetentionCleanupResult = {
    retentionDays,
    cutoff,
    nowIso,
    deleted: {
      queryLogs: 0,
      citationRecords: 0,
      sourceChunkText: 0,
      mcpTokenMetadata: 0,
    },
    errors: [],
  }

  // Step 1: expire citation_records by `expires_at` (stored per-row when the
  // citation was persisted). Using `expires_at` preserves the documented
  // contract of `citation-store` (expiry is baked in at write time).
  await runStep(
    'citationRecords',
    async () => {
      const runResult = await input.database
        .prepare('DELETE FROM citation_records WHERE expires_at <= ?')
        .bind(nowIso)
        .run()
      return extractChangeCount(runResult)
    },
    result
  )

  // Step 2: expire query_logs by `created_at <= cutoff`.
  await runStep(
    'queryLogs',
    async () => {
      const runResult = await input.database
        .prepare('DELETE FROM query_logs WHERE created_at <= ?')
        .bind(cutoff)
        .run()
      return extractChangeCount(runResult)
    },
    result
  )

  // Step 3: scrub source_chunks.chunk_text beyond retention window. Keep the
  // row (chunk_hash, citation_locator, metadata) so audit trails and any
  // in-flight replay path finds a deterministic "unavailable" marker instead
  // of NULL. chunk_text is TEXT NOT NULL, so scrub with an empty string.
  //
  // Guard: only scrub chunks where chunk_text is non-empty so reruns are
  // idempotent.
  await runStep(
    'sourceChunkText',
    async () => {
      const runResult = await input.database
        .prepare(
          "UPDATE source_chunks SET chunk_text = '' WHERE created_at <= ? AND chunk_text <> ''"
        )
        .bind(cutoff)
        .run()
      return extractChangeCount(runResult)
    },
    result
  )

  // Step 4: redact revoked/expired mcp_tokens metadata once past retention.
  // We match rows where revoked_at / expires_at / created_at (in that order
  // of preference) has passed the cutoff AND the token is not live.
  await runStep(
    'mcpTokenMetadata',
    async () => {
      const runResult = await input.database
        .prepare(
          [
            'UPDATE mcp_tokens',
            "SET token_hash = 'redacted:' || id,",
            "    name = '[redacted]',",
            "    scopes_json = '[]',",
            "    revoked_reason = COALESCE(revoked_reason, 'retention-expired')",
            'WHERE COALESCE(revoked_at, expires_at, created_at) <= ?',
            "  AND (status = 'revoked' OR status = 'expired' OR expires_at IS NOT NULL)",
            "  AND token_hash NOT LIKE 'redacted:%'",
          ].join('\n')
        )
        .bind(cutoff)
        .run()
      return extractChangeCount(runResult)
    },
    result
  )

  log.info(
    {
      retentionDays,
      cutoff,
      deleted: result.deleted,
      errors: result.errors.length,
    },
    'retention cleanup completed'
  )

  return result
}

/**
 * @deprecated Use {@link runRetentionCleanup} which returns structured results
 * and honors the shared retention policy. Kept for the existing
 * `/api/admin/retention/prune` handler until it migrates.
 */
export async function pruneKnowledgeRetentionWindow(input: {
  database: D1DatabaseLike
  now?: Date
  retentionDays?: number
}): Promise<void> {
  const now = input.now ?? new Date()
  const retentionDays = input.retentionDays ?? DEFAULT_RETENTION_DAYS
  const cutoff = computeRetentionCutoff({ retentionDays }, now)
  const nowIso = now.toISOString()

  // Retains the original call order (messages → query_logs → citation_records
  // → mcp_tokens) for backward compatibility with existing unit tests until
  // the legacy handler is migrated.
  await input.database.prepare('DELETE FROM messages WHERE created_at <= ?').bind(cutoff).run()
  await input.database.prepare('DELETE FROM query_logs WHERE created_at <= ?').bind(cutoff).run()
  await input.database
    .prepare('DELETE FROM citation_records WHERE expires_at <= ?')
    .bind(nowIso)
    .run()
  await input.database
    .prepare(
      [
        'UPDATE mcp_tokens',
        "SET token_hash = 'redacted:' || id,",
        "    name = '[redacted]',",
        "    scopes_json = '[]',",
        "    revoked_reason = COALESCE(revoked_reason, 'retention-expired')",
        'WHERE COALESCE(revoked_at, expires_at, created_at) <= ?',
        "  AND (status = 'revoked' OR status = 'expired' OR expires_at IS NOT NULL)",
      ].join('\n')
    )
    .bind(cutoff)
    .run()
}
