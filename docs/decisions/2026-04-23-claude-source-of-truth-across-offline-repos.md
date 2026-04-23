# `.claude` Source Of Truth Across Offline Repos

## Context

在 `~/offline` 內，已經有多個 repo 同時存在 `.claude/`、`.agents/`、`.codex/`、`AGENTS.md` 與 `CLAUDE.md`。目前它們的治理模式並不一致：

- 有些 repo 把 `.claude/` 當 source
- 有些 repo 只有部分 `.claude` 資產
- 有些 repo 已有 `.agents/` / `.codex/`，但沒有明確的 sync 設定
- 多數 repo 的 `CLAUDE.md` 仍然偏長，還沒收斂成「極簡入口 + 規則下沉」

這會讓跨 repo 維護與 Codex 理解成本持續上升。

## Decision

`~/offline` 內採用下列治理模型：

1. `.claude/` 是唯一真理
2. `CLAUDE.md` 是 source 入口，但必須極簡
3. `AGENTS.md`、`.agents/`、`.codex/` 都視為由 `sync-to-agents` 產出的投影
4. 規則細節優先放在 `.claude/rules/` 與 `.claude/skills/`
5. 不再把 `.github/instructions/` 視為必要依賴
6. 專題報告治理也應下沉到 `.claude/rules/`，入口檔只保留 rule pointer

## Minimal `CLAUDE.md` Template

目標不是把所有規則塞回 `CLAUDE.md`，而是保留高價值入口資訊，讓 sync 可以穩定投影到 Codex surface。

建議模板：

```md
# <Project Name>

## Language

- 使用繁體中文

## Source Of Truth

- `.claude/` 是唯一真理
- 規則看 `.claude/rules/`
- workflow / skills 看 `.claude/skills/`
- `AGENTS.md`、`.agents/`、`.codex/` 都由 sync 產生，不直接當 source 編修

## Critical Rules

- 只保留跨任務都成立的 MUST / NEVER
- 只保留最關鍵的路徑、語言、驗收或安全規則

## Specs / Project Context

- 若有 Spectra / OpenSpec，只保留入口與最小 workflow

## Sync

- 定期執行 `node ~/.claude/scripts/sync-to-agents.mjs`
- 若 repo 有專案特化 promotion，放在 `.claude/sync-to-agents.config.json`
```

實務目標：

- 建議控制在 `40-80` 行
- 超過 `100` 行通常代表仍有內容應下沉到 `.claude/rules/` 或 skills

## Audit Result

以下只統計具備 `full_source` 條件的 repo：有 `CLAUDE.md`，且有 `.claude/skills/`。

| Repo                                         | CLAUDE 行數 | 分類    | `.claude/rules` | sync config | 判定                                       |
| -------------------------------------------- | ----------: | ------- | --------------- | ----------- | ------------------------------------------ |
| `TDMS`                                       |         135 | heavy   | yes             | no          | 不符合極簡                                 |
| `eHR-2.0-alpha`                              |          67 | medium  | no              | no          | 接近，但 source 分層不完整                 |
| `excalidraw-diagram-workbench`               |          35 | minimal | yes             | no          | 最接近目標                                 |
| `ledger`                                     |          96 | medium  | yes             | no          | 還需收斂                                   |
| `nuxt-supabase-starter/template`             |         134 | heavy   | yes             | no          | 不符合極簡                                 |
| `perno`                                      |         135 | heavy   | yes             | no          | 不符合極簡                                 |
| `swc-movie-box-office-analysis`              |          80 | medium  | no              | no          | 接近，但缺 rules/source 分層               |
| `yuntech-project/repo/nuxt-edge-agentic-rag` |          70 | medium  | yes             | yes         | 已收斂成 source-first 入口，可作為樣板起點 |
| `yuntech-usr-sroi`                           |         143 | heavy   | yes             | no          | 不符合極簡                                 |

## Implications

- 目前只有 `nuxt-edge-agentic-rag` 明確有 `.claude/sync-to-agents.config.json`
- `excalidraw-diagram-workbench` 的 `CLAUDE.md` 最接近極簡入口，但尚未補 sync config
- `nuxt-edge-agentic-rag` 的 sync 治理最完整，且 `CLAUDE.md` 已收斂成 source-first 入口
- `TDMS`、`perno`、`nuxt-supabase-starter/template`、`yuntech-usr-sroi` 都應優先把內嵌的大段 workflow 下沉
- `eHR-2.0-alpha` 與 `swc-movie-box-office-analysis` 若要納入這套治理，需先補 `.claude/rules/`

## Next Steps

1. 以 `nuxt-edge-agentic-rag` 的 source-first `CLAUDE.md` 作為樣板
2. 依樣板整理 `TDMS`、`perno`、`nuxt-supabase-starter/template`、`yuntech-usr-sroi`
3. 為其餘 `full_source` repo 補上 `.claude/sync-to-agents.config.json`
4. 最後再評估 `claude_only` / `skills_only` repo 是否要升級到同一治理模型
