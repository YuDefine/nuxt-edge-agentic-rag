# Recognize Staging as an Active Environment

## Decision

將 `staging` 視為本專案的正式環境路徑之一。自即日起，專案文件、deploy workflow、驗證 runbook 與 spec 參照都應以 `local` / `staging` / `production` 三條環境路徑為準；不得再以「只有 local + production」作為當前系統狀態描述。

## Context

2026-04-23 盤點後可確認：

- `wrangler.staging.jsonc` 已存在，且綁定獨立的 Worker 名稱、route、D1、KV、R2 與 AI Search / AI Gateway 設定
- `.github/workflows/deploy.yml` 已有可手動 dispatch 的 `deploy-staging`、`deploy-docs-staging` 與對應 smoke test job
- `agentic-staging.yudefine.com.tw` 與 staging 文件站都已納入 verify / deploy 文件
- 驗證文件中仍殘留部分「local + production only」敘述，屬於文件漂移，不再反映實際部署拓樸

先前的 `2026-04-19-collapse-environments-to-local-and-production.md` 反映的是當時觀測到的狀態，但已不再代表目前系統事實。

## Reasoning

1. **部署真相優先**：既然 staging Worker、資料庫、儲存與網域都已存在，文件與 spec 必須承認它，而不是繼續沿用過時收斂說法。
2. **避免排障誤導**：這次 admin allowlist 與 deploy 設定排查已證明，若誤信「沒有 staging」，會把 workflow、wrangler 與 secret 漂移誤判成不存在的環境問題。
3. **維護成本可控**：目前 staging 路徑已成形，實際成本不是「是否建立」，而是「如何讓 build-time / runtime / runbook 維持一致」。

## Implications

- `wrangler.staging.jsonc` 必須與 staging build env、runtime secrets、GitHub Actions `STAGING_*` secrets / vars 保持同步
- 通用驗證文件應優先使用 `BASE_URL` / `DB_NAME` / `WRANGLER_CONFIG` 參數化，而不是硬編 production 目標
- production-only 文件可以保留 production 指令，但需明確標示其範圍，不可再冒充全專案環境真相
- 後續 spec 若需要引用環境策略，應優先指向本 decision，而非 2026-04-19 的收斂決策

## Supersedes

- `2026-04-19-collapse-environments-to-local-and-production.md`
