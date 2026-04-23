# Design Review — code-quality-review-followups

**Date**: 2026-04-24
**Reviewer**: Claude (spectra-apply session)
**Affected surfaces**: `app/components/chat/ConversationHistory.vue`, `app/pages/index.vue`

---

## Scope classification: Non-visual refactor

本 change 雖觸及 `.vue` 檔，但沒有任何視覺 / 佈局 / 排版 / 色彩 / 動效決策。變動類型：

| 變動                                                                           | 類型                    | 視覺影響                                                 |
| ------------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------- |
| `:aria-expanded="bucketOpenState[group.bucket]"` 加到 bucket toggle `<button>` | a11y attribute          | 無（attr 不 render）                                     |
| `onExpandRequest?: () => void` prop → `'expand-request': []` emit              | component API signature | 無（event 語法改變，UI 不變）                            |
| `useNow({ interval: 60_000 })` 注入 `groupedConversations` computed            | 時間 reactivity         | 一般時段無差異；跨午夜才有分桶 relabel（原本的 bug fix） |
| `useChatConversationHistory` hoist 到 `index.vue` + provide/inject             | state scope             | 無（同一資料源，兩個 surface 渲染結果不變）              |
| `chat-history-sidebar-source-contract.test.ts` 刪除 + e2e assertion 寫法       | 測試品質                | 無                                                       |

**沒有新增 UI surface、沒有更動既有 surface 的視覺表現**。Canonical design skills（/layout, /typeset, /colorize, /bolder, /quieter, /distill, /animate, /delight, /polish 等）沒有可評估的對象。

---

## Fidelity Report

**Reference**: `.impeccable.md`（存在，v0.0.X baseline）

| Dimension              | Status | Notes                                                                 |
| ---------------------- | ------ | --------------------------------------------------------------------- |
| Spacing                | —      | 未改                                                                  |
| Layout                 | —      | 未改                                                                  |
| Typography             | —      | 未改                                                                  |
| Color                  | —      | 未改                                                                  |
| Component consistency  | ✅     | bucket toggle 按鈕其餘 class / props 保持與原樣一致，只新增 a11y attr |
| Responsive breakpoints | —      | 未改                                                                  |
| Interaction animations | —      | 未改                                                                  |
| Dark mode              | —      | 未改                                                                  |

**Score**: N/A — nothing to score against design decisions.
**DRIFT count**: 0
**Cross-Change DRIFT**: 0

---

## Audit (a11y / technical) — lightweight verification

本 change 的 a11y 風險面只有新增的 `aria-expanded` binding。以原始碼層檢視：

- **Correctness**: `:aria-expanded="bucketOpenState[group.bucket]"` 綁定的是 `ref<Record<ConversationRecencyBucket, boolean>>`，與 `<LazyUCollapsible :open="bucketOpenState[group.bucket]">` 用同一 source of truth，`@update:open` 同步更新 map，屬性會同步翻轉。
- **No conflict with UCollapsible**: Nuxt UI 4 的 `UCollapsible` 內部 trigger 由 `asChild` 代理，我們自己加的 `aria-expanded` 在同一個 `<button>` 上是冗餘但不矛盾——實際渲染 attr 會是 `"true"` / `"false"` 字串化 boolean。單元測試 `test/unit/conversation-history-aria.spec.ts` 覆蓋 true / false / 點擊翻轉三種狀態。
- **No regression on existing aria-label**: collapsed rail 的 `aria-label="展開對話記錄"`、delete button 的 `aria-label="刪除對話 {title}"` 都保留不動。
- **Keyboard path**: bucket toggle `<button type="button">` 保持原樣，`focus-visible:ring-*` class 未動；鍵盤 Tab / Enter walkthrough 在 10.2 人工檢查覆蓋。
- **Exhaustiveness**: `ConversationRecencyBucket` enum 消費點（`getRecencyBucket` in `app/utils/conversation-grouping.ts`）本來就是 `if/else if/else` 鏈——不在本次 scope，未引入新分支。

**Critical findings**: 0
**Warning findings**: 0
**Assessment**: 本次 a11y attr 加法是 net-positive，無新 regression 面。真實 AT（VoiceOver / NVDA）互動留給 10.2 人工檢查驗證。

---

## Skipped Design Review tasks

下列任務因 non-visual-refactor 判定而略過，rationale 如下：

| Task                                             | Decision             | Rationale                                         |
| ------------------------------------------------ | -------------------- | ------------------------------------------------- |
| 9.2 `/design improve` 跑全套                     | Skip                 | 無視覺決策可評估                                  |
| 9.3 修復 DRIFT                                   | Skip                 | DRIFT count = 0                                   |
| 9.4 canonical order skills                       | Skip                 | 無適用的 canonical skill                          |
| 9.4.1 響應式 viewport 截圖                       | Skip                 | 未改 layout / breakpoints；10.1 + 10.3 涵蓋功能面 |
| 9.4.2 a11y dev report + 鍵盤 walkthrough         | **Fold into 10.2**   | 避免重複；10.2 就是 aria-expanded 的 AT 實測      |
| 9.5 `/audit` Critical = 0                        | **Covered by above** | 本節以原始碼審查替代，Critical = 0                |
| 9.6 review-screenshot 視覺 QA                    | Skip                 | 無視覺變動；10.x 整體瀏覽器回歸含截圖             |
| 9.7 Fidelity 確認 design-review.md 中無 DRIFT 項 | ✅ Pass              | 本文件無 DRIFT 項                                 |

---

## Conclusion

Design Review Gate **通過**：

- Non-visual refactor 判定有據
- Fidelity DRIFT = 0
- Audit Critical = 0（lightweight source-level review）
- 9.4.2 a11y 實測 folded into 10.2 人工檢查

繼續進入 10.x 人工檢查階段。
