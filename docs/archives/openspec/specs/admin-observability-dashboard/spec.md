# admin-observability-dashboard Specification

## Purpose

TBD - created by archiving change 'admin-ui-post-core'. Update Purpose after archive.

## Requirements

### Requirement: Feature-Gated Admin Summary Dashboard

The system SHALL provide an Admin summary dashboard only when `features.adminDashboard` is enabled for the active environment. The dashboard SHALL present coarse summary cards and trend indicators without becoming the source of truth for governed query or document data.

#### Scenario: Dashboard stays hidden when feature flag is off

- **WHEN** `features.adminDashboard` is false in the active environment
- **THEN** the dashboard route and navigation entry stay hidden, disabled, or blocked
- **AND** the absence of the dashboard does not affect core Admin workflows

#### Scenario: Dashboard shows coarse operational summary when enabled

- **WHEN** the dashboard feature is enabled for an Admin environment
- **THEN** the page displays summary cards for document count, query volume, and token status
- **AND** the page uses aggregate data rather than raw sensitive rows

<!-- @trace
source: admin-ui-post-core
updated: 2026-04-19
code:
  - test/acceptance/evidence/a06-refusal-accuracy.ts
  - app/pages/admin/tokens/index.vue
  - docs/verify/RETENTION_CLEANUP_RUNBOOK.md
  - server/api/mcp/chunks/[citationId].get.ts
  - test/acceptance/evidence/ev04-rate-limit-cleanup.ts
  - shared/schemas/knowledge-runtime.ts
  - docs/verify/RETENTION_REPLAY_CONTRACT.md
  - scripts/create-mcp-token.ts
  - server/api/admin/mcp-tokens/index.get.ts
  - test/acceptance/evidence/ev-ui-01-state-coverage.ts
  - scripts/setup.sh
  - server/api/admin/debug/query-logs/[id].get.ts
  - .env.example
  - CLAUDE.md
  - server/utils/query-log-admin-store.ts
  - test/acceptance/evidence/a11-persistence-audit.ts
  - docs/verify/KNOWLEDGE_STAGING_SMOKE.md
  - docs/verify/DEBUG_SURFACE_VERIFICATION.md
  - app/pages/admin/query-logs/index.vue
  - server/api/admin/dashboard/summary.get.ts
  - test/acceptance/evidence/summary-tables.ts
  - server/api/mcp/search.post.ts
  - test/acceptance/evidence/ev02-oauth-allowlist.ts
  - test/acceptance/evidence/a13-rate-limit-retention.ts
  - nuxt.config.ts
  - .spectra/snapshots/2026-04-19-observability-and-debug/created_specs.json
  - docs/verify/staging-deploy-checklist.md
  - test/acceptance/evidence/a08-oauth-allowlist.ts
  - docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md
  - test/acceptance/evidence/a04-current-version-only.ts
  - docs/verify/production-deploy-checklist.md
  - test/acceptance/evidence/a10-admin-web-mcp-isolation.ts
  - docs/verify/KNOWLEDGE_SMOKE.md
  - test/acceptance/evidence/ev01-core-loop.ts
  - docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md
  - test/acceptance/evidence/run-all.ts
  - app/components/chat/Container.vue
  - scripts/spectra-ux/lib/common.sh
  - server/api/admin/mcp-tokens/[id].delete.ts
  - docs/verify/OAUTH_SETUP.md
  - scripts/retention-prune.ts
  - scripts/staging-retention-prune.ts
  - server/api/mcp/ask.post.ts
  - docs/verify/ACCEPTANCE_RUNBOOK.md
  - main-v0.0.43.md
  - test/acceptance/evidence/a03-citation-replay.ts
  - test/acceptance/evidence/a12-mcp-no-internal-diagnostics.ts
  - test/acceptance/evidence/a05-self-correction.ts
  - scripts/spectra-ux/archive-gate.sh
  - pnpm-workspace.yaml
  - playwright.config.ts
  - server/api/admin/query-logs/[id].get.ts
  - server/utils/admin-dashboard-store.ts
  - test/acceptance/evidence/a02-ai-search-orchestration.ts
  - test/acceptance/evidence/a01-deploy-smoke.ts
  - test/acceptance/evidence/ev03-publish-cutover.ts
  - docs/decisions/2026-04-23-recognize-staging-as-active-environment.md
  - app/components/admin/tokens/TokenCreateModal.vue
  - server/api/admin/debug/latency/summary.get.ts
  - server/utils/query-log-debug-store.ts
  - test/acceptance/evidence/a07-mcp-contract.ts
  - test/acceptance/evidence/a09-restricted-scope.ts
  - server/utils/mcp-token-store.ts
  - docs/verify/rollout-checklist.md
  - server/api/admin/query-logs/index.get.ts
  - docs/verify/RETENTION_CLEANUP_VERIFICATION.md
  - app/components/chat/CitationReplayModal.vue
  - package.json
  - app/components/chat/MessageList.vue
  - server/api/mcp/categories.get.ts
tests:
  - test/unit/mcp-token-store.test.ts
  - test/integration/conversation-create.test.ts
  - test/unit/knowledge-audit.test.ts
  - test/unit/knowledge-governance.test.ts
  - test/integration/evidence-exporter.test.ts
  - test/integration/get-document-chunk-replay.test.ts
  - test/unit/document-sync.test.ts
  - test/unit/mcp-ask-observability.test.ts
  - test/integration/acceptance-tc-10.test.ts
  - test/integration/acceptance-tc-04.test.ts
  - test/integration/acceptance-tc-06.test.ts
  - test/integration/acceptance-tc-11.test.ts
  - test/integration/acceptance-tc-19.test.ts
  - test/integration/acceptance-tc-08.test.ts
  - test/unit/tc-ui-state-coverage.test.ts
  - test/unit/debug-surface-guard.test.ts
  - e2e/observability-review.spec.ts
  - test/integration/acceptance-tc-09.test.ts
  - test/unit/document-preprocessing.test.ts
  - e2e/token-create-debug.spec.ts
  - e2e/token-flow.spec.ts
  - test/integration/chat-stale-followup.test.ts
  - test/unit/admin-dashboard-store.test.ts
  - test/integration/acceptance-tc-14.test.ts
  - test/unit/web-chat-observability.test.ts
  - test/integration/acceptance-tc-ui-state.test.ts
  - test/integration/retention-cleanup.test.ts
  - test/unit/mcp-ask.test.ts
  - test/unit/web-chat.test.ts
  - e2e/manual-review-screenshots.spec.ts
  - test/integration/retention-verification-path.test.ts
  - test/integration/acceptance-tc-07.test.ts
  - test/integration/acceptance-tc-17.test.ts
  - e2e/get-csrf-cookie.spec.ts
  - test/integration/chat-route.test.ts
  - test/unit/query-log-debug-store.test.ts
-->

---

### Requirement: Summary Data Remains Audit-Safe

Dashboard summaries SHALL derive from existing governed data sources such as documents, query logs, and token metadata, and SHALL avoid exposing raw high-risk payloads or unreduced debug internals.

#### Scenario: Dashboard does not expose raw risky content

- **WHEN** the dashboard renders operational statistics
- **THEN** it shows only counts, rates, or redaction-safe summaries
- **AND** it does not expose raw user prompts, secrets, or internal-only debug fields

<!-- @trace
source: admin-ui-post-core
updated: 2026-04-19
code:
  - test/acceptance/evidence/a06-refusal-accuracy.ts
  - app/pages/admin/tokens/index.vue
  - docs/verify/RETENTION_CLEANUP_RUNBOOK.md
  - server/api/mcp/chunks/[citationId].get.ts
  - test/acceptance/evidence/ev04-rate-limit-cleanup.ts
  - shared/schemas/knowledge-runtime.ts
  - docs/verify/RETENTION_REPLAY_CONTRACT.md
  - scripts/create-mcp-token.ts
  - server/api/admin/mcp-tokens/index.get.ts
  - test/acceptance/evidence/ev-ui-01-state-coverage.ts
  - scripts/setup.sh
  - server/api/admin/debug/query-logs/[id].get.ts
  - .env.example
  - CLAUDE.md
  - server/utils/query-log-admin-store.ts
  - test/acceptance/evidence/a11-persistence-audit.ts
  - docs/verify/KNOWLEDGE_STAGING_SMOKE.md
  - docs/verify/DEBUG_SURFACE_VERIFICATION.md
  - app/pages/admin/query-logs/index.vue
  - server/api/admin/dashboard/summary.get.ts
  - test/acceptance/evidence/summary-tables.ts
  - server/api/mcp/search.post.ts
  - test/acceptance/evidence/ev02-oauth-allowlist.ts
  - test/acceptance/evidence/a13-rate-limit-retention.ts
  - nuxt.config.ts
  - .spectra/snapshots/2026-04-19-observability-and-debug/created_specs.json
  - docs/verify/staging-deploy-checklist.md
  - test/acceptance/evidence/a08-oauth-allowlist.ts
  - docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md
  - test/acceptance/evidence/a04-current-version-only.ts
  - docs/verify/production-deploy-checklist.md
  - test/acceptance/evidence/a10-admin-web-mcp-isolation.ts
  - docs/verify/KNOWLEDGE_SMOKE.md
  - test/acceptance/evidence/ev01-core-loop.ts
  - docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md
  - test/acceptance/evidence/run-all.ts
  - app/components/chat/Container.vue
  - scripts/spectra-ux/lib/common.sh
  - server/api/admin/mcp-tokens/[id].delete.ts
  - docs/verify/OAUTH_SETUP.md
  - scripts/retention-prune.ts
  - scripts/staging-retention-prune.ts
  - server/api/mcp/ask.post.ts
  - docs/verify/ACCEPTANCE_RUNBOOK.md
  - main-v0.0.43.md
  - test/acceptance/evidence/a03-citation-replay.ts
  - test/acceptance/evidence/a12-mcp-no-internal-diagnostics.ts
  - test/acceptance/evidence/a05-self-correction.ts
  - scripts/spectra-ux/archive-gate.sh
  - pnpm-workspace.yaml
  - playwright.config.ts
  - server/api/admin/query-logs/[id].get.ts
  - server/utils/admin-dashboard-store.ts
  - test/acceptance/evidence/a02-ai-search-orchestration.ts
  - test/acceptance/evidence/a01-deploy-smoke.ts
  - test/acceptance/evidence/ev03-publish-cutover.ts
  - docs/decisions/2026-04-23-recognize-staging-as-active-environment.md
  - app/components/admin/tokens/TokenCreateModal.vue
  - server/api/admin/debug/latency/summary.get.ts
  - server/utils/query-log-debug-store.ts
  - test/acceptance/evidence/a07-mcp-contract.ts
  - test/acceptance/evidence/a09-restricted-scope.ts
  - server/utils/mcp-token-store.ts
  - docs/verify/rollout-checklist.md
  - server/api/admin/query-logs/index.get.ts
  - docs/verify/RETENTION_CLEANUP_VERIFICATION.md
  - app/components/chat/CitationReplayModal.vue
  - package.json
  - app/components/chat/MessageList.vue
  - server/api/mcp/categories.get.ts
tests:
  - test/unit/mcp-token-store.test.ts
  - test/integration/conversation-create.test.ts
  - test/unit/knowledge-audit.test.ts
  - test/unit/knowledge-governance.test.ts
  - test/integration/evidence-exporter.test.ts
  - test/integration/get-document-chunk-replay.test.ts
  - test/unit/document-sync.test.ts
  - test/unit/mcp-ask-observability.test.ts
  - test/integration/acceptance-tc-10.test.ts
  - test/integration/acceptance-tc-04.test.ts
  - test/integration/acceptance-tc-06.test.ts
  - test/integration/acceptance-tc-11.test.ts
  - test/integration/acceptance-tc-19.test.ts
  - test/integration/acceptance-tc-08.test.ts
  - test/unit/tc-ui-state-coverage.test.ts
  - test/unit/debug-surface-guard.test.ts
  - e2e/observability-review.spec.ts
  - test/integration/acceptance-tc-09.test.ts
  - test/unit/document-preprocessing.test.ts
  - e2e/token-create-debug.spec.ts
  - e2e/token-flow.spec.ts
  - test/integration/chat-stale-followup.test.ts
  - test/unit/admin-dashboard-store.test.ts
  - test/integration/acceptance-tc-14.test.ts
  - test/unit/web-chat-observability.test.ts
  - test/integration/acceptance-tc-ui-state.test.ts
  - test/integration/retention-cleanup.test.ts
  - test/unit/mcp-ask.test.ts
  - test/unit/web-chat.test.ts
  - e2e/manual-review-screenshots.spec.ts
  - test/integration/retention-verification-path.test.ts
  - test/integration/acceptance-tc-07.test.ts
  - test/integration/acceptance-tc-17.test.ts
  - e2e/get-csrf-cookie.spec.ts
  - test/integration/chat-route.test.ts
  - test/unit/query-log-debug-store.test.ts
-->
