<!-- AUTO-GENERATED from .claude/ — 請勿手動編輯 -->


## Language

- 一律使用繁體中文，不要使用簡體中文。

## Source Of Truth

- `.claude/` 是本專案唯一真理。
- 規則 source 在 `.claude/rules/`。
- workflow / skills source 在 `.agents/skills/` 與 `.agents/commands/`。
- hooks / agents / settings source 在 `.claude/` 內對應路徑。
- `AGENTS.md`、`.agents/`、`.codex/` 都是投影；若需調整內容，先改 `.claude/`，再用 `sync-to-agents` 同步。

<!-- SPECTRA:START v1.0.2 -->

# Spectra Instructions

This project uses Spectra for Spec-Driven Development(SDD). Specs live in `openspec/specs/`, change proposals in `openspec/changes/`.

## Use `/spectra-*` skills when:

- A discussion needs structure before coding → `/spectra-discuss`
- User wants to plan, propose, or design a change → `/spectra-propose`
- Tasks are ready to implement → `/spectra-apply`
- There's an in-progress change to continue → `/spectra-ingest`
- User asks about specs or how something works → `/spectra-ask`
- Implementation is done → `/spectra-archive`
- Commit only files related to a specific change → `/spectra-commit`

## Workflow

discuss? → propose → apply ⇄ ingest → archive

- `discuss` is optional — skip if requirements are clear
- Requirements change mid-work? Plan mode → `ingest` → resume `apply`

## Parked Changes

Changes can be parked（暫存）— temporarily moved out of `openspec/changes/`. Parked changes won't appear in `spectra list` but can be found with `spectra list --parked`. To restore: `spectra unpark <name>`. The `/spectra-apply` and `/spectra-ingest` skills handle parked changes automatically.

<!-- SPECTRA:END -->

## Project Focus

- Nuxt Edge Agentic RAG 專案；專題報告治理與工作流規範都以 `.claude/` 為 source 維護。

## Rule Entry Points

- 專題報告治理：`.claude/rules/project-report.md`
- UX / Spectra workflow：`.claude/rules/ux-completeness.md`、`.claude/rules/proactive-skills.md`
- 其餘 shared rules：`.claude/rules/`
- workflow / skills：`.agents/skills/`、`.agents/commands/`

<!-- AUTO-SYNCED-RULE-INDEX:START -->

### All Rules（自動生成，source 在 `.claude/rules/`；請勿手編此區塊）

- `.claude/rules/agent-routing.md`
- `.claude/rules/api-patterns.md`
- `.claude/rules/auth.md`
- `.claude/rules/code-style.md`
- `.claude/rules/commit.md`
- `.claude/rules/database-access.md`
- `.claude/rules/development.md`
- `.claude/rules/error-handling.md`
- `.claude/rules/follow-up-register.md`
- `.claude/rules/handoff.md`
- `.claude/rules/knowledge-and-decisions.md`
- `.claude/rules/logging.md`
- `.claude/rules/manual-review.md`
- `.claude/rules/mcp-remote.md`
- `.claude/rules/migration.md`
- `.claude/rules/proactive-skills.md`
- `.claude/rules/query-optimization.md`
- `.claude/rules/review-tiers.md`
- `.claude/rules/rls-policy.md`
- `.claude/rules/scope-discipline.md`
- `.claude/rules/screenshot-strategy.md`
- `.claude/rules/storage.md`
- `.claude/rules/testing-anti-patterns.md`
- `.claude/rules/trigger.md`
- `.claude/rules/truth-layers.md`
- `.claude/rules/unused-features.md`
- `.claude/rules/ux-completeness.md`
- `.claude/rules/work-claims.md`

<!-- AUTO-SYNCED-RULE-INDEX:END -->

## Codex Projection

- 定期執行 `node ~/.claude/scripts/sync-to-agents.mjs`，讓 Codex surface 與 `.claude/` 保持一致。
- 專案特化 promotion 規則放在 `.claude/sync-to-agents.config.json`。
- 若 source 與投影不一致，以 `.claude/` 為準，之後再同步生成。

<!-- CLADE:SNIPPET:post-push-ci-watch:START -->
## Post-Push CI Watcher

當主線執行 `git push --tags`（或推單一 tag、或 push commit 觸發發版 workflow）**成功**後，**若**該 repo 含 `.github/workflows/*.yml` 且 `gh` CLI 可用：

**MUST** 立刻用 `Agent(run_in_background=true)` 開 watcher subagent 監看 GitHub Actions 結果，**NEVER** 自己同步 block 等待 — 主線繼續對話，watcher 完成時系統會自動通知主線。

### Watcher subagent prompt 模板

Subagent 任務應包含（cwd 設為 push 發生的 repo path）：

1. `gh run list --limit 1 --json databaseId,name,status,conclusion,url,headBranch,event,createdAt`
   - 若 list 空 / `gh` 未登入 / 無權限 → 回報 `status: unavailable` + 原因，結束
   - 若最新 run 的 `createdAt` 早於 push 時間（不是這次 push 觸發的） → 同上回報 unavailable
2. `timeout 900 gh run watch <databaseId> --exit-status`
   - exit 0 → `status: success`
   - exit 124 → `status: timeout`（15 min 上限）
   - 其他非 0 → `status: fail`；補跑 `gh run view <databaseId> --log-failed` 截前 200 行作 `logExcerpt`
3. 結構化回報（≤200 字）：
   - `status`、`runUrl`、`version`（由 `git describe --tags --abbrev=0` 抓；無 tag 則填 commit short sha）
   - 若 fail：`failedJob`、`logExcerpt`（節錄前 30 行）

### Watcher 完成後主線必做

- **success** → 一行報 `v<version> CI 綠燈 — <runUrl>` 後結束本話題，**NEVER** 多嘴
- **fail / timeout** → **MUST** 用 `request_user_input` 給使用者二選一：
  - `[1] 立刻 root-cause + 修` — 讀 `logExcerpt` 找根因，進除錯流程；修完前 **NEVER** 主動 push
  - `[2] 登記 HANDOFF.md` — 在 repo root 的 `HANDOFF.md` 末尾 append：
    ```
    - [ ] [<YYYY-MM-DD>] v<version> CI <fail|timeout> — <failedJob>
      - Run: <runUrl>
      - 根因猜測: <一行>
    ```
    若 `HANDOFF.md` 不存在 → 先建立骨架：
    ```
    # HANDOFF

    ## CI 紅燈待辦
    ```
- **unavailable** → 一行報「watcher 無法啟動（<原因>），略過」結束，**NEVER** 追問使用者

### 禁忌

- **NEVER** 在 watcher 回報前主動結束話題或叫 user 自己看
- **NEVER** 在 user 未選 `[1]` 前替他改 code / push commit 修 CI
- **NEVER** 對沒有 `.github/workflows/` 的 repo 套用這條規則（直接跳過 watcher）
- **NEVER** 重開新 watcher 取代尚在跑的 watcher（避免重複監看同一個 run）
<!-- CLADE:SNIPPET:post-push-ci-watch:END -->

# RTK Instructions

Use RTK (Rust Token Killer) to reduce token-heavy shell output when running commands through an AI coding assistant.

## Command Routing

- Prefer `rtk git status`, `rtk git diff`, `rtk git log`, `rtk gh ...` for Git and GitHub CLI output.
- Prefer `rtk pnpm ...`, `rtk npm ...`, `rtk vitest`, `rtk playwright test`, `rtk lint`, and `rtk tsc` for package manager, test, lint, and typecheck output.
- Prefer `rtk grep`, `rtk find`, `rtk read`, and `rtk ls` when the expected output is large.
- Use raw shell commands for small, structural, or shell-native operations such as `pwd`, `cd`, `mkdir`, `test`, `[ ... ]`, `[[ ... ]]`, `true`, `false`, `export`, `printf`, and `echo`.
- Do not rewrite shell builtins as RTK subcommands. For example, use `test -d path`, not `rtk test -d path`.
- For shell syntax, compound commands, heredocs, or commands RTK does not understand, use the raw command or `rtk proxy <command>` only when compact tracking is still useful.

## Sandbox Database

RTK tracking must use a Codex-writable database path:

```toml
[tracking]
database_path = "/Users/charles/.codex/memories/rtk/history.db"
```
