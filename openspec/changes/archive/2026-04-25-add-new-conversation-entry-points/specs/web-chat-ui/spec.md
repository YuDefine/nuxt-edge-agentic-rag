## ADDED Requirements

### Requirement: Explicit New Conversation Entry Points

The Web chat UI SHALL provide explicit user-visible entry points to start a new conversation. The chat main column header SHALL render a "new conversation" button. The conversation history sidebar SHALL render a "new conversation" button in its expanded header alongside the "對話記錄" title. The conversation history sidebar's collapsed-rail plus icon SHALL emit a new-conversation request rather than expanding the sidebar. Activating any of these buttons SHALL clear the active conversation state, remove the corresponding `web-chat:active-conversation:${userId}` sessionStorage key, and close the off-canvas history drawer when open. The buttons SHALL be disabled while a conversation interaction is in flight (mirroring the existing `conversationInteractionLocked` state).

#### Scenario: User starts a new conversation from the chat header

- **WHEN** a signed-in user with an active conversation A clicks the new-conversation button in the chat main column header
- **THEN** the message pane clears to an empty state
- **AND** the active conversation id becomes null
- **AND** the conversation history sidebar no longer highlights conversation A
- **AND** the `web-chat:active-conversation:${userId}` sessionStorage key is removed

#### Scenario: User starts a new conversation from the sidebar expanded header

- **WHEN** a signed-in user clicks the new-conversation button in the conversation history sidebar's expanded header
- **THEN** the same state reset occurs as the chat header button (message pane cleared, active id null, sessionStorage key removed)

#### Scenario: User starts a new conversation from the collapsed rail plus icon

- **WHEN** a signed-in user clicks the plus icon in the conversation history sidebar's collapsed rail
- **THEN** the UI emits a new-conversation request that resets active conversation state instead of merely expanding the sidebar

#### Scenario: New conversation closes the off-canvas history drawer

- **WHEN** a signed-in user on a viewport below the `lg` breakpoint has the conversation history drawer open and clicks any new-conversation button
- **THEN** the active conversation state resets
- **AND** the off-canvas history drawer closes so the chat main column becomes visible

#### Scenario: New conversation buttons are disabled during in-flight interaction

- **WHEN** a signed-in user is currently streaming a response or otherwise has `conversationInteractionLocked = true`
- **THEN** all new-conversation buttons render in a disabled state and ignore activation

#### Scenario: SessionStorage unavailability does not block the action

- **WHEN** a signed-in user clicks a new-conversation button in a browser context where sessionStorage is unavailable (Safari private mode, quota exceeded, DOM Storage disabled)
- **THEN** the active conversation state still resets
- **AND** the sessionStorage clear attempt fails silently without surfacing an error toast or interrupting the UI flow

## MODIFIED Requirements

### Requirement: Persisted Conversation Session Continuity

The Web chat UI SHALL treat the persisted `conversations/messages` store as the source of truth for conversation identity and message history. A first question without an existing conversation selection SHALL create a new persisted conversation, subsequent questions in the same active thread SHALL reuse that `conversationId`, and a page reload SHALL restore the visible conversation history from the server rather than from client-only memory. Reload-time auto-restoration of a previously active conversation SHALL be governed by the `web-chat:active-conversation:${userId}` sessionStorage key: when the key is present and points to a conversation that is still visible in the user's history, the UI SHALL restore that conversation; when the key is absent (including after the user has explicitly started a new conversation), the UI SHALL render the empty new-conversation state instead of auto-restoring any prior conversation.

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

#### Scenario: Reload after explicit new conversation does not auto-restore

- **WHEN** a signed-in user clicks any new-conversation button (which removes the `web-chat:active-conversation:${userId}` sessionStorage key) and then reloads the page without sending any message
- **THEN** the UI loads the user's visible conversations from the server
- **AND** the chat main column renders the empty new-conversation state without auto-restoring any prior conversation

#### Scenario: Reload without explicit opt-out auto-restores prior conversation

- **WHEN** a signed-in user has an active conversation A persisted in sessionStorage and reloads the page without clicking any new-conversation button
- **THEN** the UI auto-restores conversation A's persisted messages so heavy users return to where they left off
