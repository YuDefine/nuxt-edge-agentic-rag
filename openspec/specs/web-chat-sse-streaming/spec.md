# web-chat-sse-streaming Specification

## Purpose

Define the Web chat streaming transport contract: answers are delivered as real SSE
events on the authenticated chat path, first-token latency is measurable, user
stop actions cancel the active server stream, and accepted/refusal/error outcomes
remain stable for the Web chat UI.

## Requirements

### Requirement: Web chat SHALL stream answers through SSE events

The system SHALL deliver Web chat answers as real SSE events instead of waiting for a complete answer and simulating chunked output on the client. The client SHALL render streamed content from server events rather than from synthetic timer-based chunking.

#### Scenario: Client renders streamed answer content from server events

- **WHEN** an accepted Web chat request starts streaming
- **THEN** the server SHALL emit answer content as SSE events
- **AND** the client SHALL append visible answer content from those events
- **AND** the client SHALL NOT depend on synthetic chunk timers to display the answer

<!-- @trace
source: implement-web-chat-sse-streaming
updated: 2026-04-24
code:
  - docs/runbooks/remote-mcp-connectors.md
  - app/utils/chat-stream.ts
  - server/mcp/tools/ask.ts
  - test/acceptance/workers-ai-accepted-path-samples.ts
  - docs/verify/WORKERS_AI_ACCEPTED_PATH_VERIFICATION.md
  - .npmrc
  - server/utils/mcp-middleware.ts
  - server/api/auth/mcp/token.post.ts
  - app/utils/chart-series.ts
  - .codex/hooks/_codex_hook_wrapper.sh
  - server/db/schema.ts
  - local/reports/notes/main-v0.0.52-word-copy.md
  - server/utils/web-chat.ts
  - app/pages/admin/debug/latency/index.vue
  - shared/types/observability.ts
  - docs/tech-debt.md
  - vitest.config.ts
  - app/components/admin/usage/TimelineChart.vue
  - .github/workflows/ci.yml
  - package.json
  - server/utils/workers-ai.ts
  - server/api/chat.post.ts
  - server/routes/.well-known/oauth-protected-resource/mcp.get.ts
  - local/reports/notes/main-v0.0.52-word-compare.md
  - docs/verify/production-deploy-checklist.md
  - shared/types/chat-stream.ts
  - server/routes/.well-known/oauth-authorization-server.get.ts
  - server/utils/query-log-debug-store.ts
  - HANDOFF.md
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - app/components/debug/OutcomeBreakdown.vue
  - test/acceptance/helpers/bindings.ts
  - server/routes/.well-known/oauth-protected-resource.get.ts
  - docs/verify/WORKERS_AI_BASELINE_REPORTING.md
  - .codex/hooks/post-bash-error-debug.sh
  - server/utils/knowledge-audit.ts
  - server/utils/mcp-ask.ts
  - server/utils/mcp-oauth-metadata.ts
  - server/database/migrations/0011_query_logs_workers_ai_runs.sql
  - app/components/chat/Container.vue
  - server/utils/knowledge-answering.ts
  - .env.example
tests:
  - test/unit/mcp-middleware.test.ts
  - test/unit/admin-usage-timeline-chart.test.ts
  - test/unit/debug-outcome-breakdown.test.ts
  - test/unit/knowledge-audit.test.ts
  - test/unit/chat-container-streaming-contract.test.ts
  - test/unit/web-chat-observability.test.ts
  - test/integration/mcp-oauth-tool-access.test.ts
  - test/integration/mcp-routes.test.ts
  - test/unit/mcp-tool-search.test.ts
  - test/integration/mcp-oauth-metadata-routes.test.ts
  - test/integration/mcp-connector-token-route.test.ts
  - test/unit/chart-series.test.ts
  - test/unit/workers-ai.test.ts
  - test/unit/knowledge-answering.test.ts
  - test/integration/conversation-create.test.ts
  - test/unit/workers-ai-accepted-path-samples.test.ts
  - test/unit/mcp-tool-get-document-chunk.test.ts
  - e2e/td003-contrast.spec.ts
  - test/unit/link-google-for-passkey-first-utils.test.ts
  - test/unit/mcp-tool-ask.test.ts
  - test/unit/mcp-tool-categories.test.ts
  - test/unit/chat-stream.test.ts
  - test/integration/chat-route.test.ts
  - e2e/observability-review.spec.ts
-->

---

### Requirement: Web chat streaming SHALL record first-token latency

The system SHALL measure and persist first-token latency for streamed Web chat answers. The measurement SHALL reflect the elapsed time between request start and the first emitted answer-content event that is visible to the client.

#### Scenario: First token latency is recorded for a streamed answer

- **WHEN** a streamed Web chat answer emits its first visible answer-content event
- **THEN** the system SHALL record first-token latency for that run
- **AND** the recorded value SHALL be available to the verification flow for the streaming capability

<!-- @trace
source: implement-web-chat-sse-streaming
updated: 2026-04-24
code:
  - docs/runbooks/remote-mcp-connectors.md
  - app/utils/chat-stream.ts
  - server/mcp/tools/ask.ts
  - test/acceptance/workers-ai-accepted-path-samples.ts
  - docs/verify/WORKERS_AI_ACCEPTED_PATH_VERIFICATION.md
  - .npmrc
  - server/utils/mcp-middleware.ts
  - server/api/auth/mcp/token.post.ts
  - app/utils/chart-series.ts
  - .codex/hooks/_codex_hook_wrapper.sh
  - server/db/schema.ts
  - local/reports/notes/main-v0.0.52-word-copy.md
  - server/utils/web-chat.ts
  - app/pages/admin/debug/latency/index.vue
  - shared/types/observability.ts
  - docs/tech-debt.md
  - vitest.config.ts
  - app/components/admin/usage/TimelineChart.vue
  - .github/workflows/ci.yml
  - package.json
  - server/utils/workers-ai.ts
  - server/api/chat.post.ts
  - server/routes/.well-known/oauth-protected-resource/mcp.get.ts
  - local/reports/notes/main-v0.0.52-word-compare.md
  - docs/verify/production-deploy-checklist.md
  - shared/types/chat-stream.ts
  - server/routes/.well-known/oauth-authorization-server.get.ts
  - server/utils/query-log-debug-store.ts
  - HANDOFF.md
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - app/components/debug/OutcomeBreakdown.vue
  - test/acceptance/helpers/bindings.ts
  - server/routes/.well-known/oauth-protected-resource.get.ts
  - docs/verify/WORKERS_AI_BASELINE_REPORTING.md
  - .codex/hooks/post-bash-error-debug.sh
  - server/utils/knowledge-audit.ts
  - server/utils/mcp-ask.ts
  - server/utils/mcp-oauth-metadata.ts
  - server/database/migrations/0011_query_logs_workers_ai_runs.sql
  - app/components/chat/Container.vue
  - server/utils/knowledge-answering.ts
  - .env.example
tests:
  - test/unit/mcp-middleware.test.ts
  - test/unit/admin-usage-timeline-chart.test.ts
  - test/unit/debug-outcome-breakdown.test.ts
  - test/unit/knowledge-audit.test.ts
  - test/unit/chat-container-streaming-contract.test.ts
  - test/unit/web-chat-observability.test.ts
  - test/integration/mcp-oauth-tool-access.test.ts
  - test/integration/mcp-routes.test.ts
  - test/unit/mcp-tool-search.test.ts
  - test/integration/mcp-oauth-metadata-routes.test.ts
  - test/integration/mcp-connector-token-route.test.ts
  - test/unit/chart-series.test.ts
  - test/unit/workers-ai.test.ts
  - test/unit/knowledge-answering.test.ts
  - test/integration/conversation-create.test.ts
  - test/unit/workers-ai-accepted-path-samples.test.ts
  - test/unit/mcp-tool-get-document-chunk.test.ts
  - e2e/td003-contrast.spec.ts
  - test/unit/link-google-for-passkey-first-utils.test.ts
  - test/unit/mcp-tool-ask.test.ts
  - test/unit/mcp-tool-categories.test.ts
  - test/unit/chat-stream.test.ts
  - test/integration/chat-route.test.ts
  - e2e/observability-review.spec.ts
-->

---

### Requirement: Web chat streaming SHALL support end-to-end cancellation

The system SHALL support user-triggered cancellation that stops both client-side rendering and server-side streaming work. A canceled run SHALL terminate the active stream and SHALL NOT continue emitting answer-content events after cancellation is acknowledged.

#### Scenario: User stop action terminates the active stream

- **WHEN** the user triggers stop during an active streamed answer
- **THEN** the client SHALL stop rendering additional streamed content
- **AND** the server SHALL stop emitting further answer-content events for that run

<!-- @trace
source: implement-web-chat-sse-streaming
updated: 2026-04-24
code:
  - docs/runbooks/remote-mcp-connectors.md
  - app/utils/chat-stream.ts
  - server/mcp/tools/ask.ts
  - test/acceptance/workers-ai-accepted-path-samples.ts
  - docs/verify/WORKERS_AI_ACCEPTED_PATH_VERIFICATION.md
  - .npmrc
  - server/utils/mcp-middleware.ts
  - server/api/auth/mcp/token.post.ts
  - app/utils/chart-series.ts
  - .codex/hooks/_codex_hook_wrapper.sh
  - server/db/schema.ts
  - local/reports/notes/main-v0.0.52-word-copy.md
  - server/utils/web-chat.ts
  - app/pages/admin/debug/latency/index.vue
  - shared/types/observability.ts
  - docs/tech-debt.md
  - vitest.config.ts
  - app/components/admin/usage/TimelineChart.vue
  - .github/workflows/ci.yml
  - package.json
  - server/utils/workers-ai.ts
  - server/api/chat.post.ts
  - server/routes/.well-known/oauth-protected-resource/mcp.get.ts
  - local/reports/notes/main-v0.0.52-word-compare.md
  - docs/verify/production-deploy-checklist.md
  - shared/types/chat-stream.ts
  - server/routes/.well-known/oauth-authorization-server.get.ts
  - server/utils/query-log-debug-store.ts
  - HANDOFF.md
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - app/components/debug/OutcomeBreakdown.vue
  - test/acceptance/helpers/bindings.ts
  - server/routes/.well-known/oauth-protected-resource.get.ts
  - docs/verify/WORKERS_AI_BASELINE_REPORTING.md
  - .codex/hooks/post-bash-error-debug.sh
  - server/utils/knowledge-audit.ts
  - server/utils/mcp-ask.ts
  - server/utils/mcp-oauth-metadata.ts
  - server/database/migrations/0011_query_logs_workers_ai_runs.sql
  - app/components/chat/Container.vue
  - server/utils/knowledge-answering.ts
  - .env.example
tests:
  - test/unit/mcp-middleware.test.ts
  - test/unit/admin-usage-timeline-chart.test.ts
  - test/unit/debug-outcome-breakdown.test.ts
  - test/unit/knowledge-audit.test.ts
  - test/unit/chat-container-streaming-contract.test.ts
  - test/unit/web-chat-observability.test.ts
  - test/integration/mcp-oauth-tool-access.test.ts
  - test/integration/mcp-routes.test.ts
  - test/unit/mcp-tool-search.test.ts
  - test/integration/mcp-oauth-metadata-routes.test.ts
  - test/integration/mcp-connector-token-route.test.ts
  - test/unit/chart-series.test.ts
  - test/unit/workers-ai.test.ts
  - test/unit/knowledge-answering.test.ts
  - test/integration/conversation-create.test.ts
  - test/unit/workers-ai-accepted-path-samples.test.ts
  - test/unit/mcp-tool-get-document-chunk.test.ts
  - e2e/td003-contrast.spec.ts
  - test/unit/link-google-for-passkey-first-utils.test.ts
  - test/unit/mcp-tool-ask.test.ts
  - test/unit/mcp-tool-categories.test.ts
  - test/unit/chat-stream.test.ts
  - test/integration/chat-route.test.ts
  - e2e/observability-review.spec.ts
-->

---

### Requirement: Streaming SHALL preserve citation, refusal, and error contracts

The system SHALL preserve the existing Web chat citation, refusal, and error semantics after enabling streaming. Accepted runs SHALL still deliver the citation data required by the Web chat UI, refusal runs SHALL still terminate with a refusal outcome, and error runs SHALL still surface a stable error state.

#### Scenario: Accepted streamed answer completes with citation data

- **WHEN** a streamed accepted run completes successfully
- **THEN** the final streaming outcome SHALL include the citation data required by the Web chat UI
- **AND** the UI SHALL be able to render the completed answer without a separate fallback fetch

#### Scenario: Refusal and error outcomes remain explicit

- **WHEN** a streamed run ends in refusal or error
- **THEN** the stream SHALL terminate with an explicit refusal or error outcome
- **AND** the UI SHALL preserve the corresponding refusal or error behavior instead of hanging in a streaming state

<!-- @trace
source: implement-web-chat-sse-streaming
updated: 2026-04-24
code:
  - docs/runbooks/remote-mcp-connectors.md
  - app/utils/chat-stream.ts
  - server/mcp/tools/ask.ts
  - test/acceptance/workers-ai-accepted-path-samples.ts
  - docs/verify/WORKERS_AI_ACCEPTED_PATH_VERIFICATION.md
  - .npmrc
  - server/utils/mcp-middleware.ts
  - server/api/auth/mcp/token.post.ts
  - app/utils/chart-series.ts
  - .codex/hooks/_codex_hook_wrapper.sh
  - server/db/schema.ts
  - local/reports/notes/main-v0.0.52-word-copy.md
  - server/utils/web-chat.ts
  - app/pages/admin/debug/latency/index.vue
  - shared/types/observability.ts
  - docs/tech-debt.md
  - vitest.config.ts
  - app/components/admin/usage/TimelineChart.vue
  - .github/workflows/ci.yml
  - package.json
  - server/utils/workers-ai.ts
  - server/api/chat.post.ts
  - server/routes/.well-known/oauth-protected-resource/mcp.get.ts
  - local/reports/notes/main-v0.0.52-word-compare.md
  - docs/verify/production-deploy-checklist.md
  - shared/types/chat-stream.ts
  - server/routes/.well-known/oauth-authorization-server.get.ts
  - server/utils/query-log-debug-store.ts
  - HANDOFF.md
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - app/components/debug/OutcomeBreakdown.vue
  - test/acceptance/helpers/bindings.ts
  - server/routes/.well-known/oauth-protected-resource.get.ts
  - docs/verify/WORKERS_AI_BASELINE_REPORTING.md
  - .codex/hooks/post-bash-error-debug.sh
  - server/utils/knowledge-audit.ts
  - server/utils/mcp-ask.ts
  - server/utils/mcp-oauth-metadata.ts
  - server/database/migrations/0011_query_logs_workers_ai_runs.sql
  - app/components/chat/Container.vue
  - server/utils/knowledge-answering.ts
  - .env.example
tests:
  - test/unit/mcp-middleware.test.ts
  - test/unit/admin-usage-timeline-chart.test.ts
  - test/unit/debug-outcome-breakdown.test.ts
  - test/unit/knowledge-audit.test.ts
  - test/unit/chat-container-streaming-contract.test.ts
  - test/unit/web-chat-observability.test.ts
  - test/integration/mcp-oauth-tool-access.test.ts
  - test/integration/mcp-routes.test.ts
  - test/unit/mcp-tool-search.test.ts
  - test/integration/mcp-oauth-metadata-routes.test.ts
  - test/integration/mcp-connector-token-route.test.ts
  - test/unit/chart-series.test.ts
  - test/unit/workers-ai.test.ts
  - test/unit/knowledge-answering.test.ts
  - test/integration/conversation-create.test.ts
  - test/unit/workers-ai-accepted-path-samples.test.ts
  - test/unit/mcp-tool-get-document-chunk.test.ts
  - e2e/td003-contrast.spec.ts
  - test/unit/link-google-for-passkey-first-utils.test.ts
  - test/unit/mcp-tool-ask.test.ts
  - test/unit/mcp-tool-categories.test.ts
  - test/unit/chat-stream.test.ts
  - test/integration/chat-route.test.ts
  - e2e/observability-review.spec.ts
-->
