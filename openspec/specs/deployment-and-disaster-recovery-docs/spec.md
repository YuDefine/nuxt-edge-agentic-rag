# deployment-and-disaster-recovery-docs Specification

## Purpose

TBD - created by archiving change 'deployment-manual'. Update Purpose after archive.

## Requirements

### Requirement: First-Time Deployment Runbook

The project SHALL include a written runbook covering first-time deployment to Cloudflare Workers. The runbook SHALL contain an ordered step list an operator can follow without requiring prior deployment knowledge. Each step SHALL include the exact command, expected successful output indicator, and verification action.

#### Scenario: New operator deploys staging for the first time

- **WHEN** a new operator follows the first-time deployment section end-to-end
- **THEN** the steps cover: Cloudflare account setup, wrangler CLI install, creating D1 / R2 / KV / AI Search resources, wrangler.toml bindings, OAuth client secret, `ADMIN_EMAIL_ALLOWLIST`, migration apply, first deploy, smoke-test URL, and expected post-deploy verification

#### Scenario: Runbook references env var list table

- **WHEN** the operator reaches the env var setup step
- **THEN** the runbook links to a consolidated table that lists every required variable with name, purpose, example format, sensitivity, and default per environment

<!-- @trace
source: deployment-manual
updated: 2026-04-20
code:
  - tmp/prod-backup-pre-affinity-fix.sql
  - scripts/checks/verify-auth-storage-consistency.sh
  - server/database/migrations/0007_better_auth_timestamp_affinity.sql
  - tmp/dry-run-bad.sqlite
  - tmp/dry-run.sqlite
-->

---

### Requirement: Routine Deployment Runbook

The project SHALL document the routine deployment flow for pushing new changes after initial setup. The runbook SHALL include the exact pre-deploy command sequence (lint, typecheck, test, generate), the deploy command, the post-deploy smoke test, and the versioning/tag convention.

#### Scenario: Operator deploys a routine merge

- **WHEN** a merge to `main` triggers routine deployment
- **THEN** the runbook lists the required checks (`pnpm check`, `pnpm test`), the deploy command (`wrangler deploy` or the CI equivalent), and the smoke test URL
- **AND** the runbook instructs tagging the deployed commit per the project's tag convention

#### Scenario: CI workflow example is provided

- **WHEN** the operator wants to automate deployment
- **THEN** the runbook includes a reference `.github/workflows/deploy.yml` example marked as illustrative
- **AND** the example is annotated so the operator knows which parts are environment-specific

<!-- @trace
source: deployment-manual
updated: 2026-04-20
code:
  - tmp/prod-backup-pre-affinity-fix.sql
  - scripts/checks/verify-auth-storage-consistency.sh
  - server/database/migrations/0007_better_auth_timestamp_affinity.sql
  - tmp/dry-run-bad.sqlite
  - tmp/dry-run.sqlite
-->

---

### Requirement: Disaster Recovery Runbook For Application Rollback

The project SHALL document how to roll back an application deployment without data loss. The runbook SHALL cover listing recent deployments, selecting a safe target, executing the rollback command, verifying successful rollback, and communicating the rollback.

#### Scenario: Operator detects production regression and rolls back

- **WHEN** an operator finds a production bug introduced by the latest deploy
- **THEN** the runbook guides them through `wrangler deployments list`, choosing the last known good deployment id, running `wrangler rollback <id>`, verifying via smoke URL, and noting the incident

#### Scenario: Rollback verification is explicit

- **WHEN** rollback completes
- **THEN** the runbook requires an explicit verification step (smoke test URL, endpoint response) before closing the incident

<!-- @trace
source: deployment-manual
updated: 2026-04-20
code:
  - tmp/prod-backup-pre-affinity-fix.sql
  - scripts/checks/verify-auth-storage-consistency.sh
  - server/database/migrations/0007_better_auth_timestamp_affinity.sql
  - tmp/dry-run-bad.sqlite
  - tmp/dry-run.sqlite
-->

---

### Requirement: Disaster Recovery Runbook For D1 Schema Rollback

The project SHALL document how to recover from a broken D1 migration. The runbook SHALL describe the backup capture cadence, the backup location, the restore procedure, and the data-loss boundary an operator accepts by invoking this path.

#### Scenario: Migration breaks production schema

- **WHEN** a migration merges to main and `wrangler d1 migrations apply` fails mid-run
- **THEN** the runbook tells the operator how to restore from the latest dump in `backups/d1/<YYYY-MM-DD>.sqlite.dump` and how to verify schema integrity post-restore

#### Scenario: Operator understands data-loss window

- **WHEN** the restore step runs
- **THEN** the runbook states clearly that any writes between the backup timestamp and the restore will be lost, and instructs how to manually reconcile if possible

<!-- @trace
source: deployment-manual
updated: 2026-04-20
code:
  - tmp/prod-backup-pre-affinity-fix.sql
  - scripts/checks/verify-auth-storage-consistency.sh
  - server/database/migrations/0007_better_auth_timestamp_affinity.sql
  - tmp/dry-run-bad.sqlite
  - tmp/dry-run.sqlite
-->

---

### Requirement: Disaster Recovery Runbook For R2 Object Restoration

The project SHALL document how to restore R2 objects after accidental deletion or overwrite. The runbook SHALL describe both version-history restore (where supported) and backup-copy restore procedures.

#### Scenario: Accidental R2 delete

- **WHEN** a script or operator accidentally deletes an R2 object
- **THEN** the runbook walks through Cloudflare R2 version history restoration (if versioning is enabled) or points to the backup prefix with restoration commands

<!-- @trace
source: deployment-manual
updated: 2026-04-20
code:
  - tmp/prod-backup-pre-affinity-fix.sql
  - scripts/checks/verify-auth-storage-consistency.sh
  - server/database/migrations/0007_better_auth_timestamp_affinity.sql
  - tmp/dry-run-bad.sqlite
  - tmp/dry-run.sqlite
-->

---

### Requirement: Secrets And Env Var Restoration Procedure

The project SHALL document how to restore OAuth client secrets, `ADMIN_EMAIL_ALLOWLIST`, and other secrets after vault loss or accidental revocation. The runbook SHALL describe secret storage location, rotation cadence, and rotation commands.

#### Scenario: OAuth client secret must be rotated

- **WHEN** an operator rotates the Google OAuth client secret
- **THEN** the runbook lists the exact commands (`wrangler secret put`), the verification step (test login), and the rollback strategy if the new secret fails

#### Scenario: Allowlist env var is accidentally cleared

- **WHEN** `ADMIN_EMAIL_ALLOWLIST` is accidentally emptied in production
- **THEN** the runbook instructs how to restore from the vault backup and how to verify admin access is recovered on next login

<!-- @trace
source: deployment-manual
updated: 2026-04-20
code:
  - tmp/prod-backup-pre-affinity-fix.sql
  - scripts/checks/verify-auth-storage-consistency.sh
  - server/database/migrations/0007_better_auth_timestamp_affinity.sql
  - tmp/dry-run-bad.sqlite
  - tmp/dry-run.sqlite
-->

---

### Requirement: Consolidated Env Var Reference

The deployment documentation SHALL include a single table listing every env var used by the system, with columns: name, purpose, example format, sensitivity (public/secret), and default value per environment (Local / Staging / Production).

#### Scenario: Operator needs to know all env vars

- **WHEN** an operator sets up a new environment
- **THEN** a single reference table in the deployment docs lists every env var so nothing is forgotten

<!-- @trace
source: deployment-manual
updated: 2026-04-20
code:
  - tmp/prod-backup-pre-affinity-fix.sql
  - scripts/checks/verify-auth-storage-consistency.sh
  - server/database/migrations/0007_better_auth_timestamp_affinity.sql
  - tmp/dry-run-bad.sqlite
  - tmp/dry-run.sqlite
-->
