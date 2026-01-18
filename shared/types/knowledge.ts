/**
 * Document with current version info for list display.
 * Used by both client (DocumentListTable) and server (document-list-store).
 */
export interface DocumentWithCurrentVersion {
  id: string
  title: string
  slug: string
  categorySlug: string
  accessLevel: 'internal' | 'restricted'
  status: 'draft' | 'active' | 'archived'
  currentVersionId: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  currentVersion: {
    id: string
    versionNumber: number
    syncStatus: 'pending' | 'running' | 'synced' | 'failed'
    indexStatus: 'pending' | 'preprocessing' | 'indexing' | 'indexed' | 'failed'
    publishedAt: string | null
  } | null
}

export interface DocumentRecord {
  accessLevel: string
  archivedAt: string | null
  categorySlug: string
  createdAt: string
  createdByUserId: string | null
  currentVersionId: string | null
  id: string
  slug: string
  status: string
  title: string
  updatedAt: string
}

export interface DocumentVersionRecord {
  createdAt: string
  documentId: string
  id: string
  indexStatus: string
  isCurrent: boolean
  metadataJson: string
  normalizedTextR2Key: string | null
  publishedAt: string | null
  smokeTestQueriesJson: string
  sourceR2Key: string
  syncStatus: string
  updatedAt: string
  versionNumber: number
}

export interface SourceChunkRecord {
  accessLevel: string
  chunkHash: string
  chunkIndex: number
  chunkText: string
  citationLocator: string
  createdAt: string
  documentVersionId: string
  id: string
  metadataJson: string
}

export interface CitationRecord {
  chunkTextSnapshot: string
  citationLocator: string
  createdAt: string
  documentVersionId: string
  expiresAt: string
  id: string
  queryLogId: string
  sourceChunkId: string
}

export interface MessageRecord {
  channel: string
  contentRedacted: string
  createdAt: string
  id: string
  queryLogId: string | null
  redactionApplied: boolean
  riskFlagsJson: string
  role: string
  userProfileId: string | null
}

export interface QueryLogRecord {
  allowedAccessLevelsJson: string
  channel: string
  configSnapshotVersion: string
  createdAt: string
  environment: string
  id: string
  mcpTokenId: string | null
  queryRedactedText: string
  redactionApplied: boolean
  riskFlagsJson: string
  status: string
  userProfileId: string | null
}

export interface McpTokenRecord {
  createdAt: string
  environment: string
  expiresAt: string | null
  id: string
  lastUsedAt: string | null
  name: string
  revokedAt: string | null
  revokedReason: string | null
  scopesJson: string
  status: string
  tokenHash: string
}

export interface UserProfileRecord {
  adminSource: string
  createdAt: string
  displayName: string | null
  emailNormalized: string
  id: string
  roleSnapshot: string
  updatedAt: string
}
