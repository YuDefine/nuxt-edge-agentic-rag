# Handoff

## In Progress

_(none — main-v0.0.45.md 升版已 archive 為 commit `971511d` / tag `v0.24.1`)_

## Next Steps

1. **跑 `frozen-final` 驗收集**：執行 `pnpm test:acceptance` + `pnpm test:contracts`（或 `pnpm verify:acceptance`），把 TC-01~20 與 UI state 測試結果整理進 v0.0.46 §3.3.2 表 3-7 / 表 3-8；把表 4-1 A01~A13 的「待驗證」依實際狀態回填。
2. **實機截圖 7 張**：派 `screenshot-review` agent 對 `/login`、`/chat`、`/admin/documents`、`/admin/tokens`、`/admin/members`、`/admin/settings/guest-policy`、`/admin/usage` 各拍一張（desktop + mobile viewport 建議各一組），放到 `screenshots/local/report-v46/`；拍完補到 v0.0.46 §3.2.3 各小節取代「待實作後截圖」字樣。
3. **EV 證據彙整**：把 `docs/verify/*RUNBOOK.md`（DEPLOYMENT / CONVERSATION_LIFECYCLE / DEBUG_SURFACE / RETENTION_CLEANUP / RESPONSIVE_A11Y / CONFIG_SNAPSHOT）既有內容摘進 v0.0.46 表 3-9 的「建議證據形式 / 通過條件」欄或新增「實際證據指向檔案」欄。
4. **附錄 D-1 部署環境變數清單**：補 `CLOUDFLARE_API_TOKEN_ANALYTICS`（AI Gateway Analytics read-only token）；檢查是否還有其他 B16/AI Gateway 引入的 env var 遺漏（`wrangler.jsonc` 與 `.env.example` 交叉核對）。
5. **tag push（如啟用遠端）**：目前 repo 無 `origin` remote，`v0.24.1` tag 只存 local。若將來要共享，需 `git remote add origin <url>` 後再 `git push origin --tags`。

## 注意事項

- 報告版本命名規則：v0.0.44 → v0.0.45（本次）→ v0.0.46（驗收跑完後）。**不可覆寫舊版**。
- §5.1 組員心得、§5.2.2 實作前待驗證事項仍保留「實作前」語氣，依 ROADMAP 原則留待實際驗收完成再回填。
- 本次升版只補「已實作但沒寫」，沒補「未實作的驗收產出」——跑報 / 截圖 / EV 仍依 §1.3.4 表 1-4 的回填時機原則處理。
