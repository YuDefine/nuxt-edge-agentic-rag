# conversation-lifecycle-governance Specification

## Purpose

TBD - created by archiving change 'governance-refinements'. Update Purpose after archive.

## Requirements

### Requirement: Deleted Conversation Content Purge

When a user deletes a conversation, the system SHALL immediately remove that conversation from user-visible lists, detail APIs, and future model context assembly. The system SHALL clear, hard-delete, or otherwise render `conversations.title` and `messages.content_text` irrecoverable for normal user access while preserving only audit-safe residue.

#### Scenario: Deleted conversation disappears from user surfaces

- **WHEN** a user deletes a conversation
- **THEN** subsequent list and detail reads do not return that conversation
- **AND** future follow-up requests do not use its messages as model context

#### Scenario: Audit residue never restores original content

- **WHEN** a deleted conversation still has retained audit metadata inside the retention window
- **THEN** only redacted or marker-only data remains available to audit paths
- **AND** normal user paths cannot recover the original title or raw message content

<!-- @trace
source: governance-refinements
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->

---

### Requirement: Stale Follow-Up Revalidation

The system SHALL dynamically re-evaluate whether the latest cited document version in a Web conversation is still current before treating the conversation as a same-document follow-up. If the cited version is no longer current, the conversation SHALL be treated as stale and the next answer SHALL rely on fresh retrieval instead of blindly continuing the previous context.

#### Scenario: Current version change marks a conversation stale

- **WHEN** the latest persisted assistant message cites a document version that is no longer current
- **THEN** the next Web follow-up is evaluated as stale
- **AND** answer generation uses fresh retrieval rather than the stale citation chain as truth

#### Scenario: Same-document follow-up survives only while current remains valid

- **WHEN** the latest cited document version is still current and the conversation has not been deleted
- **THEN** the system may keep the same-document follow-up fast path
- **AND** the resulting answer still uses current authorization and retrieval validation

<!-- @trace
source: governance-refinements
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->

---

### Requirement: User-Facing Conversation Reads Respect Purged Content Boundaries

All user-facing Web conversation reads SHALL serve message content only from active, visible conversations. Once a conversation is soft-deleted, normal Web history, detail, and follow-up flows SHALL stop exposing its prior `messages.content_text`, even if audit-safe residue remains in storage.

#### Scenario: Reload after deletion does not restore purged content

- **WHEN** a user deletes a conversation and then reloads the chat page
- **THEN** the deleted conversation is absent from the visible history and detail reads
- **AND** the UI cannot repopulate the deleted thread from previously cached client state alone

#### Scenario: Deleted conversation cannot be resumed as a follow-up thread

- **WHEN** a user attempts to continue a conversation that has already been soft-deleted
- **THEN** the system rejects that follow-up as no longer visible
- **AND** no deleted conversation content is reintroduced into future model context assembly

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

### Requirement: Persisted Follow-Up Uses The Active Conversation Identity

A Web follow-up request that continues an existing conversation SHALL use the persisted active `conversationId` as its thread boundary. The system SHALL evaluate stale-citation rules against that persisted conversation before treating the request as a same-thread follow-up.

#### Scenario: Active persisted conversation drives stale follow-up evaluation

- **WHEN** a user asks a follow-up question inside an active persisted conversation
- **THEN** the system evaluates stale-document rules against the latest persisted assistant message in that conversation
- **AND** the resulting answer either stays in the same thread or forces fresh retrieval according to the persisted conversation state

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
