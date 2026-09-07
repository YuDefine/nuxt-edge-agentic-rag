## ADDED Requirements

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
