interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T>(): Promise<T | null>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

export function createKnowledgeEvidenceStore(database: D1DatabaseLike) {
  return {
    async resolveCurrentEvidence(input: {
      allowedAccessLevels: string[]
      citationLocator: string
      documentVersionId: string
    }): Promise<{
      accessLevel: string
      categorySlug: string
      chunkText: string
      citationLocator: string
      documentId: string
      documentTitle: string
      documentVersionId: string
      sourceChunkId: string
    } | null> {
      if (input.allowedAccessLevels.length === 0) {
        return null
      }

      const placeholders = input.allowedAccessLevels.map(() => '?').join(', ')
      const row = await database
        .prepare(
          [
            'SELECT',
            '  d.id AS document_id,',
            '  d.title AS document_title,',
            '  d.category_slug AS category_slug,',
            '  v.id AS document_version_id,',
            '  s.id AS source_chunk_id,',
            '  s.access_level AS access_level,',
            '  s.chunk_text AS chunk_text,',
            '  s.citation_locator AS citation_locator',
            'FROM source_chunks s',
            'INNER JOIN document_versions v ON v.id = s.document_version_id',
            'INNER JOIN documents d ON d.id = v.document_id',
            'WHERE v.id = ?',
            '  AND s.citation_locator = ?',
            "  AND d.status = 'active'",
            "  AND v.index_status = 'indexed'",
            '  AND v.is_current = 1',
            `  AND s.access_level IN (${placeholders})`,
            'LIMIT 1',
          ].join('\n')
        )
        .bind(input.documentVersionId, input.citationLocator, ...input.allowedAccessLevels)
        .first<{
          access_level: string
          category_slug: string
          chunk_text: string
          citation_locator: string
          document_id: string
          document_title: string
          document_version_id: string
          source_chunk_id: string
        }>()

      if (!row) {
        return null
      }

      return {
        accessLevel: row.access_level,
        categorySlug: row.category_slug,
        chunkText: row.chunk_text,
        citationLocator: row.citation_locator,
        documentId: row.document_id,
        documentTitle: row.document_title,
        documentVersionId: row.document_version_id,
        sourceChunkId: row.source_chunk_id,
      }
    },
  }
}
