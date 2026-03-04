# retention-cleanup-governance Specification

## Purpose

TBD - created by archiving change 'governance-refinements'. Update Purpose after archive.

## Requirements

### Requirement: Coordinated Retention Cleanup

The system SHALL execute a coordinated cleanup policy for `query_logs`, `citation_records`, `source_chunks.chunk_text`, and revoked or expired MCP token metadata. Cleanup SHALL preserve replayable evidence for the full retention window and SHALL remove expired records in a way that does not leave partially broken audit chains.

#### Scenario: Cleanup preserves replayable evidence before expiry

- **WHEN** scheduled cleanup runs while a citation and its supporting audit records are still inside the retention window
- **THEN** the cleanup job leaves those records intact
- **AND** `getDocumentChunk` can still replay the cited snapshot for an authorized caller

#### Scenario: Cleanup expires a complete audit chain after retention

- **WHEN** cleanup runs for records beyond the retention threshold
- **THEN** expired replay material and its dependent retained metadata are removed or marked unavailable consistently
- **AND** replay requests receive the same unavailable outcome as any other expired citation

<!-- @trace
source: governance-refinements
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->

---

### Requirement: Backdated Cleanup Verification

The system SHALL provide a non-production verification path for retention rules using shortened TTLs, backdated records, or equivalent staged validation so that cleanup behavior can be proven without waiting 180 real days.

#### Scenario: Staging verifies expiry with backdated records

- **WHEN** a staging or test environment seeds backdated retention records
- **THEN** cleanup verification can prove replay succeeds before expiry and fails after expiry
- **AND** the verification output records the cleanup run and threshold used

#### Scenario: Production verifies configuration without fake expiry runs

- **WHEN** Production boots `v1.0.0`
- **THEN** the configured cleanup schedule and retention thresholds are inspectable
- **AND** Production does not need artificial backdated data to claim configuration parity

<!-- @trace
source: governance-refinements
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->
