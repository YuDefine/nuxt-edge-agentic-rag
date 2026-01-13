PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role_snapshot TEXT NOT NULL DEFAULT 'user',
  admin_source TEXT NOT NULL DEFAULT 'none' CHECK (admin_source IN ('none', 'allowlist')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category_slug TEXT NOT NULL DEFAULT '',
  access_level TEXT NOT NULL DEFAULT 'internal' CHECK (access_level IN ('internal', 'restricted')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  current_version_id TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES user_profiles(id)
);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  source_r2_key TEXT NOT NULL,
  normalized_text_r2_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  smoke_test_queries_json TEXT NOT NULL DEFAULT '[]',
  index_status TEXT NOT NULL DEFAULT 'upload_pending' CHECK (index_status IN ('upload_pending', 'preprocessing', 'smoke_pending', 'indexed', 'failed')),
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'running', 'completed', 'failed')),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  UNIQUE (document_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_versions_current_per_document
  ON document_versions(document_id)
  WHERE is_current = 1;

CREATE TABLE IF NOT EXISTS source_chunks (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,
  chunk_text TEXT NOT NULL,
  citation_locator TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'internal' CHECK (access_level IN ('internal', 'restricted')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_version_id) REFERENCES document_versions(id) ON DELETE CASCADE,
  UNIQUE (document_version_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_source_chunks_version_locator
  ON source_chunks(document_version_id, citation_locator);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  environment TEXT NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS query_logs (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
  user_profile_id TEXT,
  mcp_token_id TEXT,
  environment TEXT NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  query_redacted_text TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  allowed_access_levels_json TEXT NOT NULL DEFAULT '["internal"]',
  redaction_applied INTEGER NOT NULL DEFAULT 0 CHECK (redaction_applied IN (0, 1)),
  config_snapshot_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'blocked', 'rejected', 'limited')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id),
  FOREIGN KEY (mcp_token_id) REFERENCES mcp_tokens(id)
);

CREATE INDEX IF NOT EXISTS idx_query_logs_channel_created_at
  ON query_logs(channel, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  query_log_id TEXT,
  user_profile_id TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content_redacted TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  redaction_applied INTEGER NOT NULL DEFAULT 0 CHECK (redaction_applied IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (query_log_id) REFERENCES query_logs(id) ON DELETE SET NULL,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_query_log_id
  ON messages(query_log_id);

CREATE TABLE IF NOT EXISTS citation_records (
  id TEXT PRIMARY KEY,
  query_log_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  source_chunk_id TEXT NOT NULL,
  citation_locator TEXT NOT NULL,
  chunk_text_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (query_log_id) REFERENCES query_logs(id) ON DELETE CASCADE,
  FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  FOREIGN KEY (source_chunk_id) REFERENCES source_chunks(id)
);

CREATE INDEX IF NOT EXISTS idx_citation_records_query_log_id
  ON citation_records(query_log_id);

CREATE INDEX IF NOT EXISTS idx_citation_records_expires_at
  ON citation_records(expires_at);