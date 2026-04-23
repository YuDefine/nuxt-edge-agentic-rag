## ADDED Requirements

### Requirement: Persisted Web Chat Flow Coverage

Automated verification SHALL cover the shipped Web conversation persistence flow end to end. The evidence set SHALL prove that a conversation can be created, reloaded, selected from history, continued with the same `conversationId`, and deleted without restoring purged content.

#### Scenario: Automation proves persisted conversation continuity

- **WHEN** the persisted Web chat acceptance suite runs
- **THEN** it verifies that an initial question creates a persisted conversation
- **AND** it verifies that a subsequent question in the same thread reuses that `conversationId`
- **AND** it fails if the flow falls back to client-only message memory

#### Scenario: Automation proves history reload and selection

- **WHEN** the persisted Web chat acceptance suite reloads the chat page and reopens a saved conversation
- **THEN** it verifies that the history list and message pane are reconstructed from server state
- **AND** it fails if the restored conversation omits persisted messages or citations

#### Scenario: Automation proves delete eviction

- **WHEN** the persisted Web chat acceptance suite deletes a conversation
- **THEN** it verifies that the conversation disappears from visible history and detail reads
- **AND** it fails if deleted content can still be reopened through normal user-facing flows

---

### Requirement: Report-Ready Persistence Evidence Export

Evidence generated for the report SHALL include stable references to the persisted Web chat flow so the current report can claim the feature as shipped and verified. The exported evidence SHALL identify the create, reload, select, and delete checkpoints it proves.

#### Scenario: Persistence evidence export names the proven checkpoints

- **WHEN** report evidence is generated for the Web chat persistence flow
- **THEN** the export identifies the create, reload, select, follow-up, and delete checkpoints it covers
- **AND** each checkpoint links to the corresponding automated run result or captured evidence payload
