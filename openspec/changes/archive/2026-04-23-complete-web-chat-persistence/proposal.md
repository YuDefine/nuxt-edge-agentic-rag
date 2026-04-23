## Why

`local/reports/latest.md` 目前對 Web 聊天訊息持久保存的描述互相衝突：部分段落宣稱有 Web 對話持久化，部分段落又寫成現階段單輪、無持久化對話歷史。實際程式碼則已具備 `conversations/messages` 資料模型、`/api/chat` 的 `conversationId` 建立/重用、以及 `/api/conversations*` 讀取與刪除路由，但前端仍停留在 session-only 體驗，導致「後端已落地、前端未閉環、報告失真」的狀態。

本 change 的目的不是只修文案，而是把 Web 聊天訊息持久保存補成可答辯的完整功能，讓報告能明確寫成「已完成並驗證」。

## What Changes

- 完成 Web 對話持久保存閉環：新對話建立、同對話續問、歷史列表、對話讀取、刪除後不可回顯原文。
- 將前端 chat UI 接到既有 `conversations/messages` 真相來源，不再只依賴 client-only session state。
- 補齊驗收與證據：測試、必要截圖/證據輸出、以及報告同步更新。
- 清除報告中所有「未支援 / 後續補齊 / 單輪無持久化」但已不符合 shipped behavior 的敘述。

## Non-Goals (optional)

- 不把 MCP 改成多輪有狀態協定。
- 不重做整體 chat 視覺設計；僅補齊與持久保存直接相關的互動。
- 不改變既有治理核心：刪除對話後 `content_text` purge、`content_redacted` 僅供稽核、stale follow-up 仍以 fresh retrieval 為準。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `web-chat-ui`: 將既有 persisted conversation requirement 從部分落地補成完整前端可用行為。
- `conversation-lifecycle-governance`: 讓現有刪除、可見性與 stale follow-up 規則真正落到 Web 使用流程。
- `acceptance-evidence-automation`: 補齊 Web 持久化流程的可執行驗證與證據輸出。
- `report-artifact-governance`: 要求 current report 只能描述本輪實際 shipped 且已驗證的聊天持久保存能力。

## Impact

- 前端：`app/components/chat/*`、可能包含 `app/pages/index.vue` 或 chat page 狀態管理。
- 後端：既有 `server/api/chat.post.ts`、`server/api/conversations/*`、`server/utils/conversation-store.ts` / `knowledge-audit.ts` 只做必要補強，不另起第二套真相來源。
- 測試與證據：conversation/chat integration、E2E 或 screenshot evidence、報告驗證素材。
- 文件：`local/reports/latest.md` 與相關 verify / evidence 文件需同步對齊。
