## Why

`/` 目前同時承擔 landing page、登入頁、chat 容器、chat history fetch 起點四個角色，導致三個連動問題：

1. **`/login` 是假路由**（L1-5 只做 `navigateTo('/')`），真正登入 UI 在 `/pages/index.vue` 以 `v-if="!loggedIn"` 混合呈現，違反 Nuxt 慣例
2. **登入後不回原目標**：`app/middleware/auth.global.ts:9` 無條件 `navigateTo('/')` 不帶 `redirect`，使用者原本要打 `/admin/documents` 被迫從 `/` 重新找路
3. **未登入首頁立刻打 `/api/conversations` 回 401**：`app/pages/index.vue:119-125` 的 `watch({ immediate: true })` 不檢查 `loggedIn.value` 就跑 `refreshConversationHistory()`，導致未登入也觸發 chat history fetch → 401 → toast「無法更新對話列表」

根因都是 `/` 角色過載。拆分後 3 個症狀同時消失。

## What Changes

- **`/` 重定位為純 chat**：加入 `auth: true`、走 `chat` layout、移除 `v-if="!loggedIn"` 登入 UI 分支
- **`/login` 升級為獨立全頁**：保留 `auth: false`、走 `auth` layout、承接原 `index.vue` 的 Google + Passkey login UI 與 `PasskeyRegisterDialog`
- **`app/middleware/auth.global.ts` 未登入分支**：`navigateTo('/login?redirect=' + to.fullPath)`（不攔截 `to.path === '/login'` 避免迴圈）
- **`app/middleware/admin.ts` 未登入分支跟進**：改 `navigateTo('/login?redirect=' + to.fullPath)`；**無權限分支不動**（另開 change 處理）
- **新增 `app/utils/auth-return-to.ts`**：提供 `parseSafeRedirect(raw): string | null` validator + `saveGenericReturnTo(path)` / `consumeGenericReturnTo()` sessionStorage helper
- **改 `app/pages/auth/callback.vue`**：Google OAuth 回來時讀取順序為 `consumeMcpConnectorReturnTo()` → `consumeGenericReturnTo()` → `/`
- **`app/pages/index.vue` 清理**：移除 `watch(historyRefreshKey, ..., { immediate: true })` 對未登入狀態的防護缺口（拆分後 `/` 只剩已登入使用者，自動解）
- **MCP 流程零變更**：`app/pages/auth/mcp/authorize.vue` 與 `app/utils/mcp-connector-return-to.ts` 維持現狀（authorize.vue 是獨立登入容器，不經 `/login`）

## Non-Goals

- **Admin middleware 無權限分支的 UX 改善**：無權限 `isAdmin === false` 仍 redirect `/`，另開 `admin-unauthorized-feedback` change 處理（涉及 toast 設計或新 `/forbidden` 頁）
- **`/auth/mcp/authorize` 登入 UI 整併**：保留獨立容器，不強行統一到 `/login`（double-handshake 語義不同，統一會複雜化）
- **`?redirect=` allowlist prefix 策略**：採黑盒 validator（`startsWith('/') && !startsWith('//')`），不維護白名單
- **API 層 401 的 return-to 透傳**：純 client-side middleware 機制，不改 API 回應 shape
- **API handler 呼叫權限回傳調整**：`/api/conversations` 未登入回 401 行為不動（後端驗證應獨立於 UI redirect）

## Capabilities

### New Capabilities

- `auth-redirect`: Defines how unauthenticated navigation is captured, validated as safe, stashed across OAuth domain hops, and restored after successful login — for both Passkey (same-origin query param) and Google OAuth (sessionStorage bridge) flows, while preserving the existing MCP connector double-handshake.

### Modified Capabilities

- `web-chat-ui`: `/` page responsibility narrows from "public landing + login + chat" to "chat only (auth required)". Login UI moves to `/login`.

## Impact

- Affected specs: `auth-redirect` (new), `web-chat-ui` (modified)
- Affected code:
  - Modified:
    - app/middleware/auth.global.ts
    - app/middleware/admin.ts
    - app/pages/index.vue
    - app/pages/auth/login.vue
    - app/pages/auth/callback.vue
  - New:
    - app/utils/auth-return-to.ts
    - test/unit/auth-return-to.spec.ts
    - test/integration/auth-redirect-flow.spec.ts
  - Removed: (none)

## Affected Entity Matrix

### Entity: Unauthenticated Navigation Capture

| Dimension  | Values                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ |
| Surfaces   | `app/middleware/auth.global.ts` (global attempt), `app/middleware/admin.ts` (admin-scoped) |
| Roles      | Any unauthenticated visitor attempting an `auth: true` page                                |
| Actions    | Capture `to.fullPath` → redirect to `/login?redirect=<path>`                               |
| States     | valid path / unsafe path / already on `/login` (no recursion) / `/` root (no redirect qs)  |
| Validation | `startsWith('/') && !startsWith('//')` + non-`javascript:` prefix                          |

### Entity: Return-To Storage

| Dimension     | Values                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Surfaces      | `app/utils/auth-return-to.ts` (new generic), `app/utils/mcp-connector-return-to.ts` (existing MCP) |
| Keys          | `auth:return-to` (generic), `mcp-connector:return-to` (MCP) — distinct sessionStorage keys         |
| Consumers     | `app/pages/auth/login.vue` (set before Google OAuth), `app/pages/auth/callback.vue` (consume)      |
| Consume order | MCP first (non-null wins) → generic → fallback `/`                                                 |
| States        | set / peek / consume (destructive read) / clear                                                    |

### Entity: Login Surface Routing

| Dimension | Values                                                                                 |
| --------- | -------------------------------------------------------------------------------------- |
| Routes    | `/login` (new independent), `/` (redefined to chat), `/auth/mcp/authorize` (unchanged) |
| Layout    | `/login` → `auth`, `/` → `chat`, `/auth/mcp/authorize` → `auth`                        |
| auth meta | `/login` → `false`, `/` → `true` (via middleware), `/auth/mcp/authorize` → `false`     |
| Actions   | Passkey login / Google login / Passkey register                                        |
| States    | idle / google-loading / passkey-loading / register-open / error                        |

## User Journeys

### Generic page recovery (Google OAuth)

**Unauthenticated Admin attempts `/admin/documents`**:
`GET /admin/documents` → `auth.global.ts` sees `!loggedIn.value` + `to.meta.auth !== false` → `navigateTo('/login?redirect=/admin/documents')` → user clicks "使用 Google 帳號登入" → `saveGenericReturnTo('/admin/documents')` → Google OAuth → `/auth/callback` → `consumeMcpConnectorReturnTo()` returns null → `consumeGenericReturnTo()` returns `/admin/documents` → `navigateTo('/admin/documents', { replace: true })` → admin doc page loads.

### Generic page recovery (Passkey)

**Unauthenticated Member attempts `/account/settings`**:
`GET /account/settings` → middleware redirect → `/login?redirect=/account/settings` → user clicks "使用 Passkey 登入" → passkey completes same-origin → `fetchSession({ force: true })` → on success read `route.query.redirect` → `navigateTo('/account/settings', { replace: true })`.

### MCP connector first-time authorization (MUST NOT regress)

**Claude.ai connector first connect**:
`GET /auth/mcp/authorize?client_id=...&redirect_uri=claude.ai/...` → `authorize.vue` renders own login UI (does NOT go to `/login`) → user clicks Google → `saveMcpConnectorReturnTo('/auth/mcp/authorize?...')` → Google OAuth → `/auth/callback` → `consumeMcpConnectorReturnTo()` returns `/auth/mcp/authorize?...` (wins over generic because read first) → `navigateTo(mcpPath)` → back on `authorize.vue` now logged-in, approval UI renders → user approves → 302 back to `claude.ai/...`. **User must never stop on `/` or `/login`.**

### Open-redirect rejection

**Attacker crafts phishing URL**:
`GET /login?redirect=//evil.com` OR `?redirect=http://evil.com` OR `?redirect=javascript:alert(1)` → `parseSafeRedirect()` returns null → login-success navigation falls back to `/` → no external navigation occurs.

### Root page fallthrough

**Unauthenticated visitor types `/` directly**:
`GET /` → middleware sees `!loggedIn.value` → `to.fullPath === '/'` → `navigateTo('/login')` (no `redirect` qs appended since source IS `/`) → user sees clean login page.

### Authenticated user visits `/login`

**Already-authenticated user clicks bookmarked `/login`**:
Current scope: `/login` renders login UI regardless of session state (no bounce-away). Non-goal in this change; tracked if it becomes a UX ask.

## Implementation Risk Plan

- **Truth layer / invariants**: Three layers MUST stay in sync — (1) `auth.global.ts` / `admin.ts` redirect URL format, (2) `auth-return-to.ts` validator + storage helpers, (3) `callback.vue` consume order. Missing any one breaks Google OAuth flow silently (user loses origin path). MCP double-handshake is protected by distinct sessionStorage key — MUST NOT collide with generic key.
- **Review tier**: **Tier 3** — touches global auth middleware and OAuth callback flow; regression can lock out users or enable open-redirect phishing.
- **Contract / failure paths**: (a) `?redirect=null` / empty / non-string → ignored, fall to `/`. (b) unsafe redirect (external, `//`, `javascript:`) → `parseSafeRedirect` returns null → fall to `/`. (c) OAuth callback with both MCP and generic keys set (should not happen, but defensive) → MCP wins. (d) middleware called on `/login` path → NO redirect (avoid loop).
- **Test plan**: (1) **unit** — `parseSafeRedirect` exhaustive truth table (valid / `//` / `http:` / `javascript:` / null / empty / non-string) + `saveGenericReturnTo` round-trip. (2) **integration** — middleware redirect URL composition against various `to.fullPath` (including already-on-`/login` no-loop case) + callback consume-order priority (MCP wins, generic fallback, neither → `/`). (3) **manual journeys** — all 5 journeys above plus attacker payload. (4) **screenshot review** — `/login` independent page visual QA at xs/md/xl viewports. (5) **A11y** — `/login` keyboard tab order + aria labels (responsive-and-a11y-foundation spec alignment).
- **Artifact sync**: (a) `openspec/ROADMAP.md` `## Next Moves` — remove auth-redirect-refactor line if present. (b) `HANDOFF.md` In Progress #1 — remove after archive. (c) `docs/tech-debt.md` — no new TD entries expected (in-scope refactor, no deferrals). (d) `reports/latest.md` — update if main report describes `/` login flow (likely does — see responsive-and-a11y-foundation / web-chat-ui sections).
