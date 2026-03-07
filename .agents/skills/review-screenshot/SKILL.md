---
name: review-screenshot
description: '截圖、看畫面、確認 UI、看一下頁面、幫我看 UI、review screenshot、跑檢查清單 — 統一截圖入口，派遣 screenshot-review agent（Sonnet）執行。'
---

# 截圖（統一入口）

所有截圖工作由 `screenshot-review` agent（Sonnet）執行。**MUST** 使用 spawn_agent 工具 派遣，不要在主 session 直接跑截圖命令。

工具選擇規則見 `.github/instructions/screenshot-strategy.md` — agent 會自行判斷，主 session 不需指定。

## 觸發時機

- 「截圖」「看畫面」「幫我看 UI」「看一下頁面」
- 「review screenshot」「跑檢查清單」「截圖檢查」
- UI 實作後確認、除錯截圖
- Spectra workflow 完成後視覺驗收

## 環境選擇（**優先 local dev，不要直接打 staging**）

本專案採 Google OAuth（better-auth）且 staging 為 client-side auth guard，**browser-use / playwright 無法自動化真實 OAuth 流程**。預設走 local dev server + dev-only bypass endpoint 建立 session：

### Local dev bypass（預設流程）

1. **確認 dev server 跑起來**：`pnpm dev`（port 3010，見 `package.json`）
2. **確認 env**：`.env` 需有 `NUXT_KNOWLEDGE_ENVIRONMENT=local`（或未設，預設即 local）+ `ADMIN_EMAIL_ALLOWLIST` + `BETTER_AUTH_SECRET`
3. **建立 admin session**（以 allowlist 中的 email）：

   ```bash
   curl -X POST http://localhost:3010/api/_dev/login \
     -H "Content-Type: application/json" \
     -d '{"email":"<email-in-allowlist>","password":"testpass123"}' \
     -c /tmp/admin-cookies.txt
   ```

4. **建立 non-admin session**（email **不在** allowlist，自動派 `role: 'user'`）：

   ```bash
   curl -X POST http://localhost:3010/api/_dev/login \
     -H "Content-Type: application/json" \
     -d '{"email":"member@test.local","password":"testpass123"}' \
     -c /tmp/user-cookies.txt
   ```

5. **browser-use 注入 cookie**：把 curl 拿到的 `Set-Cookie`（通常為 `better-auth.session_token=...`）注入 browser session，之後就能免 OAuth 瀏覽

### 何時才走 staging

- 驗證 **production-only 行為**（Cloudflare Workers binding、D1、KV、Config Snapshot 環境差異）
- 驗收「OAuth 真實流程」本身（很少）
- 走 staging 時 **MUST** 請使用者手動登入，不要 agent 自動化 OAuth

### 關鍵檔案

- Dev bypass endpoint：`server/api/_dev/login.post.ts`（guard：`runtimeConfig.knowledge?.environment === 'local'`）
- Admin allowlist：`ADMIN_EMAIL_ALLOWLIST` env var（逗號分隔 email）
- Role 派發邏輯：`server/auth.config.ts` 的 `session.create.before` hook

## 派遣方式

spawn_agent 工具，`agent_type: "screenshot-review"`。

### Ad-hoc 截圖

```
prompt: |
  截圖驗證以下頁面：
  1. /path/to/page — 頁面描述
  2. /path/to/page2 — 頁面描述
  Dev server port: <port>（若已知）
```

### Review 截圖（Spectra 人工檢查）

```
prompt: |
  針對 change `<change-name>` 的人工檢查清單逐項截圖驗證。
  環境：local dev（port 3010）；auth 走 /api/_dev/login bypass（見 SKILL.md 環境選擇段）。

  需要的身份：
  - admin session：curl POST /api/_dev/login 帶 <allowlist 內 email>
  - non-admin session：curl POST 帶 <非 allowlist email>（role 自動派 'user'）

  ## 人工檢查
  - [ ] #1 實際操作功能，確認 happy path 正常運作
  - [ ] #2 測試 edge case...
```

### 除錯截圖

```
prompt: |
  除錯截圖：頁面 /path 出現 [問題描述]，需要截圖確認目前狀態。
  Dev server port: <port>（若已知）
```

## 結果處理

Agent 回傳後，主 session 應：

1. 向使用者展示摘要表格（通過/需確認/有問題）
2. 列出需要人工確認的項目及截圖路徑
3. 報告檔位置：`screenshots/<env>/<語義>/review.md`（路徑規則見 rule）

## 注意事項

- Agent 使用 Sonnet 模型，節省 cost
- 主 session **不需要**自己跑截圖命令
- 主 session **不需要**決定用哪個工具 — agent 依 rule 判斷
