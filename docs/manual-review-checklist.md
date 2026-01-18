# 人工檢查共用清單

這份清單提供 Spectra tasks artifact 挑選人工檢查項目時的共用來源。實際 change 只需要附上與當次能力範圍直接相關的條目。

## 目前階段

- 開發主線以 `openspec/changes/bootstrap-v1-core-from-report/` 為唯一 capability 追蹤來源。
- 獨立 cleanup TODO 已整併回 roadmap、change tasks 與本清單；人工驗收前不應再依賴額外的待辦檔案判斷範圍。

## Cleanup Gate

- login surface 僅保留報告定義的 Google OAuth 主線，不保留 email/password、GitHub OAuth 或其他未納入 `v1.0.0` 的登入入口。
- shared layout、首頁與登入後 landing 保持中性 knowledge-project shell，不使用 starter 歡迎頁或暗示已完成產品的文案。
- `.env.example`、`nuxt.config.ts`、auth config 與 package scripts 不保留明顯錯誤的 provider / env / local tooling 預設。
- repo 中若仍存在 starter 殘留，必須先判定是「可沿用骨架」還是「應移除或改名」，再進入 6.2 Manual Acceptance。
- 驗收前的 `git status` 應只剩有意識的 cleanup、驗收支援或核心閉環相關變更。

## 核心閉環

- 實際完成一次登入 → 文件發布 → Web 問答 → 引用回放的 happy path。
- 切換 current version 後重新提問，確認正式回答不再引用舊版內容。
- 驗證引用卡片資訊與 `getDocumentChunk` 回放內容一致。

## 權限與治理

- 以 Web User、Web Admin 與不同 scope 的 MCP token 驗證 `allowed_access_levels` 是否正確。
- 驗證 restricted 內容對無權限呼叫者維持 existence-hiding 或 `403` 邊界，而不洩漏片段。
- 檢查 `query_logs`、`messages` 與相關事件只保存遮罩後資料或標記。
- 驗證 `/api/chat` 與 MCP tools 超限時回 `429`，且不繼續消耗後端工作。

## MCP 契約

- 先用 `askKnowledge` 取得回答，再用 `getDocumentChunk` 回放其中一筆引用。
- 驗證 `searchKnowledge` 查無結果時回 `200` 與空陣列，而不是 `404`。
- 驗證 `listCategories(includeCounts=true)` 只計可見 `active + current` 文件，且不重複計歷史版本。

## 介面與操作

- 確認登入、問答、引用查看與後台頁面在手機／平板顯示正常。
- 驗證失敗狀態、拒答訊息與權限不足提示沒有暴露內部診斷欄位。
