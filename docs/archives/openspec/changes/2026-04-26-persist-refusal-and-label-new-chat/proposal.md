## Why

使用者在 `/` 點 sidebar 歷史對話時，若該對話包含助理拒答（refusal / abstain）訊息，重新載入後 refusal 訊息整段消失，只剩使用者的提問。看起來像系統紀錄遺失或壞掉。Root cause 是 server 端持久化邏輯 `server/utils/web-chat.ts` 的 `if (!result.refused && result.answer !== null)` gate 跳過所有 refusal 路徑（audit-blocked / pipeline_refusal / pipeline_error）的 assistant message 寫入。同時 sidebar 與入口的「新對話」按鈕目前是純 plus icon，使用者不容易判讀按鈕用途，須補上文字 label。

實作中段使用者驗收又揭露兩個延伸問題（mid-apply ingest 追加）：(a) audit-block 路徑下對話標題會直接顯示內部 redaction marker `[BLOCKED:credential]`，不是中文語義化內容；(b) `RefusalMessage.vue` 對所有 refusal 都顯示同一份通用「可能原因 / 建議下一步」文案，使用者反映過於模糊，希望按 refusal reason（restricted_scope / no_citation / low_confidence / pipeline_error）顯示具體說明。本 change 範圍延伸涵蓋這兩個修補。

## What Changes

- messages table 新增 `refused INTEGER NOT NULL DEFAULT 0`（SQLite boolean），標記該 assistant message 是否為拒答訊息。
- messages table 新增 `refusal_reason TEXT`（NULL 允許）欄位，記錄拒答的具體原因（restricted_scope / no_citation / low_confidence / pipeline_error）；user / accepted assistant rows 留 NULL。
- `chatWithKnowledge` 在 audit-blocked、pipeline refusal、正常回答三條路徑都寫入 assistant message：refusal 路徑寫入 `content = '抱歉，我無法回答這個問題。'`、`refused = 1`、`refusal_reason = <reason>`；正常回答寫入 `refused = 0`、`refusal_reason = NULL`。
- `auditStore.createMessage` 介面、`createKnowledgeAuditStore` 實作、`conversation-store` 讀取路徑、`ChatConversationMessage` shared type 都帶上 `refused` 與 `refusalReason` 欄位。
- API `GET /api/conversations/[id]/messages` 與相關 detail 端點 response 帶 `refused` 與 `refusalReason`。
- SSE `refusal` event payload 加 `reason: RefusalReason`，前端即時 render 與重載 render 走同一條 reason 路由。
- 前端 `mapConversationDetailToChatMessages` 把 `refused` 與 `refusalReason` 從 detail 帶到 `ChatMessage`，`MessageList.vue` 把 `refusalReason` 透過 prop 傳給 `RefusalMessage.vue`。
- `RefusalMessage.vue` 加 `reason` prop，依 reason 切換「可能原因」與「建議的下一步」具體文案；reason 缺漏 / 未匹配時 fallback 到通用文案。
- `server/api/chat.post.ts` 在 `audit.shouldBlock === true` 時不採用 `redactedText` 當對話 title source（避免 `[BLOCKED:credential]` 漏到 UI），改用固定中文 fallback「無法處理的提問」。
- sidebar `ConversationHistory.vue` 與入口 `/` 的「新對話」按鈕從純 icon 改為 icon + 文字 label（桌機顯示完整 label；mobile 折疊版面下保留 label，若空間真的不足則維持 aria-label / tooltip 一致）。
- 對應 e2e (`e2e/new-conversation-button.spec.ts`、`e2e/new-conversation-entrypoints-screenshots.spec.ts`、`e2e/collapsible-chat-history-sidebar.spec.ts`) 與 unit (`test/unit/conversation-history-*.spec.ts`、`test/unit/chat-conversation-state.test.ts`、新增 `test/unit/refusal-message.test.ts`) 同步更新斷言。
- 同步 `docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md`：補上「refusal 訊息持久化於 messages.refused / messages.refusal_reason」段落與 audit-block title fallback 說明。

## Non-Goals (optional)

- 不修改 `query_log.refusal_reason` 設計（DB-side observability 仍由 query_logs 持有；messages.refusal_reason 是 UI 消費者副本，與 query_logs 並存）。
- 不為 migration 前的歷史資料逆向補寫 refused = 1 或 refusal_reason（既有 refusal 訊息本來就沒寫入，無法回填；新欄位 default = 0 / NULL，舊資料維持原狀）。
- 不改變 `RefusalMessage.vue` 既有的「可能原因 / 建議下一步」UI 結構，只擴增依 reason 切換的具體文案；reason 缺漏時 fallback 通用文案不變。
- 不擴 `RefusalMessage.vue` 為動態 i18n（仍為寫死繁體中文，與專案現行做法一致）。
- 不在新對話按鈕加任何 dropdown / 額外功能；只是純 label 化。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-agentic-answering`: refusal 路徑（audit-blocked / pipeline_refusal / pipeline_error）必須持久化 assistant message 並標記 `refused = 1`，並寫入對應的 `refusal_reason`；正常回答路徑同步寫入 `refused = 0` 與 NULL refusal_reason。audit-block 時對話 title 不得採用 `redactedText`（其值為內部 marker），須改用語義化中文 fallback。
- `web-chat-ui`: 歷史對話重載必須能還原 RefusalMessage UI；RefusalMessage 必須依 refusal_reason 顯示具體說明文案（restricted_scope / no_citation / low_confidence / pipeline_error 各一份），未提供 reason 時 fallback 通用文案；sidebar 與入口「新對話」按鈕必須含文字 label，不得僅顯示 icon。
- `conversation-lifecycle-governance`: messages 訊息結構新增 `refused` 與 `refusal_reason` 欄位，read API 回傳此兩欄位。

## Impact

- Affected specs: `web-agentic-answering`、`web-chat-ui`、`conversation-lifecycle-governance`
- Affected code:
  - New:
    - server/database/migrations/0013_messages_refused_flag.sql
    - server/database/migrations/0014_messages_refusal_reason.sql
    - test/integration/web-chat-persistence.test.ts
    - test/integration/messages-refusal-reason-migration.test.ts
    - test/unit/refusal-message.test.ts
  - Modified:
    - server/db/schema.ts
    - server/utils/web-chat.ts
    - server/utils/mcp-ask.ts
    - server/utils/knowledge-audit.ts
    - server/utils/conversation-store.ts
    - server/utils/chat-sse-response.ts
    - server/api/chat.post.ts
    - server/api/conversations/[id]/messages.get.ts
    - shared/types/chat-stream.ts
    - app/types/chat.ts
    - app/utils/chat-conversation-state.ts
    - app/utils/chat-stream.ts
    - app/components/chat/MessageList.vue
    - app/components/chat/RefusalMessage.vue
    - app/components/chat/ConversationHistory.vue
    - app/pages/index.vue
    - test/unit/chat-conversation-state.test.ts
    - test/unit/chat-stream.test.ts
    - test/unit/conversation-history-component.test.ts
    - test/unit/conversation-history-aria.spec.ts
    - test/unit/conversation-history-midnight.spec.ts
    - test/integration/conversation-messages-refused.test.ts
    - e2e/new-conversation-button.spec.ts
    - e2e/new-conversation-entrypoints-screenshots.spec.ts
    - e2e/collapsible-chat-history-sidebar.spec.ts
    - docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md
  - Removed: (none)
