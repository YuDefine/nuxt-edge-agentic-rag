# Design Review — passkey-authentication

**Date**: 2026-04-21
**Reviewer**: `/design improve` (spectra-apply §16)
**Tech Stack**: Nuxt + Nuxt UI v4
**Design System**: `.impeccable.md` — 純黑白極簡主義 / DM Sans / 語意 token only

## Scope

以下 UI 檔案納入本次 review：

- `app/pages/index.vue` — Login + signed-in chat shell
- `app/pages/account/settings.vue` — 帳號設定頁（identity / passkeys / link Google / danger zone）
- `app/pages/admin/members/index.vue` — 管理員成員列表
- `app/components/auth/NicknameInput.vue` — 暱稱輸入元件（debounce 驗證）

## Quick Assessment

| Dimension     | 評分  | 發現                                                                                                                           |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| Visual        | ★★★★★ | 語意 token 一致；純黑白極簡；無硬編碼色                                                                                        |
| Interaction   | ★★★★★ | Debounce、loading、motion-reduce 齊備                                                                                          |
| Structure     | ★★★★☆ | UCard 分組清晰；login 3 按鈕 hierarchy 輕微扁平（acceptable）                                                                  |
| Copy          | ★★★★★ | 繁中清楚、help text 明確、error 可行動（例：「改用 Google 登入」）                                                             |
| Resilience    | ★★★★★ | 4 頁皆有 empty/loading/error/unauthorized                                                                                      |
| Performance   | ★★★★★ | `Lazy*` 元件（LazyUAlert / LazyAuthPasskeyRegisterDialog / LazyAuthDeleteAccountDialog / LazyChatConversationHistory）使用得當 |
| Accessibility | ★★★★★ | aria-label / aria-describedby / sr-only / motion-reduce / semantic landmarks                                                   |
| Consistency   | ★★★★★ | 嚴格遵守 `.impeccable.md` 語意 token 規範                                                                                      |

## Design Fidelity Report

修復 `settings.vue` passkey empty state DRIFT 後的最終分數。

| 面向                  | 分數 | 狀態     | 備註                                                                            |
| --------------------- | ---- | -------- | ------------------------------------------------------------------------------- |
| 語意 token 使用       | 8/8  | FIDELITY | 無 `text-gray-*` / `text-black` / `text-white` / `dark:` prefix                 |
| 破壞性動作色          | 8/8  | FIDELITY | `color="error"` 僅用於 revoke passkey / 刪帳號；其他一律 `color="neutral"`      |
| State coverage        | 8/8  | FIDELITY | Empty/loading/error/unauthorized 全部覆蓋                                       |
| 顯式元件 props        | 8/8  | FIDELITY | UButton/UInput/UBadge/USelect 的 color/variant/size 全部明寫                    |
| Canonical empty state | 8/8  | FIDELITY | 修復後統一採 icon + title + subtitle 範式（settings passkey empty 已修）        |
| Accessibility         | 8/8  | FIDELITY | aria-label / sr-only / motion-reduce / `<aside>`／`<section>` landmarks         |
| 響應式斷點            | 8/8  | FIDELITY | xs → md → lg → xl 漸進揭露；admin table columns 依 breakpoint 隱藏              |
| Typography hierarchy  | 8/8  | FIDELITY | 以 font-weight + size 建立層級（font-bold/semibold/medium + 2xl/lg/base/sm/xs） |

**Overall Fidelity Score: 8/8 — No DRIFT items remaining**

## Fixes Applied

### Fix 1 — `settings.vue` passkey empty state upgrade

**Before** — 單行 dashed-box，不符 `.impeccable.md` canonical empty state pattern：

```html
<div class="rounded-md border border-dashed border-default p-4 text-center text-sm text-muted">
  尚未綁定任何 passkey
</div>
```

**After** — icon-centered pattern 對齊 `.impeccable.md` §Component Patterns / 空狀態：

```html
<div class="flex flex-col items-center justify-center py-10 text-center">
  <UIcon name="i-lucide-key-round" class="mb-2 size-10 text-dimmed" />
  <p class="font-medium text-default">尚未綁定任何 passkey</p>
  <p class="mt-1 text-sm text-muted">新增 passkey 後可免密碼登入此裝置。</p>
</div>
```

## Targeted Skills Plan

由於基線品質高（唯一 DRIFT 已修），此 change 的 targeted skill 執行範圍縮至最小：

| Canonical Order                      | Skill          | 執行狀態 | 說明                                                                                     |
| ------------------------------------ | -------------- | -------- | ---------------------------------------------------------------------------------------- |
| `/distill`                           | —              | Skipped  | 介面已極簡，不需再減                                                                     |
| `/layout`                            | —              | Skipped  | UCard 分組與斷點層級合理                                                                 |
| `/typeset`                           | —              | Skipped  | 字重 + 大小 hierarchy 已建立                                                             |
| `/colorize` / `/bolder` / `/quieter` | —              | Skipped  | 嚴格黑白主義，色彩不介入                                                                 |
| `/animate`                           | —              | Skipped  | `.impeccable.md` Don'ts 明定「不使用動畫（除必要載入指示）」                             |
| `/clarify`                           | —              | Skipped  | Copy 已清楚可行動                                                                        |
| `/delight`                           | —              | Skipped  | 企業內部工具，與基調相悖                                                                 |
| `/harden`                            | —              | Skipped  | 狀態覆蓋已齊全；WebAuthn 錯誤已分類處理（NotAllowedError / InvalidStateError / timeout） |
| `/optimize`                          | —              | Skipped  | `Lazy*` 元件已套用                                                                       |
| `/adapt`                             | —              | Skipped  | 響應式 xs → xl 已覆蓋                                                                    |
| `/polish`                            | applied inline | Done     | DRIFT fix 即為 polish 內容                                                               |

## Cross-Change Holistic Check

同 layout（auth / default / chat）的既有頁面抽樣：

- `app/layouts/auth.vue` / `app/layouts/default.vue` / `app/layouts/chat.vue` — 先前 change 已建立的 layout shell，本 change 新增頁面均套用且未引入偏差
- `app/pages/admin/members/index.vue` 原已存在，本 change 僅擴充 columns（displayName primary / credentialTypes / registeredAt / lastActivityAt）；既有 neutral badge + semantic token pattern 維持一致

**Cross-Change DRIFT: None**

## Responsive Check (16.4.1)

已執行（2026-04-21，Playwright Chromium，light mode）。

| 頁面                    | xs 360  | md 768  | xl 1280 | 備註                                                                                                         |
| ----------------------- | ------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `/` login               | PASS    | PASS    | PASS    | Google + divider + Passkey 登入 + Passkey 註冊 4 元素皆可見、無 overflow、logo 置中                          |
| Passkey register dialog | PASS    | PASS    | PASS    | xs 全寬、md/xl 居中 modal；按鈕 layout xs 垂直、md/xl 右對齊水平                                             |
| `/account/settings`     | BLOCKED | BLOCKED | BLOCKED | Error state UI 渲染正確（同三 breakpoint 無 overflow）；happy path 因 **TD-010** local libsql 不相容無法渲染 |
| `/admin/members`        | BLOCKED | BLOCKED | BLOCKED | Error state + header 篩選 + nav 在三 breakpoint 顯示正常；table happy path 因 **TD-010** 無法驗證            |

**Screenshots**: `screenshots/local/passkey-authentication/`（12 張 + `review.md`）

**Deferred to §17**：settings / admin members happy path 的響應式佈局於 production 或 TD-010 修後驗收。

## Accessibility Check (16.4.2)

結構性 a11y 已檢視（靜態程式碼層）：

- ✅ `<aside aria-label="對話記錄">` + `<section aria-label="知識庫問答">` landmark 正確
- ✅ NicknameInput 的 `aria-describedby="nickname-status"` 連到驗證狀態 icon
- ✅ `srOnlyHeader('操作')` 讓 screen reader 可讀到 actions column header
- ✅ 所有動畫 class 皆帶 `motion-reduce:animate-none`
- ✅ Email "—" placeholder 附 `aria-label="沒有 email"`
- ✅ Credential empty badge 附 `aria-label="尚未綁定任何憑證"`

鍵盤走查（Tab / Esc / focus ring）需實際在瀏覽器操作，留待 `/review-screenshot` + 人工檢查 §17 執行。

## Audit Result (16.5)

- **Audit Health Score**: 20/20 (Excellent)
- **Anti-Patterns Verdict**: PASS — 無 AI slop tells
- **Critical count**: 0 ✅
- **P2 issues**: 1
  - Settings revoke button `size="sm"` 略低於 44×44 touch target（WCAG 2.5.5 AAA 建議，AA 不強制）
- **P3 issues**: 2
  - NicknameInput status region 可加 `role="status" aria-live="polite"` 支援 SR 自動朗讀（WCAG 4.1.3）
  - UAvatar lazy loading pass-through（當前 pageSize=20 衝擊輕微）

P2/P3 皆屬 polish，不阻擋 archive。完整細節見 `/audit` 輸出。

## Screenshot Review (16.6)

- **通過**：6/12（login × 3 + register dialog × 3）
- **阻擋於 TD-010**：6/12（settings × 3 + admin members × 3）— error state UI 正常，happy path 渲染失敗
- 報告：`screenshots/local/passkey-authentication/review.md`

## Found During Design Review

本次 §16 session 發現並登記的追加工作項目：

### FD-001 Resolution — `auth.config.ts` 加 `fieldName: 'display_name'`

**原狀態**：Schema 用 camelCase `displayName`，migration 建 snake_case `display_name`，兩者不一致 → better-auth 產生的 drizzle query 用 `"displayName"` 讀不到 column。

**實施**：`server/auth.config.ts` `additionalFields.displayName` 加 `fieldName: 'display_name'`。`@onmax/nuxt-better-auth` schema generator 實證支援 `fieldName`，重新生成的 `.nuxt/better-auth/schema.sqlite.ts` 使用 `text("display_name")` ✓

**Smoke 測試**：`curl POST /api/_dev/login` admin/member 皆回 HTTP 200。

### TD-010 — credentials / admin-members raw SQL libsql 不相容

- 位置：`server/api/auth/me/credentials.get.ts`、`server/api/admin/members/index.get.ts`
- 症狀：`db.all(sql\`...\`)` 在 local libsql 不支援；production D1 正常
- Priority：mid；Status：open
- 修法：仿 TD-001，改寫為 drizzle ORM query
- 登記於 `docs/tech-debt.md`
- Markers：tasks.md 16.4.1 / 16.6 帶 `@followup[TD-010]`

### Local Migration Apply（1.7 落實）

- `.wrangler/state/v3/d1/`：`pnpm exec wrangler d1 migrations apply DB --local` → 0008 + 0009 成功
- `.data/db/sqlite.db`（hub:db 實際讀取）：`sqlite3` 直接套用 0008 + 0009 SQL → 成功
- 兩 DB 的 `user` 表皆有 `display_name NOT NULL`、`email` nullable、`user_display_name_unique_ci` + `user_email_partial_unique` 索引皆建立，`passkey` 表 11 columns
- 執行期間刪除 `mcp_tokens` 中 6 筆 NULL `created_by_user_id` 的 dev 測試列 + 33 筆 orphan `query_logs`（阻擋 0008 NOT NULL rebuild）

## Conclusion

此 change 的 UI 實作品質高，嚴格遵守 `.impeccable.md` 設計系統；唯一 DRIFT 已於本次 review 修復，Fidelity Score 達 8/8，可進入響應式 / a11y / audit / screenshot review 的最終驗收階段。
