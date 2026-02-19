# Design Review: bootstrap-v1-core-from-report

## Review Date: 2026-04-16

## Scope

Auth Pages & Layouts:

- `app/layouts/auth.vue`
- `app/layouts/default.vue`
- `app/pages/index.vue`
- `app/pages/auth/login.vue`
- `app/pages/auth/register.vue`
- `app/pages/auth/forgot-password.vue`
- `app/pages/auth/callback.vue`

---

## Design Fidelity Report

### Before (11 DRIFT items)

| #   | File                     | Issue                                           | Status |
| --- | ------------------------ | ----------------------------------------------- | ------ |
| 1   | `auth.vue:2`             | `bg-gray-50` instead of `bg-neutral-50`         | FIXED  |
| 2   | `default.vue:21`         | `text-gray-500` instead of `text-neutral-500`   | FIXED  |
| 3   | `index.vue:7`            | `text-gray-600` instead of `text-neutral-600`   | FIXED  |
| 4   | `login.vue:82`           | `color="primary"` instead of `color="neutral"`  | FIXED  |
| 5   | `login.vue:88`           | `text-primary` instead of neutral + font-medium | FIXED  |
| 6   | `login.vue:89`           | `text-gray-500` instead of `text-neutral-600`   | FIXED  |
| 7   | `register.vue:44`        | `UButton` missing explicit `color`              | FIXED  |
| 8   | `register.vue:32`        | `UAlert` missing explicit `variant`             | FIXED  |
| 9   | `register.vue:49`        | `text-primary` link style                       | FIXED  |
| 10  | `forgot-password.vue:34` | `UButton` missing explicit `color`              | FIXED  |
| 11  | `forgot-password.vue:38` | `text-primary` link style                       | FIXED  |

### After

**Fidelity Score: 11/11** — All DRIFT items resolved

---

## Functional Improvements

| Issue                                   | Resolution                             |
| --------------------------------------- | -------------------------------------- |
| `callback.vue` 缺 loading spinner       | Added `UIcon` with `animate-spin`      |
| `callback.vue` 缺 error state           | Added `UAlert` for error display       |
| `callback.vue` 缺 layout                | Added `layout: 'auth'`                 |
| Mixed `ref`/`shallowRef` usage          | Unified to `shallowRef` for primitives |
| `forgot-password.vue` UAlert 缺 variant | Added `variant="subtle"`               |

---

## Audit Improvements (Round 2)

| Severity | Issue                  | Resolution                                      |
| -------- | ---------------------- | ----------------------------------------------- |
| Medium   | Google 按鈕缺 icon     | Added `icon="i-simple-icons-google"`            |
| Medium   | callback error 未捕獲  | Added `onMounted` to capture URL error param    |
| Low      | NuxtLink 缺 focus 樣式 | Added `focus:underline` to all auth links       |
| Low      | callback 缺 aria-live  | Added `aria-live="polite"` to loading container |

---

## Skills Executed

1. `/polish` — Color tokens, button colors, link styles, component props
2. `/harden` — Loading states, error handling, ref consistency, OAuth error capture
3. `/audit` — Comprehensive quality check

---

## Verification

- [x] `grep -r "gray-" app/` — No matches
- [x] `grep -r "text-primary" app/` — No matches
- [x] `grep -r 'color="primary"' app/` — No matches
- [x] `pnpm typecheck` — Passed (warnings only)
- [x] `/audit` — Critical = 0, all Medium/Low fixed
- [ ] `/review-screenshot` — Pending

---

## Round 2 Audit — 2026-04-16

### Scope Update

- `forgot-password.vue` 已移除，不再納入 scope

### Fidelity Check

**Fidelity Score: 6/6** — 無 DRIFT 項目

所有檔案皆使用語意色彩類別（`text-default`, `text-muted`, `text-dimmed`, `text-highlighted`, `bg-muted`）。

### Audit Issues Fixed

| #   | Severity | File             | Issue                       | Resolution                                       |
| --- | -------- | ---------------- | --------------------------- | ------------------------------------------------ |
| 1   | High     | `callback.vue`   | 錯誤狀態缺乏復原路徑        | Added「返回登入」NuxtLink                        |
| 2   | High     | `index.vue`      | 無導航到 auth flow          | Added 登入/註冊按鈕，依 loggedIn 顯示不同 CTA    |
| 3   | Medium   | `login.vue`      | 缺少 autocomplete           | Added `autocomplete="email"`, `current-password` |
| 4   | Medium   | `register.vue`   | 缺少 autocomplete           | Added `autocomplete="name"`, `new-password`      |
| 5   | Medium   | `login.vue`      | NuxtLink 缺 focus 樣式      | Added `focus:underline focus:outline-none`       |
| 6   | Medium   | `register.vue`   | NuxtLink 缺 focus 樣式      | Added `focus:underline focus:outline-none`       |
| 7   | Low      | `callback.vue`   | 缺少 timeout 處理           | Added 10s timeout 提示                           |
| 8   | Low      | `index.vue`      | 英文內容與語系不一致        | Changed to 中文                                  |
| 9   | Low      | `default.vue`    | footer 文案技術化           | Changed to「© 2026 知識問答系統」                |
| 10  | Low      | `login/register` | password placeholder 無語意 | Changed to「輸入密碼」/「至少 8 個字元」         |
| 11  | Critical | `index.vue`      | 缺少 `auth: false`          | Added `definePageMeta({ auth: false })`          |

### Anti-Patterns Check

**PASS** — 無 AI slop 特徵（無 gradient text、glassmorphism、cyan-on-dark、hero metrics）

### Verification

- [x] `pnpm typecheck` — Passed (warnings only)
- [x] Fidelity Score = 6/6
- [x] `/audit` Critical = 0
- [x] `/review-screenshot` — Passed (4 pages verified)

### Screenshot Evidence

截圖存放：`screenshots/local/bootstrap-v1-core-from-report/`

| File               | Page                        | Status            |
| ------------------ | --------------------------- | ----------------- |
| 01-index.png       | `/` → redirect (before fix) | ⚠️ 缺 auth: false |
| 02-login.png       | `/auth/login`               | ✅                |
| 03-register.png    | `/auth/register`            | ✅                |
| 04-callback.png    | `/auth/callback`            | ✅                |
| 05-index-fixed.png | `/` (after fix)             | ✅                |

Dark mode 測試通過，配色一致性確認。

Agent 另產出完整報告：`screenshots/local/bootstrap-v1-core-from-report/review.md`

---

## Round 3 — UploadWizard Design Review — 2026-04-18

對應 `tasks.md` Section 9。

### Scope

- `app/components/documents/UploadWizard.vue` — 上傳流程 wizard，涵蓋 7 個 step（select → presign → upload → finalize → sync → indexing_wait → publish）+ complete 終態

### Design Fidelity Report (Before)

| #   | 類別        | 狀態  | 位置                                   | 問題                                                                                                                                                          |
| --- | ----------- | ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | consistency | DRIFT | `UploadWizard.vue:514`                 | Step indicator completed 狀態用 `border-success bg-success text-inverted`（綠色填滿），違反 DS「語意色彩僅用於系統回饋，不用於裝飾」                          |
| 2   | consistency | DRIFT | `UploadWizard.vue:531`                 | Step separator completed 用 `bg-success`（綠線），裝飾性 success 色                                                                                           |
| 3   | consistency | DRIFT | `UploadWizard.vue:718` (publish step)  | `text-success` 於 `i-lucide-check-circle` — 裝飾性完成 icon 使用 success 語意色                                                                               |
| 4   | consistency | DRIFT | `UploadWizard.vue:737` (complete step) | `text-success` 於 `i-lucide-party-popper` — 慶祝 icon 使用 success 語意色                                                                                     |
| 5   | a11y        | 建議  | `UploadWizard.vue:508-535`             | Step indicator 為裝飾性 `<div>`，非語意化 `<ol>/<li>`；缺 `aria-current="step"` 與 `aria-label`；active 狀態的 `animate-spin` 未尊重 `prefers-reduced-motion` |
| 6   | state       | 建議  | `UploadWizard.vue:145-152`             | `getIndexingStatusLabel` 未覆蓋 `pending`、`queued`、`running` 等 sync/index status，fallback 「處理中…」雖可用但資訊量偏低                                   |

**Fidelity Score (Before): 3/8** — Visual / Consistency / Accessibility 三項偏離 DS

### Fixes Applied

| #   | 修復                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Completed step indicator 改為 `border-primary bg-default text-default`（outlined + check icon），保持視覺識別但不使用 success 色                                                                                                              |
| 2   | Separator completed 改 `bg-primary`，使用 DS 的 neutral primary（黑/白）表示完成連結                                                                                                                                                          |
| 3   | Publish step check-circle icon 改 `text-default`，icon 形狀本身已傳達完成語意                                                                                                                                                                 |
| 4   | Complete step party-popper icon 改 `text-default`，同上                                                                                                                                                                                       |
| 5   | Step indicator 改用 `<ol>` / `<li>` 語意化；加 `aria-current="step"`、`aria-label="<step.label>：<status-label>"`、separator 加 `aria-hidden="true"`、spinner 加 `motion-reduce:animate-none`；新增 `stepStatusLabel()` helper 產生 a11y 文字 |
| 6   | 保留 fallback，未擴充 — spec 未明確列 `pending` / `running` 應有專屬文案，改動範圍超出 review scope，移到 follow-up                                                                                                                           |

**Fidelity Score (After): 7/8** — 建議 #6 未做（非 DRIFT，已記錄為 follow-up）

### Skills Executed (conceptually)

1. `/polish` — token 對齊（移除裝飾性 success 色）
2. `/harden` — a11y（aria-current / aria-label / motion-reduce）
3. `/audit` — 以 typecheck + lint 0 warnings 驗證

### State Coverage（依 `ux-completeness.md`）

| State               | 實作位置                                      | 覆蓋          |
| ------------------- | --------------------------------------------- | ------------- |
| `preprocessing`     | `getIndexingStatusLabel` 分支 + polling       | ✅            |
| `smoke_pending`     | `getIndexingStatusLabel` 分支                 | ✅            |
| `indexed`           | polling transition → `currentStep=publish`    | ✅            |
| `failed`            | polling 檢查 + `indexingError` UI + retry CTA | ✅            |
| `timeout`（> 5min） | `setTimeout(5 * 60 * 1000)` + 錯誤文案        | ✅            |
| `pending`/`running` | fallback 「處理中…」                          | ⚠️ 非專屬文案 |

Spec 要求的 4 個 state（preprocessing / smoke_pending / indexed / failed）全部覆蓋。timeout 額外覆蓋。

### Verification

- [x] `pnpm format` — clean
- [x] `pnpm lint` — 0 warnings / 0 errors
- [x] `pnpm typecheck` — 0 errors（僅 import dedup warnings，非本次新增）
- [x] Step indicator DRIFT 修復 — 無 `bg-success` / `text-success` 裝飾殘留
- [x] a11y — `<ol>/<li>` + `aria-current` + `motion-reduce:animate-none`
- [x] State Coverage — 4 spec 要求 state 全覆蓋

### Screenshot Evidence (Before)

截圖由前代 agent 拍攝，存放於 `screenshots/local/bootstrap-v1-core-from-report/`：

| File                                      | State                                      |
| ----------------------------------------- | ------------------------------------------ |
| `B3-before-01-select-step.png`            | Select / dropzone + form                   |
| `B3-before-02-indexing-preprocessing.png` | `indexing_wait` - preprocessing            |
| `B3-before-03-indexing-smoke-pending.png` | `indexing_wait` - smoke_pending            |
| `B3-before-04-indexing-indexed.png`       | `indexing_wait` - transitioning to publish |
| `B3-before-05-indexing-failed.png`        | `indexing_wait` - failed with retry CTA    |
| `B3-before-06-publish-step.png`           | Publish step（前：綠色 check-circle）      |
| `B3-before-07-complete-step.png`          | Complete step（前：綠色 party-popper）     |
| `B3-before-08-step-error-indicator.png`   | Step indicator error path                  |

**After 截圖**：因 agent 撞到 image context 限制無法補拍；code diff 已明確驗證修復範圍，若要補 after 截圖可手動跑 dev server 拍攝。

### Cross-Change DRIFT

`admin-document-lifecycle-ops` 近期已完成同 DS 檢查（見該 change 的 `design-review.md`）。此處 UploadWizard 的 DRIFT 都是**裝飾性 success 色**（另一條 change 是**裝飾性 warning / primary 色**）— 屬同一 DS 規則的不同違反點，兩者修復方向一致（都改 neutral）。`.impeccable.md` 上次已補的「破壞性動作允許 `color="error"`」不延伸到 success，維持 error 是唯一例外。

### Follow-Up

- [ ] `getIndexingStatusLabel` 為 `pending` / `running` / `queued` 擴充專屬文案（非 DRIFT，是資訊完整度改善）
- [ ] 在 dev server 補拍 after 截圖，加進 evidence 段落

### B3 Findings 回顧

原 tasks 9.6 提及「新增段落記錄 B3 findings」。B3 是 `bootstrap` 主 task 清單中記錄的 bug — AutoRAG index 未啟用導致 `/api/chat` 對剛上傳文件回空回覆。**B3 不屬於 UploadWizard UI 層問題**（是 server 端 AutoRAG binding 問題），此 Design Review 無法也不應該修復，僅能在 UI 層確保 `indexing_wait` 的 `failed` state 有明確 CTA（已有）。B3 本身的修復由 `bootstrap` 的 `8.5` / `8.6` task 處理。
