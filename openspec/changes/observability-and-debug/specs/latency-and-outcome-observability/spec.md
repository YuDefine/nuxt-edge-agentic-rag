## ADDED Requirements

### Requirement: Latency Summary Surface

The system SHALL provide an internal observability surface for first-token latency, completion latency, and grouped outcome summaries derived from governed query log data.

#### Scenario: Admin reviews latency summary

- **WHEN** an authorized Admin opens the latency observability surface
- **THEN** the page shows first-token and completion latency summaries
- **AND** the page groups or summarizes outcomes such as answered, refused, forbidden, and error

#### Scenario: Missing latency stays explicit

- **WHEN** a request never produced a full streamed answer and latency fields are null
- **THEN** the observability surface represents that state explicitly
- **AND** does not fabricate timing values

### Requirement: Outcome Trends Stay Redaction-Safe

The observability surface SHALL present redaction-safe aggregates and SHALL avoid exposing raw prompts or prohibited payloads while summarizing refusal, error, and rate-limit behavior.

#### Scenario: Aggregate outcome view avoids raw content

- **WHEN** the page summarizes refusal or high-risk traffic
- **THEN** it uses counts, ratios, or grouped summaries
- **AND** it does not reveal raw redacted input content
