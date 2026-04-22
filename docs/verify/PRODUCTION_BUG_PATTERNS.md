# Production Bug Patterns

上線後才發現、在 code review 階段未被攔截的錯誤模式。記錄這些模式以防止重複發生。

## Review Checklist

新增或修改功能時，回顧此文件確認是否觸及已知的 bug pattern。

> 此文件為 living document，隨著生產環境問題的發現逐步累積 pattern。Auto-Harness 的知識萃取機制會在適當時機自動新增條目。

## Deploy Smoke Test False Green

- Pattern：把 `403` / WAF 擋下視為 deploy smoke test 成功，即使沒有任何 endpoint 真正回 `200`
- Why it slips：容易把「GitHub runner 被 Cloudflare 擋」和「站點其實不可用」混成同一類 warning
- Guardrail：
  - deploy health check 至少要有一個 target 真正回 `200`
  - custom domain 若回 `403`，只能當 warning；仍必須要求 fallback deployment URL 驗證成功
  - 測試要覆蓋「全部 target 都 403」時應該 fail

## Staging Migration Ledger Drift

- Pattern：`d1_migrations` 已標記 `0001` 完成，但 staging DB 缺少 better-auth 基底表，導致後續 migration 直接撞 `no such table`
- Why it slips：空 DB happy path 會綠，但無法覆蓋「ledger 已前進、實體 schema 不完整」這種實際環境殘留狀態
- Guardrail：
  - workflow 先手動執行 `0001_bootstrap_v1_core.sql`，再跑剩餘 migrations
  - integration test 必須模擬 drift 狀態，而不是只驗證 fresh DB
