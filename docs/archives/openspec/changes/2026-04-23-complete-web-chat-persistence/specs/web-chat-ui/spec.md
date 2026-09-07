## ADDED Requirements

### Requirement: Persisted Conversation Session Continuity

The Web chat UI SHALL treat the persisted `conversations/messages` store as the source of truth for conversation identity and message history. A first question without an existing conversation selection SHALL create a new persisted conversation, subsequent questions in the same active thread SHALL reuse that `conversationId`, and a page reload SHALL restore the visible conversation history from the server rather than from client-only memory.

#### Scenario: First question creates a persisted conversation

- **WHEN** a signed-in user submits a question without an active conversation selected
- **THEN** the UI creates a new persisted conversation through the existing chat flow
- **AND** the response state stores the returned `conversationId` as the active thread for follow-up questions

#### Scenario: Reload restores persisted history

- **WHEN** a signed-in user reloads the chat page after sending one or more questions
- **THEN** the UI reloads the user's visible conversations from the server
- **AND** opening the active conversation shows the persisted messages and citations instead of an empty client-only session

#### Scenario: Follow-up question reuses the active conversation

- **WHEN** a signed-in user submits a second question while a persisted conversation is active
- **THEN** the UI sends that same `conversationId` with the request
- **AND** the resulting user and assistant messages are appended to the same persisted conversation

---

### Requirement: Persisted Conversation History Interaction

The Web chat UI SHALL provide a server-backed history interaction model for persisted conversations. The history list SHALL load from the conversation APIs, selecting an item SHALL replace the visible message pane with that conversation's persisted messages, and deleting an item SHALL immediately remove it from the visible history.

#### Scenario: Selecting a conversation loads persisted messages

- **WHEN** a signed-in user selects a conversation from the history list
- **THEN** the UI fetches that conversation's persisted messages from the server
- **AND** the message pane renders the returned messages and citations for that conversation only

#### Scenario: Deleting a conversation evicts it from the UI

- **WHEN** a signed-in user deletes a conversation from the history UI
- **THEN** the UI removes that conversation from the history list without requiring a full page refresh
- **AND** the message pane no longer displays the deleted conversation's persisted messages
