## ADDED Requirements

### Requirement: Restored Refusal UI On Conversation Reload

The Web chat UI SHALL render the refusal message component for every persisted assistant message whose `refused` flag is true, regardless of whether the user is viewing the live stream or reloading historical conversation content. When a signed-in user opens an existing conversation from the history sidebar, the conversation messages list endpoint SHALL include a boolean `refused` field and a nullable `refusalReason` field (matching `query_logs.refusal_reason` enum values) for each assistant message, and the front-end mapper SHALL forward both values into `ChatMessage.refused` and `ChatMessage.refusalReason`. The chat message list SHALL select the refusal renderer based on `ChatMessage.refused === true` rather than on the literal content string `'抱歉，我無法回答這個問題。'`.

#### Scenario: Reloaded conversation shows refusal UI for prior refusal turn

- **WHEN** a signed-in user previously received a refusal in conversation A and now reopens conversation A from the history sidebar
- **THEN** the chat main column lists the user's question as a regular user message
- **AND** lists the assistant turn using the refusal message component (with the "可能原因" and "建議的下一步" sections)
- **AND** the refusal turn is identifiable from the API payload by `refused: true`, not by content string matching
- **AND** the API payload exposes the `refusalReason` matching the original outcome so reason-specific copy can render

#### Scenario: Reloaded conversation shows accepted answers normally

- **WHEN** a signed-in user reopens a conversation whose latest assistant turn was an accepted answer (`refused = 0`)
- **THEN** that turn renders as a regular assistant message with citation chips when citations exist
- **AND** the refusal renderer is not used for that turn
- **AND** the API payload reports `refusalReason: null` for that row

### Requirement: Reason-Specific Refusal Message Copy

The `RefusalMessage` component SHALL render reason-specific Traditional Chinese copy in its "可能原因" and "建議的下一步" sections when the assistant turn carries a known `RefusalReason` value. The component SHALL accept a `reason` prop sourced from `ChatMessage.refusalReason` (which is propagated either from the live SSE refusal event or from the persisted `messages.refusal_reason` column on conversation reload). When the prop is missing, null, or carries an unrecognized value, the component SHALL fall back to the generic copy (the existing universal "可能原因 / 建議的下一步" content).

The reason-to-copy mapping SHALL cover at minimum the following four reasons:

- `restricted_scope` — explain that the question contained sensitive material (API keys, passwords, credit cards, …) and that the system did not process or store it; advise the user to rephrase without secrets.
- `no_citation` — explain that the knowledge base has no documents that cover the question; advise the user to try different keywords or narrow the scope.
- `low_confidence` — explain that relevant documents were found but the content was not strong enough to support a confident answer, and the system declined to avoid misleading; advise the user to add more specific conditions.
- `pipeline_error` — explain that the system temporarily failed to process the request; advise the user to retry shortly or contact an administrator if it persists.

#### Scenario: restricted_scope refusal shows credential-leak guidance

- **WHEN** a signed-in user submits a credential-bearing query that triggers an audit-block refusal
- **THEN** the refusal message lists "可能原因" content that explicitly mentions sensitive material (API key / 密碼 / 信用卡 or equivalent wording)
- **AND** the "建議的下一步" content advises the user to rephrase without secrets
- **AND** the generic "改換關鍵字 / 查看相關文件 / 聯絡管理員" fallback is NOT shown for this reason

#### Scenario: no_citation refusal shows out-of-scope guidance

- **WHEN** a signed-in user receives a `no_citation` refusal (knowledge base coverage too low)
- **THEN** the refusal message's "可能原因" explains the knowledge base lacks relevant documents
- **AND** the "建議的下一步" advises trying different keywords or narrowing the scope

#### Scenario: low_confidence shows insufficient-evidence guidance

- **WHEN** a signed-in user receives a `low_confidence` refusal
- **THEN** the refusal message's "可能原因" explains documents were found but the content was not strong enough to support a confident answer
- **AND** the "建議的下一步" advises adding more specific conditions

#### Scenario: pipeline_error shows transient-failure guidance

- **WHEN** a signed-in user receives a `pipeline_error` refusal
- **THEN** the refusal message's "可能原因" explains the system temporarily failed to process the request
- **AND** the "建議的下一步" advises retrying shortly or contacting an administrator

#### Scenario: missing or unknown reason falls back to generic copy

- **WHEN** an assistant refusal turn has `refusalReason` missing, null, or set to a value that is not in the known reason set
- **THEN** the refusal message renders the generic "可能原因 / 建議的下一步" copy that existed before reason-specific routing was introduced

### Requirement: New Conversation Buttons Show Visible Text Label

The Web chat UI SHALL render the primary new-conversation entry points with a visible text label "新對話" alongside the icon. The chat main column header button SHALL display both the icon and the "新對話" label. The conversation history sidebar's expanded header button SHALL display both the icon and the "新對話" label. Icon-only secondary entry points SHALL retain an `aria-label` that matches the visible label text. The visible label MUST NOT be hidden purely on viewport width; if the surrounding layout cannot fit the label and the icon together at the smallest supported viewport, the icon SHALL collapse first while the label remains visible.

#### Scenario: Chat header button renders icon and visible label

- **WHEN** a signed-in user views the chat main column at a desktop viewport (>= `lg` breakpoint)
- **THEN** the header new-conversation button renders the plus icon and the visible text "新對話"
- **AND** the button's accessible name resolves to "新對話"

#### Scenario: Sidebar expanded header button renders icon and visible label

- **WHEN** a signed-in user has the conversation history sidebar expanded
- **THEN** the sidebar header new-conversation button renders the plus icon and the visible text "新對話"

#### Scenario: Visible label persists at narrow viewports

- **WHEN** a signed-in user views the chat UI at a viewport width of 360 px
- **THEN** the new-conversation button still shows the "新對話" label
- **AND** the surrounding layout adapts (for example by collapsing the icon or by truncating other adjacent elements) rather than hiding the label

#### Scenario: Icon-only secondary rail entry retains aria-label

- **WHEN** a signed-in user has the conversation history sidebar collapsed and only the rail plus icon is visible
- **THEN** the rail icon button has `aria-label = "新對話"` so assistive technology announces the same name
