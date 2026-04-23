# Tasks

實作範圍：chat 對話記錄 sidebar 於 lg+ 可收合為 icon rail，並將對話列表改為按時間分組可摺疊。純前端 UI 變更，不觸動 server / DB / API。

本 change 實作 `responsive-and-a11y-foundation` spec 的兩個新 requirement：

- **Chat History Sidebar Collapsible Control At lg+** — 由 §3（`index.vue` 收合 state / rail layout）、§4（drawer 不適用收合）、§5（design review）、§6（驗證）、§7（人工檢查 7.1–7.5、7.7、7.10）共同覆蓋。
- **Chat History Time-Based Grouping** — 由 §1（time-bucket 純函式 + 單元測試）、§2（`ConversationHistory.vue` 分組 UI）、§5（design review）、§7（人工檢查 7.1、7.6、7.8、7.9）共同覆蓋。

---

## 1. Time-bucket 純函式與測試（覆蓋 requirement: Chat History Time-Based Grouping）

- [x] 1.1 [P] 實作 requirement "Chat History Time-Based Grouping"：建立 `app/utils/conversation-grouping.ts`，export `groupConversationsByRecency(conversations: ChatConversationSummary[], now: Date): Array<{ bucket: 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier'; label: string; conversations: ChatConversationSummary[] }>`，以 local time 計算 bucket；遺失 / 非法 `updatedAt` 歸入 `earlier`。Bucket 順序固定；空 bucket **不輸出**到結果陣列。
- [x] 1.2 [P] 建立 `test/unit/conversation-grouping.test.ts`：覆蓋 today / yesterday / thisWeek boundary (2 天前 23:59 → thisWeek；7 天前 00:00 → thisWeek；8 天前 → thisMonth) / thisMonth boundary (30 天前 → thisMonth；31 天前 → earlier) / 空陣列 / `updatedAt` 為 `''` / `'not-a-date'` / `null` 均歸入 `earlier` 且不拋例外。

## 2. ConversationHistory 時間分組 + collapsed rail 支援（覆蓋 requirement: Chat History Time-Based Grouping + Chat History Sidebar Collapsible Control At lg+）

- [x] 2.1 修改 `app/components/chat/ConversationHistory.vue`：新增 `collapsed?: boolean`（預設 `false`）、`onExpandRequest?: () => void` props；當 `collapsed === true` 時 render rail 版 template（只顯示 `i-lucide-history` + 對話總數 `UBadge` + 新增對話按鈕 placeholder，整體可點擊觸發 `onExpandRequest`）。
- [x] 2.2 在 expanded 版 template 將現有扁平列表替換為 `groupConversationsByRecency` 輸出驅動的 `UCollapsible` 陣列；每組 header 顯示組名（今天 / 昨天 / 本週 / 本月 / 更早）+ 對話數 `UBadge` + chevron icon。預設展開：today / yesterday / thisWeek；預設收起：thisMonth / earlier。使用者展開 / 收起狀態由 `ref<Record<bucket, boolean>>` 維護（component 生命週期內記憶）。
- [x] 2.3 [P] 保持既有 props / emits 契約：`disabled` / `refreshKey` / `selectedConversationId` / `conversation-cleared` / `conversation-selected` 行為與 payload 完全不變；刪除按鈕行為不變；`isSelected` / `formatUpdatedAt` 邏輯維持。
- [x] 2.4 Empty state（conversations 為空）不走分組路徑，仍顯示現有的「尚無已保存對話...」提示；collapsed rail 的 Badge 在空狀態下隱藏或顯示 `0`（二擇一，實作時挑視覺較佳者並於 design-review.md 註記）。

## 3. Sidebar 收合 state 與 rail layout（覆蓋 requirement: Chat History Sidebar Collapsible Control At lg+）

- [x] 3.1 [P] 實作 requirement "Chat History Sidebar Collapsible Control At lg+"：修改 `app/pages/index.vue`，以 `useLocalStorage('chat:history-sidebar:collapsed', false)` 建立 `sidebarCollapsed` ref；mount 前 SSR 階段一律當 expanded 處理，避免 hydration mismatch（`useLocalStorage` 已內建此行為，需驗證）。
- [x] 3.2 左側 `<aside>` 改為動態寬度：展開 `lg:w-64`、收合 `lg:w-12`，加 `transition-[width] duration-200`；`< lg` 依然 `hidden`（drawer 不動）。
- [x] 3.3 Sidebar header 右側（展開態）加 `UButton` toggle：`variant="ghost" size="xs" icon="i-lucide-panel-left-close"`，`aria-label="收合對話記錄"`；點擊 flip `sidebarCollapsed`。
- [x] 3.4 Collapsed rail template：頂端放 `UButton icon="i-lucide-panel-left-open"` 包在 `UTooltip text="展開對話記錄"` 內，`aria-label="展開對話記錄"`；下方傳 `collapsed` prop + `onExpandRequest` callback 給 `LazyChatConversationHistory`。
- [x] 3.5 [P] `<aside>` 的 `aria-label` 依狀態切換：展開「對話記錄」、收合「對話記錄（已收合）」，確保輔助技術可感知狀態。

## 4. Drawer（< lg）沿用分組但不收合

- [x] 4.1 `< lg` 的 `USlideover` drawer 內的 `LazyChatConversationHistory` **不傳** `collapsed` prop（維持預設 `false`），drawer 內看到的是 expanded + 分組版本；drawer 本身開關行為不動。

## 5. Design Review

- [x] 5.1 檢查 `.impeccable.md` 是否存在，若無則先執行 `/impeccable teach`。
- [x] 5.2 執行 `/design improve app/pages/index.vue app/components/chat/ConversationHistory.vue`（含 Design Fidelity Report）。
- [x] 5.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）。
- [x] 5.4 依 /design 計劃按 canonical order 執行 targeted skills（預期至少：`/layout` + `/animate`（收合 transition）+ `/harden`（empty / localStorage-unavailable state）+ `/polish`）。
- [x] 5.4.1 響應式 viewport 測試：xs 360 / md 768 / lg 1024 / xl 1440 四個斷點截圖並人工核對。
- [x] 5.4.2 無障礙檢查：@nuxt/a11y dev report 無 error；鍵盤 Tab 進 sidebar → toggle 可 focus、Enter/Space 可觸發；Tooltip 可被 screen reader 讀到；collapsed rail 整體非 `aria-hidden`。
- [x] 5.5 執行 `/audit app/pages/index.vue app/components/chat/ConversationHistory.vue` — 確認 Critical = 0。
- [x] 5.6 執行 `review-screenshot` — 視覺 QA（desktop 展開 / desktop 收合 / drawer 三態 × light + dark）。
- [x] 5.7 Fidelity 確認 — `design-review.md` 中無 DRIFT 項。

## 6. 驗證

- [x] 6.1 [P] `pnpm test test/unit/conversation-grouping.test.ts` 通過。
- [x] 6.2 [P] `pnpm check`（format / lint / typecheck / test）全綠。
- [x] 6.3 [P] `pnpm audit:ux-drift` 無新 exhaustiveness 漂移（本次未新增 enum，預期通過）。
- [x] 6.4 Playwright `e2e/chat-persistence.spec.ts` 本地重跑通過，確認 refresh / select / delete 行為無回歸。
- [x] 6.5 手動：Safari 私密視窗測試 collapse toggle —— localStorage 不可用時 in-memory fallback 生效、無錯誤。

## 7. 人工檢查

- [x] 7.1 Desktop lg+：預設載入 sidebar 展開、對話依時間分組、thisMonth / earlier 預設收起、badge 數量正確。
- [x] 7.2 Desktop lg+：點收合 → 動畫 < 300ms、變 `w-12` rail、localStorage 寫入 `true`、reload 後仍收合。
- [x] 7.3 Desktop lg+：點 rail 上 expand 按鈕（或 history icon 區）→ 展開、剛剛的 bucket 展開狀態保留（session 內）。
- [x] 7.4 Desktop lg+：hover rail toggle → Tooltip「展開對話記錄」顯示。
- [x] 7.5 Desktop lg+：鍵盤 Tab → toggle 可 focus、Enter/Space 切換、focus ring 可見。
- [x] 7.6 Tablet / Mobile（< lg）：header 歷史按鈕仍開 drawer、drawer 內看到分組版列表、bucket 可展開收起、drawer 關閉行為與現況一致。
- [x] 7.7 Light + dark mode 下 rail 頂 icon、Badge、分組 chevron、分組 hover 態都不破色。
- [x] 7.8 Empty state（全新帳號 0 對話）：展開態顯示原空狀態文案；收合態 rail 不 crash（Badge 顯示 0 或隱藏，符合 2.4 決策）。
- [x] 7.9 對話刪除流程：展開態在某 bucket 內刪除對話、Badge 數量即時更新、空 bucket 自動消失；不 regress。
- [x] 7.10 Safari 私密模式 / localStorage 禁用：toggle 仍可在 session 內切換，無 console error、無 toast 錯誤。
