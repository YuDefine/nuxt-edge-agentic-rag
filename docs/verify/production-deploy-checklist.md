# Production Deploy Checklist

> 此文件記錄目前 GitHub Actions 與 Cloudflare 的部署前置條件與執行步驟。現況為 local + production，另有已建立並可手動 dispatch 的 staging 部署路徑。

## 前置條件

### 1. GitHub Secrets 設定

在 GitHub Repository Settings > Secrets and variables > Actions 加入以下 secrets：

| Secret                   | 說明                        | 取得方式                                      |
| ------------------------ | --------------------------- | --------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | Cloudflare API Token        | Cloudflare Dashboard > API Tokens             |
| `CLOUDFLARE_ACCOUNT_ID`  | Cloudflare Account ID       | Cloudflare Dashboard > Overview               |
| `PROD_SITE_URL`          | Production site URL         | 例：`https://agentic.yudefine.com.tw`         |
| `STAGING_SITE_URL`       | Staging site URL            | 例：`https://agentic-staging.yudefine.com.tw` |
| `NUXT_PUBLIC_SENTRY_DSN` | Sentry 前端 DSN             | Sentry                                        |
| `SENTRY_AUTH_TOKEN`      | Sentry release upload token | Sentry                                        |
| `SENTRY_ORG`             | Sentry org slug             | Sentry                                        |
| `SENTRY_PROJECT`         | Sentry project slug         | Sentry                                        |
| `DISCORD_WEBHOOK_URL`    | Deploy 通知 webhook（可選） | Discord                                       |

> 目前 workflow 不會在每次 deploy 時從 GitHub Actions 同步 runtime secrets 到 Worker。`NUXT_SESSION_PASSWORD`、`BETTER_AUTH_SECRET`、OAuth secrets、R2 upload keys、`ADMIN_EMAIL_ALLOWLIST` 等 runtime secrets 應預先以 `wrangler secret put` 寫入各環境的 Worker secret store。

> 2026-04-22 補充：`nuxt.config.ts` 會在 build time 讀取 `NUXT_KNOWLEDGE_ENVIRONMENT`、`NUXT_KNOWLEDGE_FEATURE_PASSKEY`、`NUXT_PASSKEY_RP_ID`、`NUXT_PASSKEY_RP_NAME`。這四個值若只存在於 Worker runtime vars、沒有同時注入 GitHub Actions 的 build env，production artifact 會把 passkey UI gate 編成 `false`，且 `/api/auth/passkey/*` 路由不會註冊。

若 staging 需要前端直傳 R2，production / staging bucket 都要套用根目錄 `r2-cors.json`，並確認其中包含：

- `http://localhost:3010`
- `https://agentic.yudefine.com.tw`
- `https://agentic-staging.yudefine.com.tw`

### 1.1 `CLOUDFLARE_API_TOKEN` 最小權限

此 token 供 GitHub Actions 的 `wrangler-action` 使用，現行 workflow 只做兩件事：

1. `d1 migrations apply ... --remote`
2. `wrangler deploy`

建議最小權限如下：

| Scope 類型 | 權限                    | 用途                            |
| ---------- | ----------------------- | ------------------------------- |
| Account    | `Workers Scripts: Edit` | 部署 Worker                     |
| Account    | `D1: Edit`              | 套用 remote migration           |
| Zone       | `Workers Routes: Edit`  | 綁定 / 更新 custom domain route |
| Zone       | `Zone: Read`            | 讓 Wrangler 解析 zone 與 route  |

限制原則：

- Account resource 只選目前部署帳號
- Zone resource 只選 `yudefine.com.tw`
- **NEVER** 與 `CLOUDFLARE_API_TOKEN_ANALYTICS` 共用同一顆 token

### 2. Worker Runtime Secrets（預先管理，不走 GitHub Actions 同步）

以下 secrets 應直接存在 Worker secret store：

| Secret                                      | 說明                             |
| ------------------------------------------- | -------------------------------- |
| `NUXT_SESSION_PASSWORD`                     | Session 加密金鑰（≥32 字元）     |
| `BETTER_AUTH_SECRET`                        | Better Auth 加密金鑰（≥32 字元） |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID`               | Google OAuth Client ID           |
| `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`           | Google OAuth Client Secret       |
| `ADMIN_EMAIL_ALLOWLIST`                     | 管理員 Email（逗號分隔）         |
| `NUXT_PUBLIC_SITE_URL`                      | 該環境實際 site URL              |
| `NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID`         | Cloudflare Account ID            |
| `NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME`        | R2 Bucket 名稱                   |
| `NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID`      | R2 API Access Key ID             |
| `NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY`  | R2 API Secret                    |
| `NUXT_KNOWLEDGE_AUTO_RAG_API_TOKEN`         | AutoRAG / Workers AI token       |
| `NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON` | known connector allowlist        |

### 3. 目前 workflow 真實行為

現行 [deploy workflow](../../.github/workflows/deploy.yml) 的部署路徑如下：

1. 先跑 `ci` job：`pnpm format:check` → `pnpm run lint` → `pnpm typecheck` → `pnpm test`
2. 只有 `ci` 全綠才會進入 `deploy-production` 或 `deploy-staging`
3. production：對 `agentic-rag-db` 先跑 remote D1 migrations，再 build，再從 `.output/server` deploy
4. staging：對 `agentic-rag-db-staging` 先跑 remote D1 migrations，再 build，接著渲染 `.output/server/wrangler.staging.json`，最後 deploy

其中 build step 必須顯式帶入 `NUXT_KNOWLEDGE_ENVIRONMENT`、`NUXT_KNOWLEDGE_FEATURE_PASSKEY`、`NUXT_PASSKEY_RP_ID`、`NUXT_PASSKEY_RP_NAME` 與對應的非 secret binding vars；不可假設 `wrangler.jsonc` / `wrangler.staging.jsonc` 的 runtime vars 會自動反映到 `pnpm build`。

> 2026-04-22 更新：workflow 的 smoke test 已改為共用 `scripts/check-deploy-health.mjs`。若 GitHub runner 對 custom domain 收到 `403` 且判定為 Cloudflare WAF / Bot protection，job 會記 warning 並放行，不再把 deploy 本體誤判為失敗。

### 4. Cloudflare 資源設定

在 Cloudflare Dashboard 建立以下資源（如尚未建立）：

- [ ] **D1 Database**: 用於應用資料儲存
- [ ] **KV Namespace**: 用於 rate limiting
- [ ] **R2 Bucket**: 用於文件儲存
- [ ] **AI Gateway**（可選）: 用於 AI Search
- [ ] production / staging bucket 都已套用 `r2-cors.json`

### 5. Google OAuth 設定

在 Google Cloud Console：

- [ ] 建立 OAuth 2.0 Client ID（Web application 類型）
- [ ] production client 設定 Authorized redirect URIs：`https://<production-url>/api/auth/callback/google`
- [ ] production client 設定 Authorized JavaScript origins：`https://<production-url>`
- [ ] staging client 另外建立一組 OAuth credentials，設定 Authorized redirect URI：`https://<staging-url>/api/auth/callback/google`
- [ ] staging client 設定 Authorized JavaScript origin：`https://<staging-url>`

## 部署步驟

### 方法 A：透過 GitHub Actions（推薦）

1. Push 到 `main` branch，或
2. 到 GitHub Actions > Deploy > Run workflow
3. `target` 選 `production` 或 `staging`

### 方法 B：手動部署

```bash
# 1. Build
pnpm build

# 2. Deploy（需要設定環境變數）
cd .output/server
npx wrangler deploy
```

## 驗證步驟

部署完成後：

- [ ] 訪問 production URL，確認首頁載入
- [ ] 點擊 Google 登入，確認 OAuth 流程
- [ ] 以 allowlist 中的 email 登入，確認顯示「管理員」
- [ ] 訪問 `/api/health`（如有），確認 200 回應
- [ ] 若 GitHub Actions smoke test 只出現 runner 端 `403` warning，額外從人工網路環境做一次 canary

## 人工驗收命令（6.2 Manual Acceptance）

> 以下命令用於驗收 #1-#5 人工檢查項目

### 環境變數設定

```bash
# 設定 production URL
export BASE_URL="https://agentic.yudefine.com.tw"

# 從瀏覽器開發者工具取得登入後的 session cookie
export SESSION_COOKIE="better-auth.session_token=xxx"
```

### #1 登入與角色驗證

```bash
# 取得目前登入使用者資訊
curl -s "$BASE_URL/api/auth/session" \
  -H "Cookie: $SESSION_COOKIE" | jq .

# 預期：admin 帳號應看到 role: "admin"
```

### #2 文件上傳流程（presign → finalize → sync → publish）

```bash
# Step 1: Presign
curl -s -X POST "$BASE_URL/api/uploads/presign" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.md","contentType":"text/markdown","sizeBytes":100}' | jq .

# Step 2: 使用回傳的 presignedUrl 上傳檔案
# curl -X PUT "<presignedUrl>" -H "Content-Type: text/markdown" --data-binary "@test.md"

# Step 3: Finalize
curl -s -X POST "$BASE_URL/api/uploads/finalize" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"uploadId":"<uploadId>","checksum":"<checksum>"}' | jq .

# Step 4: Sync (觸發 AI Search 索引)
curl -s -X POST "$BASE_URL/api/documents/sync" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"documentId":"<documentId>"}' | jq .

# Step 5: Publish
curl -s -X POST "$BASE_URL/api/documents/<documentId>/versions/<versionId>/publish" \
  -H "Cookie: $SESSION_COOKIE" | jq .
```

### #3 版本切換驗證

```bash
# 上傳新版本後，確認問答只引用當前版本
curl -s -X POST "$BASE_URL/api/chat" \
  -H "Cookie: $SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"message":"<關於文件內容的問題>"}' | jq .

# 確認回應中的 citations 都指向當前版本的 versionId
```

### #4 MCP Token 權限驗證

```bash
# 建立測試用 MCP Token（需要 admin 權限）
# 1. 不含 knowledge.restricted.read scope
export MCP_TOKEN_LIMITED="<token without restricted scope>"

# 2. 含 knowledge.restricted.read scope
export MCP_TOKEN_FULL="<token with restricted scope>"

# 測試 searchKnowledge（應對 restricted 文件做 existence-hiding；JSON-RPC over /mcp）
curl -s -X POST "$BASE_URL/mcp" \
  -H "Authorization: Bearer $MCP_TOKEN_LIMITED" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"searchKnowledge","arguments":{"query":"restricted content"}}}' | jq .
# 預期：不應看到 restricted 文件

# 測試 getDocumentChunk（無權限應回 403；JSON-RPC over /mcp）
curl -s -X POST "$BASE_URL/mcp" \
  -H "Authorization: Bearer $MCP_TOKEN_LIMITED" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getDocumentChunk","arguments":{"citationId":"<restricted-citation-id>"}}}'
# 預期：403 Forbidden
```

### #4-B Remote MCP OAuth 驗證

```bash
# 1. 先確認 runtime 已配置 known connector client
echo "$NUXT_KNOWLEDGE_MCP_CONNECTOR_CLIENTS_JSON"

# 2. 已登入本地帳號後，在瀏覽器開啟：
# https://agentic.yudefine.com.tw/auth/mcp/authorize?client_id=claude-remote&redirect_uri=<connector-callback>&scope=knowledge.ask%20knowledge.search%20knowledge.category.list

# 3. 同意授權後，connector 以 code 打 token endpoint
curl -s -X POST "$BASE_URL/api/auth/mcp/token" \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "code": "<authorization-code>",
    "client_id": "claude-remote",
    "redirect_uri": "<connector-callback>"
  }' | jq .

# 預期：回 access_token / token_type=Bearer / expires_in / scope

# 4. 用 access token 打 /mcp
export MCP_OAUTH_TOKEN="<oauth access token>"

curl -s -X POST "$BASE_URL/mcp" \
  -H "Authorization: Bearer $MCP_OAUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"listCategories","arguments":{"includeCounts":true}}}' | jq .
```

預期：

- consent 頁顯示目前登入帳號與 requested scopes
- token exchange 成功
- `/mcp` 可用 OAuth access token 成功呼叫 browse-safe tools
- 若測試帳號為 guest，仍需符合 browse-only / no-access 規則

### #5 Audit Log 與 Rate Limit 驗證

```bash
# 查詢 query_logs（需要 D1 console 或 admin API）
# 確認 queryRedactedText 有正確遮罩

# 測試 rate limit（連續發送超過限制）
for i in {1..20}; do
  curl -s -X POST "$BASE_URL/api/chat" \
    -H "Cookie: $SESSION_COOKIE" \
    -H "Content-Type: application/json" \
    -d '{"message":"test"}' -o /dev/null -w "%{http_code}\n"
done
# 預期：超過限制後回傳 429
```

## Troubleshooting

### 常見問題

1. **503 Service Unavailable**
   - 檢查 D1/KV/R2 bindings 是否正確設定
   - 檢查 wrangler.toml 中的 binding 名稱是否與 nuxt.config.ts 一致

2. **OAuth redirect error**
   - 確認 Google OAuth redirect URI 設定正確

- 確認目標環境 Worker secret `NUXT_PUBLIC_SITE_URL` 與 GitHub Actions 對應的 `PROD_SITE_URL` / `STAGING_SITE_URL` 一致

3. **Admin access denied**
   - 確認 ADMIN_EMAIL_ALLOWLIST 包含你的 email
   - 確認 email 格式正確（小寫、無空格）

4. **Upload 失敗**
   - 確認 R2 API Token 有 read/write 權限
   - 確認 bucket 名稱正確
