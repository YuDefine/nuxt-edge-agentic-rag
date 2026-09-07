## 1. Factory 抽取

- [x] 1.1 新增 `app/composables/create-chat-conversation-history.ts`，匯出 `createChatConversationHistory($csrfFetch, toast, options)` factory，options 型別為 `{ onConversationSelected: (payload) => void; onConversationCleared: () => void; selectedConversationId: Ref<string | null>; onHistoryError?: (ctx: { action: 'delete' | 'refresh' }) => void; onConversationLoadError?: () => void }`
- [x] 1.2 Factory 內部組裝 `useChatConversationHistory` config（`deleteConversation` / `listConversations` / `loadConversation` / 4 組 toast + emit callbacks），若 caller 未傳 `onHistoryError` / `onConversationLoadError`，fall back 為預設 toast（對齊 `ConversationHistory.vue` 既有文案）
- [x] 1.3 Factory 回傳 `{ api, refreshAndReconcile }`；`refreshAndReconcile(selectedId?)` 實作「Conversation History Refresh Reconciliation」順序：refresh → 若 selectedId 存在則查 list → 不存在則 `loadChatConversationDetail` → 結果為 `missing` 則呼叫 `onConversationCleared`
- [x] 1.4 Factory 匯出清楚的 TypeScript 型別（options、return shape），供兩處共用

## 2. 新增 factory unit test

- [x] 2.1 [P] 新增 `test/unit/create-chat-conversation-history.spec.ts`，以 mock `$csrfFetch` + stub `useChatConversationHistory` 測 `refreshAndReconcile` 四個場景（對應 spec 四條 Scenario：still present / missing but loadable / missing + detail missing / no active id）
- [x] 2.2 [P] Unit test 驗證「`onHistoryError` / `onConversationLoadError` 未傳時 fall back 到預設 toast」的行為（call `toast.add` 參數比對）

## 3. index.vue 接上 factory

- [x] 3.1 `app/pages/index.vue` 改用 `createChatConversationHistory` 建立 `conversationHistory`，`onConversationSelected` / `onConversationCleared` 繼續綁到既有 `handleConversationSelected` / `handleConversationCleared`，`selectedConversationId` 傳 `activeConversationId`
- [x] 3.2 `refreshConversationHistory` 改為直接呼叫 factory 回傳的 `refreshAndReconcile(activeConversationId.value)`，移除 inline reconcile body
- [x] 3.3 `provide(ChatConversationHistoryInjectionKey, conversationHistory.api)` 行為不變（parent provide key 維持相同）

## 4. ConversationHistory.vue 接上 factory

- [x] 4.1 `app/components/chat/ConversationHistory.vue` owner-fallback 分支改用 `createChatConversationHistory`，`onConversationSelected` / `onConversationCleared` 綁到 `emit('conversation-selected', payload)` / `emit('conversation-cleared')`，`selectedConversationId` 傳 `toRef(props, 'selectedConversationId')`
- [x] 4.2 `refreshHistory` 改為直接呼叫 factory 回傳的 `refreshAndReconcile(props.selectedConversationId ?? null)`，移除 inline reconcile body
- [x] 4.3 評估是否移除 owner-fallback 分支改以 test helper provide 真 instance；若保留，於 component 註解明確指出兩處 config 由 factory 集中維護

## 5. 既有測試與文件同步

- [x] 5.1 [P] 跑 `pnpm test test/unit/conversation-history-aria.spec.ts test/unit/conversation-history-midnight.spec.ts test/unit/conversation-history-component.test.ts test/unit/chat-conversation-history.test.ts` 確認全綠
- [x] 5.2 [P] 跑 `pnpm test:unit` 確認 656+ tests 全綠（dedup 行為的 mount-level 覆蓋已包含在 `conversation-history-component.test.ts`；本 repo 無 `chat-home-fetch-dedup.spec.ts` 獨立檔）
- [x] 5.3 [P] 跑 `pnpm audit:ux-drift` 確認無新 exhaustiveness drift
- [x] 5.4 `docs/tech-debt.md` TD-026 Status 改 `done`，補 Resolved 日期與 Resolution 段
- [x] 5.5 全 repo grep 移除 `@followup[TD-026]` marker
- [x] 5.6 `openspec/ROADMAP.md` MANUAL `Next Moves` → 近期 backlog 移除 TD-026 項

## 6. Design Review

- [x] 6.1 確認本 change 為純 internal refactor，UI surface 無視覺變更；檢查 `app/pages/index.vue` 與 `app/components/chat/ConversationHistory.vue` 的 render 結果與 refactor 前一致（DOM snapshot 或手動對照）
- [x] 6.2 執行 review-screenshot — 對 `/` (signed-in 狀態)、inline sidebar (`lg`+)、off-canvas drawer (< `lg`) 各一張，確認 layout 與文案無漂移
- [x] 6.3 由於無視覺變更，skip `/design improve` 與 `/audit` 完整流程（在 design-review.md 註明 skip 理由：pure internal refactor + 視覺無變更）

## 7. 人工檢查

- [x] 7.1 實際在 local dev 登入 → 回首頁確認 `/api/conversations` 只發一次、sidebar 與 drawer 顯示同一列表
- [x] 7.2 點選舊 conversation → 訊息面板換成該 conversation 內容
- [x] 7.3 刪除 conversation → 從列表消失、若刪除的是 active 則訊息面板清空並顯示 cleared 提示
- [x] 7.4 手動觸發一次 refresh（送出新訊息建立新 conversation）→ 新 conversation 出現在列表、active 狀態正確
- [x] 7.5 故意把某個 active conversation 從 DB 刪掉再 refresh → cleared notification 出現、訊息面板清空
