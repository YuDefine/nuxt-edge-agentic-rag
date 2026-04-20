## ADDED Requirements

### Requirement: Passkey Table Storage Matches Better-auth Plugin Schema

The D1 database SHALL contain a `passkey` table whose column types match the better-auth passkey plugin schema emitted into `.nuxt/better-auth/schema.sqlite.ts`. The migration that introduces this table SHALL be auditable (explicit SQL migration file) rather than relying on runtime schema auto-generation.

#### Scenario: PRAGMA table_info on passkey returns expected columns

- **WHEN** an operator runs `PRAGMA table_info(passkey)` against the production D1 database
- **THEN** the output SHALL contain columns for the credential id, user id reference, public key, counter, device type, backed-up state, transports, and a created-at timestamp with `INTEGER` affinity where the drizzle declaration uses `timestamp_ms`

#### Scenario: User id foreign key integrity holds after migration

- **WHEN** the migration commits
- **THEN** `PRAGMA foreign_key_check` SHALL return zero rows for the `passkey` table
- **AND** every `passkey.user_id` SHALL reference an existing `user.id`

---

### Requirement: User Email Is Nullable With Partial Unique Index

The `user.email` column SHALL allow `NULL` values to support passkey-first users who register without an email. The uniqueness constraint SHALL apply only to non-NULL values via a partial unique index. The same policy SHALL apply to `user_profiles.email_normalized`.

#### Scenario: Migration makes email nullable without dropping uniqueness for non-NULL values

- **WHEN** the migration runs against a D1 database where `user.email` is currently `NOT NULL UNIQUE`
- **THEN** after the migration `user.email` SHALL be defined as `TEXT` without `NOT NULL`
- **AND** a partial unique index SHALL exist such that two rows with the same non-NULL email cannot coexist
- **AND** inserting two rows each with `email = NULL` SHALL succeed without a UNIQUE violation

#### Scenario: user_profiles.email_normalized uses sentinel for passkey-only users in this change

- **WHEN** a passkey-only user (whose `user.email IS NULL`) has a `user_profiles` row upserted
- **THEN** the `email_normalized` column SHALL store the sentinel value `'__passkey__:' || user.id`
- **AND** the sentinel SHALL be unique per user by construction (user.id is PK)
- **AND** `isAdminEmailAllowlisted()` SHALL never match a sentinel value (sentinels contain `:` which is not a valid email character)

Note: Full nullability of `user_profiles.email_normalized` is deferred to a
follow-up change (tracked as TD-009) because it requires rebuilding the
`user_profiles` FK child tree (`conversations`, `query_logs`, `messages`,
`documents`), which combined with the `user` tree rebuild in this migration
would exceed safe review surface.

---

### Requirement: Table Rebuild Migration Preserves Rows And Foreign Keys When Introducing Passkey Tables

Any migration that rebuilds better-auth tables to introduce passkey-related columns or indexes SHALL preserve every existing `user` and `account` row (identified by primary key `id`) and SHALL leave every existing foreign key reference valid after the rebuild.

#### Scenario: Row count preserved

- **WHEN** an operator runs the passkey-introduction migration against a D1 database containing `N` rows in `user` and `M` rows in `account`
- **THEN** after the migration commits, `SELECT count(*) FROM user` SHALL return `N`
- **AND** `SELECT count(*) FROM account` SHALL return `M`

#### Scenario: Foreign keys pass integrity check

- **WHEN** the migration reaches the integrity-check step
- **THEN** `PRAGMA foreign_key_check` SHALL return zero rows
- **AND** the migration SHALL only commit after that check passes

#### Scenario: Existing Admin session remains valid after migration

- **WHEN** the migration completes on a D1 database where an Admin user was identified by email `admin@example.com` and id `X` before the migration
- **THEN** `SELECT email FROM user WHERE id = 'X'` SHALL return `'admin@example.com'`
- **AND** the Admin's session SHALL remain valid without requiring re-login
