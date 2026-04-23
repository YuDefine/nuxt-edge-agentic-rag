import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

const timestampNow = sql`CURRENT_TIMESTAMP`

export const userProfiles = sqliteTable('user_profiles', {
  id: text('id').primaryKey(),
  emailNormalized: text('email_normalized').notNull().unique(),
  displayName: text('display_name'),
  roleSnapshot: text('role_snapshot').notNull().default('user'),
  adminSource: text('admin_source').notNull().default('none'),
  createdAt: text('created_at').notNull().default(timestampNow),
  updatedAt: text('updated_at').notNull().default(timestampNow),
})

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  categorySlug: text('category_slug').notNull().default(''),
  accessLevel: text('access_level').notNull().default('internal'),
  status: text('status').notNull().default('draft'),
  currentVersionId: text('current_version_id'),
  createdByUserId: text('created_by_user_id').references(() => userProfiles.id),
  createdAt: text('created_at').notNull().default(timestampNow),
  updatedAt: text('updated_at').notNull().default(timestampNow),
  archivedAt: text('archived_at'),
})

export const documentVersions = sqliteTable(
  'document_versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    sourceR2Key: text('source_r2_key').notNull(),
    normalizedTextR2Key: text('normalized_text_r2_key'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    smokeTestQueriesJson: text('smoke_test_queries_json').notNull().default('[]'),
    indexStatus: text('index_status').notNull().default('upload_pending'),
    syncStatus: text('sync_status').notNull().default('pending'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
    publishedAt: text('published_at'),
    createdAt: text('created_at').notNull().default(timestampNow),
    updatedAt: text('updated_at').notNull().default(timestampNow),
  },
  (table) => [
    uniqueIndex('document_versions_document_version_unique').on(
      table.documentId,
      table.versionNumber,
    ),
    index('document_versions_document_current_idx').on(table.documentId, table.isCurrent),
  ],
)

export const sourceChunks = sqliteTable(
  'source_chunks',
  {
    id: text('id').primaryKey(),
    documentVersionId: text('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    chunkHash: text('chunk_hash').notNull(),
    chunkText: text('chunk_text').notNull(),
    citationLocator: text('citation_locator').notNull(),
    accessLevel: text('access_level').notNull().default('internal'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: text('created_at').notNull().default(timestampNow),
  },
  (table) => [
    uniqueIndex('source_chunks_version_chunk_unique').on(table.documentVersionId, table.chunkIndex),
    index('source_chunks_version_locator_idx').on(table.documentVersionId, table.citationLocator),
  ],
)

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    userProfileId: text('user_profile_id').references(() => userProfiles.id),
    accessLevel: text('access_level').notNull().default('internal'),
    title: text('title').notNull().default('New conversation'),
    createdAt: text('created_at').notNull().default(timestampNow),
    updatedAt: text('updated_at').notNull().default(timestampNow),
    deletedAt: text('deleted_at'),
  },
  (table) => [index('conversations_user_created_idx').on(table.userProfileId, table.createdAt)],
)

export const mcpTokens = sqliteTable('mcp_tokens', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  name: text('name').notNull(),
  scopesJson: text('scopes_json').notNull().default('[]'),
  environment: text('environment').notNull(),
  status: text('status').notNull().default('active'),
  expiresAt: text('expires_at'),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
  revokedReason: text('revoked_reason'),
  createdAt: text('created_at').notNull().default(timestampNow),
  /**
   * Better-auth `user.id` of the admin who provisioned this token.
   *
   * Originally introduced by migration 0006 as nullable for backward
   * compatibility with pre-0006 tokens; migration 0008 tightened the
   * column to NOT NULL after prod backfill (charles.yudefine@gmail.com
   * for existing audit-bearing tokens, DELETE for stale test seeds).
   * The application path (`createToken` in `mcp-token-store.ts`) has
   * always written a concrete admin id, so the column is now enforced
   * at both the schema and code layers.
   *
   * **FK policy (SQL layer)**: `REFERENCES "user"(id) ON DELETE CASCADE`
   * established by migration 0010 (fk-cascade-repair-for-self-delete /
   * TD-011). When a user is deleted, their provisioned tokens are
   * cascaded away atomically so no orphan tokens remain. The downstream
   * `query_logs.mcp_token_id` uses `ON DELETE SET NULL` (migration 0010)
   * so the log survives the cascade with its token attribution nulled.
   *
   * **No `.references()`**: the `user` table is owned by better-auth in
   * `hub:db` and is not declared in this drizzle schema. The FK
   * constraint is enforced at the SQL layer (migrations 0006/0007/0008/0010).
   */
  createdByUserId: text('created_by_user_id').notNull(),
})

export const queryLogs = sqliteTable(
  'query_logs',
  {
    id: text('id').primaryKey(),
    channel: text('channel').notNull(),
    userProfileId: text('user_profile_id').references(() => userProfiles.id),
    mcpTokenId: text('mcp_token_id').references(() => mcpTokens.id, { onDelete: 'set null' }),
    environment: text('environment').notNull(),
    queryRedactedText: text('query_redacted_text').notNull(),
    riskFlagsJson: text('risk_flags_json').notNull().default('[]'),
    allowedAccessLevelsJson: text('allowed_access_levels_json').notNull().default('["internal"]'),
    redactionApplied: integer('redaction_applied', { mode: 'boolean' }).notNull().default(false),
    configSnapshotVersion: text('config_snapshot_version').notNull().default('v1'),
    status: text('status').notNull().default('accepted'),
    createdAt: text('created_at').notNull().default(timestampNow),
    /**
     * observability-and-debug §0.1: SSE first-token latency in ms. NULL means
     * "not measured" (e.g. blocked pre-stream, legacy row). MUST NOT be
     * fabricated to 0 — the debug surface distinguishes null-latency from a
     * zero-latency run (see tasks.md §3.3).
     */
    firstTokenLatencyMs: integer('first_token_latency_ms'),
    /**
     * observability-and-debug §0.1: completion latency in ms (end of stream).
     * NULL means the completion never ran or was refused before any tokens
     * were produced. Debug surface treats null and partial-stream as distinct
     * states.
     */
    completionLatencyMs: integer('completion_latency_ms'),
    /**
     * observability-and-debug §0.1: retrieval score (0-1 float). NULL when
     * retrieval didn't execute for this row (e.g. blocked query). Do not map
     * to 0 — the refusal-path rows still need to be distinguishable from
     * low-score answered rows.
     */
    retrievalScore: real('retrieval_score'),
    /**
     * observability-and-debug §0.1: answerability judge score (0-1 float).
     * NULL when the judge was bypassed. Do not fabricate.
     */
    judgeScore: real('judge_score'),
    /**
     * observability-and-debug §0.1: short decision-path tag (e.g.
     * `direct_answer`, `judge_pass_then_refuse`, `self_correction_retry`).
     * NULL for rows that predate the debug surface. Canonical enum owned by
     * the UI task (tasks.md §2.1); writer here does not validate the tag.
     */
    decisionPath: text('decision_path'),
    /**
     * observability-and-debug §0.1: refusal classification (e.g.
     * `restricted_scope`, `no_citation`, `sensitive_governance`). NULL when
     * the run did not refuse. Writer does not validate — UI task owns the
     * enum of categories.
     */
    refusalReason: text('refusal_reason'),
    /**
     * workers-ai-grounded-answering §3.1: serialized per-run Workers AI
     * telemetry captured for the query. JSON array of `{modelRole, model,
     * latencyMs, usage}` records in call order. Default `[]` preserves
     * backwards compatibility for blocked / legacy rows with no model calls.
     */
    workersAiRunsJson: text('workers_ai_runs_json').notNull().default('[]'),
  },
  (table) => [index('query_logs_channel_created_idx').on(table.channel, table.createdAt)],
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    queryLogId: text('query_log_id').references(() => queryLogs.id, { onDelete: 'set null' }),
    userProfileId: text('user_profile_id').references(() => userProfiles.id),
    channel: text('channel').notNull(),
    role: text('role').notNull(),
    /**
     * Audit-safe redacted copy of the message content. Remains NOT NULL even
     * after a conversation is soft-deleted (governance §1.5). MUST NOT flow
     * back into user-visible UI / API / model context.
     */
    contentRedacted: text('content_redacted').notNull(),
    /**
     * User-visible raw content. Populated on write. Set to NULL when the
     * owning conversation is soft-deleted (governance §1.4 purge policy).
     * Readers intended for user/model-context surfaces MUST gate on this
     * column via `getUserVisibleMessageContent` — see conversation-store.
     */
    contentText: text('content_text'),
    citationsJson: text('citations_json').notNull().default('[]'),
    riskFlagsJson: text('risk_flags_json').notNull().default('[]'),
    redactionApplied: integer('redaction_applied', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(timestampNow),
  },
  (table) => [
    index('messages_query_log_idx').on(table.queryLogId),
    index('messages_conversation_created_idx').on(table.conversationId, table.createdAt),
  ],
)

export const citationRecords = sqliteTable(
  'citation_records',
  {
    id: text('id').primaryKey(),
    queryLogId: text('query_log_id')
      .notNull()
      .references(() => queryLogs.id, { onDelete: 'cascade' }),
    documentVersionId: text('document_version_id')
      .notNull()
      .references(() => documentVersions.id),
    sourceChunkId: text('source_chunk_id')
      .notNull()
      .references(() => sourceChunks.id),
    citationLocator: text('citation_locator').notNull(),
    chunkTextSnapshot: text('chunk_text_snapshot').notNull(),
    createdAt: text('created_at').notNull().default(timestampNow),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    index('citation_records_query_log_idx').on(table.queryLogId),
    index('citation_records_expires_idx').on(table.expiresAt),
  ],
)

/**
 * B16 member-and-permission-management: single-row-per-key settings store.
 *
 * `value` is a scalar string; the enum / shape contract lives in
 * `shared/types/auth.ts` (e.g. `guestPolicySchema`). `updated_by` accepts
 * a better-auth `user.id` or one of the sentinels `'system'` / `'db-direct'`.
 */
export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(timestampNow),
  updatedBy: text('updated_by').notNull(),
})

/**
 * B16 member-and-permission-management: role-change audit trail.
 *
 * Writer contract: every write MUST go through
 * `server/utils/member-role-changes.ts` → `recordRoleChange` (Q3=A "唯一
 * 入口"). No UI read surface in v1.0.0 — admin-ui-post-core owns that.
 *
 * `userId` / `changedBy` are better-auth `user.id` strings; `changedBy`
 * additionally accepts the sentinels documented in migration 0006.
 *
 * **No FOREIGN KEY on `user_id`** (established by migration 0010,
 * fk-cascade-repair-for-self-delete / TD-011). Audit tombstones written
 * as the last act of `server/api/auth/account/delete.post.ts` (with
 * `reason = 'self-deletion'`) must survive the subsequent
 * `DELETE FROM "user"`; a FK RESTRICT would block that. Drizzle ORM
 * doesn't declare FKs here either — this column is a plain text
 * reference that may point at a user id that no longer exists.
 */
export const memberRoleChanges = sqliteTable(
  'member_role_changes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    fromRole: text('from_role').notNull(),
    toRole: text('to_role').notNull(),
    changedBy: text('changed_by').notNull(),
    reason: text('reason'),
    createdAt: text('created_at').notNull().default(timestampNow),
  },
  (table) => [index('idx_member_role_changes_user_created').on(table.userId, table.createdAt)],
)

/**
 * passkey-authentication: WebAuthn credential store owned by
 * `@better-auth/passkey` plugin. Schema mirrors the plugin's emitted layout;
 * this drizzle declaration is primarily for application-layer queries (e.g.
 * admin member list joins to check credential type presence).
 *
 * `userId` references `user.id` (better-auth-owned, not in this file) with
 * `ON DELETE CASCADE` — removing a user purges all their passkeys. See
 * migration 0009.
 */
export const passkey = sqliteTable(
  'passkey',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('publicKey').notNull(),
    userId: text('userId').notNull(),
    credentialID: text('credentialID').notNull(),
    counter: integer('counter').notNull().default(0),
    deviceType: text('deviceType').notNull(),
    backedUp: integer('backedUp', { mode: 'boolean' }).notNull().default(false),
    transports: text('transports'),
    createdAt: integer('createdAt', { mode: 'timestamp_ms' }),
    aaguid: text('aaguid'),
  },
  (table) => [
    uniqueIndex('passkey_credentialID_idx').on(table.credentialID),
    index('passkey_userId_idx').on(table.userId),
  ],
)

/**
 * drizzle-refactor-credentials-admin-members (TD-010): better-auth's session
 * table is NOT emitted into `.nuxt/better-auth/schema.sqlite.ts` (the
 * generator only exports `user` and `account`). This drizzle declaration
 * mirrors the SQL shape from migrations 0007 / 0009 so the admin-member-list
 * handler can drive `MAX(session.updatedAt)` via drizzle query builder
 * instead of `db.all(sql\`...\`)` raw SQL.
 *
 * `createdAt` / `updatedAt` are TEXT (not `timestamp_ms`) because the
 * migrations preserved the better-auth historical storage type for session
 * rows. Downstream `toIsoOrNull` normalises the ISO-string / numeric shape
 * back to a Date.
 */
export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    token: text('token').notNull().unique(),
    expiresAt: text('expiresAt').notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    createdAt: text('createdAt').notNull().default(timestampNow),
    updatedAt: text('updatedAt').notNull().default(timestampNow),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)
