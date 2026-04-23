# member-and-permission-model Specification

## Purpose

TBD - created by archiving change 'member-and-permission-management'. Update Purpose after archive.

## Requirements

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
  - template/HANDOFF.md
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
  - template/HANDOFF.md
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

---

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
  - template/HANDOFF.md
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

### Requirement: Audit Trail Survives User Deletion

The `member_role_changes` table SHALL retain every row across the lifetime of the deployment even when the referenced `user` row has been deleted. The `user_id` column SHALL be treated as a plain text reference to a better-auth `user.id` that is potentially orphaned, and the database SHALL NOT enforce a FOREIGN KEY relationship from `member_role_changes.user_id` to `user(id)`. Tombstone rows written during account deletion (`reason = 'self-deletion'`) SHALL remain queryable for compliance and audit purposes after the user row is gone.

#### Scenario: Tombstone row remains after user deletion

- **WHEN** a user with id `U` triggers account self-deletion and the handler commits `DELETE FROM "user" WHERE id = U`
- **THEN** at least one `member_role_changes` row with `user_id = U` and `reason = 'self-deletion'` SHALL still exist in the table
- **AND** `SELECT reason FROM member_role_changes WHERE user_id = U ORDER BY created_at DESC LIMIT 1` SHALL return `'self-deletion'`

#### Scenario: Orphan tombstone rows do not block admin role history queries

- **WHEN** an admin queries `SELECT * FROM member_role_changes WHERE user_id = <deleted user id>` to investigate a past member's role history
- **THEN** the query SHALL return all historical rows for that user id
- **AND** the query SHALL NOT fail because the `user` row no longer exists

#### Scenario: recordRoleChange writes tombstone without FK restriction

- **WHEN** the application code invokes `recordRoleChange({ userId: U, reason: 'self-deletion', ... })` immediately before deleting the `user` row with id `U`
- **THEN** the insert SHALL succeed
- **AND** the subsequent `DELETE FROM "user" WHERE id = U` SHALL NOT raise a `SQLITE_CONSTRAINT_FOREIGNKEY` error caused by the just-inserted `member_role_changes` row

<!-- @trace
source: fk-cascade-repair-for-self-delete
updated: 2026-04-23
code:
  - .codex/hooks/post-bash-error-debug.sh
  - docs/solutions/auth/better-auth-passkey-worker-catchall-override.md
  - docs/verify/DISASTER_RECOVERY_RUNBOOK.md
  - server/utils/passkey-verify-authentication.ts
  - .codex/hooks/_codex_hook_wrapper.sh
  - nuxt.config.ts
  - .codex/agents/screenshot-review.toml
  - app/pages/auth/mcp/authorize.vue
  - docs/verify/production-deploy-checklist.md
  - .agents/skills/spectra-propose/SKILL.md
  - server/api/auth/passkey/verify-authentication.post.ts
  - app/components/auth/McpConnectorLoginCard.vue
  - .agents/skills/commit/SKILL.md
  - .codex/config.toml
  - .codex/agents/check-runner.toml
  - docs/design-review-findings.md
  - server/auth.config.ts
  - app/utils/mcp-connector-return-to.ts
  - docs/solutions/README.md
  - playwright.config.ts
  - shared/utils/mcp-connector-client-registry.ts
  - AGENTS.md
  - .codex/hooks/post-edit-roadmap-sync.sh
  - .codex/hooks/session-start-roadmap-sync.sh
  - .agents/skills/spectra-audit/SKILL.md
  - shared/schemas/knowledge-runtime.ts
  - docs/runbooks/claude-desktop-mcp.md
  - app/components/auth/DeleteAccountDialog.vue
  - .codex/hooks/pre-archive-followup-gate.sh
  - template/HANDOFF.md
  - .github/instructions/skills.instructions.md
  - server/utils/better-auth-safe-logger.ts
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - server/api/auth/mcp/authorize.get.ts
  - .codex/agents/code-review.toml
  - .agents/skills/spectra-debug/SKILL.md
  - .agents/skills/spectra-discuss/SKILL.md
  - app/pages/account/settings.vue
  - .agents/skills/spectra-ask/SKILL.md
  - shared/utils/mcp-connector-redirect.ts
  - .agents/skills/spectra-apply/SKILL.md
  - deliverables/defense/答辯準備_口試Q&A.md
  - .github/instructions/follow_up_register.instructions.md
  - app/pages/admin/tokens/index.vue
  - server/api/auth/mcp/authorize.post.ts
  - app/components/admin/tokens/TokenCreateModal.vue
  - .agents/skills/spectra-archive/SKILL.md
  - reports/latest.md
  - app/pages/auth/callback.vue
  - docs/solutions/auth/passkey-self-delete-hard-redirect.md
  - app/components/auth/McpConnectorConsentCard.vue
  - docs/solutions/tooling/posttooluse-hook-non-json-stdin.md
  - docs/tech-debt.md
  - CLAUDE.md
  - .github/instructions/proactive_skills.instructions.md
  - package.json
  - .agents/skills/spectra-commit/SKILL.md
  - .codex/hooks.json
  - .github/copilot-instructions.md
  - app/composables/useMcpConnectorAuthorization.ts
  - .agents/skills/spectra-ingest/SKILL.md
  - pnpm-workspace.yaml
  - .github/instructions/scope_discipline.instructions.md
  - .github/workflows/deploy.yml
tests:
  - test/unit/better-auth-passkey-hotfix-version.test.ts
  - test/unit/knowledge-runtime-config.test.ts
  - test/unit/better-auth-worker-cookie-cache-hotfix.test.ts
  - test/integration/mcp-oauth-tool-access.test.ts
  - test/integration/mcp-connector-authorize-route.test.ts
  - test/integration/mcp-connector-authorize-post-account-guard.test.ts
  - test/integration/passkey-verify-authentication-hotfix.spec.ts
  - e2e/mcp-connector-authorize.spec.ts
  - test/unit/better-auth-safe-logger.test.ts
  - test/unit/mcp-connector-client-registry.test.ts
  - test/unit/passkey-verify-authentication.test.ts
  - test/unit/deploy-workflow-passkey-env.test.ts
  - test/unit/mcp-connector-redirect.test.ts
-->
