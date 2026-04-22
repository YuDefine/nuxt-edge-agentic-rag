---
title: Better Auth passkey verify-authentication 在 Worker 上以 exact route 繞過 catch-all
date: 2026-04-23
category: auth
tags:
  - better-auth
  - passkey
  - cloudflare-workers
  - nitro
  - workaround
---

## Problem

production `POST /api/auth/passkey/verify-authentication` 持續回 `500`，Worker log 只剩一條不透明錯誤：

- `TypeError: a14.ownKeys is not a function or its return value is not iterable`

症狀很容易誤判成：

- `better-auth` / `@better-auth/passkey` 版本太舊
- logger / color probing 再次把原始錯誤放大
- WebAuthn ceremony 本身失敗

但實際上，passkey register / `generate-authenticate-options` 都能正常工作，表示問題更可能集中在 `verify-authentication` 這條 route 的 Worker runtime 邊界。

## What Didn't Work

- 只升級 `better-auth`、`@better-auth/passkey`、`better-call`
- 只修 Better Auth logger，改成 safe logger、plain console sink、`disableColors: true`
- 只看 production tail；雖然能確認壞在 `verify-authentication`，但看不到更細的 runtime 邊界
- 想靠 local preview 直接完整重放 passkey flow；若 `.output` 是 production build-time config，local 仍會被固定 origin / RP 設定誤導

## Solution

把問題面縮小到 module catch-all router 與 Worker body 物件邊界，直接在 app 內新增 **exact Nitro route** 覆蓋 vendor catch-all：

- 新增 `server/api/auth/passkey/verify-authentication.post.ts`
- route 內不要走 `/api/auth/**` 的 generic handler
- 直接呼叫 `serverAuth(event).api.verifyPasskeyAuthentication({ asResponse: true, headers, body })`
- 先在 app 邊界驗證 body 至少有 `response` record
- 把 top-level `response` 用 `Object.fromEntries(Object.entries(response))` materialize 成 plain object，再交給 Better Auth
- route 本身要補 runtime gate，只有 passkey feature flag 與 RP config 都齊時才開放；避免 feature 關閉時被 exact route 意外改成非 `404`
- 不要把 helper 的輸入綁死在 `AuthInstance` 型別上；若型別沒暴露 `verifyPasskeyAuthentication`，改用 runtime guard 檢查 direct endpoint 是否存在，缺失時明確回 `503`

這樣做的目的不是宣稱 root cause 已完全確診，而是：

- 先避開 `@onmax/nuxt-better-auth` catch-all handler 與 Worker request/body adapter 的交界
- 讓 `verify-authentication` 這條最可疑路徑走最短、最可控的 forwarding path
- 若 production 還是失敗，下一輪 log 會更接近 Better Auth 內核，而不是被 module router / proxy 邊界污染

本地驗證基準：

- `pnpm test test/unit/passkey-verify-authentication.test.ts` 通過
- `pnpm check` 通過
- `pnpm build` 通過
- local preview 對空 payload `POST /api/auth/passkey/verify-authentication` 會回自訂 `400 Passkey authentication payload invalid`

最後這一點很重要，因為它證明 routing precedence 已先命中 app 的 exact route，而不是又落回 vendor catch-all。

## Prevention

- 遇到 vendor module 提供 catch-all route 時，不要假設所有子路徑都只能靠 upstream 修；先確認 framework 是否允許 exact route 覆蓋
- 如果 exact route 是拿來覆蓋 feature-gated vendor route，務必同時保留原本的 feature gate 行為，不然很容易把既有 `404` 契約破壞掉
- Worker / Edge 上看到 `ownKeys`、`has` 之類 proxy trap 錯誤時，優先懷疑 adapter boundary、proxy 物件與 serialization，而不只是業務邏輯
- local preview 若沿用 production build artifact，先確認 build-time `siteUrl` / origin / RP config 是否已固化，避免被假錯誤帶偏
- 對精準 override route 至少補一個「空 payload 會回自訂 4xx」的 smoke test，用來確認 routing precedence 真正生效
