## ADDED Requirements

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

### Requirement: Conversation History Time Buckets Recompute Across Midnight

The conversation history time-bucket grouping (Today / Yesterday / This Week / Earlier) SHALL recompute when the local wall-clock date advances past midnight, without requiring an explicit refetch of the conversation list. The UI SHALL NOT rely solely on the timestamp captured when the page was mounted.

#### Scenario: Conversation that was Today becomes Yesterday after midnight passes

- **GIVEN** the conversation history sidebar has been open since before midnight
- **AND** a conversation with timestamp equal to yesterday 23:50 local time is currently grouped under "Today"
- **WHEN** the wall-clock crosses midnight while the page remains open
- **THEN** that conversation appears under "Yesterday" without any user-triggered refetch
- **AND** no additional `/api/conversations` GET request is required to trigger the regrouping

### Requirement: Chat Home Page Deduplicates Conversation History Fetch

On the authenticated chat home page, the conversation history data source SHALL be fetched at most once per page entry, regardless of how many UI surfaces (inline sidebar, drawer) consume it. Surfaces sharing the same conversation history SHALL read from a single source instance rather than each triggering their own initial fetch.

#### Scenario: Signed-in user enters home and network tab shows one conversation list fetch

- **WHEN** a signed-in user loads the chat home page for the first time in the session
- **THEN** exactly one `GET /api/conversations` request is issued during the initial render
- **AND** both the inline sidebar (at `lg` breakpoint) and the off-canvas drawer (below `lg`) display the same conversation list when opened
