interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export function createCitationStore(database: D1DatabaseLike) {
  return {
    async persistCitations(input: {
      citations: Array<{
        chunkTextSnapshot: string
        citationLocator: string
        documentVersionId: string
        queryLogId: string
        sourceChunkId: string
      }>
      now?: Date
      retentionDays?: number
    }): Promise<Array<{ citationId: string; documentVersionId: string; sourceChunkId: string }>> {
      const now = input.now ?? new Date()
      const retentionDays = input.retentionDays ?? 180
      const expiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString()
      const persisted: Array<{
        citationId: string
        documentVersionId: string
        sourceChunkId: string
      }> = []

      for (const citation of input.citations) {
        const citationId = crypto.randomUUID()

        await database
          .prepare(
            [
              'INSERT INTO citation_records (',
              '  id, query_log_id, document_version_id, source_chunk_id, citation_locator, chunk_text_snapshot, created_at, expires_at',
              ') VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            ].join('\n')
          )
          .bind(
            citationId,
            citation.queryLogId,
            citation.documentVersionId,
            citation.sourceChunkId,
            citation.citationLocator,
            citation.chunkTextSnapshot,
            now.toISOString(),
            expiresAt
          )
          .run()

        persisted.push({
          citationId,
          documentVersionId: citation.documentVersionId,
          sourceChunkId: citation.sourceChunkId,
        })
      }

      return persisted
    },
  }
}
