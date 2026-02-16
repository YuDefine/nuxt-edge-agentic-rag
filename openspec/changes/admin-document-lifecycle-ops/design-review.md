# Design Review — admin-document-lifecycle-ops

**Date**: 2026-04-18
**Mode**: `/design improve`
**Scope**:

- `app/components/documents/DocumentListTable.vue`
- `app/pages/admin/documents/[id].vue`
- `app/components/documents/LifecycleConfirmDialog.vue`

## Quick Assessment

| 維度          | 評分  | 主要發現                                                                         |
| ------------- | ----- | -------------------------------------------------------------------------------- |
| Visual        | ★★★☆☆ | 對話框 / 詳情頁使用彩色 solid 按鈕，違反 DS「純黑白極簡、不使用彩色強調按鈕」    |
| Interaction   | ★★★★☆ | retry / loading / disabled 狀態處理完整；dropdown 漸進式揭露正確                 |
| Structure     | ★★★★☆ | 版本列有良好視覺節奏；詳情頁 header / toolbar 可更緊湊                           |
| Copy          | ★★★★☆ | 文案清晰、影響說明完整                                                           |
| Resilience    | ★★★★☆ | loading / error / empty 三態皆有；404 vs 網路錯誤已分流                          |
| Performance   | ★★★★★ | 無明顯問題                                                                       |
| Accessibility | ★★★★☆ | `aria-label` 有；dialog 缺 `aria-describedby`                                    |
| Consistency   | ★★☆☆☆ | 彩色按鈕嚴重偏離 DS；`i-lucide-dot` bullet 不一致；`bg-muted/30` 破壞 token 原則 |

## Design Fidelity Report

**Fidelity Score: 5/8** — 未達 8/8，有 4 項 DRIFT 需修復。

| #   | 類別        | 狀態   | 位置                                      | 問題                                                                                                                               | 修復方向                                                                                                   |
| --- | ----------- | ------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | consistency | DRIFT  | `LifecycleConfirmDialog.vue:44,70,87,149` | `confirmColor: 'warning' \| 'primary'` 產出黃 / 黑 solid 按鈕，違反 `.impeccable.md`「不使用彩色強調按鈕（除了語意色彩的 alert）」 | 全部 confirm button 改 `color="neutral" variant="solid"`；delete 的 `color="error"` 可保留（對齊錯誤語意） |
| 2   | consistency | DRIFT  | `[id].vue:189-212`                        | Toolbar `color="warning"` / `color="primary"` 將語意色當裝飾                                                                       | Archive / Unarchive 改 `color="neutral" variant="outline"`；delete 的 `color="error"` 可保留               |
| 3   | consistency | DRIFT  | `LifecycleConfirmDialog.vue:131`          | `bg-muted/30` 在 semantic token 加 opacity modifier，違反 token 使用慣例                                                           | 改 `bg-muted`；需要更淡用 `bg-default` + `border-muted`                                                    |
| 4   | typography  | DRIFT  | `LifecycleConfirmDialog.vue:120-129`      | `i-lucide-dot` 在 `size-4` 幾乎看不見卻作 bullet 用，語意與視覺不符                                                                | 改 `<ul class="list-disc pl-5">` 或換為 `i-lucide-circle-alert` / `i-lucide-check` 的語意 icon             |
| 5   | a11y        | 建議   | `LifecycleConfirmDialog.vue:108-162`      | Dialog 缺 `aria-describedby`，影響清單與標題未綁定                                                                                 | 影響清單包 `<div id="lifecycle-desc">` 並在 `UModal` 或 `UCard` 加 `aria-describedby="lifecycle-desc"`     |
| 6   | structure   | 建議   | `LifecycleConfirmDialog.vue:165-178`      | 第二個 `<script lang="ts">` block 放 `toneIconClass`，非 idiomatic Vue SFC                                                         | 搬進 `<script setup>` 或改為 `computed`                                                                    |
| 7   | layout      | 建議   | `[id].vue:104-114`                        | 返回按鈕獨佔一列，視覺比重過大                                                                                                     | 可併入 header 同列，`flex items-start gap-4`                                                               |
| 8   | consistency | 需註解 | `DocumentListTable.vue:76`                | Dropdown item `color: 'error'` — DS 灰色地帶，但對齊「破壞性操作使用錯誤語意」                                                     | 保留；建議 DS 補一行「破壞性動作之 menu item 允許 `color="error"`」                                        |

## Cross-Change DRIFT

跨 change 整體審查：同 layout 其他頁面的按鈕顏色使用情形未於本次抽樣，Follow-up 可掃 `app/pages/admin/**` 檢查是否有其他頁面同樣用 `color="warning"` / `color="primary"` 裝飾。

## Core Plan（canonical order）

1. `/polish app/components/documents/LifecycleConfirmDialog.vue` — 修 DRIFT #1, #3, #4
2. `/polish app/pages/admin/documents/[id].vue` — 修 DRIFT #2 + 建議 #7
3. `/harden app/components/documents/LifecycleConfirmDialog.vue` — 修建議 #5 a11y
4. `/polish` 最終 pass
5. `/audit` — Critical = 0

## Follow-Up

- `.impeccable.md` 補：「破壞性動作（delete）允許 `color="error"`；其他語意色（warning / primary）仍禁止做為強調按鈕」
- 合併 `LifecycleConfirmDialog.vue` 的雙 script block（建議 #6）

## Not Needed

- `/colorize`、`/bolder`、`/delight`、`/animate` — DS 明令禁止
- `/typeset` — 層級區分已到位
- `/adapt` — 響應式已涵蓋

---

## Post-Fix Verification (2026-04-18)

### 修復結果

| #   | 類別        | 原狀態 | 修復後                                                                                                                                       |
| --- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | consistency | DRIFT  | 已修 — `LifecycleConfirmDialog.vue`：archive / unarchive confirm button 改 `confirmColor: 'neutral'`；delete 保留 `'error'` 對齊 DS 錯誤語意 |
| 2   | consistency | DRIFT  | 已修 — `[id].vue`：archive / unarchive toolbar button 改 `color="neutral"`；delete 保留 `"error"`                                            |
| 3   | consistency | DRIFT  | 已修 — `bg-muted/30` → `bg-muted`                                                                                                            |
| 4   | typography  | DRIFT  | 已修 — `i-lucide-dot` bullet → 正式 `<ul class="list-disc pl-5 marker:text-muted">`                                                          |
| 5   | a11y        | 建議   | 已修 — 加入 `useId()` 產生的 `describedById`，`UCard aria-describedby` 綁定影響清單區塊                                                      |
| 6   | structure   | 建議   | 已修 — 移除第二個 `<script lang="ts">` block，`toneIconClass` 改為 `<script setup>` 內的 `computed`                                          |
| 7   | layout      | 建議   | 撤回 — `upload.vue` 與 `[id].vue` 皆採返回按鈕獨佔一列模式，維持跨頁一致性                                                                   |
| 8   | consistency | 需註解 | 保留建議，Follow-up 更新 `.impeccable.md` 明文列為破壞性動作例外                                                                             |

### Fidelity Score: 8/8

- Visual ★★★★★ — 無彩色強調按鈕殘留
- Interaction ★★★★★ — 無變動
- Structure ★★★★★ — 雙 script block 已合併
- Copy ★★★★☆ — 文案不變
- Resilience ★★★★★ — 無退化
- Performance ★★★★★ — 無變動
- Accessibility ★★★★★ — `aria-describedby` 已接上
- Consistency ★★★★★ — 與 `.impeccable.md` 純黑白基調一致

### Audit (Critical = 0)

- **a11y**: 對話框有 `aria-describedby`；UModal / UCard / UButton focus 狀態由 Nuxt UI 內建；delete dropdown item `color: 'error'` 視覺可辨
- **performance**: 無重 asset、無長 list、無動畫
- **theming**: 全部色彩透過 semantic token 或 Nuxt UI `color` prop，無硬編碼
- **responsive**: `flex-wrap` + `sm:grid-cols-2`，mobile 可折行
- **anti-patterns**: 無 if/else chain on enum；`assertNever` 覆蓋 tone / action 全部分支

Critical = 0，無 P0 / P1 阻擋項目。

### 已修檔案

- `app/components/documents/LifecycleConfirmDialog.vue`
- `app/pages/admin/documents/[id].vue`
- `app/components/documents/DocumentListTable.vue`（無變動；`color: 'error'` dropdown item 保留並記錄為 DS 例外）

---

## Visual QA Checklist (2026-04-18 完成)

**環境阻塞的 root cause 與修復**: 本地 dev server 啟動時的 `[nuxt-hub] DB binding not found` 錯誤源於 `@nuxthub/core@0.10.7` 的 `setupDatabase()` 在 `hub.hosting.includes('cloudflare') && !nuxt.options.dev` 時無條件選取 `d1` driver（`module.mjs:229`），且未檢查 `_prepare` flag。husky 在 install 階段觸發的 `nuxt prepare`（dev=false, \_prepare=true, preset=cloudflare_module）因此把 `node_modules/@nuxthub/db/db.mjs` 覆寫為 D1-only template，使 better-auth 的 drizzle adapter 在本地也去找 Cloudflare D1 binding。修復：新增 `scripts/patch-hub-db-dev.mjs`，在 `predev` / `postprepare` 階段把 `db.mjs` 改為 libsql 版本，並讀取 `NUXT_HUB_LIBSQL_URL`（預設 `file:.data/db/sqlite.db`）。sign-in/sign-up endpoint 重啟後回 200，可正常取得 session cookie。

### 自動化視覺 QA 結果

登入 admin (`admin@test.local` / `DesignReview2026!`) 後，以 `browser-use` CLI 自動截圖 9 張。

#### 1. 列表頁 Dropdown `/admin/documents`

- [x] Draft 文件 dropdown 顯示「檢視詳情 / 刪除」，**刪除** 紅色（`screenshots/local/admin-document-lifecycle-ops/01-list-dropdown-draft.png`）
- [x] Active 文件 dropdown 顯示「檢視詳情 / 封存」，**封存** 中性色不是黃色（`screenshots/local/admin-document-lifecycle-ops/02-list-dropdown-active.png`）
- [x] Archived 文件 dropdown 顯示「檢視詳情 / 解除封存」，**解除封存** 中性色（`screenshots/local/admin-document-lifecycle-ops/03-list-dropdown-archived.png`）

#### 2. 詳情頁 Toolbar `/admin/documents/[id]`

- [x] Active 文件 toolbar **封存** 按鈕 `variant="outline"` + 中性灰邊框，不是黃色（`screenshots/local/admin-document-lifecycle-ops/04-detail-toolbar-active.png`）
- [x] Archived 文件 toolbar **解除封存** 按鈕中性灰邊框，不是黑色 solid primary（`screenshots/local/admin-document-lifecycle-ops/05-detail-toolbar-archived.png`）
- [x] Draft-never-published 文件 toolbar **刪除** 按鈕紅色邊框保留（`screenshots/local/admin-document-lifecycle-ops/06-detail-toolbar-draft.png`）

#### 3. LifecycleConfirmDialog 三個 variant

| Variant   | Header icon            | Confirm button                       | Bullets               | 截圖                                                                        |
| --------- | ---------------------- | ------------------------------------ | --------------------- | --------------------------------------------------------------------------- |
| Delete    | `trash-2` 紅色         | 紅色 solid                           | 正式 `list-disc` 圓點 | `screenshots/local/admin-document-lifecycle-ops/07-dialog-delete.png` ✅    |
| Archive   | `archive` 黃色         | **中性黑色 solid**（非黃色）         | 正式 `list-disc` 圓點 | `screenshots/local/admin-document-lifecycle-ops/08-dialog-archive.png` ✅   |
| Unarchive | `archive-restore` 灰色 | **中性黑色 solid**（非藍色 primary） | 正式 `list-disc` 圓點 | `screenshots/local/admin-document-lifecycle-ops/09-dialog-unarchive.png` ✅ |

- [x] 影響清單使用真正項目符號（肉眼可見的 `•` 圓點），非 `i-lucide-dot` icon
- [x] 管理員 email 區塊背景為 `bg-muted` 純色，非半透明 `bg-muted/30`
- [x] Dialog 元素有 `aria-describedby` 綁定（`useId()` 產生之 `describedById` 於 `<UCard>` 上綁定影響清單區塊）

### 殘留問題

- 無。所有 8 項 Visual QA 項目通過，Fidelity Score 維持 8/8。

### 截圖清單

```
screenshots/local/admin-document-lifecycle-ops/
  01-list-dropdown-draft.png       — draft row dropdown（檢視詳情 / 刪除）
  02-list-dropdown-active.png      — active row dropdown（檢視詳情 / 封存）
  03-list-dropdown-archived.png    — archived row dropdown（檢視詳情 / 解除封存）
  04-detail-toolbar-active.png     — active 詳情頁 toolbar 封存按鈕
  05-detail-toolbar-archived.png   — archived 詳情頁 toolbar 解除封存按鈕
  06-detail-toolbar-draft.png      — draft 詳情頁 toolbar 刪除按鈕
  07-dialog-delete.png             — 刪除確認對話框（紅 trash-2 / 紅 solid confirm）
  08-dialog-archive.png            — 封存確認對話框（黃 archive icon / 中性黑 solid confirm）
  09-dialog-unarchive.png          — 解除封存確認對話框（灰 archive-restore / 中性黑 solid confirm）
```
