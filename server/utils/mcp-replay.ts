import { getAllowedAccessLevels } from './knowledge-runtime'

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T>(): Promise<T | null>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

/**
 * Reason codes returned alongside an `McpReplayError`. Consumers (route
 * handlers, MCP bridge, audit store) can distinguish sub-states without
 * changing the HTTP status code contract.
 *
 * Per `mcp-knowledge-tools` spec Requirement: Stateless Ask And Replay,
 * `getDocumentChunk` returns 404 whenever a citation is "absent or no longer
 * replayable" and 403 for restricted scope failures. Those status codes are
 * fixed; this enum lives alongside them so the audit trail can tell apart
 * "row never existed / already deleted" from "row survived but the snapshot
 * was scrubbed by retention cleanup".
 *
 * See:
 *  - `openspec/changes/bootstrap-v1-core-from-report/specs/mcp-knowledge-tools/spec.md`
 *  - `openspec/changes/governance-refinements/specs/retention-cleanup-governance/spec.md`
 *  - `docs/verify/RETENTION_REPLAY_CONTRACT.md`
 */
export type McpReplayErrorReason =
  | 'chunk_not_found'
  | 'chunk_retention_expired'
  | 'restricted_scope_required'

export class McpReplayError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly reason: McpReplayErrorReason = 'chunk_not_found'
  ) {
    super(message)
    this.name = 'McpReplayError'
  }
}

export async function getDocumentChunk(
  input: {
    auth: {
      scopes: string[]
      tokenId: string
    }
    citationId: string
  },
  options: {
    replayStore: {
      findReplayableCitationById(citationId: string): Promise<{
        accessLevel: string
        chunkTextSnapshot: string
        citationId: string
        citationLocator: string
      } | null>
    }
  }
): Promise<{
  chunkText: string
  citationId: string
  citationLocator: string
}> {
  const citation = await options.replayStore.findReplayableCitationById(input.citationId)

  // Citation row missing entirely — either never persisted or the row was
  // already reaped by the citation_records retention step (expires_at <= now).
  // We surface this as 404 `chunk_not_found` and deliberately do NOT leak
  // whether the id ever existed at any point in history.
  if (!citation) {
    throw new McpReplayError('The requested citation was not found', 404, 'chunk_not_found')
  }

  const allowedAccessLevels = getAllowedAccessLevels({
    channel: 'mcp',
    isAuthenticated: true,
    tokenScopes: input.auth.scopes,
  })

  if (!allowedAccessLevels.includes(citation.accessLevel)) {
    throw new McpReplayError(
      'The requested citation requires knowledge.restricted.read',
      403,
      'restricted_scope_required'
    )
  }

  // Defensive guard: if a citation row survives but its `chunk_text_snapshot`
  // is empty (e.g. a future governance sweep also scrubs citation snapshots,
  // or a migration landed an empty snapshot), we treat the chunk as
  // retention-expired.
  //
  // Per `mcp-knowledge-tools` spec, HTTP status stays `404` (aligned with
  // "absent or no longer replayable") so that 410 semantics do not leak an
  // extra existence signal beyond what the spec allows. The `reason` field
  // (`chunk_retention_expired`) lets audit callers tell this apart from
  // `chunk_not_found` without changing the wire-level contract.
  if (citation.chunkTextSnapshot === '') {
    throw new McpReplayError('The requested citation was not found', 404, 'chunk_retention_expired')
  }

  return {
    chunkText: citation.chunkTextSnapshot,
    citationId: citation.citationId,
    citationLocator: citation.citationLocator,
  }
}

export interface WebReplayableCitation {
  accessLevel: string
  chunkTextSnapshot: string
  citationId: string
  citationLocator: string
  documentId: string
  documentTitle: string
  documentVersionId: string
  expiresAt: string
  isCurrentVersion: boolean
  queryLogId: string
  sourceChunkId: string
  versionNumber: number
}

export function createMcpReplayStore(database: D1DatabaseLike) {
  return {
    async findReplayableCitationById(citationId: string): Promise<{
      accessLevel: string
      chunkTextSnapshot: string
      citationId: string
      citationLocator: string
    } | null> {
      const now = new Date().toISOString()
      const row = await database
        .prepare(
          [
            'SELECT',
            '  cr.id AS citation_id,',
            '  cr.citation_locator AS citation_locator,',
            '  cr.chunk_text_snapshot AS chunk_text_snapshot,',
            '  sc.access_level AS access_level',
            'FROM citation_records cr',
            'INNER JOIN source_chunks sc ON sc.id = cr.source_chunk_id',
            'WHERE cr.id = ?',
            '  AND cr.expires_at > ?',
            'LIMIT 1',
          ].join('\n')
        )
        .bind(citationId, now)
        .first<{
          access_level: string
          chunk_text_snapshot: string
          citation_id: string
          citation_locator: string
        }>()

      if (!row) {
        return null
      }

      return {
        accessLevel: row.access_level,
        chunkTextSnapshot: row.chunk_text_snapshot,
        citationId: row.citation_id,
        citationLocator: row.citation_locator,
      }
    },

    async findWebReplayableCitationById(citationId: string): Promise<WebReplayableCitation | null> {
      const now = new Date().toISOString()
      const row = await database
        .prepare(
          [
            'SELECT',
            '  cr.id AS citation_id,',
            '  cr.citation_locator AS citation_locator,',
            '  cr.chunk_text_snapshot AS chunk_text_snapshot,',
            '  cr.query_log_id AS query_log_id,',
            '  cr.source_chunk_id AS source_chunk_id,',
            '  cr.document_version_id AS document_version_id,',
            '  cr.expires_at AS expires_at,',
            '  sc.access_level AS access_level,',
            '  dv.version_number AS version_number,',
            '  d.id AS document_id,',
            '  d.title AS document_title,',
            '  d.current_version_id AS current_version_id',
            'FROM citation_records cr',
            'INNER JOIN source_chunks sc ON sc.id = cr.source_chunk_id',
            'INNER JOIN document_versions dv ON dv.id = cr.document_version_id',
            'INNER JOIN documents d ON d.id = dv.document_id',
            'WHERE cr.id = ?',
            '  AND cr.expires_at > ?',
            'LIMIT 1',
          ].join('\n')
        )
        .bind(citationId, now)
        .first<{
          access_level: string
          chunk_text_snapshot: string
          citation_id: string
          citation_locator: string
          current_version_id: string | null
          document_id: string
          document_title: string
          document_version_id: string
          expires_at: string
          query_log_id: string
          source_chunk_id: string
          version_number: number
        }>()

      if (!row) {
        return null
      }

      return {
        accessLevel: row.access_level,
        chunkTextSnapshot: row.chunk_text_snapshot,
        citationId: row.citation_id,
        citationLocator: row.citation_locator,
        documentId: row.document_id,
        documentTitle: row.document_title,
        documentVersionId: row.document_version_id,
        expiresAt: row.expires_at,
        isCurrentVersion: row.current_version_id === row.document_version_id,
        queryLogId: row.query_log_id,
        sourceChunkId: row.source_chunk_id,
        versionNumber: row.version_number,
      }
    },
  }
}
