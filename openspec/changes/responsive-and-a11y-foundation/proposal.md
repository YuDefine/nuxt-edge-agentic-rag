## Why

`v1.0.0` 既有 UI spec（`admin-document-management-ui`、`web-chat-ui`）皆為行為導向，**完全未提響應式與無障礙規範**；程式碼層僅零星 `sm:` / `md:` 與 1 個 `aria-label`，缺乏系統性策略。當前報告 `main-v0.0.38.md` 亦無跨裝置設計與 a11y 原則章節，答辯時若評審詢問「手機上能不能用？」或「有無考慮無障礙？」將無話答。為避免每個新 UI change 各自發明響應式與 a11y 做法，需建立跨頁面通用 baseline，讓既有與未來所有 UI 自動繼承。

## What Changes

### 新 Capability `responsive-and-a11y-foundation`（全站 baseline）

- 定義支援寬度與斷點：**最小支援 360px**（`xs` baseline）；`< 360px` 不保證體驗、不做 horizontal scroll hack 救援
- 六層 breakpoint：`xs: 360` / `sm: 640` / `md: 768` / `lg: 1024` / `xl: 1280`（`< 360` 為 edge case）
- **核心斷點 `md: 768px`**：mobile ↔ tablet+ 的分水嶺，nav pattern 與表格 fallback 皆在此切換
- Mobile-first CSS 原則：基礎樣式為 mobile，`md:` 以上擴展 tablet / desktop
- Nav pattern：`< md` 用 `USlideover` drawer（漢堡按鈕觸發）、`md+` 側邊欄常駐；chat layout 對話歷史同原則
- 表格 fallback：`md+` 用 `UTable` 完整欄位；`< md` 主欄位保留（title + status + primary action）+ 次欄位移入「詳情 drawer」（點列開 `USlideover`）—— 非純 card view、非純 horizontal scroll
- a11y baseline：
  - Nuxt UI 4 / Reka UI 提供的 ARIA + keyboard navigation 為基礎（覆蓋 ~70%）
  - 導入 `nuxt-a11y` module（<https://nuxt.com/modules/a11y>）於 dev-time 自動檢測缺 alt、low contrast、focus trap 等
  - WCAG AA 對比度目標：一般文字 4.5:1、大字體 / UI 元件 3:1（由 Tailwind theme token 設計階段保證）
  - Keyboard nav：所有互動元素可 Tab、modal / drawer 支援 Esc 關閉、focus ring 視覺可見
  - **不強制 CI pipeline 跑 axe / Lighthouse**（保留 option，預設關閉）

### Tailwind 4 theme 擴展

- 於 `app/assets/css/main.css`（或等價 theme 入口）`@theme` 區塊加 `--breakpoint-xs: 360px`，使 `xs:` utility prefix 可用

### Design Review 流程整合

- 更新 `.spectra.yaml` 的 `design.review_steps`：新增 `responsive_check`（檢核 xs/md/xl 三個斷點截圖）與 `a11y_check`（nuxt-a11y 報告 + 鍵盤流程）兩步
- 更新 `.claude/rules/proactive-skills.md` 的 **Design Review Task Template**：加入「響應式 viewport 測試」與「nuxt-a11y 檢查」兩個 checkbox，往後所有 UI change 的 tasks artifact 自動繼承此兩步
- **不回頭改既有 in-progress change 的 tasks**：`bootstrap-v1-core-from-report`、`add-v1-core-ui`、`admin-document-lifecycle-ops`、`member-and-permission-management`、`admin-ui-post-core`、`observability-and-debug` 皆不於本 change 內動；若既有 UI 需補響應式，由後續獨立 ingest 處理

### Layout 與既有元件的 responsive 改造

- `app/layouts/default.vue`、`app/layouts/chat.vue`：加入 `< md` drawer 行為
- `app/components/documents/DocumentListTable.vue`：依斷點切換完整欄位 ↔ 主欄 + 詳情 drawer
- `app/components/chat/MessageList.vue` 與 chat sidebar：對話歷史 `< md` 改抽屜
- 既有零星 `md:` / `sm:` 類別統一遵循本 baseline

## Non-Goals

- 不重寫既有 UI 行為；僅補 responsive + a11y layer
- 不支援 `< 360px` 螢幕（~1% 設備，放棄）
- 不自定非 Tailwind 預設 breakpoint（除了 `xs: 360`）
- 不強制 CI 跑 axe / Lighthouse（留為 option，預設關閉）
- 不做 print stylesheet、不做 high-contrast mode、不做 reduced-motion 客製（沿用 Tailwind 預設 `motion-safe:` / `motion-reduce:` prefix 即可，不列為硬性要求）
- 不做多語系（i18n）；沿用 v1.0.0 zh-tw 單語
- 不回頭修改 `bootstrap-v1-core-from-report` / `add-v1-core-ui` / `admin-document-lifecycle-ops` / `member-and-permission-management` / `admin-ui-post-core` / `observability-and-debug` 的 tasks 或 specs
- MCP 不受影響（server-to-server，無 UI 關聯）

## Capabilities

### New Capabilities

- `responsive-and-a11y-foundation`: 跨頁面響應式斷點、layout pattern、表格 fallback、無障礙 baseline（ARIA、keyboard、對比度）與 `nuxt-a11y` module 整合。

### Modified Capabilities

(none)

## Impact

- **Affected specs**: `responsive-and-a11y-foundation`（新）
- **Affected code**:
  - `app/assets/css/main.css`（`@theme` 加 `--breakpoint-xs: 360px`）
  - `nuxt.config.ts`（註冊 `nuxt-a11y` module + dev-only flag）
  - `package.json`（新增 `nuxt-a11y` 依賴）
  - `app/layouts/default.vue`（nav drawer for `< md`）
  - `app/layouts/chat.vue`（sidebar drawer for `< md`）
  - `app/components/documents/DocumentListTable.vue`（表格 fallback：主欄 + 詳情 drawer）
  - `app/components/documents/UploadWizard.vue`（響應式版面調整）
  - `app/components/chat/MessageList.vue`（對話歷史 drawer）
  - `app/components/chat/ChatSidebar.vue` 或等價檔（如存在）
  - `app/pages/admin/documents/[id].vue`（響應式調整）
  - `app/pages/index.vue`（響應式調整）
  - `shared/components/ResponsiveTable.vue`（可選新元件，封裝 hybrid 策略）
  - `.spectra.yaml`（review_steps 擴充）
  - `.claude/rules/proactive-skills.md`（Design Review Template 擴充）
- **Affected docs**:
  - `main-v0.0.39.md` 起補 §2.1.1 mobile 使用情境、§2.4.5 無障礙設計子節、§3.2.3.0 響應式設計原則子節、§4.1.2 加「跨裝置支援」列點（此報告文字變更屬 improve.md 類別 1，不由本 change 的 `/spectra-apply` 直接寫入）
- **Affected systems**:
  - Build-time：Tailwind 4 theme generation（增 xs breakpoint）
  - Runtime：`nuxt-a11y` module 僅 dev-time，production bundle 不包含
  - No database / API / runtime binding 影響
- **Dependency**: 無硬相依；但建議於 `bootstrap-v1-core-from-report` 與 `add-v1-core-ui` 人工驗收全部通過（staging 穩定）後再 `/spectra-apply`，避免改動 layout / 共用元件影響尚進行中的驗收
- **Non-breaking**: Responsive 與 a11y 補強屬漸進強化，不改變既有行為契約
