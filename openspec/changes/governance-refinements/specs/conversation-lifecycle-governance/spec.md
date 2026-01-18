## ADDED Requirements

### Requirement: Deleted Conversation Content Purge

When a user deletes a conversation, the system SHALL immediately remove that conversation from user-visible lists, detail APIs, and future model context assembly. The system SHALL clear, hard-delete, or otherwise render `conversations.title` and `messages.content_text` irrecoverable for normal user access while preserving only audit-safe residue.

#### Scenario: Deleted conversation disappears from user surfaces

- **WHEN** a user deletes a conversation
- **THEN** subsequent list and detail reads do not return that conversation
- **AND** future follow-up requests do not use its messages as model context

#### Scenario: Audit residue never restores original content

- **WHEN** a deleted conversation still has retained audit metadata inside the retention window
- **THEN** only redacted or marker-only data remains available to audit paths
- **AND** normal user paths cannot recover the original title or raw message content

### Requirement: Stale Follow-Up Revalidation

The system SHALL dynamically re-evaluate whether the latest cited document version in a Web conversation is still current before treating the conversation as a same-document follow-up. If the cited version is no longer current, the conversation SHALL be treated as stale and the next answer SHALL rely on fresh retrieval instead of blindly continuing the previous context.

#### Scenario: Current version change marks a conversation stale

- **WHEN** the latest persisted assistant message cites a document version that is no longer current
- **THEN** the next Web follow-up is evaluated as stale
- **AND** answer generation uses fresh retrieval rather than the stale citation chain as truth

#### Scenario: Same-document follow-up survives only while current remains valid

- **WHEN** the latest cited document version is still current and the conversation has not been deleted
- **THEN** the system may keep the same-document follow-up fast path
- **AND** the resulting answer still uses current authorization and retrieval validation
