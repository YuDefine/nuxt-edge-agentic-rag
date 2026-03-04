# acceptance-evidence-automation Specification

## Purpose

TBD - created by archiving change 'test-coverage-and-automation'. Update Purpose after archive.

## Requirements

### Requirement: Frozen Acceptance Matrix Automation

The system SHALL encode the report-defined `TC-01` through `TC-20`, `A01` through `A13`, and `EV-01` through `EV-04` as versioned, executable verification assets. Each executable case SHALL declare its channel, expected HTTP outcome, expected decision path, required citation or refusal evidence, and the acceptance or evidence IDs it proves.

#### Scenario: Every acceptance target maps to executable coverage

- **WHEN** the verification registry is generated for `v1.0.0`
- **THEN** each acceptance ID from `A01` to `A13` maps to one or more automated cases or evidence exporters
- **AND** each mapped case declares the report section and success condition it proves

#### Scenario: Frozen-final cases preserve stable expectations

- **WHEN** a case is promoted into the `frozen-final` dataset
- **THEN** its expected outcome, required evidence, and failure conditions are stored in versioned fixtures
- **AND** later runs compare against the stored expectation instead of ad hoc manual judgment

<!-- @trace
source: test-coverage-and-automation
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->

---

### Requirement: Multi-Layer Regression Coverage

The system SHALL verify the report contract through layered automation: unit coverage for pure policies, integration coverage for server orchestration, end-to-end coverage for critical Web flows, and contract coverage for MCP responses. Tests SHALL reuse realistic data builders and SHALL NOT replace the behavior under test with mock-only assertions.

#### Scenario: MCP no-hit contract stays stable

- **WHEN** `searchKnowledge` is exercised against a query that has no visible evidence
- **THEN** contract automation verifies `200` with `results: []`
- **AND** the assertion fails if the response changes to `404` or exposes internal diagnostics

#### Scenario: Current-version-only regression is caught

- **WHEN** a test publishes `v2` for a document and re-asks a query whose answer existed only in `v1`
- **THEN** integration automation verifies that the answer either cites only `v2` evidence or refuses
- **AND** the assertion fails if any `v1` citation remains in the final response

<!-- @trace
source: test-coverage-and-automation
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->

---

### Requirement: Evidence Artifact Generation

Automated verification SHALL emit stable evidence artifacts for report backfill. Each emitted record SHALL include `config_snapshot_version`, execution status, channel, and references to the stored evidence payloads such as response snapshots, cleanup logs, or replay checks.

#### Scenario: Acceptance summary includes config snapshot version

- **WHEN** the acceptance summary command runs against `v1.0.0`
- **THEN** each result row records the `testCaseId`, `acceptanceId`, `http_status`, `decision_path`, and `config_snapshot_version`
- **AND** failed rows include pointers to the captured evidence payloads

#### Scenario: Retention evidence exports backdated cleanup results

- **WHEN** the evidence suite executes the retention validation path
- **THEN** it emits backdated record metadata, cleanup run output, and replay-before-expiry versus replay-after-expiry results
- **AND** those artifacts can be linked directly to `EV-04`

<!-- @trace
source: test-coverage-and-automation
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->
