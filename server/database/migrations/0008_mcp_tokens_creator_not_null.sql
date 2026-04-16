-- mcp-tokens-creator-not-null: tighten `mcp_tokens.created_by_user_id`
-- from nullable to NOT NULL.
--
-- Context (2026-04-20):
--   Migration 0006 added `created_by_user_id` as nullable with the comment
--   "NULL for tokens created before 0006; MCP middleware treats NULL as
--   'admin' (legacy system seed)". With B16 fully deployed, every new
--   token created via `server/utils/mcp-token-store.ts::createToken`
--   now writes a concrete admin user id. Production has been manually
--   cleaned up (see Manual ops below), leaving zero NULL rows, so the
--   schema can now enforce what the code already guarantees.
--
-- Manual ops performed 2026-04-20 before this migration landed:
--   * DELETEd 4 rows where `environment IN ('local','staging')` AND
--     `created_by_user_id IS NULL` — these were test-seed tokens that
--     had leaked into the prod D1 instance, had zero `query_logs`
--     references (verified), and were not in active use.
--   * UPDATEd 2 `environment='production'` rows (names "Test Full" /
--     "Test Limited", 30 + 3 query_logs audit trail) to
--     `created_by_user_id = 'dh9UCNGLmzRlSMXenEFmNvOMknwDx4XA'`
--     (charles.yudefine@gmail.com, the sole admin at the time).
--     Backfilled rather than deleted to preserve the audit trail.
--
-- After those ops: prod `mcp_tokens` = 3 rows, 0 NULL. The migration
-- below would still succeed if a rogue NULL crept back in between the
-- manual cleanup and deploy — the `INSERT INTO mcp_tokens_new` SELECT
-- would abort with NOT NULL violation and roll the whole migration
-- back atomically. That's the intended safety: if NULL reappears,
-- investigate rather than silently swallow.
--
-- FK dependency tree rooted at mcp_tokens(id) — same shape as 0007 (4):
--
--   mcp_tokens  ← "mcp_tokens"(id)
--     query_logs.mcp_token_id
--       citation_records.query_log_id     (ON DELETE CASCADE)
--       messages.query_log_id             (ON DELETE SET NULL — silent null risk)
--
-- D1 constraints recap (see 0007 header for full treatment):
--   * `PRAGMA foreign_keys = OFF` silently ignored — cannot bypass FK
--     enforcement at DDL time.
--   * `DROP TABLE parent` aborts with SQLITE_CONSTRAINT_FOREIGNKEY while
--     child FK references exist.
--   * Therefore: rebuild mcp_tokens → query_logs → citation_records →
--     messages in a single atomic migration, children-first DROP order.
--
-- Column lists are copied verbatim from the post-0007 schema (verified
-- 2026-04-20 via `wrangler d1 execute --remote --command "PRAGMA
-- table_info(<table>)"`).

PRAGMA foreign_keys = ON;

-- =========================================================================
-- (1) `mcp_tokens_new` — NOT NULL on created_by_user_id.
--
-- Only delta vs post-0007 state:
--   created_by_user_id TEXT REFERENCES user(id)
--     →
--   created_by_user_id TEXT NOT NULL REFERENCES user(id)
-- =========================================================================

CREATE TABLE mcp_tokens_new (
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id TEXT NOT NULL REFERENCES "user"(id)
);

INSERT INTO mcp_tokens_new (
  id, token_hash, name, scopes_json, environment, status,
  expires_at, last_used_at, revoked_at, revoked_reason,
  created_at, created_by_user_id
)
SELECT
  id, token_hash, name, scopes_json, environment, status,
  expires_at, last_used_at, revoked_at, revoked_reason,
  created_at, created_by_user_id
FROM mcp_tokens;

-- =========================================================================
-- (2) `query_logs_new` — FK re-bind to mcp_tokens_new.
--
-- Column list = 0001 cols + 0005 observability cols, identical to 0007 (5).
-- =========================================================================

CREATE TABLE query_logs_new (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
  user_profile_id TEXT REFERENCES user_profiles(id),
  mcp_token_id TEXT REFERENCES mcp_tokens_new(id),
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
  refusal_reason TEXT
);

INSERT INTO query_logs_new (
  id, channel, user_profile_id, mcp_token_id, environment,
  query_redacted_text, risk_flags_json, allowed_access_levels_json,
  redaction_applied, config_snapshot_version, status, created_at,
  first_token_latency_ms, completion_latency_ms, retrieval_score,
  judge_score, decision_path, refusal_reason
)
SELECT
  id, channel, user_profile_id, mcp_token_id, environment,
  query_redacted_text, risk_flags_json, allowed_access_levels_json,
  redaction_applied, config_snapshot_version, status, created_at,
  first_token_latency_ms, completion_latency_ms, retrieval_score,
  judge_score, decision_path, refusal_reason
FROM query_logs;

-- =========================================================================
-- (3) `citation_records_new` — FK re-bind to query_logs_new.
--
-- `citation_records.query_log_id → query_logs(id) ON DELETE CASCADE`. We
-- DROP citation_records BEFORE query_logs (section 5) so the cascade never
-- fires at DROP time.
-- =========================================================================

CREATE TABLE citation_records_new (
  id TEXT PRIMARY KEY,
  query_log_id TEXT NOT NULL REFERENCES query_logs_new(id) ON DELETE CASCADE,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id),
  source_chunk_id TEXT NOT NULL REFERENCES source_chunks(id),
  citation_locator TEXT NOT NULL,
  chunk_text_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

INSERT INTO citation_records_new (
  id, query_log_id, document_version_id, source_chunk_id,
  citation_locator, chunk_text_snapshot, created_at, expires_at
)
SELECT
  id, query_log_id, document_version_id, source_chunk_id,
  citation_locator, chunk_text_snapshot, created_at, expires_at
FROM citation_records;

-- =========================================================================
-- (4) `messages_new` — FK re-bind to query_logs_new.
--
-- `messages.query_log_id → query_logs(id) ON DELETE SET NULL`. If left in
-- place during DROP query_logs, SET NULL would silently null every
-- message.query_log_id. Rebuilding messages here and dropping it before
-- query_logs preserves the linkage (verified pattern from 0007).
-- =========================================================================

CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  query_log_id TEXT REFERENCES query_logs_new(id) ON DELETE SET NULL,
  user_profile_id TEXT REFERENCES user_profiles(id),
  channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content_redacted TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  redaction_applied INTEGER NOT NULL DEFAULT 0 CHECK (redaction_applied IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  citations_json TEXT NOT NULL DEFAULT '[]',
  content_text TEXT
);

INSERT INTO messages_new (
  id, query_log_id, user_profile_id, channel, role,
  content_redacted, risk_flags_json, redaction_applied, created_at,
  conversation_id, citations_json, content_text
)
SELECT
  id, query_log_id, user_profile_id, channel, role,
  content_redacted, risk_flags_json, redaction_applied, created_at,
  conversation_id, citations_json, content_text
FROM messages;

-- =========================================================================
-- (5) Swap: DROP old tables children-first.
-- =========================================================================

DROP TABLE messages;
DROP TABLE citation_records;
DROP TABLE query_logs;
DROP TABLE mcp_tokens;

-- =========================================================================
-- (6) Rename `_new` → canonical. Each RENAME auto-rewrites child FK
-- `REFERENCES *_new(id)` back to the canonical name (verified on 0007).
-- =========================================================================

ALTER TABLE mcp_tokens_new RENAME TO mcp_tokens;
ALTER TABLE query_logs_new RENAME TO query_logs;
ALTER TABLE citation_records_new RENAME TO citation_records;
ALTER TABLE messages_new RENAME TO messages;

-- =========================================================================
-- (7) Recreate indexes dropped alongside the old tables.
-- Mirrors 0007 (11) for the tables in this migration's scope.
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_query_logs_channel_created_at
  ON query_logs(channel, created_at);
CREATE INDEX IF NOT EXISTS idx_citation_records_query_log_id
  ON citation_records(query_log_id);
CREATE INDEX IF NOT EXISTS idx_citation_records_expires_at
  ON citation_records(expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_query_log_id
  ON messages(query_log_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
  ON messages(conversation_id, created_at);

-- =========================================================================
-- (8) Post-swap integrity report (diagnostic only).
-- =========================================================================

PRAGMA foreign_key_check;
