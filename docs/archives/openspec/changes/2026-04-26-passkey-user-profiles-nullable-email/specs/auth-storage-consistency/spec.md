## MODIFIED Requirements

### Requirement: User Email Is Nullable With Partial Unique Index

The `user.email` column SHALL allow `NULL` values to support passkey-first users who register without an email. The uniqueness constraint SHALL apply only to non-NULL values via a partial unique index. The same nullable-with-partial-unique policy SHALL apply to `user_profiles.email_normalized`: passkey-only users SHALL have `email_normalized = NULL`, and the partial unique index SHALL apply only when `email_normalized IS NOT NULL`.

#### Scenario: Migration makes email nullable without dropping uniqueness for non-NULL values

- **WHEN** the migration runs against a D1 database where `user.email` is currently `NOT NULL UNIQUE`
- **THEN** after the migration `user.email` SHALL be defined as `TEXT` without `NOT NULL`
- **AND** a partial unique index SHALL exist such that two rows with the same non-NULL email cannot coexist
- **AND** inserting two rows each with `email = NULL` SHALL succeed without a UNIQUE violation

#### Scenario: user_profiles.email_normalized stores NULL for passkey-only users

- **WHEN** a passkey-only user (whose `user.email IS NULL`) has a `user_profiles` row upserted via `session.create.before`
- **THEN** the `email_normalized` column SHALL store `NULL`
- **AND** two passkey-only users SHALL coexist in `user_profiles` without violating any UNIQUE constraint
- **AND** `isAdminEmailAllowlisted(email_normalized)` SHALL return `false` for `NULL` input via an explicit `IS NOT NULL` guard, not via implicit string-pattern exclusion

#### Scenario: Sentinel values from previous schema are migrated to NULL on schema rebuild

- **WHEN** the schema rebuild migration runs against a database that contains `user_profiles` rows with `email_normalized LIKE '__passkey__:%'` (the prior workaround sentinel)
- **THEN** the migration SHALL rebuild `user_profiles` and its FK children atomically within a single transaction
- **AND** every row whose previous `email_normalized` matched the sentinel pattern SHALL have its `email_normalized` set to `NULL` in the new table
- **AND** the post-migration `user_profiles` table SHALL contain zero rows whose `email_normalized` matches the sentinel pattern
- **AND** `PRAGMA foreign_key_check` SHALL return zero rows after the migration commits

#### Scenario: Partial unique index excludes both NULL and residual sentinel values

- **WHEN** the partial unique index on `user_profiles.email_normalized` is created
- **THEN** the index predicate SHALL include both `email_normalized IS NOT NULL` AND `email_normalized NOT LIKE '__passkey__:%'`
- **AND** any residual sentinel row left behind by an incomplete data backfill SHALL NOT cause a UNIQUE violation, providing defense-in-depth against backfill regressions
- **AND** real-email rows SHALL still enforce uniqueness against each other through the partial unique index
