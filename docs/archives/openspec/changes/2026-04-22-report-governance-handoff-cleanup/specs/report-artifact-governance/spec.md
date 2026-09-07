## ADDED Requirements

### Requirement: Current Report Has A Single Canonical Artifact

The repository SHALL treat `reports/latest.md` as the single canonical artifact for the current report body. The repository SHALL treat files stored under `reports/archive/` as historical snapshots only and SHALL NOT use archived report files to describe the current report state.

#### Scenario: Current report guidance points to latest

- **WHEN** repository guidance or workflow notes describe where the current report lives
- **THEN** they SHALL point to `reports/latest.md` as the current report body
- **AND** they SHALL NOT describe any archived report file as the current version

#### Scenario: Archived reports remain historical snapshots

- **WHEN** a report snapshot is stored under `reports/archive/`
- **THEN** that file SHALL be treated as versioned history only
- **AND** future current-state updates SHALL be written outside the archived snapshot

### Requirement: Cross-Session Report Planning Lives In OpenSpec Roadmap

The repository SHALL store cross-session report planning context in `openspec/ROADMAP.md` instead of `template/HANDOFF.md`. Cross-session planning context includes current-state assessments, follow-up directions, evidence gaps, and reusable source-material inventories that remain relevant beyond a single session.

#### Scenario: Stable report planning context is captured in roadmap

- **WHEN** a discussion concludes that a report still needs additional evidence, demo assets, or backfill material in later sessions
- **THEN** that conclusion SHALL be captured in `openspec/ROADMAP.md`
- **AND** it SHALL be written as ongoing planning context rather than session-local notes

#### Scenario: Report source-material inventory persists across sessions

- **WHEN** the team inventories reusable report inputs such as evidence bundles, seed cases, token governance status, or query-log-derived material
- **THEN** that inventory SHALL be maintained in `openspec/ROADMAP.md` or the report body
- **AND** it SHALL NOT remain only in `template/HANDOFF.md`

### Requirement: Handoff Remains Session-Scoped

`template/HANDOFF.md` SHALL contain only session-scoped handoff information: immediate status, active blockers, scope warnings, and the next concrete actions for the next operator. It SHALL NOT be used as the long-term storage location for stable report governance rules or cross-session roadmap decisions.

#### Scenario: Session-local warning stays in handoff

- **WHEN** the next operator needs to know about a dirty worktree, temporary blocker, or immediate sequencing concern
- **THEN** that warning SHALL remain in `template/HANDOFF.md`

#### Scenario: Stable governance rule is removed from handoff

- **WHEN** a handoff note states a stable governance rule such as the canonical current report artifact or the archive policy
- **THEN** that rule SHALL be moved to the governing OpenSpec artifact
- **AND** `template/HANDOFF.md` SHALL retain only the session-specific remainder, if any
