## ADDED Requirements

### Requirement: Internal Decision Inspection Surface

The system SHALL provide an internal-only debug surface that displays governed diagnostic fields such as retrieval score, answerability judge score when present, decision path, and citation eligibility state for completed requests.

#### Scenario: Admin inspects a completed answer decision

- **WHEN** an authorized Admin opens the decision inspection surface for a completed request
- **THEN** the surface shows decision path, retrieval score, and any recorded judge score
- **AND** the surface uses the persisted debug-safe record rather than rerunning the answer flow

#### Scenario: Refusal shows refusal-specific diagnostics

- **WHEN** the inspected request ended in refusal
- **THEN** the surface shows refusal-oriented diagnostics such as refusal reason code and whether self-correction triggered
- **AND** it does not pretend a citation-backed answer existed

### Requirement: Debug Data Remains Internal-Only

Decision inspection fields SHALL remain unavailable to general user-facing surfaces and MCP public contracts.

#### Scenario: General user cannot see internal decision fields

- **WHEN** a normal Web user or MCP caller uses the product surfaces
- **THEN** retrieval scores, judge scores, and decision trace data remain hidden
- **AND** only the internal debug surface may display them
