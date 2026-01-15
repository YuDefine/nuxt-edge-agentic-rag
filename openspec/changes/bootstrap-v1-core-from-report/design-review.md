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

## Remaining Known Issue

| Severity | Issue                            | Notes                           |
| -------- | -------------------------------- | ------------------------------- |
| High     | `forgot-password.vue` 無實際 API | 功能問題，非 design review 範圍 |
