## ADDED Requirements

### Requirement: Restored Refusal UI On Conversation Reload

The Web chat UI SHALL render the refusal message component for every persisted assistant message whose `refused` flag is true, regardless of whether the user is viewing the live stream or reloading historical conversation content. When a signed-in user opens an existing conversation from the history sidebar, the conversation messages list endpoint SHALL include a boolean `refused` field for each assistant message, and the front-end mapper SHALL forward that value into `ChatMessage.refused`. The chat message list SHALL select the refusal renderer based on `ChatMessage.refused === true` rather than on the literal content string `'抱歉，我無法回答這個問題。'`.

#### Scenario: Reloaded conversation shows refusal UI for prior refusal turn

- **WHEN** a signed-in user previously received a refusal in conversation A and now reopens conversation A from the history sidebar
- **THEN** the chat main column lists the user's question as a regular user message
- **AND** lists the assistant turn using the refusal message component (with the "可能原因" and "建議的下一步" sections)
- **AND** the refusal turn is identifiable from the API payload by `refused: true`, not by content string matching

#### Scenario: Reloaded conversation shows accepted answers normally

- **WHEN** a signed-in user reopens a conversation whose latest assistant turn was an accepted answer (`refused = 0`)
- **THEN** that turn renders as a regular assistant message with citation chips when citations exist
- **AND** the refusal renderer is not used for that turn

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
