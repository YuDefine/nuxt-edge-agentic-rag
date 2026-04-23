---
title: Admin 權限會在登入時依 allowlist reconciliation 降為 member，且 build-time allowlist 也要同步
date: 2026-04-23
category: auth
tags:
  - better-auth
  - allowlist
  - admin-role
  - cloudflare
  - deployment
---

## Problem

使用者回報 `charles.yudefine@gmail.com` 登入 production 後沒有成為 admin，直覺上容易先懷疑：

- Google OAuth profile 沒帶對 email
- 前端 admin UI 判斷錯誤
- `staging` 與 `production` 配到不同 allowlist

但這個專案的 admin 權限真相其實不在前端，而是在 auth hook 的 runtime `ADMIN_EMAIL_ALLOWLIST`。更麻煩的是，這個值同時影響 build-time auth config；如果只改 Worker secret、沒同步 build env，artifact 仍可能帶著舊 allowlist。

## What Didn't Work

- 只看前端是否顯示 admin 導覽；那只能看到結果，不能證明 root cause
- 只查 `wrangler secret list`；Cloudflare 只會回 secret 名稱，不會回傳 `ADMIN_EMAIL_ALLOWLIST` 明文內容
- 只看單一設定點（例如只看 top-level `wrangler.jsonc` 或只看一份 runbook）就推論 staging / production 真相

## Solution

先確認兩個真相來源：

1. **admin 權限真相**
   - `shared/schemas/knowledge-runtime.ts` 會先把 `ADMIN_EMAIL_ALLOWLIST` 做 trim + normalize
   - `server/auth.config.ts` 的 session reconciliation 會在**每次登入**重新比對 allowlist
   - 若目前 `currentRole === 'admin'` 但 email 已不在 allowlist，系統會自動降成 `member`，並寫 audit `reason = 'allowlist-removed'`
   - `nuxt.config.ts` 也會在 build 時讀 `process.env.ADMIN_EMAIL_ALLOWLIST`；若 deploy pipeline 沒把它注入 build env，artifact 可能直接編進空 allowlist

這次 production 實查的結果是：

- `user.email = 'charles.yudefine@gmail.com'`
- `user.role = 'member'`
- 最新 `member_role_changes` 為 `admin -> member`
- `reason = 'allowlist-removed'`
- 當下 production `role = 'admin'` 的 user 數為 `0`

所以 root cause 不是 UI，而是 **allowlist 沒有命中 `charles.yudefine@gmail.com`，登入時被 auth hook 自動降權**。

這次 repo 內還查到一個高風險漂移點：

- production deploy workflow 的 `Build` step 目前**沒有**注入 `ADMIN_EMAIL_ALLOWLIST`
- staging deploy workflow 的 `Build (staging)` step 原本也沒有對應的 allowlist mirror
- 但 `nuxt.config.ts` 會在 build 時讀這個值來建立 runtime config

因此實務上的修正不能只停在「改 Cloudflare Worker secret」。保險做法是：

1. 先修 production 的 `ADMIN_EMAIL_ALLOWLIST` 真相來源
2. 同步檢查對應環境的 GitHub Actions build env 是否也有帶到同一份 allowlist
3. 重新 deploy
4. 重新登入驗證角色

這次已落地的 repo 修正有三個：

1. `server/auth.config.ts` 與 `server/utils/knowledge-runtime.ts` 都改成優先吃 runtime config，若編譯進來的是空 allowlist，會 fallback 到 `process.env.ADMIN_EMAIL_ALLOWLIST`
2. `.github/workflows/deploy.yml` 的 production / staging build env 都補上 `ADMIN_EMAIL_ALLOWLIST`，分別對應 GitHub Actions secret `PROD_ADMIN_EMAIL_ALLOWLIST` / `STAGING_ADMIN_EMAIL_ALLOWLIST`
3. `docs/verify/*` 文件補上 build-time allowlist mirror 的操作要求，避免下次只改 Worker secret

## Prevention

- 遇到「某帳號突然不是 admin」時，先查 production D1 的 `user.role` 與 `member_role_changes.reason`，不要先猜前端 bug
- 把 `ADMIN_EMAIL_ALLOWLIST` 視為 runtime authority；修正後必須重新登入，因為 reconciliation 發生在 session 建立時
- 如果 `nuxt.config.ts` / `auth.config.ts` 在 build 時讀某個關鍵 env，就要確認 deploy workflow 的 build env 也有傳入；只改 Worker secret 不一定足夠
- 確認 staging / production 真相時，不要只看單一檔案；至少交叉檢查 workflow、wrangler 設定、實際 Cloudflare 資源與最近的 deploy history
