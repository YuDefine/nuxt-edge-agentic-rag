## 1. Workflow rewrite

- [x] 1.1 Replace the inline `Notify Discord` step with a two-step composition satisfying the "Notify job uses two-step composition" requirement: a "Build results JSON" pre-step (env-based, `id: build`) and a `uses: YuDefine/clade/.github/actions/discord-deploy-notify@v1` step
- [x] 1.2 Implement the "Target resolution rule" in the pre-step using the existing `${{ github.event_name == 'workflow_dispatch' && github.event.inputs.target || (startsWith(github.ref, 'refs/tags/v') && 'production' || 'staging') }}` expression as `TARGET` env
- [x] 1.3 Implement the "Results JSON construction" requirement: bash branching on `TARGET`, then `jq -nc` builds the 5-entry array (CI / Deploy / Smoke / Docs Deploy / Docs Smoke) and emits `results` + `target` to `$GITHUB_OUTPUT`
- [x] 1.4 Wire the `Notify Discord` step's inputs per the "Action input wiring" requirement (webhook_url / target from outputs / language=zh / results from outputs); drop the `if: env.WEBHOOK_URL != ''` guard

## 2. Local validation

- [x] 2.1 Confirm yaml is valid (`yamllint` or visual inspection of indentation, string quoting, expression escaping inside the heredoc-style results JSON)
- [x] 2.2 Visually re-read the diff against the pre-migration job to verify behavior preservation: 9-job needs unchanged, runs-on unchanged, target precedence rule unchanged, only the step body shape changed

## 3. Ship to main

- [x] 3.1 Commit the deploy.yml + openspec/ change directly to `main` (solo repo, flow=main per clade `consumers.local`); push
- [x] 3.2 Verify GitHub Actions repo settings already allow `YuDefine` actions (already confirmed: `allowed_actions: all`)

## 4. Live verification

- [ ] 4.1 Trigger a deploy via `workflow_dispatch` with `target=staging` (or wait for the next planned tag/main push); confirm the Discord embed renders with `[Stg]` segment, 5 fields, color matching outcome, zh title strings
- [ ] 4.2 Mark this change archived once 4.1 succeeds
