import type { DocumentRecord, DocumentVersionRecord } from '#shared/types/knowledge'

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

interface D1DatabaseLike {
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>
  prepare(query: string): D1PreparedStatementLike
}

function fromDocumentRow(row: {
  access_level: string
  archived_at: string | null
  category_slug: string
  created_at: string
  created_by_user_id: string | null
  current_version_id: string | null
  id: string
  slug: string
  status: string
  title: string
  updated_at: string
}): DocumentRecord {
  return {
    accessLevel: row.access_level,
    archivedAt: row.archived_at,
    categorySlug: row.category_slug,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
    currentVersionId: row.current_version_id,
    id: row.id,
    slug: row.slug,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  }
}

function fromDocumentVersionRow(row: {
  created_at: string
  document_id: string
  id: string
  index_status: string
  is_current: number
  metadata_json: string
  normalized_text_r2_key: string | null
  published_at: string | null
  smoke_test_queries_json: string
  source_r2_key: string
  sync_status: string
  updated_at: string
  version_number: number
}): DocumentVersionRecord {
  return {
    createdAt: row.created_at,
    documentId: row.document_id,
    id: row.id,
    indexStatus: row.index_status,
    isCurrent: row.is_current === 1,
    metadataJson: row.metadata_json,
    normalizedTextR2Key: row.normalized_text_r2_key,
    publishedAt: row.published_at,
    smokeTestQueriesJson: row.smoke_test_queries_json,
    sourceR2Key: row.source_r2_key,
    syncStatus: row.sync_status,
    updatedAt: row.updated_at,
    versionNumber: row.version_number,
  }
}

export function createDocumentSyncStore(database: D1DatabaseLike) {
  return {
    async createDocument(input: {
      accessLevel: string
      categorySlug: string
      createdByUserId: string
      slug: string
      status: string
      title: string
    }): Promise<DocumentRecord> {
      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      await database
        .prepare(
          [
            'INSERT INTO documents (',
            '  id, slug, title, category_slug, access_level, status, created_by_user_id, created_at, updated_at',
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ].join('\n')
        )
        .bind(
          id,
          input.slug,
          input.title,
          input.categorySlug,
          input.accessLevel,
          input.status,
          input.createdByUserId,
          now,
          now
        )
        .run()

      return {
        accessLevel: input.accessLevel,
        archivedAt: null,
        categorySlug: input.categorySlug,
        createdAt: now,
        createdByUserId: input.createdByUserId,
        currentVersionId: null,
        id,
        slug: input.slug,
        status: input.status,
        title: input.title,
        updatedAt: now,
      }
    },

    async createSourceChunks(
      documentVersionId: string,
      chunks: Array<{
        accessLevel: string
        chunkHash: string
        chunkIndex: number
        chunkText: string
        citationLocator: string
        metadata: Record<string, number>
      }>
    ): Promise<void> {
      for (const chunk of chunks) {
        await database
          .prepare(
            [
              'INSERT INTO source_chunks (',
              '  id, document_version_id, chunk_index, chunk_hash, chunk_text, citation_locator, access_level, metadata_json',
              ') VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            ].join('\n')
          )
          .bind(
            crypto.randomUUID(),
            documentVersionId,
            chunk.chunkIndex,
            chunk.chunkHash,
            chunk.chunkText,
            chunk.citationLocator,
            chunk.accessLevel,
            JSON.stringify(chunk.metadata)
          )
          .run()
      }
    },

    async createVersion(input: {
      documentId: string
      id: string
      indexStatus: string
      metadataJson: string
      normalizedTextR2Key: string
      sourceR2Key: string
      smokeTestQueriesJson: string
      syncStatus: string
      versionNumber: number
    }): Promise<DocumentVersionRecord> {
      const now = new Date().toISOString()

      await database
        .prepare(
          [
            'INSERT INTO document_versions (',
            '  id, document_id, version_number, source_r2_key, normalized_text_r2_key, metadata_json, smoke_test_queries_json, index_status, sync_status, created_at, updated_at',
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ].join('\n')
        )
        .bind(
          input.id,
          input.documentId,
          input.versionNumber,
          input.sourceR2Key,
          input.normalizedTextR2Key,
          input.metadataJson,
          input.smokeTestQueriesJson,
          input.indexStatus,
          input.syncStatus,
          now,
          now
        )
        .run()

      return {
        createdAt: now,
        documentId: input.documentId,
        id: input.id,
        indexStatus: input.indexStatus,
        isCurrent: false,
        metadataJson: input.metadataJson,
        normalizedTextR2Key: input.normalizedTextR2Key,
        publishedAt: null,
        smokeTestQueriesJson: input.smokeTestQueriesJson,
        sourceR2Key: input.sourceR2Key,
        syncStatus: input.syncStatus,
        updatedAt: now,
        versionNumber: input.versionNumber,
      }
    },

    async findDocumentBySlug(slug: string): Promise<DocumentRecord | null> {
      const row = await database
        .prepare(
          [
            'SELECT',
            '  id, slug, title, category_slug, access_level, status, current_version_id, created_by_user_id, created_at, updated_at, archived_at',
            'FROM documents',
            'WHERE slug = ?',
            'LIMIT 1',
          ].join('\n')
        )
        .bind(slug)
        .first<{
          access_level: string
          archived_at: string | null
          category_slug: string
          created_at: string
          created_by_user_id: string | null
          current_version_id: string | null
          id: string
          slug: string
          status: string
          title: string
          updated_at: string
        }>()

      return row ? fromDocumentRow(row) : null
    },

    async findDocumentById(documentId: string): Promise<DocumentRecord | null> {
      const row = await database
        .prepare(
          [
            'SELECT',
            '  id, slug, title, category_slug, access_level, status, current_version_id, created_by_user_id, created_at, updated_at, archived_at',
            'FROM documents',
            'WHERE id = ?',
            'LIMIT 1',
          ].join('\n')
        )
        .bind(documentId)
        .first<{
          access_level: string
          archived_at: string | null
          category_slug: string
          created_at: string
          created_by_user_id: string | null
          current_version_id: string | null
          id: string
          slug: string
          status: string
          title: string
          updated_at: string
        }>()

      return row ? fromDocumentRow(row) : null
    },

    async getNextVersionNumber(documentId: string): Promise<number> {
      const row = await database
        .prepare(
          [
            'SELECT COALESCE(MAX(version_number), 0) AS current_max',
            'FROM document_versions',
            'WHERE document_id = ?',
          ].join('\n')
        )
        .bind(documentId)
        .first<{ current_max: number }>()

      return (row?.current_max ?? 0) + 1
    },

    async findVersionById(versionId: string): Promise<DocumentVersionRecord | null> {
      const row = await database
        .prepare(
          [
            'SELECT',
            '  id, document_id, version_number, source_r2_key, normalized_text_r2_key, metadata_json, smoke_test_queries_json, index_status, sync_status, is_current, published_at, created_at, updated_at',
            'FROM document_versions',
            'WHERE id = ?',
            'LIMIT 1',
          ].join('\n')
        )
        .bind(versionId)
        .first<{
          created_at: string
          document_id: string
          id: string
          index_status: string
          is_current: number
          metadata_json: string
          normalized_text_r2_key: string | null
          published_at: string | null
          smoke_test_queries_json: string
          source_r2_key: string
          sync_status: string
          updated_at: string
          version_number: number
        }>()

      return row ? fromDocumentVersionRow(row) : null
    },

    async publishVersionAtomic(input: {
      documentId: string
      previousCurrentVersionId: string | null
      promoteToActive: boolean
      publishedAt: string
      versionId: string
    }): Promise<DocumentVersionRecord> {
      const statements: D1PreparedStatementLike[] = [
        database
          .prepare(
            [
              'UPDATE document_versions',
              'SET is_current = 0, updated_at = ?',
              'WHERE document_id = ? AND is_current = 1',
            ].join('\n')
          )
          .bind(input.publishedAt, input.documentId),
        database
          .prepare(
            [
              'UPDATE document_versions',
              'SET is_current = 1, published_at = ?, updated_at = ?',
              'WHERE id = ? AND document_id = ?',
            ].join('\n')
          )
          .bind(input.publishedAt, input.publishedAt, input.versionId, input.documentId),
        database
          .prepare(
            ['UPDATE documents', 'SET current_version_id = ?, updated_at = ?', 'WHERE id = ?'].join(
              '\n'
            )
          )
          .bind(input.versionId, input.publishedAt, input.documentId),
      ]

      if (input.promoteToActive) {
        statements.push(
          database
            .prepare(
              [
                'UPDATE documents',
                "SET status = 'active', updated_at = ?",
                "WHERE id = ? AND status = 'draft'",
              ].join('\n')
            )
            .bind(input.publishedAt, input.documentId)
        )
      }

      await database.batch(statements)

      const publishedVersion = await this.findVersionById(input.versionId)

      if (!publishedVersion) {
        throw new Error('Published version could not be reloaded')
      }

      return publishedVersion
    },
  }
}

export function mapDocumentVersionRow(row: {
  created_at: string
  document_id: string
  id: string
  index_status: string
  is_current: number
  metadata_json: string
  normalized_text_r2_key: string | null
  published_at: string | null
  smoke_test_queries_json: string
  source_r2_key: string
  sync_status: string
  updated_at: string
  version_number: number
}): DocumentVersionRecord {
  return fromDocumentVersionRow(row)
}
