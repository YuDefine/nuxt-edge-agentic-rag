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
| `NUXT_PUBLIC_SENTRY_DSN`                   | Sentry DSN（可選）               | Sentry Dashboard                     |

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
