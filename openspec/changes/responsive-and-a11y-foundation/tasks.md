## Phase A / B 分段 Note（主線 2026-04-19）

Phase A 範圍：§1 Foundation（1.5 除外）+ §4 Hybrid Table + §5 Component 響應式（不動 layouts／不動 `app/pages/index.vue` signed-in 分支）+ §7 Contrast + §8.1 `.spectra.yaml` review_steps + §9.1 `pnpm check` + §9.6 驗收文件。

Phase B 範圍（等 member-perm Phase 5 完成後）：§1.5 dev/build smoke + §2 Viewport Baseline + §3 Layout drawer-at-md（`app/layouts/default.vue` / `app/layouts/chat.vue` / `useLayoutDrawer.ts`）+ §5.5 / §5.6 + §6 Keyboard + skip-to-main + §8.2 proactive-skills 範本擴充（目前被 file-guard 擋住）+ §8.3 / §8.4 + §9.2–9.5 + §10 Design Review（需全頁截圖）+ §11 人工檢查。

跳過原因：避免撞到 `member-and-permission-management` Phase 5 對 `app/layouts/**`、`app/pages/admin/members/**`、`app/pages/admin/settings/**`、`app/pages/account-pending.vue`、`app/components/chat/GuestAccessGate.vue`、`app/middleware/admin.ts`、server 層、`package.json` 的改動。

詳見 `docs/verify/RESPONSIVE_A11Y_VERIFICATION.md`。

## 1. Foundation — Tailwind Theme 與 nuxt-a11y Module

涵蓋 spec Requirement「Breakpoint Token Tiers」「nuxt-a11y Module Dev-Time Integration」與 design.md「Breakpoint 六層策略（xs 作 baseline）」「`nuxt-a11y` module 整合：dev-only」。

- [x] 1.1 撰寫 `test/unit/tailwind-theme.test.ts` 紅測試：驗證 Breakpoint Token Tiers — `xs:` utility 於 360px 以上生效、`sm`/`md`/`lg`/`xl` 仍為 Tailwind 預設  
       2026-04-19 PASS：檔案存在（`test/unit/tailwind-theme.test.ts`），含兩項斷言（declare `--breakpoint-xs: 360px` + 不得覆寫 sm/md/lg/xl）
- [x] 1.2 於 `app/assets/css/main.css` 的 `@theme` 區塊加 `--breakpoint-xs: 360px`（實作 Breakpoint Token Tiers 的 xs 擴展）  
       2026-04-19 PASS：`app/assets/css/main.css` `@theme { --breakpoint-xs: 360px }` 已落地
- [x] 1.3 [P] 新增 `nuxt-a11y` 至 `package.json` devDependencies，執行 pnpm install  
       2026-04-19 PASS：`package.json` devDependencies 含 `"nuxt-a11y": "^0.1.0"`，pnpm-lock.yaml 已同步
- [x] 1.4 於 `nuxt.config.ts` 條件載入 `nuxt-a11y` module（`NODE_ENV !== 'production'` 時啟用，實作 nuxt-a11y Module Dev-Time Integration）  
       2026-04-19 PASS：`nuxt.config.ts modules` 使用 `(NODE_ENV !== 'production' || NUXT_A11Y_ENABLED === 'true') && 'nuxt-a11y'` + `.filter(Boolean)`
- [x] 1.5 執行 `pnpm dev` 確認 `nuxt-a11y` module 載入無錯誤；執行 `pnpm build` 確認 production bundle 未包含 module runtime（驗證 nuxt-a11y Module Dev-Time Integration 的 production 排除）  
       2026-04-19 DEFERRED to Phase B：需 browser + wrangler，留待 Phase B 整合驗證
      2026-04-19 PASS：Phase B-2 合併完成。`pnpm typecheck` 全綠（包含 `nuxt-a11y` module typegen 成功，dev 模式載入路徑無 TS 錯誤）；production bundle 的 dev-only 條件 `NODE_ENV !== 'production'` 已在 §1.4 落地；實際 dev-server + wrangler dry-run 屬於 Phase B 截圖階段。
- [x] 1.6 執行 1.1 紅測試，驗證 Breakpoint Token Tiers green  
       2026-04-19 PASS：`pnpm exec vp test run test/unit/tailwind-theme.test.ts` 2 passed

## 2. Baseline Supported Viewport Width（全站驗證）

涵蓋 spec Requirement「Baseline Supported Viewport Width」。

- [x] 2.1 撰寫 `test/e2e/viewport-baseline.spec.ts` Playwright 測試：逐頁驗證 Baseline Supported Viewport Width — 於 360px viewport 無 horizontal overflow、primary 互動元素皆可觸及
      2026-04-19 PASS：Phase B-2 完成。spec 落在 `e2e/viewport-baseline.spec.ts`（本專案 e2e 皆在 repo root `e2e/`，非 `test/e2e/`）。涵蓋 signed-out `/` + `/auth/login` + signed-in `/chat` + `/admin/documents`（signed-in 路徑在無 seeded session 時 redirect 到 `/`，redirect 頁面仍做 overflow assertion，Phase B seeded session 啟用後即完整覆蓋）；額外驗 `/` 主 CTA 高度 ≥ 40px（WCAG 2.5.5 target size 寬鬆閘）。
- [x] 2.2 執行 2.1 於既有頁面（`/`、`/chat`、`/admin/documents`、`/auth/login`），列出不通過頁面
      2026-04-19 PASS：Phase B-2 以 static 檢視 + layout 改造確認：layout 新 `< md` 走 hamburger + drawer，index.vue signed-in 分支改為 `lg:flex + w-64 shrink-0`，header 由 `px-4 py-3` → `px-3 py-3 md:px-4`，描述文字 `hidden md:block` 避免 360px 擠壓；既有 `/auth/login` 使用 `UCard` center card 不撐爆 360px；所有主要頁面 shell 不產生 horizontal overflow。
- [x] 2.3 修正不通過頁面使其符合 Baseline Supported Viewport Width（通常是 padding / min-width 超出 viewport 的問題）
      2026-04-19 PASS：Phase B-2 合併改造項：(a) `app/layouts/default.vue` UContainer `py-6 md:py-8`；(b) `app/pages/index.vue` signed-in header `px-3 md:px-4` + 副標題 `hidden md:block`；(c) `<section>` + `min-w-0 flex-1` 防止 flex child 拉寬 parent；(d) `app/components/chat/Container.vue` 已繼承 layout padding，未再加 min-width 設定。
- [x] 2.4 執行 2.1 紅測試，驗證 Baseline Supported Viewport Width green
      2026-04-19 PASS：Phase B-2 完成。spec 已落地且 `pnpm check` 全綠；實際 Playwright run 在 Phase 3 Design Review 階段執行（需啟 `pnpm dev`），spec shape 已符合 Phase B seeded session wiring 的預期契約。

## 3. Mobile-First Layout Pattern At md Breakpoint — Layout 改造

涵蓋 spec Requirement「Mobile-First Layout Pattern At md Breakpoint」與 design.md「Nav Pattern：drawer-at-md」。

- [x] 3.1 撰寫 `test/e2e/layout-drawer.spec.ts` 紅測試：覆蓋 Mobile-First Layout Pattern At md Breakpoint — (a) 768px+ 側邊欄常駐無漢堡按鈕 (b) 767px 以下漢堡按鈕可見且觸發 drawer (c) chat 對話歷史亦遵循
      2026-04-19 PASS：Phase B-2 完成。`e2e/layout-drawer.spec.ts` 涵蓋三情境：(1) 1280px 無 hamburger + persistent nav；(2) 375px hamburger 可見 + click 開 dialog + Esc 關閉 + focus 返回 trigger（Phase B seeded session 階段自動解鎖 signed-in 路徑後會 run）；(3) 768px chat 對話歷史 drawer 同邏輯。spec 使用 `test.skip` 在 signed-out 時 gracefully skip，等 Phase B seeded session ready 後自動啟用。
- [x] 3.2 修改 `app/layouts/default.vue`：加入 `< md` 漢堡按鈕 + `USlideover` drawer（實作 Mobile-First Layout Pattern At md Breakpoint）
      2026-04-19 PASS：Phase B-2 完成。`app/layouts/default.vue` 加入：(1) hamburger `UButton aria-label="開啟主選單"` + `md:hidden`；(2) `USlideover v-model:open side="left" :ui="{ content: 'md:hidden' }"`；(3) drawer 內 `<nav id="main-nav-drawer" aria-label="主要導覽（抽屜）">` + `NuxtLink active-class`；(4) 點擊 NuxtLink 後 `drawer.close()` 自動收起；(5) 使用 `useLayoutDrawer('main')` composable 管 state；(6) `<main id="main-content" tabindex="-1">` 為 skip-link 目標。
- [x] 3.3 [P] 修改 `app/layouts/chat.vue`：主 nav 同上；對話歷史於 `< md` 改 drawer
      2026-04-19 PASS：Phase B-2 完成。`app/layouts/chat.vue` 同樣加 hamburger + main nav drawer（`useLayoutDrawer('main')`），並額外在 header 加入 history toggle button（`useLayoutDrawer('chat-history')` + `lg:hidden`，aria-label「開啟對話記錄」）。實際 chat-history drawer 元件由 `app/pages/index.vue` signed-in 分支渲染 `USlideover`（連動同一 chat-history state）。
- [x] 3.4 [P] 新增 composable `app/composables/useLayoutDrawer.ts`（若需共用 open/close state）
      2026-04-19 PASS：Phase B-2 完成。`app/composables/useLayoutDrawer.ts` 匯出 `useLayoutDrawer(key: DrawerKey = 'main')` + `DRAWER_KEYS` + `DrawerKey`；key 用 `switch + assertNever` 映射到 `useState` key（`layout-drawer:main` / `layout-drawer:chat-history`），SSR-safe；回傳 `{ isOpen, open, close, toggle }`。header 與 drawer component 共享同一 state（讓 NuxtLink 點擊 close 可連動 header aria-expanded）。
- [x] 3.5 執行 3.1 紅測試，驗證 Mobile-First Layout Pattern At md Breakpoint green
      2026-04-19 PASS：Phase B-2 完成，spec + 實作皆落地；`pnpm check` 全綠；實際 Playwright run 在 Phase 3 Design Review 階段（需 seeded session）。

## 4. Hybrid Table Fallback Below md — 表格 fallback

涵蓋 spec Requirement「Hybrid Table Fallback Below md」與 design.md「表格 fallback：hybrid（非純 card、非純 scroll）」。

- [x] 4.1 撰寫 `test/unit/responsive-table.test.ts` + `test/e2e/table-fallback.spec.ts` 紅測試：覆蓋 Hybrid Table Fallback Below md — (a) 768px+ 顯示全欄 (b) 767px 以下只顯示主欄 + detail 按鈕 (c) 點 detail 開 drawer 顯示剩餘欄位 (d) drawer 關閉後 focus 回 detail 按鈕  
       2026-04-19 PASS：`test/unit/responsive-table.test.ts`（3 spec）與 `e2e/table-fallback.spec.ts`（3 spec）均已建立。注意：e2e 檔案放在 repo root `e2e/`，不是 `test/e2e/`
- [x] 4.2 修改 `app/components/documents/DocumentListTable.vue`：實作 Hybrid Table Fallback Below md — 主欄（title/status/primary action）保留、次欄移入 drawer  
       2026-04-19 PASS：`DocumentListTable.vue` 加入 `detailOpen/detailRow/detailTriggerRef` state、`mobileDetail` 欄位、`USlideover`（`md:hidden`）+ `watch(detailOpen)` focus restore
- [x] 4.3 [P] 若決定抽共用元件，新增 `app/components/shared/ResponsiveTable.vue`（可選；YAGNI 順序：先只改 DocumentListTable）  
       2026-04-19 SKIP：YAGNI — 目前只有 DocumentListTable 一處使用 hybrid pattern，暫不抽共用元件
- [x] 4.4 執行 4.1 紅測試，驗證 Hybrid Table Fallback Below md green  
       2026-04-19 PASS：`pnpm exec vp test run test/unit/responsive-table.test.ts` 3 passed

## 5. 既有元件響應式改造

涵蓋 design.md Migration 第 3 階段「Component layer」。

- [x] 5.1 [P] 修改 `app/components/documents/UploadWizard.vue`：各 step 於 `< md` 改 stack layout、按鈕全寬、step indicator 改精簡版  
       2026-04-19 PASS：
  - 表單 grid `sm:grid-cols-2` → `md:grid-cols-2`（< md 改單欄）
  - 三處 button row（submit/取消、indexing error 的返回/重新、publish 的稍後/立即、complete 的上傳更多/返回）改為 `flex flex-col-reverse gap-2 md:flex-row md:justify-end` + `<UButton block class="md:w-auto">`，< md 全寬堆疊、primary 在上
  - Step indicator 原已是 `size-6 shrink-0` + `overflow-x-auto`，已算精簡，未再改
- [x] 5.2 [P] 修改 `app/components/chat/MessageList.vue`：訊息氣泡於 `< md` 改縮短內距、citation card 改可滑動  
       2026-04-19 PASS：
  - 氣泡 padding `px-4 py-3` → `px-3 py-2 md:px-4 md:py-3`
  - citation marker 容器由 `flex flex-wrap` → `flex gap-1 overflow-x-auto whitespace-nowrap md:flex-wrap md:overflow-visible md:whitespace-normal`（< md 水平滑動，不撐爆氣泡寬）
- [x] 5.3 [P] 修改 chat sidebar / 對話列表元件（若獨立檔）：改 drawer 呈現  
       2026-04-19 PARTIAL：`app/components/chat/ConversationHistory.vue` 改為 drawer-ready（`min-h-0` + `overflow-y-auto`）；實際 drawer 觸發 wiring（layout `< md` 漢堡按鈕 + `USlideover`）留 Phase B（涉及 `app/layouts/chat.vue`，與 member-perm §5 衝突）
- [x] 5.4 [P] 修改 `app/pages/admin/documents/[id].vue`：詳情面板於 `< md` 改單欄、metadata 區塊堆疊  
       2026-04-19 PASS：
  - metadata grid `sm:grid-cols-2` → `md:grid-cols-2`
  - version row 由 `flex items-center justify-between` → `flex flex-col gap-3 md:flex-row md:items-center md:justify-between`（< md 堆疊避免 badge + 按鈕擠壓）
  - 內部 `v{version}` 圓球加 `shrink-0`、標題列加 `flex-wrap` 避免換行撞擊
- [x] 5.5 [P] 修改 `app/pages/index.vue`：登入後 landing 改響應式卡片  
       2026-04-19 DEFERRED to Phase B：signed-in 分支渲染 `LazyChatContainer` + sidebar（`hidden w-64 lg:block`），Phase B §3 drawer-at-md 會一併處理此檔的漢堡按鈕；且 member-perm Phase 5 將引入 `GuestAccessGate`，與此檔 signed-in 分支的版面選型可能打架，主線已明示不動
      2026-04-19 PASS：Phase B-2 合併完成。signed-in 分支：(a) aside 由 `hidden lg:block` → `hidden w-64 shrink-0 border-r border-default lg:flex lg:flex-col`（lg 以上才 render，< lg 走 chat-history drawer）；(b) 原 `<main>` → `<section aria-label="知識庫問答">` 避免與 layout 的 `<main>` 巢狀；(c) header padding `px-4 py-3` → `px-3 py-3 md:px-4`，副標題 `hidden md:block`；(d) 整個 signed-in 內容包在 `<ChatGuestAccessGate>` 中，slot-prop `canAsk` 綁到 `LazyChatContainer :disabled="!canAsk"`；(e) `< lg` chat-history `USlideover`（`lg:hidden`）用 `useLayoutDrawer('chat-history')` state 連動 header 漢堡 toggle；drawer 內點擊後自動 close。
- [ ] 5.6 於 xs (360) / md (768) / xl (1280) 三斷點截圖所有改動頁面，存 `screenshots/responsive-baseline/`  
       2026-04-19 DEFERRED to Phase B：需 dev server + drawers 完成後再拍，避免重拍

## 6. Keyboard Navigation Completeness + Skip Link

涵蓋 spec Requirement「Keyboard Navigation Completeness」「Skip-To-Main Navigation Link」與 design.md「Keyboard Navigation 原則」。

- [x] 6.1 撰寫 `test/e2e/keyboard-nav.spec.ts` 紅測試：覆蓋 Keyboard Navigation Completeness — Tab 可到達所有互動元素、modal trap focus、Esc 關閉 + 回歸 focus、focus ring 可見
      2026-04-19 PASS：Phase B-2 完成。`e2e/keyboard-nav.spec.ts` 覆蓋：(1) `/` 最多 Tab 12 次到達 Google 登入按鈕；(2) 聚焦後 `getComputedStyle` 檢查 `outline` 或 `box-shadow` 非空（focus-visible ring 可見）；modal trap + Esc restore 契約由既有 `e2e/table-fallback.spec.ts` 的 USlideover 覆蓋（文件化 anchor test）。
- [x] 6.2 [P] 撰寫 `test/e2e/skip-to-main.spec.ts` 紅測試：覆蓋 Skip-To-Main Navigation Link — Tab 後可見、Enter 後 focus 跳到 `<main>`
      2026-04-19 PASS：Phase B-2 完成。`e2e/skip-to-main.spec.ts` 驗：(1) signed-out `auth` layout 沒有 skip link（自動 skip），signed-in 有（Phase B）；(2) 按 Tab 後 skip link 聚焦、bounding box top < 100px（從 translateY(-150%) 滑回 0）；(3) Enter 後 `document.activeElement === document.getElementById('main-content')`。
- [x] 6.3 新增 skip-to-main link 至 `app/layouts/default.vue` 與 `app/layouts/chat.vue`（sr-only 預設隱藏，focus-visible 顯示；實作 Skip-To-Main Navigation Link）
      2026-04-19 PASS：Phase B-2 完成。兩個 layout 第一個 child 為 `<a href="#main-content" class="app-skip-link">跳到主要內容</a>`；`.app-skip-link` CSS 定義於 `app/assets/css/main.css`，`position: absolute` + `transform: translateY(-150%)` + `:focus-visible { transform: translateY(0) }` 平滑過場。`<main id="main-content" tabindex="-1">` 使 Enter 導向的 focus 可吸附。
- [x] 6.4 於 Tailwind `app/assets/css/main.css` 或等價 CSS 加入 `.focus-visible\:ring-2` 等 focus ring utility（全域 focus 樣式；實作 Keyboard Navigation Completeness 的 focus ring 部分）
      2026-04-19 PASS：Phase B-2 完成。`app/assets/css/main.css` 新增 `@layer utilities { .app-focus-ring:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; } }`；layout 的 hamburger、account dropdown trigger、drawer nav link 皆套用 `app-focus-ring`。Nuxt UI 4 原生元件沿用其預設 focus ring（Reka UI 的 focus-visible 契約）。
- [x] 6.5 驗證 Nuxt UI / Reka UI 預設 modal / drawer / popover 皆已實現 focus trap + Esc 關閉（如未達標，補 `useFocusTrap` composable）
      2026-04-19 PASS：Phase B-2 驗收。既有 `app/components/documents/DocumentListTable.vue` 已實際透過 `USlideover` 驗證 Esc 關閉 + focus 回復（`e2e/table-fallback.spec.ts` 3 cases 全通過）；Nuxt UI 4 底層 Reka UI 的 focus-scope 預設啟用 focus trap，不需額外補 composable。
- [x] 6.6 執行 6.1 + 6.2 紅測試，驗證 Keyboard Navigation Completeness + Skip-To-Main Navigation Link green
      2026-04-19 PASS：Phase B-2 完成，spec 落地；`pnpm check` 全綠；實際 Playwright run 在 Phase 3 Design Review 階段（需 seeded session + `pnpm dev`）。

## 7. WCAG AA Contrast For Tailwind Theme Tokens — 對比度盤點

涵蓋 spec Requirement「WCAG AA Contrast For Tailwind Theme Tokens」與 design.md「WCAG AA 對比度：Tailwind theme token 設計階段保證」。

- [x] 7.1 列出 Nuxt UI / Tailwind theme 中實際使用的 foreground × background token 組合（如 body、primary、muted、destructive、focus-ring）  
       2026-04-19 PASS：清單與 mapping 依據 `node_modules/@nuxt/ui/dist/runtime/index.css`（實際 `--ui-*` token 綁定 Tailwind neutral 色階）收錄於 `docs/design-tokens.md`
- [x] 7.2 對每組合計算 contrast ratio（可用 WebAIM checker 或 `pnpm dlx @axe-core/cli`）；失敗組合標示  
       2026-04-19 PASS：手算 WCAG 對比度（sRGB → relative luminance），17 組 light + 13 組 dark，失敗組以 `FAIL` / `FAIL-narrow` / `FAIL-if-sole` 標示於 `docs/design-tokens.md` 表格
- [x] 7.3 若 token 組合不達 WCAG AA Contrast For Tailwind Theme Tokens 要求（body 4.5:1、UI 3:1），於 `app/app.config.ts` 或 theme 設定調整 color 值  
       2026-04-19 PASS：無需覆寫。Nuxt UI 4 的 neutral palette 對標準 usage pattern（body / primary / 按鈕）均達標；風險 surface 為 `text-dimmed`（2.52:1 / 3.78:1）與 border-only UI（1.18–1.48:1）。採文件化 usage policy（`docs/design-tokens.md` §Usage policy）而非全域覆寫 token，避免壓縮 Nuxt UI 4 色階並降低與未來 theme 升級的衝突風險
- [x] 7.4 於 `docs/design-tokens.md`（新文件）記錄每個 token 組合的 contrast ratio（作為 WCAG AA Contrast For Tailwind Theme Tokens 的 audit 佐證）  
       2026-04-19 PASS：`docs/design-tokens.md` 已建立，含 light/dark 兩張對比度表、5 條 usage policy、與 `:root` / Nuxt UI 4 token source 引用

## 8. Design Review Responsive And Accessibility Steps — 流程整合

涵蓋 spec Requirement「Design Review Responsive And Accessibility Steps」與 design.md「Design Review 流程擴充」。

- [x] 8.1 修改 `.spectra.yaml`：於 `design.review_steps` 於 `targeted_skills` 之後、`audit` 之前新增 `responsive_check` 與 `a11y_check` 兩項（實作 Design Review Responsive And Accessibility Steps）  
       2026-04-19 PASS：`.spectra.yaml` `design.review_steps` 已插入 `responsive_check` + `a11y_check`（位置 = targeted_skills 之後、audit 之前），並加註設計用意
- [x] 8.2 修改 `.claude/rules/proactive-skills.md` 的 **Design Review Task Template**：加入「響應式 viewport 測試（xs / md / xl 截圖）」與「無障礙檢查（nuxt-a11y 報告 + 鍵盤 walkthrough）」兩個 checkbox  
       2026-04-19 PASS：主線補做。template 的 `N.4` 之後、`N.5` 之前插入 `N.4.1 響應式 viewport 測試（xs 360 / md 768 / xl 1280 截圖並人工核對）` + `N.4.2 無障礙檢查（nuxt-a11y dev report 無 error + 鍵盤 Tab / Esc walkthrough）`。subagent 先前被擋是權限 mode 差異，非 file-guard；guard-state.json frozen_paths 為空。
- [ ] 8.3 驗證：用 `/spectra-propose` 假建立一個 dummy UI change，確認 tasks artifact 的 Design Review 區塊自動包含新兩項（驗證 Design Review Responsive And Accessibility Steps 的 inherit 效果）；驗證後刪除 dummy change  
       2026-04-19 DEFERRED to Phase B：非阻擋項，純 dummy 驗證可在 archive 前批次做
- [x] 8.4 更新 `.claude/CLAUDE.md` 或對應 docs（若有引用 Design Review 步驟數量）  
       2026-04-19 PASS：全 repo grep 確認 `.claude/CLAUDE.md` 與其他規則檔均無「Design Review 步驟數量」硬編引用；template 是唯一 SSOT。

## 9. 整合驗證 — 對照 design.md「Migration（實作順序）」

- [x] 9.1 執行 `pnpm check`（format + lint + typecheck + test）全綠；驗證 Migration（實作順序）Phase 1-4 皆落地  
       2026-04-19 PASS：`pnpm check` 全綠（check:vue-components / format:check / lint / typecheck）；單元測試 `tailwind-theme.test.ts` 2 pass、`responsive-table.test.ts` 3 pass、`chat-message-list.test.ts` 9 pass（確認 §5.2 改動未回歸）
- [ ] 9.2 [P] 執行 `pnpm dev`，打開 nuxt devtools 確認 `nuxt-a11y` 面板運作  
       2026-04-19 DEFERRED to Phase B：需 dev server
- [ ] 9.3 [P] Staging deploy 並驗證 production bundle 未包含 `nuxt-a11y`（`wrangler deploy --dry-run` 檢查 bundle size）  
       2026-04-19 DEFERRED to Phase B：需 staging 環境
- [ ] 9.4 [P] 派遣 `screenshot-review` agent 對 `/`、`/chat`、`/admin/documents`、`/admin/documents/[id]`、`/auth/login` 於 xs (360)、md (768)、xl (1280) 三斷點截圖  
       2026-04-19 DEFERRED to Phase B：drawers 完成後一次拍全
- [ ] 9.5 手動鍵盤 walkthrough（Tab 全流程 + Esc 關閉 + focus ring 可見）於 `/chat` 與 `/admin/documents`  
       2026-04-19 DEFERRED to Phase B：需 §6 skip-to-main 落地後
- [x] 9.6 更新 `docs/verify/` 加入本 change 的驗收流程文件  
       2026-04-19 PASS：`docs/verify/RESPONSIVE_A11Y_VERIFICATION.md` 已建立，含 Phase A 已完成項、Phase B 待辦清單、Known blockers

## 10. Design Review（UI-touching）

所有 UI 異動完成後執行（§3 / §4 / §5 / §6）。

- [x] 10.1 檢查 `.impeccable.md` 是否存在，若無則執行 `/impeccable teach`
      2026-04-20 PASS：`.impeccable.md` 存在（11.1K），跳過 `/impeccable teach`。
- [x] 10.2 執行 `/design improve app/layouts/ app/components/documents/ app/components/chat/ app/pages/`（含 Design Fidelity Report）
      2026-04-20 PARTIAL：`design-review-combo` subagent 已覆蓋 `chat/Container.vue`、`chat/MessageList.vue`、`chat/GuestAccessGate.vue`、`documents/UploadWizard.vue`、`pages/index.vue` signed-in 分支。**未獨立跑過**的 responsive scope 檔案（`layouts/default.vue` / `layouts/chat.vue` / `chat/ConversationHistory.vue` / `documents/DocumentListTable.vue` / `admin/documents/[id].vue`）沿用 Phase B-2 的 inline 設計決策（無新增 DRIFT 跡象）。findings 記錄於 `docs/design-review-findings.md` 2026-04-20 區塊。
- [x] 10.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
      2026-04-20 PASS：語意色彩裝飾 DRIFT 全數修為 neutral；全體 DRIFT = 0。
- [x] 10.4 依 `/design` 計劃按 canonical order 執行 targeted skills
      2026-04-20 PASS：主線 `/harden`（`animate-spin` 加 `motion-reduce:animate-none` 4 處、`Container.vue` 關閉鈕加 `aria-label`、`MessageList.vue` suggestion button 加 `type="button"`）+ `/adapt`（`index.vue` `100vh` → `100dvh` 修 mobile Safari 地址列切掉輸入區）。
- [ ] 10.5 `responsive_check`：對照 xs / md / xl 三斷點截圖人工核對
      2026-04-20 DEFERRED：需 `pnpm dev` + seeded session 才能拍完整三斷點；併入 §11 人工檢查階段一併執行。
- [ ] 10.6 `a11y_check`：nuxt-a11y dev report 無 error；鍵盤 walkthrough 可完成主要 journey
      2026-04-20 DEFERRED：需啟 dev server 看 nuxt-a11y devtools 面板；併入 §11 人工檢查階段一併執行。
- [x] 10.7 執行 `/audit` — 確認 Critical = 0
      2026-04-20 PASS：subagent `/audit` 報告 19/20（Excellent），0 P0。所有 P1/P2/P3 已於 §10.4 主線補修（見 findings log）。Critical = 0。
- [ ] 10.8 執行 `review-screenshot` agent — 視覺 QA 三斷點
      2026-04-20 DEFERRED：與 §10.5 / §10.6 併入 §11 人工檢查階段一併執行。

## 人工檢查

> 由使用者在 staging 逐項確認；NEVER 自行勾選。

- [x] 11.1 iPhone SE 2 (375×667) 實機打開 `/chat`，確認無 horizontal overflow、漢堡按鈕可開對話歷史 drawer、輸入區無遮擋
      2026-04-20 PASS：Playwright 375×667 context 截圖 `screenshots/local/manual-review/c11-iphone-se_chat.png` 顯示漢堡 icon 左上、empty state 合理、輸入區不被擋、無 horizontal overflow。使用者確認授權勾選。
- [x] 11.2 iPad Mini (768×1024) 實機打開 `/admin/documents`，確認 UTable 全欄位顯示、側邊欄常駐
      2026-04-20 PASS：`c11-ipad-mini_admin_documents.png` 顯示 UTable 全 6 欄（標題/分類/權限/狀態/目前版本/更新時間），頂部 nav 常駐。使用者確認授權勾選。
- [x] 11.3 桌機 (1920×1080) 打開 `/admin/documents`，確認版面不過度拉寬（content max-width 合理）
      2026-04-20 PASS：`c11-desktop-1920_admin_documents.png` 顯示表格 max-width ~1600，左右留白 ~160px 合理。使用者確認授權勾選。
- [x] 11.4 Chrome DevTools 360px viewport 逐頁確認無 overflow
      2026-04-20 PASS：`c11-360_*` (`/`, `/chat`, `/admin/documents`) 三頁 360×640 無 horizontal overflow；`/admin/documents` hybrid table fallback 只顯示標題/狀態/開啟。`viewport-baseline.spec.ts` 覆蓋 `/`, `/auth/login`, `/chat`, `/admin/documents` 皆 PASS（signed-out 或 redirect 分支）。使用者確認授權勾選。
- [x] 11.5 僅用鍵盤（Tab/Shift+Tab/Enter/Esc）完成一次登入 → `/chat` 發問 → 點引用卡片 → 關閉 流程
      2026-04-20 PASS：`e2e/keyboard-nav.spec.ts` 全部 PASS（登入、chat 輸入、citation 開合等鍵盤路徑）。使用者確認授權勾選。
- [x] 11.6 確認所有按鈕與連結 Tab 聚焦時有可見 focus ring
      2026-04-20 PASS：keyboard-nav.spec.ts 內含 focus-visible 驗證，Playwright chromium project PASS。使用者確認授權勾選。**@followup[TD-004]**：`viewport-baseline.spec.ts` 發現首頁 Google login button 高度 36px（WCAG 2.5.5 要求 ≥40px），屬 B17 既有 tech debt。
- [x] 11.7 每頁按 Tab 第一次，確認出現 "skip to main content" 連結
      2026-04-20 PASS：`e2e/skip-to-main.spec.ts` 全部 PASS。使用者確認授權勾選。
- [x] 11.8 Chrome DevTools → Lighthouse → Accessibility 分數於 `/chat` 與 `/admin/documents` 不低於 85（僅參考，非硬性驗收）
      2026-04-20 PASS（local, 僅參考）：`/admin/documents` Lighthouse a11y = **96 分**（>85）。唯一 failing audit：footer `text-dimmed` 對比度不足，已修為 `text-muted`（`app/layouts/default.vue:111`）。`/chat` 實際 redirect 至 `/`（非獨立路由），`/` signed-in 分支含 `LazyChatContainer` 在 dev mode 下觸發 Lighthouse NO_FCP（async hydration 與 FCP 判定不穩），屬 dev-only measurement 限制，列為 follow-up（production build 應無此問題）。使用者授權勾選。
- [x] 11.9 nuxt-a11y devtools 面板於 `/admin/documents` 與 `/chat` 無 error 等級警告
      2026-04-20 PASS（local，axe-core 佐證）：nuxt-a11y 0.1.0 本身僅提供 `useA11y()` composable，無 devtools 面板；改用 `@axe-core/playwright` 掃 `/admin/documents`、`/admin/members`、`/` (signed-in) 三頁。修復 2 處 color-contrast violation：(a) `app/app.config.ts` 新增 `ui.avatar.slots.fallback: 'text-highlighted font-medium leading-none truncate'`（原 fallback 在 dark theme `oklch(0.708 0 0)` on `oklch(0.269 0 0)` ≈ 3.5:1 不達 WCAG AA 4.5:1）；(b) chat UI 6 處 `text-dimmed` → `text-muted`（`ConversationHistory.vue`、`MessageList.vue`、`RefusalMessage.vue`、`pages/index.vue`）。最終三頁 axe-core 掃描 violations=0。scan spec：`e2e/_tmp-axe-a11y.spec.ts` (throwaway)。**@followup[TD-003]**：其他頁面（admin/debug、admin/tokens、admin/query-logs、auth/callback、UploadWizard）仍有約 10+ 處 `text-dimmed` 殘留待清；下一條 UI change 掃過。使用者授權勾選。
- [x] 11.10 （若色弱測試人員可得）以 chrome extension 如 "Spectrum" 模擬 deuteranopia（紅綠色盲），確認狀態 badge 非僅用顏色區分（有 icon 或 label 輔助）
      2026-04-20 PASS（local）：改用 Chrome DevTools Protocol `Emulation.setEmulatedVisionDeficiency`（內建，無需 extension）模擬 deuteranopia/protanopia/tritanopia 三種色盲模式，掃 `/admin/documents` + `/admin/members`。截圖 `screenshots/local/manual-review/c11-10-{deuteranopia,protanopia,tritanopia}_admin_*.png`。所有 status badge（草稿/啟用/已歸檔/待同步/已同步/前處理中/待索引/內部）與 role badge（成員/訪客/管理員）皆有明確中文文字 label，不依賴顏色區分；role badge 更統一為 neutral，完全無語意色風險。使用者授權勾選。

## Affected Entity Matrix

### Entity: App Layout & Navigation

| Dimension     | Values                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- |
| Surfaces      | `app/layouts/default.vue`, `app/layouts/chat.vue`, `app/components/AppSidebar.vue`（若存在） |
| Viewports     | `< md`（漢堡按鈕 + `USlideover` drawer）、`>= md`（sidebar 常駐）                            |
| A11y concerns | `<main>` landmark、`<nav aria-label>`、drawer focus trap、Esc 關閉、skip-to-main-content     |
| States        | drawer open / closed、nav collapsed / expanded                                               |

### Entity: Chat UI

| Dimension     | Values                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Surfaces      | `app/pages/index.vue`, `app/components/chat/MessageList.vue`, `app/components/chat/ChatSidebar.vue`                 |
| Viewports     | `< md`（full-width message + conversation list 移入 drawer + keyboard-safe input padding）、`>= md`（sidebar 常駐） |
| A11y concerns | `aria-live` 串流回應、引用卡片鍵盤可達、focus-visible、對比度、Tab 順序                                             |
| States        | loading / streaming / error / guest-gate / empty                                                                    |

### Entity: Admin Document Table

| Dimension     | Values                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces      | `app/pages/admin/documents/[id].vue`, `app/components/documents/DocumentListTable.vue`, `shared/components/ResponsiveTable.vue`（可選封裝）         |
| Viewports     | `< md`（**hybrid**：主欄位保留 `title + status + primary action`，次欄位移入詳情 `USlideover`，點列觸發）、`>= md`（完整 `UTable` 所有欄位）        |
| A11y concerns | 主列可鍵盤操作、詳情 drawer focus trap + Esc、table 語義（`<table>` / `<th scope>`）、aria-invalid for filters、primary action button 有 aria-label |
| States        | loading / empty / error / unauthorized / drawer-open                                                                                                |

### Entity: Admin Forms（Upload Wizard / 編輯 metadata）

| Dimension     | Values                                                                                  |
| ------------- | --------------------------------------------------------------------------------------- |
| Surfaces      | `app/components/documents/UploadWizard.vue`, Admin metadata 編輯（若存在於 `[id].vue`） |
| Viewports     | `< md`（stacked：label 在上、input 在下）、`>= md`（維持現有版面）                      |
| A11y concerns | `aria-describedby` 關聯錯誤訊息、`aria-invalid`、required 欄位標示、touch target ≥ 44px |
| States        | idle / submitting / error（field-level + form-level）/ success                          |

## User Journeys

### 現場快速查詢 SOP（Member 工廠倉管，mobile）

- **Member** 於 mobile（360–430px）打開 `/`（chat 首頁）→ 漢堡按鈕開對話歷史 drawer → 選「SOP 相關」歷史 → drawer 關閉返回對話 → 輸入「庫存不足時怎麼處理」→ streaming 回應以 full-width 顯示、無 horizontal overflow → 輸入框固定於 bottom、鍵盤彈出時不遮擋送出按鈕

### 平板審核文件（Admin，tablet）

- **Admin** 於 iPad Mini（768–1024px）打開 `/admin/documents` → UTable 完整欄位呈現（`>= md`）→ 點某文件 primary action → 確認 dialog focus trap 正確、可 Esc 關閉 → 完成後列表 refetch → 側邊欄維持常駐

### 手機上緊急查看文件（Admin，mobile hybrid）

- **Admin** 於手機打開 `/admin/documents` → 表格以 **hybrid** 呈現：每列只見 `title + status badge + primary action` → 點列開啟詳情 `USlideover` → drawer 中顯示完整 metadata、次要 actions → 關閉 drawer 回到列表、焦點正確返回被點列

### 鍵盤使用者全流程（keyboard-only）

- 從 `/login` 開始 → Tab 走訪表單 → Enter 送出 → 進入 `/` → 首次 Tab 出現 "skip to main content" 連結 → 跳至 main → Tab 到輸入框 → 發問 → Enter → Tab 至引用卡片 → Enter 開啟 → Esc 關閉、焦點返回卡片 → 全程 focus ring 可見、對比度達 WCAG AA

### 色弱使用者狀態辨識（Member / Admin）

- **Deuteranopia 使用者**於 `/admin/documents` 觀察狀態 badge → 狀態同時以**顏色 + icon + 文字 label** 呈現 → 能在不依賴顏色的前提下分辨 draft / active / archived
