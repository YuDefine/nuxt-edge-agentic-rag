## Context

`upgrade-mcp-to-durable-objects`（archived）+ `wire-do-tool-dispatch`（archived）已把 MCP session 搬到 Durable Object。Token revoke 流程目前停在 `server/api/admin/mcp-tokens/[id].delete.ts`：(a) update `mcp_tokens.status = 'revoked'`、(b) 寫 audit log。被 revoke 的 token 若已建立 DO session，DO storage（含 message log / lastSeenAt / auth context snapshot）會留存到既有 idle TTL alarm（~30 分鐘）才被回收。

實際安全影響有限——middleware bearer-token 驗證會 401 擋下後續 MCP request——但治理上有兩個缺口：(1) revoke timestamp 與 DO storage 真正清空 timestamp 不對齊；(2) 「revoke 即時失效」的直覺語意被破壞。

關鍵限制：

- **不能改 mcp_tokens schema**（避免 D1 migration）→ 索引必須走 KV
- **不能在 DO 直接讀 mcp_tokens 表**（DO env 不一定能無痛 reach D1）→ 索引必須在 admin endpoint 端維護
- **DO `DELETE` 既有短路 405** 是 stateless fallback safety mechanism（防 Claude.ai re-init loop 回歸）→ invalidate 路徑必須是 internal-only bypass，不能影響外部 DELETE 行為
- **無 schema 變更 / 無 migration**（純 KV + code-level routing）

## Goals / Non-Goals

**Goals:**

- Admin revoke token 後，被 revoke token 對應的 DO session storage 在 5 秒內清空
- 既有 DO TTL alarm（~30 分鐘）保留為 safety net（KV 漏寫 / cascade cleanup 失敗 / DO offline 三種失敗皆兜底）
- HMAC 簽章保證 DO `__invalidate` endpoint 無法被外部呼叫
- Revoke 主流程（mcp_tokens.status / audit log）行為與時序完全不變
- 既有 GET/DELETE → 405 stateless fallback 不受影響

**Non-Goals:**

- 不改 mcp_tokens DB schema
- 不改 token-side bearer-token 驗證（middleware 401 path 已正確）
- 不採方案 1（mcp_tokens 表加 `active_session_ids` column）—— 寫 D1 在每次 DO initialize 太重
- 不暴露 invalidate endpoint 給外部（必須 HMAC + 內部 binding）
- 不移除 DO `DELETE → 405` 短路（保留 stateless fallback）
- 不調整 DO TTL alarm 時間設定

## Decisions

### KV-Backed Best-Effort Index

選用 KV 而非 D1 維護 token-to-session 索引：

```
key:    mcp:session-by-token:<tokenId>
value:  JSON.stringify({ sessionIds: ["uuid1", "uuid2", ...], updatedAt: <iso> })
ttl:    省略（revoke 時主動清；orphaned entry 由 DO TTL alarm + 後續 KV cleanup job 收尾）
```

**Why KV over D1**:

- DO `initialize` 時要 upsert sessionId list，KV `put` 在 Workers runtime 是 ~10ms p99，D1 write 是 ~50-100ms 且 contention 風險高
- token-to-session 是 ephemeral 關係（session 隨 TTL 過期），不需 D1 的 ACID 與 query 能力
- 容忍最終一致：本 index 是 cascade cleanup 的「best-effort」線索，DO TTL alarm 是 safety net

**Alternatives considered**:

- **方案 1：mcp_tokens 表加 `active_session_ids TEXT[]`** — 需 D1 migration、每次 initialize 寫 D1（throughput 高時 contention）；reject
- **方案 3：DO 自己反向訂閱 token revoke event** — 引入 pub/sub 額外 infrastructure；overkill
- **方案 4：不索引，revoke 時掃所有 DO** — DO namespace 不支援 list；不可行

### HMAC-Authenticated Internal Invalidate Endpoint

DO `fetch()` 加 internal-only bypass 路徑：

```ts
// inside DO fetch handler
const invalidateHeader = request.headers.get('X-MCP-Internal-Invalidate')
if (invalidateHeader) {
  if (!(await verifyInvalidateSignature(invalidateHeader, request, env))) {
    return new Response('forbidden', { status: 403 })
  }
  await this.state.storage.deleteAll()
  this.inMemoryState = null // or whatever the existing state container is
  return new Response('ok', { status: 200 })
}

// existing GET/DELETE → 405 short-circuit fallback unchanged below
```

Header value：`v1.<sessionId>.<timestampMs>.<hex(HMAC-SHA256(secret, sessionId|timestampMs))>`。

**Why HMAC over plain shared secret header**:

- Shared secret header 一旦洩漏（log / proxy）即永久可用
- HMAC 帶 timestamp + sessionId binding，replay 視窗短（驗證時拒絕 timestamp 偏差 > 60s 的請求）
- 既有 `MCP_AUTH_HMAC_SECRET` env var 已被 `wire-do-tool-dispatch` 用於 auth context forward，可重用同 secret（不增加 secret 管理面）

**Why 403 not 405**:

- 405 是 stateless fallback signal（client 應該停 retry）
- 403 明確區分「endpoint 存在但 internal-only」（將來若有 audit 需求易識別）

**Alternatives considered**:

- **無 HMAC，靠 Cloudflare service binding internal-only** — service binding 限制可繞，不夠 defense-in-depth
- **改用 mTLS** — Workers runtime mTLS 配置複雜，且本 endpoint 內部呼叫，HMAC 已足夠

### KV Upsert 寫入點：DO 直接呼叫 helper（不 round-trip）

DO 在 `initialize` 處理時，**直接** 呼叫 `appendSessionId(this.env.KV, tokenId, sessionId)` helper 寫 KV index：

```
DO initialize → 完成 session set up → appendSessionId(this.env.KV, tokenId, sessionId)
```

`mcp-token-session-index.ts` helper 接受 `KvBindingLike` 注入，不依賴 H3Event，因此可同時被 DO（拿 `this.env.KV`）與 server route（透過 `getRequiredKvBinding(event, ...)`）呼叫。

**Why direct over admin-endpoint round-trip**:

- 本 repo `wrangler.jsonc` **沒有 service binding** — DO `fetch back` to admin endpoint 等於走外網 round-trip（每次 initialize 多 ~50-100ms cold-startable HTTP），且 local dev 沒有 absolute URL 可用
- 「邏輯集中」目標已由 `mcp-token-session-index.ts` 達成（single helper module 同時被 DO + server route 呼叫），不需再加 endpoint 層
- 移除 endpoint = 移除一組 HMAC trust path（admin endpoint ↔ DO 雙向）+ 一個對外暴露的 internal-only path，attack surface 縮小

**Trade-off**: DO 與 server-route 共用同一份 KV write code；既有 `mcp-token-session-index` test suite 已涵蓋 happy / malformed / missing 三條路徑，DO + revoke endpoint 不需重複測 KV layer，只需 integration test 驗 end-to-end。

**Alternatives considered**:

- **Round-trip via admin endpoint**（原 design） — 在沒有 service binding 的情況下需走外網或新增 service binding 配置；額外的 HMAC + endpoint 表面與 helper module 集中邏輯重複；否決
- **Admin endpoint poll DO** — DO namespace 不支援 list；否決
- **Stateful KV 在 DO 內 module-level cache** — DO 已是 per-session instance，無 cache 需求；否決

> **Implementation note (2026-04-26)**: 原 design 規劃透過 admin internal endpoint round-trip，於 implementation 階段發現 `wrangler.jsonc` 無 service binding，且 helper 已可直接接 `KvBindingLike` injection — 簡化為直呼 helper。Tasks 3.x（admin internal endpoint）整段移除；spec delta 不受影響（spec requirement 是 token revocation cascade-invalidate，與 KV upsert 寫入路徑無關）。

### Cascade Failure Handling: Swallow + Log

Revoke endpoint 的 cascade cleanup 步驟 **不得 block 主流程**：

```
1. update mcp_tokens.status = 'revoked' + audit log（既有，不變）
2. try { read KV index → for each sessionId: fetch DO invalidate; clear KV entry } catch { log warning + continue }
3. return 200 to admin（revoke 主流程已成功）
```

**Why swallow**:

- KV / DO 暫時 unavailable 不該擋 revoke（admin 期望 revoke 即時生效）
- DO TTL alarm 仍是 safety net（最差情況 30 分鐘後自然清）
- 失敗時打 evlog warning + Sentry breadcrumb（observability layer 已建立），不靜默吞錯

**Trade-off**: 偶爾失敗時 storage 殘留最多 30 分鐘 → 接受，符合 best-effort 設計。

## Risks / Trade-offs

- **[Risk] KV index 與 DO state 不一致（漏寫 / 殘留）** → **Mitigation**: DO TTL alarm 兜底；新增 daily cleanup job（next change 補）對 KV index 做 sweep 清掉 orphaned entry（本 change scope 不含）
- **[Risk] HMAC secret 洩漏** → **Mitigation**: secret 來自 runtime config 不 hard-code；timestamp + sessionId binding 限縮 replay 視窗（60s）；evlog 任何 HMAC 驗證失敗
- **[Risk] cascade cleanup 與 active tool call race（revoke 中收到 in-flight request）** → **Mitigation**: 既有 token middleware 401 擋下；cleanup 後 storage 空 ≡ 正常 expire 同態，無 data corruption
- **[Risk] DO `__invalidate` 邏輯與既有 GET/DELETE 405 短路衝突** → **Mitigation**: invalidate 分支放在 405 短路之**前**判斷；新增 unit test 確認 405 短路對 GET / DELETE 仍正確（regression prevention）
- **[Risk] sessionId list 過大（單 token 大量 sessions）** → **Mitigation**: KV value 限制 25MB 不會撞，但 cascade cleanup 對長 list 會 O(N) fetch；list 超過 100 entry 時打 warning（observability hint，code-level 不限制）
- **[Trade-off] 多一次 KV write 在 initialize hot path 之外** → 接受，每 session 僅一次（~10ms）
- **[Trade-off] DO 與 admin endpoint round-trip** → 接受，initialize 不是 user-facing 即時操作

## Migration Plan

無 schema / 無 env var / 無 wrangler binding 變更。Deploy 路徑：

1. land code + tests → CI 全綠 → merge main
2. production deploy 後對一個測試 token 跑 admin revoke：
   - 先建一個 DO session（用此 token 呼叫一次 MCP tool）
   - 然後 admin revoke
   - wrangler tail 觀察：(a) admin endpoint cascade cleanup log；(b) DO `__invalidate` 收到並回 200；(c) 對該 sessionId 後續 fetch DO → 404
3. 觀察 7 天，confirm 無 regression（既有 token revoke flow 不受影響、無 HMAC verify failure 噪音、無 DO error spike）
4. archive 時 TD-040 改 done

Rollback：純 code revert，KV index 殘留 entry 由 DO TTL alarm 自然清；revoke 主流程不受影響。

## Open Questions

無。HMAC 重用既有 `MCP_AUTH_HMAC_SECRET`、KV-backed best-effort index、cascade swallow + log 三條決策都對齊既有 wire-do-tool-dispatch / DO infra pattern，無未決依賴。
