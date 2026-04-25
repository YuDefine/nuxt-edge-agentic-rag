-- 0016_user_profiles_nullable_email.sql
-- TD-009 — passkey-user-profiles-nullable-email follow-up to 0009.
--
-- =========================================================================
-- Background
-- =========================================================================
-- 0009 deferred relaxing `user_profiles.email_normalized` to NULL because
-- adding a `user_profiles` rebuild on top of the 8-table `user`-tree rebuild
-- would have exceeded the safe review surface. The interim workaround was to
-- write a sentinel value `'__passkey__:' || user.id` for passkey-only users
-- so the column could remain `TEXT NOT NULL UNIQUE`.
--
-- This migration completes the original intent:
--   * `user_profiles.email_normalized` becomes nullable
--   * Existing sentinel rows are backfilled to NULL inside the same DDL
--     transaction
--   * A partial unique index replaces the column-level UNIQUE so multiple
--     NULL rows can coexist without conflicting
--
-- =========================================================================
-- Why an 8-table cascade rebuild
-- =========================================================================
-- libsql defaults `foreign_keys = 1` (Cloudflare D1 silently ignores
-- `PRAGMA foreign_keys = OFF`, see 0010 header). `defer_foreign_keys = ON`
-- defers row-level FK checks until COMMIT but does NOT relax the
-- table-level rule that DROP TABLE aborts with `SQLITE_CONSTRAINT_FOREIGNKEY`
-- while any other table's FK clause still points at the dropped table.
--
-- Rebuilding `user_profiles` therefore requires DROP'ing all four direct
-- referrers (`conversations`, `query_logs`, `messages`, `documents`). Each of
-- those in turn has its own indirect referrers that block their DROP, so the
-- cascade extends:
--
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
-- Final table set rebuilt: user_profiles + 4 direct children + 3 indirect
-- (citation_records, document_versions, source_chunks) = 8 tables.
--
-- The 3 indirect tables get rebuilt with their **column shape unchanged**;
-- only their FK clauses are written explicitly against canonical names so the
-- post-RENAME state is correct on both Cloudflare D1 and libsql (mirrors the
-- TD-051 / TD-055 fix in 0012 / 0015).
--
-- =========================================================================
-- Strategy (mirrors 0010 / 0015 explicit-FK rebuild pattern)
-- =========================================================================
-- 1. Build all 8 _v16 staging tables, FK clauses against canonical names.
-- 2. Copy rows. user_profiles backfills sentinel→NULL inline; other tables
--    copy bit-for-bit.
-- 3. Children-first DROP of the 8 originals.
-- 4. RENAME _v16 → canonical.
-- 5. Recreate indexes (partial unique index on user_profiles + 9 named
--    indexes from 0001 / 0010 / 0015).
-- 6. PRAGMA foreign_key_check.
--
-- =========================================================================
-- Column / constraint preservation
-- =========================================================================
-- Column lists are taken verbatim from the live schema after migrations
-- 0001 / 0010 / 0011 / 0013 / 0014 / 0015:
--   * user_profiles  (0001 + this change): email_normalized loses NOT NULL
--                    + UNIQUE; admin_source CHECK preserved.
--   * conversations  (0001 base): unchanged column shape.
--   * query_logs     (0010 + 0011 + 0015 v15): 19 columns.
--   * messages       (0010 + 0013 + 0014 + 0015 v15): 14 columns.
--   * documents      (0001 base): unchanged column shape.
--   * citation_records (0010 + 0015 v15): 8 columns, FK clauses preserved.
--   * document_versions (0001 base): unchanged column shape.
--   * source_chunks  (0001 base): unchanged column shape.
--
-- Only `user_profiles.email_normalized` changes constraint. The data
-- backfill `CASE WHEN email_normalized LIKE '__passkey__:%' THEN NULL ELSE
-- email_normalized END` runs inline during INSERT INTO user_profiles_v16.

-- libsql defaults `foreign_keys = 1`; with FK ON, DROP TABLE aborts when
-- another live table's FK clause still references the to-be-dropped table.
-- Between step (10) DROP and step (11) RENAME, the _v16 staging tables
-- have FK clauses written against the canonical names — those canonical
-- tables are mid-cascade DROP'd, so libsql briefly sees dangling FK refs
-- and aborts the DROP. We disable FK enforcement at the connection level
-- for the duration of the rebuild and re-enable + verify at the end.
--
-- Cloudflare D1 silently ignores `PRAGMA foreign_keys = OFF` (per 0010
-- header), but its connection-level FK enforcement defaults to OFF anyway,
-- so this PRAGMA is a no-op there. defer_foreign_keys + the children-first
-- DROP order remain the safety net for D1.
PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = OFF;
PRAGMA defer_foreign_keys = ON;

-- ------------------------------------------------------------------
-- (1) user_profiles_v16 — email_normalized relaxed to nullable.
-- ------------------------------------------------------------------
CREATE TABLE user_profiles_v16 (
  id TEXT PRIMARY KEY,
  email_normalized TEXT,
  display_name TEXT,
  role_snapshot TEXT NOT NULL DEFAULT 'user',
  admin_source TEXT NOT NULL DEFAULT 'none' CHECK (admin_source IN ('none', 'allowlist')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------
-- (2) conversations_v16 — FK rebound to user_profiles canonical.
--     Mirrors 0001 schema; no column changes.
-- ------------------------------------------------------------------
CREATE TABLE conversations_v16 (
  id TEXT PRIMARY KEY,
  user_profile_id TEXT REFERENCES user_profiles(id),
  access_level TEXT NOT NULL DEFAULT 'internal' CHECK (access_level IN ('internal', 'restricted')),
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

-- ------------------------------------------------------------------
-- (3) query_logs_v16 — FK rebound to user_profiles canonical.
--     19 columns, mirrors live schema after 0010 + 0011 + 0015.
-- ------------------------------------------------------------------
CREATE TABLE query_logs_v16 (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
  user_profile_id TEXT REFERENCES user_profiles(id),
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
  workers_ai_runs_json TEXT NOT NULL DEFAULT '[]'
);

-- ------------------------------------------------------------------
-- (4) messages_v16 — FK rebound to user_profiles canonical.
--     14 columns, mirrors live schema after 0010 + 0013 + 0014 + 0015.
-- ------------------------------------------------------------------
CREATE TABLE messages_v16 (
  id TEXT PRIMARY KEY,
  query_log_id TEXT REFERENCES query_logs(id) ON DELETE SET NULL,
  user_profile_id TEXT REFERENCES user_profiles(id),
  channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content_redacted TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  redaction_applied INTEGER NOT NULL DEFAULT 0 CHECK (redaction_applied IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  citations_json TEXT NOT NULL DEFAULT '[]',
  content_text TEXT,
  refused INTEGER NOT NULL DEFAULT 0,
  refusal_reason TEXT
);

-- ------------------------------------------------------------------
-- (5) documents_v16 — FK rebound to user_profiles canonical.
--     Mirrors 0001 schema; no column changes.
-- ------------------------------------------------------------------
CREATE TABLE documents_v16 (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category_slug TEXT NOT NULL DEFAULT '',
  access_level TEXT NOT NULL DEFAULT 'internal' CHECK (access_level IN ('internal', 'restricted')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  current_version_id TEXT,
  created_by_user_id TEXT REFERENCES user_profiles(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);

-- ------------------------------------------------------------------
-- (6) document_versions_v16 — FK rebound to documents canonical.
--     Mirrors 0001 schema; no column changes.
-- ------------------------------------------------------------------
CREATE TABLE document_versions_v16 (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
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
-- (7) source_chunks_v16 — FK rebound to document_versions canonical.
--     Mirrors 0001 schema; no column changes.
-- ------------------------------------------------------------------
CREATE TABLE source_chunks_v16 (
  id TEXT PRIMARY KEY,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
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
-- (8) citation_records_v16 — FK rebound to query_logs / document_versions /
--     source_chunks canonical. 8 columns, mirrors 0010 + 0015 v15.
-- ------------------------------------------------------------------
CREATE TABLE citation_records_v16 (
  id TEXT PRIMARY KEY,
  query_log_id TEXT NOT NULL REFERENCES query_logs(id) ON DELETE CASCADE,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id),
  source_chunk_id TEXT NOT NULL REFERENCES source_chunks(id),
  citation_locator TEXT NOT NULL,
  chunk_text_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

-- ------------------------------------------------------------------
-- (9) Copy data into _v16 tables. user_profiles backfills sentinel rows
--     to NULL inline. All other tables copy bit-for-bit. Order chosen so
--     parents land before children for any same-INSERT FK validation in
--     environments that don't honour defer_foreign_keys for inline FKs.
-- ------------------------------------------------------------------
INSERT INTO user_profiles_v16 (
  id, email_normalized, display_name, role_snapshot, admin_source, created_at, updated_at
)
SELECT
  id,
  CASE WHEN email_normalized LIKE '__passkey__:%' THEN NULL ELSE email_normalized END,
  display_name,
  role_snapshot,
  admin_source,
  created_at,
  updated_at
FROM user_profiles;

INSERT INTO conversations_v16 (
  id, user_profile_id, access_level, title, created_at, updated_at, deleted_at
)
SELECT
  id, user_profile_id, access_level, title, created_at, updated_at, deleted_at
FROM conversations;

INSERT INTO query_logs_v16 (
  id, channel, user_profile_id, mcp_token_id, environment,
  query_redacted_text, risk_flags_json, allowed_access_levels_json,
  redaction_applied, config_snapshot_version, status, created_at,
  first_token_latency_ms, completion_latency_ms, retrieval_score,
  judge_score, decision_path, refusal_reason, workers_ai_runs_json
)
SELECT
  id, channel, user_profile_id, mcp_token_id, environment,
  query_redacted_text, risk_flags_json, allowed_access_levels_json,
  redaction_applied, config_snapshot_version, status, created_at,
  first_token_latency_ms, completion_latency_ms, retrieval_score,
  judge_score, decision_path, refusal_reason, workers_ai_runs_json
FROM query_logs;

INSERT INTO messages_v16 (
  id, query_log_id, user_profile_id, channel, role,
  content_redacted, risk_flags_json, redaction_applied, created_at,
  conversation_id, citations_json, content_text, refused, refusal_reason
)
SELECT
  id, query_log_id, user_profile_id, channel, role,
  content_redacted, risk_flags_json, redaction_applied, created_at,
  conversation_id, citations_json, content_text, refused, refusal_reason
FROM messages;

INSERT INTO documents_v16 (
  id, slug, title, category_slug, access_level, status, current_version_id,
  created_by_user_id, created_at, updated_at, archived_at
)
SELECT
  id, slug, title, category_slug, access_level, status, current_version_id,
  created_by_user_id, created_at, updated_at, archived_at
FROM documents;

INSERT INTO document_versions_v16 (
  id, document_id, version_number, source_r2_key, normalized_text_r2_key,
  metadata_json, smoke_test_queries_json, index_status, sync_status,
  is_current, published_at, created_at, updated_at
)
SELECT
  id, document_id, version_number, source_r2_key, normalized_text_r2_key,
  metadata_json, smoke_test_queries_json, index_status, sync_status,
  is_current, published_at, created_at, updated_at
FROM document_versions;

INSERT INTO source_chunks_v16 (
  id, document_version_id, chunk_index, chunk_hash, chunk_text,
  citation_locator, access_level, metadata_json, created_at
)
SELECT
  id, document_version_id, chunk_index, chunk_hash, chunk_text,
  citation_locator, access_level, metadata_json, created_at
FROM source_chunks;

INSERT INTO citation_records_v16 (
  id, query_log_id, document_version_id, source_chunk_id,
  citation_locator, chunk_text_snapshot, created_at, expires_at
)
SELECT
  id, query_log_id, document_version_id, source_chunk_id,
  citation_locator, chunk_text_snapshot, created_at, expires_at
FROM citation_records;

-- ------------------------------------------------------------------
-- (10) Children-first DROP of the 8 originals. Order matters because
--      libsql enforces FK at table level: a DROP fails while any other
--      live table's FK clause still points at the dropped table.
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
-- (11) RENAME _v16 staging tables back to canonical names. Order is
--      irrelevant because no _v16 table references another _v16 — every FK
--      is already written against the canonical name (which is currently
--      missing but becomes valid after the rename completes).
-- ------------------------------------------------------------------
ALTER TABLE user_profiles_v16     RENAME TO user_profiles;
ALTER TABLE conversations_v16     RENAME TO conversations;
ALTER TABLE query_logs_v16        RENAME TO query_logs;
ALTER TABLE messages_v16          RENAME TO messages;
ALTER TABLE documents_v16         RENAME TO documents;
ALTER TABLE document_versions_v16 RENAME TO document_versions;
ALTER TABLE source_chunks_v16     RENAME TO source_chunks;
ALTER TABLE citation_records_v16  RENAME TO citation_records;

-- ------------------------------------------------------------------
-- (12) Recreate indexes. The user_profiles index is a partial unique index
--      so multiple NULL rows (passkey-only users) can coexist without
--      conflict. The `NOT LIKE '__passkey__:%'` predicate is defense-in-depth
--      against any sentinel row that the backfill in step (9) might have
--      missed (race / future regression). PRIMARY KEY and column-level UNIQUE
--      constraints travel with the table definitions and need no recreation.
--      Named indexes from 0001 / 0010 / 0015 are recreated here.
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
-- (13) Re-enable FK enforcement and verify integrity. PRAGMA
--      `foreign_key_check` runs regardless of the `foreign_keys` setting;
--      we still flip it back ON so post-migration writes hit the canonical
--      enforcement path on libsql.
-- ------------------------------------------------------------------
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
