# Handoff

## In Progress

- [ ] **add-sse-resilience** — code 已 ship 到 v0.48.0（commit `cd43bf2`）。剩 archive 收尾：
  - 7.2 production wrangler tail 看真實 chat 的 `: keep-alive`（v0.49.0 已 deploy 完成，立刻可驗）
  - 5.1 / 5.2 archive-time 自動處理（spec delta 合併、TD-019 改 done、TD-015 留 open）
- [ ] **persist-refusal-and-label-new-chat** — code 已 ship 到 v0.49.0（commit `76a805d`）。剩 archive 收尾：
  - 該 change 的 `## 人工檢查`（若有）逐項驗收
  - `/spectra-archive persist-refusal-and-label-new-chat`

## Blocked

- 無

## Next Steps

1. **立刻可做** — 7.2 production verify：`pnpm wrangler tail --format=pretty` 串流 production logs，UI 發一條 chat（或 curl `https://<production-url>/api/chat`），確認 SSE stream 出現 `: keep-alive` 行。看到後可勾 7.2、跑 `/spectra-archive add-sse-resilience`。
2. **Archive add-sse-resilience** — 7.2 通過後立刻歸檔。archive 時 5.1（spec delta 合併）+ 5.2（TD-019 改 done、TD-015 留 open）會自動處理。
3. **Archive persist-refusal-and-label-new-chat** — 該 change 的人工檢查項目走完後 `/spectra-archive`。
4. **TD-055 fix change** — 開獨立小 change（建議名 `fix-fk-rebuild-query-logs-chain`），仿 migration 0012 pattern 寫 `0014_fk_rebuild_query_logs_chain.sql`，對 production D1 為 no-op、對 fresh local libsql 修好 `query_logs` / `messages` / `citation_records` 三張表的 `_new` 殘留 FK。優先級 high — 任何 fresh local dev 都會撞到。
5. **TD-015 post-archive follow-up**（不阻擋 archive，但要追）：
   - production 觀察 7 天，比對 `chat.error` 計數無顯著上升（建議用 `/schedule` 開 background agent，2026-05-03 提醒）
   - 隨機抽 10 條 production chat run，確認 first-token-ts 對應第一個 `delta` event、未被 keep-alive 行誤計
6. **Parked changes** — `add-mcp-token-revoke-do-cleanup`、`passkey-user-profiles-nullable-email` 仍 parked，待使用者決定 unpark / 重排 / drop。

## 注意事項

- v0.49.0 在 ship 過程中發現本機 `.data/db/sqlite.db` 處於 TD-051 漏網狀態（`mcp_tokens_new` / `query_logs_new` 殘留 FK），已用 local-only SQL patch 修好（backup 在 `.data/db/sqlite.db.bak-pre-mcptokens-fk` 和 `.bak-pre-querylogs-fk-v2`）。**這個本機修補只是讓 7.1 能跑通**，repo 內 migrations 仍有同樣 bug — 任何 fresh local DB 重建都會再撞，**必須**靠 TD-055 的新 migration 才能根治。
- v0.49.0 ship 中由 simplify agent polish 了 `server/utils/web-chat.ts`（consolidate 5 處 nowDate、移除冗餘 auditStore guard），保留了 P1 / P2 觀察未修：pipeline-error 路徑下 refusal 持久化目前綁在 `updateQueryLog` 存在的條件下，理論上 fixture 缺 `updateQueryLog` 會吞掉 refusal — production wiring 都有 `updateQueryLog` 故無感，但建議併進下次 web-chat refactor 時解開。
- `local/excalidraw-diagram-workbench` submodule 仍 dirty（sha 不變、內部 working tree 未 commit），不影響 ship。
- `.bak-pre-*` 三份 sqlite.db backup 在 `.data/db/`，跑完 7.2 確認沒問題後可以清掉。
