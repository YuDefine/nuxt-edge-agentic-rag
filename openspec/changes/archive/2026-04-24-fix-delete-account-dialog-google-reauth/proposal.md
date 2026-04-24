## Problem

`app/components/auth/DeleteAccountDialog.vue` 的 Google reauth 路徑會讓整個刪除流程中斷：

1. 使用者在 `/account/settings` → 按「刪除帳號」→ dialog 開啟
2. 按「使用 Google 重新驗證」→ `signIn.social({ provider: 'google' })` 做 full-page redirect 到 Google OAuth
3. Google 完成後 better-auth 預設 callback 回 `/`（因為 `handleGoogleReauth` 沒指定 `callbackURL`）
4. 使用者落在首頁；原 dialog 已 unmount，component 內的 `reauthComplete = true` 寫在已被銷毀的 Vue instance 上，不會生效
5. 使用者沒有任何指示「session 已 rotate / reauth 已成功」，必須自行從 `/account/settings` 再走一次 delete 流程
6. 若使用者第二次又選 Google，會再跨域一次，永遠走不到 confirm 按鈕

Passkey reauth 因為是 same-origin WebAuthn ceremony，流程完全在 dialog mount 期間完成，**不受影響**。

實證定位：`app/components/auth/DeleteAccountDialog.vue:79-93` `handleGoogleReauth`，`signIn.social({ provider: 'google' })` 沒傳 `callbackURL`；`app/pages/auth/callback.vue:23` 已支援 `resolveReturnToPath()` 消費 generic return-to；`app/pages/account/settings.vue:533` `<LazyAuthDeleteAccountDialog>` 以 `v-model:open` 綁 `deleteDialogOpen`，目前不讀任何 query 參數。

## Root Cause

1. **`callbackURL` 缺失** → better-auth Google provider 預設回 `/`，而不是 `/auth/callback`，也就繞過了 `resolveReturnToPath()` bridge
2. **Dialog 生命週期耦合 reauth 狀態** → `reauthComplete` 是 `<script setup>` 的 `ref()`，對 Vue instance 是 per-mount state；跨網域 redirect 必定讓 instance unmount 丟失
3. **Settings 頁沒有 resume signal** → 即使 callback 成功帶著使用者回來，settings 頁也不知道「剛才是在 delete 流程的 Google reauth 步驟離開的」，不會自動重開 dialog 並跳到 confirm step

## Proposed Solution

採方案 A（TD-028 Fix approach 已評估 A vs B，A 較簡單、沿用既有 `saveGenericReturnTo` bridge；B 把 reauth 搬到獨立頁，scope 過大）：

1. **`signIn.social` 補 `callbackURL: '/auth/callback'`** — 讓 Google OAuth 回到既有 auth callback，由 `resolveReturnToPath()` 處理 redirect
2. **新增短效「pending delete reauth」session flag** — 在 `handleGoogleReauth` 跨域前寫入 sessionStorage 一個 signed / timestamped 的 flag；5 分鐘後失效（對齊 server reauth window）
3. **`handleGoogleReauth` 前呼叫 `saveGenericReturnTo('/account/settings?open-delete=1')`** — 讓 `/auth/callback` 把使用者帶回 settings 頁並帶 query hint
4. **`/account/settings` 在 `onMounted` 讀 query + flag**：
   - 若 `route.query['open-delete'] === '1'` 且 `consumePendingDeleteReauth()` 回傳 valid non-expired timestamp
   - 開啟 dialog，並以新增 prop `initialReauthComplete` 傳 `true`，讓 dialog 直接跳到 confirm step
   - 無論成功與否，**清除 query string**（`router.replace`）避免 reload / 分享連結再觸發
5. **`DeleteAccountDialog` 接受 `initialReauthComplete?: boolean`** prop；watch `open` 開啟時，若此 prop 為 true → `reauthComplete.value = true`（dialog 跳到「已完成 reauth」視覺狀態，可直接按確認刪除）
6. **Flag 驗證策略**：flag 是 client-side UX hint；**真正的 reauth window 檢查仍由 server `/api/auth/account/delete` 把關**，這裡 sessionStorage flag 被偽造不會影響 security boundary（server 依 session rotation timestamp 判定，見 spec `Passkey-Only Account Self-Deletion Requires Reauth` scenario `Deletion without reauth is refused`）

## Non-Goals

- **NEVER** 改 server side `/api/auth/account/delete` 的 reauth window 邏輯或 DB 互動 — 現行 spec `Passkey-Only Account Self-Deletion Requires Reauth` 已經保證 server 會拒絕 >5 分鐘 session；本 change 純 UI flow fix
- **NEVER** 改 passkey reauth 路徑 — passkey 為 same-origin WebAuthn，不經 Google OAuth，未受此 bug 影響；不得為了「統一」而讓 passkey 繞去 `/auth/callback`
- **NEVER** 把 dialog 搬到獨立頁（方案 B）— scope 過大，現行 modal pattern 與 settings 頁其他 dialog 保持一致較重要
- **NEVER** 自動重新 fetch session 或重撈 credentials — `/auth/callback` 已 `fetchSession({ force: true })`，回到 settings 後 `useUserSession()` 會是最新態
- **NEVER** 把 sessionStorage flag 當成 security boundary — server 仍是唯一授權來源
- **不** 修其他 `auth-redirect-refactor` code-review 項（本 change 只處理 TD-028 / OBS-1）

## Success Criteria

1. 使用者於 `/account/settings` 刪除帳號 → 選 Google reauth → 完成 Google OAuth → **自動回到 `/account/settings`，dialog 自動開啟，confirm 按鈕立即可按**
2. `/account/settings` URL 不殘留 `?open-delete=1`（被 replace 清掉）
3. Passkey reauth 路徑行為與現況**完全一致**（無 regression）
4. 即使惡意使用者手動訪問 `/account/settings?open-delete=1`：flag 驗證失敗 → dialog 不會自動打開並 skip reauth；就算強行打開，server 仍會依 5 分鐘 session 檢查拒絕（security boundary 保全）
5. 不存在 `pending-delete-reauth` sessionStorage flag 但已進入 settings 頁時，`deleteDialogOpen` 預設維持 false、使用者體驗無差異
6. Bundle size 無顯著變化（新 helpers 為 utility function；flag 以字串 timestamp 存 sessionStorage）

## Impact

- Affected specs: `passkey-authentication`（Modified — 新增 UI flow scenario 說明 Google reauth 跨域恢復）
- Affected code:
  - Modified:
    - app/components/auth/DeleteAccountDialog.vue (`handleGoogleReauth` 補 callbackURL + saveGenericReturnTo + setPendingDeleteReauth；加 `initialReauthComplete` prop 與初始化 logic)
    - app/pages/account/settings.vue (`onMounted` 讀 query + consume flag + 開 dialog + clear query)
    - app/utils/auth-return-to.ts (新增 `setPendingDeleteReauth` / `consumePendingDeleteReauth` helpers + 時戳驗證)
  - New:
    - test/unit/auth-return-to-pending-delete.test.ts (new helpers unit test — valid flag / expired flag / missing flag / malformed flag)
    - test/unit/delete-account-dialog-initial-reauth.test.ts (component test — prop 為 true 時進 confirm step / 為 false 時走原流程)
  - Removed: (none)
- Dependencies / bindings: 無新套件、無新 env var、無新 runtime config、無 migration
- Security surface: sessionStorage flag 僅為 UX hint；server 端 reauth window check 維持不變（spec scenario `Deletion without reauth is refused`）
- Parallel change coordination: 與 `upgrade-mcp-to-durable-objects` / `enhance-mcp-tool-metadata` / `add-mcp-tool-selection-evals` 完全獨立；完全不碰 `server/mcp/**`、`test/evals/**`、MCP 相關模組

## Affected Entity Matrix

本 change 不觸動 DB schema、enum、shared types、或 migration；只改 frontend auth flow。不需要 Entity Matrix。

## User Journeys

### Self-deletion via Google reauth (primary journey — 本 change 修復對象)

- **Authenticated user with Google-linked account**（可能另有 passkey）在 `/account/settings` → 捲到「危險區域」→ 按「刪除我的帳號」→ dialog 開啟
- **User** 於 dialog 中按「使用 Google 重新驗證」→ 跳轉 Google OAuth → 完成 → 回到 `/account/settings`（**不是 `/`**）
- **User** 看到 dialog **自動再次打開**，且上方狀態條顯示「重新驗證身分（已完成）」，reauth 按鈕區塊消失、confirm 按鈕已 enable
- **User** 按「確認刪除」→ server 接受（session 在 5 分鐘內）→ 成功刪除 → redirect 到 `/auth/login`

### Self-deletion via Passkey reauth (regression journey — 不得受影響)

- **Authenticated user with passkey**（可能另有 Google）在 `/account/settings` → 按「刪除我的帳號」→ dialog 開啟
- **User** 按「使用 Passkey 重新驗證」→ 裝置彈出 WebAuthn prompt → 完成 → dialog 內狀態切到「已完成」
- **User** 按「確認刪除」→ 成功 → redirect 到 `/auth/login`
- 整段流程**沒有任何跨域 redirect**，`callbackURL` 邏輯不介入

### Malicious / accidental direct access to `/account/settings?open-delete=1`

- **Any user** 手動在網址列輸入 `/account/settings?open-delete=1` 並進入
- **System** 讀 query + consume pending-delete-reauth flag，flag 不存在或已過期 → **dialog 不自動打開**；query 立即被 `router.replace` 清除
- User 仍可手動按「刪除我的帳號」走標準流程（必須重新 reauth）

### Google reauth 取消 / 失敗 (error journey)

- **User** 按 Google reauth → 在 Google OAuth 頁按「取消」或授權失敗 → Google 回 `/auth/callback?error=access_denied`
- `/auth/callback` 已處理 error query → 顯示錯誤訊息
- 使用者返回 `/account/settings`，dialog 不會自動打開，pending-delete-reauth flag 因未被 consume 仍在 sessionStorage 中（5 分鐘後自動過期）

## Implementation Risk Plan

- Truth layer / invariants: **Server-side reauth window 是 single source of truth**（`/api/auth/account/delete` 檢查 session rotation timestamp <5 min），此 change 只加 client UX hint 不動 server；sessionStorage flag 僅為「要不要自動開 dialog」訊號，**絕不**作為 skip server reauth check 的根據；既有 `resolveReturnToPath()` 優先順序（MCP connector → generic → null）不動
- Review tier: **Tier 2** — 雖 diff 短，但碰到 auth flow + 觸發點是「刪帳號」destructive action，code review **MUST** 特別檢查：(a) sessionStorage flag 驗證不能被繞過成「跳過 reauth」、(b) query param `?open-delete=1` 清除時機早於 dialog emit、(c) passkey path 無任何 regression
- Contract / failure paths: Flag 過期 / 缺失 / 惡意 → dialog 預設不開、query 被清、使用者走標準流程；Google OAuth 取消 → `/auth/callback` 既有 error 處理不變；網路錯誤 / OAuth provider 暫停 → dialog 重開前使用者停在 Google OAuth 頁；dialog `initialReauthComplete` 被傳 true 但 server 拒絕 → server 回 403，dialog 顯示錯誤訊息；**失敗路徑絕不可靜默刪除**
- Test plan: Unit — `auth-return-to-pending-delete.test.ts` 覆蓋 set / consume / expired / malformed 四種 case；Component — `delete-account-dialog-initial-reauth.test.ts` 測 `initialReauthComplete=true` 時 dialog 視覺跳 confirm step、`false` 時走原 reauth 步驟；Integration — 無新 server endpoint；E2E / Playwright — 因 Google OAuth 無法在自動化環境走完，標記為 **Manual evidence** 由使用者以 production / staging 帳號實測；Screenshot review — dialog 兩種視覺態（有 reauth 按鈕 vs 直接 confirm）各一張
- Artifact sync: `openspec/specs/passkey-authentication/spec.md`（新 scenario 覆蓋 UI flow）；`docs/tech-debt.md`（TD-028 Status 改 done，archive 時處理）；`HANDOFF.md`（若本 change 於單一 session 內完成可直接 archive；否則更新進度）
