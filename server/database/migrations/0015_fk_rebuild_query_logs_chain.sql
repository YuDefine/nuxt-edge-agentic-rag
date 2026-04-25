-- 0015_fk_rebuild_query_logs_chain.sql
-- Repair query_logs / messages / citation_records FK references that still
-- point at `mcp_tokens_new` / `query_logs_new` instead of the canonical
-- post-rename names. (TD-055; sibling fix to TD-051 / migration 0012.)
--
-- =========================================================================
-- Background
-- =========================================================================
-- Migration 0010 (fk-cascade-repair-for-self-delete) rebuilt five tables
-- with FK clauses pointing at `*_new` staging names, relying on SQLite's
-- modern RENAME-rewrite behaviour (`legacy_alter_table = OFF`) to retarget
-- the stored DDL text from `*_new` to the canonical name after
-- `ALTER TABLE *_new RENAME TO <canonical>`.
--
-- That assumption holds on Cloudflare D1 but NOT on the libsql backend used
-- by NuxtHub local dev, where `legacy_alter_table = 1` is the default. The
-- result on a fresh local libsql database: `query_logs.mcp_token_id` keeps
-- `REFERENCES mcp_tokens_new(id)`, and `messages.query_log_id` /
-- `citation_records.query_log_id` keep `REFERENCES query_logs_new(id)`. The
-- `*_new` parents no longer exist post-RENAME, so any INSERT / UPDATE
-- against these three tables aborts with `SQLITE_ERROR: no such table:
-- main.*_new`. Discovered during `add-sse-resilience` §7.1 local heartbeat
-- verification: `POST /api/chat` blew up at `createQueryLog`, `createMessage`,
-- and `createCitationRecord` in turn.
--
-- TD-051 / migration 0012 already fixed the sibling case for `account` /
-- `session` / `passkey` (`user_new` -> `"user"`). This migration extends
-- the same explicit-FK rebuild pattern to the remaining three children of
-- the mcp_tokens -> query_logs chain.
--
-- =========================================================================
-- Strategy (mirrors migration 0012)
-- =========================================================================
-- Rebuild each affected table with its FK REFERENCES clause written as the
-- post-rename canonical name directly, instead of relying on the
-- RENAME-rewrite behaviour. This makes the stored DDL correct regardless
-- of the host engine's `legacy_alter_table` default.
--
-- Tables rebuilt:
--   * query_logs       (mcp_token_id  -> mcp_tokens(id) ON DELETE SET NULL)
--   * messages         (query_log_id  -> query_logs(id) ON DELETE SET NULL)
--   * citation_records (query_log_id  -> query_logs(id) ON DELETE CASCADE)
--
-- Other FK clauses on these tables (user_profile_id -> user_profiles,
-- conversation_id -> conversations, document_version_id -> document_versions,
-- source_chunk_id -> source_chunks) are preserved verbatim.
--
-- Idempotent in result: on production D1 (where the stored DDL already
-- reads the canonical name) this is a slow no-op; on local libsql (where
-- the stored DDL still reads `*_new`) this rewrites it to canonical.
--
-- =========================================================================
-- Column / constraint preservation
-- =========================================================================
-- Column lists are taken verbatim from the live schema after migrations
-- 0010 / 0011 / 0013 / 0014:
--   * 0011 added `query_logs.workers_ai_runs_json` (NOT NULL DEFAULT '[]').
--   * 0013 added `messages.refused` (NOT NULL DEFAULT 0).
--   * 0014 added `messages.refusal_reason` (TEXT, nullable).
-- All CHECK constraints, defaults, NOT NULL flags, and column ordering are
-- preserved exactly. No column is added, removed, renamed, or reordered.
--
-- =========================================================================
-- Drop ordering
-- =========================================================================
-- Children-first DROP (`messages` -> `citation_records` -> `query_logs`)
-- prevents `ON DELETE SET NULL` on `messages.query_log_id` from silently
-- nulling rows when the parent is dropped (the WARNING reaffirmed in 0007 /
-- 0008 / 0010 headers). Dropping messages and citation_records first makes
-- the eventual `DROP TABLE query_logs` a no-op for cascade triggers.
--
-- Local libsql defaults to `foreign_keys = 0`, so DROP of a parent with
-- still-referencing children does not abort here. `defer_foreign_keys = ON`
-- is set defensively for any environment where FK enforcement is enabled
-- in this transaction context.
--
-- =========================================================================
-- Index recreation
-- =========================================================================
-- Five named indexes from migration 0010 are recreated:
--   * idx_query_logs_channel_created_at
--   * idx_messages_query_log_id
--   * idx_messages_conversation_created_at
--   * idx_citation_records_query_log_id
--   * idx_citation_records_expires_at
-- PRIMARY KEY and UNIQUE column-level constraints travel with the column
-- definitions and do not need explicit recreation.

PRAGMA legacy_alter_table = OFF;
PRAGMA defer_foreign_keys = ON;

-- ------------------------------------------------------------------
-- (1) query_logs_v15 — FK rebound to mcp_tokens(id) (canonical).
--     19 columns, mirrors live schema after 0010 + 0011.
-- ------------------------------------------------------------------
CREATE TABLE query_logs_v15 (
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
-- (2) citation_records_v15 — FK rebound to query_logs(id) (canonical).
--     8 columns, mirrors live schema from 0010.
-- ------------------------------------------------------------------
CREATE TABLE citation_records_v15 (
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
-- (3) messages_v15 — FK rebound to query_logs(id) (canonical).
--     14 columns, mirrors live schema after 0010 + 0013 + 0014.
-- ------------------------------------------------------------------
CREATE TABLE messages_v15 (
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
-- (4) Copy rows. Column lists are explicit on both sides so a future
--     schema drift surfaces as a SQL error rather than a silent column
--     drop.
-- ------------------------------------------------------------------
INSERT INTO query_logs_v15 (
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

INSERT INTO citation_records_v15 (
  id, query_log_id, document_version_id, source_chunk_id,
  citation_locator, chunk_text_snapshot, created_at, expires_at
)
SELECT
  id, query_log_id, document_version_id, source_chunk_id,
  citation_locator, chunk_text_snapshot, created_at, expires_at
FROM citation_records;

INSERT INTO messages_v15 (
  id, query_log_id, user_profile_id, channel, role,
  content_redacted, risk_flags_json, redaction_applied, created_at,
  conversation_id, citations_json, content_text, refused, refusal_reason
)
SELECT
  id, query_log_id, user_profile_id, channel, role,
  content_redacted, risk_flags_json, redaction_applied, created_at,
  conversation_id, citations_json, content_text, refused, refusal_reason
FROM messages;

-- ------------------------------------------------------------------
-- (5) Children-first DROP (mirrors 0010 §5).
--     Dropping messages and citation_records before query_logs prevents
--     `messages.query_log_id ON DELETE SET NULL` from silently nulling
--     rows during the parent DROP. The original messages / citation_records
--     are about to be replaced by their _v15 counterparts in the next
--     step, so dropping them here is safe.
-- ------------------------------------------------------------------
DROP TABLE messages;
DROP TABLE citation_records;
DROP TABLE query_logs;

-- ------------------------------------------------------------------
-- (6) RENAME _v15 to canonical names. Order is irrelevant here because
--     no _v15 table references another _v15 table — every FK on the
--     three rebuilt tables already points at a canonical name.
-- ------------------------------------------------------------------
ALTER TABLE query_logs_v15      RENAME TO query_logs;
ALTER TABLE citation_records_v15 RENAME TO citation_records;
ALTER TABLE messages_v15        RENAME TO messages;

-- ------------------------------------------------------------------
-- (7) Recreate the five named indexes from migration 0010. Column-level
--     PRIMARY KEY / UNIQUE constraints are intrinsic to the rebuild and
--     do not need explicit recreation.
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_query_logs_channel_created_at
  ON query_logs(channel, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_query_log_id
  ON messages(query_log_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
  ON messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_citation_records_query_log_id
  ON citation_records(query_log_id);
CREATE INDEX IF NOT EXISTS idx_citation_records_expires_at
  ON citation_records(expires_at);

-- ------------------------------------------------------------------
-- (8) Diagnostic — also acts as the implicit-COMMIT FK enforcement
--     point because `defer_foreign_keys = ON` defers row-level checks
--     until transaction end. Operators verify zero rows in local +
--     production post-apply checks.
-- ------------------------------------------------------------------
PRAGMA foreign_key_check;
