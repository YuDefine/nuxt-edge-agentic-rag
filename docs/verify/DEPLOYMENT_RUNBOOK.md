# Deployment Runbook

> Operator-facing 日常部署手冊。對齊 `openspec/changes/deployment-manual/` 附錄 D-1（初次部署）+ D-2（日常部署）。緊急事故請改看 `DISASTER_RECOVERY_RUNBOOK.md`。既有 secrets / CI 設定速查請看 `production-deploy-checklist.md`。

## 0. 適用範圍

- **Target platform**：Cloudflare Workers（`nitro.preset: cloudflare_module`）
- **Production domain**：`agentic.yudefine.com.tw`（custom route 設於 `wrangler.jsonc`）
- **資源綁定**：D1 `DB` / R2 `BLOB` / KV `KV` / Workers AI `AI` / AutoRAG index `agentic-rag`
- **Environments**：
  - `local` — `.env` 驅動，`.data/` 目錄模擬 D1/KV/R2，`pnpm dev` 起 `http://localhost:3010`
  - `production` — 綁定上述 Cloudflare 資源，domain `agentic.yudefine.com.tw`
  - `staging` — 與 production 結構相同但 resource ID 不同，現已存在並綁定 `agentic-staging.yudefine.com.tw`（詳見 §2.6）
- **不涵蓋**：Local 開發環境啟動、business logic、retention cleanup 日常作業（見對應專屬文件）

## 1. 環境變數清單（Deploy 視角）

與 main report 表 2-25 互補——表 2-25 以 capability 分組，此表以「部署時需要設定在哪裡」分組。

### 1.1 Workers bindings（宣告於 `wrangler.jsonc`，不需 secret）

| 變數                              | 用途               | 值                |
| --------------------------------- | ------------------ | ----------------- |
| `NUXT_KNOWLEDGE_D1_DATABASE`      | D1 binding 名稱    | `DB`              |
| `NUXT_KNOWLEDGE_DOCUMENTS_BUCKET` | R2 binding 名稱    | `BLOB`            |
| `NUXT_KNOWLEDGE_RATE_LIMIT_KV`    | KV binding 名稱    | `KV`              |
| `NUXT_KNOWLEDGE_AI_SEARCH_INDEX`  | AutoRAG index name | `agentic-rag`     |
| `NUXT_KNOWLEDGE_ENVIRONMENT`      | Runtime 環境標記   | `production`      |
| `NUXT_PASSKEY_RP_ID`              | WebAuthn RP ID     | `yudefine.com.tw` |
| `NUXT_PASSKEY_RP_NAME`            | WebAuthn RP name   | `知識問答系統`    |

### 1.2 Cloudflare Token 分工

Cloudflare 相關 token 目前分成三類，不可混用：

| Token / Secret                      | 用途                                         | 建議最小權限                                                              | 使用位置               |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- | ---------------------- |
| `CLOUDFLARE_API_TOKEN`              | GitHub Actions deploy + remote D1 migrations | `Workers Scripts: Edit`、`D1: Edit`、`Workers Routes: Edit`、`Zone: Read` | GitHub Actions secret  |
| `CLOUDFLARE_API_TOKEN_ANALYTICS`    | 讀 AI Gateway / Analytics 資料               | `Account → Analytics → Read`                                              | Worker secret / `.env` |
| `NUXT_KNOWLEDGE_AUTO_RAG_API_TOKEN` | 寫入 AutoRAG / Workers AI 相關能力           | `Workers AI: Edit`                                                        | Worker secret          |

限制原則：

- `CLOUDFLARE_API_TOKEN` 的 Account resource 只選目前部署帳號
- `CLOUDFLARE_API_TOKEN` 的 Zone resource 只選 `yudefine.com.tw`
- `CLOUDFLARE_API_TOKEN_ANALYTICS` 必須是 read-only，**NEVER** 與 deploy token 共用
- AutoRAG token 只用於知識索引 / AI 路徑，不承擔 deploy 權限

### 1.3 Build-time（GitHub Secrets，注入 `pnpm build` 階段）

| 變數                     | 用途                  | 範例                              | Sensitivity |
| ------------------------ | --------------------- | --------------------------------- | ----------- |
| `NUXT_PUBLIC_SITE_URL`   | 前端 canonical URL    | `https://agentic.yudefine.com.tw` | low         |
| `NUXT_PUBLIC_SENTRY_DSN` | Sentry 前端錯誤上報   | `https://xxx@sentry.io/123`       | low         |
| `SENTRY_AUTH_TOKEN`      | Sentry release upload | `sntrys_...`                      | **high**    |
| `SENTRY_ORG`             | Sentry org slug       | `yuntech-project`                 | low         |
| `SENTRY_PROJECT`         | Sentry project slug   | `nuxt-edge-agentic-rag`           | low         |

### 1.4 Runtime secrets（以 `wrangler secret put` 預先管理）

| 變數                                       | 用途                            | Sensitivity |
| ------------------------------------------ | ------------------------------- | ----------- |
| `NUXT_SESSION_PASSWORD`                    | Session cookie 加密（≥32 字元） | **high**    |
| `BETTER_AUTH_SECRET`                       | Better Auth token（≥32 字元）   | **high**    |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID`              | Google OAuth client ID          | medium      |
| `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`          | Google OAuth client secret      | **high**    |
| `ADMIN_EMAIL_ALLOWLIST`                    | Admin email 清單（逗號分隔）    | medium      |
| `NUXT_KNOWLEDGE_AUTO_RAG_API_TOKEN`        | AutoRAG API token               | **high**    |
| `NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID`        | Cloudflare account ID           | low         |
| `NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME`       | R2 bucket name (pre-signing)    | low         |
| `NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID`     | R2 API access key               | **high**    |
| `NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY` | R2 API secret key               | **high**    |

現行 [deploy workflow](../../.github/workflows/deploy.yml) 已改為「runtime secrets 預先存在 Worker secret store，GitHub Actions 只負責 build + deploy」。因此上述 secrets 不建議再透過 `wrangler-action` 每次部署時覆寫。

### 1.5 Feature flags（Production 預設關閉；可由 `wrangler secret put` 或 `vars` 顯式覆寫）

| 變數                                     | 目前 production 值 | 說明                                                               |
| ---------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `NUXT_KNOWLEDGE_FEATURE_PASSKEY`         | `true`             | Passkey 登入（需要 `NUXT_PASSKEY_RP_ID` / `NUXT_PASSKEY_RP_NAME`） |
| `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION`     | `false`            | MCP session token（未來版本）                                      |
| `NUXT_KNOWLEDGE_FEATURE_CLOUD_FALLBACK`  | `false`            | 雲端 LLM fallback（未來版本）                                      |
| `NUXT_KNOWLEDGE_FEATURE_ADMIN_DASHBOARD` | `false`            | Admin dashboard 釋出門（governance）                               |
| `NUXT_ADMIN_DASHBOARD_ENABLED`           | `true`             | Admin dashboard feature gate（post-core）                          |
| `NUXT_DEBUG_SURFACE_ENABLED`             | `false`            | Production debug surface killswitch                                |

⚠️ `ADMIN_EMAIL_ALLOWLIST` 對外部同仁**敏感**（等於列出誰有管理權）。雖語意上不是 secret，實務上請透過 `wrangler secret` 設定而非 `vars`。

## 2. 初次部署（First-Time Deployment）

> 此節對應報告附錄 D-1。僅限當 Cloudflare account 尚未建立任何相關資源時執行。

### 2.1 先決條件

- Cloudflare account（Workers paid plan，需存取 AutoRAG）
- `wrangler` CLI 已登入：`pnpm exec wrangler login`
- `pnpm exec wrangler whoami` 顯示正確 account
- 若走 GitHub Actions，repo secrets 需至少包含：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`PROD_SITE_URL`，staging 另需 `STAGING_SITE_URL`
- Google Cloud OAuth client 已建立（見 §2.5）
- `node >= 22` + `pnpm >= 10.33`（對齊 `package.json` `packageManager`）
- 本 repo 已 clone、依賴已安裝：`pnpm install --frozen-lockfile`

### 2.2 建立 Cloudflare 資源

#### D1 Database

```bash
pnpm exec wrangler d1 create agentic-rag-db
```

複製輸出的 `database_id` 到 `wrangler.jsonc` 的 `d1_databases[0].database_id`。

```bash
# 確認
pnpm exec wrangler d1 list
```

#### R2 Bucket

```bash
pnpm exec wrangler r2 bucket create agentic-rag-documents
```

如需 CORS（前端 PUT pre-signed URL），套用專案根目錄的 `r2-cors.json`。目前該檔需同時允許：

- `http://localhost:3010`
- `https://agentic.yudefine.com.tw`
- `https://agentic-staging.yudefine.com.tw`

Production / staging bucket 都要各自套用一次：

```bash
pnpm exec wrangler r2 bucket cors set agentic-rag-documents --file=r2-cors.json
pnpm exec wrangler r2 bucket cors set agentic-rag-documents-staging --file=r2-cors.json
```

#### KV Namespace

```bash
pnpm exec wrangler kv namespace create "KV"
```

複製輸出的 `id` 到 `wrangler.jsonc` 的 `kv_namespaces[0].id`。

#### Workers AI / AutoRAG

1. Cloudflare Dashboard → AI → AutoRAG → **Create index**
2. Name：`agentic-rag`（必須與 `wrangler.jsonc` `vars.NUXT_KNOWLEDGE_AI_SEARCH_INDEX` 一致）
3. Source：`None`（我們用 server 端 API 手動 push documents）
4. Embedding model：依 `shared/schemas/knowledge-runtime.ts` 的預設（`@cf/baai/bge-m3`）
5. 建立 AutoRAG API token：Dashboard → My Profile → API Tokens → Create → 權限 `Workers AI: Edit`，複製到 `NUXT_KNOWLEDGE_AUTO_RAG_API_TOKEN` secret

### 2.3 Migration Apply

```bash
# 檢查 migration 檔
ls server/database/migrations/
# 應看到 0001_bootstrap_v1_core.sql ... 0005_query_logs_observability_fields.sql

# Apply 到 remote D1
pnpm exec wrangler d1 migrations apply agentic-rag-db --remote
```

**預期輸出**：每個 migration 顯示 `✓`，結尾 `<N> migrations applied successfully.`

**驗證**：

```bash
pnpm exec wrangler d1 execute agentic-rag-db --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

應看到 `users` / `documents` / `source_chunks` / `query_logs` / `citation_records` / `mcp_tokens` 等 v1.0.0 核心表。

### 2.4 Runtime Secrets

逐一設定：

```bash
# 隨機產生並設定 session password / auth secret
openssl rand -base64 32 | pnpm exec wrangler secret put NUXT_SESSION_PASSWORD
openssl rand -base64 32 | pnpm exec wrangler secret put BETTER_AUTH_SECRET

# OAuth（從 Google Cloud Console 取得）
echo "<google-client-id>" | pnpm exec wrangler secret put NUXT_OAUTH_GOOGLE_CLIENT_ID
echo "<google-client-secret>" | pnpm exec wrangler secret put NUXT_OAUTH_GOOGLE_CLIENT_SECRET

# Admin allowlist（逗號分隔，lowercase，無空格）
echo "charles@example.com,admin@example.com" | pnpm exec wrangler secret put ADMIN_EMAIL_ALLOWLIST

# R2 pre-sign credentials
echo "<account-id>"    | pnpm exec wrangler secret put NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID
echo "agentic-rag-documents" | pnpm exec wrangler secret put NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME
echo "<r2-access-key>" | pnpm exec wrangler secret put NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID
echo "<r2-secret-key>" | pnpm exec wrangler secret put NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY

# AutoRAG
echo "<auto-rag-token>" | pnpm exec wrangler secret put NUXT_KNOWLEDGE_AUTO_RAG_API_TOKEN
```

**驗證**：

```bash
pnpm exec wrangler secret list
```

應列出上述所有 secret 名稱（值為 `SHA256` 指紋，Cloudflare 不回傳明文）。

### 2.5 Google OAuth Client 設定

1. Google Cloud Console → APIs & Services → Credentials → **Create Credentials → OAuth 2.0 Client ID**
2. Application type：**Web application**
3. Authorized JavaScript origins：`https://agentic.yudefine.com.tw`
4. Authorized redirect URIs：`https://agentic.yudefine.com.tw/api/auth/callback/google`
5. 複製 Client ID / Secret 到 §2.4 的 secret

⚠️ Staging / 多環境時每個 domain 都要有自己的 redirect URI；**NEVER** 共用同一組 OAuth credentials 跨環境。

### 2.6 Staging 環境（optional，建議有）

若要建立 staging：

1. 複製一份 `wrangler.jsonc` → `wrangler.staging.jsonc`
2. 改 `name` 為 `nuxt-edge-agentic-rag-staging`
3. 改 `routes[0].pattern` 為 staging domain（如 `agentic-staging.yudefine.com.tw`）
4. 重跑 §2.2 / §2.3 建立 staging 專用 D1 / R2 / KV（資源名稱加 `-staging` 後綴）
5. 改 `d1_databases[0].database_id` 與 `kv_namespaces[0].id` 為 staging 資源 ID
6. staging Worker 的 runtime secrets 直接寫入 staging worker secret store；GitHub Actions 不使用 `STAGING_NUXT_SESSION_PASSWORD` 這類 prefix secrets 覆寫 runtime secrets
7. GitHub Actions 需具備 `STAGING_SITE_URL` 才能執行 `smoke-test-staging`

CI workflow 的 staging job 已存在於 [deploy workflow](../../.github/workflows/deploy.yml) 的 `deploy-staging` 區塊。2026-04-21 已實際建立 staging D1/KV/R2、staging Worker 與 custom domain，並驗證 `https://agentic-staging.yudefine.com.tw` 回 HTTP 200。

### 2.7 首次部署與煙霧測試

```bash
# 1. 本地先全綠
pnpm check      # format + lint + typecheck + vue components
pnpm test       # unit + integration

# 2. Build
pnpm build

# 3. Deploy
cd .output/server
pnpm exec wrangler deploy
cd -
```

若走 GitHub Actions，請注意 deploy job 前一定先經過 `ci` job；只要 `pnpm format:check`、`pnpm run lint`、`pnpm typecheck` 或 `pnpm test` 任一步失敗，production / staging deploy 都會被 skip。

**預期輸出**：

```
Deployed nuxt-edge-agentic-rag triggers (X sec)
  https://agentic.yudefine.com.tw (custom domain)
Current Version ID: <uuid>
```

**煙霧測試**：

```bash
# Health
curl -sf -w "HTTP %{http_code}\n" https://agentic.yudefine.com.tw/ -o /dev/null
# 期望：HTTP 200

# OAuth redirect
curl -sf -I https://agentic.yudefine.com.tw/api/auth/sign-in/social \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"provider":"google","callbackURL":"/"}'
# 期望：302 redirect 到 accounts.google.com

# Workers AI 基本通
pnpm exec wrangler ai models
# 期望：列出可用 model，含 @cf/baai/bge-m3
```

瀏覽器實測：

1. 打開 `https://agentic.yudefine.com.tw/`，首頁載入
2. 點 Google 登入，完成 OAuth
3. Admin email 登入後進 `/admin`，列表載入不 500

若以上都通過 → 初次部署完成。

## 3. 日常部署（Routine Deployment）

> 此節對應報告附錄 D-2。用於主幹合併後的標準 release 流程。

### 3.1 Pre-deploy checks

```bash
# 主幹最新
git fetch origin main
git checkout main
git pull --ff-only

# 驗證
pnpm install --frozen-lockfile
pnpm check          # format + lint + typecheck
pnpm test           # unit + integration
pnpm audit:ux-drift # exhaustiveness check
```

⛔ 任何 step 失敗 → 不部署。

### 3.2 Migration diff（若 `server/database/migrations/` 有新增）

```bash
# List remote migrations
pnpm exec wrangler d1 migrations list agentic-rag-db --remote

# Dry-run（用 --local 先跑 — 若 local 資料庫缺 schema 再用 --remote）
pnpm exec wrangler d1 migrations apply agentic-rag-db --local
```

⚠️ Migration 變更 = Tier 3 review（見 `.claude/rules/review-tiers.md`）。**NEVER** 在同一 PR 只改 migration 不改對應 RLS / API validation。

### 3.3 Deploy

**方法 A — GitHub Actions（推薦）**：

```bash
# 透過 tag 觸發
git tag v$(node -p "require('./package.json').version")
git push origin --tags
# 或走 workflow_dispatch：GitHub → Actions → Deploy → Run workflow
```

監看 Actions 執行：CI job 綠 → deploy job 綠 → smoke-test job 綠（若 GitHub runner 被 Cloudflare WAF 擋下會記 warning `403`，但不視為 deploy 失敗）→ notify 送出。

**方法 B — 手動（緊急 hotfix 或 CI 壞掉時）**：

```bash
pnpm build

# Migrations 先上（若有新檔）
pnpm exec wrangler d1 migrations apply agentic-rag-db --remote

# Deploy
cd .output/server
pnpm exec wrangler deploy
cd -
```

### 3.4 Post-deploy smoke test

```bash
# 取得當前 deployment ID（回滾參考用）
pnpm exec wrangler deployments list --name nuxt-edge-agentic-rag | head -5

# Health check（同 §2.7）
curl -sf -w "HTTP %{http_code}\n" https://agentic.yudefine.com.tw/ -o /dev/null

# Admin surface
SESSION_COOKIE="better-auth.session_token=<from-browser-devtools>"
curl -sf https://agentic.yudefine.com.tw/api/auth/session \
  -H "Cookie: $SESSION_COOKIE" | jq '.user.role'
# 期望：admin email → "admin"，其他 → "member" 或 "guest"
```

完整人工驗收指令見 `production-deploy-checklist.md` §「人工驗收命令」。

### 3.5 Tag 命名慣例

- `v<MAJOR>.<MINOR>.<PATCH>` — semantic versioning，對齊 `package.json`
- Hotfix → 只升 patch；新 feature → 升 minor；breaking → 升 major
- `/commit` skill 會在 commit 時自動升版號，release 只需 `pnpm tag` 或 git tag push
- Tag push 後 `.github/workflows/deploy.yml` 自動觸發

## 4. 定期巡檢（Weekly / Monthly）

### 4.1 Weekly

- [ ] 檢查 retention cleanup 正常執行（見 `RETENTION_CLEANUP_RUNBOOK.md` §4）
- [ ] 檢查 `wrangler tail` 是否有非預期 5xx
- [ ] 檢查 D1 storage 使用量：
  ```bash
  pnpm exec wrangler d1 info agentic-rag-db
  ```
- [ ] 檢查 R2 storage 使用量（Dashboard → R2 → agentic-rag-documents）

### 4.2 Monthly

- [ ] Secret rotation window check：`NUXT_SESSION_PASSWORD` / `BETTER_AUTH_SECRET` 建議每 90 天輪替
- [ ] OAuth client secret 在 Google Cloud Console 的到期設定檢查
- [ ] `ADMIN_EMAIL_ALLOWLIST` 與實際人員對帳（離職者移除）
- [ ] 檢查 AutoRAG 索引健康：Dashboard → AI → AutoRAG → `agentic-rag` → 文件總數 vs D1 `documents` 表的 `status='published'` 筆數

## 5. 常見錯誤與對策

### 5.1 `D1_ERROR: no such table`

**情境**：deploy 完畢 API 500，log 顯示 table 不存在。
**原因**：忘記 §3.2 migration apply，或 migration apply 成功但 code 改動的是 wrong D1 name。
**處置**：

```bash
pnpm exec wrangler d1 migrations apply agentic-rag-db --remote
```

若 migration 已是最新，檢查 `wrangler.jsonc` 的 `database_id` 是否指向正確 D1（`wrangler d1 list` 對照）。

### 5.2 `503 Service Unavailable` on all routes

**原因**：`wrangler.jsonc` 的 binding 名稱與 `nuxt.config.ts` 不一致。
**處置**：對照

- `wrangler.jsonc` 的 `binding` 欄位
- `nuxt.config.ts` 裡 `knowledgeRuntimeConfig.bindings.*` 讀取的 env var
- `vars.NUXT_KNOWLEDGE_D1_DATABASE=DB` 等預設
  三者必須指向同一個名稱。

### 5.3 OAuth `redirect_uri_mismatch`

**原因**：Google Cloud Console 設定的 redirect URI 與 production URL 不一致。
**處置**：回 §2.5 加入 `https://agentic.yudefine.com.tw/api/auth/callback/google`。

### 5.4 `pnpm build` cloudflare_module OOM

**原因**：Sourcemap 或 icon bundle 過大。
**處置**：

```bash
NODE_OPTIONS=--max-old-space-size=6144 pnpm build
```

`package.json` 預設 4096，CI workflow 也已用 4096；local 機器 RAM 夠就加到 6144 或 8192。

### 5.5 Cron trigger 未觸發

**原因**：`wrangler.jsonc` `triggers.crons` 與 `nuxt.config.ts` `nitro.scheduledTasks` 的 cron expression 不同步。
**處置**：見 `RETENTION_CLEANUP_RUNBOOK.md` §7。

## 6. 相關文件

- `DISASTER_RECOVERY_RUNBOOK.md` — 緊急事故與復原程序
- `production-deploy-checklist.md` — GitHub Secrets 清單 + 人工驗收指令
- `rollout-checklist.md` — Release 前的 functional checklist
- `RETENTION_CLEANUP_RUNBOOK.md` — Retention job 日常作業
- `ACCEPTANCE_RUNBOOK.md` — v1.0.0 各 capability 驗收清單
- `main-v0.0.43.md`（或最新版）附錄 D — 部署與災難復原正文
- `.github/workflows/deploy.yml` — CI 部署 workflow 範例
