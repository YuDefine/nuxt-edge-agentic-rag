# deploy-discord-notify Specification

## Purpose

TBD - created by archiving change 'migrate-deploy-notify-to-clade-action'. Update Purpose after archive.

## Requirements

### Requirement: Notify job uses two-step composition

The `notify` job in `.github/workflows/deploy.yml` SHALL contain exactly two steps: a "Build results JSON" pre-step that computes `target` and `results` outputs, followed by a `Notify Discord` step that calls `uses: ./.github/actions/discord-deploy-notify`. No inline `curl` / `jq` payload assembly is permitted in the notify job body.

#### Scenario: notify job structure

- **WHEN** GitHub Actions parses `deploy.yml`
- **THEN** the `notify` job has exactly two steps in `steps:` — one with `id: build` (or equivalent identifier) and one with `uses: ./.github/actions/discord-deploy-notify`

#### Scenario: original wrapper structure preserved

- **WHEN** comparing the migrated `notify` job to the pre-migration job
- **THEN** the job's `runs-on`, `if: always()`, `needs:` (all 9 jobs), and `timeout-minutes: 1` are unchanged


<!-- @trace
source: migrate-deploy-notify-to-clade-action
updated: 2026-06-08
code:
  - HANDOFF.md
-->

---
### Requirement: Target resolution rule

The "Build results" pre-step SHALL resolve `target` by the following precedence, identical to the pre-migration logic:

1. If the workflow event is `workflow_dispatch`, use `github.event.inputs.target`.
2. Else, if `github.ref` starts with `refs/tags/v`, use `production`.
3. Otherwise, use `staging`.

#### Scenario: workflow_dispatch with explicit target

- **WHEN** the workflow is triggered via `workflow_dispatch` with `inputs.target=staging`
- **THEN** the pre-step resolves `target=staging` regardless of the ref

#### Scenario: tag push falls into production

- **WHEN** the workflow is triggered by `push` to `refs/tags/v1.2.3`
- **THEN** the pre-step resolves `target=production`

#### Scenario: branch push defaults to staging

- **WHEN** the workflow is triggered by `push` to a non-tag ref (e.g., `refs/heads/main`)
- **THEN** the pre-step resolves `target=staging`


<!-- @trace
source: migrate-deploy-notify-to-clade-action
updated: 2026-06-08
code:
  - HANDOFF.md
-->

---
### Requirement: Results JSON construction

The "Build results" pre-step SHALL emit a `results` step output containing a JSON array of exactly 5 entries with these `name` values, in this order: `CI`, `Deploy`, `Smoke`, `Docs Deploy`, `Docs Smoke`. The `result` field of each entry SHALL be drawn from `needs.<job>.result` according to the resolved target:

| Entry name    | If `target=production`                    | If `target=staging`                    |
| ------------- | ----------------------------------------- | -------------------------------------- |
| `CI`          | `needs.verify-ci-gate.result`             | `needs.verify-ci-gate.result`          |
| `Deploy`      | `needs.deploy-production.result`          | `needs.deploy-staging.result`          |
| `Smoke`       | `needs.smoke-test.result`                 | `needs.smoke-test-staging.result`      |
| `Docs Deploy` | `needs.deploy-docs-production.result`     | `needs.deploy-docs-staging.result`     |
| `Docs Smoke`  | `needs.smoke-test-docs-production.result` | `needs.smoke-test-docs-staging.result` |

#### Scenario: production results assembly

- **WHEN** target resolves to `production` and `verify-ci-gate=success`, `deploy-production=success`, `smoke-test=failure`, `deploy-docs-production=success`, `smoke-test-docs-production=skipped`
- **THEN** the pre-step's `results` output is a JSON array `[{name:"CI",result:"success"},{name:"Deploy",result:"success"},{name:"Smoke",result:"failure"},{name:"Docs Deploy",result:"success"},{name:"Docs Smoke",result:"skipped"}]`

#### Scenario: staging results assembly

- **WHEN** target resolves to `staging` and the corresponding 4 staging-side jobs all report `success`, with `verify-ci-gate=success`
- **THEN** the pre-step's `results` output contains 5 entries all with `result=success`, and the action computes overall `succeeded` (color 3066993)


<!-- @trace
source: migrate-deploy-notify-to-clade-action
updated: 2026-06-08
code:
  - HANDOFF.md
-->

---
### Requirement: Action input wiring

The `Notify Discord` step SHALL pass these action inputs:

- `webhook_url`: `${{ secrets.DISCORD_WEBHOOK_URL }}`
- `target`: `${{ steps.<build-step-id>.outputs.target }}` (the resolved target from the pre-step)
- `language`: literal `zh` (standardized across consumers; replaces the prior English-inline strings)
- `results`: `${{ steps.<build-step-id>.outputs.results }}` (the JSON array from the pre-step)

Inputs `title` and `tag` SHALL be omitted, accepting defaults (`title=Deploy`, `tag` falls back to `${{ github.ref_name }}`).

#### Scenario: production tag push embed

- **WHEN** the workflow is triggered by tag push `v1.2.3`, all 5 active-target jobs report `success`
- **THEN** the action posts an embed with title `✅ 部署成功 — Deploy [Prod] — v1.2.3`, color 3066993, and 5 fields each prefixed with ✅

#### Scenario: staging branch push with one failure

- **WHEN** the workflow is triggered by push to `main`, `deploy-staging=failure`, others succeed
- **THEN** the action posts an embed with title `❌ 部署失敗 — Deploy [Stg] — main`, color 15158332, and 5 fields with the staging Deploy field showing `❌ failure`

##### Example: full migrated step shape

```yaml
- name: Build results JSON
  id: build
  env:
    TARGET: ${{ github.event_name == 'workflow_dispatch' && github.event.inputs.target || (startsWith(github.ref, 'refs/tags/v') && 'production' || 'staging') }}
    CI_RESULT: ${{ needs.verify-ci-gate.result }}
    PROD_DEPLOY: ${{ needs.deploy-production.result }}
    PROD_SMOKE: ${{ needs.smoke-test.result }}
    PROD_DOCS_DEPLOY: ${{ needs.deploy-docs-production.result }}
    PROD_DOCS_SMOKE: ${{ needs.smoke-test-docs-production.result }}
    STG_DEPLOY: ${{ needs.deploy-staging.result }}
    STG_SMOKE: ${{ needs.smoke-test-staging.result }}
    STG_DOCS_DEPLOY: ${{ needs.deploy-docs-staging.result }}
    STG_DOCS_SMOKE: ${{ needs.smoke-test-docs-staging.result }}
  run: |
    set -euo pipefail
    if [ "$TARGET" = "staging" ]; then
      DEPLOY="$STG_DEPLOY"; SMOKE="$STG_SMOKE"
      DOCS_DEPLOY="$STG_DOCS_DEPLOY"; DOCS_SMOKE="$STG_DOCS_SMOKE"
    else
      DEPLOY="$PROD_DEPLOY"; SMOKE="$PROD_SMOKE"
      DOCS_DEPLOY="$PROD_DOCS_DEPLOY"; DOCS_SMOKE="$PROD_DOCS_SMOKE"
    fi
    RESULTS=$(jq -nc \
      --arg ci "$CI_RESULT" \
      --arg deploy "$DEPLOY" --arg smoke "$SMOKE" \
      --arg docs_deploy "$DOCS_DEPLOY" --arg docs_smoke "$DOCS_SMOKE" \
      '[{name:"CI",result:$ci},{name:"Deploy",result:$deploy},{name:"Smoke",result:$smoke},{name:"Docs Deploy",result:$docs_deploy},{name:"Docs Smoke",result:$docs_smoke}]')
    {
      echo "target=$TARGET"
      echo "results<<EOF"
      echo "$RESULTS"
      echo "EOF"
    } >> "$GITHUB_OUTPUT"

- name: Notify Discord
  uses: ./.github/actions/discord-deploy-notify
  with:
    webhook_url: ${{ secrets.DISCORD_WEBHOOK_URL }}
    target: ${{ steps.build.outputs.target }}
    language: zh
    results: ${{ steps.build.outputs.results }}
```

<!-- @trace
source: migrate-deploy-notify-to-clade-action
updated: 2026-06-08
code:
  - HANDOFF.md
-->