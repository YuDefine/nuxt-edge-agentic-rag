/**
 * Shared retention policy constants — single source of truth for governance
 * cleanup. Do NOT hardcode day counts elsewhere; import from this module.
 *
 * Per `governance-and-observability` spec (bootstrap-v1-core-from-report) and
 * `retention-cleanup-governance` spec (governance-refinements), the retention
 * window for all four audit-chain categories is 180 days.
 *
 * Covered entities:
 *  - query_logs                     : masked query audit log rows
 *  - citation_records               : citation replay snapshots
 *  - source_chunks.chunk_text       : chunk full-text kept for replay
 *  - mcp_tokens (revoked/expired)   : redacted token metadata
 *
 * See:
 *  - openspec/changes/bootstrap-v1-core-from-report/specs/governance-and-observability/spec.md
 *    Requirement: Retention And Replay Window (180 days, all four)
 *  - openspec/changes/governance-refinements/specs/retention-cleanup-governance/spec.md
 *    Requirement: Coordinated Retention Cleanup
 */

export const DEFAULT_RETENTION_DAYS: number = 180

export const RETENTION_POLICY = {
  queryLogs: {
    entity: 'query_logs',
    retentionDays: DEFAULT_RETENTION_DAYS,
    /** Action when expired: hard delete the row. */
    action: 'delete',
  },
  citationRecords: {
    entity: 'citation_records',
    retentionDays: DEFAULT_RETENTION_DAYS,
    /** Action when expired: hard delete the row. */
    action: 'delete',
  },
  sourceChunkText: {
    entity: 'source_chunks.chunk_text',
    retentionDays: DEFAULT_RETENTION_DAYS,
    /**
     * Action when expired: scrub the `chunk_text` column but keep the row so
     * `source_chunks` metadata (chunk_hash, citation_locator, document_version_id)
     * remains intact for audit trail. `chunk_text` is TEXT NOT NULL in schema
     * so scrubbing writes an empty string instead of NULL.
     */
    action: 'scrub-text',
  },
  mcpTokenMetadata: {
    entity: 'mcp_tokens',
    retentionDays: DEFAULT_RETENTION_DAYS,
    /**
     * Action when expired: redact token_hash / name / scopes_json on rows that
     * are already revoked or expired. Live tokens are never touched by this
     * policy.
     */
    action: 'redact',
  },
} as const

export type RetentionPolicyKey = keyof typeof RETENTION_POLICY

export type RetentionPolicyEntry = (typeof RETENTION_POLICY)[RetentionPolicyKey]

/**
 * Deterministically compute the cutoff ISO timestamp for a given policy entry.
 * Records whose governing timestamp is `<= cutoff` are considered expired.
 */
export function computeRetentionCutoff(
  policy: Pick<RetentionPolicyEntry, 'retentionDays'>,
  now: Date = new Date(),
): string {
  const millis = now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000
  return new Date(millis).toISOString()
}

/**
 * Static summary of the configured retention policy for operators / docs.
 * Does not query the database; safe to call from any surface.
 */
export function describeRetentionPolicy(): Array<{
  key: RetentionPolicyKey
  entity: string
  retentionDays: number
  action: RetentionPolicyEntry['action']
}> {
  return (Object.keys(RETENTION_POLICY) as RetentionPolicyKey[]).map((key) => ({
    key,
    entity: RETENTION_POLICY[key].entity,
    retentionDays: RETENTION_POLICY[key].retentionDays,
    action: RETENTION_POLICY[key].action,
  }))
}
