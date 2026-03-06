import { eq, desc } from 'drizzle-orm'
import type { DocumentWithCurrentVersion } from '#shared/types/knowledge'

export interface DocumentVersion {
  id: string
  versionNumber: number
  syncStatus: 'pending' | 'running' | 'synced' | 'failed'
  indexStatus: 'pending' | 'preprocessing' | 'indexing' | 'indexed' | 'failed'
  publishedAt: string | null
  isCurrent: boolean
  createdAt: string
  updatedAt: string
}

export interface DocumentWithAllVersions extends DocumentWithCurrentVersion {
  versions: DocumentVersion[]
}

// DB schema CHECK 允許的值比 UI enum 多（歷史遺留）。
// 這裡把 DB 值正規化到 UI 可處理的 enum，避免 assertNever 在未預期值上 crash。
function normalizeSyncStatus(value: string | null | undefined): DocumentVersion['syncStatus'] {
  switch (value) {
    case 'pending':
    case 'running':
    case 'synced':
    case 'failed':
      return value
    case 'completed':
      return 'synced'
    default:
      return 'pending'
  }
}

function normalizeIndexStatus(value: string | null | undefined): DocumentVersion['indexStatus'] {
  switch (value) {
    case 'pending':
    case 'preprocessing':
    case 'indexing':
    case 'indexed':
    case 'failed':
      return value
    case 'upload_pending':
      return 'pending'
    case 'smoke_pending':
      return 'indexing'
    default:
      return 'pending'
  }
}

function normalizeAccessLevel(value: string): 'internal' | 'restricted' {
  return value === 'restricted' ? 'restricted' : 'internal'
}

function normalizeDocumentStatus(value: string): 'draft' | 'active' | 'archived' {
  switch (value) {
    case 'draft':
    case 'active':
    case 'archived':
      return value
    default:
      return 'draft'
  }
}

/**
 * Document list store using Drizzle ORM (hub:db)
 */
export function createDocumentListStore() {
  return {
    async listDocumentsWithCurrentVersion(): Promise<DocumentWithCurrentVersion[]> {
      const { db, schema } = await import('hub:db')

      // Get all documents with LEFT JOIN to current version
      const rows = await db
        .select({
          id: schema.documents.id,
          slug: schema.documents.slug,
          title: schema.documents.title,
          categorySlug: schema.documents.categorySlug,
          accessLevel: schema.documents.accessLevel,
          status: schema.documents.status,
          currentVersionId: schema.documents.currentVersionId,
          createdAt: schema.documents.createdAt,
          updatedAt: schema.documents.updatedAt,
          archivedAt: schema.documents.archivedAt,
          cvId: schema.documentVersions.id,
          cvVersionNumber: schema.documentVersions.versionNumber,
          cvSyncStatus: schema.documentVersions.syncStatus,
          cvIndexStatus: schema.documentVersions.indexStatus,
          cvPublishedAt: schema.documentVersions.publishedAt,
        })
        .from(schema.documents)
        .leftJoin(
          schema.documentVersions,
          eq(schema.documents.currentVersionId, schema.documentVersions.id)
        )
        .orderBy(desc(schema.documents.updatedAt))

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        categorySlug: row.categorySlug,
        accessLevel: normalizeAccessLevel(row.accessLevel),
        status: normalizeDocumentStatus(row.status),
        currentVersionId: row.currentVersionId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        archivedAt: row.archivedAt,
        currentVersion: row.cvId
          ? {
              id: row.cvId,
              versionNumber: row.cvVersionNumber ?? 0,
              syncStatus: normalizeSyncStatus(row.cvSyncStatus),
              indexStatus: normalizeIndexStatus(row.cvIndexStatus),
              publishedAt: row.cvPublishedAt,
            }
          : null,
      }))
    },

    async getDocumentWithVersions(documentId: string): Promise<DocumentWithAllVersions | null> {
      const { db, schema } = await import('hub:db')

      // Fetch document with current version
      const [docRow] = await db
        .select({
          id: schema.documents.id,
          slug: schema.documents.slug,
          title: schema.documents.title,
          categorySlug: schema.documents.categorySlug,
          accessLevel: schema.documents.accessLevel,
          status: schema.documents.status,
          currentVersionId: schema.documents.currentVersionId,
          createdAt: schema.documents.createdAt,
          updatedAt: schema.documents.updatedAt,
          archivedAt: schema.documents.archivedAt,
          cvId: schema.documentVersions.id,
          cvVersionNumber: schema.documentVersions.versionNumber,
          cvSyncStatus: schema.documentVersions.syncStatus,
          cvIndexStatus: schema.documentVersions.indexStatus,
          cvPublishedAt: schema.documentVersions.publishedAt,
        })
        .from(schema.documents)
        .leftJoin(
          schema.documentVersions,
          eq(schema.documents.currentVersionId, schema.documentVersions.id)
        )
        .where(eq(schema.documents.id, documentId))
        .limit(1)

      if (!docRow) return null

      // Fetch all versions
      const versionRows = await db
        .select({
          id: schema.documentVersions.id,
          versionNumber: schema.documentVersions.versionNumber,
          syncStatus: schema.documentVersions.syncStatus,
          indexStatus: schema.documentVersions.indexStatus,
          publishedAt: schema.documentVersions.publishedAt,
          isCurrent: schema.documentVersions.isCurrent,
          createdAt: schema.documentVersions.createdAt,
          updatedAt: schema.documentVersions.updatedAt,
        })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, documentId))
        .orderBy(desc(schema.documentVersions.versionNumber))

      const document: DocumentWithCurrentVersion = {
        id: docRow.id,
        title: docRow.title,
        slug: docRow.slug,
        categorySlug: docRow.categorySlug,
        accessLevel: normalizeAccessLevel(docRow.accessLevel),
        status: normalizeDocumentStatus(docRow.status),
        currentVersionId: docRow.currentVersionId,
        createdAt: docRow.createdAt,
        updatedAt: docRow.updatedAt,
        archivedAt: docRow.archivedAt,
        currentVersion: docRow.cvId
          ? {
              id: docRow.cvId,
              versionNumber: docRow.cvVersionNumber ?? 0,
              syncStatus: normalizeSyncStatus(docRow.cvSyncStatus),
              indexStatus: normalizeIndexStatus(docRow.cvIndexStatus),
              publishedAt: docRow.cvPublishedAt,
            }
          : null,
      }

      const versions: DocumentVersion[] = versionRows.map((row) => ({
        id: row.id,
        versionNumber: row.versionNumber,
        syncStatus: normalizeSyncStatus(row.syncStatus),
        indexStatus: normalizeIndexStatus(row.indexStatus),
        publishedAt: row.publishedAt,
        isCurrent: Boolean(row.isCurrent),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))

      return {
        ...document,
        versions,
      }
    },
  }
}
