# passkey-authentication Specification

## Purpose

TBD - created by archiving change 'passkey-authentication'. Update Purpose after archive.

## Requirements

### Requirement: Passkey Plugin Is Gated By Feature Flag

The system SHALL register the better-auth `passkey` plugin on the server if and only if `runtimeConfig.knowledge.features.passkey` is `true`. When the flag is `false`, the server SHALL NOT expose any `/api/auth/passkey/*` endpoint, and the client UI SHALL NOT render passkey-related buttons.

#### Scenario: Server does not register passkey plugin when flag is false

- **WHEN** the server boots with `NUXT_KNOWLEDGE_FEATURE_PASSKEY=false`
- **THEN** `GET /api/auth/passkey/generate-registration-options` SHALL respond with HTTP 404
- **AND** the page at `/` SHALL NOT render any element with `data-testid="passkey-register-button"` or `data-testid="passkey-login-button"`

#### Scenario: Server registers passkey plugin when flag is true

- **WHEN** the server boots with `NUXT_KNOWLEDGE_FEATURE_PASSKEY=true` AND `NUXT_PASSKEY_RP_ID` AND `NUXT_PASSKEY_RP_NAME` are set
- **THEN** `POST /api/auth/passkey/generate-registration-options` SHALL respond with HTTP 200 for authenticated callers and HTTP 200 with a challenge body for unauthenticated passkey-first registration
- **AND** the page at `/` SHALL render the passkey login button when the user is signed out

#### Scenario: Missing RP config fails fast at boot when flag is true

- **WHEN** the server boots with `NUXT_KNOWLEDGE_FEATURE_PASSKEY=true` but `NUXT_PASSKEY_RP_ID` is unset
- **THEN** the server SHALL log a critical startup error identifying the missing env var
- **AND** the server SHALL NOT register the passkey plugin, and `/api/auth/passkey/*` SHALL respond with HTTP 404

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

### Requirement: Passkey-First Registration Creates Guest User Without Email

The system SHALL allow a user with no prior account to register solely via a WebAuthn ceremony preceded by a nickname input. The resulting `user` row SHALL have `email = NULL`, `display_name = <nickname>`, `role = 'guest'`, and one row in the `passkey` table owned by that user id.

#### Scenario: Anonymous user registers via passkey with nickname only

- **WHEN** an anonymous visitor enters a valid unique nickname and completes a WebAuthn registration ceremony at `/`
- **THEN** the system creates a `user` row with `email = NULL`, `display_name` equal to the entered nickname, and `role = 'guest'`
- **AND** the system inserts one `passkey` row referencing that `user.id`
- **AND** the system records a `member_role_changes` row with `from_role = 'guest'`, `to_role = 'guest'`, `changed_by = 'system'`, and `reason = 'passkey-first-registration'`
- **AND** the resulting session contains `user.id` and the UI shows the signed-in state

#### Scenario: Registration with missing nickname is rejected

- **WHEN** an anonymous visitor attempts to initiate the WebAuthn registration ceremony without providing a nickname
- **THEN** the server SHALL respond with HTTP 400 before starting the ceremony
- **AND** the error body SHALL identify `display_name` as the missing field

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

### Requirement: Passkey Authentication Logs Existing User In

The system SHALL allow a user with at least one registered passkey to authenticate by selecting the passkey option at `/` and completing a WebAuthn authentication ceremony. The resulting session SHALL reference the `user.id` bound to the selected credential.

#### Scenario: Returning passkey-only user logs in successfully

- **WHEN** a user whose `user` row has `email = NULL` completes a WebAuthn authentication ceremony on a device holding their registered passkey
- **THEN** the system creates a session for that `user.id`
- **AND** the response SHALL NOT disclose any credential ids the user does not possess

#### Scenario: Authentication with a revoked credential fails

- **WHEN** a user attempts to authenticate with a passkey whose row has been deleted from the `passkey` table
- **THEN** the server SHALL respond with HTTP 401 and the session SHALL NOT be created

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

### Requirement: Bidirectional Credential Binding Under Authenticated Session

The system SHALL allow any authenticated user to add a second credential type to their existing `user.id`: a Google-first user SHALL be able to register a passkey, and a passkey-first user SHALL be able to link a Google account. The system SHALL NOT auto-merge accounts across different `user.id` values.

#### Scenario: Google-first user adds a passkey

- **WHEN** an authenticated user whose `user.email` is non-NULL and has no `passkey` row completes a WebAuthn registration ceremony at the account settings page
- **THEN** the system inserts a `passkey` row bound to the current `user.id`
- **AND** the user's subsequent logins SHALL succeed via either Google OAuth or passkey

#### Scenario: Passkey-first user binds Google and email gets populated

- **WHEN** an authenticated user whose `user.email = NULL` completes a Google OAuth link flow at the account settings page AND the returned Google email is not already present in any other `user` row
- **THEN** the system updates the current `user` row with `email = <google email>`
- **AND** on the next session refresh the `session.create.before` reconciliation SHALL evaluate `ADMIN_EMAIL_ALLOWLIST` against the newly populated email
- **AND** if the email is in the allowlist the user SHALL be promoted to `admin` and the transition SHALL be audited with `reason = 'allowlist-seed'`

#### Scenario: Google link is blocked when the Google email belongs to another user

- **WHEN** an authenticated passkey-first user attempts to link a Google account whose email already exists as `user.email` on a different `user.id`
- **THEN** the server SHALL respond with HTTP 409 and the email SHALL NOT be written to the current `user` row
- **AND** the error body SHALL instruct the caller to sign out and log in to the existing Google account, then add a passkey there

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

### Requirement: Passkey-Only Account Self-Deletion Requires Reauth

The system SHALL provide an authenticated endpoint that deletes the current user's account, and SHALL require a successful WebAuthn authentication ceremony (or Google reauth if the account has a linked Google credential) completed within the last 5 minutes before committing the deletion. Deletion SHALL cascade from `user` across `account`, `session`, `passkey`, and `mcp_tokens`, and SHALL leave one final audit row in `member_role_changes` with `reason = 'self-deletion'` that survives the user row's deletion. The application layer SHALL delete `user_profiles` explicitly before deleting `user`.

The database SHALL NOT restrict deletion of the `user` row because of existing `member_role_changes` rows: the `member_role_changes.user_id` column SHALL be a plain text reference with no FOREIGN KEY constraint, so audit tombstones preserve the historical user id after the `user` row is gone. The `mcp_tokens.created_by_user_id` column SHALL carry `ON DELETE CASCADE`, so tokens are removed atomically with their creator. The `query_logs.mcp_token_id` column SHALL carry `ON DELETE SET NULL`, so observability rows survive the cascade with their token attribution set to `NULL` rather than blocking the cascade with a RESTRICT.

#### Scenario: Passkey-only user deletes their account after reauth

- **WHEN** an authenticated user whose only credential is a passkey clicks "Delete account" and completes a WebAuthn authentication ceremony within the last 5 minutes
- **THEN** the system inserts a `member_role_changes` row with `from_role = <previous role>`, `to_role = <previous role>`, `changed_by = 'system'`, `reason = 'self-deletion'`
- **AND** the system deletes rows from `user_profiles`, `user`, and cascades to `account`, `session`, `passkey`, and `mcp_tokens`
- **AND** the response indicates successful deletion and the client is redirected to `/` with no active session

#### Scenario: Deletion without reauth is refused

- **WHEN** a client calls the delete-account endpoint with a session older than 5 minutes
- **THEN** the server SHALL respond with HTTP 403 and no rows SHALL be deleted
- **AND** the `member_role_changes` tombstone row SHALL NOT be inserted

#### Scenario: Audit tombstone survives user deletion

- **WHEN** a passkey-only user successfully self-deletes via the delete-account endpoint
- **THEN** the `member_role_changes` row with `reason = 'self-deletion'` and `user_id = <deleted user id>` SHALL still exist in the table after the `user` row is gone
- **AND** a `SELECT count(*) FROM member_role_changes WHERE user_id = <deleted user id>` SHALL return at least one row
- **AND** the database SHALL NOT raise any FOREIGN KEY constraint error during the `DELETE FROM "user"` statement

#### Scenario: MCP tokens cascade on user deletion

- **WHEN** a user with one or more `mcp_tokens` rows (where `created_by_user_id = <user id>`) successfully self-deletes
- **THEN** after the deletion all `mcp_tokens` rows whose `created_by_user_id` matched SHALL be removed
- **AND** `PRAGMA foreign_key_check(mcp_tokens)` SHALL return zero rows

#### Scenario: query_logs survive with NULL mcp_token_id after user deletion

- **WHEN** a user with one or more `mcp_tokens` rows (where `created_by_user_id = <user id>`) AND one or more `query_logs` rows referencing those tokens successfully self-deletes
- **THEN** after the deletion every `query_logs` row whose `mcp_token_id` pointed at one of the deleted tokens SHALL still exist with its `query_redacted_text`, `created_at`, `channel`, `environment`, and `status` unchanged
- **AND** those `query_logs` rows SHALL have `mcp_token_id = NULL`
- **AND** the `DELETE FROM "user"` statement SHALL NOT raise a FOREIGN KEY constraint error

#### Scenario: Admin-initiated delete against passkey-only member is not DB-blocked

- **WHEN** an admin action or future `DELETE /api/admin/members/[userId]` handler invokes the same delete-user code path for a passkey-only member who has audit tombstones
- **THEN** the `DELETE FROM "user"` statement SHALL succeed without FOREIGN KEY restriction
- **AND** the audit tombstones SHALL remain intact for compliance review

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

---

### Requirement: RP Configuration Sources From Runtime Env

The WebAuthn Relying Party parameters SHALL derive from runtime environment variables `NUXT_PASSKEY_RP_ID` (rpID) and `NUXT_PASSKEY_RP_NAME` (human-readable name). The `origin` passed to better-auth SHALL be computed per-request from the incoming `Host` header, not hard-coded.

#### Scenario: rpID is read from env at boot

- **WHEN** the server boots with `NUXT_PASSKEY_RP_ID=example.com`
- **THEN** registration options returned by `/api/auth/passkey/generate-registration-options` SHALL contain `rp.id = 'example.com'`

#### Scenario: Per-request origin matches Host header

- **WHEN** a request arrives with `Host: app.example.com`
- **THEN** the origin passed to the WebAuthn verification SHALL be `https://app.example.com` in production OR `http://localhost:<port>` when the host is `localhost`

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
