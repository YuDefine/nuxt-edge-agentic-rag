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

| #   | 類別        | 問題摘要                                                                                    | 嚴重度   | 發現來源 |
| --- | ----------- | ------------------------------------------------------------------------------------------- | -------- | -------- |
| 1   | consistency | `ConfirmRoleChangeDialog` / `MemberRoleActions` 用 `color="primary"` / `"warning"` 做強調色 | critical | /polish  |
| 2   | consistency | `guest-policy.vue` radio 選中狀態用 `border-primary bg-primary/5` 做強調                    | critical | /polish  |
| 3   | consistency | `account-pending.vue` 聯絡 email 用 `text-primary` 而非 `text-default underline`            | warning  | /polish  |
| 4   | a11y        | 4 處 `animate-spin` 缺 `motion-reduce:animate-none` （WCAG 2.3.3）                          | P1       | /audit   |
| 5   | a11y        | `Container.vue` 錯誤提示關閉鈕 icon-only `<UButton>` 缺 `aria-label`                        | P2       | /audit   |
| 6   | responsive  | `index.vue:92` signed-in chat 用 `100vh` 而非 `100dvh`，mobile Safari 地址列會切到輸入區    | P2       | /audit   |
| 7   | a11y        | `MessageList.vue` suggestion chip 原生 `<button>` 缺 `type="button"` 預設會變 submit        | P3       | /audit   |

備註：

- `#1-3` 為語意色彩做裝飾的**第三次**出現（前兩次：admin-document-lifecycle-ops warning/primary、bootstrap UploadWizard success）。已由 subagent inline 修為 neutral。
- `#4-7` 由 `/audit` 發現、主線補修（2026-04-20）；均為細節強化，屬 `/harden` + `/adapt` 範疇。
- **Cross-Change DRIFT 觀察**：全 repo 有 13+ 個 `animate-spin` 使用處（admin/debug/、admin/tokens/、admin/query-logs/、auth/callback、admin/dashboard、chat/StreamingMessage、chat/CitationReplayModal、admin/documents/[index,upload]、documents/[id]）缺 `motion-reduce:animate-none`。本次 change scope 外，不阻擋 archive，但建議列為獨立 tech-debt task 或下一條 UI change 的 Cross-Change DRIFT。
  - **✅ Resolved 2026-04-21**：主線已補齊 13 處 `motion-reduce:animate-none`（debug/latency、debug/query-logs/[id]、tokens/index、documents/[id] × 2、documents/upload、documents/index、dashboard/index、query-logs/[id]、query-logs/index、auth/callback、chat/StreamingMessage、chat/CitationReplayModal）。驗證：`rg 'animate-spin' app` 全 19 處皆含 `motion-reduce:animate-none`。

**未完成項**（archive 前必補）：

- 三斷點截圖（xs 360 / md 768 / xl 1280）— 需 `pnpm dev` + seeded session
- `responsive-and-a11y-foundation` §10 的 `/design improve` 從頭跑（subagent 此次只覆蓋 member-perm 範圍）

累積 Findings: **19 項**（達到 `/design-retro` 5 倍數觸發點 15 + 20 之間；下次達 20 時觸發）。
