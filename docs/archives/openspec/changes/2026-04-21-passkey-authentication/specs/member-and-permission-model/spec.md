## MODIFIED Requirements

### Requirement: Three-Tier Role Enum On Users

The `users` table SHALL include a `role` column constrained to the enum values `admin`, `member`, and `guest`. New rows inserted during Google OAuth callback or WebAuthn passkey-first registration SHALL default to `guest` unless the user email matches an entry in the runtime `ADMIN_EMAIL_ALLOWLIST`. A `user` row whose `email` is `NULL` SHALL NOT be eligible for the `admin` role under any circumstance, because `ADMIN_EMAIL_ALLOWLIST` is the sole admin authority source and cannot match a NULL email.

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

#### Scenario: Passkey-first user is created as guest with NULL email

- **WHEN** an anonymous visitor completes a WebAuthn passkey registration with a nickname but no email input
- **THEN** the system creates a `users` row with `email = NULL`, `display_name = <nickname>`, and `role = 'guest'`
- **AND** the system records a `member_role_changes` row with `from_role = 'guest'`, `to_role = 'guest'`, `changed_by = 'system'`, `reason = 'passkey-first-registration'`

#### Scenario: Reconciliation skips allowlist check for NULL email

- **WHEN** a user whose `user.email = NULL` refreshes their session
- **THEN** the `session.create.before` reconciliation SHALL NOT evaluate `ADMIN_EMAIL_ALLOWLIST` for this user
- **AND** the user's role SHALL NOT be changed by the reconciliation

---

### Requirement: Admin Role Is Only Seeded From Env Var

The system SHALL treat `ADMIN_EMAIL_ALLOWLIST` as the sole source of truth for the `admin` role. No UI, API endpoint, or non-`system` caller SHALL be able to set `users.role = 'admin'` for any user whose email is not currently present in the allowlist or whose email is `NULL`.

#### Scenario: UI request to promote non-allowlisted user to admin is rejected

- **WHEN** an authenticated Admin submits `PATCH /api/admin/members/:userId` with `{ role: 'admin' }` and the target user's email is not in `ADMIN_EMAIL_ALLOWLIST`
- **THEN** the API responds with HTTP 403
- **AND** the response body explains that admin role is controlled by env var allowlist

#### Scenario: UI request to promote a NULL-email user to admin is rejected

- **WHEN** an authenticated Admin submits `PATCH /api/admin/members/:userId` with `{ role: 'admin' }` and the target user's `email` column is `NULL`
- **THEN** the API responds with HTTP 403
- **AND** the response body explains that admin role requires an email in the allowlist, and a NULL email cannot match

#### Scenario: Admin cannot self-demote via UI

- **WHEN** an authenticated Admin submits `PATCH /api/admin/members/:userId` where `userId` equals their own id and `role != 'admin'`
- **THEN** the API responds with HTTP 403
- **AND** the response body instructs the caller to remove their email from `ADMIN_EMAIL_ALLOWLIST` instead

#### Scenario: Admin cannot demote another allowlisted admin

- **WHEN** an authenticated Admin submits `PATCH /api/admin/members/:userId` with `role != 'admin'` and the target user's email is currently in `ADMIN_EMAIL_ALLOWLIST`
- **THEN** the API responds with HTTP 403
- **AND** the response explains that the target is an allowlist seed and must be removed from the env var first

---

## ADDED Requirements

### Requirement: Member Promotion Accepts Users Without Email

The system SHALL allow an authenticated Admin to promote any user — including users whose `user.email` is `NULL` — from `guest` to `member` via `PATCH /api/admin/members/:userId`. The authorization decision SHALL be keyed exclusively on `userId`; `display_name` is shown in the Admin UI for identification only and SHALL NOT be part of the authorization input.

#### Scenario: Admin promotes passkey-only guest to member

- **WHEN** an authenticated Admin submits `PATCH /api/admin/members/:userId` with `{ role: 'member' }` for a target user whose `email IS NULL` and `role = 'guest'`
- **THEN** the API responds with HTTP 200
- **AND** the target user's `role` is updated to `'member'`
- **AND** a `member_role_changes` row is written with `from_role = 'guest'`, `to_role = 'member'`, `changed_by = <admin user id>`

#### Scenario: Display name is not an authorization input

- **WHEN** an authenticated Admin submits `PATCH /api/admin/members/:userId` with `{ role: 'member', display_name: 'someone-else' }`
- **THEN** the API SHALL ignore `display_name` in the body and SHALL NOT attempt to modify `user.display_name`
- **AND** the response SHALL be HTTP 200 if the role change itself is valid, OR HTTP 403 per existing admin-role rules
