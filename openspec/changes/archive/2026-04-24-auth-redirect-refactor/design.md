## Context

`/` 目前違反 single-responsibility：同時是 public landing、login UI、chat 容器、chat history fetch 起點。這造成：

1. `/auth/login` 只是 `navigateTo('/')` 的假路由（`app/pages/auth/login.vue:1-5`）
2. 全域 middleware 未登入無腦 `navigateTo('/')`，丟失原目標路徑（`app/middleware/auth.global.ts:9`）
3. `watch(historyRefreshKey, ..., { immediate: true })` 不檢查登入狀態，未登入首頁立刻打 `/api/conversations` → 401 → toast 誤報（`app/pages/index.vue:119-125`）

**既有獨立流程**：`/auth/mcp/authorize.vue` 是 Claude.ai connector 的獨立登入容器，有自己的 Google + Passkey UI 與 `saveMcpConnectorReturnTo` sessionStorage bridge（`app/utils/mcp-connector-return-to.ts`）。本 change **MUST** 不破壞此流程。

**路由慣例**：其他 `navigateTo('/')` 呼叫點有 `app/middleware/admin.ts:23,28`、`app/components/auth/DeleteAccountDialog.vue:99`、`app/pages/chat/index.vue:3`。後兩者是「登入使用者的邏輯回首頁」，語義正確，不動。admin middleware 未登入分支與 auth.global.ts 同症狀，本 change 同步修正。

## Goals / Non-Goals

**Goals:**

- `/` 專職 chat（auth required），移除登入 UI 分支與未檢查登入的 history fetch
- `/auth/login` 升格為獨立登入頁（`auth: false`、`layout: 'auth'`）
- Middleware 攔截未登入時帶 `?redirect=<path>`，登入成功後導回原目標
- 同時覆蓋 Passkey（同 origin query 讀取）與 Google OAuth（跨 domain sessionStorage bridge）
- Open redirect 防護 validator 抵禦 `//`、`http:`、`javascript:` 三類 payload
- MCP double-handshake 流程零回歸

**Non-Goals:**

- Admin middleware 無權限分支（`isAdmin === false`）UX 改善 — 另開 `admin-unauthorized-feedback` change
- `/auth/mcp/authorize` 整併到 `/auth/login` — 語義不同，維持獨立容器
- `?redirect=` allowlist prefix 維護機制 — 採黑盒 validator
- API 層 401 的 return-to 透傳
- 已登入使用者訪問 `/auth/login` 時的 bounce-away 行為（不強制跳走）

## Decisions

### Login Surface Routing

`/` 設為 `auth: true`（透過 middleware 保護，非 `definePageMeta.auth` 因 nuxt-better-auth 預設行為），`/auth/login` 設為 `auth: false` + `layout: 'auth'`。這避免 `auth: false` 頁面被 middleware 攔截造成無限循環。

**Alternatives considered:**

- 繼續在 `/` 混合 login + chat，只修 middleware → ❌ 不解決症狀 3（401 toast）
- `/auth/login` 用 modal 方式呈現 → ❌ 沒有容器頁可 host modal；且初次使用者體驗不佳
- 全部 auth 頁用 nuxt-better-auth `auth: true` meta → ❌ middleware 提前 redirect 更直接、不依賴套件行為

### Return-To Query Param Validation

`app/utils/auth-return-to.ts` 提供 `parseSafeRedirect(raw: unknown): string | null`。通過條件：

```
typeof raw === 'string' &&
raw.length > 0 &&
raw.length <= 2048 &&
raw.startsWith('/') &&
!raw.startsWith('//') &&
!/^[a-z]+:/i.test(raw)  // 擋 javascript:, http:, data: 等任何 scheme
```

通過 → 回傳原字串；任一條件失敗 → 回傳 `null`，呼叫端 fallback `/`。

**Alternatives considered:**

- Allowlist prefix（`['/admin', '/account', ...]`）→ ❌ 每加新路由要維護清單，容易漏；且本專案 routes 數量有限制但仍在擴張
- `URL` constructor parse + same-origin check → ❌ 邊界情況多（`new URL('//evil.com', window.location.href)` 是 evil.com 不是 same-origin），容易寫錯
- Blocklist（擋 `http:` / `javascript:`）→ ❌ 黑名單永遠比白名單漏

### Cross-Domain Return-To Bridge（Google OAuth）

Google OAuth redirect_uri 固定為 `/auth/callback`，查詢字串無法從 `/auth/login?redirect=X` 傳到 Google 再傳回 callback。解法：登入按下去時 **同步** `saveGenericReturnTo(redirect)` 寫 sessionStorage，callback 端 `consumeGenericReturnTo()` 讀取+清空。

**sessionStorage Key 選擇**：`auth:return-to`（generic）與 `mcp-connector:return-to`（existing MCP）**分開的 key**，兩者可並存但互不干擾。**底層 helper 可抽公用**（`saveReturnTo(key, path)` / `consumeReturnTo(key)`），但 API surface 分開暴露避免呼叫端搞混。

**Callback consume order（MUST）**：

```
1. consumeMcpConnectorReturnTo() → non-null → clearGenericReturnTo() → navigate & return
2. consumeGenericReturnTo() → non-null → validate via parseSafeRedirect → navigate (or fall to step 3)
3. navigate to '/'
```

MCP 先讀因為它是 double-handshake 的一部分（不讀就回不了 authorize 頁）；且使用者不可能同時處於 MCP 授權與一般登入流程（`authorize.vue` 是獨立容器，不經 `/auth/login` 按鈕）。

**MCP 贏時也 clear generic 的理由**：若使用者先開了一般登入流程（例如按 Google 登入目標路徑為 `/admin/documents`，但 OAuth 中途放棄），sessionStorage 會殘留 `auth:return-to='/admin/documents'`。之後同一個 tab 啟動 MCP 授權流程（`/auth/mcp/authorize` → Google → `/auth/callback`），若只消費 MCP 不碰 generic，下一次任何 `/auth/callback` 訪問（即使是無關登入）會被 generic 靜默導去 `/admin/documents`。因此 MCP 贏時必須 ALSO clear generic，對應 login.vue 的 Google 按鈕也必須在「無 `?redirect=`」時 clear generic，避免 ghost 污染。

**Alternatives considered:**

- Cookie-based return-to → ❌ 需要 server-side 讀寫；本專案無此需求 overhead
- 共用單一 sessionStorage key（MCP 與 generic 搶 key）→ ❌ 若 user 同時開兩個 tab 會亂；分 key 清晰
- Encode 進 `state` parameter（OAuth 標準做法）→ ❌ better-auth `signIn.social` 沒暴露 state 自訂 API，且 validator 仍須做一次

### Middleware Redirect URL Composition

`app/middleware/auth.global.ts` 組 URL 的規則：

```typescript
if (!loggedIn.value) {
  if (to.path === '/auth/login') return // 避免循環
  if (to.path === '/') return navigateTo('/auth/login') // 根路徑無需 redirect qs
  return navigateTo(`/auth/login?redirect=${encodeURIComponent(to.fullPath)}`)
}
```

**Alternatives considered:**

- 無條件附加 `?redirect=` → ❌ `/auth/login?redirect=/` 是奇怪 URL，validator 雖能接受但語義冗餘
- middleware 寫 sessionStorage → ❌ SSR context 無 sessionStorage；且 middleware 執行時機跟 page hydration 時機不同步

### admin.ts Middleware 未登入分支對齊

`app/middleware/admin.ts:22` 未登入分支改與 `auth.global.ts` 一致（`/auth/login?redirect=<path>`）。**無權限分支** `L26-28` **不動**，另開 change 處理。

**Alternatives considered:**

- 本 change 一併改無權限分支 → ❌ scope 擴張；無權限需要設計 `/forbidden` 頁或 toast 機制，是獨立 UX 決策
- 讓 admin.ts 呼叫共用函式 → ❌ 目前只兩個 middleware，抽共用函式反而增加間接層；等第三個 middleware 出現再抽

### `/auth/login` 頁的 Passkey 成功流程

Passkey 同 origin 完成，不跨 domain，**不走 sessionStorage**。成功後讀 `route.query.redirect`，`parseSafeRedirect` 驗證後 `navigateTo(redirect ?? '/', { replace: true })`。

**Alternatives considered:**

- Passkey 也走 sessionStorage → ❌ 同 origin 流程多此一舉；且會覆蓋可能存在的 MCP key

## Risks / Trade-offs

- **[Risk] MCP authorize 流程被 middleware 攔截** → Mitigation: `authorize.vue` 保留 `definePageMeta({ auth: false })`；middleware 尊重此 meta 已既有行為（`auth.global.ts:5`）。測試必覆蓋此 journey。
- **[Risk] Google OAuth callback 時 sessionStorage 被清空（隱私模式 / 不同 tab）** → Mitigation: `consumeGenericReturnTo()` 回 null 時 fallback `/`，不 throw；使用者退回首頁算可接受降級。
- **[Risk] validator 漏某類 open redirect payload** → Mitigation: unit test 用 exhaustive 真相表（至少 12 個 case：合法 3、非法 9）；跑 `pnpm audit:ux-drift` 不負責此類，純 unit coverage。
- **[Risk] `/auth/login?redirect=<path>` 的 path 過長造成 URL 超限** → Mitigation: validator 限制 2048 chars；超過 → 回 null → fallback `/`。
- **[Risk] 使用者已登入狀態下直接打 `/auth/login` 行為模糊** → Mitigation: 先不特別處理（Non-Goal），等未來若成 UX 痛點再加 bounce-away；本 change 不擋。
- **[Trade-off] 拆分 `/` 與 `/auth/login` 後，所有 `DeleteAccountDialog.vue:99` 等 `navigateTo('/')` 會去 chat 頁而非 login 頁** → 符合預期（刪除帳號後 session 失效，`auth.global.ts` 會把他攔去 `/auth/login`）；不改這些呼叫點。

## Migration Plan

非 DB migration。Deploy 後立即生效，無需 feature flag：

1. Merge + `/commit` → patch bump（non-breaking user-facing refactor）
2. Deploy 前 smoke test：本 change Manual Review 全通過
3. Deploy 後驗證 5 條 journey（參考 proposal.md `## User Journeys`）
4. Rollback：revert commit + redeploy；無 DB 或 state 副作用

## Open Questions

- 是否該在本 change 一併為 `/auth/login` 已登入使用者加 bounce-away？（目前傾向 Non-Goal，等後續觀察）
- `parseSafeRedirect` 的 2048 chars 上限合理嗎？（Nuxt / Workers URL 實務上限通常夠用；若未來有超長 `redirect` path 再放寬）
