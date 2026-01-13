import { getAllowedAccessLevels } from './knowledge-runtime'

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T>(): Promise<T | null>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export class McpReplayError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
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

  if (!citation) {
    throw new McpReplayError('The requested citation was not found', 404)
  }

  const allowedAccessLevels = getAllowedAccessLevels({
    channel: 'mcp',
    isAuthenticated: true,
    tokenScopes: input.auth.scopes,
  })

  if (!allowedAccessLevels.includes(citation.accessLevel)) {
    throw new McpReplayError('The requested citation requires knowledge.restricted.read', 403)
  }

  return {
    chunkText: citation.chunkTextSnapshot,
    citationId: citation.citationId,
    citationLocator: citation.citationLocator,
  }
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
  }
}
