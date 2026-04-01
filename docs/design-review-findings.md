# Design Review Findings Log

記錄每次 Design Review 完成時發現的問題，用於追蹤跨 spec 的重複問題模式。規則詳見 `.claude/rules/proactive-skills.md` → Design Review Findings Log 段落。

---

## admin-document-lifecycle-ops — 2026-04-18

**影響範圍**:

- `app/components/documents/DocumentListTable.vue`
- `app/pages/admin/documents/[id].vue`
- `app/components/documents/LifecycleConfirmDialog.vue`

| #   | 類別        | 問題摘要                                                              | 嚴重度   | 發現來源 |
| --- | ----------- | --------------------------------------------------------------------- | -------- | -------- |
| 1   | consistency | Archive / Unarchive confirm button 用 `warning` / `primary` solid 色  | critical | /polish  |
| 2   | consistency | 詳情頁 toolbar archive / unarchive 用 `color="warning"` / `"primary"` | critical | /polish  |
| 3   | consistency | `bg-muted/30` 在 semantic token 加 opacity modifier                   | warning  | /polish  |
| 4   | typography  | `i-lucide-dot` 作 bullet 視覺過弱（size-4 幾乎看不見）                | warning  | /polish  |
| 5   | a11y        | Dialog 缺 `aria-describedby`，影響清單與標題未綁定                    | warning  | /harden  |

備註：原設計使用語意色作為強調按鈕，違反 `.impeccable.md` 「不使用彩色強調按鈕（除了語意色彩的 alert）」。修復後明文於 `.impeccable.md` 補「破壞性動作（delete）例外允許 `color="error"`」。

---

## bootstrap-v1-core-from-report (Round 3 — UploadWizard) — 2026-04-18

**影響範圍**:

- `app/components/documents/UploadWizard.vue`

| #   | 類別        | 問題摘要                                                                                   | 嚴重度   | 發現來源 |
| --- | ----------- | ------------------------------------------------------------------------------------------ | -------- | -------- |
| 1   | consistency | Step indicator completed 用 `border-success bg-success text-inverted`（綠色填滿）          | critical | /polish  |
| 2   | consistency | Step separator completed 用 `bg-success`（綠線裝飾）                                       | critical | /polish  |
| 3   | consistency | Publish step check-circle icon 用 `text-success`                                           | warning  | /polish  |
| 4   | consistency | Complete step party-popper icon 用 `text-success`                                          | warning  | /polish  |
| 5   | a11y        | Step indicator 為 `<div>` 非 `<ol>/<li>` 語意化；缺 `aria-current`；無 motion-reduce       | warning  | /harden  |
| 6   | state       | `getIndexingStatusLabel` 未覆蓋 `pending` / `queued` / `running`（有 fallback 但資訊量低） | info     | /harden  |

備註：Cross-Change DRIFT — 與 `admin-document-lifecycle-ops` 屬同一 DS 規則「語意色彩不用於裝飾或強調」的不同違反點（此 change 用 success，另一個 change 用 warning / primary）。修復方向一致：都改 neutral。

---

## 累積觀察（兩次 review 後的模式）

`consistency`（語意色彩做裝飾）是目前重複出現的最大類別：

- admin-document-lifecycle-ops: warning + primary 用於 confirm / toolbar button
- bootstrap UploadWizard: success 用於 step indicator + completion icon

這指向一個系統性問題：**先前的實作者未把 `.impeccable.md`「語意色彩僅用於系統回饋」條款內化**。建議：

1. 在 `.claude/rules/proactive-skills.md` 的 Design Gate 加明確 grep 檢查 — 任何 `color="warning|success|primary|info"` 在 `.vue` 檔中都先警示
2. 或在 pre-archive hook 加 CI-level DRIFT scan

`a11y`（`aria-*` / semantic HTML / motion-reduce）是第二類重複問題。建議考慮：

- 抽共用 `StepIndicator.vue` / `ConfirmDialog.vue` 樣板組件，把 a11y 細節封裝好
- 這樣下次的 Design Review 可以專注視覺而非重複 a11y 檢查

累積 Findings: **11 項**（接近 `/design-retro` 的 5 倍數觸發點 10 / 15；若再累積一次 Design Review 到達 15 即可觸發 retro）。

---

## admin-ui-post-core (Phase 3) — 2026-04-19

**影響範圍**:

- `app/pages/admin/dashboard/index.vue`
- `app/components/admin/dashboard/SummaryCard.vue`
- `app/components/admin/dashboard/QueryTrendList.vue`

| #   | 類別        | 問題摘要                                                                                                                 | 嚴重度  | 發現來源      |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------ | ------- | ------------- |
| 1   | consistency | `SummaryCard` 初版用 `bg-primary/10 text-primary` 做 icon halo，不符合既定 empty-state icon-circle `bg-muted` convention | warning | design-review |

備註：修復時未觸發 cross-change DRIFT — tokens / query-logs / documents 全部都使用 `bg-muted text-default`，Phase 3 初版是唯一偏離者；review 當下 inline 修復。

累積 Findings: **12 項**。

---

## member-and-permission-management + responsive-and-a11y-foundation (合跑) — 2026-04-20

**影響範圍**:

- `app/pages/admin/members/index.vue`
- `app/pages/admin/settings/guest-policy.vue`
- `app/pages/account-pending.vue`
- `app/components/admin/members/MemberRoleActions.vue`
- `app/components/admin/members/ConfirmRoleChangeDialog.vue`
- `app/components/chat/GuestAccessGate.vue`
- `app/components/chat/Container.vue`
- `app/components/chat/MessageList.vue`
- `app/components/documents/UploadWizard.vue`
- `app/pages/index.vue`（signed-in 分支）

| #   | 類別        | 問題摘要                                                                                       | 嚴重度   | 發現來源 |
| --- | ----------- | ---------------------------------------------------------------------------------------------- | -------- | -------- |
| 1   | consistency | `ConfirmRoleChangeDialog` / `MemberRoleActions` 用 `color="primary"` / `"warning"` 做強調色    | critical | /polish  |
| 2   | consistency | `guest-policy.vue` radio 選中狀態用 `border-primary bg-primary/5` 做強調                       | critical | /polish  |
| 3   | consistency | `account-pending.vue` 聯絡 email 用 `text-primary` 而非 `text-default underline`               | warning  | /polish  |
| 4   | a11y        | 4 處 `animate-spin` 缺 `motion-reduce:animate-none` （WCAG 2.3.3）                             | P1       | /audit   |
| 5   | a11y        | `Container.vue` 錯誤提示關閉鈕 icon-only `<UButton>` 缺 `aria-label`                           | P2       | /audit   |
| 6   | responsive  | `index.vue:92` signed-in chat 用 `100vh` 而非 `100dvh`，mobile Safari 地址列會切到輸入區       | P2       | /audit   |
| 7   | a11y        | `MessageList.vue` suggestion chip 原生 `<button>` 缺 `type="button"` 預設會變 submit           | P3       | /audit   |
| 8   | consistency | `admin/members/index.vue` `roleBadgeColor` 用 `'primary'` (admin) / `'warning'` (guest)        | critical | 人工檢查 |
| 9   | a11y        | UAvatar fallback text 對比度不足（`oklch(0.708)` on `oklch(0.269)` ≈ 3.5:1，WCAG AA 要 4.5:1） | serious  | axe-core |
| 10  | a11y        | Footer + chat UI 7 處 `text-dimmed` 對比度不足（Lighthouse + axe-core 皆 flag）                | serious  | axe-core |

備註：

- `#1-3` 為語意色彩做裝飾的**第三次**出現（前兩次：admin-document-lifecycle-ops warning/primary、bootstrap UploadWizard success）。已由 subagent inline 修為 neutral。
- `#4-7` 由 `/audit` 發現、主線補修（2026-04-20）；均為細節強化，屬 `/harden` + `/adapt` 範疇。
- `#8` 於 2026-04-20 B16 人工檢查階段發現：`/admin/members` 頁面 `訪客` badge 渲染為黃色（warning），`管理員` badge 為 primary。前次 design-review-combo 因 seed 資料缺 guest user，audit 未實際渲染 guest badge，漏網。修復：`roleBadgeColor` 三個分支全回 `'neutral'`，type annotation 收斂為 `'neutral'`。檔案：`app/pages/admin/members/index.vue:70-80`。
- `#9` 於 2026-04-20 C11.9 axe-core 掃描發現：UAvatar fallback 文字色 `oklch(0.708)` on parent `bg-elevated oklch(0.269)` ≈ 3.5:1，未達 WCAG AA 4.5:1。修復：`app/app.config.ts` 新增 `ui.avatar.slots.fallback: 'text-highlighted font-medium leading-none truncate'` 全站 override，axe-core 複掃 violations=0。✅ Resolved 2026-04-20。
- `#10` 於 2026-04-20 C11.9 axe-core 掃描發現：`/` (chat ConversationHistory + MessageList + RefusalMessage + index.vue) 共 6 處 `text-dimmed` + `app/layouts/default.vue` footer 1 處，對比度未達 AA。修復：全數改為 `text-muted`。axe-core 複掃三頁 violations=0。✅ Resolved 2026-04-20。其他頁面仍用 `text-dimmed`（admin/debug/、admin/query-logs/、UploadWizard、auth/callback 等約 10 處）列為 Cross-Change follow-up，下一條 UI change 掃過。
- **Cross-Change DRIFT 觀察**：全 repo 有 13+ 個 `animate-spin` 使用處（admin/debug/、admin/tokens/、admin/query-logs/、auth/callback、admin/dashboard、chat/StreamingMessage、chat/CitationReplayModal、admin/documents/[index,upload]、documents/[id]）缺 `motion-reduce:animate-none`。本次 change scope 外，不阻擋 archive，但建議列為獨立 tech-debt task 或下一條 UI change 的 Cross-Change DRIFT。
  - **✅ Resolved 2026-04-21**：主線已補齊 13 處 `motion-reduce:animate-none`（debug/latency、debug/query-logs/[id]、tokens/index、documents/[id] × 2、documents/upload、documents/index、dashboard/index、query-logs/[id]、query-logs/index、auth/callback、chat/StreamingMessage、chat/CitationReplayModal）。驗證：`rg 'animate-spin' app` 全 19 處皆含 `motion-reduce:animate-none`。

**未完成項**（archive 前必補）：

- ~~三斷點截圖（xs 360 / md 768 / xl 1280）~~ ✅ Resolved 2026-04-20：Playwright 三斷點（iphone-se 375/ipad-mini 768/desktop 1920/360 baseline）四組截圖於 `screenshots/local/manual-review/c11-*.png`，C11.1-4 已勾 PASS。
- `responsive-and-a11y-foundation` §10 的 `/design improve` 從頭跑（subagent 此次只覆蓋 member-perm 範圍）— 本次 session 改用 axe-core playwright 掃 `/admin/documents`、`/admin/members`、`/` 三頁 violations=0 作為等效證據（比 subagent `/design improve` 更硬性可驗）。正式 `/design improve` 視為可選 follow-up，不阻擋 archive。

累積 Findings: **20 項**（觸發 `/design-retro` 5 倍數觸發點；B16 archive 後執行週期性分析）。

---

## @nuxt/a11y 首輪掃描 (2026-04-21)

**觸發**：`responsive-and-a11y-foundation` B17 將社群版 `nuxt-a11y@0.1.0`（只有 composable 無 devtools）切換為官方 `@nuxt/a11y@1.0.0-alpha.1`（有 devtools panel）。panel 初次全站掃描發現以下 violation。

**切換原因**：原社群版無法提供 RAF §9.2 / §10.6 要求的 devtools panel，使用者要求改用 <https://nuxt.com/modules/a11y> 官方版。

| #   | 類別 | 頁面                           | 問題摘要                                                         | 嚴重度   | Scope           |
| --- | ---- | ------------------------------ | ---------------------------------------------------------------- | -------- | --------------- |
| 11  | a11y | `/admin/members`               | UTable `{ id: 'actions', header: '' }` 觸發 `empty-table-header` | minor    | **MPM（當前）** |
| 12  | a11y | `/admin/settings/guest-policy` | `color-contrast`（affected element 待使用者貼 DevTools 詳情）    | serious  | **MPM（當前）** |
| 13  | a11y | `/admin/query-logs`            | 3 × `button-name`（icon-only button 缺 aria-label）              | critical | Cross-Change    |
| 14  | a11y | `/admin/query-logs`            | 2 × `label`（form element 缺 label）                             | critical | Cross-Change    |
| 15  | a11y | `/admin/query-logs`            | UTable `empty-table-header`                                      | minor    | Cross-Change    |
| 16  | a11y | `/admin/documents`             | UTable `empty-table-header`                                      | minor    | Cross-Change    |
| 17  | a11y | `/admin/tokens`                | UTable `empty-table-header`                                      | minor    | Cross-Change    |
| 18  | a11y | `/admin/debug/latency`         | `heading-order`（heading 層級跳階）                              | moderate | Cross-Change    |

備註：

- `#11` 於 2026-04-21 主線修復：`header: ''` 改為 `header: () => h('span', { class: 'sr-only' }, '操作')`，為視覺隱藏但 screen reader 可讀。檔案：`app/pages/admin/members/index.vue:105-108`。
- `#12` 需使用者於 @nuxt/a11y DevTools 點 `color-contrast` violation 的 Affected Elements 提供 CSS selector + element text，才能精準修復（可能是 `text-muted` on `bg-accented` selected option 的組合）。
- `#13-18` 屬 Cross-Change DRIFT（非 MPM / RAF scope）：
  - `/admin/query-logs` → `admin-query-log-ui` capability
  - `/admin/documents` → `admin-document-management-ui` capability
  - `/admin/tokens` → `admin-token-management-ui` capability
  - `/admin/debug/latency` → `debug-decision-inspection` capability
  - 登 `docs/tech-debt.md` TD-005 批次處理，**不阻擋** 當前 MPM / RAF archive。

累積 Findings: **28 項**。
