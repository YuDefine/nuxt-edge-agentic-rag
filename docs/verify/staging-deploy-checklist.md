# Staging Deploy Checklist

> 此文件記錄 6.1b Deploy to Staging 的執行步驟。

## 前置條件

### 1. GitHub Secrets 設定

在 GitHub Repository Settings > Secrets and variables > Actions 加入以下 secrets：

| Secret                                     | 說明                             | 取得方式                             |
| ------------------------------------------ | -------------------------------- | ------------------------------------ |
| `CLOUDFLARE_API_TOKEN`                     | Cloudflare API Token             | Cloudflare Dashboard > API Tokens    |
| `CLOUDFLARE_ACCOUNT_ID`                    | Cloudflare Account ID            | Cloudflare Dashboard > Overview      |
| `NUXT_SESSION_PASSWORD`                    | Session 加密金鑰（≥32 字元）     | `openssl rand -base64 32`            |
| `BETTER_AUTH_SECRET`                       | Better Auth 加密金鑰（≥32 字元） | `openssl rand -base64 32`            |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID`              | Google OAuth Client ID           | Google Cloud Console                 |
| `NUXT_OAUTH_GOOGLE_CLIENT_SECRET`          | Google OAuth Client Secret       | Google Cloud Console                 |
| `ADMIN_EMAIL_ALLOWLIST`                    | 管理員 Email（逗號分隔）         | 例：`admin@example.com`              |
| `NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID`        | Cloudflare Account ID（同上）    | Cloudflare Dashboard                 |
| `NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME`       | R2 Bucket 名稱                   | Cloudflare R2 Dashboard              |
| `NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID`     | R2 API Token Access Key ID       | Cloudflare R2 > Manage R2 API Tokens |
| `NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY` | R2 API Token Secret              | Cloudflare R2 > Manage R2 API Tokens |
| `NUXT_PUBLIC_SITE_URL`                     | Staging site URL                 | 例：`https://staging.example.com`    |

### 2. 更新 deploy-staging.yml

編輯 `.github/workflows/deploy-staging.yml`，在 Deploy step 加入缺少的 secrets：

```yaml
- name: Deploy to Cloudflare Workers
  uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    workingDirectory: .output/server
    command: deploy
    secrets: |
      NUXT_SESSION_PASSWORD
      BETTER_AUTH_SECRET
      NUXT_OAUTH_GOOGLE_CLIENT_ID
      NUXT_OAUTH_GOOGLE_CLIENT_SECRET
      ADMIN_EMAIL_ALLOWLIST
      NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID
      NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME
      NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID
      NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY
  env:
    NUXT_SESSION_PASSWORD: ${{ secrets.NUXT_SESSION_PASSWORD }}
    BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
    NUXT_OAUTH_GOOGLE_CLIENT_ID: ${{ secrets.NUXT_OAUTH_GOOGLE_CLIENT_ID }}
    NUXT_OAUTH_GOOGLE_CLIENT_SECRET: ${{ secrets.NUXT_OAUTH_GOOGLE_CLIENT_SECRET }}
    ADMIN_EMAIL_ALLOWLIST: ${{ secrets.ADMIN_EMAIL_ALLOWLIST }}
    NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID: ${{ secrets.NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID }}
    NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME: ${{ secrets.NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME }}
    NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID: ${{ secrets.NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID }}
    NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY: ${{ secrets.NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY }}
```

### 3. Cloudflare 資源設定

在 Cloudflare Dashboard 建立以下資源（如尚未建立）：

- [ ] **D1 Database**: 用於應用資料儲存
- [ ] **KV Namespace**: 用於 rate limiting
- [ ] **R2 Bucket**: 用於文件儲存
- [ ] **AI Gateway**（可選）: 用於 AI Search

### 4. Google OAuth 設定

在 Google Cloud Console：

- [ ] 建立 OAuth 2.0 Client ID（Web application 類型）
- [ ] 設定 Authorized redirect URIs：`https://<staging-url>/api/auth/callback/google`
- [ ] 設定 Authorized JavaScript origins：`https://<staging-url>`

## 部署步驟

### 方法 A：透過 GitHub Actions（推薦）

1. Push 到 `main` branch，或
2. 到 GitHub Actions > Deploy Staging > Run workflow

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

- [ ] 訪問 staging URL，確認首頁載入
- [ ] 點擊 Google 登入，確認 OAuth 流程
- [ ] 以 allowlist 中的 email 登入，確認顯示「管理員」
- [ ] 訪問 `/api/health`（如有），確認 200 回應

## 人工驗收命令（6.2 Manual Acceptance）

> 以下命令用於驗收 #1-#5 人工檢查項目

### 環境變數設定

```bash
# 設定 staging URL
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

# 測試 searchKnowledge（應對 restricted 文件做 existence-hiding）
curl -s -X POST "$BASE_URL/api/mcp/search" \
  -H "Authorization: Bearer $MCP_TOKEN_LIMITED" \
  -H "Content-Type: application/json" \
  -d '{"query":"restricted content"}' | jq .
# 預期：不應看到 restricted 文件

# 測試 getDocumentChunk（無權限應回 403）
curl -s "$BASE_URL/api/mcp/chunks/<restricted-citation-id>" \
  -H "Authorization: Bearer $MCP_TOKEN_LIMITED"
# 預期：403 Forbidden
```

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
   - 確認 NUXT_PUBLIC_SITE_URL 設定正確

3. **Admin access denied**
   - 確認 ADMIN_EMAIL_ALLOWLIST 包含你的 email
   - 確認 email 格式正確（小寫、無空格）

4. **Upload 失敗**
   - 確認 R2 API Token 有 read/write 權限
   - 確認 bucket 名稱正確
