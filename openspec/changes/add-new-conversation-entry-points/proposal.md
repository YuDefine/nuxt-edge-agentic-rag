## Why

TD-048 register entry 紀錄使用者反映兩件事：「找不到新對話按鈕」與「reload 始終停在同個對話」。前者是 UI affordance 缺失（chat 主欄沒有任何 action button、`ConversationHistory.vue` collapsed 模式雖有 `i-lucide-plus` icon 但實際綁 `requestExpand` 而非建立新對話），後者是 sessionStorage auto-restore 邏輯沒有 user opt-out 入口。兩個痛點同源——使用者沒有顯式發起新對話的入口可以「告訴系統我要開新的」。

## What Changes

- **新增三處顯式新對話入口**：
  - 主欄：`app/pages/index.vue` chat header 右側加 UButton（最顯眼，使用者進來第一眼可見）。
  - 側欄展開：`app/components/chat/ConversationHistory.vue` expanded header 與「對話記錄」title 同列加 UButton。
  - 側欄收合：修現有 `i-lucide-plus` button 改 emit `new-conversation-request`（aria-label「新增對話」已存在，目前綁定錯誤的 `requestExpand`）。
- **點擊行為定義**：複用 `handleConversationCleared()` 將 active conversation state 清空、主動移除 sessionStorage 中對應的 `web-chat:active-conversation:${userId}` key、`< lg` 視窗下關閉 history drawer。
- **Reload 折衷邏輯**：保留 `restoreActiveConversation` 預設行為（不退步重度使用者體驗），但點擊新對話後清掉 sessionStorage 使下次 reload 不再 auto-restore 該已捨棄對話。
- **新增 `clearConversationSessionStorage(userId, storage)` helper**：封裝 sessionStorage key 生成 + silent 失敗處理（Safari private mode）。
- **Spec delta**：在 `web-chat-ui` capability 修改 `Persisted Conversation Session Continuity`（加 reload 後不 auto-restore 的 scenario）、新增 `Explicit New Conversation Entry Points` requirement。

## Non-Goals

- **不引入 URL routing**（如 `?conversation=xxx` 或 hash）。屬另外的 share-conversation feature，scope 不在此 change。
- **不改 `useChatConversationSession.restoreActiveConversation` 預設邏輯**。新對話按鈕透過清 sessionStorage 達到 reload 行為改變，避免影響重度使用者。
- **不加 confirm dialog**（即使 chat input 有未送出文字）。與既有 sidebar conversation 切換行為一致；input 是 Container.vue 內部 state，使用者改主意可隨時切回 sidebar 任一對話。
- **不改 Container.vue 內部 empty state 裝飾**。activeConversationId = null + messages = [] 已是新對話畫面，無需另外處理。
- **不擴張 sessionStorage schema**。只處理現有 `web-chat:active-conversation:${userId}` 一個 key。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-chat-ui`: 新增「使用者必須能從介面顯式發起新對話」requirement；修改 `Persisted Conversation Session Continuity` 加上「點過新對話後 reload 不再 auto-restore 該對話」的 scenario。

## Affected Entity Matrix

### Entity: `web-chat:active-conversation:${userId}` (sessionStorage key)

| Dimension  | Values                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Touched by | New: `clearConversationSessionStorage(userId, storage)` helper；既有 setter 在 `useChatConversationSession.setActiveConversation` |
| Roles      | member, admin（guest 無 chat persistence，不受影響）                                                                              |
| Actions    | clear（新對話按鈕）、set（既有：選 sidebar 對話 / 送出第一個訊息）                                                                |
| States     | empty / hasActiveId / unavailable（Safari private mode 拋 QuotaExceededError）                                                    |
| Surfaces   | `app/pages/index.vue`（綁 emit）、`app/components/chat/ConversationHistory.vue`（emit 來源）                                      |

### Entity: Conversation UI active state (`activeConversationId` + `persistedMessages`)

| Dimension       | Values                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Columns touched | activeConversationId（null / string）、persistedMessages（[] / ChatMessage[]）                                                                          |
| Roles           | member, admin                                                                                                                                           |
| Actions         | reset（新對話）、load（select sidebar）、append（送訊息收 SSE persisted）                                                                               |
| States          | empty（新對話）/ loading（剛切 sidebar）/ error（載入失敗 toast）/ ready                                                                                |
| Surfaces        | chat header button、sidebar expanded header button、sidebar collapsed plus button、`< lg` drawer button、Container.vue（emit `conversation-persisted`） |

## User Journeys

1. **進對話 A 中、點 chat header 新對話按鈕**：messages pane 清空 → sidebar 對話 A 不再 highlight → sessionStorage 對應 key 移除 → 若處於 `< lg` drawer 已開狀態則 drawer 關閉 → 使用者立刻看到空白 chat 主欄等待輸入。

2. **新對話畫面點 sidebar 的對話 B**：載入 B 的歷史 messages → sidebar B highlight → sessionStorage 寫入 B.id（既有 setActiveConversation 行為，不退步）→ drawer 關閉。

3. **點過新對話、未送任何訊息直接 reload**：sessionStorage 已空 → `restoreActiveConversation` 找不到 stored id → 仍是新對話畫面（不 auto-restore 任何舊對話）。

4. **完全沒點過新對話、沒切 sidebar 即 reload**：sessionStorage 仍有上次對話 id → `restoreActiveConversation` auto-restore 該對話（既有行為，重度使用者不退步）。

5. **`< lg` drawer 模式點側欄收合的 plus 按鈕（修綁定後）**：drawer 開啟狀態下，emit `new-conversation-request` → 進新對話 + drawer 關閉（與 chat header 按鈕行為一致）；非 drawer 模式（lg+）只 emit 新對話、無 drawer 可關。

## Implementation Risk Plan

- **Truth layer / invariants**：sessionStorage key `web-chat:active-conversation:${userId}` 是 conversation auto-restore 的 single source of truth。`clearConversationSessionStorage` helper 必須與既有 `buildConversationSessionStorageKey(userId)` 保持 key 格式對齊；任一邊改 prefix / 分隔符會立刻造成 reload 行為漂移。
- **Review tier**：Tier 2。純 UI + client state 操作，無 schema、無 server API、無 auth 變更；跨 3-4 檔案，預估 100-200 行 code + 50-100 行測試。
- **Contract / failure paths**：sessionStorage 不可用（Safari private mode、quota exceeded、DOM Storage disabled）→ helper 必須 silent 失敗（catch + 不 rethrow），不擋按鈕點擊；按鈕 disabled 條件複用 `conversationInteractionLocked`（避免 SSE 串流中誤觸）；新對話按鈕 emit 不能在 SSR phase 發生（`< lg` drawer 在 sessionStorage hydrate 前就點下 → 用 `import.meta.client` guard）。
- **Test plan**：unit（`clearConversationSessionStorage` helper success/silent-fail、`handleNewConversationRequest` orchestration with mocked toast/storage/drawer）、e2e（5 場景全跑 `e2e/new-conversation-button.spec.ts`）、screenshot review（xs 360 / md 768 / xl 1280 三 viewport 各一張，三個入口都要可見）、a11y（axe-core 掃 chat header + sidebar header，確認 button aria-label、focus order、Enter/Space 觸發）。
- **Artifact sync**：`tasks.md`、`docs/tech-debt.md` TD-048 Status 在 apply 開始時改 in-progress、archive 後改 done；`design-review.md` 透過 `/design improve` 產出（含 Fidelity Report）；ROADMAP MANUAL Next Moves 待 archive 後移除 TD-048 條目。

## Impact

- **Affected specs**：`web-chat-ui`（modified delta）
- **Affected code**：
  - Modified:
    - `app/pages/index.vue`（chat header 加按鈕、新增 `handleNewConversationRequest()` handler、綁定 `<LazyChatConversationHistory>` 的 `new-conversation-request` emit）
    - `app/components/chat/ConversationHistory.vue`（expanded header 加按鈕、collapsed plus button 改綁定 emit、emits 列表新增 `'new-conversation-request': []`）
    - `app/utils/chat-conversation-state.ts`（新增 `clearConversationSessionStorage` helper export）
    - `app/composables/useChatConversationSession.ts`（視內部 storage handle 結構決定是否新增 `clearActiveConversationStorage()` 公開 action）
    - `test/unit/create-chat-conversation-history.spec.ts`（補新對話按鈕互動測試）
    - `docs/tech-debt.md`（TD-048 Status 變更）
  - New:
    - `e2e/new-conversation-button.spec.ts`（5 場景 Playwright spec）
    - `test/unit/clear-conversation-session-storage.spec.ts`（helper unit test）
  - Removed: (none)
