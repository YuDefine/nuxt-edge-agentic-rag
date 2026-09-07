# config-snapshot-governance Specification

## Purpose

TBD - created by archiving change 'governance-refinements'. Update Purpose after archive.

## Requirements

### Requirement: Shared Config Snapshot Version

The system SHALL derive `config_snapshot_version` from a shared source of truth that covers the active thresholds, model-role routing, and feature flag set used by Web, MCP, and verification flows. All persisted query or acceptance records SHALL stamp the same derived version for the same active configuration.

#### Scenario: Web and MCP stamp the same active version

- **WHEN** Web chat and MCP tools run under the same active threshold and feature-flag configuration
- **THEN** their persisted records use the same `config_snapshot_version`
- **AND** downstream verification can compare those records without extra per-surface normalization

#### Scenario: Config changes bump the recorded version

- **WHEN** a threshold, model-role mapping, or governed feature flag changes
- **THEN** the derived `config_snapshot_version` changes as part of the new active configuration
- **AND** later records are distinguishable from earlier runs in acceptance reporting

<!-- @trace
source: governance-refinements
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->

---

### Requirement: Threshold Source Of Truth

Thresholds and governed feature flags SHALL be read from shared runtime configuration or an equivalent shared module. Individual routes, tests, and debug surfaces SHALL NOT hardcode divergent values for decision thresholds or governed feature flags.

#### Scenario: Surface-specific hardcoded threshold drift is rejected

- **WHEN** a route or test tries to use a threshold value that differs from the shared configuration
- **THEN** verification fails or the build path reports drift
- **AND** the surface cannot silently define its own decision policy

#### Scenario: Acceptance summaries carry the governed version

- **WHEN** automated acceptance output is generated
- **THEN** each exported result row includes the active `config_snapshot_version`
- **AND** that value matches the shared configuration used by the executed surface

<!-- @trace
source: governance-refinements
updated: 2026-04-19
code:
  - .github/workflows/deploy-production.yml
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy.yml
-->
