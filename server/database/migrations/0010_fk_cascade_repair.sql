-- fk-cascade-repair-for-self-delete (TD-011): repair ON DELETE semantics on
-- the user → mcp_tokens → query_logs cascade chain so passkey-only self
-- delete (`POST /api/auth/account/delete`) and future admin-initiated
-- delete succeed without SQLITE_CONSTRAINT_FOREIGNKEY.
--
-- =========================================================================
-- Why this migration exists
-- =========================================================================
-- Migration 0009 rebuilt `member_role_changes.user_id` and
-- `mcp_tokens.created_by_user_id` with FK clauses but forgot `ON DELETE`.
-- SQLite defaults to `NO ACTION` == RESTRICT; every `DELETE FROM "user"`
-- that already has an audit tombstone or a provisioned mcp_token is
-- therefore blocked at the DB layer. Production + local are both broken.
-- See `docs/tech-debt.md` TD-011 for the investigation trail.
--
-- =========================================================================
-- Semantic changes (3 tables)
-- =========================================================================
--   member_role_changes.user_id
--     0009: REFERENCES user(id)   (no ON DELETE → RESTRICT)
--     0010: NO FK                 (audit tombstone survives user deletion)
--
--   mcp_tokens.created_by_user_id
--     0009: REFERENCES user(id) NOT NULL (no ON DELETE → RESTRICT)
--     0010: REFERENCES user(id) ON DELETE CASCADE NOT NULL
--           (token is owned by user; delete atomically)
--
--   query_logs.mcp_token_id
--     0009: REFERENCES mcp_tokens(id)    (no ON DELETE → RESTRICT)
--     0010: REFERENCES mcp_tokens(id) ON DELETE SET NULL
--           (observability log survives; TDD red test discovered that
--            NO ACTION on this FK blocks the user→mcp_tokens CASCADE,
--            effectively relocating TD-011 one layer down. SET NULL keeps
--            the log while letting the parent cascade complete.)
--
-- =========================================================================
-- Collateral FK rebinds (2 tables; ON DELETE clause preserved)
-- =========================================================================
--   citation_records.query_log_id
--     0009 / 0010: REFERENCES query_logs(id) ON DELETE CASCADE (unchanged)
--     Must rebuild so the FK re-binds to the new `query_logs` table.
--
--   messages.query_log_id
--     0009 / 0010: REFERENCES query_logs(id) ON DELETE SET NULL (unchanged)
--     Must rebuild for the same reason. Children-first DROP order
--     (messages → citation_records → query_logs → mcp_tokens) prevents
--     this SET NULL from silently firing while DROPping query_logs
--     (the 0007 WARNING, reaffirmed by 0008 header).
--
-- =========================================================================
-- FK dependency tree (inherited from 0009 header lines 17-26)
-- =========================================================================
--   user(id)
--     ├─ account.userId                ON DELETE CASCADE  (0009, unchanged)
--     ├─ session.userId                ON DELETE CASCADE  (0009, unchanged)
--     ├─ passkey.userId                ON DELETE CASCADE  (0009, unchanged)
--     ├─ member_role_changes.user_id   FK (no ON DELETE) → 0010 removes FK
--     └─ mcp_tokens.created_by_user_id FK (no ON DELETE) → 0010 CASCADE
--          └─ query_logs.mcp_token_id  FK (no ON DELETE) → 0010 SET NULL
--               ├─ citation_records.query_log_id  ON DELETE CASCADE
--               └─ messages.query_log_id          ON DELETE SET NULL
--
-- =========================================================================
-- D1 constraints recap (see 0007 header for full treatment)
-- =========================================================================
--   * `PRAGMA foreign_keys = OFF` is silently ignored.
--   * `DROP TABLE parent` aborts with SQLITE_CONSTRAINT_FOREIGNKEY while
--     any child FK points at it.
--   * Therefore we rebuild in mirror of 0008's five-table pattern:
--     build all `_new` tables first → INSERT SELECT → children-first DROP
--     → RENAME → rebuild indexes.
--
-- Column lists below are verbatim from the post-0009 live schema
-- (verified 2026-04-21 via `sqlite_master` on
-- `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` and by
-- cross-referencing `0009_passkey_and_display_name.sql`). Only the FK
-- clauses called out above change; every other column / check / default
-- is preserved.
--
-- =========================================================================
-- Idempotency note (2026-04-21)
-- =========================================================================
-- An ad-hoc session-level patch already rebuilt local `member_role_changes`
-- (no FK) on the miniflare D1 before this migration existed. The
-- CREATE → INSERT SELECT → DROP → RENAME flow normalizes both the
-- "still-has-FK" (production) and "already-patched" (local) input states
-- to the same output shape, so applying 0010 is safe regardless.

PRAGMA defer_foreign_keys = ON;

-- =========================================================================
-- (A) member_role_changes — independent of the mcp_tokens chain.
--     Rebuild removes `FOREIGN KEY (user_id) REFERENCES user(id)` so audit
--     tombstones (`reason = 'self-deletion'`) survive DELETE FROM "user".
-- =========================================================================

CREATE TABLE member_role_changes_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO member_role_changes_new (
  id, user_id, from_role, to_role, changed_by, reason, created_at
)
SELECT
  id, user_id, from_role, to_role, changed_by, reason, created_at
FROM member_role_changes;

DROP TABLE member_role_changes;
ALTER TABLE member_role_changes_new RENAME TO member_role_changes;

-- =========================================================================
-- (B) mcp_tokens chain: build all `_new` tables before dropping anything,
--     so the children's FK REFERENCES point at the new parent during
--     INSERT SELECT. Matches 0008 section (1)-(6).
-- =========================================================================

-- (1) mcp_tokens_new — created_by_user_id gets ON DELETE CASCADE.
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
  created_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
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

-- (2) query_logs_new — FK re-bind to mcp_tokens_new, mcp_token_id becomes
--     ON DELETE SET NULL (TD-011 Decision 2 revision).
--     user_profile_id still points at user_profiles (unchanged).
CREATE TABLE query_logs_new (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('web', 'mcp')),
  user_profile_id TEXT REFERENCES user_profiles(id),
  mcp_token_id TEXT REFERENCES mcp_tokens_new(id) ON DELETE SET NULL,
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

-- (3) citation_records_new — FK re-bind to query_logs_new; ON DELETE
--     CASCADE preserved. Other FKs (document_versions, source_chunks)
--     unchanged.
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

-- (4) messages_new — FK re-bind to query_logs_new; ON DELETE SET NULL
--     preserved. conversation_id CASCADE on conversations unchanged.
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
-- (5) Swap: children-first DROP.
--     Without this order, DROP query_logs would fire messages.query_log_id
--     ON DELETE SET NULL and silently null every linkage (0007 WARNING;
--     0008 header lines 31-44). Dropping messages first makes the
--     trigger a no-op.
-- =========================================================================

DROP TABLE messages;
DROP TABLE citation_records;
DROP TABLE query_logs;
DROP TABLE mcp_tokens;

-- =========================================================================
-- (6) RENAME *_new to canonical names. SQLite rewrites the FK REFERENCES
--     strings on the `_new` tables to point at the renamed parents
--     automatically (same behaviour as 0007 / 0008 / 0009).
-- =========================================================================

ALTER TABLE mcp_tokens_new      RENAME TO mcp_tokens;
ALTER TABLE query_logs_new      RENAME TO query_logs;
ALTER TABLE citation_records_new RENAME TO citation_records;
ALTER TABLE messages_new        RENAME TO messages;

-- =========================================================================
-- (7) Recreate indexes. `token_hash UNIQUE` on mcp_tokens is declared at
--     the column level and therefore travels with the rebuild, so only
--     the named indexes below need recreating (subset of 0009 lines
--     388-410 that touch the chain tables + member_role_changes).
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_member_role_changes_user_created
  ON member_role_changes(user_id, created_at);

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
-- (8) Post-rebuild integrity report. Mirrors 0007 / 0008 / 0009.
--     `PRAGMA foreign_key_check` is diagnostic output; the implicit COMMIT
--     also re-runs deferred FK enforcement and aborts on real violations.
--     Operators still verify this returns zero rows in local / production
--     post-apply checks.
-- =========================================================================

PRAGMA foreign_key_check;
