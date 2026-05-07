## Why

`deploy.yml` notify job inlines a ~70-line Discord webhook step that currently uses a degraded variant of the canonical implementation: missing the `icon()` helper, no per-job fields, English-only status strings. Replacing it with `YuDefine/clade/.github/actions/discord-deploy-notify@v1` (1) shrinks the workflow body, (2) adopts the standardized `[Prod]` / `[Stg]` title format, (3) regains per-job fields with status icons, (4) standardizes language to `zh` to match the rest of the consumer fleet (yuntech, TDMS).

## What Changes

- Replace the entire shell-script body of `Notify Discord` step in `.github/workflows/deploy.yml` with a 2-step composition:
  1. New "Build results" pre-step that resolves `target` (using existing `workflow_dispatch.inputs.target` || tag-detection fallback) and assembles a 5-entry `results` JSON for the active target (CI / Deploy / Smoke / Docs Deploy / Docs Smoke).
  2. `uses: YuDefine/clade/.github/actions/discord-deploy-notify@v1` step consuming the pre-step's outputs.
- Drop the `if: env.WEBHOOK_URL != ''` guard — action's built-in empty-webhook skip behavior covers it.
- Standardize `language: zh` (was English-inline). Title format becomes `✅ 部署成功 — Deploy [Prod] — <tag>` (consistent with yuntech).
- Preserve the `notify` job wrapper unchanged: `runs-on: ubuntu-latest`, `if: always()`, `needs: [...9 jobs]`, `timeout-minutes: 1`.

## Non-Goals

- Reducing the `needs:` array. The 9-job dependency is correct — notify needs `if: always()` to fire whether prod or staging deployed, and needs all 9 results available to pick the right subset.
- Adding new fields beyond CI / Deploy / Smoke / Docs Deploy / Docs Smoke. Existing data model preserved.
- Removing the prod-vs-staging branching in the pre-step. Mailing only the active target's results matches the pre-migration semantic.
- Switching from `runs-on: ubuntu-latest` to `self-hosted` or vice versa. Runner choice is unrelated.

## Capabilities

### New Capabilities

- `deploy-discord-notify`: agentic-rag's deploy workflow notifies Discord by delegating to the shared composite action, with a target-resolution and results-assembly pre-step that picks the active environment's per-job results from the 9-job `needs:` graph.

### Modified Capabilities

(none)

## Impact

- Affected specs: new `deploy-discord-notify`.
- Affected code:
  - Modified: `.github/workflows/deploy.yml` (notify job step body becomes 2 steps, ~70 → ~30 lines).
  - New: (none)
  - Removed: (none)
- Affected processes: post-merge, the next deploy run (push to `v*` tag for production, push to `main` or workflow_dispatch for staging) becomes the live verification.
- GitHub repo settings: `allowed_actions: all` already verified, no setting change needed.
