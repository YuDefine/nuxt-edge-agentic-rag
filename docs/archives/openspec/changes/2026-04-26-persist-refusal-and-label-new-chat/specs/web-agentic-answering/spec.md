## ADDED Requirements

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
