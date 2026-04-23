# document-ingestion-and-publishing Specification

## Purpose

TBD - created by archiving change 'bootstrap-v1-core-from-report'. Update Purpose after archive.

## Requirements

### Requirement: Staged Upload Finalization

The system SHALL use a staged upload flow where an Admin first requests a one-time R2 signed URL and `uploadId`, uploads the file directly to R2, and finalizes the upload before any document or version record is created. Finalization SHALL validate checksum, size, and MIME type and SHALL reject invalid uploads.

#### Scenario: Version creation waits for finalize

- **WHEN** an Admin uploads a file to R2 but has not completed upload finalization
- **THEN** the system does not create a `documents` or `document_versions` record
- **AND** the file cannot enter sync or publish workflows

#### Scenario: Finalize rejects invalid file metadata

- **WHEN** the finalize request reports a checksum, size, or MIME type that does not match the uploaded object
- **THEN** the finalize step fails
- **AND** the system does not create a publishable version snapshot

---

### Requirement: Versioned Replay Truth

Each `document_versions` record SHALL act as an immutable knowledge snapshot containing `normalized_text_r2_key`, `metadata_json`, `smoke_test_queries_json`, and prebuilt `source_chunks` before the version becomes publishable. `source_chunks` SHALL be derived from the normalized text snapshot rather than provider-owned chunk identifiers, and a version SHALL NOT enter `smoke_pending` or `indexed` without those replay assets.

#### Scenario: Replay assets are required before indexing

- **WHEN** a version has no `normalized_text_r2_key`, `smoke_test_queries_json`, or prebuilt `source_chunks`
- **THEN** the version does not advance to `smoke_pending` or `indexed`
- **AND** the version is not eligible for publish

#### Scenario: Published snapshots stay immutable

- **WHEN** a version has been published and later metadata or category values change on the parent document
- **THEN** the previously published version keeps its stored `metadata_json` and replay assets
- **AND** a new version or re-synced snapshot is required to change publish-time truth

---

### Requirement: Current Version Publishing

The system SHALL publish only versions whose parent document is `active`, whose index status is `indexed`, and that have no in-progress sync task. Publishing SHALL switch `is_current` atomically so only one version per document remains current, and re-publishing the already current version SHALL return a no-op success response.

#### Scenario: Publish switches current version atomically

- **WHEN** an indexed replacement version is published for an active document
- **THEN** the newly published version becomes the only row with `is_current = true`
- **AND** the previously current version is demoted in the same transaction

#### Scenario: Re-publishing the current version is a no-op

- **WHEN** the publish endpoint is called for a version that is already current
- **THEN** the endpoint returns a success response without changing version state
- **AND** downstream clients observe stable retry semantics

---

### Requirement: Canonical Snapshot Extraction By Source Format

The system SHALL classify uploaded source files into direct-text, supported-rich, and deferred source tiers before replay assets are built. `text/plain` and `text/markdown` SHALL continue the direct-text path. `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, and `application/vnd.openxmlformats-officedocument.presentationml.presentation` SHALL be converted into a deterministic line-oriented canonical text snapshot before `normalized_text_r2_key`, `smoke_test_queries_json`, and `source_chunks` are created. Deferred classes, including legacy binary Office formats and audio/video media, SHALL be rejected with actionable guidance.

#### Scenario: Supported rich format creates replay assets from a canonical snapshot

- **WHEN** an Admin syncs a finalized `.pdf`, `.docx`, `.xlsx`, or `.pptx` source file whose extractor can produce meaningful text
- **THEN** the system derives `normalized_text_r2_key`, `smoke_test_queries_json`, and `source_chunks` from the extracted canonical snapshot
- **AND** the resulting replay assets remain compatible with the existing line-based citation contract

#### Scenario: Unsupported legacy Office format is rejected before version creation

- **WHEN** an Admin attempts to sync a finalized `.doc`, `.xls`, or `.ppt` source file
- **THEN** the server rejects the sync request with an actionable 4xx response
- **AND** the system does not create a new `documents` or `document_versions` row for that request

#### Scenario: Textless rich source is rejected as non-replayable

- **WHEN** a finalized supported-rich source file yields no meaningful extractable text
- **THEN** the server rejects the sync request as non-replayable
- **AND** the system does not create replay assets or a new `document_versions` row

#### Scenario: Direct text formats keep the existing direct path

- **WHEN** an Admin syncs a finalized `.txt` or `.md` source file
- **THEN** the system continues the direct-text normalization path
- **AND** the resulting replay assets follow the same `normalized_text_r2_key` and `source_chunks` contract as before

<!-- @trace
source: multi-format-document-ingestion
updated: 2026-04-23
code:
  - local/reports/archive/main-v0.0.33.md
  - local/reports/archive/main-v0.0.22.md
  - local/reports/archive/main-v0.0.36.docx
  - reports/archive/main-v0.0.16.md
  - .github/instructions/commit.instructions.md
  - tooling/scripts/__init__.py
  - .codex/hooks/_codex_hook_wrapper.sh
  - local/reports/archive/main-v0.0.15.md
  - reports/archive/main-v0.0.22.md
  - reports/archive/main-v0.0.21.md
  - .tmp/document-source-fixtures/legacy.ppt
  - app/pages/auth/callback.vue
  - local/reports/archive/main-v0.0.36.md
  - .husky/commit-msg
  - local/reports/archive/main-v0.0.16.md
  - reports/archive/main-v0.0.18.md
  - docs/verify/production-deploy-checklist.md
  - .codex/hooks/stop-accumulate.sh
  - .agents/skills/review-screenshot/SKILL.md
  - .github/instructions/logging.instructions.md
  - docs/solutions/tooling/posttooluse-hook-non-json-stdin.md
  - local/tooling/scripts/sync_docx_content.py
  - .agents/skills/spectra-discuss/SKILL.md
  - references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - scripts/spectra-ux/pre-apply-brief.sh
  - docs/verify/rollout-checklist.md
  - reports/notes/diagram.md
  - local/reports/archive/main-v0.0.11_assets/image1.jpeg
  - tooling/requirements.txt
  - local/reports/archive/main-v0.0.31.md
  - docs/design-review-findings.md
  - local/reports/archive/main-v0.0.14.md
  - docs/verify/RETENTION_REPLAY_CONTRACT.md
  - app/composables/useChatConversationHistory.ts
  - app/pages/index.vue
  - local/tooling/__init__.py
  - reports/archive/main-v0.0.33.md
  - local/reports/archive/main-v0.0.50.md
  - tooling/scripts/legacy/transform_v36.py
  - server/utils/cloudflare-bindings.ts
  - app/utils/chat-conversation-loader.ts
  - local/reports/archive/main-v0.0.13.md
  - local/reports/archive/main-v0.0.37.docx
  - docs/README.md
  - reports/archive/main-v0.0.24.md
  - reports/archive/main-v0.0.14.md
  - reports/archive/main-v0.0.34.md
  - .agents/skills/commit/SKILL.md
  - reports/archive/main-v0.0.37.docx
  - .codex/agents/screenshot-review.toml
  - package.json
  - server/api/auth/passkey/verify-authentication.post.ts
  - scripts/spectra-ux/roadmap-sync.mts
  - server/utils/r2-object-access.ts
  - .github/instructions/handoff.instructions.md
  - local/references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - server/utils/knowledge-runtime.ts
  - app/layouts/default.vue
  - local/reports/archive/main-v0.0.29.md
  - .agents/skills/critique/reference/personas.md
  - .github/instructions/skills.instructions.md
  - server/auth.config.ts
  - references/yuntech/專題報告編排規範1141216.pdf
  - reports/archive/main-v0.0.12.md
  - .github/instructions/mcp_remote.instructions.md
  - reports/archive/main-v0.0.11.docx
  - scripts/spectra-ux/claims-lib.mts
  - .tmp/document-source-fixtures/sample.xlsx
  - .tmp/document-source-fixtures/legacy.doc
  - .agents/skills/spectra-commit/SKILL.md
  - local/reports/archive/main-v0.0.21.md
  - tooling/scripts/docx_apply.py
  - local/reports/notes/main-v0.0.51-word-compare.md
  - .agents/skills/spectra-audit/SKILL.md
  - scripts/spectra-ux/claims-status.mts
  - reports/archive/main-v0.0.10.md
  - scripts/spectra-ux/lib/common.sh
  - .codex/hooks/post-propose-design-inject.sh
  - server/api/_dev/uploads/local.put.ts
  - scripts/spectra-ux/pre-propose-scan.sh
  - scripts/sync-docs-pages-domains.mjs
  - .github/instructions/knowledge_and_decisions.instructions.md
  - local/reports/archive/main-v0.0.11.docx
  - vite.config.ts
  - local/tooling/scripts/__init__.py
  - server/utils/debug-surface-guard.ts
  - local/tooling/scripts/docx_diff.py
  - .github/instructions/testing_anti_patterns.instructions.md
  - server/utils/passkey-verify-authentication.ts
  - .github/instructions/error_handling.instructions.md
  - local/reports/archive/main-v0.0.10.md
  - shared/utils/mcp-connector-redirect.ts
  - local/tooling/scripts/office/unpack.py
  - server/utils/document-source-extractor.ts
  - docs/solutions/README.md
  - reports/archive/main-v0.0.11.md
  - reports/archive/main-v0.0.31.md
  - .tmp/document-source-fixtures/sample.docx
  - scripts/spectra-ux/claim-work.mts
  - shared/utils/document-source-format.ts
  - shared/utils/mcp-connector-client-registry.ts
  - .tmp/upload-wizard-checks/xl.png
  - docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md
  - .codex/hooks/session-start-roadmap-sync.sh
  - tooling/scripts/office/pack.py
  - .github/copilot-instructions.md
  - docs/runbooks/remote-mcp-connectors.md
  - scripts/audit-ux-drift.mts
  - tooling/__init__.py
  - local/reports/archive/main-v0.0.18.md
  - local/tooling/scripts/docx_rebuild_content.py
  - local/reports/archive/main-v0.0.32.md
  - reports/archive/main-v0.0.11_assets/image1.jpeg
  - reports/archive/main-v0.0.36.md
  - scripts/spectra-ux/design-inject.sh
  - .github/instructions/screenshot_strategy.instructions.md
  - local/reports/latest.md
  - local/tooling/scripts/docx_sections.py
  - docs/solutions/auth/admin-allowlist-session-reconciliation.md
  - .tmp/document-source-fixtures/legacy.xls
  - docs/decisions/2026-04-23-canonical-root-handoff-artifact.md
  - local/reports/archive/latest.docx
  - playwright.config.ts
  - docs/decisions/2026-04-23-recognize-staging-as-active-environment.md
  - scripts/spectra-ux/post-propose-check.sh
  - local/reports/archive/main-v0.0.24.md
  - .agents/skills/impeccable/SKILL.md
  - reports/archive/main-v0.0.32.md
  - scripts/spectra-ux/release-work.mts
  - server/api/documents/sync.post.ts
  - app/components/auth/McpConnectorConsentCard.vue
  - .agents/skills/spectra-ingest/SKILL.md
  - reports/archive/main-v0.0.20.md
  - server/api/auth/mcp/authorize.get.ts
  - .tmp/upload-wizard-checks/xs.png
  - wrangler.staging.jsonc
  - docs/STRUCTURE.md
  - docs/onboarding.md
  - reports/archive/main-v0.0.25.md
  - tooling/scripts/office/unpack.py
  - docs/verify/RETENTION_CLEANUP_VERIFICATION.md
  - .codex/hooks/post-edit-roadmap-sync.sh
  - app/utils/chat-conversation-state.ts
  - docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md
  - .codex/hooks/pre-archive-followup-gate.sh
  - app/components/chat/ConversationHistory.vue
  - reports/archive/main-v0.0.23.md
  - tooling/scripts/extract_docx_to_md.py
  - .github/instructions/manual_review.instructions.md
  - docs/verify/DEBUG_SURFACE_VERIFICATION.md
  - server/utils/document-sync.ts
  - server/api/uploads/presign.post.ts
  - app/composables/useChatConversationSession.ts
  - .codex/agents/check-runner.toml
  - templates/海報樣板.pptx
  - local/reports/archive/main-v0.0.30.md
  - local/reports/archive/main-v0.0.19.md
  - app/composables/useMcpConnectorAuthorization.ts
  - tooling/scripts/clone_insert_docx.py
  - local/海報樣板.pptx
  - HANDOFF.md
  - deliverables/defense/答辯準備_口試Q&A.md
  - local/reports/archive/main-v0.0.23.md
  - tooling/scripts/clone_section.py
  - nuxt.config.ts
  - reports/archive/main-v0.0.15.md
  - reports/archive/main-v0.0.19.md
  - local/reports/archive/main-v0.0.34.md
  - server/utils/staged-upload.ts
  - .github/instructions/api_patterns.instructions.md
  - .tmp/document-source-fixtures/sample.pptx
  - local/reports/archive/main-v0.0.17.md
  - .github/instructions/review_tiers.instructions.md
  - app/components/chat/Container.vue
  - reports/archive/main-v0.0.1.docx
  - reports/archive/main-v0.0.37.md
  - server/utils/link-google-for-passkey-first.ts
  - local/reports/archive/main-v0.0.27.md
  - .github/workflows/deploy.yml
  - CLAUDE.md
  - local/reports/archive/main-v0.0.1.docx
  - docs/verify/DISASTER_RECOVERY_RUNBOOK.md
  - reports/archive/main-v0.0.30.md
  - .github/instructions/proactive_skills.instructions.md
  - tooling/scripts/docx_diff.py
  - .agents/skills/spectra-propose/SKILL.md
  - docs/rules/index.md
  - local/reports/archive/main-v0.0.51.md
  - .agents/skills/spectra-archive/SKILL.md
  - .tmp/upload-wizard-checks/md.png
  - README.md
  - app/pages/account/settings.vue
  - server/api/auth/account/link-google-for-passkey-first/index.get.ts
  - .tmp/document-source-fixtures/sample.pdf
  - .agents/skills/spectra-debug/SKILL.md
  - docs/verify/RETENTION_CLEANUP_RUNBOOK.md
  - deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - local/reports/notes/main-v0.0.51-word-copy.md
  - local/reports/archive/main-v0.0.35.md
  - app/components/documents/UploadWizard.vue
  - local/deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - app/components/auth/DeleteAccountDialog.vue
  - spectra-ux.config.json
  - shared/utils/link-google-for-passkey-first.ts
  - tooling/scripts/docx_sections.py
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - tooling/scripts/sync_docx_content.py
  - local/tooling/requirements.txt
  - reports/latest.md
  - docs/solutions/auth/better-auth-passkey-worker-catchall-override.md
  - reports/archive/main-v0.0.17.md
  - tooling/scripts/office/__init__.py
  - .github/instructions/development.instructions.md
  - .agents/skills/design-retro/SKILL.md
  - local/reports/archive/main-v0.0.28.md
  - local/tooling/scripts/clone_section.py
  - AGENTS.md
  - local/reports/notes/diagram.md
  - local/reports/archive/main-v0.0.25.md
  - local/tooling/scripts/clone_insert_docx.py
  - reports/archive/main-v0.0.50.md
  - reports/archive/main-v0.0.28.md
  - reports/archive/main-v0.0.48.md
  - .codex/agents/code-review.toml
  - docs/index.md
  - local/deliverables/defense/答辯準備_口試Q&A.md
  - app/components/auth/McpConnectorLoginCard.vue
  - docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md
  - docs/verify/KNOWLEDGE_SMOKE.md
  - local/reports/archive/main-v0.0.48.md
  - app/pages/admin/tokens/index.vue
  - tooling/scripts/docx_rebuild_content.py
  - .codex/hooks/pre-archive-design-gate.sh
  - .agents/skills/critique/SKILL.md
  - app/pages/auth/mcp/authorize.vue
  - docs/verify/ACCEPTANCE_RUNBOOK.md
  - server/api/auth/account/link-google-for-passkey-first/callback.get.ts
  - .github/instructions/unused_features.instructions.md
  - local/references/yuntech/專題報告編排規範1141216.pdf
  - reports/archive/main-v0.0.27.md
  - .codex/hooks.json
  - scripts/spectra-ux/design-gate.sh
  - reports/archive/main-v0.0.26.md
  - app/components/admin/tokens/TokenCreateModal.vue
  - local/tooling/scripts/docx_word_compare_md.py
  - server/utils/database.ts
  - local/tooling/scripts/legacy/transform_v36.py
  - local/reports/archive/main-v0.0.37.md
  - server/api/auth/mcp/authorize.post.ts
  - local/reports/archive/main-v0.0.11.md
  - server/utils/document-preprocessing.ts
  - local/reports/archive/main-v0.0.20.md
  - local/tooling/scripts/extract_docx_to_md.py
  - .tmp/document-source-fixtures/scanned.pdf
  - reports/archive/main-v0.0.29.md
  - server/utils/better-auth-safe-logger.ts
  - .codex/config.toml
  - docs/solutions/auth/passkey-self-delete-hard-redirect.md
  - docs/verify/evidence/web-chat-persistence.json
  - local/reports/archive/main-v0.0.26.md
  - local/reports/archive/main-v0.0.12.md
  - template/HANDOFF.md
  - .agents/skills/spectra-ask/SKILL.md
  - reports/archive/main-v0.0.36.docx
  - local/tooling/scripts/office/pack.py
  - docs/tech-debt.md
  - docs/verify/index.md
  - .agents/skills/spectra-apply/SKILL.md
  - .github/instructions/ux_completeness.instructions.md
  - reports/archive/main-v0.0.49.md
  - docs/decisions/index.md
  - local/reports/archive/main-v0.0.49.md
  - local/tooling/scripts/docx_apply.py
  - pnpm-workspace.yaml
  - test/helpers/document-source-fixtures.ts
  - app/types/chat.ts
  - shared/schemas/knowledge-runtime.ts
  - docs/decisions/2026-04-23-claude-source-of-truth-across-offline-repos.md
  - scripts/spectra-ux/ui-qa-reminder.sh
  - reports/archive/main-v0.0.35.md
  - reports/archive/main-v0.0.13.md
  - app/utils/mcp-connector-return-to.ts
  - .codex/hooks/post-edit-ui-qa.sh
  - local/tooling/scripts/office/__init__.py
tests:
  - test/unit/mcp-connector-client-registry.test.ts
  - test/unit/r2-object-access.test.ts
  - test/integration/document-sync-route.test.ts
  - test/unit/document-source-format-registry.test.ts
  - test/unit/document-preprocessing.test.ts
  - test/unit/oauth-callback.spec.ts
  - test/unit/document-source-extractor.test.ts
  - test/unit/link-google-for-passkey-first-initiator.test.ts
  - test/unit/mcp-connector-redirect.test.ts
  - test/unit/chat-conversation-session.test.ts
  - test/unit/chat-conversation-state.test.ts
  - test/unit/document-sync.test.ts
  - test/integration/passkey-first-link-google.spec.ts
  - tooling/tests/test_extract_docx_to_md.py
  - test/unit/better-auth-worker-cookie-cache-hotfix.test.ts
  - test/unit/passkey-verify-authentication.test.ts
  - test/unit/better-auth-passkey-hotfix-version.test.ts
  - test/unit/database.test.ts
  - tooling/tests/test_office_pack_unpack.py
  - test/unit/better-auth-safe-logger.test.ts
  - test/unit/deploy-workflow-config.test.ts
  - test/integration/local-upload-route.test.ts
  - e2e/chat-persistence.spec.ts
  - local/tooling/tests/test_office_pack_unpack.py
  - test/integration/mcp-oauth-tool-access.test.ts
  - test/unit/knowledge-runtime-config.test.ts
  - test/integration/mcp-connector-authorize-route.test.ts
  - test/unit/chat-conversation-history.test.ts
  - e2e/mcp-connector-authorize.spec.ts
  - test/integration/passkey-verify-authentication-hotfix.spec.ts
  - test/unit/staged-upload.test.ts
  - test/unit/deploy-workflow-passkey-env.test.ts
  - test/integration/mcp-connector-authorize-post-account-guard.test.ts
  - local/tooling/tests/test_extract_docx_to_md.py
-->
