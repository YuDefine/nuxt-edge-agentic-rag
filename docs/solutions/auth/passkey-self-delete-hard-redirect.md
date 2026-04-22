---
title: Passkey 自刪後僅 soft navigate 會留下 stale auth 畫面，需 hard redirect
date: 2026-04-23
category: auth
tags:
  - better-auth
  - passkey
  - nuxt
  - auth-state
  - workaround
---

## Problem

passkey-only 使用者在 `/account/settings` 完成自刪後，server 端其實已經成功：

- `POST /api/auth/account/delete` 回 `200`
- `POST /api/auth/sign-out` 回 `200`
- `/api/auth/get-session` 回 `null`
- URL 也已切到 `/`

但畫面仍停留在舊的 `/account/settings` DOM，使用者看到的是已過期的帳號設定內容，而不是登入頁。

## What Didn't Work

- 只在 parent page 的 `@deleted` callback 呼叫 `navigateTo('/')`
- 在 dialog 內改用 `signOut({ onSuccess: async () => navigateTo('/', { replace: true }) })`
- 只驗 URL 與 session cookie；這兩者都正確時，SPA 畫面仍可能殘留

## Solution

這不是 backend delete 失敗，而是 **soft navigation 不足以清掉 stale auth atom / page state**。

針對「帳號已刪除、session 已作廢」這種不可逆情境，直接改成 hard redirect：

- 在刪除成功後維持 `signOut({ onSuccess })`
- `onSuccess` 內不要再只做 `navigateTo('/')`
- client 端直接 `window.location.replace('/')`
- 移除 parent page 額外的 `@deleted -> navigateTo('/')`，避免父子雙重 navigation race

這樣 browser 會整頁重載，Nuxt 重新 bootstrap 後自然以登出態渲染首頁，不再沿用已失效的 client state。

## Prevention

- 對「session 已失效」或「帳號已刪除」這類終局狀態，不要預設 SPA soft navigation 一定足夠
- 驗證登出 / 自刪流程時，同時檢查三件事：URL、`/api/auth/get-session`、最終畫面文案
- 若 URL 與 session 都正確但 DOM 仍舊，優先懷疑 client-side auth atom / cached page state，而不是回頭重查 DB
