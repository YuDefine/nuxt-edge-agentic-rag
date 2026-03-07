# latency-and-outcome-observability Specification

## Purpose

TBD - created by archiving change 'observability-and-debug'. Update Purpose after archive.

## Requirements

### Requirement: Latency Summary Surface

The system SHALL provide an internal observability surface for first-token latency, completion latency, and grouped outcome summaries derived from governed query log data.

#### Scenario: Admin reviews latency summary

- **WHEN** an authorized Admin opens the latency observability surface
- **THEN** the page shows first-token and completion latency summaries
- **AND** the page groups or summarizes outcomes such as answered, refused, forbidden, and error

#### Scenario: Missing latency stays explicit

- **WHEN** a request never produced a full streamed answer and latency fields are null
- **THEN** the observability surface represents that state explicitly
- **AND** does not fabricate timing values

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

### Requirement: Outcome Trends Stay Redaction-Safe

The observability surface SHALL present redaction-safe aggregates and SHALL avoid exposing raw prompts or prohibited payloads while summarizing refusal, error, and rate-limit behavior.

#### Scenario: Aggregate outcome view avoids raw content

- **WHEN** the page summarizes refusal or high-risk traffic
- **THEN** it uses counts, ratios, or grouped summaries
- **AND** it does not reveal raw redacted input content

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
