/**
 * Stale conversation resolver (governance-refinements §1.1).
 *
 * Contract:
 *
 * - Reads the most recent assistant `messages` row for the given conversation.
 * - Parses its `citations_json` to collect every cited `document_version_id`.
 * - Cross-checks each cited version against D1 `document_versions.is_current`.
 * - If **any** cited version is no longer `is_current`, the conversation is
 *   considered **stale** and the next follow-up MUST fall back to fresh
 *   retrieval instead of treating the cached citation chain as truth.
 *
 * The resolver never mutates anything; freshness is re-computed on every call
 * so a downstream cache layer (if introduced later) stays purely derivative,
 * as required by the design (`Conversation Lifecycle Is Dynamic, Not Cached
 * Truth`).
 */

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  all<T>(): Promise<{ results?: T[] }>
  first<T>(): Promise<T | null>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export interface StaleResolverLatestAssistantMessage {
  id: string
  createdAt: string
  citedDocumentVersionIds: string[]
}

export interface StaleResolverResult {
  conversationId: string
  /** `true` when no assistant message has been persisted yet — treat as not stale. */
  hasAssistantHistory: boolean
  /** `true` when at least one cited document_version_id is no longer `is_current`. */
  isStale: boolean
  /** document_version_id values that are no longer current (subset of citedDocumentVersionIds). */
  staleDocumentVersionIds: string[]
  latestAssistantMessage: StaleResolverLatestAssistantMessage | null
}

interface RawMessageRow {
  id: string
  created_at: string
  citations_json: string | null
}

interface RawVersionRow {
  id: string
  is_current: number
}

/**
 * Safely parse the cited `document_version_id` values from a persisted
 * assistant message's `citations_json` column.
 *
 * Accepts two canonical shapes:
 *
 * 1. `[{ documentVersionId: 'ver-1', ... }, ...]` — the shape used by
 *    `citation_records`-like payloads that the chat orchestration passes
 *    back to the message audit store.
 * 2. `["ver-1", "ver-2"]` — a compact string-array shape some older tests
 *    may persist.
 *
 * Anything else is treated as "no citations" so a malformed row never
 * crashes the resolver — the resolver's job is to fall back to fresh
 * retrieval anyway.
 */
export function parseCitedDocumentVersionIds(citationsJson: string | null): string[] {
  if (!citationsJson) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(citationsJson)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) {
    return []
  }

  const ids = new Set<string>()

  for (const entry of parsed) {
    if (typeof entry === 'string' && entry) {
      ids.add(entry)
      continue
    }

    if (entry && typeof entry === 'object') {
      const candidate = (entry as { documentVersionId?: unknown }).documentVersionId

      if (typeof candidate === 'string' && candidate) {
        ids.add(candidate)
      }
    }
  }

  return [...ids]
}

export function createConversationStaleResolver(database: D1DatabaseLike) {
  async function resolveStaleness(input: { conversationId: string }): Promise<StaleResolverResult> {
    const latest = await database
      .prepare(
        [
          'SELECT id, created_at, citations_json',
          'FROM messages',
          'WHERE conversation_id = ?',
          "  AND role = 'assistant'",
          'ORDER BY created_at DESC',
          'LIMIT 1',
        ].join('\n'),
      )
      .bind(input.conversationId)
      .first<RawMessageRow>()

    if (!latest) {
      return {
        conversationId: input.conversationId,
        hasAssistantHistory: false,
        isStale: false,
        staleDocumentVersionIds: [],
        latestAssistantMessage: null,
      }
    }

    const citedDocumentVersionIds = parseCitedDocumentVersionIds(latest.citations_json)

    if (citedDocumentVersionIds.length === 0) {
      // Assistant spoke but did not cite anything (e.g. refusal). We have no
      // version to re-validate, so the conversation is not stale by
      // definition — the follow-up path can safely continue without fresh
      // retrieval being forced.
      return {
        conversationId: input.conversationId,
        hasAssistantHistory: true,
        isStale: false,
        staleDocumentVersionIds: [],
        latestAssistantMessage: {
          id: latest.id,
          createdAt: latest.created_at,
          citedDocumentVersionIds,
        },
      }
    }

    const placeholders = citedDocumentVersionIds.map(() => '?').join(', ')
    const versionRows = await database
      .prepare(
        ['SELECT id, is_current', 'FROM document_versions', `WHERE id IN (${placeholders})`].join(
          '\n',
        ),
      )
      .bind(...citedDocumentVersionIds)
      .all<RawVersionRow>()

    const versionCurrency = new Map<string, boolean>()

    for (const row of versionRows.results ?? []) {
      versionCurrency.set(row.id, Number(row.is_current) === 1)
    }

    const staleDocumentVersionIds = citedDocumentVersionIds.filter((documentVersionId) => {
      // Unknown version id (deleted or never existed) counts as stale — we
      // cannot prove the citation still points at current truth.
      const isCurrent = versionCurrency.get(documentVersionId)

      return isCurrent !== true
    })

    return {
      conversationId: input.conversationId,
      hasAssistantHistory: true,
      isStale: staleDocumentVersionIds.length > 0,
      staleDocumentVersionIds,
      latestAssistantMessage: {
        id: latest.id,
        createdAt: latest.created_at,
        citedDocumentVersionIds,
      },
    }
  }

  return {
    resolveStaleness,
  }
}

export type ConversationStaleResolver = ReturnType<typeof createConversationStaleResolver>
