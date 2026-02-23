## ADDED Requirements

### Requirement: Query Log List UI

The system SHALL provide an Admin-only query log list page with filterable views for channel, outcome, query type, and redaction status. The list SHALL display redaction-safe fields only.

#### Scenario: Admin filters logs by channel and outcome

- **WHEN** an Admin applies channel or outcome filters on the log list page
- **THEN** the page refreshes the list to the matching query logs
- **AND** each row shows only redaction-safe summary fields

#### Scenario: High-risk log row stays redacted

- **WHEN** a query log row represents a high-risk request that triggered redaction or marker-only storage
- **THEN** the row indicates that risk/redaction state
- **AND** the list does not reveal the raw user input

### Requirement: Query Log Detail UI

The system SHALL provide an Admin-only detail view for a single query log that shows governance-relevant metadata such as request outcome, decision path, timing fields, risk flags, and config snapshot version without exposing prohibited raw content.

#### Scenario: Detail page shows governance fields

- **WHEN** an Admin opens a single query log detail page
- **THEN** the page shows request outcome, decision path, redaction state, risk flags, and config snapshot version
- **AND** the page uses masked or redacted content wherever raw text is not allowed

#### Scenario: Unauthorized viewer cannot access log detail

- **WHEN** a non-admin requests a query log detail page
- **THEN** the system blocks access
- **AND** the page does not leak query metadata
