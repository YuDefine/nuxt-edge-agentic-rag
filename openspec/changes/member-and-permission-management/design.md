## Context

`v1.0.0` 既有認證模型以 `ADMIN_EMAIL_ALLOWLIST` 環境變數區分兩類使用者：Admin（白名單內）與「其他已登入者」（白名單外）。Admin 可管理文件與版本，其他使用者僅可問答。此模型有兩個問題：

1. **缺乏細粒度治理**：白名單外使用者無從區分「正式成員」與「臨時訪客」；無法表達「訪客登入後只能瀏覽、不能問答」這類治理政策。
2. **Admin 升降缺乏 UI 入口**：所有 Admin 身分變動必須透過修改 env var + 重啟服務，無法於 UI 執行，對中小企業 IT 運維過於僵硬。

improve.md B16 翻盤為 `v1.0.0` scope 擴張，Q1-Q5 五問釐清後確立三級角色（Admin/Member/Guest）+ 訪客單 dial + 開放註冊 + env var seed 的設計路線。本設計文件說明這些決策的技術落實。

既有相依：

- `better-auth` with Google OAuth 已整合於 `server/api/auth/**`
- `ADMIN_EMAIL_ALLOWLIST` 透過 `useRuntimeConfig()` 注入
- D1 `users` 表已存在（欄位：`id`、`email`、`name`、`image_url`、`created_at`、`last_login_at`）
- `admin.global.ts` middleware 以 `requireAuth()` + allowlist 檢查作為 `/admin/*` 閘門

## Goals / Non-Goals

**Goals:**

- 以 `Admin / Member / Guest` 三級角色取代二元模型，使治理語義明確化。
- 訪客權限以單一 dial 控制（三值），避免多維權限矩陣的認知負擔。
- 開放註冊（OAuth 登入即建立 Guest），降低新使用者進入門檻；真正權限由 dial 與 Admin 升降決定。
- Admin 可透過 `/admin/members` UI 即時升降 Member 身分，變更立即生效（不需重啟）。
- `ADMIN_EMAIL_ALLOWLIST` 作為 Admin seed 的唯一真相來源；UI 不可升 / 降 Admin，避免權限越界。
- Web `/chat` 與 MCP tools 入口檢查 role × `guest_policy`，違反時回傳具使用者訊息的錯誤（不退化為 404 / 靜默失敗）。
- 成員角色變更寫入 audit log，使治理操作可稽核。

**Non-Goals:**

- 不支援 Member 邀請其他 Member（升降僅 Admin 操作）。
- 不引入 per-category ACL（Q4=I）；`restricted` 仍由 `documents.sensitivity_level` 控制。
- 不實作 Passkey / MFA / SCIM 同步。
- 不在 v1.0.0 提供成員變更 audit log 的 UI 讀取頁面（資料表存在，UI 歸 admin-ui-post-core）。
- 不允許 Admin 自降為 Member（allowlist 是 Admin 唯一真相來源）。

## Decisions

### 角色枚舉與儲存方式

`users` 表新增 `role TEXT NOT NULL DEFAULT 'guest'`，enum 三值 `admin` / `member` / `guest`。每次 OAuth callback 寫入登入時比對 `ADMIN_EMAIL_ALLOWLIST`，若命中則 upsert `role = admin`；未命中者維持既有 role（新使用者預設為 `guest`）。

**為何用 enum 欄位而非 roles junction table**：v1.0.0 僅三值且互斥（同一人不會同時是 Admin 與 Member），junction table 會引入不必要的 JOIN 成本與「多角色合取」語義爭議。若後續需要多角色（如 `auditor`、`readonly`），再以 migration 升級為 junction table。

**為何 OAuth callback 執行 Admin seed 而非 migration seed**：allowlist 為 runtime env var，於 deploy 期間才確定；migration 時 env 不可用，只能在登入時比對。此作法亦支援「Admin 從 allowlist 移除後即自動降級為 Member」的語義（降級時機為下次登入）。

**考慮過的替代方案**：於 middleware 每次請求都比對 allowlist（等於無狀態 role 判斷）。被拒原因：（1）每次 D1 查詢成本高；（2）D1 `role` 欄位仍需存在以支援 Member / Guest 區分，無法完全避免狀態；（3）後續要支援「暫時停用 Admin」等細節時，狀態化欄位更彈性。

### Guest Policy dial 的儲存結構

新增 `system_settings` 表（單列 KV 結構）：

```sql
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL  -- user id of admin who changed it
);
```

初始化 `('guest_policy', 'same_as_member', <now>, 'system')`；Admin 於 `/admin/settings/guest-policy` 切換時呼叫 `POST /api/admin/settings/guest-policy` 更新。

**為何用 KV 而非獨立欄位表**：未來可能擴充其他系統設定（如 `default_sensitivity_level`、`rate_limit_per_guest`），KV 結構可避免 migration 膨脹。讀取時由 server 層快取（見下節）。

**為何不把設定放 env var**：env var 變更需 redeploy，而訪客政策需要 Admin 即時切換（如突發濫用事件下立刻改為 `no_access`）。

### Guest Policy 快取策略

Worker 實例啟動時讀取一次 `system_settings`，以 in-memory Map 快取；Admin 更新時同時寫入 D1 與 Cloudflare KV（通知所有實例 invalidate）。v1.0.0 採用「每次請求檢查 KV version stamp」的輕量作法：KV 儲存 `guest_policy:version` 遞增計數，每個 Worker 快取最後見過的 version；request 入口先讀 KV version（單次 KV read ~1ms），不符則重讀 D1。

**為何不接受「最多 60 秒延遲」的純本地快取**：訪客政策是治理動作，需即時生效；60 秒延遲對「立刻鎖住訪客」情境過慢。

**Trade-off**：每次請求多一次 KV read；相比 D1 read 仍便宜。可於 post-core 改為 Durable Object pub-sub 降低。

### 權限檢查的 server helper 設計

在 `server/utils/require-auth.ts` 擴充：

```ts
export async function requireRole(event: H3Event, role: 'admin' | 'member'): Promise<User> {
  const user = await requireAuth(event)
  if (role === 'admin' && user.role !== 'admin') {
    throw createError({ statusCode: 403, message: '需 Admin 權限' })
  }
  if (role === 'member' && user.role === 'guest') {
    // 需進一步檢查 guest_policy 是否允許 member-level 操作
    const policy = await getGuestPolicy(event)
    if (policy !== 'same_as_member') {
      throw createError({
        statusCode: 403,
        message: policy === 'browse_only' ? '訪客僅可瀏覽，無法提問' : '帳號待管理員審核',
      })
    }
  }
  return user
}
```

**為何把 `guest_policy` 檢查收斂到 `requireRole('member')`**：問答、引用查看、所有 member-level 動作共用相同判斷邏輯，helper 統一後避免散落各 endpoint 的漏檢。

### Admin 無法自降 Admin 的實作

`PATCH /api/admin/members/[userId]` 的 role 變更 API：

1. 呼叫端需為 Admin（`requireRole(event, 'admin')`）
2. 若目標 `userId === current user.id` 且新 role ≠ 'admin' → 403 「不可降低自己的 Admin 權限，請修改 ADMIN_EMAIL_ALLOWLIST env var」
3. 若目標 email 命中 allowlist 且新 role ≠ 'admin' → 403 「此使用者為 Admin seed，請先從 allowlist 移除」
4. 不允許升級任何人為 Admin（僅 allowlist seed 可）：若新 role === 'admin' 且目標未在 allowlist → 403

**為何不允許 UI 升 Admin**：Admin 權限涵蓋「改所有文件」「撤銷 token」「清除 query logs」等破壞性動作，必須有單一不可偽造真相來源（env var 需 deploy 權限）。UI 升 Admin 會讓 Admin 身分可由現有 Admin 任意擴散，喪失治理可追溯性。

### Audit trail 的寫入策略

`member_role_changes` 表：

```sql
CREATE TABLE member_role_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  changed_by TEXT NOT NULL,  -- admin user id or 'system' for allowlist seed
  reason TEXT,               -- optional admin 填寫
  created_at INTEGER NOT NULL
);
```

變更時機：（a）OAuth callback 中 allowlist seed upsert `admin`；（b）Admin 於 UI 升降 Member/Guest；（c）allowlist 移除 Admin 後下次登入自動降為 member（若曾為 Admin）。

**v1.0.0 僅寫入，不提供 UI 讀取**：UI 讀取由 admin-ui-post-core 統一處理（與 query_logs 歷史等同屬觀測類）。寫入由 server 完成已具稽核能力。

### OAuth callback 對 Guest 的建立流程

`server/api/auth/[...all].ts` 的 Google OAuth 成功回呼：

1. 以 email 查 `users` 表
2. 若不存在：建立 `users` 列，`role` 判斷順序：
   - email in `ADMIN_EMAIL_ALLOWLIST` → `role = 'admin'`，寫入 `member_role_changes('guest' → 'admin', 'system', 'allowlist-seed')`
   - 其他 → `role = 'guest'`
3. 若存在：比對 allowlist，若當前 role 與期望不符則 upsert + 寫 audit

**為何不在登入時就強制擋下未在 allowlist 的使用者**：Q3=B 開放註冊；任何 Google 帳號可登入，權限由 role × `guest_policy` 決定。這使得「訪客嘗試問答看看」情境可行。

### Web `/chat` 入口的 Guest 呈現

根據 `user.role × guest_policy` 在 Chat 頁呈現不同狀態：

| user.role | guest_policy     | Chat 呈現                                                    |
| --------- | ---------------- | ------------------------------------------------------------ |
| admin     | \*               | 完整 chat + Admin 導覽                                       |
| member    | \*               | 完整 chat                                                    |
| guest     | `same_as_member` | 完整 chat（與 Member 無差）                                  |
| guest     | `browse_only`    | Chat 頁顯示「訪客模式：僅可瀏覽公開文件」+ 禁用 input        |
| guest     | `no_access`      | 導向 `/account-pending` 頁面，顯示「帳號待審核」+ 聯絡管理員 |

**為何用「元件狀態分支」而非「middleware redirect」**：Chat UI 在 Guest 模式下仍要顯示文件清單（browse_only）或友善訊息（no_access），完全 redirect 會失去脈絡。Middleware 僅處理 `/admin/*`（Admin-only）與 `/account-pending`（顯式頁）。

### MCP tools 的權限檢查

MCP 使用者由 Bearer token 對應 `mcp_tokens.created_by` → `users`。入口檢查：

- `created_by` 對應 `users.role === 'admin' or 'member'` → 正常檢查 token scope
- `created_by` 對應 `users.role === 'guest'` → 依 `guest_policy`：
  - `same_as_member` → 與 Member 同
  - `browse_only` → 僅允許 `listCategories`、`searchKnowledge`、`getDocumentChunk`（公開文件），拒絕 `askKnowledge`（回 `403 GUEST_ASK_DISABLED`）
  - `no_access` → 所有 tools 回 `403 ACCOUNT_PENDING`

**MCP token 由 Guest 建立**：Q4/Q5 未明確，本設計暫定「Guest 不能建立 MCP token」（`/admin/mcp-tokens` 在 Guest 身分下不可見；後端 POST 拒絕）。此決定可於 propose review 調整。

## Risks / Trade-offs

- **[Risk] Admin 不小心將自己降為 Member** → 以 server-side 硬性檢查阻擋（Decision「Admin 無法自降」），UI 按鈕也條件式隱藏。Mitigation 雙層。
- **[Risk] `guest_policy` 變更後有快取延遲** → KV version stamp 每請求檢查；最壞一次請求延遲（< 1 秒）。可接受。
- **[Risk] 開放註冊導致垃圾帳號灌爆 `users` 表** → v1.0.0 依賴 Google OAuth 身分門檻 + Cloudflare 既有 WAF，不另做 captcha。若觀測到實際攻擊再補（列為 post-v1.0.0）。
- **[Risk] Admin 透過 D1 直接 UPDATE `users.role`** → 此為刻意允許的緊急後門（Admin 既然能改 env var，也能改 D1）。稽核由 `member_role_changes` 記錄變更時間與 `changed_by = 'db-direct'`（由 trigger 寫入；若 trigger 未設則此類變更無 audit，屬已知限制）。
- **[Trade-off] `system_settings` 表僅一列 KV 看起來過度設計** → 接受；為未來擴充預留，遷移成本低。
- **[Trade-off] MCP Guest 建立 token 被暫時禁用** → 若實際使用情境需要，可在 propose review 放寬。

## Migration Plan

1. **Schema migration**（一次 migration）：
   - `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'guest'`
   - `CREATE TABLE system_settings (...)` + seed `('guest_policy', 'same_as_member', ...)`
   - `CREATE TABLE member_role_changes (...)`
2. **首次部署後的 Admin seed**：現有 `users` 表中 email 命中 allowlist 者，執行一次性 script 升為 `admin` 並寫 audit。
3. **Deploy 順序**：
   - 先部署資料層 migration（不改 API 行為）
   - 再部署 API 層（`requireRole`、`/api/admin/members`、`/api/admin/settings/guest-policy`）
   - 最後部署 UI 層（`/admin/members`、`/admin/settings/guest-policy`、Chat Guest 狀態）
4. **Rollback**：
   - API / UI rollback 即時（wrangler deployments rollback）
   - Schema rollback 需手動：保留舊 `users` schema backup，若需 rollback 則 drop 新欄位 / 表；實務上保留 `role` 欄位但忽略即可（舊 code 不讀 role 不會報錯）
5. **Data backfill**：migration 時 `role DEFAULT 'guest'` 會把既有使用者設為 Guest；首次登入時 allowlist 比對會自動升 Admin。既有非 Admin 使用者需 Admin 於 UI 手動升為 Member，或 `guest_policy = same_as_member` 時無需升級（default 即已授與完整 Member 權限）。

## Open Questions

- **MCP Guest token 允許建立嗎？** 本設計暫定禁止；若使用者希望 Guest 也可建立 token（由 `guest_policy` 控制 tool 可用性），需調整 `/admin/mcp-tokens` 可見性。
- **`guest_policy` 變更是否需要「全域登出所有 Guest session」？** 本設計採「下次請求生效」；若需強制登出，需補 session invalidation 機制。
- **Admin UI 成員列表的排序與篩選預設**：建議按 `last_login_at` 降序、role 篩選預設「全部」；實作時可微調。
