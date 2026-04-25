# Design Review — add-new-conversation-entry-points

**Reviewed**: 2026-04-25
**Scope**: 三個新對話按鈕（chat header / sidebar expanded header / sidebar collapsed plus button rebind）
**Reviewer**: Claude Code（manual review，scope 過小未啟 `/design improve` sub-skill chain）

## Affected Components

- `app/pages/index.vue` — chat 主欄 header `<h1>知識庫問答</h1>` 同列加 UButton；兩處 `<LazyChatConversationHistory>` 綁 `@new-conversation-request`
- `app/components/chat/ConversationHistory.vue` — emits 新增 `new-conversation-request`；expanded header 加 UButton；collapsed `i-lucide-plus` 改綁 emit + 換 icon `i-lucide-message-circle-plus`

## Design System Fidelity Report

對齊 `.impeccable.md` 的純黑白極簡主義規範：

| #   | Check                                | Result | Notes                                                                                                                                                                                       |
| --- | ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Color palette (neutral only)         | ✅     | 三個按鈕全用 `color="neutral"`；無 primary / warning / success / info 強調色違規                                                                                                            |
| 2   | Variant (ghost for tertiary actions) | ✅     | 全用 `variant="ghost"`，符合 `.impeccable.md:301` 的 ghost action pattern                                                                                                                   |
| 3   | Icon system (Lucide via UIcon)       | ✅     | 統一使用 `i-lucide-message-circle-plus`（語意：「對話 + 新增」），與 chat domain 主題一致                                                                                                   |
| 4   | Icon-button accessibility            | ✅     | 三處都有 `aria-label="新對話"`；keyboard activation 由 Nuxt UI UButton 原生支援（Enter / Space）                                                                                            |
| 5   | Disabled state mapping               | ✅     | 三處都透過 `props.disabled` / `conversationInteractionLocked` 在 in-flight 串流時 disable                                                                                                   |
| 6   | Touch target sizing                  | ✅     | chat header `size="sm"` ≈ 36px；sidebar headers `size="xs"` ≈ 32px。皆通過 WCAG 2.5.8 minimum (24px)；sidebar 與既有按鈕保持一致                                                            |
| 7   | Layout consistency                   | ✅     | chat header button 放在 flex `justify-between` 右側、與既有 padding `px-3 py-3 md:px-4` 對齊；sidebar header button 與既有「收合對話記錄」按鈕並列在 `flex items-center gap-1` 內，間距一致 |
| 8   | Responsive behavior                  | ✅     | chat header button 在 `< sm` 視窗只顯示 icon，`sm+` 顯示「新對話」label（透過 `<span class="hidden sm:inline">`）；sidebar 按鈕無條件顯示 icon-only                                         |

**Fidelity Score: 8/8 — No DRIFT items.**

## Cross-Change Holistic Check

採樣同 layout（`chat`）的已上線頁面：

- `app/components/chat/Container.vue` — chat 主欄內部，仍走 既有 design system，未發現 cross-change drift
- `app/components/chat/ConversationHistory.vue` 既有 collapse / delete buttons — 與本次新增按鈕的 size/variant 一致

未發現需要逆向修復的 cross-change DRIFT。

## A11y Notes

- 三處按鈕皆 `aria-label="新對話"`（screen reader 正確朗讀）
- icon-only 按鈕在 collapsed sidebar 視覺上需依賴 hover/focus 提示；既有 sidebar collapse 按鈕亦同模式，behavior 一致
- 鍵盤焦點順序：chat header 按鈕在 `<h1>` 之後（DOM 自然順序）；sidebar 按鈕在 collapse 按鈕之前
- 等實際截圖時人工 walkthrough（task 5.4.2）

## Open Items

無。實際視覺驗證透過 task 5.4.1 / 5.6 / 7.x 的 screenshot review + 人工檢查補上。
