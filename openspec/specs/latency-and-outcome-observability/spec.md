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

---

### Requirement: Outcome Breakdown Uses Standard Chart Components

The observability surface SHALL render per-channel outcome aggregates with `nuxt-charts` using only the existing redaction-safe counts for `answered`, `refused`, `forbidden`, and `error`. The chart MUST preserve all governed outcome categories in a stable order, MUST support zero-count categories without removing them from the comparison, and MUST NOT request or display raw prompts, raw payloads, or per-request identifiers.

#### Scenario: Admin reviews outcome distribution for a channel

- **WHEN** an authorized Admin opens the latency observability surface and a channel summary includes outcome aggregates
- **THEN** the page SHALL render a `nuxt-charts` categorical chart for that channel's `answered`, `refused`, `forbidden`, and `error` counts
- **AND** the chart SHALL present the four governed outcome categories as a comparison within the same surface

##### Example: zero-count categories stay visible

| Answered | Refused | Forbidden | Error | Expected categories                 |
| -------- | ------- | --------- | ----- | ----------------------------------- |
| 12       | 3       | 0         | 1     | answered, refused, forbidden, error |
| 0        | 0       | 0         | 5     | answered, refused, forbidden, error |

#### Scenario: Outcome chart remains redaction-safe

- **WHEN** the chart is rendered from aggregated query-log data
- **THEN** it SHALL use only aggregate labels and counts
- **AND** it SHALL NOT expose raw query content, raw refusal text, or any record-level identifier in the chart surface

<!-- @trace
source: standardize-chart-surfaces-on-nuxt-charts
updated: 2026-04-24
code:
  - package.json
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - app/components/debug/OutcomeBreakdown.vue
  - local/reports/notes/main-v0.0.52-word-compare.md
  - vitest.config.ts
  - docs/verify/production-deploy-checklist.md
  - HANDOFF.md
  - local/reports/notes/main-v0.0.52-word-copy.md
  - .codex/hooks/_codex_hook_wrapper.sh
  - docs/runbooks/remote-mcp-connectors.md
  - .env.example
  - docs/tech-debt.md
  - .codex/hooks/post-bash-error-debug.sh
  - app/utils/chart-series.ts
  - app/components/admin/usage/TimelineChart.vue
tests:
  - test/unit/link-google-for-passkey-first-utils.test.ts
  - test/unit/chart-series.test.ts
  - test/unit/debug-outcome-breakdown.test.ts
  - e2e/td003-contrast.spec.ts
  - test/unit/admin-usage-timeline-chart.test.ts
  - e2e/observability-review.spec.ts
-->
