/**
 * Governance §2.4 — Backdated retention verification seed helper.
 *
 * This utility writes backdated `query_logs` + `citation_records` rows so that
 * local verification can prove the coordinated retention cleanup actually deletes
 * expired audit chains without waiting 180 real days.
 *
 * It refuses to run against a `production` environment. The corresponding
 * /api/admin/retention/prune handler also refuses shortened-TTL overrides in
 * production, so the two sides together keep backdated verification contained
 * to non-production surfaces.
 *
 * Design notes:
 *   - Only the two rows that `runRetentionCleanup` actually selects on
 *     (`query_logs.created_at` + `citation_records.expires_at`) are required
 *     for the verification path. `source_chunks.chunk_text` scrub can be
 *     tested via the dedicated retention-cleanup integration test; the seed
 *     helper does NOT mutate `source_chunks` because operators must reuse an
 *     already-indexed chunk so downstream `getDocumentChunk` replay is
 *     meaningful.
 *   - Returns the generated IDs so the caller can clean up afterwards.
 */

export interface SeedBackdatedRetentionInput {
  /** D1 database handle (or an equivalent `prepare`-compatible fake). */
  database: {
    prepare(query: string): {
      bind(...values: unknown[]): {
        run(): Promise<unknown>
      }
    }
  }
  /** Runtime environment; must NOT be `production`. */
  environment: string
  /** Age in days; the backdated row is created this many days before `now`. */
  ageDays: number
  /** Existing `document_versions.id` to reference from the citation row. */
  documentVersionId: string
  /** Existing `source_chunks.id` to reference from the citation row. */
  sourceChunkId: string
  /** Optional clock override (testing). Defaults to `new Date()`. */
  now?: Date
  /** Optional id suffix (testing). Defaults to `Date.now()`. */
  idSuffix?: string
  /** Optional channel label written into query_logs. Defaults to `web`. */
  channel?: string
  /** Optional masked query text. Defaults to `[backdated retention test]`. */
  queryRedactedText?: string
}

export interface SeedBackdatedRetentionResult {
  queryLogId: string
  citationRecordId: string
  /** ISO timestamp used for `query_logs.created_at` and `citation_records.created_at`. */
  createdAt: string
  /** ISO timestamp used for `citation_records.expires_at`. Same as `createdAt` for worst-case. */
  expiresAt: string
  /** Echoes the effective `ageDays` so the verification harness can log it. */
  ageDays: number
}

const FORBIDDEN_ENVIRONMENT = 'production'

export async function seedBackdatedRetentionRecord(
  input: SeedBackdatedRetentionInput,
): Promise<SeedBackdatedRetentionResult> {
  if (input.environment === FORBIDDEN_ENVIRONMENT) {
    throw new Error(
      'seedBackdatedRetentionRecord refuses to write backdated rows in production. ' +
        'Governance §2.4 restricts backdated verification to the local environment.',
    )
  }

  if (!Number.isInteger(input.ageDays) || input.ageDays <= 0) {
    throw new Error(
      `seedBackdatedRetentionRecord: ageDays must be a positive integer, received ${String(
        input.ageDays,
      )}`,
    )
  }

  if (!input.documentVersionId) {
    throw new Error('seedBackdatedRetentionRecord: documentVersionId is required')
  }

  if (!input.sourceChunkId) {
    throw new Error('seedBackdatedRetentionRecord: sourceChunkId is required')
  }

  const now = input.now ?? new Date()
  const createdAtMillis = now.getTime() - input.ageDays * 24 * 60 * 60 * 1000
  const createdAt = new Date(createdAtMillis).toISOString()
  // `expires_at` for backdated rows defaults to the same instant as
  // `created_at`, which guarantees the citation row is expired from the
  // perspective of `runRetentionCleanup` (which uses `expires_at <= now`).
  const expiresAt = createdAt

  const idSuffix = input.idSuffix ?? `${now.getTime()}`
  const queryLogId = `backdated-ql-${idSuffix}`
  const citationRecordId = `backdated-cr-${idSuffix}`

  const channel = input.channel ?? 'web'
  const queryRedactedText = input.queryRedactedText ?? '[backdated retention test]'

  // Step 1: insert the query_log. Matches the minimum required columns in
  // `server/db/schema.ts::queryLogs` (id, channel, environment, redacted text,
  // status, created_at). Other columns fall back to their schema defaults.
  await input.database
    .prepare(
      'INSERT INTO query_logs (id, channel, environment, query_redacted_text, ' +
        'config_snapshot_version, status, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      queryLogId,
      channel,
      input.environment,
      queryRedactedText,
      'retention-backdated',
      'accepted',
      createdAt,
    )
    .run()

  // Step 2: insert the citation_record. `query_log_id` references the row
  // inserted above; `document_version_id` + `source_chunk_id` must reference
  // real rows that already exist in the target DB (operator ensures this).
  await input.database
    .prepare(
      'INSERT INTO citation_records (id, query_log_id, document_version_id, ' +
        'source_chunk_id, citation_locator, chunk_text_snapshot, created_at, expires_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      citationRecordId,
      queryLogId,
      input.documentVersionId,
      input.sourceChunkId,
      'loc:0',
      '[backdated snapshot]',
      createdAt,
      expiresAt,
    )
    .run()

  return {
    queryLogId,
    citationRecordId,
    createdAt,
    expiresAt,
    ageDays: input.ageDays,
  }
}
