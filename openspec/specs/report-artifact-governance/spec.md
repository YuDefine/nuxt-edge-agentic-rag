# report-artifact-governance Specification

## Purpose

TBD - created by archiving change 'report-governance-handoff-cleanup'. Update Purpose after archive.

## Requirements

### Requirement: Current Report Has A Single Canonical Artifact

The repository SHALL treat `reports/latest.md` as the single canonical artifact for the current report body. The repository SHALL treat files stored under `reports/archive/` as historical snapshots only and SHALL NOT use archived report files to describe the current report state.

#### Scenario: Current report guidance points to latest

- **WHEN** repository guidance or workflow notes describe where the current report lives
- **THEN** they SHALL point to `reports/latest.md` as the current report body
- **AND** they SHALL NOT describe any archived report file as the current version

#### Scenario: Archived reports remain historical snapshots

- **WHEN** a report snapshot is stored under `reports/archive/`
- **THEN** that file SHALL be treated as versioned history only
- **AND** future current-state updates SHALL be written outside the archived snapshot

<!-- @trace
source: report-governance-handoff-cleanup
updated: 2026-04-22
code:
  - docs/decisions/2026-04-22-stable-current-report-entry.md
  - docs/decisions/2026-04-22-canonical-test-roots-and-repo-archives.md
  - docs/README.md
  - docs/decisions/index.md
  - docs/STRUCTURE.md
  - AGENTS.md
  - openspec/ROADMAP.md
  - HANDOFF.md
tests:
  - test/unit/legacy-test-roots.test.ts
-->

---

### Requirement: Cross-Session Report Planning Lives In OpenSpec Roadmap

The repository SHALL store cross-session report planning context in `openspec/ROADMAP.md` instead of `HANDOFF.md`. Cross-session planning context includes current-state assessments, follow-up directions, evidence gaps, and reusable source-material inventories that remain relevant beyond a single session.

#### Scenario: Stable report planning context is captured in roadmap

- **WHEN** a discussion concludes that a report still needs additional evidence, demo assets, or backfill material in later sessions
- **THEN** that conclusion SHALL be captured in `openspec/ROADMAP.md`
- **AND** it SHALL be written as ongoing planning context rather than session-local notes

#### Scenario: Report source-material inventory persists across sessions

- **WHEN** the team inventories reusable report inputs such as evidence bundles, seed cases, token governance status, or query-log-derived material
- **THEN** that inventory SHALL be maintained in `openspec/ROADMAP.md` or the report body
- **AND** it SHALL NOT remain only in `HANDOFF.md`

<!-- @trace
source: canonical-root-handoff-path
updated: 2026-04-23
code:
  - docs/decisions/2026-04-23-canonical-root-handoff-artifact.md
  - .claude/rules/handoff.md
  - .codex/hooks.json
  - .codex/hooks/session-start-roadmap-sync.sh
  - .codex/hooks/post-edit-roadmap-sync.sh
  - .codex/hooks/pre-archive-design-gate.sh
  - .agents/skills/commit/SKILL.md
  - .codex/agents/screenshot-review.toml
  - docs/tech-debt.md
  - AGENTS.md
  - docs/STRUCTURE.md
  - docs/README.md
  - openspec/ROADMAP.md
  - HANDOFF.md
  - .codex/hooks/_codex_hook_wrapper.sh
-->

---

### Requirement: Handoff Remains Session-Scoped

`HANDOFF.md` SHALL contain only session-scoped handoff information: immediate status, active blockers, scope warnings, and the next concrete actions for the next operator. It SHALL NOT be used as the long-term storage location for stable report governance rules or cross-session roadmap decisions.

#### Scenario: Session-local warning stays in root handoff

- **WHEN** the next operator needs to know about a dirty worktree, temporary blocker, or immediate sequencing concern
- **THEN** that warning SHALL remain in repo root `HANDOFF.md`

#### Scenario: Stable governance rule is removed from handoff

- **WHEN** a handoff note states a stable governance rule such as the canonical current report artifact or the archive policy
- **THEN** that rule SHALL be moved to the governing OpenSpec artifact
- **AND** `HANDOFF.md` SHALL retain only the session-specific remainder, if any

<!-- @trace
source: canonical-root-handoff-path
updated: 2026-04-23
code:
  - docs/decisions/2026-04-23-canonical-root-handoff-artifact.md
  - .claude/rules/handoff.md
  - .codex/hooks.json
  - .codex/hooks/session-start-roadmap-sync.sh
  - .codex/hooks/post-edit-roadmap-sync.sh
  - .codex/hooks/pre-archive-design-gate.sh
  - .agents/skills/commit/SKILL.md
  - .codex/agents/screenshot-review.toml
  - docs/tech-debt.md
  - AGENTS.md
  - docs/STRUCTURE.md
  - docs/README.md
  - openspec/ROADMAP.md
  - HANDOFF.md
  - .codex/hooks/_codex_hook_wrapper.sh
-->

---

### Requirement: Current Report Reflects Shipped Web Chat Persistence Behavior

The current report SHALL describe Web chat persistence according to shipped and verified behavior, not according to stale implementation notes or superseded roadmap language. Once the persisted Web chat flow is completed and verified, the current report SHALL describe that capability as supported and SHALL remove contradictory statements that still describe it as unsupported, single-round only, or deferred.

#### Scenario: Current report upgrades persisted chat from deferred to shipped

- **WHEN** the Web chat persistence flow has been implemented and verified in the current release
- **THEN** `reports/latest.md` describes the feature as an implemented Web capability
- **AND** it does not keep any statement that says Web chat persistence is still unsupported or reserved for a later phase

#### Scenario: Current report ties claims to evidence

- **WHEN** `reports/latest.md` claims that Web chat persistence is complete
- **THEN** that claim is backed by the corresponding automated verification and evidence artifacts
- **AND** the report text points to the shipped behavior rather than to pre-implementation intent

<!-- @trace
source: complete-web-chat-persistence
updated: 2026-04-23
code:
  - reports/latest.md
  - app/components/chat/Container.vue
  - app/components/chat/ConversationHistory.vue
  - app/composables/useChatConversationHistory.ts
  - app/composables/useChatConversationSession.ts
  - app/utils/chat-conversation-state.ts
  - app/types/chat.ts
  - app/pages/index.vue
  - AGENTS.md
  - openspec/ROADMAP.md
  - docs/verify/index.md
  - docs/verify/evidence/web-chat-persistence.json
  - docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md
  - playwright.config.ts
  - nuxt.config.ts
tests:
  - e2e/chat-persistence.spec.ts
  - test/unit/chat-conversation-session.test.ts
  - test/unit/chat-conversation-state.test.ts
  - test/unit/chat-conversation-history.test.ts
-->
