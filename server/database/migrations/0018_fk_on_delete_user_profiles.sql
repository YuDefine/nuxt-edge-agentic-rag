-- 0018_fk_on_delete_user_profiles.sql
-- Add ON DELETE clauses to 4 FK columns referencing user_profiles(id).
--
-- =========================================================================
-- Background
-- =========================================================================
-- Migrations through 0016 rebuilt user_profiles and its 4 direct FK
-- children but left the FK references to user_profiles without ON DELETE
-- clauses (bare REFERENCES). This migration adds:
--
--   documents.created_by_user_id       → ON DELETE SET NULL  (created_by)
--   conversations.user_profile_id      → ON DELETE CASCADE   (user-owned)
--   query_logs.user_profile_id         → ON DELETE SET NULL  (observability)
--   messages.user_profile_id           → ON DELETE SET NULL  (preserve history)
--
-- =========================================================================
-- Strategy (mirrors 0016 _v16 staging-table pattern)
-- =========================================================================
-- SQLite cannot ALTER FK constraints. The same 8-table cascade rebuild is
-- required because DROP TABLE fails while any other live table's FK clause
-- still references the to-be-dropped table (libsql enforces at table level).
--
-- Rebuild tree (identical to 0016):
--   user_profiles
--   ├─ conversations         (direct: user_profile_id)
--   ├─ query_logs            (direct: user_profile_id)
--   │   ├─ citation_records  (indirect: query_log_id ON DELETE CASCADE)
--   │   └─ messages          (indirect: query_log_id ON DELETE SET NULL)
--   ├─ messages              (direct: user_profile_id)
--   └─ documents             (direct: created_by_user_id)
--       └─ document_versions (indirect: document_id ON DELETE CASCADE)
--           ├─ source_chunks (indirect: document_version_id ON DELETE CASCADE)
--           └─ citation_records (indirect: document_version_id, source_chunk_id)
--
-- Column lists taken from live schema after 0016 + 0017:
--   * query_logs: 21 columns (0016 19 + 0017 rewriter_status, rewritten_query)
--   * All other tables: unchanged from 0016
--
-- Only FK clauses on the 4 user_profiles references change (adding ON DELETE).
-- Every other column, constraint, CHECK, and FK clause is preserved verbatim.

PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = OFF;
PRAGMA defer_foreign_keys = ON;

-- ------------------------------------------------------------------
-- (1) user_profiles_v18 — unchanged from 0016 (no FK change needed on
--     this table itself, but must rebuild because children reference it).
-- ------------------------------------------------------------------
CREATE TABLE user_profiles_v18 (
  id TEXT PRIMARY KEY,
  email_normalized TEXT,
  display_name TEXT,
  role_snapshot TEXT NOT NULL DEFAULT 'user',
  admin_source TEXT NOT NULL DEFAULT 'none' CHECK (admin_source IN ('none', 'allowlist')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------
-- (2) conversations_v18 — FK adds ON DELETE CASCADE.
-- ------------------------------------------------------------------
CREATE TABLE conversations_v18 (
  id TEXT PRIMARY KEY,
  user_profile_id TEXT REFERENCES user_profiles_v18(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'internal' CHECK (access_level IN ('internal', 'restricted')),
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

-- ------------------------------------------------------------------
-- (3) query_logs_v18 — FK adds ON DELETE SET NULL on user_profile_id.
--     21 columns (0016 base + 0017 rewriter columns).
-- ------------------------------------------------------------------
CREATE TABLE query_logs_v18 (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
  user_profile_id TEXT REFERENCES user_profiles_v18(id) ON DELETE SET NULL,
  mcp_token_id TEXT REFERENCES mcp_tokens(id) ON DELETE SET NULL,
  environment TEXT NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  query_redacted_text TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  allowed_access_levels_json TEXT NOT NULL DEFAULT '["internal"]',
  redaction_applied INTEGER NOT NULL DEFAULT 0 CHECK (redaction_applied IN (0, 1)),
  config_snapshot_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'blocked', 'rejected', 'limited')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_token_latency_ms INTEGER,
  completion_latency_ms INTEGER,
  retrieval_score REAL,
  judge_score REAL,
  decision_path TEXT,
  refusal_reason TEXT,
  workers_ai_runs_json TEXT NOT NULL DEFAULT '[]',
  rewriter_status TEXT NOT NULL DEFAULT 'disabled',
  rewritten_query TEXT
);

-- ------------------------------------------------------------------
-- (4) messages_v18 — FK adds ON DELETE SET NULL on user_profile_id.
--     14 columns, mirrors 0016.
-- ------------------------------------------------------------------
CREATE TABLE messages_v18 (
  id TEXT PRIMARY KEY,
  query_log_id TEXT REFERENCES query_logs_v18(id) ON DELETE SET NULL,
  user_profile_id TEXT REFERENCES user_profiles_v18(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content_redacted TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  redaction_applied INTEGER NOT NULL DEFAULT 0 CHECK (redaction_applied IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  conversation_id TEXT REFERENCES conversations_v18(id) ON DELETE CASCADE,
  citations_json TEXT NOT NULL DEFAULT '[]',
  content_text TEXT,
  refused INTEGER NOT NULL DEFAULT 0,
  refusal_reason TEXT
);

-- ------------------------------------------------------------------
-- (5) documents_v18 — FK adds ON DELETE SET NULL on created_by_user_id.
-- ------------------------------------------------------------------
CREATE TABLE documents_v18 (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category_slug TEXT NOT NULL DEFAULT '',
  access_level TEXT NOT NULL DEFAULT 'internal' CHECK (access_level IN ('internal', 'restricted')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  current_version_id TEXT,
  created_by_user_id TEXT REFERENCES user_profiles_v18(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);

-- ------------------------------------------------------------------
-- (6) document_versions_v18 — FK rebound to documents_v18.
--     Column shape unchanged from 0016.
-- ------------------------------------------------------------------
CREATE TABLE document_versions_v18 (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents_v18(id) ON DELETE CASCADE,
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
  UNIQUE (document_id, version_number)
);

-- ------------------------------------------------------------------
-- (7) source_chunks_v18 — FK rebound to document_versions_v18.
--     Column shape unchanged from 0016.
-- ------------------------------------------------------------------
CREATE TABLE source_chunks_v18 (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL REFERENCES document_versions_v18(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,
  chunk_text TEXT NOT NULL,
  citation_locator TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'internal' CHECK (access_level IN ('internal', 'restricted')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_version_id, chunk_index)
);

-- ------------------------------------------------------------------
-- (8) citation_records_v18 — FK rebound to query_logs_v18 /
--     document_versions_v18 / source_chunks_v18.
--     Column shape unchanged from 0016.
-- ------------------------------------------------------------------
CREATE TABLE citation_records_v18 (
  id TEXT PRIMARY KEY,
  query_log_id TEXT NOT NULL REFERENCES query_logs_v18(id) ON DELETE CASCADE,
  document_version_id TEXT NOT NULL REFERENCES document_versions_v18(id),
  source_chunk_id TEXT NOT NULL REFERENCES source_chunks_v18(id),
  citation_locator TEXT NOT NULL,
  chunk_text_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

-- ------------------------------------------------------------------
-- (9) Copy data. All tables copy bit-for-bit (no column transforms).
-- ------------------------------------------------------------------
INSERT INTO user_profiles_v18 (
  id, email_normalized, display_name, role_snapshot, admin_source, created_at, updated_at
)
SELECT
  id, email_normalized, display_name, role_snapshot, admin_source, created_at, updated_at
FROM user_profiles;

INSERT INTO conversations_v18 (
  id, user_profile_id, access_level, title, created_at, updated_at, deleted_at
)
SELECT
  id, user_profile_id, access_level, title, created_at, updated_at, deleted_at
FROM conversations;

INSERT INTO query_logs_v18 (
  id, channel, user_profile_id, mcp_token_id, environment,
  query_redacted_text, risk_flags_json, allowed_access_levels_json,
  redaction_applied, config_snapshot_version, status, created_at,
  first_token_latency_ms, completion_latency_ms, retrieval_score,
  judge_score, decision_path, refusal_reason, workers_ai_runs_json,
  rewriter_status, rewritten_query
)
SELECT
  id, channel, user_profile_id, mcp_token_id, environment,
  query_redacted_text, risk_flags_json, allowed_access_levels_json,
  redaction_applied, config_snapshot_version, status, created_at,
  first_token_latency_ms, completion_latency_ms, retrieval_score,
  judge_score, decision_path, refusal_reason, workers_ai_runs_json,
  rewriter_status, rewritten_query
FROM query_logs;

INSERT INTO messages_v18 (
  id, query_log_id, user_profile_id, channel, role,
  content_redacted, risk_flags_json, redaction_applied, created_at,
  conversation_id, citations_json, content_text, refused, refusal_reason
)
SELECT
  id, query_log_id, user_profile_id, channel, role,
  content_redacted, risk_flags_json, redaction_applied, created_at,
  conversation_id, citations_json, content_text, refused, refusal_reason
FROM messages;

INSERT INTO documents_v18 (
  id, slug, title, category_slug, access_level, status, current_version_id,
  created_by_user_id, created_at, updated_at, archived_at
)
SELECT
  id, slug, title, category_slug, access_level, status, current_version_id,
  created_by_user_id, created_at, updated_at, archived_at
FROM documents;

INSERT INTO document_versions_v18 (
  id, document_id, version_number, source_r2_key, normalized_text_r2_key,
  metadata_json, smoke_test_queries_json, index_status, sync_status,
  is_current, published_at, created_at, updated_at
)
SELECT
  id, document_id, version_number, source_r2_key, normalized_text_r2_key,
  metadata_json, smoke_test_queries_json, index_status, sync_status,
  is_current, published_at, created_at, updated_at
FROM document_versions;

INSERT INTO source_chunks_v18 (
  id, document_version_id, chunk_index, chunk_hash, chunk_text,
  citation_locator, access_level, metadata_json, created_at
)
SELECT
  id, document_version_id, chunk_index, chunk_hash, chunk_text,
  citation_locator, access_level, metadata_json, created_at
FROM source_chunks;

INSERT INTO citation_records_v18 (
  id, query_log_id, document_version_id, source_chunk_id,
  citation_locator, chunk_text_snapshot, created_at, expires_at
)
SELECT
  id, query_log_id, document_version_id, source_chunk_id,
  citation_locator, chunk_text_snapshot, created_at, expires_at
FROM citation_records;

-- ------------------------------------------------------------------
-- (10) Children-first DROP of the 8 originals.
-- ------------------------------------------------------------------
DROP TABLE citation_records;
DROP TABLE messages;
DROP TABLE source_chunks;
DROP TABLE document_versions;
DROP TABLE documents;
DROP TABLE conversations;
DROP TABLE query_logs;
DROP TABLE user_profiles;

-- ------------------------------------------------------------------
-- (11) RENAME _v18 staging tables back to canonical names.
-- ------------------------------------------------------------------
ALTER TABLE user_profiles_v18     RENAME TO user_profiles;
ALTER TABLE conversations_v18     RENAME TO conversations;
ALTER TABLE query_logs_v18        RENAME TO query_logs;
ALTER TABLE messages_v18          RENAME TO messages;
ALTER TABLE documents_v18         RENAME TO documents;
ALTER TABLE document_versions_v18 RENAME TO document_versions;
ALTER TABLE source_chunks_v18     RENAME TO source_chunks;
ALTER TABLE citation_records_v18  RENAME TO citation_records;

-- ------------------------------------------------------------------
-- (12) Recreate indexes. Mirrors 0016 index set.
-- ------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_email_normalized_unique
  ON user_profiles(email_normalized)
  WHERE email_normalized IS NOT NULL
    AND email_normalized NOT LIKE '__passkey__:%';

CREATE INDEX IF NOT EXISTS idx_conversations_user_created
  ON conversations(user_profile_id, created_at);

CREATE INDEX IF NOT EXISTS idx_query_logs_channel_created_at
  ON query_logs(channel, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_query_log_id
  ON messages(query_log_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
  ON messages(conversation_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_versions_current_per_document
  ON document_versions(document_id)
  WHERE is_current = 1;

CREATE INDEX IF NOT EXISTS idx_source_chunks_version_locator
  ON source_chunks(document_version_id, citation_locator);

CREATE INDEX IF NOT EXISTS idx_citation_records_query_log_id
  ON citation_records(query_log_id);

CREATE INDEX IF NOT EXISTS idx_citation_records_expires_at
  ON citation_records(expires_at);

-- ------------------------------------------------------------------
-- (13) Re-enable FK enforcement and verify integrity.
-- ------------------------------------------------------------------
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
