# web-chat-ui Specification

## Purpose

TBD - created by archiving change 'add-v1-core-ui'. Update Purpose after archive.

## Requirements

### Requirement: Chat Page Access And Navigation

The system SHALL serve the chat UI at the root path `/`. Access to `/` SHALL require authentication; unauthenticated visitors SHALL be redirected to `/auth/login` by the global authentication middleware, with their intended destination preserved via the `redirect` query parameter per the `auth-redirect` capability (omitted when the origin path is `/` itself). The legacy route `/chat` SHALL continue to redirect to `/` for backward compatibility. Authenticated users SHALL see only the navigation entries their current permissions allow. Chat access SHALL be conditionally enabled, disabled with explanation, or redirected, according to the combination of `users.role` and the current `guest_policy` system setting.

#### Scenario: Authenticated member accesses chat at root

- **WHEN** a user with `role = 'member'` or `role = 'admin'` navigates to `/`
- **THEN** the chat interface renders with full question submission capability
- **AND** the page does not display any login UI

#### Scenario: Unauthenticated user is redirected to login with origin preserved

- **WHEN** an unauthenticated user navigates to `/account/settings`
- **THEN** the global middleware redirects to `/auth/login?redirect=%2Faccount%2Fsettings`
- **AND** after successful login the user lands back on `/account/settings`

#### Scenario: Unauthenticated user visiting root redirects without redirect query

- **WHEN** an unauthenticated user navigates to `/`
- **THEN** the global middleware redirects to `/auth/login` without any query parameters

#### Scenario: Legacy chat route redirects to root

- **WHEN** any user navigates to `/chat`
- **THEN** the page redirects to `/` with `replace: true`
- **AND** authentication rules at `/` apply normally

#### Scenario: Guest under same_as_member policy uses chat normally

- **WHEN** a user with `role = 'guest'` visits `/` and the active `guest_policy = 'same_as_member'`
- **THEN** the chat interface behaves identically to the member experience

#### Scenario: Guest under browse_only policy sees disabled input with banner

- **WHEN** a user with `role = 'guest'` visits `/` and the active `guest_policy = 'browse_only'`
- **THEN** the chat interface renders with the message input disabled
- **AND** a banner explains that guests are in browse-only mode and links to the public document catalog

#### Scenario: Guest under no_access policy is redirected to account-pending

- **WHEN** a user with `role = 'guest'` visits `/` and the active `guest_policy = 'no_access'`
- **THEN** the app redirects to `/account-pending`
- **AND** the account-pending page explains how to contact an admin

#### Scenario: Root page does not trigger conversation history fetch before authentication

- **WHEN** an unauthenticated user attempts to render `/`
- **THEN** the global middleware intercepts before any client-side chat history fetch executes
- **AND** no request is made to `/api/conversations`

<!-- @trace
source: auth-redirect-refactor
updated: 2026-04-24
code:
  - docs/solutions/mcp-streamable-http-405-stateless.md
  - server/utils/mcp-agents-compat.ts
tests:
  - test/unit/mcp-agents-compat.spec.ts
  - test/integration/mcp-streamable-http.spec.ts
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
  - HANDOFF.md
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
  - HANDOFF.md
-->

---

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

<!-- @trace
source: add-new-conversation-entry-points
updated: 2026-04-25
code:
  - scripts/probe-mcp-sse-mock-client.sh
  - server/durable-objects/mcp-session.ts
  - server/database/migrations/0012_fk_rebuild_user_references.sql
  - scripts/mcp/staging-sse-acceptance.mts
  - server/auth.config.ts
  - wrangler.jsonc
  - nuxt.config.ts
  - HANDOFF.md
  - server/utils/mcp-rehydrate-request-body.ts
  - local/reports/archive/main-v0.0.53.md
  - local/reports/archive/main-v0.0.54-draft.docx
  - docs/tech-debt.md
  - local/reports/archive/main-v0.0.54-draft.md
  - package.json
  - server/utils/user-profile-sync.ts
  - docs/decisions/2026-04-25-user-profiles-app-level-migrate.md
tests:
  - test/unit/auth-user-profiles-sync.spec.ts
  - test/unit/mcp-rehydrate-request-body.test.ts
  - test/integration/passkey-first-link-google.spec.ts
  - test/unit/oauth-callback.spec.ts
  - e2e/new-conversation-button.spec.ts
  - test/integration/mcp-session-sse.spec.ts
  - e2e/new-conversation-entrypoints-screenshots.spec.ts
-->

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

<!-- @trace
source: complete-web-chat-persistence
updated: 2026-04-23
code:
  - reports/archive/main-v0.0.27.md
  - .agents/skills/spectra-discuss/SKILL.md
  - reports/archive/main-v0.0.36.md
  - reports/archive/main-v0.0.13.md
  - .agents/skills/spectra-debug/SKILL.md
  - tooling/__init__.py
  - references/yuntech/專題報告編排規範1141216.pdf
  - tooling/scripts/__init__.py
  - reports/archive/main-v0.0.35.md
  - reports/archive/main-v0.0.37.docx
  - scripts/spectra-ux/design-gate.sh
  - tooling/scripts/legacy/transform_v36.py
  - reports/archive/main-v0.0.11.docx
  - tooling/scripts/docx_diff.py
  - reports/archive/main-v0.0.37.md
  - package.json
  - reports/archive/main-v0.0.21.md
  - reports/archive/main-v0.0.12.md
  - scripts/spectra-ux/roadmap-sync.mts
  - README.md
  - tooling/scripts/clone_section.py
  - tooling/scripts/docx_rebuild_content.py
  - docs/verify/index.md
  - .agents/skills/spectra-propose/SKILL.md
  - reports/archive/main-v0.0.20.md
  - spectra-ux.config.json
  - app/components/chat/Container.vue
  - tooling/scripts/docx_sections.py
  - reports/archive/main-v0.0.29.md
  - reports/archive/main-v0.0.32.md
  - reports/notes/diagram.md
  - tooling/scripts/office/__init__.py
  - references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - app/composables/useChatConversationHistory.ts
  - reports/archive/main-v0.0.22.md
  - app/utils/chat-conversation-state.ts
  - reports/archive/main-v0.0.18.md
  - .agents/skills/spectra-audit/SKILL.md
  - docs/verify/evidence/web-chat-persistence.json
  - .agents/skills/spectra-archive/SKILL.md
  - app/composables/useChatConversationSession.ts
  - .agents/skills/spectra-apply/SKILL.md
  - server/api/auth/account/link-google-for-passkey-first/callback.get.ts
  - .agents/skills/spectra-ingest/SKILL.md
  - deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - tooling/scripts/office/pack.py
  - reports/archive/main-v0.0.34.md
  - app/types/chat.ts
  - reports/archive/main-v0.0.25.md
  - tooling/requirements.txt
  - app/pages/account/settings.vue
  - server/utils/link-google-for-passkey-first.ts
  - scripts/spectra-ux/ui-qa-reminder.sh
  - app/components/chat/ConversationHistory.vue
  - app/pages/index.vue
  - docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md
  - app/utils/assert-never.ts
  - reports/archive/main-v0.0.23.md
  - server/api/auth/account/link-google-for-passkey-first/index.get.ts
  - reports/archive/main-v0.0.1.docx
  - reports/archive/main-v0.0.33.md
  - reports/archive/main-v0.0.49.md
  - reports/archive/main-v0.0.11.md
  - reports/archive/main-v0.0.50.md
  - HANDOFF.md
  - templates/海報樣板.pptx
  - .agents/skills/spectra-ask/SKILL.md
  - tooling/scripts/docx_apply.py
  - reports/archive/main-v0.0.48.md
  - tooling/scripts/office/unpack.py
  - playwright.config.ts
  - reports/archive/main-v0.0.30.md
  - reports/archive/main-v0.0.26.md
  - scripts/spectra-ux/collect-followups.mts
  - nuxt.config.ts
  - scripts/spectra-ux/design-inject.sh
  - tooling/scripts/sync_docx_content.py
  - reports/archive/main-v0.0.10.md
  - reports/archive/main-v0.0.11_assets/image1.jpeg
  - reports/archive/main-v0.0.31.md
  - deliverables/defense/答辯準備_口試Q&A.md
  - tooling/scripts/clone_insert_docx.py
  - GEMINI.md
  - reports/archive/main-v0.0.36.docx
  - .agents/skills/spectra-commit/SKILL.md
  - AGENTS.md
  - reports/archive/main-v0.0.19.md
  - reports/archive/main-v0.0.24.md
  - reports/archive/main-v0.0.28.md
  - reports/latest.md
  - reports/archive/main-v0.0.16.md
  - scripts/audit-ux-drift.mts
  - shared/utils/link-google-for-passkey-first.ts
  - reports/archive/main-v0.0.14.md
  - reports/archive/main-v0.0.15.md
  - reports/archive/main-v0.0.17.md
  - tooling/scripts/extract_docx_to_md.py
tests:
  - test/unit/chat-conversation-session.test.ts
  - e2e/chat-persistence.spec.ts
  - test/unit/oauth-callback.spec.ts
  - tooling/tests/test_extract_docx_to_md.py
  - test/unit/chat-conversation-state.test.ts
  - tooling/tests/test_office_pack_unpack.py
  - test/integration/passkey-first-link-google.spec.ts
  - test/unit/better-auth-passkey-hotfix-version.test.ts
  - test/unit/chat-conversation-history.test.ts
  - test/unit/link-google-for-passkey-first-initiator.test.ts
-->

---

### Requirement: Conversation History Bucket Toggle Exposes Expanded State

The conversation history bucket toggle control SHALL expose its current expanded/collapsed state to assistive technologies. The toggle SHALL set `aria-expanded="true"` when the bucket content is visible and `aria-expanded="false"` when collapsed, and the attribute MUST update synchronously with the bucket's open state.

#### Scenario: Screen reader hears state change when user expands a bucket

- **WHEN** an assistive-technology user activates a collapsed bucket toggle in the conversation history sidebar
- **THEN** the toggle's `aria-expanded` attribute transitions from `"false"` to `"true"`
- **AND** the bucket's conversation list becomes reachable in the accessibility tree

#### Scenario: Screen reader hears state change when user collapses a bucket

- **WHEN** an assistive-technology user activates an expanded bucket toggle
- **THEN** the toggle's `aria-expanded` attribute transitions from `"true"` to `"false"`
- **AND** the bucket's conversation list is removed from the accessibility tree

<!-- @trace
source: code-quality-review-followups
updated: 2026-04-24
code:
  - app/pages/auth/login.vue
  - app/pages/auth/callback.vue
  - app/middleware/auth.global.ts
  - app/utils/auth-return-to.ts
  - app/middleware/admin.ts
  - app/pages/index.vue
tests:
  - test/integration/auth-redirect-flow.spec.ts
-->

---

### Requirement: Conversation History Time Buckets Recompute Across Midnight

The conversation history time-bucket grouping (Today / Yesterday / This Week / Earlier) SHALL recompute when the local wall-clock date advances past midnight, without requiring an explicit refetch of the conversation list. The UI SHALL NOT rely solely on the timestamp captured when the page was mounted.

#### Scenario: Conversation that was Today becomes Yesterday after midnight passes

- **GIVEN** the conversation history sidebar has been open since before midnight
- **AND** a conversation with timestamp equal to yesterday 23:50 local time is currently grouped under "Today"
- **WHEN** the wall-clock crosses midnight while the page remains open
- **THEN** that conversation appears under "Yesterday" without any user-triggered refetch
- **AND** no additional `/api/conversations` GET request is required to trigger the regrouping

<!-- @trace
source: code-quality-review-followups
updated: 2026-04-24
code:
  - app/pages/auth/login.vue
  - app/pages/auth/callback.vue
  - app/middleware/auth.global.ts
  - app/utils/auth-return-to.ts
  - app/middleware/admin.ts
  - app/pages/index.vue
tests:
  - test/integration/auth-redirect-flow.spec.ts
-->

---

### Requirement: Chat Home Page Deduplicates Conversation History Fetch

On the authenticated chat home page, the conversation history data source SHALL be fetched at most once per page entry, regardless of how many UI surfaces (inline sidebar, drawer) consume it. Surfaces sharing the same conversation history SHALL read from a single source instance rather than each triggering their own initial fetch.

#### Scenario: Signed-in user enters home and network tab shows one conversation list fetch

- **WHEN** a signed-in user loads the chat home page for the first time in the session
- **THEN** exactly one `GET /api/conversations` request is issued during the initial render
- **AND** both the inline sidebar (at `lg` breakpoint) and the off-canvas drawer (below `lg`) display the same conversation list when opened

<!-- @trace
source: code-quality-review-followups
updated: 2026-04-24
code:
  - app/pages/auth/login.vue
  - app/pages/auth/callback.vue
  - app/middleware/auth.global.ts
  - app/utils/auth-return-to.ts
  - app/middleware/admin.ts
  - app/pages/index.vue
tests:
  - test/integration/auth-redirect-flow.spec.ts
-->

---

### Requirement: Conversation History Refresh Reconciliation

The chat conversation history refresh flow SHALL reconcile the active selection against the refreshed list in a fixed order, so that every surface consuming the shared history (inline sidebar, off-canvas drawer, or any future surface) produces the same observable behavior. The reconcile order SHALL be: first refresh the list from `/api/conversations`; then, if an active conversation id exists, check whether it is still present in the refreshed list; if absent, fetch conversation detail once via the load endpoint; if that fetch reports `missing`, emit a conversation-cleared notification so the message pane and active session are cleared. The same reconcile sequence SHALL be used whether the history instance is provided by an ancestor or owned locally by a consumer component.

#### Scenario: Active conversation still present after refresh

- **WHEN** the refresh flow completes and the currently selected conversation id appears in the refreshed list
- **THEN** no detail fetch is issued
- **AND** no conversation-cleared notification is emitted

#### Scenario: Active conversation missing after refresh but still loadable

- **WHEN** the refresh flow completes and the currently selected conversation id is absent from the refreshed list
- **AND** the detail fetch for that conversation returns a non-missing result
- **THEN** exactly one detail fetch is issued
- **AND** no conversation-cleared notification is emitted

#### Scenario: Active conversation deleted between refresh and detail fetch

- **WHEN** the refresh flow completes and the currently selected conversation id is absent from the refreshed list
- **AND** the detail fetch for that conversation returns `missing`
- **THEN** a conversation-cleared notification is emitted exactly once
- **AND** the active session is cleared on the consuming surface

#### Scenario: Refresh with no active conversation

- **WHEN** the refresh flow completes and there is no currently selected conversation id
- **THEN** no detail fetch is issued
- **AND** no conversation-cleared notification is emitted

<!-- @trace
source: consolidate-conversation-history-config
updated: 2026-04-25
code:
  - app/pages/index.vue
  - app/components/chat/Container.vue
  - AGENTS.md
  - app/components/chat/ConversationHistory.vue
  - docs/tech-debt.md
  - app/composables/create-chat-conversation-history.ts
  - HANDOFF.md
tests:
  - test/unit/create-chat-conversation-history.spec.ts
-->

---

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

<!-- @trace
source: add-new-conversation-entry-points
updated: 2026-04-25
code:
  - scripts/probe-mcp-sse-mock-client.sh
  - server/durable-objects/mcp-session.ts
  - server/database/migrations/0012_fk_rebuild_user_references.sql
  - scripts/mcp/staging-sse-acceptance.mts
  - server/auth.config.ts
  - wrangler.jsonc
  - nuxt.config.ts
  - HANDOFF.md
  - server/utils/mcp-rehydrate-request-body.ts
  - local/reports/archive/main-v0.0.53.md
  - local/reports/archive/main-v0.0.54-draft.docx
  - docs/tech-debt.md
  - local/reports/archive/main-v0.0.54-draft.md
  - package.json
  - server/utils/user-profile-sync.ts
  - docs/decisions/2026-04-25-user-profiles-app-level-migrate.md
tests:
  - test/unit/auth-user-profiles-sync.spec.ts
  - test/unit/mcp-rehydrate-request-body.test.ts
  - test/integration/passkey-first-link-google.spec.ts
  - test/unit/oauth-callback.spec.ts
  - e2e/new-conversation-button.spec.ts
  - test/integration/mcp-session-sse.spec.ts
  - e2e/new-conversation-entrypoints-screenshots.spec.ts
-->
