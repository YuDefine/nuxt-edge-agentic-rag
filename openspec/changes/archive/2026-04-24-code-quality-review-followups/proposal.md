## Why

2026-04-24 那輪 `/commit` 的 code-review 與 simplify review 累積了 7 個 low-priority follow-up（TD-017 / 018 / 020 / 021 / 022 / 023 / 024），個別都是既有實作的可維護性、a11y 補強、或測試品質升級，本身不改 user-facing behavior。集中成一個 batch change 一次收尾，避免散落到後續多次 `/commit` 中拉長 review 注意力，也讓 follow-up register 的 open TD 數量可見地下降。

## What Changes

- **TD-017**：在 server/api/chat.post.ts 內抽共用 `requireAiBinding<T>()` helper；`getRequiredAiSearchBinding` / `getRequiredWorkersAiBinding` 改為薄 wrapper，統一 binding 缺失 / method 缺失的 503 判斷。
- **TD-018**：app/components/chat/Container.vue 的 `classifyError` 抽 `STATUS_TO_KIND` lookup 加上 `readErrorStatus()` helper，巢狀三元鏈扁平化為單層查表 + fallback。
- **TD-020**：server/utils/mcp-chatgpt-registration.ts 的 `CHATGPT_CONNECTOR_OAUTH_PATH_PATTERN` 由 `[^/?#]+` 收緊為 `[A-Za-z0-9_-]{1,64}`；拒絕含 `.` / Unicode / 超長 segment 的 OAuth path。
- **TD-021**：app/components/chat/ConversationHistory.vue 的 bucket toggle 按鈕補 `:aria-expanded`；`onExpandRequest` callback-prop 改為 `expand-request` emit，父層 app/pages/index.vue 改以 `@expand-request` 監聽，event 契約統一由 `defineEmits` 管理。
- **TD-022**：ConversationHistory.vue 的 `groupedConversations` computed 引入 `useNow({ interval: 60_000 })` 或等效 one-shot tick，跨午夜自動重分桶，免 refetch。
- **TD-023**：將 `useChatConversationHistory` 由兩個 LazyChatConversationHistory instance 各自掛載，改為在 app/pages/index.vue hoist 一次、以 props 傳給兩個 surface；登入首次渲染只觸發一次 `/api/conversations` GET。
- **TD-024**：移除或改寫 test/unit/chat-history-sidebar-source-contract.test.ts，以 mountSuspended 行為測試取代 `readFileSync + toContain` 的 source-string contract；e2e/collapsible-chat-history-sidebar.spec.ts 約 L216-218 的 `await expect(page.evaluate(...)).resolves.toBe('true')` 改為 `expect(await page.evaluate(...)).toBe('true')`，確保真正 assert。
- **TD-025（scope-extended）**：apply 過程中人工檢查 10.4/10.5/10.7 時發現 `app/components/chat/Container.vue:193` 的 `$csrfFetch.native(...)` 繞過 nuxt-csurf `onRequest` hook、固定 403。為解除 10.x 驗收的硬阻塞，就地修復（保留 `.native` 做 streaming、手動 `useCsrf()` 塞 header），並 register TD-025 `done`。

## Non-Goals

- 不處理 SSE 層面技術債（TD-015 heartbeat、TD-019 SSE reader pattern 抽共用、TD-016 isAbortError/createAbortError 抽共用）— 另由後續 SSE infrastructure change 處理，本 batch 不改 SSE 串流邏輯。
- 不處理 schema / migration 技術債（TD-009 email_normalized nullable 收尾）— 屬 Tier 3，另由獨立 migration change 處理。
- 不改變既有 chat UI 的視覺設計、回答流程、OAuth flow、authorization policy；純 refactor / a11y enhancement / test quality。
- 不把 `requireAiBinding` 外展到 shared utils；先保留為 chat.post.ts 內部 local helper，除非後續有第三個 caller 才再抽到 shared。

## Capabilities

### New Capabilities

（無新 capability）

### Modified Capabilities

- `web-chat-ui`：新增三項 user-observable 行為要求 — bucket toggle 對 AT 明示 expanded/collapsed 狀態（TD-021）、時間桶跨午夜自動重分組無需 refetch（TD-022）、首頁登入首次渲染只觸發一次對話歷史 GET（TD-023）。
- `oauth-remote-mcp-auth`：收緊 ChatGPT connector OAuth callback path segment 字元集要求，拒絕含 `.` / Unicode / 超長 segment 的 redirect URI（TD-020）。

TD-017（AI binding getter 抽共用）、TD-018（classifyError flatten）、TD-024（test 品質升級）為純 implementation / test 層面改動，不改 user-observable behavior，不需 spec delta。

## Impact

- 受影響 spec：web-chat-ui、oauth-remote-mcp-auth 需要 delta（新增 requirement）；web-chat-sse-streaming、responsive-and-a11y-foundation 的 implementation 受 TD-017/021 touch 但 requirement 不變。
- 受影響 code：
  - Modified：
    - server/api/chat.post.ts
    - app/components/chat/Container.vue
    - app/components/chat/ConversationHistory.vue
    - server/utils/mcp-chatgpt-registration.ts
    - app/pages/index.vue
    - app/composables/useChatConversationHistory.ts
    - e2e/collapsible-chat-history-sidebar.spec.ts
  - New：
    - test/unit/conversation-history-aria.spec.ts（TD-021 axe / a11y 單元測試）
    - test/unit/conversation-history-midnight.spec.ts（TD-022 假時鐘覆蓋）
    - test/unit/chatgpt-connector-oauth-pattern.spec.ts（TD-020 regex 新 case）
  - Removed：
    - test/unit/chat-history-sidebar-source-contract.test.ts（移除；由新 behavior test 取代）
- 受影響 runtime / binding / env：無。
- 受影響文件：docs/tech-debt.md 7 條 TD status 由 open 改 done（archive 時）。
