# Handoff

## In Progress

（無 active spectra change — `collapsible-chat-history-sidebar` 已 archive 至
`openspec/changes/archive/2026-04-24-collapsible-chat-history-sidebar/`）

## Next Steps

1. **Deploy 後 smoke `/admin/usage`**：上一輪 `fix(admin-usage)` 改為從
   Cloudflare Workers env 讀 secret；production / staging 第一次請求前確認
   `wrangler secret put` 已寫入 `CLOUDFLARE_ACCOUNT_ID` /
   `CLOUDFLARE_API_TOKEN_ANALYTICS` / `NUXT_KNOWLEDGE_AI_GATEWAY_ID`，
   admin 進 `/admin/usage` 不再回 503「尚未設定完成」。
2. **驗證日期格式變化**：本次 refactor 把 6 個頁面的日期顯示從 `YYYY/MM/DD HH:mm`
   （零填充月日、無秒）改成 `YYYY/M/D HH:mm:ss`（非零填充、含秒）。deploy 後到
   `/account/settings`、`/admin/documents/:id`、`/admin/members`、
   `/admin/query-logs`（list + detail）、`/admin/tokens` 目視確認新格式符合預期，
   若不滿意可調整 `app/utils/format-datetime.ts`。
3. **選擇要處理的 open TD**：
   - TD-009（user_profiles.email_normalized 全面改 nullable）本次由 done 改回
     open，sentinel workaround 仍在；若要處理需在下個 migration 實際 drop
     sentinel。
   - TD-021~024 是 chat-history-sidebar 的 low-priority follow-up
     （aria-expanded、midnight 重分組、雙重 fetch、測試品質）。
   - `pnpm spectra:followups` 盤點完整 open 清單。
