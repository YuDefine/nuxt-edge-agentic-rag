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

### Requirement: Bidirectional Credential Binding Under Authenticated Session

The system SHALL allow any authenticated user to add a second credential type to their existing `user.id`: a Google-first user SHALL be able to register a passkey via the better-auth `passkey` plugin, and a passkey-first user SHALL be able to link a Google account via the custom endpoint pair `GET /api/auth/account/link-google-for-passkey-first` and `GET /api/auth/account/link-google-for-passkey-first/callback`. The system SHALL NOT auto-merge accounts across different `user.id` values. The system SHALL NOT route passkey-first Google linking through the better-auth `linkSocial` endpoint because better-auth's `parseGenericState` requires `link.email` to be a non-null string and rejects passkey-first users whose `user.email IS NULL`.

#### Scenario: Google-first user adds a passkey

- **WHEN** an authenticated user whose `user.email` is non-NULL and has no `passkey` row completes a WebAuthn registration ceremony at the account settings page
- **THEN** the system inserts a `passkey` row bound to the current `user.id`
- **AND** the user's subsequent logins SHALL succeed via either Google OAuth or passkey

#### Scenario: Passkey-first user binds Google via custom endpoint and email gets populated

- **WHEN** an authenticated user whose `user.email = NULL` clicks the "Link Google account" button at `/account/settings`
- **THEN** the client SHALL redirect to `GET /api/auth/account/link-google-for-passkey-first`
- **AND** that endpoint SHALL issue a one-time OAuth state token, persist it in KV under `oauth-link-state:<token>` with a TTL of 600 seconds and a payload containing the current `session.user.id`, set a `__Host-oauth-link-state` HttpOnly cookie with the same token, and redirect the user agent to the Google authorization URL
- **AND** after the user authorizes Google, the callback `GET /api/auth/account/link-google-for-passkey-first/callback` SHALL verify the cookie matches the `state` query parameter, verify the KV entry exists and its `userId` matches the current `session.user.id`, delete the KV entry, exchange the authorization code for an id_token against `https://oauth2.googleapis.com/token`, verify the id_token signature against Google JWKS plus `iss` / `aud` / `exp`, read `email`, `email_verified`, and `picture` from the verified payload, confirm no other `user` row holds the returned email, confirm no other `account` row already holds the same Google `sub`, and atomically UPDATE the current `user` row with `email` and `image` and INSERT a corresponding `account` row with `providerId='google'`, `accountId` equal to the id_token `sub`, and `accessToken` / `refreshToken` / `idToken` / `scope` stored as `NULL` via a Drizzle transaction that respects `timestamp_ms` column mapping
- **AND** on the next session refresh the `session.create.before` reconciliation SHALL evaluate `ADMIN_EMAIL_ALLOWLIST` against the newly populated email
- **AND** if the email is in the allowlist the user SHALL be promoted to `admin` and the transition SHALL be audited with `reason = 'allowlist-seed'`
- **AND** the callback SHALL redirect the user agent to `/account/settings?linked=google`

#### Scenario: Google link is blocked via custom endpoint when the Google identity already belongs to another user

- **WHEN** an authenticated passkey-first user completes Google authorization and either the id_token email already exists as `user.email` on a different `user.id` OR the Google `sub` already exists on a different `account.userId`
- **THEN** the callback SHALL delete the KV state entry, SHALL NOT write any row to `user` or `account`, and SHALL redirect the user agent to `/account/settings?linkError=EMAIL_ALREADY_LINKED`
- **AND** the settings page SHALL render an inline error feedback alert instructing the user to sign out and log in to the existing Google account before adding a passkey there

#### Scenario: Custom endpoint rejects unauthenticated or already-linked callers

- **WHEN** an unauthenticated caller requests `GET /api/auth/account/link-google-for-passkey-first`
- **THEN** the endpoint SHALL respond with HTTP 401 and SHALL NOT initiate any OAuth flow

- **WHEN** an authenticated caller whose `session.user.email` is non-NULL requests `GET /api/auth/account/link-google-for-passkey-first`
- **THEN** the endpoint SHALL respond with HTTP 400 with `statusMessage = 'INVALID_ENTRY_STATE'` and SHALL NOT initiate any OAuth flow

#### Scenario: Custom endpoint rejects state mismatch or replay

- **WHEN** the callback `GET /api/auth/account/link-google-for-passkey-first/callback` receives a request where the cookie `__Host-oauth-link-state` is absent or does not equal the `state` query parameter
- **THEN** the callback SHALL respond with HTTP 401 with `statusMessage = 'STATE_MISMATCH'` and SHALL NOT exchange any authorization code

- **WHEN** the callback receives a request whose `state` token has no corresponding KV entry (expired or already consumed)
- **THEN** the callback SHALL respond with HTTP 401 with `statusMessage = 'STATE_EXPIRED'` and SHALL NOT exchange any authorization code

- **WHEN** the callback receives a request whose KV entry `userId` does not match the current `session.user.id`
- **THEN** the callback SHALL respond with HTTP 401 with `statusMessage = 'SESSION_MISMATCH'` and SHALL NOT exchange any authorization code

#### Scenario: Custom endpoint rejects unverified Google email

- **WHEN** the callback successfully exchanges the authorization code and the id_token payload has `email_verified !== true`
- **THEN** the callback SHALL respond with HTTP 400 with `statusMessage = 'EMAIL_NOT_VERIFIED'` and SHALL NOT write any row to `user` or `account`

<!-- @trace
source: passkey-first-link-google-custom-endpoint
updated: 2026-04-23
code:
  - references/yuntech/專題報告編排規範1141216.pdf
  - .agents/skills/spectra-archive/SKILL.md
  - local/tooling/scripts/clone_section.py
  - scripts/spectra-ux/pre-propose-scan.sh
  - .codex/skills/.system/imagegen/SKILL.md
  - docs/verify/index.md
  - .codex/skills/.system/skill-creator/scripts/generate_openai_yaml.py
  - .codex/config.toml
  - server/utils/link-google-for-passkey-first.ts
  - docs/solutions/auth/better-auth-passkey-worker-catchall-override.md
  - AGENTS.md
  - docs/verify/KNOWLEDGE_SMOKE.md
  - docs/solutions/tooling/posttooluse-hook-non-json-stdin.md
  - docs/verify/RETENTION_REPLAY_CONTRACT.md
  - local/tooling/scripts/office/__init__.py
  - README.md
  - local/tooling/scripts/legacy/transform_v36.py
  - tooling/scripts/docx_rebuild_content.py
  - .codex/skills/.system/plugin-creator/references/plugin-json-spec.md
  - .codex/skills/.system/skill-creator/scripts/quick_validate.py
  - CLAUDE.md
  - tooling/__init__.py
  - local/reports/archive/main-v0.0.21.md
  - reports/archive/main-v0.0.37.docx
  - scripts/spectra-ux/design-gate.sh
  - local/reports/archive/main-v0.0.16.md
  - reports/archive/main-v0.0.26.md
  - .codex/skills/.system/skill-installer/scripts/github_utils.py
  - reports/archive/main-v0.0.12.md
  - .agents/skills/spectra-propose/SKILL.md
  - docs/verify/production-deploy-checklist.md
  - .codex/skills/.system/imagegen/references/prompting.md
  - server/api/auth/mcp/authorize.post.ts
  - .agents/skills/spectra-ask/SKILL.md
  - .codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py
  - .claude/rules/truth-layers.md
  - app/pages/account/settings.vue
  - local/海報樣板.pptx
  - .claude/skills/
  - .claude/rules/follow-up-register.md
  - reports/archive/main-v0.0.29.md
  - scripts/spectra-ux/claim-work.mts
  - docs/verify/DEBUG_SURFACE_VERIFICATION.md
  - .codex/skills/.system/imagegen/references/codex-network.md
  - .codex/skills/.system/openai-docs/references/upgrading-to-gpt-5p4.md
  - .codex/skills/.system/skill-creator/SKILL.md
  - local/reports/archive/main-v0.0.36.md
  - local/tooling/scripts/docx_sections.py
  - tooling/scripts/docx_sections.py
  - .codex/hooks/post-bash-error-debug.sh
  - app/pages/auth/callback.vue
  - local/reports/archive/main-v0.0.30.md
  - app/components/chat/Container.vue
  - local/reports/archive/main-v0.0.35.md
  - docs/verify/evidence/web-chat-persistence.json
  - local/reports/archive/main-v0.0.24.md
  - app/components/auth/DeleteAccountDialog.vue
  - scripts/spectra-ux/design-inject.sh
  - tooling/scripts/__init__.py
  - .codex/skills/.system/plugin-creator/agents/openai.yaml
  - local/reports/archive/main-v0.0.11.docx
  - reports/archive/main-v0.0.33.md
  - app/components/auth/McpConnectorLoginCard.vue
  - reports/archive/main-v0.0.14.md
  - scripts/spectra-ux/ui-qa-reminder.sh
  - .agents/skills/review-screenshot/SKILL.md
  - local/tooling/requirements.txt
  - .codex/skills/.system/imagegen/assets/imagegen-small.svg
  - .codex/skills/.system/openai-docs/references/gpt-5p4-prompting-guide.md
  - .codex/skills/.system/imagegen/references/image-api.md
  - .codex/skills/.system/openai-docs/assets/openai-small.svg
  - .codex/skills/.system/plugin-creator/SKILL.md
  - .codex/skills/.system/skill-creator/assets/skill-creator.png
  - local/reports/archive/main-v0.0.1.docx
  - local/tooling/scripts/office/unpack.py
  - docs/solutions/README.md
  - tooling/scripts/clone_section.py
  - .codex/skills/.system/skill-creator/assets/skill-creator-small.svg
  - app/pages/admin/tokens/index.vue
  - app/utils/chat-conversation-state.ts
  - reports/archive/main-v0.0.13.md
  - server/api/auth/account/link-google-for-passkey-first/callback.get.ts
  - .codex/skills/.system/imagegen/references/sample-prompts.md
  - .codex/skills/.system/skill-installer/LICENSE.txt
  - .agents/skills/spectra-apply/SKILL.md
  - app/components/admin/tokens/TokenCreateModal.vue
  - reports/archive/main-v0.0.23.md
  - reports/archive/main-v0.0.19.md
  - tooling/scripts/sync_docx_content.py
  - docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md
  - .codex/hooks/post-edit-ui-qa.sh
  - tooling/scripts/extract_docx_to_md.py
  - .agents/skills/commit/SKILL.md
  - .codex/agents/code-review.toml
  - local/reports/archive/main-v0.0.25.md
  - app/components/auth/McpConnectorConsentCard.vue
  - local/reports/archive/main-v0.0.18.md
  - .codex/skills/.system/imagegen/LICENSE.txt
  - .codex/skills/.system/skill-installer/assets/skill-installer-small.svg
  - app/pages/index.vue
  - reports/archive/main-v0.0.20.md
  - AGENTS.md
  - shared/utils/mcp-connector-client-registry.ts
  - app/components/chat/ConversationHistory.vue
  - app/composables/useChatConversationHistory.ts
  - docs/decisions/index.md
  - local/tooling/__init__.py
  - .codex/skills/.system/.codex-system-skills.marker
  - local/deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - local/reports/latest.md
  - app/layouts/default.vue
  - local/reports/archive/main-v0.0.13.md
  - reports/archive/main-v0.0.21.md
  - reports/archive/main-v0.0.34.md
  - deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - reports/archive/main-v0.0.10.md
  - .claude/rules/proactive-skills.md
  - server/utils/debug-surface-guard.ts
  - wrangler.staging.jsonc
  - server/api/auth/mcp/authorize.get.ts
  - local/reports/archive/main-v0.0.19.md
  - local/reports/archive/main-v0.0.27.md
  - local/reports/archive/main-v0.0.37.docx
  - .agents/skills/spectra-debug/SKILL.md
  - local/reports/archive/main-v0.0.34.md
  - tooling/scripts/legacy/transform_v36.py
  - local/reports/notes/diagram.md
  - .claude/rules/scope-discipline.md
  - local/reports/archive/main-v0.0.11.md
  - local/references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - .codex/skills/.system/plugin-creator/assets/plugin-creator-small.svg
  - .claude/rules/review-tiers.md
  - .codex/skills/.system/skill-installer/assets/skill-installer.png
  - local/reports/archive/main-v0.0.48.md
  - local/tooling/scripts/office/pack.py
  - tooling/scripts/clone_insert_docx.py
  - .codex/hooks/session-start-roadmap-sync.sh
  - scripts/spectra-ux/claims-lib.mts
  - scripts/spectra-ux/post-propose-check.sh
  - server/utils/better-auth-safe-logger.ts
  - reports/archive/main-v0.0.11_assets/image1.jpeg
  - .codex/skills/.system/plugin-creator/assets/plugin-creator.png
  - .agents/skills/spectra-discuss/SKILL.md
  - playwright.config.ts
  - .codex/hooks/pre-archive-followup-gate.sh
  - reports/latest.md
  - .agents/skills/spectra-commit/SKILL.md
  - local/tooling/scripts/docx_diff.py
  - local/reports/archive/main-v0.0.10.md
  - local/tooling/scripts/docx_rebuild_content.py
  - tooling/scripts/docx_apply.py
  - .codex/hooks/_codex_hook_wrapper.sh
  - .agents/skills/spectra-audit/SKILL.md
  - docs/verify/rollout-checklist.md
  - docs/verify/DISASTER_RECOVERY_RUNBOOK.md
  - reports/archive/main-v0.0.24.md
  - reports/archive/main-v0.0.36.docx
  - local/reports/archive/main-v0.0.33.md
  - local/reports/archive/main-v0.0.14.md
  - .codex/agents/screenshot-review.toml
  - .codex/hooks/stop-accumulate.sh
  - local/tooling/scripts/sync_docx_content.py
  - reports/archive/main-v0.0.18.md
  - local/references/yuntech/專題報告編排規範1141216.pdf
  - app/composables/useChatConversationSession.ts
  - app/pages/auth/mcp/authorize.vue
  - reports/archive/main-v0.0.32.md
  - reports/archive/main-v0.0.36.md
  - scripts/spectra-ux/roadmap-sync.mts
  - server/utils/passkey-verify-authentication.ts
  - templates/海報樣板.pptx
  - tooling/scripts/office/__init__.py
  - tooling/scripts/office/pack.py
  - .codex/skills/.system/imagegen/scripts/image_gen.py
  - .codex/skills/.system/skill-creator/references/openai_yaml.md
  - reports/archive/main-v0.0.15.md
  - .codex/skills/.system/openai-docs/references/latest-model.md
  - .codex/skills/.system/skill-installer/SKILL.md
  - scripts/audit-ux-drift.mts
  - tooling/scripts/docx_diff.py
  - .claude/rules/ux-completeness.md
  - local/reports/archive/main-v0.0.17.md
  - server/api/auth/passkey/verify-authentication.post.ts
  - local/tooling/scripts/docx_apply.py
  - .codex/skills/.system/skill-creator/scripts/init_skill.py
  - .codex/skills/.system/openai-docs/SKILL.md
  - scripts/spectra-ux/pre-apply-brief.sh
  - docs/solutions/auth/admin-allowlist-session-reconciliation.md
  - shared/utils/mcp-connector-redirect.ts
  - .agents/skills/spectra-ingest/SKILL.md
  - local/reports/archive/main-v0.0.29.md
  - docs/design-review-findings.md
  - .codex/skills/.system/openai-docs/LICENSE.txt
  - .codex/skills/.system/skill-creator/license.txt
  - tooling/requirements.txt
  - .codex/hooks.json
  - local/reports/archive/main-v0.0.37.md
  - local/reports/archive/main-v0.0.26.md
  - scripts/spectra-ux/release-work.mts
  - scripts/sync-docs-pages-domains.mjs
  - server/api/auth/account/link-google-for-passkey-first/index.get.ts
  - app/types/chat.ts
  - reports/archive/main-v0.0.11.md
  - .codex/skills/.system/imagegen/references/cli.md
  - .claude/rules/knowledge-and-decisions.md
  - docs/tech-debt.md
  - docs/verify/ACCEPTANCE_RUNBOOK.md
  - .codex/skills/.system/openai-docs/agents/openai.yaml
  - scripts/spectra-ux/claims-status.mts
  - references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - local/reports/archive/main-v0.0.11_assets/image1.jpeg
  - local/tooling/scripts/extract_docx_to_md.py
  - reports/archive/main-v0.0.25.md
  - pnpm-workspace.yaml
  - reports/archive/main-v0.0.28.md
  - local/reports/archive/main-v0.0.12.md
  - reports/archive/main-v0.0.48.md
  - docs/runbooks/remote-mcp-connectors.md
  - local/reports/archive/main-v0.0.31.md
  - shared/schemas/knowledge-runtime.ts
  - local/reports/archive/main-v0.0.36.docx
  - .codex/skills/.system/skill-creator/agents/openai.yaml
  - .claude/rules/handoff.md
  - .codex/agents/check-runner.toml
  - spectra-ux.config.json
  - local/deliverables/defense/答辯準備_口試Q&A.md
  - reports/archive/main-v0.0.30.md
  - reports/archive/main-v0.0.27.md
  - local/reports/archive/main-v0.0.50.md
  - .codex/skills/.system/skill-installer/agents/openai.yaml
  - server/utils/knowledge-runtime.ts
  - .codex/skills/.system/openai-docs/assets/openai.png
  - local/reports/archive/main-v0.0.23.md
  - .codex/skills/.system/skill-installer/scripts/install-skill-from-github.py
  - docs/verify/RETENTION_CLEANUP_RUNBOOK.md
  - .codex/skills/.system/skill-installer/scripts/list-skills.py
  - app/utils/mcp-connector-return-to.ts
  - reports/archive/main-v0.0.37.md
  - docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md
  - app/composables/useMcpConnectorAuthorization.ts
  - docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md
  - docs/decisions/2026-04-23-recognize-staging-as-active-environment.md
  - .codex/skills/.system/imagegen/agents/openai.yaml
  - reports/archive/main-v0.0.1.docx
  - tooling/scripts/office/unpack.py
  - local/reports/archive/main-v0.0.49.md
  - .claude/rules/screenshot-strategy.md
  - .claude/rules/work-claims.md
  - reports/archive/main-v0.0.11.docx
  - .github/workflows/deploy.yml
  - reports/archive/main-v0.0.49.md
  - local/reports/archive/main-v0.0.22.md
  - reports/archive/main-v0.0.50.md
  - local/tooling/scripts/clone_insert_docx.py
  - reports/archive/main-v0.0.35.md
  - .codex/hooks/pre-archive-design-gate.sh
  - reports/archive/main-v0.0.17.md
  - reports/archive/main-v0.0.31.md
  - .codex/hooks/post-propose-design-inject.sh
  - docs/solutions/auth/passkey-self-delete-hard-redirect.md
  - local/reports/archive/main-v0.0.15.md
  - reports/notes/diagram.md
  - server/auth.config.ts
  - app/utils/chat-conversation-loader.ts
  - server/utils/database.ts
  - .codex/hooks/post-edit-roadmap-sync.sh
  - package.json
  - shared/utils/link-google-for-passkey-first.ts
  - HANDOFF.md
  - .codex/skills/.system/imagegen/assets/imagegen.png
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - GEMINI.md
  - reports/archive/main-v0.0.22.md
  - deliverables/defense/答辯準備_口試Q&A.md
  - local/tooling/scripts/__init__.py
  - reports/archive/main-v0.0.16.md
  - local/reports/archive/main-v0.0.28.md
  - .claude/rules/manual-review.md
  - docs/verify/RETENTION_CLEANUP_VERIFICATION.md
  - local/reports/archive/main-v0.0.20.md
  - nuxt.config.ts
  - local/reports/archive/main-v0.0.32.md
tests:
  - test/unit/chat-conversation-history.test.ts
  - tooling/tests/test_extract_docx_to_md.py
  - test/unit/oauth-callback.spec.ts
  - test/integration/mcp-connector-authorize-route.test.ts
  - test/unit/better-auth-passkey-hotfix-version.test.ts
  - test/unit/link-google-for-passkey-first-initiator.test.ts
  - test/integration/mcp-connector-authorize-post-account-guard.test.ts
  - test/unit/knowledge-runtime-config.test.ts
  - test/unit/mcp-connector-client-registry.test.ts
  - test/unit/mcp-connector-redirect.test.ts
  - test/unit/better-auth-safe-logger.test.ts
  - test/integration/passkey-first-link-google.spec.ts
  - test/unit/passkey-verify-authentication.test.ts
  - test/unit/better-auth-worker-cookie-cache-hotfix.test.ts
  - e2e/mcp-connector-authorize.spec.ts
  - test/unit/database.test.ts
  - test/integration/mcp-oauth-tool-access.test.ts
  - local/tooling/tests/test_extract_docx_to_md.py
  - test/integration/passkey-verify-authentication-hotfix.spec.ts
  - local/tooling/tests/test_office_pack_unpack.py
  - test/unit/chat-conversation-session.test.ts
  - test/unit/chat-conversation-state.test.ts
  - test/unit/deploy-workflow-config.test.ts
  - e2e/chat-persistence.spec.ts
  - tooling/tests/test_office_pack_unpack.py
  - test/unit/deploy-workflow-passkey-env.test.ts
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
  - docs/runbooks/remote-mcp-connectors.md
  - app/components/auth/DeleteAccountDialog.vue
  - .codex/hooks/pre-archive-followup-gate.sh
  - HANDOFF.md
  - .claude/skills/
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
  - .claude/rules/follow-up-register.md
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
  - .claude/rules/proactive-skills.md
  - package.json
  - .agents/skills/spectra-commit/SKILL.md
  - .codex/hooks.json
  - AGENTS.md
  - app/composables/useMcpConnectorAuthorization.ts
  - .agents/skills/spectra-ingest/SKILL.md
  - pnpm-workspace.yaml
  - .claude/rules/scope-discipline.md
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

### Requirement: Account Self-Deletion UI Flow Survives Cross-Origin Reauth

The `/account/settings` self-deletion UI SHALL survive a cross-origin reauth redirect without losing flow state. When the user chooses Google reauth from the deletion dialog, the OAuth provider's post-auth redirect SHALL return the user to `/account/settings` (not to `/`), and the deletion dialog SHALL automatically reopen on the reauth-complete step so the user only needs to press the confirm button once they return.

The automatic reopen SHALL be gated on a short-lived client-side signal captured immediately before the OAuth hop, and the signal SHALL expire within the same five-minute reauth window the server enforces. The signal is a UX hint only; the server endpoint for account deletion SHALL NOT trust it as proof of reauth. A failed, missing, or expired signal SHALL leave the user on `/account/settings` with the dialog closed and no skipping of the reauth requirement.

The `?open-delete=1` query parameter used to signal resume SHALL be cleared from the URL as soon as it is read, so that reloads and shared links do not reopen the dialog.

The passkey reauth flow SHALL be unchanged: because it does not leave the origin, the dialog component stays mounted and the existing in-component `reauthComplete` state continues to drive the UI.

#### Scenario: Google reauth completes and dialog resumes on confirm step

- **WHEN** a signed-in user with a linked Google credential opens the deletion dialog on `/account/settings` and chooses Google reauth
- **AND** completes the Google OAuth flow successfully within five minutes
- **THEN** the browser lands on `/account/settings` (not `/`) after the OAuth hop
- **AND** the deletion dialog automatically reopens with its reauth step marked complete, so the confirm button is immediately enabled
- **AND** the URL no longer contains the `open-delete` query parameter

#### Scenario: Direct access to resume URL without a valid signal does not bypass reauth

- **WHEN** any user navigates directly to `/account/settings?open-delete=1` without a recent, valid pending-delete-reauth signal in session storage
- **THEN** the deletion dialog does not automatically open
- **AND** the `open-delete` query parameter is cleared from the URL
- **AND** if the user then manually opens the dialog, they are required to complete a fresh reauth before the confirm button is enabled

#### Scenario: Expired pending-delete-reauth signal is treated as invalid

- **WHEN** the pending-delete-reauth signal exists in session storage but its recorded timestamp is older than five minutes at the time `/account/settings` reads it
- **THEN** the signal is treated as absent
- **AND** the dialog does not automatically open
- **AND** the stale signal is cleared from session storage

#### Scenario: Server reauth enforcement is not weakened

- **WHEN** a request to delete the account is made without a real server-observable reauth in the last five minutes, regardless of any client-side UX state
- **THEN** the server refuses the deletion with HTTP 403 and no rows are deleted
- **AND** the refusal occurs even if the client sent the request immediately after the dialog displayed its confirm step

#### Scenario: Passkey reauth path is not affected

- **WHEN** a signed-in user chooses passkey reauth in the deletion dialog
- **THEN** the WebAuthn ceremony completes in the same origin without a cross-origin redirect
- **AND** the dialog remains mounted throughout, the in-component reauth-complete state flips on success, and no pending-delete-reauth signal is written to session storage
- **AND** the confirm button becomes enabled through the same in-component state machine that existed before this change

<!-- @trace
source: fix-delete-account-dialog-google-reauth
updated: 2026-04-24
code:
  - server/durable-objects/mcp-session.ts
  - app/utils/assert-never.ts
  - build/nitro/rollup.ts
  - server/utils/mcp-rehydrate-request-body.ts
  - scripts/mint-dev-mcp-token.mts
  - .env.example
  - server/utils/current-mcp-event.ts
  - server/utils/mcp-auth-context-codec.ts
  - test/evals/helpers/mcp-client.ts
  - docs/evals/mcp-tool-selection.md
  - server/durable-objects/mcp-event-shim.ts
  - server/utils/mcp-agents-compat.ts
  - server/utils/mcp-middleware.ts
  - HANDOFF.md
  - package.json
  - app/components/auth/DeleteAccountDialog.vue
  - nuxt.config.ts
  - app/pages/account/settings.vue
  - server/mcp/index.ts
tests:
  - test/integration/mcp-session-handshake.spec.ts
  - test/integration/mcp-session-tool-dispatch.spec.ts
  - test/unit/account-settings-heading-order.test.ts
  - test/unit/mcp-event-shim.test.ts
  - test/unit/mcp-auth-context-codec.test.ts
  - test/integration/mcp-auth-context-forwarding.spec.ts
  - test/integration/mcp-session-durable-object.spec.ts
  - test/unit/delete-account-dialog-initial-reauth.test.ts
  - test/unit/mcp-middleware.test.ts
-->
