## ADDED Requirements

### Requirement: Custom Google Link Endpoint Writes Match Drizzle Timestamp Affinity

The custom OAuth link endpoint `GET /api/auth/account/link-google-for-passkey-first/callback` SHALL write `user.updatedAt`, `account.createdAt`, and `account.updatedAt` as integer millisecond epochs so that the stored D1 values retain `INTEGER` affinity consistent with the drizzle `timestamp_ms` declaration and with the existing Better-auth Tables Storage Type Matches Drizzle Declaration requirement.

#### Scenario: New account row inserted by custom endpoint stores integer timestamps

- **WHEN** a passkey-first user successfully completes the custom Google link flow
- **THEN** `SELECT typeof(createdAt), typeof(updatedAt) FROM account WHERE userId = <session.user.id> AND providerId = 'google'` SHALL return `'integer'` for both columns
- **AND** `SELECT typeof(updatedAt) FROM user WHERE id = <session.user.id>` SHALL return `'integer'`

#### Scenario: Atomic batch write preserves FK integrity

- **WHEN** the custom endpoint issues the D1 `batch` that updates `user` and inserts `account`
- **THEN** either both statements SHALL commit or both SHALL roll back
- **AND** after a successful commit `PRAGMA foreign_key_check` SHALL return zero rows
- **AND** after a failed batch the `user` row SHALL retain its pre-flow `email` value (NULL) and no `account` row with `providerId = 'google'` for that `userId` SHALL exist
