-- fix-better-auth-timestamp-affinity: rebuild `user` + `account` (and the
-- full FK dependency cascade) to realign D1 column affinity with the
-- drizzle declarations in `.nuxt/better-auth/schema.sqlite.ts`.
--
-- Drift inventory (verified 2026-04-19 via `wrangler d1 execute --remote`):
--
--   user.createdAt                  TEXT → INTEGER (timestamp_ms)
--   user.updatedAt                  TEXT → INTEGER (timestamp_ms)
--   user.banExpires                 TEXT → INTEGER (timestamp_ms, nullable)
--   account.createdAt               TEXT → INTEGER (timestamp_ms)
--   account.updatedAt               TEXT → INTEGER (timestamp_ms)
--   account.accessTokenExpiresAt    TEXT → INTEGER (nullable)
--   account.refreshTokenExpiresAt   TEXT → INTEGER (nullable)
--   account_userId_idx              MISSING → CREATE (declared by drizzle, never built)
--
-- Out of scope (verified drift but NOT rebuilt — see design § Open Questions):
--   * `session` / `verification`: TEXT affinity drift on timestamps, but NOT
--     in `.nuxt/better-auth/schema.sqlite.ts` (better-auth reads them via
--     raw SQL, drizzle `timestamp_ms` mapper never touches these rows).
--     `session` is rebuilt below purely to re-bind its FK to the new `user`
--     (timestamp columns stay TEXT).
--
-- D1 FK constraints (verified 2026-04-20 via `wrangler d1 execute --local`):
--   * Cloudflare D1 silently ignores `PRAGMA foreign_keys = OFF` (the PRAGMA
--     parses fine, but reading it back still returns 1). The canonical
--     SQLite table-rebuild recipe (`foreign_keys=OFF` first) does not apply.
--   * Cloudflare D1 rejects `PRAGMA writable_schema = ON` with SQLITE_AUTH,
--     so the schema-text workaround (UPDATE sqlite_schema) is also unavailable.
--   * `PRAGMA defer_foreign_keys = ON` is supported, but only defers row-
--     level FK checks to COMMIT — it does NOT allow DROP parent while child
--     FK references still exist. DROP parent aborts with
--     `SQLITE_CONSTRAINT_FOREIGNKEY` at DDL time regardless.
--   * SQLite modern behaviour (`legacy_alter_table = OFF`, default on D1)
--     auto-rewrites child FK `REFERENCES` text when the parent is renamed.
--
-- Consequence: on D1 a parent-table rebuild requires rebuilding every
-- transitive FK descendant in a single migration batch — there is no way
-- to bypass FK enforcement the way the canonical SQLite recipe assumes.
--
-- FK dependency tree rooted at user(id):
--
--   user  ← "user"(id)
--     account.userId  (ON DELETE CASCADE)
--     session.userId  (ON DELETE CASCADE)
--     member_role_changes.user_id
--     mcp_tokens.created_by_user_id         (added by 0006)
--       query_logs.mcp_token_id             (0001 — mcp_tokens is its parent)
--         citation_records.query_log_id     (0001 — query_logs is its parent,
--                                            ON DELETE CASCADE)
--         messages.query_log_id             (0001 — query_logs is its parent,
--                                            ON DELETE SET NULL — see WARNING below)
--
-- WARNING — `ON DELETE SET NULL` is what made the first cut of this
-- migration silently corrupt data. `DROP TABLE query_logs` does NOT raise
-- SQLITE_CONSTRAINT_FOREIGNKEY for `messages.query_log_id` (which has
-- `ON DELETE SET NULL`) — instead SQLite walks the dependent rows and sets
-- `query_log_id = NULL` on every match. After the rebuild rename the column
-- structure is restored but the values are gone. To preserve the historical
-- message → query_log linkage (production has 70 such edges), `messages` is
-- rebuilt in this cascade and `messages` is dropped BEFORE `query_logs` so
-- the SET NULL never fires.
--
-- The cascade has eight tables; all eight are rebuilt here. `messages`,
-- `query_logs`, and `citation_records` have no schema drift themselves —
-- they are touched only so their FK edges can be moved from the old
-- `mcp_tokens` / `query_logs` onto the new ones without hitting the DROP-
-- parent-with-children block (and, for `messages`, without triggering the
-- silent SET NULL described above).
--
-- Migration strategy (Option V, verified on local D1 with a full prod dump):
--   1. Create a `_new` copy of each of the eight affected tables. Each
--      `_new` table references `user_new` / `mcp_tokens_new` /
--      `query_logs_new` instead of the canonical names.
--   2. Copy data into every `_new` table with CASE-based timestamp
--      normalization on the columns that change affinity.
--   3. DROP the old tables in FK-children-first order (messages →
--      citation_records → query_logs → mcp_tokens →
--      member_role_changes / session / account → user). At each step the
--      table being dropped has no live FK pointing at it — incoming FK
--      edges either came from a table already dropped or from `_new` tables
--      that target `*_new` names.
--   4. RENAME every `_new` into its canonical name. SQLite auto-rewrites
--      the sibling FK refs in the stored DDL (e.g. `REFERENCES user_new(id)`
--      → `REFERENCES "user"(id)`) during each rename.
--   5. Recreate the named indexes that the DROP TABLEs erased.
--   6. `PRAGMA foreign_key_check` — diagnostic only; the implicit COMMIT
--      also re-runs full deferred-FK checks.
--
-- Value normalization (`CASE WHEN CAST(col AS REAL) >= 1e12`):
--   * Production rows inserted by better-auth carry float-like TEXT such
--     as `"1776332449872.0"` (JS `Date.now()` coerced by TEXT affinity on
--     write). `CAST(col AS REAL)` parses to 1776332449872.0, exceeds the
--     year-2001 threshold (>= 1e12 ms); `CAST(... AS INTEGER)` rounds it.
--   * Rows materialised from the SQLite `CURRENT_TIMESTAMP` default hold
--     ISO datetime strings like `"2026-04-19 23:00:45"`. `CAST` to REAL
--     stops at the first non-digit (yielding 2026), which is below the
--     threshold, so the fallback `unixepoch(col) * 1000` rescues them.
--   * NULL / empty-string on nullable columns (`banExpires`, token expiries)
--     is preserved as NULL via explicit `WHEN ... IS NULL OR ... = '' THEN NULL`.
--   * Any other unparseable shape produces `unixepoch(col) = NULL`, which
--     will abort INSERT with a NOT NULL error. The pre-flight script
--     (`scripts/checks/verify-auth-storage-consistency.sh --preflight`)
--     catches those cases first so this path is never reached at runtime.
--
-- Release checklist (MUST run in order before --remote apply):
--   1. wrangler d1 export agentic-rag-db --remote --output tmp/snapshot.sql
--   2. bash scripts/checks/verify-auth-storage-consistency.sh --preflight
--      (assertion gate — refuses if FK orphans or bad timestamps present)
--   3. Reset local miniflare D1 and load the snapshot:
--        rm -f .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite*
--        sqlite3 <d1 sqlite path> < tmp/snapshot.sql
--      Then: wrangler d1 migrations apply agentic-rag-db --local
--   4. bash scripts/checks/verify-auth-storage-consistency.sh --local
--   5. wrangler d1 migrations apply agentic-rag-db --remote
--   6. bash scripts/checks/verify-auth-storage-consistency.sh --remote
--
-- Rollback: if step 6 fails, restore all eight tables atomically from the
-- snapshot in step 1 (single `wrangler d1 execute --file <restore.sql>`),
-- then `DELETE FROM d1_migrations WHERE name LIKE '0007_%';` so a fixed
-- retry can re-apply. Phase 1's `sql<>` parser in
-- `server/api/admin/members/index.get.ts` keeps the endpoint functional
-- through TEXT-affinity rows, so there is no user-visible outage during
-- rollback.

PRAGMA defer_foreign_keys = ON;

-- =========================================================================
-- (1) `user_new` — the primary goal: INTEGER timestamp columns.
--
-- DEFAULT moves from CURRENT_TIMESTAMP (which returns TEXT and would re-
-- introduce the bug) to the drizzle-declared
-- `cast(unixepoch('subsecond') * 1000 as integer)`. role / banned / banReason
-- columns mirror live prod schema (drift from drizzle is out of scope).
-- =========================================================================

CREATE TABLE user_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updatedAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  role TEXT NOT NULL DEFAULT 'user',
  banned INTEGER NOT NULL DEFAULT 0,
  banReason TEXT,
  banExpires INTEGER
);

INSERT INTO user_new (
  id, name, email, emailVerified, image,
  createdAt, updatedAt, role, banned, banReason, banExpires
)
SELECT
  id, name, email, emailVerified, image,
  CASE
    WHEN CAST(createdAt AS REAL) >= 1000000000000
      THEN CAST(CAST(createdAt AS REAL) AS INTEGER)
    ELSE CAST(unixepoch(createdAt) AS INTEGER) * 1000
  END,
  CASE
    WHEN CAST(updatedAt AS REAL) >= 1000000000000
      THEN CAST(CAST(updatedAt AS REAL) AS INTEGER)
    ELSE CAST(unixepoch(updatedAt) AS INTEGER) * 1000
  END,
  role, banned, banReason,
  CASE
    WHEN banExpires IS NULL OR banExpires = '' THEN NULL
    WHEN CAST(banExpires AS REAL) >= 1000000000000
      THEN CAST(CAST(banExpires AS REAL) AS INTEGER)
    ELSE CAST(unixepoch(banExpires) AS INTEGER) * 1000
  END
FROM "user";

-- =========================================================================
-- (2) `account_new` — the other timestamp-affinity goal.
--
-- FK references user_new(id) explicitly. After the final RENAME
-- (user_new → "user"), SQLite rewrites this to `REFERENCES "user"(id)` so
-- the canonical schema ends up identical to drizzle's declaration.
--
-- `updatedAt` gains a DB-side DEFAULT as belt-and-braces for raw-SQL inserts
-- — drizzle always supplies the value via `$onUpdate`, but seeds / tests /
-- manual repairs shouldn't fail with a cryptic NOT NULL error.
-- =========================================================================

CREATE TABLE account_new (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user_new(id) ON DELETE CASCADE,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  idToken TEXT,
  createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updatedAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
);

INSERT INTO account_new (
  id, userId, accountId, providerId,
  accessToken, refreshToken,
  accessTokenExpiresAt, refreshTokenExpiresAt,
  scope, password, idToken,
  createdAt, updatedAt
)
SELECT
  id, userId, accountId, providerId,
  accessToken, refreshToken,
  CASE
    WHEN accessTokenExpiresAt IS NULL OR accessTokenExpiresAt = '' THEN NULL
    WHEN CAST(accessTokenExpiresAt AS REAL) >= 1000000000000
      THEN CAST(CAST(accessTokenExpiresAt AS REAL) AS INTEGER)
    ELSE CAST(unixepoch(accessTokenExpiresAt) AS INTEGER) * 1000
  END,
  CASE
    WHEN refreshTokenExpiresAt IS NULL OR refreshTokenExpiresAt = '' THEN NULL
    WHEN CAST(refreshTokenExpiresAt AS REAL) >= 1000000000000
      THEN CAST(CAST(refreshTokenExpiresAt AS REAL) AS INTEGER)
    ELSE CAST(unixepoch(refreshTokenExpiresAt) AS INTEGER) * 1000
  END,
  scope, password, idToken,
  CASE
    WHEN CAST(createdAt AS REAL) >= 1000000000000
      THEN CAST(CAST(createdAt AS REAL) AS INTEGER)
    ELSE CAST(unixepoch(createdAt) AS INTEGER) * 1000
  END,
  CASE
    WHEN CAST(updatedAt AS REAL) >= 1000000000000
      THEN CAST(CAST(updatedAt AS REAL) AS INTEGER)
    ELSE CAST(unixepoch(updatedAt) AS INTEGER) * 1000
  END
FROM "account";

-- =========================================================================
-- (3) `session_new` — FK re-bind only, schema otherwise unchanged.
-- =========================================================================

CREATE TABLE session_new (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user_new(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO session_new (
  id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt
)
SELECT
  id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt
FROM "session";

-- =========================================================================
-- (4) `mcp_tokens_new` — FK re-bind only.
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
  created_by_user_id TEXT REFERENCES user_new(id)
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
-- (5) `query_logs_new` — FK re-bind only.
--
-- Holds FK `mcp_token_id → mcp_tokens(id)`. When the old mcp_tokens gets
-- dropped, query_logs would block the drop with SQLITE_CONSTRAINT_FOREIGNKEY,
-- so query_logs has to be rebuilt pointing at mcp_tokens_new.
-- Column list comes from `sqlite_schema` on prod (0001 columns + the four
-- observability columns added by 0005).
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
-- (6) `citation_records_new` — FK re-bind only.
--
-- `citation_records.query_log_id → query_logs(id) ON DELETE CASCADE`. The
-- CASCADE cascade delete would normally fire when query_logs is dropped, but
-- because we drop citation_records FIRST (section 8) the cascade never runs.
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
-- (7) `messages_new` — FK re-bind only, MUST drop before query_logs.
--
-- `messages.query_log_id → query_logs(id) ON DELETE SET NULL` would silently
-- null all 70 production message → query_log links if `messages` were left
-- in place during `DROP TABLE query_logs` (the SET NULL action fires at row
-- deletion time, and DROP TABLE counts as deleting all rows). Rebuilding
-- messages here and dropping it before query_logs preserves the linkage:
-- messages_new keeps the original query_log_id values pointing at
-- query_logs_new(id), and after the final RENAME the schema collapses back
-- to `REFERENCES "query_logs"(id)`.
--
-- Other FKs (user_profile_id → user_profiles, conversation_id → conversations)
-- are unchanged because user_profiles and conversations are not in the
-- cascade and continue to exist under their canonical names throughout.
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
-- (8) `member_role_changes_new` — FK re-bind only.
-- =========================================================================

CREATE TABLE member_role_changes_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user_new(id)
);

INSERT INTO member_role_changes_new (
  id, user_id, from_role, to_role, changed_by, reason, created_at
)
SELECT
  id, user_id, from_role, to_role, changed_by, reason, created_at
FROM member_role_changes;

-- =========================================================================
-- (9) Swap: DROP old tables in children-first order.
--
-- `messages` and `citation_records` MUST come before `query_logs`:
--   * messages.query_log_id has ON DELETE SET NULL — dropping messages
--     erases the FK edge cleanly; leaving it in place during DROP query_logs
--     would silently null all message → query_log values
--   * citation_records.query_log_id has ON DELETE CASCADE — dropping
--     citation_records erases the FK edge cleanly; leaving it would cascade-
--     delete during DROP query_logs (data is already in citation_records_new
--     so the rows would survive, but the dependency would still abort the
--     swap unpredictably)
--
-- After children dropped, `query_logs` has no live FK pointing at it, so
-- `DROP TABLE query_logs` succeeds and frees `mcp_tokens` to be dropped,
-- which in turn frees `user`.
-- =========================================================================

DROP TABLE messages;
DROP TABLE citation_records;
DROP TABLE query_logs;
DROP TABLE mcp_tokens;
DROP TABLE "account";
DROP TABLE "session";
DROP TABLE member_role_changes;
DROP TABLE "user";

-- =========================================================================
-- (10) Rename `_new` tables into their canonical names.
--
-- Each RENAME triggers SQLite's automatic rewrite of FK `REFERENCES *_new(id)`
-- in dependent tables' stored DDL. For example, after `user_new → "user"`,
-- account_new's `userId REFERENCES user_new(id)` becomes
-- `userId REFERENCES "user"(id)`. Verified 2026-04-20 on local D1.
-- =========================================================================

ALTER TABLE user_new RENAME TO "user";
ALTER TABLE account_new RENAME TO "account";
ALTER TABLE session_new RENAME TO "session";
ALTER TABLE mcp_tokens_new RENAME TO mcp_tokens;
ALTER TABLE query_logs_new RENAME TO query_logs;
ALTER TABLE citation_records_new RENAME TO citation_records;
ALTER TABLE messages_new RENAME TO messages;
ALTER TABLE member_role_changes_new RENAME TO member_role_changes;

-- =========================================================================
-- (11) Recreate indexes the DROP TABLEs removed.
--
-- PK and UNIQUE auto-indexes regenerate from the inline constraints, so
-- only explicit `CREATE INDEX` indexes need to come back here.
--
-- `account_userId_idx` is declared by drizzle (see
-- `.nuxt/better-auth/schema.sqlite.ts`) but was never built in production —
-- now is the time to fix that gap.
--
-- Note: production has historical duplicate indexes on query_logs / messages /
-- citation_records (a `<table>_<cols>_idx` plus an `idx_<table>_<cols>` pair
-- with the same key). We recreate ONE of each pair — the one whose name
-- follows the project's `idx_<table>_<cols>` convention — and leave the
-- legacy duplicate absent, since both served the same query plans.
-- =========================================================================

CREATE INDEX IF NOT EXISTS account_userId_idx ON "account"(userId);
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
CREATE INDEX IF NOT EXISTS idx_member_role_changes_user_created
  ON member_role_changes(user_id, created_at);

-- =========================================================================
-- (12) Post-swap integrity report (diagnostic only).
-- =========================================================================

PRAGMA foreign_key_check;
