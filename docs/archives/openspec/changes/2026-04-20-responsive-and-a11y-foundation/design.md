## Context

`v1.0.0` 開發至今（2026-04-18）已完成 `bootstrap-v1-core-from-report` 後端與 `add-v1-core-ui` 的 UI 實作（進入人工驗收階段），但期間**未建立響應式與無障礙的系統性策略**。碼庫現況：

- `app/layouts/default.vue` 僅 1 個 `aria-label="帳號選單"`
- `app/components/documents/UploadWizard.vue`、`DocumentListTable.vue` 有零星 `md:` / `sm:` 類別
- 無 `useBreakpoints` / `USlideover` drawer pattern
- 無 `nuxt-a11y` module
- Tailwind 4 `@theme` 預設 breakpoint 未擴展

使用場景驅動：中小企業 ERP 知識庫 — admin 多在 desktop 管理、web user 現場查詢 SOP 常在 mobile。若 UI desktop-only，答辯時「使用者現場拿手機怎麼辦」無解。

本 change 的策略是**建立 baseline 並整合既有 Design Review 流程**，不強制一次重寫所有 UI；既有 UI 逐步於實作 task 中套用 pattern。

## Goals / Non-Goals

**Goals:**

- 建立全站 responsive 與 a11y baseline，**單一 capability 集中 SSOT**
- 支援 `xs: 360px` 以上所有螢幕，`md: 768px` 為 mobile↔tablet+ 核心斷點
- 導入 `nuxt-a11y` module 自動檢測 a11y 常見錯誤
- 讓所有**未來**新 UI change 自動繼承此 baseline（透過 Design Review template）
- 不改變既有 UI **行為**，只補 layout / a11y layer

**Non-Goals:**

- 不支援 `< 360px` 螢幕（不做 scroll hack 救援）
- 不自定 Tailwind 預設 breakpoint 以外的值（只加 `xs`）
- 不強制 CI axe / Lighthouse gate
- 不重做既有 UI 行為契約
- 不回頭改 in-progress change 的 tasks（避免打斷 deadline）
- 不做多語系、不做 high-contrast theme、不做 reduced-motion 客製

## Decisions

### Breakpoint 六層策略（xs 作 baseline）

**Decision**: Tailwind 4 `@theme` 擴展 `--breakpoint-xs: 360px`，其餘沿用預設。

| Breakpoint | min-width  | 目標裝置                                                              |
| ---------- | ---------- | --------------------------------------------------------------------- |
| `(none)`   | `< 360px`  | edge case，不保證體驗                                                 |
| `xs`       | `≥ 360px`  | **baseline**，一般手機直立（iPhone SE 2 = 375、Galaxy A = 360+）      |
| `sm`       | `≥ 640px`  | 手機橫屏 / 小平板                                                     |
| `md`       | `≥ 768px`  | **核心斷點**：tablet / 小 laptop；nav pattern、表格 fallback 在此切換 |
| `lg`       | `≥ 1024px` | laptop / 小 desktop                                                   |
| `xl`       | `≥ 1280px` | 桌機                                                                  |

**Rationale**:

- `xs: 360` 對應現代 Android 主流機型下限（Galaxy A 系列、小米紅米 Note）
- `md: 768` 是 iPad Mini portrait 的最小寬度，過此以下必須 mobile 版面
- 保留 Tailwind 預設其他值避免 `utility class` 意外被覆寫

**Alternative considered**: 自定 `md: 820`（iPad Air 之上才算 tablet）。**Rejected** — 違反 Tailwind 預設的開發者肌肉記憶，且 7-8 吋 tablet 在 ERP 使用少見。

### Nav Pattern：drawer-at-md

**Decision**: 所有 layout（`default.vue`、`chat.vue`）在 `< md` 使用 `USlideover` drawer；`md+` 使用常駐側邊欄。

```
┌──────────────────────────────────────┐
│ md+ (≥ 768)                          │
│ ┌─────────┬────────────────────────┐ │
│ │ Sidebar │  Main                  │ │
│ │ (常駐)  │                        │ │
│ └─────────┴────────────────────────┘ │
└──────────────────────────────────────┘

┌─────────────────┐
│ < md            │
│ ┌─────────────┐ │
│ │ [≡] Header  │ │ ← 漢堡按鈕觸發 USlideover
│ ├─────────────┤ │
│ │ Main        │ │
│ │             │ │
│ └─────────────┘ │
└─────────────────┘
```

**Chat 對話歷史同原則**：`< md` 以 drawer 收納、`md+` 左欄常駐。

**Alternative considered**: Bottom navigation bar（類 mobile app）。**Rejected** — 對於包含 admin 管理與 chat 的複雜 layout，bottom nav entry 容量不足；drawer 可容納完整 nav tree。

### 表格 fallback：hybrid（非純 card、非純 scroll）

**Decision**: Desktop 保留完整 `UTable`；mobile 主欄位 + 詳情 drawer。

```
md+ (≥ 768)                          < md
┌────┬────┬────┬────┬──────┐         ┌──────────────────┐
│Name│Cat │Stat│Ver │Action│         │ Name  [Open →]  │
├────┼────┼────┼────┼──────┤         │ Stat: active    │
│ …  │ …  │ …  │ …  │  …   │         │ ─────           │
└────┴────┴────┴────┴──────┘         │ Name  [Open →]  │
                                      │ Stat: queued    │
                                      └──────────────────┘

                                      點 [Open →] 打開:
                                      ┌────────────────┐
                                      │ 詳情 Drawer    │
                                      │ Name: …        │
                                      │ Category: …    │
                                      │ Status: …      │
                                      │ Version: …     │
                                      │ [Actions]      │
                                      └────────────────┘
```

**哪些欄位屬「主欄位」**：

- 識別欄（title / email / 顯示名）
- 狀態欄（status badge）
- 單一 primary action button

**其他欄位（category, version, last updated, actions menu...）進詳情 drawer。**

**為何不用純 card view**：

- ERP admin 熟悉表格 scan 模式；card 需滑動多列才能比較
- 每張 card 佔高度大，列表可見筆數少
- 與既有 `DocumentListTable.vue` 的 UTable 結構衝突大

**為何不用純 horizontal scroll**：

- Touch device 雙指縮放 / 單指 scroll 衝突
- 欄位多時需用戶反覆 scroll 才能看到 action，體感差

**共用元件設計**: 可選新增 `shared/components/ResponsiveTable.vue`（或以 composable `useResponsiveTable` 形式）封裝 hybrid 邏輯；既有 `DocumentListTable.vue` 先在檔案內實作 pattern，若未來第三個表格出現再抽取共用元件（YAGNI 順序）。

### `@nuxt/a11y` module 整合：dev-only

**Decision**: 改用官方 `@nuxt/a11y`（1.0.0-alpha.1），module 內建 `enabled` 選項預設 production = false，不需要呼叫端條件載入。

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    // ...既有 modules
    '@nuxt/a11y',
  ],
})
```

**Pivot note (2026-04-21)**: 原本採用社群版 `nuxt-a11y@0.1.0`（Baroshem），該套件僅提供 `useA11y()` composable 無 DevTools 面板，且呼叫端需自行以 `(NODE_ENV !== 'production' || NUXT_A11Y_ENABLED === 'true') && 'nuxt-a11y'` 條件載入。官方 `@nuxt/a11y` 原生支援 Nuxt DevTools panel + module 內建 dev-only 邏輯，呼叫端一行即可，符合 Nuxt 社群 module integration 最佳實踐。

**Rationale**:

- module 提供 DevTools 面板 + dev-time axe-core audits
- `enabled` 預設 production = false，module 自己處理，呼叫端不需條件載入
- 不進 production bundle，降低 Workers bundle size

**Alternative considered**: staging 也開啟（提早發現 production 前的 a11y 問題）。**Accepted as option**（design 保留 enable-in-staging 旗標，實作時可依需求切換；default 為 dev-only）

### WCAG AA 對比度：Tailwind theme token 設計階段保證

**Decision**: Token 設計時即滿足 WCAG AA，**不依賴 runtime 檢查或 CI gate**。

- 主要互動色（primary 按鈕、link）與背景的對比度 `≥ 4.5:1`
- 次要文字（muted）與背景 `≥ 4.5:1`
- 圖示 / disabled 狀態 `≥ 3:1`
- Dark mode（若未來啟用）亦同樣要求

**How to verify**：

- 設計階段手動用 Tailwind color contrast checker（如 <https://webaim.org/resources/contrastchecker/>）檢查每個 token 組合
- `nuxt-a11y` dev-time 會偵測明顯 low-contrast 組合
- Design Review 流程中以 `/audit` skill 掃描

**Alternative considered**: 每次 CI 跑 Pa11y / axe 全頁掃描。**Rejected** — pipeline 負擔大、false positive 高、對 marketing-size landing page 才值得

### Keyboard Navigation 原則

**Decision**: 依賴 Reka UI（Nuxt UI 4 底層）提供的 headless 行為，不自建 focus management。

覆蓋要求：

- **所有互動元素**（button、link、input、select、menu item）可 Tab 聚焦
- **Modal / drawer / dialog** 開啟時 focus 自動移入；Esc 關閉後 focus 回到觸發按鈕
- **focus ring 視覺**：Tailwind `focus-visible:ring-2` 套用於所有 interactive element
- **bypass** 連結：每頁提供 `skip to main content` link（`sr-only` 預設隱藏，Tab 聚焦時顯示）

**Alternative considered**: 自建 roving tabindex 系統。**Rejected** — Reka UI 已覆蓋 90%+ 場景，自建只為 custom widget，YAGNI。

### Design Review 流程擴充

**Decision**: 更新 `.spectra.yaml` `design.review_steps` 與 `.claude/rules/proactive-skills.md` 的 Task Template。

`.spectra.yaml` 擴充：

```yaml
design:
  review_steps:
    - check_impeccable: '/impeccable teach if .impeccable.md missing'
    - design_improve: '/design improve [affected files]'
    - fix_drift: 'Fidelity Score must reach 8/8, max 2 rounds'
    - targeted_skills: 'Execute /design plan in canonical order'
    - responsive_check: 'Verify xs/md/xl breakpoints via screenshot-review agent'
    - a11y_check: 'nuxt-a11y report + keyboard walkthrough'
    - audit: '/audit — Critical must be 0'
    - screenshot: '/review-screenshot — visual QA'
```

`.claude/rules/proactive-skills.md` 的 Design Review Task Template 加入：

```markdown
- [ ] N.X 響應式檢查：screenshot xs (360) / md (768) / xl (1280) viewports 並人工核對
- [ ] N.Y 無障礙檢查：nuxt-a11y dev report 無 error；鍵盤 Tab 流程與 Esc 行為可走通
```

**不回頭改既有 change**：

- `bootstrap-v1-core-from-report`、`add-v1-core-ui`、`admin-document-lifecycle-ops`、`member-and-permission-management`、`admin-ui-post-core`、`observability-and-debug` 的 tasks 不動
- 本 change apply 之後，只有**新 spectra-propose** 會自動繼承擴充的 template
- 若既有 UI 需補響應式（例如 `/admin/documents` 在 mobile 無 drawer），由獨立 `/spectra-ingest` 處理

### Migration（實作順序）

1. **Foundation layer**：Tailwind `@theme` 加 xs、新增 `nuxt-a11y` module、建立 `useResponsiveTable` composable（若採 composable 方案）
2. **Layout layer**：`default.vue` / `chat.vue` 加 `< md` drawer；加 skip-to-main link
3. **Component layer**：逐個改造 `DocumentListTable.vue`、`UploadWizard.vue`、chat sidebar、`MessageList.vue`
4. **Design Review 整合**：更新 `.spectra.yaml` 與 `.claude/rules/proactive-skills.md`
5. **Verification**：對照 xs / md / xl 三斷點 screenshot；跑 nuxt-a11y；鍵盤 walkthrough

## Risks / Trade-offs

- **既有 code 改動風險** → Mitigation: 既有行為測試必須全綠；layout 改造不動 business logic；每個 component 改完先 run integration tests
- **`nuxt-a11y` module 與 Cloudflare Workers preset 相容性** → Mitigation: 僅 dev-only 啟用，production build 完全不包含；若 dev 模式 workers-specific preset 衝突，改為 `.nuxtrc` 條件載入
- **Tailwind `xs:` 前綴與既有 utility 衝突** → Mitigation: `xs` 非 Tailwind 預設，不會與任何既有 utility class 衝突；但需驗證 `@nuxt/ui` 與 `@tailwindcss/typography` 不依賴特定 breakpoint enum
- **表格 hybrid 策略增加維護成本** → Mitigation: 先在 `DocumentListTable.vue` 內實作；等第 2、3 個表格出現再抽共用；避免過早抽象
- **既有 in-progress change 未同步改響應式** → Mitigation: 明確宣告於 Non-Goals；既有 UI 在本 change apply 後仍可運作（baseline 為 additive layer），可由後續 ingest 補
- **WCAG AA 對比度目標需手動 audit** → Mitigation: 設計階段檢查一次即可；dev runtime 由 `nuxt-a11y` 被動偵測；不上 CI gate

## Migration Plan

1. **Pre-deploy verification**:
   - 既有測試全綠
   - `nuxt-a11y` 在 dev server 能正常載入
   - Tailwind `@theme` 擴展後 `xs:` utility 正常 compile
2. **Phase 1 — Foundation（一次 PR）**:
   - `app/assets/css/main.css` 加 `--breakpoint-xs: 360px`
   - `package.json` 加 `nuxt-a11y`
   - `nuxt.config.ts` 條件啟用 module
   - pnpm install 驗證
3. **Phase 2 — Layout（同 PR）**:
   - `default.vue` / `chat.vue` 加 drawer + skip link
   - 更新對應 integration tests
4. **Phase 3 — Components（同 PR）**:
   - `DocumentListTable.vue` hybrid table
   - `UploadWizard.vue` 響應式調整
   - chat sidebar / MessageList 抽屜化
5. **Phase 4 — Design Review 整合（同 PR）**:
   - `.spectra.yaml` 擴充 review_steps
   - `.claude/rules/proactive-skills.md` 擴充 Task Template
6. **Deploy**:
   - Staging 部署後以 screenshot-review agent 抓 xs / md / xl 三斷點截圖
   - 鍵盤 walkthrough 人工測試
   - Production deploy
7. **Rollback plan**:
   - 皆為 UI-only 無資料異動
   - `wrangler rollback` 回前一版即可
   - `nuxt-a11y` 僅 dev-time，不影響 production

## Open Questions

1. **詳情 drawer 開啟方式**：
   - 候選 A：點整列（mobile 慣例）
   - 候選 B：每列 `[Open →]` 專屬按鈕
   - 當前傾向：**候選 B**，避免誤觸 + 視障使用者可明確 tab 到按鈕
2. **`nuxt-a11y` 是否 staging 亦啟用**：
   - 當前 design 建議 dev-only
   - 若團隊希望 staging 有 a11y 監控，加 `.env.staging` 旗標 `NUXT_A11Y_ENABLED=true`
3. **是否抽共用 `ResponsiveTable` 元件**：
   - 當前 design 建議先在 `DocumentListTable.vue` 內實作
   - 等第 2、3 個表格出現（`MembersListTable.vue` / `QueryLogsTable.vue`）再抽
4. **Skip-to-main link 樣式**：
   - 採 `sr-only` + `focus-visible:not-sr-only` pattern
   - 需與品牌色對比度 4.5:1（若主色深色，skip link 背景改 `bg-primary-foreground`）
