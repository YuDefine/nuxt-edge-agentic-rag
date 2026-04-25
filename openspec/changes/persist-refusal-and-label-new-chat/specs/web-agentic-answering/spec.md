## ADDED Requirements

### Requirement: Refusal Message Persistence

The Web chat orchestration SHALL persist an assistant `messages` row for every refusal outcome that the `/api/chat` pipeline produces. Refusal outcomes include the audit-blocked path (pre-pipeline rejection by content audit), the pipeline refusal path (the answering pipeline returns `refused === true` for any reason such as low retrieval coverage or judge rejection), and the pipeline error path (the answering pipeline throws after work has begun on the user turn). The persisted assistant row SHALL store `role = 'assistant'`, `content = '抱歉，我無法回答這個問題。'`, and `refused = 1`. The persisted row SHALL be linked to the same `conversation_id` as the matching user message and the same `query_log_id` when one exists. The accepted-answer path SHALL persist the assistant row with `refused = 0` and the produced answer content. The orchestration MUST NOT skip writing the assistant row solely because the outcome was a refusal.

#### Scenario: Audit-blocked query writes a refusal assistant message

- **WHEN** a signed-in user submits a query that the content audit blocks before the answering pipeline runs
- **THEN** the orchestration writes the user message to `messages`
- **AND** writes an assistant message with `content = '抱歉，我無法回答這個問題。'` and `refused = 1`
- **AND** the assistant message references the same `conversation_id` as the user message
- **AND** the existing `query_log` row for the blocked attempt records `status = 'blocked'` and `refusal_reason = 'restricted_scope'`

#### Scenario: Pipeline refusal writes a refusal assistant message

- **WHEN** the answering pipeline completes with `result.refused = true` (for example because retrieval coverage was insufficient or the judge rejected the candidate answer)
- **THEN** the orchestration writes an assistant message with `content = '抱歉，我無法回答這個問題。'` and `refused = 1`
- **AND** the assistant message is linked to the active `conversation_id` and the active `query_log_id`

#### Scenario: Pipeline error writes a refusal assistant message

- **WHEN** the answering pipeline throws after the user message has been written
- **THEN** the orchestration writes an assistant message with `content = '抱歉，我無法回答這個問題。'` and `refused = 1`
- **AND** the related `query_log` row is updated with `decision_path = 'pipeline_error'` and `refusal_reason = 'pipeline_error'`

#### Scenario: Accepted answer persists with refused = 0

- **WHEN** the answering pipeline completes with `result.refused = false` and a non-null answer
- **THEN** the orchestration writes the assistant message with the produced answer content and `refused = 0`
- **AND** writes any associated `citationsJson` for replay

##### Example: persistence outcomes by path

| Pipeline outcome                               | messages.role | messages.refused | messages.content             | citationsJson populated |
| ---------------------------------------------- | ------------- | ---------------- | ---------------------------- | ----------------------- |
| audit-blocked (PII / restricted scope)         | assistant     | 1                | '抱歉，我無法回答這個問題。' | no                      |
| pipeline refusal (low coverage / judge reject) | assistant     | 1                | '抱歉，我無法回答這個問題。' | no                      |
| pipeline error (exception after user write)    | assistant     | 1                | '抱歉，我無法回答這個問題。' | no                      |
| accepted answer                                | assistant     | 0                | produced answer text         | yes                     |
