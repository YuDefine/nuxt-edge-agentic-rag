-- 0012_fk_rebuild_user_references.sql
-- Repair account / session / passkey FK references that still point at
-- `user_new` instead of `"user"`.
--
-- Background:
--   0007 / 0009 created `*_new` tables with `REFERENCES user_new(id)` and
--   relied on SQLite's modern RENAME-rewrite behaviour
--   (`legacy_alter_table = OFF`) to retarget the FK text from `user_new` to
--   `"user"` after `ALTER TABLE user_new RENAME TO "user"`.
--
--   That assumption holds on Cloudflare D1 but NOT on the libsql backend
--   used by NuxtHub local dev, where `legacy_alter_table = 1` is the
--   default. The result on local: `account`, `session`, and `passkey` keep
--   `REFERENCES user_new(id)` in their stored DDL, and any INSERT fails
--   with `no such table: main.user_new` because `user_new` no longer
--   exists. Better-auth catches this in its OAuth callback link path and
--   redirects to `/api/auth/error?error=unable_to_link_account`.
--
-- Strategy:
--   Rebuild each affected table with an EXPLICIT `REFERENCES "user"(id)`
--   so the stored DDL no longer depends on RENAME-rewrite behaviour.
--   Idempotent in result: on D1 (where text is already `"user"`) this is a
--   slow no-op; on libsql (where text is still `user_new`) this fixes it.
--
-- Safety:
--   - Tables `account` / `session` / `passkey` have nothing referencing
--     them, so DROP TABLE is safe even with `foreign_keys = ON`.
--   - PRAGMA `legacy_alter_table = OFF` is set defensively so the final
--     RENAME also benefits from modern behaviour where supported.
--   - Production D1 already has correct FK text per migration 0007's
--     verification note; this migration changes nothing observable there.

PRAGMA legacy_alter_table = OFF;

-- ------------------------------------------------------------------
-- account
-- ------------------------------------------------------------------
CREATE TABLE account_v12 (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
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

INSERT INTO account_v12 (
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

DROP TABLE "account";
ALTER TABLE account_v12 RENAME TO "account";
CREATE INDEX account_userId_idx ON "account"(userId);

-- ------------------------------------------------------------------
-- session
-- ------------------------------------------------------------------
CREATE TABLE session_v12 (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO session_v12 (
  id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt
)
SELECT
  id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt
FROM "session";

DROP TABLE "session";
ALTER TABLE session_v12 RENAME TO "session";

-- ------------------------------------------------------------------
-- passkey
-- ------------------------------------------------------------------
CREATE TABLE passkey_v12 (
  id TEXT PRIMARY KEY,
  name TEXT,
  publicKey TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  credentialID TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  deviceType TEXT NOT NULL,
  backedUp INTEGER NOT NULL DEFAULT 0 CHECK (backedUp IN (0, 1)),
  transports TEXT,
  createdAt INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  aaguid TEXT
);

INSERT INTO passkey_v12 (
  id, name, publicKey, userId, credentialID, counter, deviceType,
  backedUp, transports, createdAt, aaguid
)
SELECT
  id, name, publicKey, userId, credentialID, counter, deviceType,
  backedUp, transports, createdAt, aaguid
FROM passkey;

DROP TABLE passkey;
ALTER TABLE passkey_v12 RENAME TO passkey;
CREATE UNIQUE INDEX passkey_credentialID_idx ON passkey(credentialID);
CREATE INDEX passkey_userId_idx ON passkey(userId);

-- ------------------------------------------------------------------
-- Diagnostic — ensures FKs resolve to existing tables.
-- ------------------------------------------------------------------
PRAGMA foreign_key_check;
