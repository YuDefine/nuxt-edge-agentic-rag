## 1. Web chat UI persisted conversation flow

- [x] [P] 1.1 Persisted Conversation Session Continuity: wire the active conversation state so the first question creates a persisted conversation and follow-up questions reuse the same `conversationId`.
- [x] [P] 1.2 Persisted Conversation History Interaction: connect the history UI to `/api/conversations` for list, selection, message load, and delete behavior.

## 2. Conversation governance alignment

- [x] [P] 2.1 User-Facing Conversation Reads Respect Purged Content Boundaries: ensure history reload, detail reads, and delete eviction never restore deleted conversation content through normal Web flows.
- [x] [P] 2.2 Persisted Follow-Up Uses The Active Conversation Identity: make stale-follow-up evaluation and same-thread continuation depend on the persisted active `conversationId`.

## 3. Verification and evidence

- [x] [P] 3.1 Persisted Web Chat Flow Coverage: add automated coverage for create, reload, history selection, follow-up reuse, and delete eviction.
- [x] [P] 3.2 Report-Ready Persistence Evidence Export: export report-facing evidence that links the create, reload, select, follow-up, and delete checkpoints to captured runs.

## 4. Report synchronization

- [x] [P] 4.1 Current Report Reflects Shipped Web Chat Persistence Behavior: update `local/reports/latest.md` to remove contradictory statements that still describe the feature as unsupported, single-round only, or deferred.
- [x] 4.2 Sync the report narrative and cited evidence so the current report claims only shipped and verified Web chat persistence behavior.
