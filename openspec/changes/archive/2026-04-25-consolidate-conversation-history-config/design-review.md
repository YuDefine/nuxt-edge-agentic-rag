# Design Review — consolidate-conversation-history-config

## Scope

Pure internal refactor: extract `createChatConversationHistory` factory to consolidate the duplicated `useChatConversationHistory` config literal + refresh reconciliation logic between `app/pages/index.vue` and `app/components/chat/ConversationHistory.vue` (owner-fallback branch).

## Visual change assessment

**No visual changes.** Verified by diff inspection:

- `git diff --stat app/pages/index.vue app/components/chat/ConversationHistory.vue` → 17 insertions / 114 deletions, all inside `<script setup>` blocks.
- `git diff` filtered to `<template>` / `<div>` / `<button>` / `<Lazy*>` / `<U*>` lines → **zero** matches.
- Toast copy (`無法更新對話列表` / `無法刪除對話` / `無法載入對話` / `請稍後再試。` + icon `i-lucide-alert-circle` + color `error`) preserved verbatim inside the factory's default `onHistoryError` / `onConversationLoadError` fallbacks.
- `provide(ChatConversationHistoryInjectionKey, conversationHistory.api)` keeps the injection key identity; `ConversationHistory.vue` continues to `inject` the same shape (`ChatConversationHistoryApi` = `ReturnType<typeof useChatConversationHistory>`), so child-side consumers (`conversations` / `isLoading` / `deleteInFlightId` / `selectConversation` / `deleteConversationById`) remain untouched.
- Refresh reconciliation order (refresh → exist-check → detail fallback → cleared notification) is preserved 1:1 — the factory's `refreshAndReconcile` body is the same sequence previously inlined in `refreshConversationHistory` (index.vue) and `refreshHistory` (ConversationHistory.vue).

## Skip rationale for `/design improve` + `/audit` full pipeline

- Scope is pure internal refactor with zero visual change; `/design improve` is diagnostic and has no target.
- `/audit` Critical checks (accessibility, performance, theming, responsive) have no new surface to evaluate; the DOM tree is untouched.
- Existing coverage keeps visual/a11y behavior pinned:
  - `test/unit/conversation-history-aria.spec.ts` — aria contract
  - `test/unit/conversation-history-midnight.spec.ts` — bucket time grouping
  - `test/unit/conversation-history-component.test.ts` — mount-level interaction (provide/inject, dedup fetch, keyboard)
  - `test/unit/chat-conversation-history.test.ts` — composable contract
  - `test/unit/create-chat-conversation-history.spec.ts` — new factory reconcile paths + default toast fallbacks
  - `test:unit` full run: 112 files / 656 tests green post-refactor.

## Evidence

- **Code evidence**: diff scope confined to `<script setup>`; template markup byte-identical.
- **Test evidence**: `pnpm test:unit` 656/656 green. `pnpm tsc --noEmit` clean. `pnpm audit:ux-drift` clean.
- **Screenshot review (task 6.2)**: 2026-04-25 via screenshot-review agent on local dev (port 3010, admin session via `/api/_dev/login`). 4 shots captured in `screenshots/local/consolidate-conversation-history-config/` — desktop 1440×900 full view + sidebar clip + mobile 390×844 drawer closed + drawer open. All PASS: empty state copy (`尚無已保存對話。送出第一個問題後，這裡會出現對話歷史。`) identical in inline sidebar and off-canvas drawer, no console errors, no 5xx, no hydration mismatch.
- **Manual verification (task 7.\*)**: deferred to user in local dev — journey walk (select / delete / cleared notification / new conversation / active deletion) to confirm identical runtime behavior.

## Fidelity

- Fidelity check not applicable — zero design surface change, so no DRIFT can be introduced by this change alone.
- Cross-change DRIFT also N/A: this refactor preserves rather than diverges from existing layouts.
