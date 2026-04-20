-- passkey-authentication: introduce passkey plugin + display_name identity anchor
-- + nullable email (for passkey-first users).
--
-- Schema changes:
--   user.email                NOT NULL UNIQUE → NULL + partial unique index
--   user.display_name         NEW: TEXT NOT NULL, case-insensitive UNIQUE, IMMUTABLE
--   passkey                   NEW TABLE (better-auth @better-auth/passkey plugin)
--   user_profiles.email_normalized: DEFERRED to a follow-up migration (see TD below)
--
-- Deferred (follow-up TD-passkey-user-profiles-nullable):
--   user_profiles.email_normalized is still NOT NULL. Application layer writes
--   a sentinel value `__passkey__:<userId>` for passkey-only users until a
--   future migration rebuilds user_profiles + its FK children (conversations,
--   query_logs, messages, documents) to allow NULL. Rebuilding both user and
--   user_profiles trees in a single migration exceeds safe review surface.
--
-- FK dependency tree rooted at user(id) — inherited from migration 0007:
--   user
--     account.userId                     (ON DELETE CASCADE)
--     session.userId                     (ON DELETE CASCADE)
--     member_role_changes.user_id        (FK)
--     mcp_tokens.created_by_user_id      (FK)
--       query_logs.mcp_token_id          (FK)
--         citation_records.query_log_id  (ON DELETE CASCADE)
--         messages.query_log_id          (ON DELETE SET NULL — see 0007 WARNING)
--     passkey.userId                     (ON DELETE CASCADE, new table)
--
-- Strategy (same as 0007):
--   1. Create *_new tables with updated schema / FK references to user_new.
--   2. INSERT data with backfill for display_name.
--   3. CREATE the passkey table fresh (no legacy data).
--   4. DROP old tables children-first to avoid FK block + silent SET NULL.
--   5. RENAME *_new → canonical; SQLite auto-rewrites FK REFERENCES.
--   6. Recreate named indexes + the two new partial / case-insensitive
--      unique indexes on user.
--
-- display_name backfill policy (spec: nickname-identity-anchor):
--   * name IS NOT NULL + not a case-insensitive duplicate → copy name verbatim
--   * name IS NULL / empty → 'user_' || substr(id, 1, 8)
--   * name collides with another row (case-insensitive) → earliest createdAt
--     keeps the bare name; later rows get '<name>#<short id>' suffix.
--   Uses ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY createdAt).
--
-- Release checklist (same pattern as 0007):
--   1. Snapshot prod: wrangler d1 export <db> --remote --output tmp/0009-pre.sql
--   2. Preflight: no existing user row has display_name populated (it doesn't
--      exist yet, so this is implicit — just verify `PRAGMA table_info(user)`
--      before applying and confirm no display_name column present).
--   3. wrangler d1 migrations apply <db> --local; reload from snapshot first.
--   4. Smoke: PRAGMA table_info(user); PRAGMA table_info(passkey);
--             SELECT count(*) pre vs post; PRAGMA foreign_key_check.
--   5. wrangler d1 migrations apply <db> --remote.
--
-- Rollback: restore 0009-pre.sql snapshot; DELETE FROM d1_migrations
-- WHERE name LIKE '0009_%'.

PRAGMA defer_foreign_keys = ON;

-- =========================================================================
-- (1) user_new — email nullable, display_name NOT NULL, rest unchanged.
--
-- Column ordering preserves 0007 layout + appends display_name at the tail
-- so existing SELECT * consumers (there should be none — repo code uses
-- explicit column lists) continue to see the pre-0009 shape first.
-- =========================================================================

CREATE TABLE user_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  updatedAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  role TEXT NOT NULL DEFAULT 'user',
  banned INTEGER NOT NULL DEFAULT 0,
  banReason TEXT,
  banExpires INTEGER,
  display_name TEXT NOT NULL
);

INSERT INTO user_new (
  id, name, email, emailVerified, image, createdAt, updatedAt,
  role, banned, banReason, banExpires, display_name
)
SELECT
  id,
  name,
  email,  -- preserved as-is; existing rows always have email non-NULL
  emailVerified,
  image,
  createdAt,
  updatedAt,
  role,
  banned,
  banReason,
  banExpires,
  CASE
    WHEN name IS NULL OR trim(name) = ''
      THEN 'user_' || substr(id, 1, 8)
    WHEN name_rank = 1
      THEN name
    ELSE name || '#' || substr(id, 1, 8)
  END AS display_name
FROM (
  SELECT
    "user".*,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(coalesce(name, '')))
      ORDER BY createdAt, id
    ) AS name_rank
  FROM "user"
);

-- =========================================================================
-- (2) account_new — FK re-bind, schema otherwise unchanged from 0007.
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
  scope, password, idToken, createdAt, updatedAt
)
SELECT
  id, userId, accountId, providerId,
  accessToken, refreshToken,
  accessTokenExpiresAt, refreshTokenExpiresAt,
  scope, password, idToken, createdAt, updatedAt
FROM "account";

-- =========================================================================
-- (3) session_new — FK re-bind only.
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

INSERT INTO session_new (id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt)
SELECT id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt
FROM "session";

-- =========================================================================
-- (4) mcp_tokens_new — FK re-bind only.
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
  created_by_user_id TEXT NOT NULL REFERENCES user_new(id)
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
-- (5) query_logs_new — FK re-bind only.
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
-- (6) citation_records_new — FK re-bind only.
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
-- (7) messages_new — FK re-bind only; MUST drop before query_logs
-- (see 0007 WARNING: ON DELETE SET NULL would silently null message→log links).
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
-- (8) member_role_changes_new — FK re-bind only.
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
-- (9) passkey — NEW TABLE (better-auth @better-auth/passkey plugin schema).
--
-- Columns follow the plugin's emitted schema (see node_modules/
-- @better-auth/passkey/dist). INTEGER affinity on timestamps matches the
-- `timestamp_ms` drizzle declaration convention established in 0007.
--
-- `backedUp` + `counter` defaults are 0 (plugin sets them on each insert
-- via its own logic but DB defaults guard against raw-SQL inserts).
--
-- ON DELETE CASCADE on userId: revoking a user removes all their passkeys,
-- matching the self-deletion flow in decision 6.
-- =========================================================================

CREATE TABLE passkey (
  id TEXT PRIMARY KEY,
  name TEXT,
  publicKey TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user_new(id) ON DELETE CASCADE,
  credentialID TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  deviceType TEXT NOT NULL,
  backedUp INTEGER NOT NULL DEFAULT 0 CHECK (backedUp IN (0, 1)),
  transports TEXT,
  createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  aaguid TEXT
);

-- =========================================================================
-- (10) Swap: DROP old tables children-first. Order matches 0007 rationale.
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
-- (11) Rename *_new → canonical names. SQLite auto-rewrites sibling FK refs.
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
-- (12) Recreate indexes the DROP TABLEs removed + add new user indexes.
--
-- Unique / PK auto-indexes regenerate from inline constraints. Explicit
-- CREATE INDEX indexes must come back here.
--
-- NEW user indexes:
--   user_email_partial_unique         — enforces UNIQUE on non-NULL emails
--                                      only; two passkey-only rows with
--                                      email IS NULL can coexist.
--   user_display_name_unique_ci       — case-insensitive UNIQUE on display_name
--                                      (spec: nickname-identity-anchor).
--
-- Passkey indexes:
--   passkey_credentialID_idx          — plugin looks up credentials by
--                                      credentialID during authentication.
--   passkey_userId_idx                — lookup "all passkeys for a user"
--                                      during account settings listing.
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

CREATE UNIQUE INDEX IF NOT EXISTS user_email_partial_unique
  ON "user"(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_display_name_unique_ci
  ON "user"(lower(display_name));

CREATE UNIQUE INDEX IF NOT EXISTS passkey_credentialID_idx
  ON passkey(credentialID);
CREATE INDEX IF NOT EXISTS passkey_userId_idx
  ON passkey(userId);

-- =========================================================================
-- (13) Post-swap integrity report.
-- =========================================================================

PRAGMA foreign_key_check;
