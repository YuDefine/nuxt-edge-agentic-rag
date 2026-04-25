## Why

使用者在 `/` 點 sidebar 歷史對話時，若該對話包含助理拒答（refusal / abstain）訊息，重新載入後 refusal 訊息整段消失，只剩使用者的提問。看起來像系統紀錄遺失或壞掉。Root cause 是 server 端持久化邏輯 `server/utils/web-chat.ts` 的 `if (!result.refused && result.answer !== null)` gate 跳過所有 refusal 路徑（audit-blocked / pipeline_refusal / pipeline_error）的 assistant message 寫入。同時 sidebar 與入口的「新對話」按鈕目前是純 plus icon，使用者不容易判讀按鈕用途，須補上文字 label。

## What Changes

- messages table 新增 `refused INTEGER NOT NULL DEFAULT 0`（SQLite boolean），標記該 assistant message 是否為拒答訊息。
- `chatWithKnowledge` 在 audit-blocked、pipeline refusal、正常回答三條路徑都寫入 assistant message：refusal 路徑寫入 `content = '抱歉，我無法回答這個問題。'`、`refused = 1`；正常回答寫入 `refused = 0`。
- `auditStore.createMessage` 介面、`createKnowledgeAuditStore` 實作、`conversation-store` 讀取路徑、`ChatConversationMessage` shared type 都帶上 `refused` 欄位。
- API `GET /api/conversations/[id]/messages` 與相關 detail 端點 response 帶 `refused`。
- 前端 `mapConversationDetailToChatMessages` 把 `refused` 從 detail 帶到 `ChatMessage`，`MessageList.vue` 重載歷史時能正確 render `RefusalMessage` 元件（含建議下一步、可能原因區塊）。
- sidebar `ConversationHistory.vue` 與入口 `/` 的「新對話」按鈕從純 icon 改為 icon + 文字 label（桌機顯示完整 label；mobile 折疊版面下保留 label，若空間真的不足則維持 aria-label / tooltip 一致）。
- 對應 e2e (`e2e/new-conversation-button.spec.ts`、`e2e/new-conversation-entrypoints-screenshots.spec.ts`、`e2e/collapsible-chat-history-sidebar.spec.ts`) 與 unit (`test/unit/conversation-history-*.spec.ts`、`test/unit/chat-conversation-state.test.ts`) 同步更新斷言。
- 同步 `docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md`：補上「refusal 訊息持久化於 messages.refused」段落。

## Non-Goals (optional)

- 不修改 `query_log.refusal_reason` 設計（refused 是 DB 事實，refusal_reason 是為何拒答；兩者並存）。
- 不為 migration 前的歷史資料逆向補寫 refused = 1（既有 refusal 訊息本來就沒寫入，無法回填；新欄位 default = 0，舊資料維持原狀）。
- 不改變 RefusalMessage.vue 元件本身（已有的「建議下一步」「可能原因」區塊不變）。
- 不在新對話按鈕加任何 dropdown / 額外功能；只是純 label 化。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-agentic-answering`: refusal 路徑（audit-blocked / pipeline_refusal / pipeline_error）必須持久化 assistant message 並標記 `refused = 1`，正常回答路徑同步寫入 `refused = 0`。
- `web-chat-ui`: 歷史對話重載必須能還原 RefusalMessage UI；sidebar 與入口「新對話」按鈕必須含文字 label，不得僅顯示 icon。
- `conversation-lifecycle-governance`: messages 訊息結構新增 `refused` 欄位，read API 回傳此欄位。

## Impact

- Affected specs: `web-agentic-answering`、`web-chat-ui`、`conversation-lifecycle-governance`
- Affected code:
  - New:
    - server/database/migrations/0013_messages_refused_flag.sql
    - test/integration/web-chat-persistence.test.ts
  - Modified:
    - server/db/schema.ts
    - server/utils/web-chat.ts
    - server/utils/mcp-ask.ts
    - server/utils/knowledge-audit.ts
    - server/utils/conversation-store.ts
    - server/api/chat.post.ts
    - server/api/conversations/[id]/messages.get.ts
    - app/types/chat.ts
    - app/utils/chat-conversation-state.ts
    - app/utils/chat-stream.ts
    - app/components/chat/MessageList.vue
    - app/components/chat/ConversationHistory.vue
    - app/pages/index.vue
    - test/unit/chat-conversation-state.test.ts
    - test/unit/conversation-history-component.test.ts
    - test/unit/conversation-history-aria.spec.ts
    - test/unit/conversation-history-midnight.spec.ts
    - e2e/new-conversation-button.spec.ts
    - e2e/new-conversation-entrypoints-screenshots.spec.ts
    - e2e/collapsible-chat-history-sidebar.spec.ts
    - docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md
  - Removed: (none)
