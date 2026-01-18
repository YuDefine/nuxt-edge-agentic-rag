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

1. `/normalize` — Color tokens, button colors, link styles, component props
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
