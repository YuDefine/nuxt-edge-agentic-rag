# Handoff

## In Progress

無 active spectra change，無 uncommitted WIP。`5a477e7`（TD-057 SSE wide
event lifecycle child request logger fix + TD-056/061 judge
`max_completion_tokens 200 → 1024`）已隨 v0.52.1 deploy 推上 production，**驗收時機已到**。

## Blocked

### Notion Secret 頁面同步 pending（使用者手動）

`main-v0.0.54-acceptance` token 已 revoke（2026-04-26T01:05Z），但 Notion
「Application-layer MCP bearer tokens」表格**尚未同步標記 revoked**：

- Staging entry `84f108e9-baec-4f7d-b6d4-877d21ee4f4c`
- Production entry `b73f0d8c-85b3-4bbf-ba68-74780f2189b2`

理由：本次 session Notion MCP 不可用，必須使用者手動進 Notion 改。

## Next Steps

優先序由高至低：

1. **v0.52.1 production verify**（最優先，剛 ship）：
   - **TD-057** wrangler tail 觀察 1-2 條真實 SSE chat：
     - `[evlog] log.error/log.set called after the wide event was emitted`
       warning 應消失
     - wide event 觀察到 `operation: 'web-chat-sse-stream'` 子事件帶
       `_parentRequestId` + `result` / `error` 欄位
   - **TD-056 / TD-061** 24-48 hr 後撈 D1 確認：
     ```sql
     SELECT decision_path, COUNT(*) FROM query_logs
     WHERE created_at >= datetime('now', '-1 days')
     GROUP BY decision_path;
     ```
     `pipeline_error` 比例應 < 5%（baseline 28.6%）。
2. **Notion Secret 頁面同步**（見 Blocked 區塊；使用者親手做）。
3. 後續實作 / 修復方向見 `openspec/ROADMAP.md > Next Moves > 近期`：
   - TD-060 retrieval query gap fix（high，下一條 propose 主軸）
   - 第二輪 main-v0.0.54-acceptance（依賴 TD-060）
   - TD-058 user_profiles 6 條 orphaned rows（low）

## 注意事項

- **Production 35 筆 query_logs 保留作 TD-061 incident 證據**：不 DELETE。
  下次調查 pipeline_error 時 query `created_at >= '2026-04-26T00:49:30'`
  即可拉到全部 35 筆原始紀錄。
- **下次需要 eval token 時用** `pnpm mint:dev-mcp-token`（local）或
  `/admin/tokens` UI mint 新 token；**不要復用已 revoked token**。
