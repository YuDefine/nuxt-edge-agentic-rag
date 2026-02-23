## ADDED Requirements

### Requirement: Feature-Gated Admin Summary Dashboard

The system SHALL provide an Admin summary dashboard only when `features.adminDashboard` is enabled for the active environment. The dashboard SHALL present coarse summary cards and trend indicators without becoming the source of truth for governed query or document data.

#### Scenario: Dashboard stays hidden when feature flag is off

- **WHEN** `features.adminDashboard` is false in the active environment
- **THEN** the dashboard route and navigation entry stay hidden, disabled, or blocked
- **AND** the absence of the dashboard does not affect core Admin workflows

#### Scenario: Dashboard shows coarse operational summary when enabled

- **WHEN** the dashboard feature is enabled for an Admin environment
- **THEN** the page displays summary cards for document count, query volume, and token status
- **AND** the page uses aggregate data rather than raw sensitive rows

### Requirement: Summary Data Remains Audit-Safe

Dashboard summaries SHALL derive from existing governed data sources such as documents, query logs, and token metadata, and SHALL avoid exposing raw high-risk payloads or unreduced debug internals.

#### Scenario: Dashboard does not expose raw risky content

- **WHEN** the dashboard renders operational statistics
- **THEN** it shows only counts, rates, or redaction-safe summaries
- **AND** it does not expose raw user prompts, secrets, or internal-only debug fields
