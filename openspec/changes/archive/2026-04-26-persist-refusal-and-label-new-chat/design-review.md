# Design Review — persist-refusal-and-label-new-chat

> 日期：2026-04-25
> 審查者：screenshot-review agent
> 工具：Playwright (Chromium)
> Viewport：360 / 768 / 1280

## Design Fidelity Report

| #   | 項目                                                 | 驗收條件                                                                           | 狀態                 | 截圖                                                                                        |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| A1  | Chat header「新對話」按鈕 @ 1280                     | icon + 文字「新對話」可見；variant=soft, color=primary, size=sm                    | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-A-chat-header.png`               |
| A2  | Chat header「新對話」按鈕 @ 768                      | icon + 文字「新對話」可見（不應只剩 icon）                                         | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/768-A-chat-header.png`                |
| A3  | Chat header「新對話」按鈕 @ 360                      | icon + 文字「新對話」可見（不應只剩 icon）                                         | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/360-A-chat-header.png`                |
| B1  | Sidebar expanded header「新對話」按鈕 @ 1280         | icon + 文字「新對話」可見；variant=soft, color=primary, size=xs                    | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-B-sidebar-expanded.png`          |
| B2  | Sidebar expanded @ 768                               | 768 進入 drawer 模式，expanded sidebar 不顯示（符合預期行為）                      | PASS (drawer mode)   | `screenshots/local/persist-refusal-and-label-new-chat/768-A-chat-header.png`                |
| B3  | Sidebar expanded @ 360                               | 360 進入 drawer 模式，expanded sidebar 不顯示（符合預期行為）                      | PASS (drawer mode)   | `screenshots/local/persist-refusal-and-label-new-chat/360-A-chat-header.png`                |
| C1  | Sidebar collapsed rail icon button — aria-label      | DOM 屬性 `aria-label="新對話"` 存在（ConversationHistory.vue:140）                 | PASS (code verified) | —                                                                                           |
| C2  | Sidebar collapsed rail icon button — 純 icon 顯示    | spec 允許此 entry point 僅 icon                                                    | PASS (code verified) | —                                                                                           |
| D1a | RefusalMessage restricted_scope — 標題               | 顯示「為什麼無法回答」                                                             | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-D1-restricted-scope-refusal.png` |
| D1b | RefusalMessage restricted_scope — 列點含敏感資訊說明 | 「您的提問內含敏感資訊（例如 API key、密碼、信用卡號等）」可見                     | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-D1-restricted-scope-refusal.png` |
| D1c | RefusalMessage restricted_scope — 列點含遮罩說明     | 「系統不會處理也不會留下原始內容」「所有相關紀錄已自動遮罩」可見                   | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-D1-restricted-scope-refusal.png` |
| D1d | RefusalMessage restricted_scope — 建議下一步         | 僅「改換關鍵字重新提問」+「聯絡管理員」；**無**「查看相關文件清單」                | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-D1-restricted-scope-refusal.png` |
| D2a | RefusalMessage no_citation — 標題                    | 顯示「為什麼無法回答」                                                             | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-D2-no-citation-refusal.png`      |
| D2b | RefusalMessage no_citation — 列點含知識庫說明        | 「知識庫中沒有與您的提問相符的文件」可見                                           | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-D2-no-citation-refusal.png`      |
| D2c | RefusalMessage no_citation — 列點含關鍵字說明        | 「可能的關鍵字尚未建檔，或主題不在範圍內」可見                                     | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-D2-no-citation-refusal.png`      |
| D2d | RefusalMessage no_citation — 建議下一步              | 「改換關鍵字重新提問」+「查看相關文件清單」（admin 可見）兩項皆顯示                | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-D2-no-citation-refusal.png`      |
| E1  | Reload recovery — RefusalMessage 完整還原            | reload 後同一對話的 RefusalMessage（no_citation）完整還原，含 reason-specific 文案 | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-E2-after-reload-sidebar.png`     |
| E2  | Reload recovery — sidebar 對話列表持久               | reload 後 sidebar 仍顯示所有先前建立的對話記錄（共 3 筆）                          | PASS                 | `screenshots/local/persist-refusal-and-label-new-chat/1280-E2-after-reload-sidebar.png`     |

## 觀察摘要

### A — Chat header 按鈕（全 viewport）

- 1280：sidebar 已展開，header 右上角顯示「新對話」按鈕（icon + label），符合 variant=soft, color=primary, size=sm
- 768：進入無 sidebar 模式，header 右上角仍顯示「新對話」按鈕（icon + label）
- 360：mobile drawer 模式，header 右上角仍顯示「新對話」按鈕（icon + label）
- 三個 viewport 全部保留文字 label，不因寬度縮小而僅顯示 icon，符合 spec 要求

### B — Sidebar expanded 按鈕

- 1280：sidebar 展開，對話記錄標題旁顯示「新對話」按鈕（icon + label），符合 size=xs
- 768 / 360：進入 drawer 模式，sidebar 不展開在旁側，此為預期行為（非 DRIFT）

### C — Sidebar collapsed rail 按鈕

- ConversationHistory.vue 第 134–143 行確認 `aria-label="新對話"` 存在
- icon-only 顯示，符合 spec「secondary entry point，允許純 icon」

### D1 — restricted_scope RefusalMessage

截圖可見完整 UI：

- 標題：「為什麼無法回答」（非「可能的原因」）✓
- 三條列點：敏感資訊說明 / 不處理不留存 / 自動遮罩 ✓
- 建議下一步：「改換關鍵字重新提問」+「聯絡管理員」（無「查看相關文件清單」）✓

### D2 — no_citation RefusalMessage

截圖可見完整 UI：

- 標題：「為什麼無法回答」✓
- 兩條列點：知識庫無相符文件 / 關鍵字尚未建檔或主題不在範圍內 ✓
- 建議下一步：「改換關鍵字重新提問」+「查看相關文件清單」✓（admin 登入可見）

### E — Reload recovery

- reload 後頁面透過 URL 路由直接還原到最後開啟的對話
- RefusalMessage（no_citation）在 reload 後完整呈現，reason-specific 文案不消失
- sidebar 顯示 3 筆對話記錄（D1 restricted_scope + D2 no_citation × 2 次建立）
- 核心 bug 修復（refusal 持久化）驗收通過

## Fidelity Score

**18 / 18 PASS — 0 DRIFT — 0 MISSING**

## 結論

**Design Fidelity 通過。**

所有驗收項目均符合 spec 預期，無需修正。截圖證據完整，可作為 archive 前的視覺 QA 紀錄。
