## Context

`passkey-authentication` spec §6.2 Scenario「Passkey-first user binds Google and email gets populated」是 v1.0.0 auth 模型的核心 journey 之一（passkey-first 使用者之後想升級為 Google-capable 帳號以接收 admin allowlist 升級）。目前 `/account/settings` 的 `handleLinkGoogle` 呼叫 `client.linkSocial({ provider: 'google' })`，走 better-auth `/api/auth/link-social` endpoint。

實機測試（2026-04-21）發現：passkey-first 使用者（`user.email = NULL`）點按鈕後，`/api/auth/link-social` 回 200 + 正確的 Google authorization URL，但 Google 導回 callback 時 better-auth 立即拒絕，log 顯示 `Failed to parse state: link.email expected string, received null`。

**根因定位**：`node_modules/better-auth/dist/api/routes/account.mjs` 約 line 148，`linkSocial` 在產出 OAuth state 時會把 `session.user.email` 寫進 state object 的 `link.email`，接著用 Zod schema 驗 `link.email: z.string()`；`null` 直接 parse fail，callback 判 state 無效 → 重導回 `?error=please_restart_the_process`。此 Zod schema 在 better-auth core 寫死，`allowDifferentEmails: true` / account linking config 都在 parse **之後**才生效，無法繞過。

無法透過 upgrade better-auth 解決（目前版本是最新 stable，且此為故意設計，issue tracker 上的等價 PR 未被 merge）。monkey-patch core 會被下次 `pnpm install` 洗掉，且違反 `.claude/rules/scope-discipline.md`。

**唯一可行路徑**：自建 OAuth endpoint pair，重用 Google OAuth client 設定，但 state 管理 + token exchange + account row 寫入全部自己處理。better-auth 仍管其他路徑（Google-first login、Google-first 加綁 passkey、既有 session middleware），不動。

**前置條件**：TD-011 migration 0010（FK cascade repair）必須先落地到 prod；否則綁定過程若觸發 session refresh 寫入 audit tombstone 可能踩到舊 FK constraint。

## Goals / Non-Goals

**Goals:**

1. passkey-first 使用者在 `/account/settings` 點「綁定 Google 帳號」能走完 OAuth flow，成功後 `user.email` 填入、`account` 表 Google row 建立、passkey row 保留。
2. 綁定成功後，下一次 session refresh 由既有 `databaseHooks.session.create.before` reconciliation 自動套用 allowlist 升級（不在本 change 重寫 reconciliation 邏輯）。
3. OAuth state 抗 CSRF（cookie + KV 雙層比對 + TTL）、抗 replay（one-time KV key 用完即刪）。
4. email collision（Google email 已屬其他 `user.id`）回 HTTP 409 `EMAIL_ALREADY_LINKED`，UI 以 toast 明確告知。
5. Token exchange / id_token 解析 / DB 寫入任一失敗皆以使用者可讀訊息回報，不洩漏內部細節（遵守 `error-handling.md`）。

**Non-Goals:**

- 不修改 better-auth core，不做 monkey-patch。
- 不處理 Google-first → 加綁 passkey（§6.1 由 better-auth passkey plugin 原生支援，已運作）。
- 不引入 PKCE（confidential client + server-side secret + one-time KV state 已足夠；未來若移到 public client 再評估）。
- 不支援多個 Google account 綁同一 user.id（一個 `user.id` 在 `account` 表最多一個 `providerId='google'` row）。
- 不處理 Google account unlink / 換綁。
- 不改動 `session.create.before` reconciliation 或 `ADMIN_EMAIL_ALLOWLIST` 機制。
- 不為此 flow 新增 D1 migration（只動 `user` / `account` 表現有欄位）。

## Decisions

### OAuth State 儲存：Cookie + KV 雙層

**選型**：state token 產生時同時寫 HttpOnly cookie（`__Host-oauth-link-state`）與 KV entry（key `oauth-link-state:<token>`），TTL 600s。Callback 必須 cookie + KV 兩邊都比對通過才繼續。

**Alternatives considered**:

- **純 cookie（signed JWT）**：state 完全在 client，省一次 KV 讀。**拒絕**：無法 one-time revoke，replay 風險高；且 JWT sign key 管理成本超過 KV 讀一次。
- **純 KV**：省 cookie。**拒絕**：無法在 callback 驗 issuer browser（CSRF 風險），cookie 的 SameSite 保護要保留。
- **D1 table**：專屬 `oauth_link_state` 表。**拒絕**：需要 migration + TTL cleanup cron（目前 KV 原生支援 TTL），成本不划算。

**Rationale**：KV 原生 TTL 自動清理，cookie 綁 browser session 阻擋跨站 forgery。double-check 讓任一層洩漏都無法單獨利用。

### State Payload 結構

**Decision**：state token 是 random 32-byte base64url string（`crypto.getRandomValues`），不含語意。KV value 是 JSON：

```json
{
  "userId": "<session.user.id>",
  "nonce": "<token>",
  "createdAt": "<iso8601>",
  "redirectOrigin": "<request origin>"
}
```

Callback 時：

1. 讀 cookie `__Host-oauth-link-state` → 比對 URL `?state=` 參數（防 CSRF）
2. 讀 KV `oauth-link-state:<state>` → 存在才繼續（防 replay、防過期）
3. 比對 KV `userId` ↔ 當下 `session.user.id`（防跨 session 劫持）
4. 讀到後**立即**刪 KV key（one-time use）

**Alternatives considered**:

- **把 userId 塞進 cookie**：省一次 KV 讀。**拒絕**：cookie 可能被 XSS 讀到（雖然 HttpOnly，保守起見），KV 作為 authoritative source 更安全。

### id_token 驗證策略

**Decision**：直接 fetch Google token endpoint 以 `grant_type=authorization_code` 交換 access_token + id_token，取得 id_token 後**解 JWT payload**取 `email` / `email_verified` / `name` / `picture`，**不做**完整 JWT signature 驗證。

**Rationale**：id_token 從 Google token endpoint 直接回傳（TLS + client_secret 驗證過），不是由 user agent 轉手。Google 的 docs 明文此情境可省 signature 驗證（「If you get your ID token directly from Google via HTTPS... it's unnecessary to validate the signature」）。我們仍檢 `iss === 'https://accounts.google.com'` 和 `aud === NUXT_OAUTH_GOOGLE_CLIENT_ID` 作為 defense in depth。

**Additional check**：若 `email_verified !== true` → 回 400 `EMAIL_NOT_VERIFIED`，不寫入 DB。

**Alternatives considered**:

- **完整 signature 驗證（fetch JWKS + RS256 verify）**：多一次 HTTP、額外 `jose` 或 Web Crypto code。**拒絕**：在 confidential client + 直接 token endpoint 場景 overkill。
- **改呼叫 Google `userinfo` endpoint 取 email**：避開 id_token 解析。**拒絕**：多一次 HTTP round-trip，延遲增加 200–500ms，無額外安全性。

### Email Collision 檢測

**Decision**：token exchange 成功後、寫 DB 前，執行：

```sql
SELECT id FROM "user" WHERE email = ? AND id != ? LIMIT 1
```

若有 row → 立即中止 flow、刪 KV state、回 HTTP 409 `EMAIL_ALREADY_LINKED`。**不**寫入任何 DB 資料。

**UX**：callback 不 redirect 回 settings 帶 query，而是 redirect `/account/settings?linkError=EMAIL_ALREADY_LINKED`；settings.vue `onMounted` watch query 並顯示 error toast（文案：「此 Google 帳號（<email>）已綁定於另一組帳號。請改用 Google 登入該帳號後新增 Passkey。」）。

**Rationale**：與 better-auth 既有 §6.3 Scenario 的 409 行為對齊；使用者需要具體 email 才能判斷要切哪個帳號。

### DB 寫入：User UPDATE + Account INSERT 交易性

**Decision**：兩條 SQL 分開跑，若 `INSERT account` 失敗則**明確 rollback `user` 的 email 更新**（D1 不支援跨 connection transaction，但同一 handler 內可順序執行 + catch compensate）：

```typescript
// 1. UPDATE user SET email, image, updatedAt WHERE id = ?
// 2. try INSERT account (userId, providerId='google', accountId, accessToken, refreshToken, idToken, scope, createdAt, updatedAt)
//    catch → UPDATE user SET email=NULL, image=<previous> WHERE id = ?  (compensation)
```

**Rationale**：D1 的 batch API（`db.batch([...])`）可把兩條 statement 打包成一個 atomic 請求，優先使用；只有當某些欄位需要前一條結果時才 fallback 到手動 compensation。

**Decision refined**：使用 Drizzle 的 `db.batch([...])` 將兩個 statement 打包（D1 原生支援 batch 為 transaction）。若 batch 失敗 → 整體 rollback by D1，handler throw 500。

**Alternatives considered**:

- **先 INSERT account 再 UPDATE user**：insert 失敗 user 還沒變。**接受**：但 better-auth 的 schema expectation 是 email 在 user 上，先更新 user 讓 reconciliation 觸發更單純。最終採 batch 不用排序。
- **不做 compensation，accept 部分成功**：**拒絕**，會留下 inconsistent state（account row 存在但 user.email 仍 NULL），下次登入邏輯會困惑。

### Error Code 對照表

| 情境                                   | HTTP | Error code                | UI 文案                                                                               |
| -------------------------------------- | ---- | ------------------------- | ------------------------------------------------------------------------------------- |
| session 無 / email 非 NULL             | 400  | `INVALID_ENTRY_STATE`     | 此流程僅限 Passkey-only 帳號。                                                        |
| cookie ↔ URL state 不符 / cookie 缺失  | 401  | `STATE_MISMATCH`          | 連線已失效，請重試綁定。                                                              |
| KV state 查無 / 過期                   | 401  | `STATE_EXPIRED`           | 連線已過期，請重試綁定。                                                              |
| KV state.userId ≠ 當前 session.user.id | 401  | `SESSION_MISMATCH`        | 連線已失效，請重新登入後再試。                                                        |
| Google token endpoint 非 2xx           | 502  | `GOOGLE_TOKEN_EXCHANGE`   | 無法向 Google 驗證，請稍後再試。                                                      |
| id_token 解析失敗 / iss/aud 不符       | 502  | `GOOGLE_ID_TOKEN_INVALID` | Google 回傳資料無效，請重試。                                                         |
| `email_verified !== true`              | 400  | `EMAIL_NOT_VERIFIED`      | 此 Google 帳號尚未驗證 email，請先在 Google 驗證 email 後再綁定。                     |
| email 已綁至其他 user                  | 409  | `EMAIL_ALREADY_LINKED`    | 此 Google 帳號（<email>）已綁定於另一組帳號。請改用 Google 登入該帳號後新增 Passkey。 |
| D1 batch 失敗                          | 500  | `DB_WRITE_FAILED`         | 綁定失敗，請稍後再試。                                                                |

錯誤皆以 `createError({ statusCode, statusMessage: <code>, message: <UI 文案> })`，**NEVER** 帶 `data`。handler 內 log：400/401/409 不 `log.error`（預期分支），502/500 要 `log.error`。

### UI 分流策略

**Decision**：`app/pages/account/settings.vue` 的 `handleLinkGoogle`：

```
if (credentials.value?.email === null) {
  // passkey-first → 新 endpoint
  window.location.href = '/api/auth/account/link-google-for-passkey-first'
} else {
  // Google-first 加綁其他 Google（未來擴充）→ better-auth linkSocial
  await client.linkSocial({ provider: 'google' })
}
```

本 change 第二分支**暫時不會被觸發**（Google-first 已有 email，不需再綁）；留著是為未來 multi-Google 或 re-auth 場景。

同步**移除**：目前的 `isPasskeyFirst` disable condition 與 `useToast().add({ title: '開發中'... })`。

Callback 成功 → `/account/settings?linked=google`，settings.vue watch 此 query 顯示 success toast + 強制 `await refreshCredentials()`（重新從 `/api/auth/me/credentials` 取 `email` / `hasGoogle`）。

## Risks / Trade-offs

- **[Risk] Google Cloud Console redirect URI 未更新** → ops 必須先在 Google Cloud Console「Authorized redirect URIs」補 `<origin>/api/auth/account/link-google-for-passkey-first/callback`（每個環境一條，local / prod 分開），否則 OAuth 直接在 Google 端被拒。**Mitigation**：tasks.md 明列「ops 先行」task，deploy checklist 加檢查項；initial endpoint `GET` 會先檢查目標 redirect 是否 resolvable（無法自動驗，需人工 checklist）。

- **[Risk] better-auth 未來 upgrade 移除 Zod null block** → 我們自建 endpoint 就變冗餘。**Mitigation**：endpoint 內加明確註解指向 TD-012 與 better-auth PR 追蹤；若 better-auth 修掉，後續 change 可切回 `linkSocial` 並刪除自建 endpoint（視為可接受的暫時解）。

- **[Risk] KV eventual consistency** → KV write 後立即 read 在 Cloudflare edge 可能小機率 miss。**Mitigation**：state write 後先 redirect 到 Google（中間有使用者互動延遲，足夠 KV 同步）；callback 讀 miss 回 `STATE_EXPIRED` 使用者可重試。

- **[Risk] DB batch 失敗導致 user.email 留在不一致狀態** → **Mitigation**：採 D1 `db.batch([...])` atomic batch，原生 transaction。若真的失敗，handler throw 500 + `log.error`，ops 可從 log 追溯 user.id 手動修復。

- **[Trade-off] 每個綁定流程多一次 KV write + KV read + KV delete** → 額外 ~5–15ms latency。**接受**：綁定是 rare event（每 user 一次），額外延遲不影響 UX。

- **[Trade-off] 手動 fetch Google token endpoint 增加維護面** → 不走 better-auth adapter，Google API 若改版需要我們自己跟進。**接受**：Google OAuth token endpoint API 極穩定（v2 已多年），風險低。

- **[Trade-off] 不做 id_token signature 驗證** → 若 Google TLS 被 MITM 則理論可注入。**接受**：同場景 better-auth 也只做此層級驗證；TLS 破則 session cookie 也不安全。

## Migration Plan

1. 部署順序：TD-011 archive（migration 0010 prod apply）→ 本 change merge + deploy。
2. Ops 行動：Google Cloud Console 加新 redirect URI（local + prod），列入 deploy checklist。
3. Feature flag：**不加**（此 change 是 bug fix，不應 behind flag；原路徑已 broken，新路徑上線即 default）。
4. Rollback：若新 endpoint 上線後發現問題，revert PR；使用者端 UI 退回目前 disable + 「開發中」alert 狀態（無 data loss，因為不成功的綁定 KV state 600s 過期自動清，user/account 表未寫入）。

## Open Questions

- 是否要支援同一 session 多次嘗試綁定（例如第一次 email collision 後改登其他 Google）？目前設計允許無限重試（每次產生新 state token）；使用者體驗自然流暢。**決議**：允許，不設 rate limit，因為 collision 情境稀有。
- 是否要記錄失敗的綁定嘗試到 audit log？目前 §17.x 無此 audit event。**決議**：不加，保留現有 audit 範圍；`log.error` 已足夠 ops 追蹤。
