# web-agentic-answering Specification

## Purpose

TBD - created by archiving change 'bootstrap-v1-core-from-report'. Update Purpose after archive.

## Requirements

### Requirement: Verified Current Evidence Retrieval

The Web answer flow SHALL run rule-based Query Normalization without model invocation, apply AI Search retrieval filters for `status = active` and `access_level in allowed_access_levels`, optionally include `version_state = current` only as a fast filter, and validate every candidate with D1 `active/indexed/current` checks before the evidence becomes eligible for answer generation.

#### Scenario: Candidate fails current-version verification

- **WHEN** AI Search returns a candidate whose `document_version_id` no longer maps to an `active`, `indexed`, and `is_current = true` version in D1
- **THEN** the system discards that candidate as invalid evidence
- **AND** the candidate does not contribute to scoring, citations, or the final answer

#### Scenario: Query normalization stays rule-based

- **WHEN** a Web question reaches the normalization step
- **THEN** the system only applies deterministic normalization for whitespace, synonyms, abbreviations, dates, or category hints
- **AND** no model call is made before the first retrieval

---

### Requirement: Confidence Routed Answering

The system SHALL compute `retrieval_score` from validated evidence, route requests with `retrieval_score >= 0.70` directly to the answer model selected by question type, invoke one answerability judge when `0.45 <= retrieval_score < 0.70`, and perform at most one Query Reformulation retry with `rewrite_query = false`. If confidence stays below the refusal threshold or the required evidence count is not met, the system SHALL return a refusal response. The system SHALL NOT enable cloud fallback in `v1.0.0`.

#### Scenario: High-confidence question bypasses judge

- **WHEN** the validated evidence produces `retrieval_score >= 0.70`
- **THEN** the system skips answerability judge
- **AND** the request is answered through the model role selected for that question type

#### Scenario: Low-confidence question reformulates once and refuses if still weak

- **WHEN** a request falls below the answer threshold and satisfies the retry conditions
- **THEN** the system performs one Query Reformulation retry with AI Search `rewrite_query = false`
- **AND** the system returns a refusal response if the post-retry confidence still remains below the acceptance threshold

---

### Requirement: Citation Mapped Responses

The system SHALL assemble citations only from prebuilt `source_chunks`, SHALL treat unmapped provider candidates as invalid evidence, SHALL persist `citation_records` for cited chunks, and SHALL preserve the Web single-document follow-up fast path only when the previous assistant response can still be revalidated to one current document.

#### Scenario: Unmapped retrieval candidate cannot become a citation

- **WHEN** a retrieval candidate cannot be matched to an existing `source_chunks` row for the validated version
- **THEN** the candidate is excluded from the final answer
- **AND** the response does not emit a citation for that candidate

#### Scenario: Follow-up loses the single-document fast path

- **WHEN** the previous assistant response no longer revalidates to one current document
- **THEN** the next Web follow-up is reclassified as ambiguous or cross-document
- **AND** the system does not reuse the single-document follow-up route

---

### Requirement: Neutral Project Shell

Before the full product experience is complete, the Web shell SHALL remain a neutral knowledge-project frame aligned with the report scope. The authenticated landing page and shared layout SHALL NOT use generic starter welcome copy, SHALL NOT imply a finished vertical product, and SHALL keep role context and sign-out affordances without overstating delivered capabilities.

#### Scenario: Authenticated landing stays neutral

- **WHEN** an authenticated user lands on the root page before later feature surfaces are filled in
- **THEN** the page presents a neutral project shell with current user context
- **AND** the page does not use generic starter welcome messaging or vendor-specific claims

#### Scenario: Shared layout avoids misleading product framing

- **WHEN** the default application layout renders navigation or footer copy
- **THEN** the copy stays consistent with a `v1.0.0` knowledge-project shell
- **AND** the layout does not imply the repo is already a fully delivered end-user product

---

### Requirement: Refusal Message Persistence

The Web chat orchestration SHALL persist an assistant `messages` row for every refusal outcome that the `/api/chat` pipeline produces. Refusal outcomes include the audit-blocked path (pre-pipeline rejection by content audit), the pipeline refusal path (the answering pipeline returns `refused === true` for any reason such as low retrieval coverage or judge rejection), and the pipeline error path (the answering pipeline throws after work has begun on the user turn). The persisted assistant row SHALL store `role = 'assistant'`, `content = '抱歉，我無法回答這個問題。'`, `refused = 1`, and `refusal_reason` populated with the matching `RefusalReason` value (`'restricted_scope'` for audit-block, the pipeline telemetry's `refusalReason` for pipeline refusal, and `'pipeline_error'` for pipeline error). The persisted row SHALL be linked to the same `conversation_id` as the matching user message and the same `query_log_id` when one exists. The accepted-answer path SHALL persist the assistant row with `refused = 0`, `refusal_reason = NULL`, and the produced answer content. The orchestration MUST NOT skip writing the assistant row solely because the outcome was a refusal.

#### Scenario: Audit-blocked query writes a refusal assistant message

- **WHEN** a signed-in user submits a query that the content audit blocks before the answering pipeline runs
- **THEN** the orchestration writes the user message to `messages`
- **AND** writes an assistant message with `content = '抱歉，我無法回答這個問題。'`, `refused = 1`, and `refusal_reason = 'restricted_scope'`
- **AND** the assistant message references the same `conversation_id` as the user message
- **AND** the existing `query_log` row for the blocked attempt records `status = 'blocked'` and `refusal_reason = 'restricted_scope'`

#### Scenario: Pipeline refusal writes a refusal assistant message

- **WHEN** the answering pipeline completes with `result.refused = true` (for example because retrieval coverage was insufficient or the judge rejected the candidate answer)
- **THEN** the orchestration writes an assistant message with `content = '抱歉，我無法回答這個問題。'`, `refused = 1`, and `refusal_reason` set to the pipeline telemetry's `refusalReason` (typically `'no_citation'` or `'low_confidence'`)
- **AND** the assistant message is linked to the active `conversation_id` and the active `query_log_id`

#### Scenario: Pipeline error writes a refusal assistant message

- **WHEN** the answering pipeline throws after the user message has been written
- **THEN** the orchestration writes an assistant message with `content = '抱歉，我無法回答這個問題。'`, `refused = 1`, and `refusal_reason = 'pipeline_error'`
- **AND** the related `query_log` row is updated with `decision_path = 'pipeline_error'` and `refusal_reason = 'pipeline_error'`

#### Scenario: Accepted answer persists with refused = 0

- **WHEN** the answering pipeline completes with `result.refused = false` and a non-null answer
- **THEN** the orchestration writes the assistant message with the produced answer content, `refused = 0`, and `refusal_reason = NULL`
- **AND** writes any associated `citationsJson` for replay

##### Example: persistence outcomes by path

| Pipeline outcome                               | messages.role | messages.refused | messages.refusal_reason                                    | messages.content             | citationsJson populated |
| ---------------------------------------------- | ------------- | ---------------- | ---------------------------------------------------------- | ---------------------------- | ----------------------- |
| audit-blocked (PII / restricted scope)         | assistant     | 1                | 'restricted_scope'                                         | '抱歉，我無法回答這個問題。' | no                      |
| pipeline refusal (low coverage / judge reject) | assistant     | 1                | telemetry.refusalReason ('no_citation' / 'low_confidence') | '抱歉，我無法回答這個問題。' | no                      |
| pipeline error (exception after user write)    | assistant     | 1                | 'pipeline_error'                                           | '抱歉，我無法回答這個問題。' | no                      |
| accepted answer                                | assistant     | 0                | NULL                                                       | produced answer text         | yes                     |

<!-- @trace
source: persist-refusal-and-label-new-chat
updated: 2026-04-26
code:
  - server/utils/conversation-store.ts
  - app/components/chat/MarkdownContent.vue
  - server/utils/conversation-title.ts
  - server/database/migrations/0014_messages_refusal_reason.sql
  - app/components/chat/RefusalMessage.vue
  - server/utils/chat-sse-response.ts
  - nuxt.config.ts
  - local/reports/archive/main-v0.0.54-working.md
  - server/db/schema.ts
  - docs/tech-debt.md
  - app/utils/chat-stream.ts
  - server/api/chat.post.ts
  - server/utils/web-chat.ts
  - shared/types/chat-stream.ts
  - app/utils/chat-conversation-state.ts
  - app/components/chat/MessageList.vue
  - app/types/chat.ts
  - local/excalidraw-diagram-workbench
  - app/components/chat/StreamingMessage.vue
  - local/reports/archive/carbon.png
  - HANDOFF.md
  - server/utils/mcp-ask.ts
  - local/reports/archive/main-v0.0.54-draft.md
  - server/utils/knowledge-audit.ts
  - package.json
tests:
  - test/unit/chat-markdown-content.test.ts
  - test/unit/chat-stream.test.ts
  - test/unit/refusal-message.test.ts
  - test/integration/web-chat-persistence.test.ts
  - test/integration/web-chat-audit-block-title.test.ts
  - test/integration/conversation-messages-refused.test.ts
  - test/unit/chat-conversation-state.test.ts
  - test/unit/knowledge-audit.test.ts
  - test/integration/messages-refusal-reason-migration.test.ts
  - test/unit/web-chat.test.ts
-->

---

### Requirement: Audit-Blocked Conversation Title Fallback

When the content audit blocks a query before the answering pipeline runs, the Web chat handler SHALL NOT use the audit's `redactedText` (which contains an internal redaction marker such as `[BLOCKED:credential]`) as the source for the new conversation's `title`. The handler SHALL instead persist a fixed Traditional Chinese fallback title (for example `'無法處理的提問'`) so that the sidebar conversation list never surfaces internal markers to end users.

#### Scenario: Audit-blocked path uses semantic Chinese fallback for conversation title

- **WHEN** a signed-in user submits a credential-bearing query (`api_key=...`) that the content audit blocks
- **AND** the orchestration creates a new conversation for that turn
- **THEN** the conversation `title` MUST NOT contain `'[BLOCKED'` or any other audit redaction marker
- **AND** the conversation `title` SHALL be a fixed semantic Traditional Chinese string (for example `'無法處理的提問'`)

#### Scenario: Non-blocked queries keep deriving title from the user query

- **WHEN** a signed-in user submits a non-blocked query that creates a new conversation
- **THEN** the conversation `title` SHALL still derive from the first 40 characters of the redacted query, preserving the existing behaviour for normal queries

<!-- @trace
source: persist-refusal-and-label-new-chat
updated: 2026-04-26
code:
  - server/utils/conversation-store.ts
  - app/components/chat/MarkdownContent.vue
  - server/utils/conversation-title.ts
  - server/database/migrations/0014_messages_refusal_reason.sql
  - app/components/chat/RefusalMessage.vue
  - server/utils/chat-sse-response.ts
  - nuxt.config.ts
  - local/reports/archive/main-v0.0.54-working.md
  - server/db/schema.ts
  - docs/tech-debt.md
  - app/utils/chat-stream.ts
  - server/api/chat.post.ts
  - server/utils/web-chat.ts
  - shared/types/chat-stream.ts
  - app/utils/chat-conversation-state.ts
  - app/components/chat/MessageList.vue
  - app/types/chat.ts
  - local/excalidraw-diagram-workbench
  - app/components/chat/StreamingMessage.vue
  - local/reports/archive/carbon.png
  - HANDOFF.md
  - server/utils/mcp-ask.ts
  - local/reports/archive/main-v0.0.54-draft.md
  - server/utils/knowledge-audit.ts
  - package.json
tests:
  - test/unit/chat-markdown-content.test.ts
  - test/unit/chat-stream.test.ts
  - test/unit/refusal-message.test.ts
  - test/integration/web-chat-persistence.test.ts
  - test/integration/web-chat-audit-block-title.test.ts
  - test/integration/conversation-messages-refused.test.ts
  - test/unit/chat-conversation-state.test.ts
  - test/unit/knowledge-audit.test.ts
  - test/integration/messages-refusal-reason-migration.test.ts
  - test/unit/web-chat.test.ts
-->
