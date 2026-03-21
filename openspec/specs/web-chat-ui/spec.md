# web-chat-ui Specification

## Purpose

TBD - created by archiving change 'add-v1-core-ui'. Update Purpose after archive.

## Requirements

### Requirement: Chat Page Access And Navigation

The system SHALL provide a chat page at `/chat` for authenticated Web users and SHALL expose a role-aware navigation entry from the home page. Unauthenticated users SHALL be redirected to login, and authenticated users SHALL see only the entries their current permissions allow.

#### Scenario: Authenticated user enters chat from home

- **WHEN** an authenticated user visits the home page
- **THEN** the page shows an entry to `/chat`
- **AND** navigating there renders the chat interface

#### Scenario: Unauthenticated user is redirected to login

- **WHEN** an unauthenticated user requests `/chat`
- **THEN** the system redirects to the login page
- **AND** preserves the intended destination for the post-login redirect

<!-- @trace
source: add-v1-core-ui
updated: 2026-04-16
code:
  - .agents/commands/doc-sync.md
  - template/HANDOFF.md
-->

---

### Requirement: Persisted Conversation Chat UI

The chat UI SHALL display the current conversation message list, support sending new questions, and surface existing conversation history for the signed-in user. The UI SHALL honor server-provided visibility and stale conversation rules instead of inventing a separate client-only truth source.

#### Scenario: Existing conversation history is visible

- **WHEN** a signed-in user opens `/chat`
- **THEN** the page shows the user's visible conversation history
- **AND** selecting a conversation loads its persisted messages and citations

#### Scenario: Deleted or unauthorized conversations stay hidden

- **WHEN** a conversation has been deleted or is no longer visible under the current permission set
- **THEN** the UI does not list it in history
- **AND** the message pane cannot reopen it via client-side state alone

<!-- @trace
source: add-v1-core-ui
updated: 2026-04-16
code:
  - .agents/commands/doc-sync.md
  - template/HANDOFF.md
-->

---

### Requirement: Streaming Answer And Refusal Display

The system SHALL stream assistant responses in the chat UI, show loading state before the first token, render partial content incrementally, display refusal responses distinctly from successful answers, and treat detected high-risk inputs (credentials and credit card numbers) as refusal-worthy regardless of retrieval outcome.

#### Scenario: Streaming tokens render incrementally

- **WHEN** a user submits a question and the server streams a response
- **THEN** the UI renders partial answer content as it arrives
- **AND** keeps the newest streamed content visible

#### Scenario: Refusal displays without citation markers

- **WHEN** the final assistant response is a refusal
- **THEN** the UI displays refusal styling and explanatory copy
- **AND** does not render citation markers for that refusal message

#### Scenario: Credit card pattern in user input triggers refusal

- **WHEN** a user submits a question whose text matches the credit card number pattern (13-19 consecutive digits with optional separators)
- **THEN** the server SHALL classify the input as high-risk via `auditKnowledgeText` with `shouldBlock=true`
- **AND** the assistant SHALL return a refusal response styled identically to other credential-based refusals (api_key, secret, token)
- **AND** persisted records (`messages.content_redacted`, `query_logs.query_redacted_text`) MUST contain only the masked form (e.g., `[BLOCKED:credential]` or `[REDACTED:credit_card]`), never the raw digits
- **AND** `risk_flags_json` MUST include `'pii_credit_card'`
- **AND** no AI Search retrieval or Workers AI generation calls SHALL be made for the blocked request

<!-- @trace
source: add-v1-core-ui, tc-acceptance-followups
updated: 2026-04-20
code:
  - server/utils/knowledge-audit.ts
  - test/integration/acceptance-tc-15.test.ts
  - test/fixtures/acceptance/seed/cases.json
-->

---

### Requirement: Citation Replay UI

The system SHALL display clickable citation markers for cited answers and SHALL open a replay surface that retrieves the cited chunk through an app-level server wrapper around the citation replay core.

#### Scenario: Citation marker opens replay modal

- **WHEN** a user clicks a citation marker in an assistant message
- **THEN** the UI opens a modal or equivalent replay surface
- **AND** fetches the cited chunk content through the app server surface
- **AND** displays source title, locator metadata when available, and chunk text

#### Scenario: Expired or unavailable citation displays error state

- **WHEN** citation replay fails because the citation is expired or unavailable
- **THEN** the replay surface shows an error state
- **AND** the failure does not break the rest of the conversation UI

<!-- @trace
source: add-v1-core-ui
updated: 2026-04-16
code:
  - .agents/commands/doc-sync.md
  - template/HANDOFF.md
-->
