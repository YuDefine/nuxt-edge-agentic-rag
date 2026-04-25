/**
 * Conversation store (governance-refinements §1.3 / §1.4 / §1.5).
 *
 * Centralises list / detail / delete so every surface that returns
 * conversation data applies the **same** `deleted_at IS NULL` filter and the
 * same ownership check. Routes MUST go through this store — direct SQL that
 * forgets the filter is exactly what the governance spec forbids.
 *
 * `softDeleteForUser` implements the governance §1.4 purge policy inline:
 *
 *   1. Write `deleted_at` on the conversation row.
 *   2. Replace `title` with a deterministic placeholder
 *      (`DELETED_CONVERSATION_TITLE`) so it cannot leak raw user input even
 *      if a buggy surface forgets to apply the `deleted_at IS NULL` filter.
 *   3. NULL out `messages.content_text` for every message under the
 *      conversation so UI / API / future model-context readers never
 *      recover the raw text.
 *
 * `content_redacted` is intentionally preserved across delete (governance
 * §1.5 audit-safe residue). Anything consuming `content_redacted` is
 * audit-scoped by contract and MUST NOT surface it back into user-visible
 * paths. The `getUserVisibleMessageContent` helper exists to make that
 * boundary explicit — any reader that wants user-visible content MUST go
 * through it instead of reading `content_redacted` directly.
 */

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  all<T>(): Promise<{ results?: T[] }>
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>
}

export interface ConversationSummary {
  id: string
  title: string
  accessLevel: string
  createdAt: string
  updatedAt: string
  userProfileId: string | null
}

export interface ConversationMessageSummary {
  id: string
  role: string
  /**
   * Audit-safe redacted copy. Always present. MUST NOT be surfaced to
   * user/model-context paths — use `contentText` + `getUserVisibleMessageContent`
   * instead.
   */
  contentRedacted: string
  /**
   * User-visible raw content. `null` when the owning conversation has been
   * soft-deleted (governance §1.4 purge applied) or when the row pre-dates
   * the §1.4 migration and has no raw copy to surface.
   */
  contentText: string | null
  citationsJson: string
  /**
   * persist-refusal-and-label-new-chat: true when this assistant turn
   * ended in a refusal (audit-block, pipeline refusal, pipeline error).
   * Sourced from `messages.refused`. User / system rows and accepted
   * answers are always false. Reload UIs use this flag — not content
   * string matching — to render `RefusalMessage.vue`.
   */
  refused: boolean
  /**
   * persist-refusal-and-label-new-chat: specific RefusalReason for refusal
   * rows; `null` for user / system / accepted-assistant rows. Reload UI
   * uses this to render reason-specific copy in `RefusalMessage.vue`.
   */
  refusalReason: string | null
  createdAt: string
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessageSummary[]
}

export interface ConversationListOptions {
  userProfileId: string
  limit?: number
}

export interface ConversationDeleteResult {
  conversationId: string
  deletedAt: string
  alreadyDeleted: boolean
}

export interface ConversationCreateInput {
  userProfileId: string
  /**
   * Optional title. When omitted, the store uses the default
   * `'New conversation'` label baked into the `conversations.title` DB
   * default. Callers who want a smarter label (e.g. first 40 chars of the
   * opening query) SHOULD derive it themselves and pass it in — the store
   * deliberately does not truncate for them so the contract stays boring.
   */
  title?: string
  accessLevel?: string
  /** Allows tests (and future auto-create flows) to inject a deterministic id. */
  id?: string
  now?: Date
}

export interface ConversationCreateResult {
  id: string
  userProfileId: string
  accessLevel: string
  title: string
  createdAt: string
  updatedAt: string
}

const DEFAULT_LIST_LIMIT = 50
const DEFAULT_ACCESS_LEVEL = 'internal'
const DEFAULT_TITLE = 'New conversation'

/**
 * Placeholder title written in place of the user's original title when a
 * conversation is soft-deleted. `conversations.title` is NOT NULL, so we
 * cannot clear it; a stable placeholder also makes audit export paths
 * visually obvious ("this row was purged"). Keep this value stable — any
 * change is an observable surface change for audit/export tooling.
 */
export const DELETED_CONVERSATION_TITLE = '[Deleted conversation]'

/**
 * Safe boundary for any reader that wants user-visible message content.
 *
 * Callers MUST use this helper instead of reading `content_redacted`
 * directly — redacted content is audit-scoped (governance §1.5) and must
 * not be reused for user UI, future multi-turn model context assembly, or
 * any other user-facing surface. When `content_text` is NULL (purged by
 * soft-delete, or pre-migration legacy row), this helper returns `null`
 * and callers must treat the content as unavailable.
 */
export function getUserVisibleMessageContent(row: { contentText: string | null }): string | null {
  return row.contentText ?? null
}

export function createConversationStore(database: D1DatabaseLike) {
  async function listForUser(options: ConversationListOptions): Promise<ConversationSummary[]> {
    const limit = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, 200)
    const rows = await database
      .prepare(
        [
          'SELECT id, user_profile_id, access_level, title, created_at, updated_at',
          'FROM conversations',
          'WHERE user_profile_id = ?',
          '  AND deleted_at IS NULL',
          'ORDER BY updated_at DESC',
          'LIMIT ?',
        ].join('\n'),
      )
      .bind(options.userProfileId, limit)
      .all<{
        id: string
        user_profile_id: string | null
        access_level: string
        title: string
        created_at: string
        updated_at: string
      }>()

    return (rows.results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      accessLevel: row.access_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      userProfileId: row.user_profile_id,
    }))
  }

  async function getForUser(input: {
    conversationId: string
    userProfileId: string
  }): Promise<ConversationDetail | null> {
    const conversationRow = await database
      .prepare(
        [
          'SELECT id, user_profile_id, access_level, title, created_at, updated_at',
          'FROM conversations',
          'WHERE id = ?',
          '  AND user_profile_id = ?',
          '  AND deleted_at IS NULL',
          'LIMIT 1',
        ].join('\n'),
      )
      .bind(input.conversationId, input.userProfileId)
      .first<{
        id: string
        user_profile_id: string | null
        access_level: string
        title: string
        created_at: string
        updated_at: string
      }>()

    if (!conversationRow) {
      return null
    }

    const messageRows = await database
      .prepare(
        [
          'SELECT id, role, content_redacted, content_text, citations_json, refused, refusal_reason, created_at',
          'FROM messages',
          'WHERE conversation_id = ?',
          'ORDER BY created_at ASC',
        ].join('\n'),
      )
      .bind(conversationRow.id)
      .all<{
        id: string
        role: string
        content_redacted: string
        content_text: string | null
        citations_json: string | null
        refused: number | null
        refusal_reason: string | null
        created_at: string
      }>()

    const messages: ConversationMessageSummary[] = (messageRows.results ?? []).map((row) => ({
      id: row.id,
      role: row.role,
      contentRedacted: row.content_redacted,
      contentText: row.content_text ?? null,
      citationsJson: row.citations_json ?? '[]',
      refused: row.refused === 1,
      refusalReason: row.refusal_reason ?? null,
      createdAt: row.created_at,
    }))

    return {
      id: conversationRow.id,
      title: conversationRow.title,
      accessLevel: conversationRow.access_level,
      createdAt: conversationRow.created_at,
      updatedAt: conversationRow.updated_at,
      userProfileId: conversationRow.user_profile_id,
      messages,
    }
  }

  async function softDeleteForUser(input: {
    conversationId: string
    userProfileId: string
    now?: Date
  }): Promise<ConversationDeleteResult | null> {
    const existing = await database
      .prepare(
        [
          'SELECT id, deleted_at',
          'FROM conversations',
          'WHERE id = ?',
          '  AND user_profile_id = ?',
          'LIMIT 1',
        ].join('\n'),
      )
      .bind(input.conversationId, input.userProfileId)
      .first<{ id: string; deleted_at: string | null }>()

    if (!existing) {
      return null
    }

    if (existing.deleted_at) {
      return {
        conversationId: existing.id,
        deletedAt: existing.deleted_at,
        alreadyDeleted: true,
      }
    }

    const deletedAt = (input.now ?? new Date()).toISOString()

    // Governance §1.4: soft-delete writes the tombstone AND purges user-
    // visible content atomically. Use `database.batch(...)` so both
    // statements succeed or fail together — D1's batch API wraps the
    // statements in a single implicit transaction, which closes the
    // previous "conversation hidden but messages.content_text still on
    // disk" failure mode.
    //
    // Ordering within the batch is irrelevant for correctness because D1
    // applies them atomically; we keep "conversations first, messages
    // second" for readability matching the governance spec narrative.
    await database.batch([
      database
        .prepare('UPDATE conversations SET deleted_at = ?, updated_at = ?, title = ? WHERE id = ?')
        .bind(deletedAt, deletedAt, DELETED_CONVERSATION_TITLE, existing.id),
      // `content_redacted` is left intact so audit paths still work within
      // the retention window (§1.5 audit-safe residue).
      database
        .prepare('UPDATE messages SET content_text = NULL WHERE conversation_id = ?')
        .bind(existing.id),
    ])

    return {
      conversationId: existing.id,
      deletedAt,
      alreadyDeleted: false,
    }
  }

  /**
   * Creates a new conversation owned by `userProfileId` and returns the
   * canonical row. Used by:
   *
   * - `/api/chat` auto-create path (governance §1.7): when the caller POSTs
   *   `/api/chat` without a `conversationId`, the handler creates one here
   *   before persisting messages, so follow-up turns can reference the same
   *   id.
   * - Future explicit POST `/api/conversations` endpoint (not exposed yet):
   *   same helper, no duplicate SQL.
   *
   * The store never re-uses an id — each call produces a fresh row. Callers
   * that want idempotency MUST supply `input.id` themselves.
   */
  async function createForUser(input: ConversationCreateInput): Promise<ConversationCreateResult> {
    const id = input.id ?? crypto.randomUUID()
    const createdAt = (input.now ?? new Date()).toISOString()
    const title = (input.title ?? '').trim() || DEFAULT_TITLE
    const accessLevel = input.accessLevel ?? DEFAULT_ACCESS_LEVEL

    await database
      .prepare(
        [
          'INSERT INTO conversations',
          '  (id, user_profile_id, access_level, title, created_at, updated_at, deleted_at)',
          'VALUES (?, ?, ?, ?, ?, ?, NULL)',
        ].join('\n'),
      )
      .bind(id, input.userProfileId, accessLevel, title, createdAt, createdAt)
      .run()

    return {
      id,
      userProfileId: input.userProfileId,
      accessLevel,
      title,
      createdAt,
      updatedAt: createdAt,
    }
  }

  /**
   * Exposed for chat orchestration: checks that the conversation is visible
   * (not soft-deleted and owned by the caller) before the chat handler
   * threads follow-up context through retrieval. Returns `false` if the
   * conversation is deleted or does not belong to the user.
   */
  async function isVisibleForUser(input: {
    conversationId: string
    userProfileId: string
  }): Promise<boolean> {
    const row = await database
      .prepare(
        [
          'SELECT 1 AS exists_flag',
          'FROM conversations',
          'WHERE id = ?',
          '  AND user_profile_id = ?',
          '  AND deleted_at IS NULL',
          'LIMIT 1',
        ].join('\n'),
      )
      .bind(input.conversationId, input.userProfileId)
      .first<{ exists_flag: number }>()

    return row !== null
  }

  return {
    listForUser,
    getForUser,
    createForUser,
    softDeleteForUser,
    isVisibleForUser,
  }
}

export type ConversationStore = ReturnType<typeof createConversationStore>
