# debug-decision-inspection Specification

## Purpose

TBD - created by archiving change 'observability-and-debug'. Update Purpose after archive.

## Requirements

### Requirement: Internal Decision Inspection Surface

The system SHALL provide an internal-only debug surface that displays governed diagnostic fields such as retrieval score, answerability judge score when present, decision path, and citation eligibility state for completed requests.

#### Scenario: Admin inspects a completed answer decision

- **WHEN** an authorized Admin opens the decision inspection surface for a completed request
- **THEN** the surface shows decision path, retrieval score, and any recorded judge score
- **AND** the surface uses the persisted debug-safe record rather than rerunning the answer flow

#### Scenario: Refusal shows refusal-specific diagnostics

- **WHEN** the inspected request ended in refusal
- **THEN** the surface shows refusal-oriented diagnostics such as refusal reason code and whether self-correction triggered
- **AND** it does not pretend a citation-backed answer existed

<!-- @trace
source: observability-and-debug
updated: 2026-04-19
code:
  - app/components/chat/MessageList.vue
  - scripts/retention-prune.ts
  - pnpm-workspace.yaml
  - app/components/chat/Container.vue
  - scripts/setup.sh
  - docs/verify/rollout-checklist.md
  - server/utils/admin-dashboard-store.ts
  - scripts/spectra-ux/lib/common.sh
  - scripts/staging-retention-prune.ts
  - docs/verify/production-deploy-checklist.md
  - server/api/admin/query-logs/index.get.ts
  - server/api/mcp/chunks/[citationId].get.ts
  - docs/verify/RETENTION_CLEANUP_RUNBOOK.md
  - server/api/mcp/search.post.ts
  - docs/verify/RETENTION_CLEANUP_VERIFICATION.md
  - nuxt.config.ts
  - server/api/admin/mcp-tokens/[id].delete.ts
  - docs/verify/OAUTH_SETUP.md
  - server/utils/mcp-token-store.ts
  - playwright.config.ts
  - server/api/admin/query-logs/[id].get.ts
  - docs/verify/RETENTION_REPLAY_CONTRACT.md
  - docs/verify/staging-deploy-checklist.md
  - server/utils/query-log-admin-store.ts
  - server/utils/query-log-debug-store.ts
  - server/api/admin/debug/query-logs/[id].get.ts
  - docs/verify/ACCEPTANCE_RUNBOOK.md
  - server/api/mcp/categories.get.ts
  - server/api/admin/dashboard/summary.get.ts
  - server/api/admin/debug/latency/summary.get.ts
  - docs/verify/DEBUG_SURFACE_VERIFICATION.md
  - docs/verify/KNOWLEDGE_STAGING_SMOKE.md
  - docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md
  - scripts/spectra-ux/archive-gate.sh
  - server/api/admin/mcp-tokens/index.get.ts
  - shared/schemas/knowledge-runtime.ts
  - app/components/chat/CitationReplayModal.vue
  - server/api/mcp/ask.post.ts
  - docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md
  - scripts/create-mcp-token.ts
  - docs/verify/KNOWLEDGE_SMOKE.md
  - package.json
tests:
  - test/integration/acceptance-tc-04.test.ts
  - test/integration/acceptance-tc-08.test.ts
  - test/integration/acceptance-tc-17.test.ts
  - test/unit/query-log-debug-store.test.ts
  - e2e/token-flow.spec.ts
  - test/integration/acceptance-tc-06.test.ts
  - test/integration/acceptance-tc-07.test.ts
  - e2e/observability-review.spec.ts
  - test/unit/admin-dashboard-store.test.ts
  - test/integration/acceptance-tc-10.test.ts
  - test/integration/acceptance-tc-14.test.ts
  - e2e/manual-review-screenshots.spec.ts
  - test/integration/acceptance-tc-11.test.ts
  - e2e/token-create-debug.spec.ts
  - test/integration/acceptance-tc-09.test.ts
  - test/integration/get-document-chunk-replay.test.ts
  - test/integration/acceptance-tc-19.test.ts
-->

---

### Requirement: Debug Data Remains Internal-Only

Decision inspection fields SHALL remain unavailable to general user-facing surfaces and MCP public contracts.

#### Scenario: General user cannot see internal decision fields

- **WHEN** a normal Web user or MCP caller uses the product surfaces
- **THEN** retrieval scores, judge scores, and decision trace data remain hidden
- **AND** only the internal debug surface may display them

<!-- @trace
source: observability-and-debug
updated: 2026-04-19
code:
  - app/components/chat/MessageList.vue
  - scripts/retention-prune.ts
  - pnpm-workspace.yaml
  - app/components/chat/Container.vue
  - scripts/setup.sh
  - docs/verify/rollout-checklist.md
  - server/utils/admin-dashboard-store.ts
  - scripts/spectra-ux/lib/common.sh
  - scripts/staging-retention-prune.ts
  - docs/verify/production-deploy-checklist.md
  - server/api/admin/query-logs/index.get.ts
  - server/api/mcp/chunks/[citationId].get.ts
  - docs/verify/RETENTION_CLEANUP_RUNBOOK.md
  - server/api/mcp/search.post.ts
  - docs/verify/RETENTION_CLEANUP_VERIFICATION.md
  - nuxt.config.ts
  - server/api/admin/mcp-tokens/[id].delete.ts
  - docs/verify/OAUTH_SETUP.md
  - server/utils/mcp-token-store.ts
  - playwright.config.ts
  - server/api/admin/query-logs/[id].get.ts
  - docs/verify/RETENTION_REPLAY_CONTRACT.md
  - docs/verify/staging-deploy-checklist.md
  - server/utils/query-log-admin-store.ts
  - server/utils/query-log-debug-store.ts
  - server/api/admin/debug/query-logs/[id].get.ts
  - docs/verify/ACCEPTANCE_RUNBOOK.md
  - server/api/mcp/categories.get.ts
  - server/api/admin/dashboard/summary.get.ts
  - server/api/admin/debug/latency/summary.get.ts
  - docs/verify/DEBUG_SURFACE_VERIFICATION.md
  - docs/verify/KNOWLEDGE_STAGING_SMOKE.md
  - docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md
  - scripts/spectra-ux/archive-gate.sh
  - server/api/admin/mcp-tokens/index.get.ts
  - shared/schemas/knowledge-runtime.ts
  - app/components/chat/CitationReplayModal.vue
  - server/api/mcp/ask.post.ts
  - docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md
  - scripts/create-mcp-token.ts
  - docs/verify/KNOWLEDGE_SMOKE.md
  - package.json
tests:
  - test/integration/acceptance-tc-04.test.ts
  - test/integration/acceptance-tc-08.test.ts
  - test/integration/acceptance-tc-17.test.ts
  - test/unit/query-log-debug-store.test.ts
  - e2e/token-flow.spec.ts
  - test/integration/acceptance-tc-06.test.ts
  - test/integration/acceptance-tc-07.test.ts
  - e2e/observability-review.spec.ts
  - test/unit/admin-dashboard-store.test.ts
  - test/integration/acceptance-tc-10.test.ts
  - test/integration/acceptance-tc-14.test.ts
  - e2e/manual-review-screenshots.spec.ts
  - test/integration/acceptance-tc-11.test.ts
  - e2e/token-create-debug.spec.ts
  - test/integration/acceptance-tc-09.test.ts
  - test/integration/get-document-chunk-replay.test.ts
  - test/integration/acceptance-tc-19.test.ts
-->
