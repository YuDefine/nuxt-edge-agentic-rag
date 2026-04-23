## ADDED Requirements

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

---

### Requirement: Persisted Follow-Up Uses The Active Conversation Identity

A Web follow-up request that continues an existing conversation SHALL use the persisted active `conversationId` as its thread boundary. The system SHALL evaluate stale-citation rules against that persisted conversation before treating the request as a same-thread follow-up.

#### Scenario: Active persisted conversation drives stale follow-up evaluation

- **WHEN** a user asks a follow-up question inside an active persisted conversation
- **THEN** the system evaluates stale-document rules against the latest persisted assistant message in that conversation
- **AND** the resulting answer either stays in the same thread or forces fresh retrieval according to the persisted conversation state
