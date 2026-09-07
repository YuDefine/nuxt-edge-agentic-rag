# admin-member-management-ui Specification

## Purpose

TBD - created by archiving change 'member-and-permission-management'. Update Purpose after archive.

## Requirements

### Requirement: Admin Member List Page

The system SHALL provide an admin-only page at `/admin/members` that lists all users with their `display_name`, email (or a visually distinct "—" placeholder when `email IS NULL`), bound credential types (one or more of `google`, `passkey`), current role, registration timestamp, last activity timestamp, and an action column for promoting or demoting their role. The page SHALL handle loading, empty, unauthorized, and error states explicitly. Non-admin users SHALL NOT see or access this page.

#### Scenario: Admin views member list with mixed credential types

- **WHEN** an authenticated Admin navigates to `/admin/members`
- **THEN** the page renders a paginated list of users showing `display_name`, email (or "—"), credential badges (e.g., "Google", "Passkey", or both), role badge, registration timestamp, and last activity timestamp
- **AND** each row shows an action button appropriate for the user's current role

#### Scenario: Passkey-only user row shows credential badge and no email

- **WHEN** the Admin views a row for a user whose `email IS NULL` and whose only credential is a passkey
- **THEN** the email cell SHALL render a "—" placeholder with accessible label "沒有 email"
- **AND** the credential column SHALL render a single "Passkey" badge

#### Scenario: Non-admin is blocked from member list

- **WHEN** an authenticated user with `role = 'member'` or `role = 'guest'` visits `/admin/members`
- **THEN** the page responds with an unauthorized state and does not leak member data

#### Scenario: Member list handles empty database

- **WHEN** the `users` table has zero non-admin rows
- **THEN** the page shows an empty state with guidance rather than a blank table

<!-- @trace
source: passkey-authentication
updated: 2026-04-21
code:
  - app/layouts/default.vue
  - server/api/admin/documents/[id]/unarchive.post.ts
  - docs/tech-debt.md
  - server/api/admin/mcp-tokens/index.get.ts
  - server/api/documents/sync.post.ts
  - shared/types/admin-members.ts
  - app/components/auth/PasskeyRegisterDialog.vue
  - server/api/admin/mcp-tokens/index.post.ts
  - app/pages/index.vue
  - server/api/auth/account/delete.post.ts
  - app/pages/account/settings.vue
  - shared/types/nickname.ts
  - server/api/auth/nickname/check.get.ts
  - server/api/_dev/login.post.ts
  - server/api/documents/[documentId]/versions/[versionId]/publish.post.ts
  - .env.example
  - app/pages/admin/members/index.vue
  - server/api/admin/settings/guest-policy.patch.ts
  - server/api/uploads/presign.post.ts
  - server/api/uploads/finalize.post.ts
  - main-v0.0.48.md
  - app/utils/passkey-error.ts
  - server/auth.config.ts
  - server/api/admin/dashboard/summary.get.ts
  - package.json
  - server/api/admin/documents/[id]/archive.post.ts
  - server/api/admin/documents/[id].get.ts
  - nuxt.config.ts
  - server/api/admin/documents/[id]/versions/[versionId]/retry-sync.post.ts
  - server/api/guest-policy/effective.get.ts
  - server/api/admin/debug/query-logs/[id].get.ts
  - app/auth.config.ts
  - app/components/admin/members/ConfirmRoleChangeDialog.vue
  - app/components/auth/NicknameInput.vue
  - CLAUDE.md
  - app/components/auth/DeleteAccountDialog.vue
  - app/layouts/chat.vue
  - server/api/admin/members/[userId].patch.ts
  - server/api/admin/members/index.get.ts
  - server/api/auth/me/credentials.get.ts
  - server/api/documents/[documentId]/versions/[versionId]/index-status.get.ts
  - server/database/migrations/0009_passkey_and_display_name.sql
  - server/api/admin/mcp-tokens/[id].delete.ts
  - server/api/admin/query-logs/[id].get.ts
  - shared/schemas/nickname.ts
  - server/api/admin/debug/latency/summary.get.ts
  - server/api/admin/documents/[id].delete.ts
  - HANDOFF.md
  - server/utils/display-name-guard.ts
  - server/api/admin/settings/guest-policy.get.ts
  - server/plugins/error-sanitizer.ts
  - server/db/schema.ts
  - server/api/admin/query-logs/index.get.ts
  - server/api/admin/documents/index.get.ts
  - server/api/admin/documents/check-slug.get.ts
  - server/api/setup/create-admin.post.ts
tests:
  - e2e/passkey-login-ui.spec.ts
  - test/integration/nickname-check.spec.ts
  - test/integration/admin-members-passkey-columns.spec.ts
  - e2e/passkey-signin-flow.spec.ts
  - test/integration/passkey-first-registration.spec.ts
  - test/integration/three-tier-role-enum.spec.ts
  - e2e/account-self-delete.spec.ts
  - test/unit/passkey-session-reconciliation.test.ts
  - test/unit/admin-members-row-render.test.ts
  - e2e/passkey-auth-review.spec.ts
  - test/integration/account-self-delete.spec.ts
  - test/integration/passkey-authentication-flow.spec.ts
  - test/integration/credential-binding.spec.ts
  - test/integration/admin-members-list.spec.ts
  - test/integration/admin-member-promotion.spec.ts
  - test/unit/nickname-input.test.ts
  - e2e/account-settings.spec.ts
-->

---

### Requirement: Role Promotion And Demotion Actions With Confirmation

The member list SHALL provide explicit promote and demote actions that route to `PATCH /api/admin/members/:userId` after a confirmation dialog. The confirmation SHALL display the target `display_name`, the target email if non-NULL (or "—" otherwise), the current role, the requested role, and a warning if the action is irreversible without Admin intervention.

#### Scenario: Admin promotes guest to member via UI

- **WHEN** an Admin clicks the promote button on a guest row and confirms in the dialog
- **THEN** the API is called with `{ role: 'member' }`
- **AND** the UI refetches the list and shows the updated role badge

#### Scenario: Confirmation shows display_name for passkey-only user

- **WHEN** an Admin opens the confirmation dialog for a user whose `email IS NULL`
- **THEN** the dialog header SHALL present `display_name` as the primary identifier
- **AND** the dialog SHALL render the email field as "—" without making it look like a missing value

#### Scenario: Admin dismisses confirmation

- **WHEN** an Admin opens the confirmation dialog and cancels
- **THEN** no API call is made and the list remains unchanged

#### Scenario: Admin promote attempt for non-allowlisted or NULL-email user to admin fails with clear message

- **WHEN** the Admin attempts to set `role = 'admin'` on a user not in `ADMIN_EMAIL_ALLOWLIST` or whose `email IS NULL`
- **THEN** the UI surfaces the HTTP 403 response body explaining that admin promotion requires an email in the allowlist

<!-- @trace
source: passkey-authentication
updated: 2026-04-21
code:
  - app/layouts/default.vue
  - server/api/admin/documents/[id]/unarchive.post.ts
  - docs/tech-debt.md
  - server/api/admin/mcp-tokens/index.get.ts
  - server/api/documents/sync.post.ts
  - shared/types/admin-members.ts
  - app/components/auth/PasskeyRegisterDialog.vue
  - server/api/admin/mcp-tokens/index.post.ts
  - app/pages/index.vue
  - server/api/auth/account/delete.post.ts
  - app/pages/account/settings.vue
  - shared/types/nickname.ts
  - server/api/auth/nickname/check.get.ts
  - server/api/_dev/login.post.ts
  - server/api/documents/[documentId]/versions/[versionId]/publish.post.ts
  - .env.example
  - app/pages/admin/members/index.vue
  - server/api/admin/settings/guest-policy.patch.ts
  - server/api/uploads/presign.post.ts
  - server/api/uploads/finalize.post.ts
  - main-v0.0.48.md
  - app/utils/passkey-error.ts
  - server/auth.config.ts
  - server/api/admin/dashboard/summary.get.ts
  - package.json
  - server/api/admin/documents/[id]/archive.post.ts
  - server/api/admin/documents/[id].get.ts
  - nuxt.config.ts
  - server/api/admin/documents/[id]/versions/[versionId]/retry-sync.post.ts
  - server/api/guest-policy/effective.get.ts
  - server/api/admin/debug/query-logs/[id].get.ts
  - app/auth.config.ts
  - app/components/admin/members/ConfirmRoleChangeDialog.vue
  - app/components/auth/NicknameInput.vue
  - CLAUDE.md
  - app/components/auth/DeleteAccountDialog.vue
  - app/layouts/chat.vue
  - server/api/admin/members/[userId].patch.ts
  - server/api/admin/members/index.get.ts
  - server/api/auth/me/credentials.get.ts
  - server/api/documents/[documentId]/versions/[versionId]/index-status.get.ts
  - server/database/migrations/0009_passkey_and_display_name.sql
  - server/api/admin/mcp-tokens/[id].delete.ts
  - server/api/admin/query-logs/[id].get.ts
  - shared/schemas/nickname.ts
  - server/api/admin/debug/latency/summary.get.ts
  - server/api/admin/documents/[id].delete.ts
  - HANDOFF.md
  - server/utils/display-name-guard.ts
  - server/api/admin/settings/guest-policy.get.ts
  - server/plugins/error-sanitizer.ts
  - server/db/schema.ts
  - server/api/admin/query-logs/index.get.ts
  - server/api/admin/documents/index.get.ts
  - server/api/admin/documents/check-slug.get.ts
  - server/api/setup/create-admin.post.ts
tests:
  - e2e/passkey-login-ui.spec.ts
  - test/integration/nickname-check.spec.ts
  - test/integration/admin-members-passkey-columns.spec.ts
  - e2e/passkey-signin-flow.spec.ts
  - test/integration/passkey-first-registration.spec.ts
  - test/integration/three-tier-role-enum.spec.ts
  - e2e/account-self-delete.spec.ts
  - test/unit/passkey-session-reconciliation.test.ts
  - test/unit/admin-members-row-render.test.ts
  - e2e/passkey-auth-review.spec.ts
  - test/integration/account-self-delete.spec.ts
  - test/integration/passkey-authentication-flow.spec.ts
  - test/integration/credential-binding.spec.ts
  - test/integration/admin-members-list.spec.ts
  - test/integration/admin-member-promotion.spec.ts
  - test/unit/nickname-input.test.ts
  - e2e/account-settings.spec.ts
-->

---

### Requirement: Guest Policy Settings Page With Single Dial

The system SHALL provide an admin-only page at `/admin/settings/guest-policy` that displays the current value of `guest_policy` and offers a single radio-group selector with the three enum values. Saving the selection SHALL call `PATCH /api/admin/settings/guest-policy` and show immediate feedback on success or failure.

#### Scenario: Admin views and updates guest policy

- **WHEN** an authenticated Admin visits `/admin/settings/guest-policy`
- **THEN** the page shows the three options and marks the current value as selected
- **AND** choosing a different value and confirming updates the setting and shows a success toast

#### Scenario: Each option shows effect description

- **WHEN** the Admin hovers or focuses any of the three options
- **THEN** the UI displays a short description of the effect on guest users

#### Scenario: Save failure preserves previous selection

- **WHEN** the API call to update the policy fails with any non-2xx response
- **THEN** the UI reverts the radio selection to the previous value and shows an error toast with the server-provided message

---

### Requirement: Admin Navigation Exposes Member And Policy Entries

The admin navigation shell SHALL expose entries for `/admin/members` and `/admin/settings/guest-policy` alongside existing admin entries. These entries SHALL only appear for users with `role = 'admin'`.

#### Scenario: Admin sees member and policy nav items

- **WHEN** a user with `role = 'admin'` loads any admin page
- **THEN** the navigation shell shows entries labeled for the members page and the guest-policy settings page

#### Scenario: Non-admin does not see admin nav entries

- **WHEN** a user with `role = 'member'` or `'guest'` loads any page
- **THEN** the navigation shell does not render the admin entries
