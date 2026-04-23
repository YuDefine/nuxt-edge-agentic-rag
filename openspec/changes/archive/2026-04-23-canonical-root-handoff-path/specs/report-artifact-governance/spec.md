## MODIFIED Requirements

### Requirement: Cross-Session Report Planning Lives In OpenSpec Roadmap

The repository SHALL store cross-session report planning context in `openspec/ROADMAP.md` instead of `HANDOFF.md`. Cross-session planning context includes current-state assessments, follow-up directions, evidence gaps, and reusable source-material inventories that remain relevant beyond a single session.

#### Scenario: Stable report planning context is captured in roadmap

- **WHEN** a discussion concludes that a report still needs additional evidence, demo assets, or backfill material in later sessions
- **THEN** that conclusion SHALL be captured in `openspec/ROADMAP.md`
- **AND** it SHALL be written as ongoing planning context rather than session-local notes

#### Scenario: Report source-material inventory persists across sessions

- **WHEN** the team inventories reusable report inputs such as evidence bundles, seed cases, token governance status, or query-log-derived material
- **THEN** that inventory SHALL be maintained in `openspec/ROADMAP.md` or the report body
- **AND** it SHALL NOT remain only in `HANDOFF.md`

### Requirement: Handoff Remains Session-Scoped

`HANDOFF.md` SHALL contain only session-scoped handoff information: immediate status, active blockers, scope warnings, and the next concrete actions for the next operator. It SHALL NOT be used as the long-term storage location for stable report governance rules or cross-session roadmap decisions.

#### Scenario: Session-local warning stays in root handoff

- **WHEN** the next operator needs to know about a dirty worktree, temporary blocker, or immediate sequencing concern
- **THEN** that warning SHALL remain in repo root `HANDOFF.md`

#### Scenario: Stable governance rule is removed from handoff

- **WHEN** a handoff note states a stable governance rule such as the canonical current report artifact or the archive policy
- **THEN** that rule SHALL be moved to the governing OpenSpec artifact
- **AND** `HANDOFF.md` SHALL retain only the session-specific remainder, if any
