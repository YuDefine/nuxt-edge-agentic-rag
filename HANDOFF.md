# Handoff

## In Progress

（無 active spectra change — `collapsible-chat-history-sidebar` 已 archive 至
`openspec/changes/archive/2026-04-24-collapsible-chat-history-sidebar/`）

## Next Steps

1. **Deploy 後 smoke `/admin/usage`**：`fix(admin-usage)` 改為從 Cloudflare
   Workers env 讀 secret；production / staging 第一次請求前確認
   `wrangler secret put` 已寫入 `CLOUDFLARE_ACCOUNT_ID` /
   `CLOUDFLARE_API_TOKEN_ANALYTICS` / `NUXT_KNOWLEDGE_AI_GATEWAY_ID`，
   admin 進 `/admin/usage` 不再回 503「尚未設定完成」。
2. **選擇要處理的 open TD**：上一輪新增 TD-021~024（chat-history-sidebar 的
   low-priority follow-up：aria-expanded、midnight 重分組、雙重 fetch、測試品
   質）。若要開下一個 change，`pnpm spectra:followups` 盤點 open 清單。
