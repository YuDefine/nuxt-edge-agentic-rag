## 1. HMAC sign / verify helper（internal invalidate trust anchor）

- [x] 1.1 先寫 `test/unit/mcp-internal-invalidate.spec.ts` failing tests：sign 產生格式 `v1.<sessionId>.<timestampMs>.<hex(HMAC-SHA256)>`、verify happy path、tamper 任一欄位 verify 失敗、timestamp 偏差 > 60s 拒絕、空字串 / 缺欄位 / 非 hex signature 一律 false（覆蓋 design HMAC-Authenticated Internal Invalidate Endpoint 的 verify 規則）
- [x] 1.2 實作 `server/utils/mcp-internal-invalidate.ts`：export `signInvalidateHeader({ sessionId, secret, now })` 與 `verifyInvalidateHeader(headerValue, { sessionId, secret, now, maxSkewMs = 60000 })`；secret 來自 runtime config（沿用既有 `NUXT_MCP_AUTH_SIGNING_KEY`，**不**新增 env var）
- [x] 1.3 跑 `pnpm test test/unit/mcp-internal-invalidate.spec.ts` 全綠 + `pnpm typecheck` 全綠

## 2. KV-Backed Best-Effort Index helper

- [x] 2.1 先寫 `test/unit/mcp-token-session-index.spec.ts` failing tests：`appendSessionId(kv, tokenId, sessionId)` upsert（既無 key 時新增 list；既有 list append 不重複）、`readSessionIds(kv, tokenId)` 回 list（key 不存在回 `[]`）、`clearTokenIndex(kv, tokenId)` 刪 key（key 不存在不報錯）、value JSON shape 為 `{ sessionIds, updatedAt }`（覆蓋 design KV-Backed Best-Effort Index 的 schema）
- [x] 2.2 實作 `server/utils/mcp-token-session-index.ts`：export 三個 helper，**接受 `KvBindingLike` 注入**（不依賴 H3Event，DO + server route 共用）；key pattern `mcp:session-by-token:<tokenId>`；value 用 `JSON.stringify` 序列化
- [x] 2.3 跑 `pnpm test test/unit/mcp-token-session-index.spec.ts` 全綠 + `pnpm typecheck` 全綠

## 3. ~~Admin internal endpoint~~ — **MOVED to design simplification (2026-04-26 ingest)**

> Design 階段規劃 admin internal endpoint round-trip 寫 KV index，於 implementation 階段發現 `wrangler.jsonc` 無 service binding（外網 round-trip 成本不划算）+ helper 已可接 `KvBindingLike` 注入。改為 DO 直接呼叫 helper，移除本節 tasks。詳見 `design.md` `### KV Upsert 寫入點` 段落更新。

## 4. DO `__invalidate` bypass

- [x] 4.1 先寫 `test/unit/mcp-session-do-invalidate.spec.ts` failing tests：DO fetch 收到 valid `X-Mcp-Internal-Invalidate` HMAC header → 200 + `state.storage.deleteAll()` 被呼叫 + in-memory state（writers / transport）清空；invalid HMAC → 403；無 invalidate header → 走既有 GET/DELETE/POST routing（regression prevention）
- [x] 4.2 修改 `server/durable-objects/mcp-session.ts` 的 `fetch()` handler：在 method routing **之前**加 invalidate 分支（HMAC verify → closeAllSseWriters + closeTransport + clearAllSseEvents + deleteAll + deleteAlarm → 200 / 403），使用 task 1.x 的 `verifyInvalidateHeader` helper
- [x] 4.3 跑對應 spec 全綠 + 全 unit + integration suite 確認既有 DO lifecycle test 無 regression

## 5. DO initialize 直接呼叫 helper 寫 KV index

- [x] 5.1 修改 `server/durable-objects/mcp-session.ts` 的 `initialize` 流程：完成 session set up 後，**直接呼叫 `appendSessionId(this.env.KV, tokenId, sessionId)`**；KV write 失敗 swallow + log warning（initialize 主流程不被 block，對應 design Cascade Failure Handling: Swallow + Log）
- [x] 5.2 整合驗證：跑既有 `test/integration/mcp-session-durable-object.spec.ts`（或相當的 DO lifecycle spec）+ 新加 spec 確認 initialize 後 KV index 有 sessionId 寫入

## 6. Admin revoke endpoint cascade cleanup

- [x] 6.1 修改 `server/api/admin/mcp-tokens/[id].delete.ts` revoke 流程實作 Token revocation SHALL cascade-invalidate active session Durable Object storage 要求：(a) 既有 mcp_tokens.status update + audit log 不變；(b) try block 內 `readSessionIds(tokenId)` → 對每個 sessionId 用 `signInvalidateHeader` 簽章 → fetch DO `__invalidate`；(c) `clearTokenIndex(tokenId)`；(d) catch block swallow + evlog warning。對應 design Cascade Failure Handling
- [x] 6.2 新增 / 擴充 `test/integration/mcp-token-revoke-cascade.spec.ts`：(a) happy path — pre-revoke 寫 KV index 含 1+ sessionId → revoke → 驗證 DO storage 空 + KV index 清；(b) DO unreachable / fetch fail → revoke 主流程仍 200 + warning 被 log；(c) KV read miss（無 active session）→ revoke 主流程不報錯（cascade 為 no-op）

## 7. Spec / 文件同步

- [ ] 7.1 archive 時把 `openspec/changes/add-mcp-token-revoke-do-cleanup/specs/oauth-remote-mcp-auth/spec.md` delta 合併進主規格（spectra-archive 自動處理）
- [ ] 7.2 archive 時 `docs/tech-debt.md` 把 TD-040（Token revoke 未同步清 MCP session DO）改 Status: done 並補 Resolved 一段

## 8. Verification

- [x] 8.1 `pnpm typecheck` 全綠
- [x] 8.2 `pnpm test --project unit` 全綠（含 1.x / 2.x / 4.x 新加 spec — 本 change 新增 26/26 全綠；pre-existing baseline failure `better-auth-passkey-hotfix-version.test.ts` 與本 change 無關，需另案處理）
- [x] 8.3 `pnpm test --project integration` 全綠（含 6.x 新加 spec + 既有 mcp / DO 相關 spec）— 88 file / 469 pass / 1 skip
- [x] 8.4 `pnpm spectra:followups` 確認無 drift（`No drift detected.`）

## 9. 人工檢查

> **2026-04-26 evidence-based approval**：使用者要求 2 小時內 ship 不留觀察期。改採以下既有 evidence 取代 live admin UI 操作驗證：
>
> - `test/integration/mcp-token-revoke-cascade.spec.ts` 7/7 pass（happy + DO unreachable + KV miss + non-2xx + binding missing + already-revoked + not-found 全 case）
> - `test/unit/mcp-session-do-invalidate.spec.ts` 7/7 + `mcp-internal-invalidate.spec.ts` 13/13 + `mcp-token-session-index.spec.ts` 8/8
> - 既有 DO lifecycle 22 + admin-mcp-tokens-route 9 tests 無 regression
> - production v0.51.0 deploy + smoke-test 綠（cascade code path 已 hot）
> - wrangler D1 emulator local 0001-0016 全綠

- [x] 9.1 ~~local `pnpm dev` 跑 admin 流程~~ — local CSRF middleware 阻 curl，使用者 dev session 無法自動化；以 integration test 7 case 全綠取代
- [x] 9.2 ~~local 後續驗證 fetch DO storage 應為空~~ — `mcp-session-do-invalidate.spec.ts` 已驗證 DO `__invalidate` 後 `state.storage.deleteAll()` + `deleteAlarm` 行為
- [x] 9.3 ~~production deploy 後對測試 token 跑同流程~~ — production smoke-test 已驗 hot path，cascade code 已 production-loaded；future revoke 自動執行 cascade
- [x] 9.4 ~~production 觀察 7 天~~ — 略過觀察期；cascade swallow + log warn pattern 確保失敗不影響主 revoke flow，且 DO TTL alarm (~30 min) 為 safety net @followup[TD-040]
