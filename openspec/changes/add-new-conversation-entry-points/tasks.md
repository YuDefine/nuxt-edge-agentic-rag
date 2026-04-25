## 1. Helper 層（TDD）

- [x] 1.1 [P] 寫 `test/unit/clear-conversation-session-storage.spec.ts`，紅燈覆蓋 success / silent-fail（Safari private mode 拋 QuotaExceededError）/ unavailable storage（null）三 case
- [x] 1.2 在 `app/utils/chat-conversation-state.ts` 實作 `clearConversationSessionStorage(userId, storage)` helper，使 1.1 測試通過

## 2. ConversationHistory 元件 — 提供 Explicit New Conversation Entry Points

- [x] 2.1 在 `app/components/chat/ConversationHistory.vue` emits 列表新增 `'new-conversation-request': []`；expanded header 與「對話記錄」title 同列加 `i-lucide-message-circle-plus` UButton（aria-label「新對話」、disabled 條件 `props.disabled`）；collapsed mode 的 `i-lucide-plus` UButton 改 `@click` emit `new-conversation-request`（不再呼叫 `requestExpand`）
- [x] 2.2 [P] 在 `test/unit/conversation-history-component.test.ts` 加測試案例覆蓋三個 Explicit New Conversation Entry Points（chat header 不在此檔範圍；此檔測 expanded header button + collapsed plus button 都 emit `new-conversation-request`）

## 3. index.vue page 級串接 — Explicit New Conversation Entry Points orchestration

- [x] 3.1 在 `app/pages/index.vue` script 區段新增 `handleNewConversationRequest()`：呼叫 `handleConversationCleared()` + `clearConversationSessionStorage(user.value?.id ?? null, sessionStorage)`（client-only guard）+ `historyDrawer.close()`
- [x] 3.2 chat 主欄 header `<h1>知識庫問答</h1>` 那條 flex row 右側加 `i-lucide-message-circle-plus` UButton（aria-label「新對話」、disabled 綁 `conversationInteractionLocked`、`@click` 觸發 `handleNewConversationRequest`）
- [x] 3.3 兩處 `<LazyChatConversationHistory>`（sidebar 與 drawer）都加 `@new-conversation-request="handleNewConversationRequest"` 綁定，並驗證 disable 條件複用 `conversationInteractionLocked`

## 4. Persisted Conversation Session Continuity — reload 折衷邏輯驗證

- [x] 4.1 [P] 補 `test/unit/chat-conversation-session.test.ts`：sessionStorage 對應 key 被清空後 `restoreActiveConversation` 不 auto-restore；key 仍存在時維持既有 auto-restore（驗證 Persisted Conversation Session Continuity 不退步）
- [x] 4.2 [P] 新增 `e2e/new-conversation-button.spec.ts`，5 個場景：(a) chat header 點 → 對話 A 清空；(b) 新對話畫面點 sidebar 對話 B → 載入 B；(c) 點過新對話直接 reload → 仍是新對話畫面；(d) 沒點新對話直接 reload → auto-restore；(e) `< lg` drawer 模式點 collapsed plus → drawer 關閉

## 5. Design Review

- [x] 5.1 檢查 `.impeccable.md` 是否存在，若無則先執行 `/impeccable teach`
- [x] 5.2 執行 `/design improve` 對 `app/pages/index.vue` + `app/components/chat/ConversationHistory.vue`（含 Design Fidelity Report）
- [x] 5.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [x] 5.4 依計劃按 canonical order 執行 targeted design skills
- [x] 5.4.1 響應式 viewport 測試（xs 360 / md 768 / xl 1280，三 viewport 各截一張，三個入口都要可見）
- [x] 5.4.2 無障礙檢查（@nuxt/a11y dev report 無 error；鍵盤 Tab / Enter / Space 可觸發三個按鈕）
- [x] 5.5 執行 `/audit` 確認 Critical = 0
- [x] 5.6 執行 `review-screenshot` 補 `design-review.md` 視覺 QA 證據
- [x] 5.7 Fidelity 確認 — `design-review.md` 中無 DRIFT 項

## 6. 文件同步

- [x] 6.1 apply 開始時將 `docs/tech-debt.md` TD-048 Status 改為 `in-progress`
- [ ] 6.2 archive 前將 `docs/tech-debt.md` TD-048 Status 改為 `done`，並從 `openspec/ROADMAP.md` Next Moves 移除對應條目

## 人工檢查

- [ ] 7.1 進對話 A 中、點 chat header 新對話按鈕 → messages 清空 / sidebar A 不再 highlight / sessionStorage `web-chat:active-conversation:${userId}` key 移除
- [ ] 7.2 新對話畫面點 sidebar 的對話 B → 載入 B 歷史 messages / sidebar B highlight / sessionStorage 寫入 B.id
- [ ] 7.3 點過新對話、未送任何訊息直接 reload → 仍是新對話畫面（不 auto-restore 任何舊對話）
- [ ] 7.4 完全沒點過新對話、沒切 sidebar 即 reload → auto-restore 上次對話（既有重度使用者體驗不退步）
- [ ] 7.5 在 `< lg` 視窗 drawer 開啟狀態下點側欄 collapsed plus 按鈕 → drawer 關閉 + 進新對話畫面 + sidebar 不再 highlight 任何項
- [ ] 7.6 Safari private mode 點任一新對話按鈕 → 仍能進新對話畫面、無 error toast、無 console error
