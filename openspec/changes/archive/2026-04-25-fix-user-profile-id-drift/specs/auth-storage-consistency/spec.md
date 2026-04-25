## ADDED Requirements

### Requirement: Session Hook Resolves user_profiles by Email Normalized

The `session.create.before` hook in `server/auth.config.ts` SHALL NOT use `onConflictDoUpdate` targeting `user_profiles.id` for synchronizing the profile row. It SHALL instead query `user_profiles` by `email_normalized` first, then branch by whether an existing row's `id` matches the current better-auth `user.id`:

- If no row exists for the email, the hook SHALL INSERT a new `user_profiles` row with the current `user.id`.
- If a row exists and its `id` equals the current `user.id`, the hook SHALL UPDATE the non-id columns (`role_snapshot`, `admin_source`) on that row.
- If a row exists and its `id` differs from the current `user.id`, the hook SHALL perform an application-level migration: within a single database transaction, UPDATE all children `user_profile_id` references (`conversations`, `query_logs`, `messages`) and `documents.created_by_user_id` from the stale id to the current `user.id`, then UPDATE the stale `user_profiles.id` to the current `user.id` along with `role_snapshot` and `admin_source`. The transaction SHALL commit atomically or roll back entirely.

The hook SHALL NOT require any schema change to `user_profiles` or its children FK cascade rules.

#### Scenario: No existing profile row for the email

- **WHEN** a user with `email_normalized = "alice@example.com"` signs in for the first time and no row in `user_profiles` matches that email
- **THEN** the hook SHALL INSERT a new `user_profiles` row with `id = session.userId` and `email_normalized = "alice@example.com"`
- **AND** no children tables SHALL be touched

#### Scenario: Existing profile row already matches current user id

- **WHEN** a user signs in with `session.userId = "user_abc"` and `user_profiles` already contains a row with `id = "user_abc"` and the same email
- **THEN** the hook SHALL UPDATE `role_snapshot` and `admin_source` on that row
- **AND** `user_profiles.id` SHALL remain `"user_abc"`
- **AND** no children tables SHALL be touched

#### Scenario: Stale profile row with different id triggers application-level migration

- **WHEN** a user signs in with `session.userId = "user_new"` and `user_profiles` contains a row with `id = "user_old"` but the same `email_normalized`
- **AND** children tables contain rows referencing `user_profile_id = "user_old"` (or `created_by_user_id = "user_old"` on `documents`)
- **THEN** the hook SHALL open a database transaction
- **AND** UPDATE `conversations`, `query_logs`, `messages` rows where `user_profile_id = "user_old"` to `user_profile_id = "user_new"`
- **AND** UPDATE `documents` rows where `created_by_user_id = "user_old"` to `created_by_user_id = "user_new"`
- **AND** UPDATE the `user_profiles` row by setting `id = "user_new"`, updating `role_snapshot` and `admin_source`
- **AND** commit the transaction
- **AND** subsequent `INSERT INTO conversations (..., user_profile_id) VALUES (..., "user_new")` SHALL succeed without FOREIGN KEY violation

##### Example: stale-to-new migration row counts

- **GIVEN** `user_profiles` contains `{id: "old", email_normalized: "alice@example.com"}` and the following children rows reference `user_profile_id = "old"`:
  | Table | Rows with user_profile_id = "old" |
  |---|---|
  | conversations | 3 |
  | query_logs | 5 |
  | messages | 12 |
  | documents (created_by_user_id) | 1 |
- **WHEN** a user signs in with `session.userId = "new"` and matching email
- **THEN** after the hook returns, `SELECT COUNT(*) FROM conversations WHERE user_profile_id = "new"` SHALL be 3
- **AND** `SELECT COUNT(*) FROM conversations WHERE user_profile_id = "old"` SHALL be 0
- **AND** `SELECT id FROM user_profiles WHERE email_normalized = "alice@example.com"` SHALL be `"new"`
- **AND** the same invariants SHALL hold for `query_logs`, `messages`, and `documents`

---

### Requirement: Session Hook Rethrows Sync Errors Outside Production

The `session.create.before` hook SHALL wrap the `user_profiles` synchronization logic (including the migration transaction of the prior requirement) in a try/catch. When `process.env.NODE_ENV` is any value other than `"production"` (including `"development"`, `"test"`, `"preview"`, or unset), the catch handler SHALL rethrow the error after logging, causing the login request to fail with a visible server error. When `process.env.NODE_ENV === "production"`, the catch handler SHALL log the error and return normally, preserving the session creation.

The catch handler SHALL NOT block session creation in production under any circumstance; the error log alone is the observability signal for production operators.

#### Scenario: Non-production rethrow on unexpected error

- **WHEN** `process.env.NODE_ENV = "development"` and the migration transaction throws any error
- **THEN** the hook SHALL rethrow the error
- **AND** the login request SHALL fail with a 5xx response visible in the developer's terminal
- **AND** the test (`vitest`) process SHALL see the thrown error

#### Scenario: Production swallow preserves session

- **WHEN** `process.env.NODE_ENV = "production"` and the migration transaction throws any error
- **THEN** the hook SHALL log the error and return normally
- **AND** session creation SHALL succeed
- **AND** the user's login SHALL complete without HTTP error

#### Scenario: Preview environment follows non-production path

- **WHEN** `process.env.NODE_ENV = "preview"` and any error is thrown in the hook
- **THEN** the hook SHALL rethrow the error
- **AND** this is intentional: preview is treated as non-production so regressions surface before production rollout

---

### Requirement: Session Hook Emits Actionable Log Fields on Sync Failure

When the `session.create.before` hook catches a `user_profiles` synchronization error (in either production or non-production mode, before any rethrow), it SHALL emit a log entry at `error` level whose structured fields include at minimum:

- `userId`: the current `session.userId`
- `emailNormalized`: the email in redacted form (first 3 characters + `"***"`) — the hook SHALL NOT log the full email address as PII protection
- `error`: the error message string
- `hint`: a fixed string explaining the likely cause and investigation path, for example `"Stale user_profiles row may exist with same email_normalized but different id; app-level migrate likely failed; inspect user_profiles + children FKs."`

The `hint` field SHALL be emitted on every catch, regardless of whether the specific error is the UNIQUE(email_normalized) case or any other failure, because it documents the most common diagnosis first.

#### Scenario: UNIQUE conflict error emits hint

- **WHEN** the migration transaction throws a UNIQUE constraint error on `email_normalized`
- **THEN** the log entry SHALL contain `hint` with the stale-row explanation string
- **AND** `userId`, `emailNormalized` (redacted), and `error` fields SHALL be present

#### Scenario: Email is redacted in log output

- **GIVEN** a user with `email_normalized = "alice@example.com"`
- **WHEN** any sync error occurs
- **THEN** the log entry's `emailNormalized` field SHALL be `"ali***"` (first 3 characters + literal `"***"`)
- **AND** the full email `"alice@example.com"` SHALL NOT appear in any log field
