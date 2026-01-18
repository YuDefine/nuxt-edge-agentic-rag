import type { DocumentWithCurrentVersion } from '../../shared/types/knowledge'

export type { DocumentWithCurrentVersion } from '../../shared/types/knowledge'

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  all<T>(): Promise<{ results?: T[] }>
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

interface DocumentWithVersionRow {
  access_level: string
  archived_at: string | null
  category_slug: string
  created_at: string
  current_version_id: string | null
  cv_id: string | null
  cv_index_status: string | null
  cv_published_at: string | null
  cv_sync_status: string | null
  cv_version_number: number | null
  id: string
  slug: string
  status: string
  title: string
  updated_at: string
}

function fromDocumentWithVersionRow(row: DocumentWithVersionRow): DocumentWithCurrentVersion {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    categorySlug: row.category_slug,
    accessLevel: row.access_level as 'internal' | 'restricted',
    status: row.status as 'draft' | 'active' | 'archived',
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    currentVersion: row.cv_id
      ? {
          id: row.cv_id,
          versionNumber: row.cv_version_number ?? 0,
          syncStatus: (row.cv_sync_status ?? 'pending') as
            | 'pending'
            | 'running'
            | 'synced'
            | 'failed',
          indexStatus: (row.cv_index_status ?? 'pending') as
            | 'pending'
            | 'preprocessing'
            | 'indexing'
            | 'indexed'
            | 'failed',
          publishedAt: row.cv_published_at,
        }
      : null,
  }
}

export function createDocumentListStore(database: D1DatabaseLike) {
  return {
    async listDocumentsWithCurrentVersion(): Promise<DocumentWithCurrentVersion[]> {
      const response = await database
        .prepare(
          [
            'SELECT',
            '  d.id,',
            '  d.slug,',
            '  d.title,',
            '  d.category_slug,',
            '  d.access_level,',
            '  d.status,',
            '  d.current_version_id,',
            '  d.created_at,',
            '  d.updated_at,',
            '  d.archived_at,',
            '  cv.id AS cv_id,',
            '  cv.version_number AS cv_version_number,',
            '  cv.sync_status AS cv_sync_status,',
            '  cv.index_status AS cv_index_status,',
            '  cv.published_at AS cv_published_at',
            'FROM documents d',
            'LEFT JOIN document_versions cv ON d.current_version_id = cv.id',
            'ORDER BY d.updated_at DESC',
          ].join('\n')
        )
        .all<DocumentWithVersionRow>()

      return (response.results ?? []).map(fromDocumentWithVersionRow)
    },
  }
}
