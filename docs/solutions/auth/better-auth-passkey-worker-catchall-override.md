---
title: Better Auth passkey verify-authentication 在 Worker 上以 exact route 與原生 Request forwarding 繞過 catch-all
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

把問題面縮小到 module catch-all router、Worker request/body adapter，以及 Better Auth session cookie cache 的 Worker-only 邊界，直接在 app 內新增 **exact Nitro route** 覆蓋 vendor catch-all：

- 新增 `server/api/auth/passkey/verify-authentication.post.ts`
- route 內不要走 `/api/auth/**` 的 generic handler
- 不要把 valid payload 原封不動丟回 module adapter；先在 app 邊界驗證 body 至少有 `response` record，並把 top-level `response` 用 `Object.fromEntries(Object.entries(response))` materialize 成 plain object
- 第一版可先直接呼叫 `serverAuth(event).api.verifyPasskeyAuthentication({ asResponse: true, headers, body })`，用來證明 exact route 已接管
- 若還想再縮短與 Better Auth 原生 contract 的距離，下一步改成建立乾淨的 `Request`，交給 `serverAuth(event).handler(new Request(...))`，保留原始 URL / cookie / origin / method
- 若 production 仍是 `500`，再往下讀 `better-auth` 原始碼：`verifyPasskeyAuthentication()` 的 `try` 內其實還包了 `setSessionCookie()`；在 Worker 上，`setSessionCookie -> setCookieCache -> filterOutputFields(structuredClone(session/user))` 很可能對 adapter proxy row 觸發 `ownKeys` trap
- 這種情況下，最小 workaround 是在 Better Auth config 顯式關掉 `session.cookieCache.enabled`，讓 verify-authentication 只寫 signed session token cookie，不再走 `structuredClone(...)` 的 cookie-cache 分支
- 先在 app 邊界驗證 body 至少有 `response` record
- route 本身要補 runtime gate，只有 passkey feature flag 與 RP config 都齊時才開放；避免 feature 關閉時被 exact route 意外改成非 `404`
- 不要把 helper 的輸入綁死在 `AuthInstance` 型別上；若型別沒暴露 direct endpoint，改用 runtime guard 檢查 `auth.handler` 是否存在，缺失時明確回 `503`
- 如果這條 helper 會被 Node Vitest project 直接 import，避免在 util 內放 `h3` 之類只在 Nuxt/Nitro runtime 慣常存在的 bare runtime import；錯誤包裝留在 route handler 做即可
- logger 端則要再保守一層：避免把 raw args 直接交給 Worker console，多參數輸出收斂成單字串、args serialization 再包一次 try/catch，免得 catch-path logging 自己又把原始錯誤放大成新的 `500`

這樣做的目的不是宣稱 root cause 已完全確診，而是：

- 先避開 `@onmax/nuxt-better-auth` catch-all handler 與 Worker request/body adapter 的交界
- 讓 `verify-authentication` 這條最可疑路徑走最短、最可控的 forwarding path
- 若 exact route 仍未解掉 `500`，不要停在 router 層；繼續往 `setSessionCookie` / cookie cache / adapter row shape 追，因為 Worker 的 proxy row 與 `structuredClone` 是另一條完全獨立的 crash 面
- 若 production 還是失敗，下一輪 log 會更接近 Better Auth 內核，而不是被 module router / proxy 邊界污染

本地驗證基準：

- `pnpm test test/unit/passkey-verify-authentication.test.ts` 通過
- `pnpm check` 通過
- `pnpm test:unit` 通過
- `pnpm build` 通過
- local preview 對空 payload `POST /api/auth/passkey/verify-authentication` 會回自訂 `400 Passkey authentication payload invalid`
- `pnpm check` / `pnpm test:unit` / `pnpm build` 全數通過

另一個重要結論是：如果 local preview 使用的是已固化 production origin 的 `.output` artifact，就算 `wrangler dev` 啟得來，也**不能**直接拿來驗完整 WebAuthn ceremony。這次在 `http://localhost:8790` 重放 passkey-first 註冊時，`verify-registration` 會因 `Unexpected registration response origin "http://localhost:8790", expected "http://agentic.yudefine.com.tw"` 失敗。這種情況下，local preview 仍適合驗 route precedence / startup，不適合拿來否定或肯定 passkey ceremony 本身。

最後這一點很重要，因為它證明 routing precedence 已先命中 app 的 exact route，而不是又落回 vendor catch-all。

## Prevention

- 遇到 vendor module 提供 catch-all route 時，不要假設所有子路徑都只能靠 upstream 修；先確認 framework 是否允許 exact route 覆蓋
- 如果 exact route 是拿來覆蓋 feature-gated vendor route，務必同時保留原本的 feature gate 行為，不然很容易把既有 `404` 契約破壞掉
- Worker / Edge 上看到 `ownKeys`、`has` 之類 proxy trap 錯誤時，優先懷疑 adapter boundary、proxy 物件與 serialization，而不只是業務邏輯
- 對 auth middleware / plugin 提供的 direct API 若仍不夠穩，優先嘗試回到其最原生的 `Request -> Response` contract；這通常比框架包裝後的 helper 更接近真實 runtime
- 如果錯誤只在 Worker live runtime 出現，記得往 cookie/session post-processing 看，不要只盯 WebAuthn verify 本體；`structuredClone(adapterRow)` 這種 crash 在 Node 測試常常不會重現
- 只在本地跑單一 spec 容易漏掉 CI 專案分層差異；這類 util 被 Node project 直接匯入時，要額外跑一次 `pnpm test:unit`
- local preview 若沿用 production build artifact，先確認 build-time `siteUrl` / origin / RP config 是否已固化，避免被假錯誤帶偏
- 對精準 override route 至少補一個「空 payload 會回自訂 4xx」的 smoke test，用來確認 routing precedence 真正生效
