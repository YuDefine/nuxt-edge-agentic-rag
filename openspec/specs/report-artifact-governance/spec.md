# report-artifact-governance Specification

## Purpose

TBD - created by archiving change 'report-governance-handoff-cleanup'. Update Purpose after archive.

## Requirements

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

<!-- @trace
source: report-governance-handoff-cleanup
updated: 2026-04-22
code:
  - reports/archive/main-v0.0.11_assets/image1.jpeg
  - references/yuntech/專題報告編排規範1141216.pdf
  - reports/archive/main-v0.0.37.md
  - backup-pre-0010-20260421.sql
  - reports/archive/main-v0.0.20.md
  - reports/notes/diagram.md
  - reports/archive/main-v0.0.30.md
  - main-v0.0.51.md
  - reports/archive/main-v0.0.24.md
  - main-v0.0.50.md
  - reports/archive/main-v0.0.26.md
  - reports/archive/main-v0.0.36.docx
  - .github/workflows/deploy.yml
  - .github/workflows/docs-domain-sync.yml
  - reports/archive/main-v0.0.1.docx
  - reports/latest.md
  - scripts/checks/check-legacy-test-roots.mts
  - reports/archive/main-v0.0.12.md
  - tooling/__init__.py
  - tooling/scripts/clone_section.py
  - docs/tech-debt.md
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - .codex/agents/screenshot-review.toml
  - reports/archive/main-v0.0.11.docx
  - docs/onboarding.md
  - deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - reports/archive/main-v0.0.10.md
  - reports/archive/main-v0.0.21.md
  - reports/archive/main-v0.0.11.md
  - references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - reports/archive/main-v0.0.28.md
  - main-v0.0.49.md
  - reports/archive/main-v0.0.31.md
  - reports/archive/main-v0.0.50.md
  - template/HANDOFF.md
  - templates/海報樣板.pptx
  - tooling/scripts/docx_sections.py
  - docs/decisions/2026-04-22-canonical-test-roots-and-repo-archives.md
  - reports/archive/main-v0.0.33.md
  - README.md
  - main-v0.0.48.md
  - reports/archive/main-v0.0.13.md
  - reports/archive/main-v0.0.29.md
  - reports/archive/main-v0.0.48.md
  - scripts/sync-docs-pages-domains.mjs
  - docs/decisions/2026-04-22-stable-current-report-entry.md
  - backups/backup-pre-0010-20260421.sql
  - docs/README.md
  - reports/archive/main-v0.0.22.md
  - AGENTS.md
  - reports/archive/main-v0.0.27.md
  - reports/archive/main-v0.0.34.md
  - reports/archive/main-v0.0.36.md
  - tooling/requirements.txt
  - tooling/scripts/__init__.py
  - reports/archive/main-v0.0.14.md
  - reports/archive/main-v0.0.49.md
  - tooling/scripts/clone_insert_docx.py
  - reports/archive/main-v0.0.23.md
  - scripts/checks/lib/legacy-test-roots.mts
  - reports/archive/main-v0.0.32.md
  - reports/archive/main-v0.0.35.md
  - tooling/scripts/docx_apply.py
  - docs/runbooks/index.md
  - .agents/skills/vitest/references/advanced-projects.md
  - tooling/scripts/office/__init__.py
  - docs/index.md
  - tooling/scripts/docx_rebuild_content.py
  - tooling/scripts/legacy/transform_v36.py
  - .github/instructions/screenshot_strategy.instructions.md
  - tooling/scripts/extract_docx_to_md.py
  - docs/verify/index.md
  - reports/archive/main-v0.0.18.md
  - reports/archive/main-v0.0.17.md
  - tooling/scripts/office/pack.py
  - tooling/scripts/office/unpack.py
  - docs/specs/index.md
  - scripts/claude-desktop-mcp-bridge.mjs
  - reports/archive/main-v0.0.16.md
  - tooling/scripts/docx_diff.py
  - docs/decisions/index.md
  - deliverables/defense/答辯準備_口試Q&A.md
  - reports/archive/main-v0.0.19.md
  - docs/.vitepress/config.ts
  - reports/archive/main-v0.0.15.md
  - reports/archive/main-v0.0.25.md
  - reports/archive/main-v0.0.37.docx
  - CLAUDE.md
  - tooling/scripts/sync_docx_content.py
  - docs/runbooks/claude-desktop-mcp.md
  - docs/STRUCTURE.md
  - package.json
tests:
  - test/unit/legacy-test-roots.test.ts
  - test/integration/claude-desktop-mcp-bridge.test.ts
  - tooling/tests/test_extract_docx_to_md.py
  - tooling/tests/test_office_pack_unpack.py
-->

---

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

<!-- @trace
source: report-governance-handoff-cleanup
updated: 2026-04-22
code:
  - reports/archive/main-v0.0.11_assets/image1.jpeg
  - references/yuntech/專題報告編排規範1141216.pdf
  - reports/archive/main-v0.0.37.md
  - backup-pre-0010-20260421.sql
  - reports/archive/main-v0.0.20.md
  - reports/notes/diagram.md
  - reports/archive/main-v0.0.30.md
  - main-v0.0.51.md
  - reports/archive/main-v0.0.24.md
  - main-v0.0.50.md
  - reports/archive/main-v0.0.26.md
  - reports/archive/main-v0.0.36.docx
  - .github/workflows/deploy.yml
  - .github/workflows/docs-domain-sync.yml
  - reports/archive/main-v0.0.1.docx
  - reports/latest.md
  - scripts/checks/check-legacy-test-roots.mts
  - reports/archive/main-v0.0.12.md
  - tooling/__init__.py
  - tooling/scripts/clone_section.py
  - docs/tech-debt.md
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - .codex/agents/screenshot-review.toml
  - reports/archive/main-v0.0.11.docx
  - docs/onboarding.md
  - deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - reports/archive/main-v0.0.10.md
  - reports/archive/main-v0.0.21.md
  - reports/archive/main-v0.0.11.md
  - references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - reports/archive/main-v0.0.28.md
  - main-v0.0.49.md
  - reports/archive/main-v0.0.31.md
  - reports/archive/main-v0.0.50.md
  - template/HANDOFF.md
  - templates/海報樣板.pptx
  - tooling/scripts/docx_sections.py
  - docs/decisions/2026-04-22-canonical-test-roots-and-repo-archives.md
  - reports/archive/main-v0.0.33.md
  - README.md
  - main-v0.0.48.md
  - reports/archive/main-v0.0.13.md
  - reports/archive/main-v0.0.29.md
  - reports/archive/main-v0.0.48.md
  - scripts/sync-docs-pages-domains.mjs
  - docs/decisions/2026-04-22-stable-current-report-entry.md
  - backups/backup-pre-0010-20260421.sql
  - docs/README.md
  - reports/archive/main-v0.0.22.md
  - AGENTS.md
  - reports/archive/main-v0.0.27.md
  - reports/archive/main-v0.0.34.md
  - reports/archive/main-v0.0.36.md
  - tooling/requirements.txt
  - tooling/scripts/__init__.py
  - reports/archive/main-v0.0.14.md
  - reports/archive/main-v0.0.49.md
  - tooling/scripts/clone_insert_docx.py
  - reports/archive/main-v0.0.23.md
  - scripts/checks/lib/legacy-test-roots.mts
  - reports/archive/main-v0.0.32.md
  - reports/archive/main-v0.0.35.md
  - tooling/scripts/docx_apply.py
  - docs/runbooks/index.md
  - .agents/skills/vitest/references/advanced-projects.md
  - tooling/scripts/office/__init__.py
  - docs/index.md
  - tooling/scripts/docx_rebuild_content.py
  - tooling/scripts/legacy/transform_v36.py
  - .github/instructions/screenshot_strategy.instructions.md
  - tooling/scripts/extract_docx_to_md.py
  - docs/verify/index.md
  - reports/archive/main-v0.0.18.md
  - reports/archive/main-v0.0.17.md
  - tooling/scripts/office/pack.py
  - tooling/scripts/office/unpack.py
  - docs/specs/index.md
  - scripts/claude-desktop-mcp-bridge.mjs
  - reports/archive/main-v0.0.16.md
  - tooling/scripts/docx_diff.py
  - docs/decisions/index.md
  - deliverables/defense/答辯準備_口試Q&A.md
  - reports/archive/main-v0.0.19.md
  - docs/.vitepress/config.ts
  - reports/archive/main-v0.0.15.md
  - reports/archive/main-v0.0.25.md
  - reports/archive/main-v0.0.37.docx
  - CLAUDE.md
  - tooling/scripts/sync_docx_content.py
  - docs/runbooks/claude-desktop-mcp.md
  - docs/STRUCTURE.md
  - package.json
tests:
  - test/unit/legacy-test-roots.test.ts
  - test/integration/claude-desktop-mcp-bridge.test.ts
  - tooling/tests/test_extract_docx_to_md.py
  - tooling/tests/test_office_pack_unpack.py
-->

---

### Requirement: Handoff Remains Session-Scoped

`template/HANDOFF.md` SHALL contain only session-scoped handoff information: immediate status, active blockers, scope warnings, and the next concrete actions for the next operator. It SHALL NOT be used as the long-term storage location for stable report governance rules or cross-session roadmap decisions.

#### Scenario: Session-local warning stays in handoff

- **WHEN** the next operator needs to know about a dirty worktree, temporary blocker, or immediate sequencing concern
- **THEN** that warning SHALL remain in `template/HANDOFF.md`

#### Scenario: Stable governance rule is removed from handoff

- **WHEN** a handoff note states a stable governance rule such as the canonical current report artifact or the archive policy
- **THEN** that rule SHALL be moved to the governing OpenSpec artifact
- **AND** `template/HANDOFF.md` SHALL retain only the session-specific remainder, if any

<!-- @trace
source: report-governance-handoff-cleanup
updated: 2026-04-22
code:
  - reports/archive/main-v0.0.11_assets/image1.jpeg
  - references/yuntech/專題報告編排規範1141216.pdf
  - reports/archive/main-v0.0.37.md
  - backup-pre-0010-20260421.sql
  - reports/archive/main-v0.0.20.md
  - reports/notes/diagram.md
  - reports/archive/main-v0.0.30.md
  - main-v0.0.51.md
  - reports/archive/main-v0.0.24.md
  - main-v0.0.50.md
  - reports/archive/main-v0.0.26.md
  - reports/archive/main-v0.0.36.docx
  - .github/workflows/deploy.yml
  - .github/workflows/docs-domain-sync.yml
  - reports/archive/main-v0.0.1.docx
  - reports/latest.md
  - scripts/checks/check-legacy-test-roots.mts
  - reports/archive/main-v0.0.12.md
  - tooling/__init__.py
  - tooling/scripts/clone_section.py
  - docs/tech-debt.md
  - docs/verify/DEPLOYMENT_RUNBOOK.md
  - .codex/agents/screenshot-review.toml
  - reports/archive/main-v0.0.11.docx
  - docs/onboarding.md
  - deliverables/defense/國立雲林科技大學人工智慧技優專班114學年實務專題審查.pdf
  - reports/archive/main-v0.0.10.md
  - reports/archive/main-v0.0.21.md
  - reports/archive/main-v0.0.11.md
  - references/yuntech/人工智慧實務專題書面成果報告內容規範1141216.pdf
  - reports/archive/main-v0.0.28.md
  - main-v0.0.49.md
  - reports/archive/main-v0.0.31.md
  - reports/archive/main-v0.0.50.md
  - template/HANDOFF.md
  - templates/海報樣板.pptx
  - tooling/scripts/docx_sections.py
  - docs/decisions/2026-04-22-canonical-test-roots-and-repo-archives.md
  - reports/archive/main-v0.0.33.md
  - README.md
  - main-v0.0.48.md
  - reports/archive/main-v0.0.13.md
  - reports/archive/main-v0.0.29.md
  - reports/archive/main-v0.0.48.md
  - scripts/sync-docs-pages-domains.mjs
  - docs/decisions/2026-04-22-stable-current-report-entry.md
  - backups/backup-pre-0010-20260421.sql
  - docs/README.md
  - reports/archive/main-v0.0.22.md
  - AGENTS.md
  - reports/archive/main-v0.0.27.md
  - reports/archive/main-v0.0.34.md
  - reports/archive/main-v0.0.36.md
  - tooling/requirements.txt
  - tooling/scripts/__init__.py
  - reports/archive/main-v0.0.14.md
  - reports/archive/main-v0.0.49.md
  - tooling/scripts/clone_insert_docx.py
  - reports/archive/main-v0.0.23.md
  - scripts/checks/lib/legacy-test-roots.mts
  - reports/archive/main-v0.0.32.md
  - reports/archive/main-v0.0.35.md
  - tooling/scripts/docx_apply.py
  - docs/runbooks/index.md
  - .agents/skills/vitest/references/advanced-projects.md
  - tooling/scripts/office/__init__.py
  - docs/index.md
  - tooling/scripts/docx_rebuild_content.py
  - tooling/scripts/legacy/transform_v36.py
  - .github/instructions/screenshot_strategy.instructions.md
  - tooling/scripts/extract_docx_to_md.py
  - docs/verify/index.md
  - reports/archive/main-v0.0.18.md
  - reports/archive/main-v0.0.17.md
  - tooling/scripts/office/pack.py
  - tooling/scripts/office/unpack.py
  - docs/specs/index.md
  - scripts/claude-desktop-mcp-bridge.mjs
  - reports/archive/main-v0.0.16.md
  - tooling/scripts/docx_diff.py
  - docs/decisions/index.md
  - deliverables/defense/答辯準備_口試Q&A.md
  - reports/archive/main-v0.0.19.md
  - docs/.vitepress/config.ts
  - reports/archive/main-v0.0.15.md
  - reports/archive/main-v0.0.25.md
  - reports/archive/main-v0.0.37.docx
  - CLAUDE.md
  - tooling/scripts/sync_docx_content.py
  - docs/runbooks/claude-desktop-mcp.md
  - docs/STRUCTURE.md
  - package.json
tests:
  - test/unit/legacy-test-roots.test.ts
  - test/integration/claude-desktop-mcp-bridge.test.ts
  - tooling/tests/test_extract_docx_to_md.py
  - tooling/tests/test_office_pack_unpack.py
-->
