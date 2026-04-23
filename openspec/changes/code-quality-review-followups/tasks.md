## 1. TD-017 — chat.post.ts AI binding getter 合併

- [x] [P] 1.1 在 server/api/chat.post.ts 抽 local helper `requireAiBinding<T>(event, { method, message })`：一次讀取 `getCloudflareEnv(event).AI`、檢查 `typeof (binding as Record<string, unknown>)[method] === 'function'`，失敗時拋 503 createError
- [x] [P] 1.2 將 `getRequiredAiSearchBinding` / `getRequiredWorkersAiBinding` 改為呼叫 1.1 的薄 wrapper，移除重複 skeleton
- [x] [P] 1.3 在 test/integration（或新 test/unit/chat-require-ai-binding.spec.ts）補一個 helper 單元測試：binding 缺失 → 503；method 缺失 → 503；正常 → 回傳 binding

## 2. TD-018 — Container.vue classifyError lookup table

- [x] [P] 2.1 在 app/components/chat/Container.vue 內抽 `readErrorStatus(error): number | undefined` helper（處理 FetchError / `error.statusCode` / `error.data.statusCode` 三種來源）
- [x] [P] 2.2 在 Container.vue 內定義 `STATUS_TO_KIND: Record<number, ErrorKind>` 常量表覆蓋現有 HTTP status → error kind 映射
- [x] [P] 2.3 將 `classifyError` 改寫為單層：`readErrorStatus(error) → STATUS_TO_KIND[status] ?? fallback kind`，移除巢狀三元鏈
- [x] [P] 2.4 確認 app/components/chat/chat-container.spec.ts（或等效單元測試）既有 case 持續綠，涵蓋 401 / 403 / 404 / 429 / 5xx 分支

## 3. TD-020 — ChatGPT Connector OAuth Callback Path Segment Has Restricted Character Set

- [x] [P] 3.1 實作 spec 「ChatGPT Connector OAuth Callback Path Segment Has Restricted Character Set」：將 server/utils/mcp-chatgpt-registration.ts 的 `CHATGPT_CONNECTOR_OAUTH_PATH_PATTERN` 由 `/^\/connector\/oauth\/[^/?#]+$/` 改為 `/^\/connector\/oauth\/[A-Za-z0-9_-]{1,64}$/`
- [x] [P] 3.2 新增 test/unit/chatgpt-connector-oauth-pattern.spec.ts 覆蓋新限制：ASCII alphanumeric + `_`/`-` 通過、`.` 拒絕、Unicode 拒絕、長度 > 64 拒絕、`/connector/oauth/` 前綴缺失拒絕
- [x] [P] 3.3 跑 `pnpm test:integration` 確認 `isAllowedChatGptConnectorRedirectUri` 相關既有 test 不被收緊後的 regex 誤擋合法 OpenAI connector id

## 4. TD-021 — Conversation History Bucket Toggle Exposes Expanded State

- [x] 4.1 實作 spec 「Conversation History Bucket Toggle Exposes Expanded State」：在 app/components/chat/ConversationHistory.vue 的 bucket toggle `<button>` 補 `:aria-expanded="bucketOpenState[group.bucket]"`，確保 toggle 狀態變化時屬性同步更新
- [x] 4.2 將 `onExpandRequest?: () => void` prop 移除，改為 `defineEmits` 加入 `'expand-request': []`；組件內既有呼叫點改為 `emit('expand-request')`
- [x] 4.3 app/pages/index.vue 兩處 ChatConversationHistory 使用點將 `:on-expand-request="expandHistorySidebar"` 改為 `@expand-request="expandHistorySidebar"`
- [x] 4.4 新增 test/unit/conversation-history-aria.spec.ts（以 mountSuspended）驗證：折疊時 toggle 為 `aria-expanded="false"`、展開時為 `"true"`；點擊 toggle 後屬性 flip

## 5. TD-022 — Conversation History Time Buckets Recompute Across Midnight

- [x] 5.1 實作 spec 「Conversation History Time Buckets Recompute Across Midnight」：在 ConversationHistory.vue 引入 `useNow({ interval: 60_000 })`（或等效每分鐘 tick），讓 `groupedConversations` computed 對當前時間 reactive
- [x] 5.2 `groupedConversations` 內以 tick 值（或由 tick 衍生的 `dayStart` 值）作為分桶基準，取代一次性的 `new Date()` 常量
- [x] 5.3 新增 test/unit/conversation-history-midnight.spec.ts（vitest fake timers）：initial render 將 23:50 對話放 Today；推進假時鐘跨過午夜並觸發 tick；assert 同一對話改到 Yesterday，過程中無新 `/api/conversations` fetch
- [x] 5.4 確認新 tick 不造成每秒 re-render（interval ≥ 60 秒、computed 僅依賴 tick 和 conversations）

## 6. TD-023 — Chat Home Page Deduplicates Conversation History Fetch

- [x] 6.1 實作 spec 「Chat Home Page Deduplicates Conversation History Fetch」：在 app/pages/index.vue 頂層 `<script setup>` hoist `useChatConversationHistory()` 呼叫一次，取得單一 state instance
- [x] 6.2 將 hoist 後的 conversations / loading / refetch 等以 props（或 provide/inject）下傳到兩個 surface：inline sidebar（`lg+`）與 drawer（`< lg`）
- [x] 6.3 ConversationHistory.vue 若目前自己 call `useChatConversationHistory`，改為從 props 接收 state；若兩種模式並存，先加 `:conversations` / `:loading` props，內部 fallback 維持不破壞現有 test，隨後 index.vue 改用 props 模式
- [x] 6.4 新增或擴充 e2e/collapsible-chat-history-sidebar.spec.ts（或另開 e2e/chat-home-fetch-dedup.spec.ts）：登入後進首頁，攔截 network 或以 `page.waitForRequest` 計數，斷言 `/api/conversations` 首次渲染只發一次

> **@followup[TD-026]** `/commit` 0-A simplify 發現 `index.vue` 與 `ConversationHistory.vue` owner-fallback 分支各自持有 `useChatConversationHistory` 完整 config + `refreshConversationHistory` 邏輯，兩處幾乎逐行重複。本 change scope 不做 factory 抽取，留作 TD-026 處理（Priority: low）。

## 7. TD-024 — chat-history-sidebar 測試品質

- [x] [P] 7.1 刪除 test/unit/chat-history-sidebar-source-contract.test.ts（以 `readFileSync + toContain` 掃 .vue raw source 的 source-string contract）；若其斷言項仍需保留，改寫為 test/unit/chat-history-sidebar-behavior.spec.ts，以 mountSuspended 驗 aria / slot / storage key 行為
- [x] [P] 7.2 修改 e2e/collapsible-chat-history-sidebar.spec.ts 約 L216-218：將 `await expect(page.evaluate(() => ...)).resolves.toBe('true')` 改為 `expect(await page.evaluate(() => ...)).toBe('true')`，確保真的 assert 到結果
- [x] [P] 7.3 跑 `pnpm test` + `pnpm test:e2e` 驗新測試綠，且手動把受測程式改壞時測試會紅（sanity check 測試真的有效）

## 8. Docs / Tech Debt Register

- [x] [P] 8.1 archive 前把 docs/tech-debt.md 的 TD-017 / 018 / 020 / 021 / 022 / 023 / 024 的 Status 由 open 改 done，Index table 同步更新，並加 `**Resolved**: 2026-04-24 — code-quality-review-followups` 一行
- [x] [P] 8.2 跑 `pnpm spectra:followups --fail-on-drift` 確認無 unregistered marker 殘留

## 9. Design Review

- [x] 9.1 檢查 .impeccable.md 是否存在，若無則執行 /impeccable teach
- [x] 9.2 執行 /design improve [app/components/chat/ConversationHistory.vue + app/pages/index.vue]（含 Design Fidelity Report）
- [x] 9.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [x] 9.4 依 /design 計劃按 canonical order 執行 targeted skills
- [x] 9.4.1 響應式 viewport 測試（xs 360 / md 768 / xl 1280 截圖並人工核對 ConversationHistory 展開/收合 + 首頁 sidebar/drawer 切換）
- [x] 9.4.2 無障礙檢查（@nuxt/a11y dev report 無 error + 鍵盤 Tab / Esc / Enter 對 bucket toggle walkthrough）
- [x] 9.5 執行 /audit — 確認 Critical = 0
- [x] 9.6 執行 review-screenshot — 視覺 QA
- [x] 9.7 Fidelity 確認 — design-review.md 中無 DRIFT 項

## 10. 人工檢查

- [ ] 10.1 跨午夜情境實測：開首頁保留 tab、用 devtools 改系統時間或 mock `useNow` 跨過午夜，確認 23:50 的對話自動從 Today 重分到 Yesterday，且 Network tab 沒有新 `/api/conversations` 請求
- [ ] 10.2 aria-expanded 實測：瀏覽器開 devtools a11y tree（或 axe DevTools），點 bucket toggle，確認 `aria-expanded` 隨 toggle 由 false→true→false 更新，且 VoiceOver / NVDA 可聽到「已展開」「已收合」
- [x] 10.3 fetch dedup 實測：登出後重新登入進首頁，Network tab 過濾 `/api/conversations`，確認首次渲染只一筆 GET 請求
- [ ] 10.4 classifyError 行為人工驗：觸發 401 / 404 / 429 / 500 / 網路中斷五種錯誤，確認 chat container 顯示的 error kind（unauthorized / not-found / rate-limit / server-error / network）與 refactor 前一致
- [ ] 10.5 AI binding 503 人工驗：在 dev 環境暫時 unset `AI` binding（或 mock 為空物件），呼叫 `/api/chat`，確認 response 503 + message 正確
- [ ] 10.6 OAuth regex 實測：用 `/connector/oauth/foo.bar`、`/connector/oauth/漢字id`、`/connector/oauth/` + 65 字元 segment 三種 payload 嘗試 connector authorization，確認被 reject；用合法 `/connector/oauth/connector-abc_123` 確認仍通過
- [ ] 10.7 Regression smoke：首頁未登入 / 登入、/account/settings、/admin/\* 主要頁各開一次，確認 Lazy 元件與本次 refactor 沒有破壞 chat 以外頁面
