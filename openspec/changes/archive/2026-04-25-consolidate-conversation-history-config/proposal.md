## Why

TD-026：`app/pages/index.vue` 與 `app/components/chat/ConversationHistory.vue` 兩處有幾乎逐行相同的 `useChatConversationHistory` config（`deleteConversation` / `listConversations` / `loadConversation` + 4 組 toast / emit callbacks）以及 refresh-then-reconcile 邏輯（refresh → 查存在性 → `loadChatConversationDetail` fallback → cleared notification）。TD-023 引入 provide/inject 後，`ConversationHistory.vue` 保留 owner-fallback 分支僅為 test / isolated-mount 場景；parent 永遠 provide，實務無人走 fallback。兩處漂移（toast 文案、callback signature）不會被既有 test 抓到。

## What Changes

- 新增 `createChatConversationHistory($csrfFetch, toast, options)` factory，集中維護：
  - `api`：`useChatConversationHistory` 的 config literal（7 callbacks + `selectedConversationId`）
  - `refreshAndReconcile(selectedId?)`：refresh → 查存在性 → detail fallback → cleared notification
- `app/pages/index.vue` 改用 factory，parent provide 行為不變
- `app/components/chat/ConversationHistory.vue` owner-fallback 分支改用 factory（或改以 test helper provide 真 instance，讓 production 與 test 走同一條路徑）
- 新增 factory unit test 直接覆蓋 `refreshAndReconcile` 三條路徑
- 完成後將 `docs/tech-debt.md` 的 TD-026 改 Status: `done`，移除 `@followup[TD-026]` marker

## Non-Goals

- **不**改變 `useChatConversationHistory` composable 的 public API
- **不**改變任何使用者可見行為（toast 文案、conversation 選取 / 刪除 / cleared 流程、refresh 順序）
- **不**改 `/api/conversations` / `/api/conversations/:id` endpoint 契約
- **不**動 provide/inject key（`ChatConversationHistoryInjectionKey` 保留）
- **不**擴張到 TD-023 其他 provide/inject 面向
- **不**把 refactor 與新 feature 綁在一起交付

## User Journeys

**No user-facing journey (internal refactor; no behavior change).**

理由：本 change 僅抽取 factory 消除 `index.vue` 與 `ConversationHistory.vue` 間的 config / refresh 邏輯重複，不改 public API、不改 UI surface、不改 endpoint 契約。既有 journey（回首頁看對話列表 → 點選切換 → 刪除 → cleared notification）由 `tests/unit/conversation-history-*.spec.ts` 與 `test/integration/chat-home-fetch-dedup.spec.ts` 覆蓋，refactor 後這些測試須繼續綠。

## Implementation Risk Plan

- **Truth layer / invariants**: `useChatConversationHistory` composable 的 public API 是 truth source；factory 僅為 config 組裝 helper，不得改 refresh / reconcile 順序（refresh → exist-check → detail fallback → cleared notify）
- **Review tier**: Tier 1 — 小型純 refactor、行為不變、有既有 unit + integration 測試覆蓋
- **Contract / failure paths**: success（兩處 config 一致）/ list refresh 失敗（toast）/ delete 失敗（toast）/ load 失敗（toast + cleared fallback）/ isolated mount 無 provide（fallback 保留或以 test helper 取代）— 所有既有路徑保留
- **Test plan**: (1) 新增 `test/unit/create-chat-conversation-history.spec.ts` 覆蓋 `refreshAndReconcile` 三條路徑（selectedId 存在於 list、不存在需 detail fallback、detail missing → cleared）；(2) 既有 `conversation-history-{aria,midnight,component}.spec.ts` 全綠；(3) 既有 `chat-home-fetch-dedup.spec.ts` 全綠；(4) 以 `pnpm audit:ux-drift` 確認無新 exhaustiveness drift
- **Artifact sync**: `openspec/changes/consolidate-conversation-history-config/tasks.md`、`docs/tech-debt.md` TD-026 → `done`、`openspec/ROADMAP.md` MANUAL backlog 移除 TD-026 項

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-chat-ui`: 新增一條 **Conversation History Refresh Reconciliation** requirement，把目前只存在於 `index.vue` / `ConversationHistory.vue` 的 implicit reconcile 順序（refresh → exist-check → detail fallback → cleared notify）正式化為 spec-level invariant，讓 factory 抽取後行為仍有正式 spec 保證。

## Impact

- Affected specs:
  - `web-chat-ui`（ADDED Requirement）
- Affected code:
  - New:
    - app/composables/create-chat-conversation-history.ts
    - test/unit/create-chat-conversation-history.spec.ts
  - Modified:
    - app/pages/index.vue
    - app/components/chat/ConversationHistory.vue
  - Removed:
    - （可能移除 `app/components/chat/ConversationHistory.vue` owner-fallback 分支，若改採 test helper provide 真 instance）
