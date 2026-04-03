# member-and-permission-model Specification

## Purpose

TBD - created by archiving change 'member-and-permission-management'. Update Purpose after archive.

## Requirements

### Requirement: Three-Tier Role Enum On Users

The `users` table SHALL include a `role` column constrained to the enum values `admin`, `member`, and `guest`. New rows inserted during OAuth callback SHALL default to `guest` unless the user email matches an entry in the runtime `ADMIN_EMAIL_ALLOWLIST`.

#### Scenario: New guest user is created on first OAuth login

- **WHEN** a user whose email is not in `ADMIN_EMAIL_ALLOWLIST` completes Google OAuth for the first time
- **THEN** the system creates a `users` row with `role = 'guest'`
- **AND** the system records a `member_role_changes` row with `from_role = 'guest'`, `to_role = 'guest'`, `changed_by = 'system'`, and `reason = 'initial-login'`

#### Scenario: Allowlisted user is seeded as admin on login

- **WHEN** a user whose email is in `ADMIN_EMAIL_ALLOWLIST` completes OAuth and no existing `users` row exists
- **THEN** the system creates a `users` row with `role = 'admin'`
- **AND** the system records an audit row with `to_role = 'admin'` and `changed_by = 'system'` and `reason = 'allowlist-seed'`

#### Scenario: Existing guest is promoted when added to allowlist

- **WHEN** an existing user with `role = 'guest'` logs in after their email was added to `ADMIN_EMAIL_ALLOWLIST`
- **THEN** the system updates `users.role` to `'admin'`
- **AND** writes an audit row with `from_role = 'guest'`, `to_role = 'admin'`, `changed_by = 'system'`

#### Scenario: Admin is demoted when removed from allowlist

- **WHEN** an existing user with `role = 'admin'` logs in after their email was removed from `ADMIN_EMAIL_ALLOWLIST`
- **THEN** the system updates `users.role` to `'member'`
- **AND** writes an audit row with `from_role = 'admin'`, `to_role = 'member'`, `changed_by = 'system'`, `reason = 'allowlist-removed'`

---

### Requirement: Admin Role Is Only Seeded From Env Var

The system SHALL treat `ADMIN_EMAIL_ALLOWLIST` as the sole source of truth for the `admin` role. No UI, API endpoint, or non-`system` caller SHALL be able to set `users.role = 'admin'` for any user whose email is not currently present in the allowlist.

#### Scenario: UI request to promote non-allowlisted user to admin is rejected

- **WHEN** an authenticated Admin submits `PATCH /api/admin/members/:userId` with `{ role: 'admin' }` and the target user's email is not in `ADMIN_EMAIL_ALLOWLIST`
- **THEN** the API responds with HTTP 403
- **AND** the response body explains that admin role is controlled by env var allowlist

#### Scenario: Admin cannot self-demote via UI

- **WHEN** an authenticated Admin submits `PATCH /api/admin/members/:userId` where `userId` equals their own id and `role != 'admin'`
- **THEN** the API responds with HTTP 403
- **AND** the response body instructs the caller to remove their email from `ADMIN_EMAIL_ALLOWLIST` instead

#### Scenario: Admin cannot demote another allowlisted admin

- **WHEN** an authenticated Admin submits `PATCH /api/admin/members/:userId` with `role != 'admin'` and the target user's email is currently in `ADMIN_EMAIL_ALLOWLIST`
- **THEN** the API responds with HTTP 403
- **AND** the response explains that the target is an allowlist seed and must be removed from the env var first

---

### Requirement: Role Changes Are Audited

Every change to `users.role` SHALL write a row to the `member_role_changes` table capturing the previous role, new role, actor (admin user id or `'system'`), timestamp, and optional reason. The API SHALL NOT commit a role change if the audit row write fails.

#### Scenario: Admin promotes guest to member

- **WHEN** an authenticated Admin promotes a guest user to member via `PATCH /api/admin/members/:userId`
- **THEN** the system updates `users.role` to `'member'` in the same transaction as inserting a `member_role_changes` row
- **AND** the audit row captures `changed_by = <admin user id>`, `from_role = 'guest'`, `to_role = 'member'`

#### Scenario: Audit write failure rolls back role change

- **WHEN** the transaction fails to insert the `member_role_changes` row for any reason
- **THEN** the system rolls back the `users.role` update
- **AND** the API responds with HTTP 500 and leaves `users.role` unchanged

---

### Requirement: System Settings Store For Guest Policy

The `system_settings` table SHALL exist with `(key, value, updated_at, updated_by)` columns. The row with `key = 'guest_policy'` SHALL be seeded at migration time with `value = 'same_as_member'`. Only users with `role = 'admin'` SHALL be authorized to update this row.

#### Scenario: Migration seeds default guest policy

- **WHEN** the schema migration runs
- **THEN** `system_settings` contains a row with `key = 'guest_policy'`, `value = 'same_as_member'`, `updated_by = 'system'`

#### Scenario: Non-admin cannot update guest policy

- **WHEN** a non-admin authenticated user calls `PATCH /api/admin/settings/guest-policy`
- **THEN** the API responds with HTTP 403

#### Scenario: Admin updates guest policy and audit is recorded

- **WHEN** an authenticated Admin calls `PATCH /api/admin/settings/guest-policy` with `{ value: 'browse_only' }`
- **THEN** the system updates the row, writes `updated_by = <admin user id>`, and increments a KV version stamp so other Worker instances invalidate their cache
