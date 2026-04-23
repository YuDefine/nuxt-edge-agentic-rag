# acceptance-evidence-automation Specification

## Purpose

TBD - created by archiving change 'test-coverage-and-automation'. Update Purpose after archive.

## Requirements

### Requirement: Frozen Acceptance Matrix Automation

The system SHALL encode the report-defined `TC-01` through `TC-20`, `A01` through `A13`, and `EV-01` through `EV-04` as versioned, executable verification assets. Each executable case SHALL declare its channel, expected HTTP outcome, expected decision path, required citation or refusal evidence, and the acceptance or evidence IDs it proves.

#### Scenario: Every acceptance target maps to executable coverage

- **WHEN** the verification registry is generated for `v1.0.0`
- **THEN** each acceptance ID from `A01` to `A13` maps to one or more automated cases or evidence exporters
- **AND** each mapped case declares the report section and success condition it proves

#### Scenario: Frozen-final cases preserve stable expectations

- **WHEN** a case is promoted into the `frozen-final` dataset
- **THEN** its expected outcome, required evidence, and failure conditions are stored in versioned fixtures
- **AND** later runs compare against the stored expectation instead of ad hoc manual judgment

<!-- @trace
source: test-coverage-and-automation
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->

---

### Requirement: Multi-Layer Regression Coverage

The system SHALL verify the report contract through layered automation: unit coverage for pure policies, integration coverage for server orchestration, end-to-end coverage for critical Web flows, and contract coverage for MCP responses. Tests SHALL reuse realistic data builders and SHALL NOT replace the behavior under test with mock-only assertions.

#### Scenario: MCP no-hit contract stays stable

- **WHEN** `searchKnowledge` is exercised against a query that has no visible evidence
- **THEN** contract automation verifies `200` with `results: []`
- **AND** the assertion fails if the response changes to `404` or exposes internal diagnostics

#### Scenario: Current-version-only regression is caught

- **WHEN** a test publishes `v2` for a document and re-asks a query whose answer existed only in `v1`
- **THEN** integration automation verifies that the answer either cites only `v2` evidence or refuses
- **AND** the assertion fails if any `v1` citation remains in the final response

<!-- @trace
source: test-coverage-and-automation
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->

---

### Requirement: Evidence Artifact Generation

Automated verification SHALL emit stable evidence artifacts for report backfill. Each emitted record SHALL include `config_snapshot_version`, execution status, channel, and references to the stored evidence payloads such as response snapshots, cleanup logs, or replay checks.

#### Scenario: Acceptance summary includes config snapshot version

- **WHEN** the acceptance summary command runs against `v1.0.0`
- **THEN** each result row records the `testCaseId`, `acceptanceId`, `http_status`, `decision_path`, and `config_snapshot_version`
- **AND** failed rows include pointers to the captured evidence payloads

#### Scenario: Retention evidence exports backdated cleanup results

- **WHEN** the evidence suite executes the retention validation path
- **THEN** it emits backdated record metadata, cleanup run output, and replay-before-expiry versus replay-after-expiry results
- **AND** those artifacts can be linked directly to `EV-04`

<!-- @trace
source: test-coverage-and-automation
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->

---

### Requirement: Persisted Web Chat Flow Coverage

Automated verification SHALL cover the shipped Web conversation persistence flow end to end. The evidence set SHALL prove that a conversation can be created, reloaded, selected from history, continued with the same `conversationId`, and deleted without restoring purged content.

#### Scenario: Automation proves persisted conversation continuity

- **WHEN** the persisted Web chat acceptance suite runs
- **THEN** it verifies that an initial question creates a persisted conversation
- **AND** it verifies that a subsequent question in the same thread reuses that `conversationId`
- **AND** it fails if the flow falls back to client-only message memory

#### Scenario: Automation proves history reload and selection

- **WHEN** the persisted Web chat acceptance suite reloads the chat page and reopens a saved conversation
- **THEN** it verifies that the history list and message pane are reconstructed from server state
- **AND** it fails if the restored conversation omits persisted messages or citations

#### Scenario: Automation proves delete eviction

- **WHEN** the persisted Web chat acceptance suite deletes a conversation
- **THEN** it verifies that the conversation disappears from visible history and detail reads
- **AND** it fails if deleted content can still be reopened through normal user-facing flows

<!-- @trace
source: complete-web-chat-persistence
updated: 2026-04-23
code:
  - reports/archive/main-v0.0.27.md
  - .agents/skills/spectra-discuss/SKILL.md
  - reports/archive/main-v0.0.36.md
  - reports/archive/main-v0.0.13.md
  - .agents/skills/spectra-debug/SKILL.md
  - tooling/__init__.py
  - references/yuntech/專題報告編排規範1141216.pdf
  - tooling/scripts/__init__.py
  - reports/archive/main-v0.0.35.md
  - reports/archive/main-v0.0.37.docx
  - scripts/spectra-ux/design-gate.sh
  - tooling/scripts/legacy/transform_v36.py
  - reports/archive/main-v0.0.11.docx
  - tooling/scripts/docx_diff.py
  - reports/archive/main-v0.0.37.md
  - package.json
  - reports/archive/main-v0.0.21.md
  - reports/archive/main-v0.0.12.md
  - scripts/spectra-ux/roadmap-sync.mts
  - README.md
  - tooling/scripts/clone_section.py
  - tooling/scripts/docx_rebuild_content.py
  - docs/verify/index.md
  - .agents/skills/spectra-propose/SKILL.md
  - reports/archive/main-v0.0.20.md
  - spectra-ux.config.json
  - app/components/chat/Container.vue
  - tooling/scripts/docx_sections.py
  - reports/archive/main-v0.0.29.md
  - reports/archive/main-v0.0.32.md
  - reports/notes/diagram.md
  - tooling/scripts/office/__init__.py
  - references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - app/composables/useChatConversationHistory.ts
  - reports/archive/main-v0.0.22.md
  - app/utils/chat-conversation-state.ts
  - reports/archive/main-v0.0.18.md
  - .agents/skills/spectra-audit/SKILL.md
  - docs/verify/evidence/web-chat-persistence.json
  - .agents/skills/spectra-archive/SKILL.md
  - app/composables/useChatConversationSession.ts
  - .agents/skills/spectra-apply/SKILL.md
  - server/api/auth/account/link-google-for-passkey-first/callback.get.ts
  - .agents/skills/spectra-ingest/SKILL.md
  - deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - tooling/scripts/office/pack.py
  - reports/archive/main-v0.0.34.md
  - app/types/chat.ts
  - reports/archive/main-v0.0.25.md
  - tooling/requirements.txt
  - app/pages/account/settings.vue
  - server/utils/link-google-for-passkey-first.ts
  - scripts/spectra-ux/ui-qa-reminder.sh
  - app/components/chat/ConversationHistory.vue
  - app/pages/index.vue
  - docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md
  - app/utils/assert-never.ts
  - reports/archive/main-v0.0.23.md
  - server/api/auth/account/link-google-for-passkey-first/index.get.ts
  - reports/archive/main-v0.0.1.docx
  - reports/archive/main-v0.0.33.md
  - reports/archive/main-v0.0.49.md
  - reports/archive/main-v0.0.11.md
  - reports/archive/main-v0.0.50.md
  - template/HANDOFF.md
  - templates/海報樣板.pptx
  - .agents/skills/spectra-ask/SKILL.md
  - tooling/scripts/docx_apply.py
  - reports/archive/main-v0.0.48.md
  - tooling/scripts/office/unpack.py
  - playwright.config.ts
  - reports/archive/main-v0.0.30.md
  - reports/archive/main-v0.0.26.md
  - scripts/spectra-ux/collect-followups.mts
  - nuxt.config.ts
  - scripts/spectra-ux/design-inject.sh
  - tooling/scripts/sync_docx_content.py
  - reports/archive/main-v0.0.10.md
  - reports/archive/main-v0.0.11_assets/image1.jpeg
  - reports/archive/main-v0.0.31.md
  - deliverables/defense/答辯準備_口試Q&A.md
  - tooling/scripts/clone_insert_docx.py
  - GEMINI.md
  - reports/archive/main-v0.0.36.docx
  - .agents/skills/spectra-commit/SKILL.md
  - AGENTS.md
  - reports/archive/main-v0.0.19.md
  - reports/archive/main-v0.0.24.md
  - reports/archive/main-v0.0.28.md
  - reports/latest.md
  - reports/archive/main-v0.0.16.md
  - scripts/audit-ux-drift.mts
  - shared/utils/link-google-for-passkey-first.ts
  - reports/archive/main-v0.0.14.md
  - reports/archive/main-v0.0.15.md
  - reports/archive/main-v0.0.17.md
  - tooling/scripts/extract_docx_to_md.py
tests:
  - test/unit/chat-conversation-session.test.ts
  - e2e/chat-persistence.spec.ts
  - test/unit/oauth-callback.spec.ts
  - tooling/tests/test_extract_docx_to_md.py
  - test/unit/chat-conversation-state.test.ts
  - tooling/tests/test_office_pack_unpack.py
  - test/integration/passkey-first-link-google.spec.ts
  - test/unit/better-auth-passkey-hotfix-version.test.ts
  - test/unit/chat-conversation-history.test.ts
  - test/unit/link-google-for-passkey-first-initiator.test.ts
-->

---

### Requirement: Report-Ready Persistence Evidence Export

Evidence generated for the report SHALL include stable references to the persisted Web chat flow so the current report can claim the feature as shipped and verified. The exported evidence SHALL identify the create, reload, select, and delete checkpoints it proves.

#### Scenario: Persistence evidence export names the proven checkpoints

- **WHEN** report evidence is generated for the Web chat persistence flow
- **THEN** the export identifies the create, reload, select, follow-up, and delete checkpoints it covers
- **AND** each checkpoint links to the corresponding automated run result or captured evidence payload

<!-- @trace
source: complete-web-chat-persistence
updated: 2026-04-23
code:
  - reports/archive/main-v0.0.27.md
  - .agents/skills/spectra-discuss/SKILL.md
  - reports/archive/main-v0.0.36.md
  - reports/archive/main-v0.0.13.md
  - .agents/skills/spectra-debug/SKILL.md
  - tooling/__init__.py
  - references/yuntech/專題報告編排規範1141216.pdf
  - tooling/scripts/__init__.py
  - reports/archive/main-v0.0.35.md
  - reports/archive/main-v0.0.37.docx
  - scripts/spectra-ux/design-gate.sh
  - tooling/scripts/legacy/transform_v36.py
  - reports/archive/main-v0.0.11.docx
  - tooling/scripts/docx_diff.py
  - reports/archive/main-v0.0.37.md
  - package.json
  - reports/archive/main-v0.0.21.md
  - reports/archive/main-v0.0.12.md
  - scripts/spectra-ux/roadmap-sync.mts
  - README.md
  - tooling/scripts/clone_section.py
  - tooling/scripts/docx_rebuild_content.py
  - docs/verify/index.md
  - .agents/skills/spectra-propose/SKILL.md
  - reports/archive/main-v0.0.20.md
  - spectra-ux.config.json
  - app/components/chat/Container.vue
  - tooling/scripts/docx_sections.py
  - reports/archive/main-v0.0.29.md
  - reports/archive/main-v0.0.32.md
  - reports/notes/diagram.md
  - tooling/scripts/office/__init__.py
  - references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - app/composables/useChatConversationHistory.ts
  - reports/archive/main-v0.0.22.md
  - app/utils/chat-conversation-state.ts
  - reports/archive/main-v0.0.18.md
  - .agents/skills/spectra-audit/SKILL.md
  - docs/verify/evidence/web-chat-persistence.json
  - .agents/skills/spectra-archive/SKILL.md
  - app/composables/useChatConversationSession.ts
  - .agents/skills/spectra-apply/SKILL.md
  - server/api/auth/account/link-google-for-passkey-first/callback.get.ts
  - .agents/skills/spectra-ingest/SKILL.md
  - deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - tooling/scripts/office/pack.py
  - reports/archive/main-v0.0.34.md
  - app/types/chat.ts
  - reports/archive/main-v0.0.25.md
  - tooling/requirements.txt
  - app/pages/account/settings.vue
  - server/utils/link-google-for-passkey-first.ts
  - scripts/spectra-ux/ui-qa-reminder.sh
  - app/components/chat/ConversationHistory.vue
  - app/pages/index.vue
  - docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md
  - app/utils/assert-never.ts
  - reports/archive/main-v0.0.23.md
  - server/api/auth/account/link-google-for-passkey-first/index.get.ts
  - reports/archive/main-v0.0.1.docx
  - reports/archive/main-v0.0.33.md
  - reports/archive/main-v0.0.49.md
  - reports/archive/main-v0.0.11.md
  - reports/archive/main-v0.0.50.md
  - template/HANDOFF.md
  - templates/海報樣板.pptx
  - .agents/skills/spectra-ask/SKILL.md
  - tooling/scripts/docx_apply.py
  - reports/archive/main-v0.0.48.md
  - tooling/scripts/office/unpack.py
  - playwright.config.ts
  - reports/archive/main-v0.0.30.md
  - reports/archive/main-v0.0.26.md
  - scripts/spectra-ux/collect-followups.mts
  - nuxt.config.ts
  - scripts/spectra-ux/design-inject.sh
  - tooling/scripts/sync_docx_content.py
  - reports/archive/main-v0.0.10.md
  - reports/archive/main-v0.0.11_assets/image1.jpeg
  - reports/archive/main-v0.0.31.md
  - deliverables/defense/答辯準備_口試Q&A.md
  - tooling/scripts/clone_insert_docx.py
  - GEMINI.md
  - reports/archive/main-v0.0.36.docx
  - .agents/skills/spectra-commit/SKILL.md
  - AGENTS.md
  - reports/archive/main-v0.0.19.md
  - reports/archive/main-v0.0.24.md
  - reports/archive/main-v0.0.28.md
  - reports/latest.md
  - reports/archive/main-v0.0.16.md
  - scripts/audit-ux-drift.mts
  - shared/utils/link-google-for-passkey-first.ts
  - reports/archive/main-v0.0.14.md
  - reports/archive/main-v0.0.15.md
  - reports/archive/main-v0.0.17.md
  - tooling/scripts/extract_docx_to_md.py
tests:
  - test/unit/chat-conversation-session.test.ts
  - e2e/chat-persistence.spec.ts
  - test/unit/oauth-callback.spec.ts
  - tooling/tests/test_extract_docx_to_md.py
  - test/unit/chat-conversation-state.test.ts
  - tooling/tests/test_office_pack_unpack.py
  - test/integration/passkey-first-link-google.spec.ts
  - test/unit/better-auth-passkey-hotfix-version.test.ts
  - test/unit/chat-conversation-history.test.ts
  - test/unit/link-google-for-passkey-first-initiator.test.ts
-->
