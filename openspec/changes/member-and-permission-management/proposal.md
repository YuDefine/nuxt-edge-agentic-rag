## Why

`v1.0.0` 目前僅以 `ADMIN_EMAIL_ALLOWLIST` env var 區分 Admin 與「其他已登入使用者」兩類，缺乏明確的「成員 / 訪客」分層與第三方授權機制；這使得開放註冊情境下的訪客權限無法精細調整、Admin 也無法於 UI 直接將使用者升為 Member，治理面呈現為二元黑箱。improve.md B16 翻盤決策將成員與權限管理提升為 `v1.0.0` 範圍，確保核心閉環不僅能回答與引用，還能表達「誰能問、誰能看、誰能改」的完整身分契約。

## What Changes

- **三級角色分層**：定義 `Admin` / `Member` / `Guest` 三級角色，取代既有「Admin vs 非 Admin」二元模型。Admin 具備全部管理權；Member 具備完整 Web 問答權限；Guest 權限由可調 dial 決定。
- **開放註冊 → Guest**：Google OAuth 登入成功後不再以 allowlist 作為「允許登入」閘門，而是將未在 allowlist 上的使用者建立為 `Guest` 角色，使用者隨時可登入但初始權限受 dial 控制。
- **訪客權限 dial（單旋鈕）**：新增 `guest_policy` 系統設定，允許三值擇一：
  - `same_as_member`（預設）：Guest 與 Member 同權
  - `browse_only`：Guest 僅可瀏覽公開分類的已發布文件，不可提問
  - `no_access`：Guest 登入後僅見「帳號待審核」提示頁，不可存取任何功能
- **Admin UI 成員升降**：Admin 可於 `/admin/members` 將 Guest 升為 Member、或將 Member 降回 Guest；不可將他人升為或降為 Admin（Admin 身分僅由 `ADMIN_EMAIL_ALLOWLIST` env var seed 控制）。
- **D1 資料模型擴張**：`users` 表新增 `role` 欄位（enum: `admin` / `member` / `guest`），新增 `system_settings` 表存放 `guest_policy`。Admin seed 每次登入時由 allowlist 比對並 upsert `role = admin`。
- **Web 問答與 MCP 的權限閘**：Web `/chat` 與 MCP tools 在請求入口處加入 role × `guest_policy` 檢查，違反時回傳明確訊息（不退化為 404）。
- **不加入分類級 ACL**：Q4=I，不在 `v1.0.0` 引入 per-category ACL；所有分類對 Member/Admin 均可見，對 Guest 依 dial 決定。

## Non-Goals

- **不支援 Member 自行邀請其他 Member**：升降僅能由 Admin 操作；避免引入邀請碼、多層 invite graph 等治理複雜度。
- **不引入 per-category ACL / row-level security**：`restricted` scope 維持僅由文件本身的 `sensitivity_level` 控制，不加「此分類只有特定角色可見」的層級。
- **不實作 Passkey / MFA**：身分驗證維持單一 Google OAuth；Passkey 仍為 `features.passkey = false`（後續版本）。
- **不支援外部目錄同步**（Azure AD / Google Workspace SCIM）：allowlist 僅為靜態 env var 字串清單。
- **不在 v1.0.0 引入審計紀錄專用頁面**：role 變更會寫入 `query_logs` 以外的 audit 路徑（`member_role_changes` 表），但 UI 讀取歸於 admin-ui-post-core 範疇。
- **不處理 Admin 自降**：Admin 在 allowlist 上時不可於 UI 將自己降為 Member；保持 allowlist 是單一真相來源。

## Capabilities

### New Capabilities

- `member-and-permission-model`: D1 `users.role` 欄位、`system_settings.guest_policy`、Admin seed 機制、角色升降 audit 表與不變式。
- `guest-access-policy`: `guest_policy` dial 的三種值與對應 Web / MCP 入口行為；OAuth 回調時的 Guest 建立流程。
- `admin-member-management-ui`: `/admin/members` 成員列表、搜尋、升降按鈕、操作確認與錯誤狀態；`/admin/settings/guest-policy` dial 切換頁。

### Modified Capabilities

- `admin-document-management-ui`: 導覽新增「成員」「訪客政策」入口；`/admin/*` middleware 由單純 allowlist 檢查改為 role = admin 檢查。
- `web-chat-ui`: 問答入口依 `guest_policy` 呈現不同狀態（可問 / 僅瀏覽 / 待審核提示）；無權限時不得退化為 404 或靜默失敗。

## Impact

- **Affected specs**: `member-and-permission-model`（新）、`guest-access-policy`（新）、`admin-member-management-ui`（新）、`admin-document-management-ui`（delta，middleware 與導覽）、`web-chat-ui`（delta，權限閘與狀態呈現）
- **Affected code**:
  - `server/db/migrations/` — `users.role` 欄位、`system_settings` 表、`member_role_changes` 表
  - `server/api/auth/**` — OAuth callback 建立 Guest、Admin seed 邏輯
  - `server/utils/require-auth.ts` — `requireRole(role: 'admin' | 'member')` 與 `requireGuestPolicy()` helpers
  - `server/api/admin/members/**` — 成員列表、升降 API
  - `server/api/admin/settings/guest-policy.ts` — dial 讀寫 API
  - `server/api/chat/**`、`server/api/mcp/**` — 入口加入 role × policy 檢查
  - `app/pages/admin/members/index.vue` — 成員管理頁
  - `app/pages/admin/settings/guest-policy.vue` — dial 切換頁
  - `app/middleware/admin.global.ts` — 由 allowlist 檢查改為 role 檢查
  - `app/components/chat/GuestAccessGate.vue` — Guest 入口狀態呈現
  - `shared/types/auth.ts` — `Role` 與 `GuestPolicy` enum + Zod schema
- **Affected runtime config**:
  - env: 維持 `ADMIN_EMAIL_ALLOWLIST`（語義從「允許登入」改為「Admin seed」）
  - feature flags: 不新增；權限行為由 D1 `system_settings.guest_policy` 控制
- **Affected report sections**（落在後續新版 main-v0.0.40.md）：§2.2.1（資料模型，`users.role`、`system_settings`）、§2.4.1（治理模型，改為 RBAC）、§3.2.3（新增成員管理畫面、訪客政策畫面）、表 2-24（permissions 擴張）、表 4-1（A08 從「OAuth + allowlist」改為「OAuth + role 系統 + guest policy」）
