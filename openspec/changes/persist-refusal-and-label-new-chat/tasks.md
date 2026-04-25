## 1. Schema：新增 messages.refused INTEGER NOT NULL DEFAULT 0

- [x] 1.1 在 server/database/migrations/0013_messages_refused_flag.sql 撰寫 `ALTER TABLE messages ADD COLUMN refused INTEGER NOT NULL DEFAULT 0`，並補對應 backup hash 註解
- [x] 1.2 [P] 在 server/db/schema.ts `messages` table 加 `refused: integer('refused', { mode: 'boolean' }).notNull().default(false)` 欄位
- [x] 1.3 [P] 在 app/types/chat.ts 的 `ChatConversationMessage` interface 加 `refused: boolean`，並確認 `ChatMessage.refused` 與其同步（兩個 type 都在同一份檔案，無需新增 shared 檔案）
- [x] 1.4 撰寫 schema migration integration 測試：套用 0013 後 `pragma table_info(messages)` 看到 refused 欄位且 default = 0，既有 row 全部 refused = 0（驗證 Persisted Refusal Flag On Messages 的 Migration adds refused column with default zero scenario）

## 2. 持久化策略：refusal 三路徑都寫 assistant message

- [x] 2.1 將 server/utils/web-chat.ts 的 audit-blocked 分支補一筆 `auditStore.createMessage({ role: 'assistant', content: '抱歉，我無法回答這個問題。', refused: true, conversationId, queryLogId })`
- [x] 2.2 將同檔案下方 `if (!result.refused && result.answer !== null && options.auditStore)` 拆成兩支：refused → 寫 refusal assistant message（refused: true、無 citationsJson）；非 refused → 寫正常 assistant message（refused: false、含 citationsJson）
- [x] 2.3 將 chatWithKnowledge `catch (error)` 區塊補寫 refusal assistant message（pipeline_error 路徑），確保用戶端重載仍看得到拒答紀錄
- [x] 2.4 [P] 在 server/utils/knowledge-audit.ts `createKnowledgeAuditStore.createMessage` 實作中把 `refused: boolean` 寫進 INSERT，未提供時 default false
- [x] 2.5 [P] 在 server/utils/web-chat.ts auditStore 介面 / mcp-ask.ts 共用契約上加 `refused?: boolean`，MCP 寫入時顯式傳 `refused: false` 以維持 MCP 行為不變
- [x] 2.6 撰寫 server/utils/web-chat.ts 的 integration 測試：audit-blocked、pipeline_refusal、pipeline_error 三條路徑各驗證 messages 表寫入一筆 `role = assistant` 且 `refused = 1`（驗證 Refusal Message Persistence requirement 的三個 scenario）
- [x] 2.7 撰寫 server/utils/web-chat.ts integration 測試：accepted answer 路徑寫入 `refused = 0` 且帶 citationsJson（驗證 Refusal Message Persistence 的 Accepted answer persists with refused = 0 scenario）

## 3. Refusal content 採固定字串 '抱歉，我無法回答這個問題。'

- [x] 3.1 在 server/utils/web-chat.ts 將 refusal content 字面常數抽到 `REFUSAL_MESSAGE_CONTENT` 區域常數（同檔案頂部），三條 refusal 寫入路徑共用該常數
- [x] 3.2 [P] 在 app/utils/chat-stream.ts 的 `createAssistantMessageFromTerminalEvent` 引用相同字串來源（從 shared 常數匯入）以保證前後端文案一致

## 4. API contract：在 conversation messages list 帶上 refused

- [x] 4.1 在 server/utils/conversation-store.ts 的 `getForUser` / 相關 select 把 `refused` 加入回傳欄位
- [x] 4.2 [P] 在 server/api/conversations/[id]/messages.get.ts 確認回傳 payload 含 `refused`（type 會由 store 回傳帶入，無需手動 map）
- [x] 4.3 [P] 在 server/api/chat.post.ts non-stream response 補回 `refused` 欄位（若客戶端用非 SSE 路徑），與 SSE refusal event 對齊
- [x] 4.4 撰寫 conversations messages.get integration 測試：建立含 refusal 的 conversation 後 GET 回傳 `refused: true`（驗證 Persisted Refusal Flag On Messages 的 Conversation read API exposes refused flag scenario 與 Restored Refusal UI On Conversation Reload 的 API contract）

## 5. 前端載入：以 ChatMessage.refused 渲染 RefusalMessage 元件

- [x] 5.1 修改 app/utils/chat-conversation-state.ts `mapConversationDetailToChatMessages`，把 `message.refused` 直接帶到 ChatMessage，不再依賴 content 字串比對 fallback
- [x] 5.2 [P] 在 app/components/chat/MessageList.vue 確認分支用 `message.refused === true`（不是 content 比對）切到 RefusalMessage 元件
- [x] 5.3 撰寫 test/unit/chat-conversation-state.test.ts：給定 detail.messages 含 `refused: true` 時，輸出的 ChatMessage `refused` 為 true 並 content 為固定字串（驗證 Restored Refusal UI On Conversation Reload 的 Reloaded conversation shows refusal UI for prior refusal turn scenario）
- [x] 5.4 [P] 撰寫 test/unit/chat-message-list.test.ts：給定 ChatMessage `refused: true` 渲染出 RefusalMessage 元件；`refused: false` 渲染常規 assistant 訊息（驗證 Reloaded conversation shows accepted answers normally scenario）

## 6. 「新對話」按鈕從純 icon 變成 icon + 文字 label

- [x] 6.1 修改 app/components/chat/ConversationHistory.vue 的 expanded header 新對話按鈕，使用 `<UButton icon="i-lucide-plus" label="新對話" color="primary" variant="solid" />`，顯式寫出樣式 props
- [x] 6.2 [P] 修改 app/pages/index.vue chat 主欄 header 的新對話按鈕同樣加上 `label="新對話"` 與顯式樣式 props
- [x] 6.3 [P] 確認 ConversationHistory.vue 的 collapsed rail plus icon 維持 `aria-label="新對話"`（icon-only secondary entry，依 spec 允許保留純 icon）
- [x] 6.4 撰寫 test/unit/conversation-history-component.test.ts 斷言：expanded header 新對話按鈕含可見「新對話」文字（驗證 New Conversation Buttons Show Visible Text Label 的 Sidebar expanded header button renders icon and visible label scenario）
- [x] 6.5 [P] 撰寫 test/unit/conversation-history-aria.spec.ts 斷言：collapsed rail icon 保留 `aria-label="新對話"`（驗證 Icon-only secondary rail entry retains aria-label scenario）
- [x] 6.6 [P] 更新 e2e/new-conversation-button.spec.ts、e2e/new-conversation-entrypoints-screenshots.spec.ts、e2e/collapsible-chat-history-sidebar.spec.ts 斷言改用 visible text 取代純 icon assertion（驗證 Chat header button renders icon and visible label scenario）

## 7. 文件與驗證手冊同步

- [x] 7.1 更新 docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md 補「refusal 訊息持久化於 messages.refused」段落，註記不回填舊資料的決策（驗證 Historical refusal turns remain false after migration scenario）

## 8. Design Review

- [ ] 8.1 檢查 .impeccable.md 是否存在，若無則執行 /impeccable teach
- [ ] 8.2 執行 /design improve [app/components/chat/ConversationHistory.vue, app/pages/index.vue, app/components/chat/MessageList.vue, app/components/chat/RefusalMessage.vue]（含 Design Fidelity Report）
- [ ] 8.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [ ] 8.4 依 /design 計劃按 canonical order 執行 targeted skills
- [ ] 8.4.1 響應式 viewport 測試（xs 360 / md 768 / xl 1280 截圖並人工核對「新對話」label 顯示與 RefusalMessage 重載樣式）
- [ ] 8.4.2 無障礙檢查（@nuxt/a11y dev report 無 error，Tab / Esc walkthrough 確認 aria-label 對應）
- [ ] 8.5 執行 /audit — 確認 Critical = 0
- [ ] 8.6 執行 review-screenshot — 視覺 QA（提供 sidebar 新對話按鈕 + 重載 refusal 對話 + 入口按鈕三組截圖）
- [ ] 8.7 Fidelity 確認 — design-review.md 中無 DRIFT 項

## 9. 人工檢查

- [ ] 9.1 在 / 提問被 audit-blocked（PII 文字）→ 看到 RefusalMessage UI → 切換至其他對話 → 切回 → RefusalMessage UI 仍顯示
- [ ] 9.2 在 / 提問導致 pipeline refusal（檢索覆蓋率不足）→ 看到 RefusalMessage UI → 重新整理頁面 → 切回此對話 → RefusalMessage UI 仍顯示
- [ ] 9.3 在 / 點 sidebar 既有對話的歷史拒答紀錄 → 重載後完整看到「可能原因」「建議下一步」區塊
- [ ] 9.4 mobile（360px）、tablet（768px）、desktop（>= 1280px）三個 viewport 看「新對話」按鈕：sidebar 與 chat header 皆含可見「新對話」label
- [ ] 9.5 collapsed rail plus icon 仍可點擊建立新對話，且 screen reader 朗讀「新對話」
- [ ] 9.6 既有 conversation（migration 前產生且含拒答）重載：拒答訊息仍未出現（符合不回填決策），新對話的拒答訊息正常持久化
