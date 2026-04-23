## ADDED Requirements

### Requirement: Chat History Sidebar Collapsible Control At lg+

The system SHALL allow users to collapse and expand the chat conversation history sidebar at viewport widths `>= 1024px` (Tailwind `lg`). The collapsed state SHALL persist across sessions via client-side storage. The sidebar SHALL occupy a fixed width of `16rem` (`w-64`) when expanded and a fixed width of `3rem` (`w-12`) when collapsed. Collapsing SHALL NOT remove the sidebar from the accessibility tree and SHALL NOT hide it with `display: none`; instead, the collapsed rail SHALL remain interactive and expose at minimum a toggle control, a history icon, a conversation count badge, and a new-conversation button. The collapsed and expanded states SHALL NOT apply at viewport widths `< 1024px`; below that breakpoint the existing drawer pattern from `Mobile-First Layout Pattern At md Breakpoint` SHALL continue to apply unchanged.

#### Scenario: Default expanded sidebar at lg with no stored preference

- **WHEN** a user loads the chat page at viewport width `>= 1024px` with no prior `chat:history-sidebar:collapsed` value in localStorage
- **THEN** the conversation history sidebar is rendered inline at `w-64`
- **AND** the conversation list is visible
- **AND** a collapse toggle button with `i-lucide-panel-left-close` icon is rendered in the sidebar header

#### Scenario: User collapses sidebar and preference persists across reload

- **WHEN** a user clicks the collapse toggle button at viewport width `>= 1024px`
- **THEN** the sidebar animates to `w-12` within 300 ms
- **AND** the rail renders an expand toggle with `i-lucide-panel-left-open` icon, a history icon, a conversation count badge, and a new-conversation button
- **AND** the conversation list items are not visible in the rail
- **AND** `chat:history-sidebar:collapsed` is written to localStorage as `true`
- **AND** when the user reloads the page, the sidebar restores to the collapsed state after hydration

#### Scenario: Collapsed rail exposes tooltip labels for icon-only controls

- **WHEN** a user hovers or focuses the expand toggle button on the collapsed rail
- **THEN** a tooltip with the label "展開對話記錄" is announced to the user
- **AND** the tooltip is dismissible via blur or Escape

#### Scenario: Drawer behavior below lg is unaffected

- **WHEN** a user loads the chat page at viewport width `< 1024px`
- **THEN** the conversation history sidebar is not rendered inline regardless of the stored `chat:history-sidebar:collapsed` value
- **AND** the history drawer opens via the existing header button as specified in `Mobile-First Layout Pattern At md Breakpoint`

#### Scenario: localStorage unavailable falls back to in-memory state

- **WHEN** localStorage is disabled or throws on write (for example Safari private mode)
- **THEN** the sidebar still toggles between expanded and collapsed within the current tab session
- **AND** the absence of persistence does not surface as an error to the user

---

### Requirement: Chat History Time-Based Grouping

The system SHALL group chat conversations in the history list by recency of `updatedAt` into five buckets, ordered from most recent to least recent: Today, Yesterday, This Week, This Month, Earlier. Each non-empty bucket SHALL be rendered as a collapsible section with a header displaying the bucket label, a badge showing the count of conversations in that bucket, and a chevron icon that rotates to indicate the expanded or collapsed state. Empty buckets SHALL NOT be rendered. Bucket membership SHALL be computed in the user's local time zone. Conversations with missing or invalid `updatedAt` values SHALL be placed in the Earlier bucket and SHALL NOT cause a render failure.

#### Scenario: Buckets rendered in fixed order with correct counts

- **WHEN** the conversation list contains conversations spanning multiple recency buckets
- **THEN** the buckets appear in the order Today, Yesterday, This Week, This Month, Earlier
- **AND** each non-empty bucket header shows the bucket label and a badge with the count of conversations in that bucket
- **AND** buckets with zero conversations are not rendered

##### Example: boundary assignment

| `updatedAt` relative to `now` (user local time) | Bucket     | Notes                                               |
| ----------------------------------------------- | ---------- | --------------------------------------------------- |
| Same calendar day as `now`                      | Today      | 00:00 local of `now` up to `now`                    |
| Calendar day before `now`                       | Yesterday  | 00:00–24:00 of the prior local day                  |
| 2–7 local days before `now`, not Yesterday      | This Week  | Rolling 7-day window, excluding Today and Yesterday |
| 8–30 local days before `now`                    | This Month | Rolling 30-day window, excluding This Week          |
| More than 30 local days before `now`            | Earlier    | Older than the 30-day rolling boundary              |
| Missing, empty, or non-parseable                | Earlier    | Defensive fallback — never throws                   |

#### Scenario: Default-open buckets favor recency

- **WHEN** the conversation history is first rendered in a session
- **THEN** the Today, Yesterday, and This Week buckets are expanded by default
- **AND** the This Month and Earlier buckets are collapsed by default

#### Scenario: User toggles a bucket and the state persists within the session

- **WHEN** a user clicks the header of a collapsed bucket
- **THEN** the bucket expands and its chevron rotates to the expanded orientation
- **AND** the expanded state is retained while the conversation history component is mounted
- **AND** the expanded state is not required to persist across page reloads

#### Scenario: Selecting a conversation still fires the same contract

- **WHEN** a user clicks a conversation row inside any bucket
- **THEN** the component emits `conversation-selected` with the same payload shape as before this change
- **AND** the conversation loading and error flows defined by the existing conversation history behavior are unchanged
