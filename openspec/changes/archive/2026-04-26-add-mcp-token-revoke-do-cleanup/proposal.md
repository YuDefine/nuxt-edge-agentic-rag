## Why

**TD-040** — 當 admin revoke 一組 MCP token 時，該 token 已建立的 `MCPSessionDurableObject` session **不會被立即清除**，僅依賴 DO idle TTL alarm（~30 分鐘）自然回收。

實際上 production 影響有限：middleware 的 bearer-token 驗證會 401 擋下後續 MCP request（token hash 對不上），所以使用者實際**無法**用舊 session 觸發 tool call。但仍有兩個治理面缺口：

1. **稽核紀錄與實際停機時間有差**：revoke timestamp 與 DO storage 真正清空的 timestamp 可能差 30 分鐘，audit log 與 DO 內部 state 不對齊
2. **DO storage 殘留**：被 revoke 的 token 對應 session 的 message log / lastSeenAt / auth context snapshot 等留在 DO 內最多 30 分鐘，不符合「revoke 即時失效」的直覺語意

`upgrade-mcp-to-durable-objects` Phase 4（已 archive）的 Task 4.6 已標記此為 follow-up，本 change 是配套的 cleanup capability。

## What Changes

- 新增 KV 索引 `mcp:session-by-token:<tokenId>` 記錄該 token 已建立的 sessionId list（每次 DO `initialize` 透過 admin-only 內部 endpoint 把新 sessionId append 進去）
- DO `MCPSessionDurableObject` 加 internal `__invalidate` bypass：對特定內部 fetch（帶 HMAC-signed `X-MCP-Internal-Invalidate` header）允許 `DELETE` 通過既有 `405` 短路，呼叫 `state.storage.deleteAll()` + 清 in-memory state
- `server/api/admin/mcp-tokens/[id].delete.ts` revoke 流程加 cascade cleanup 步驟：(a) 從 KV 讀 sessionId list；(b) 對每個 sessionId 透過 `env.MCP_SESSION.idFromName(sessionId).fetch(...)` 呼叫 DO invalidate endpoint；(c) 清 KV 索引 entry；(d) 既有 token revoke logic（mcp_tokens table update + audit log）不變
- 既有 DO idle TTL alarm（~30 分鐘）保留為 safety net（防 KV 索引漏寫 / cascade cleanup 失敗 / race condition）
- `oauth-remote-mcp-auth` spec 新增 Requirement：token revocation SHALL cascade-invalidate active session DO storage within bounded time
- Integration test 驗證：token revoke → 同 sessionId 後續 fetch DO → 404 / empty state

## Non-Goals

- **NEVER** 改 mcp_tokens DB schema 或既有 token revoke 主流程（status update + audit log 不動）
- **NEVER** 改 token-side bearer-token 驗證邏輯（middleware 401 path 已正確擋下無效 token）
- **NEVER** 引入新的 token-to-session sync 機制（不採方案 1 用 mcp_tokens 表加 `active_session_ids` column；用 KV 而非 DB 是因為 sync 頻率高 + 容忍最終一致 + 避免每次 initialize 寫 D1）
- **NEVER** 把 DO `__invalidate` endpoint 暴露給外部（必須 HMAC 簽章 + 內部 binding 才能呼叫）
- **NEVER** 改 DO TTL alarm 的 ~30 分鐘設定（保留為 safety net，與本 change 並存）
- **NEVER** 移除 既有 DO `DELETE → 405` 短路（保留 stateless fallback；只對 internal invalidate 開窗）

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `oauth-remote-mcp-auth`: 新增 token revocation cascade-invalidate active session DO storage 的要求（既有 token validation / authorization grant / lifecycle 行為不變）

## Affected Entity Matrix

### Entity: KV `mcp:session-by-token:<tokenId>`（新增 namespace key pattern）

| Dimension | Values                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Operation | upsert sessionId on DO initialize, read list on revoke, delete entry on revoke                                                     |
| Roles     | system (DO initialize via admin internal API), admin (revoke endpoint via existing flow)                                           |
| TTL       | match token expirationTtl 或省略（revoke 時主動清；過期 token 由 DO TTL alarm 收尾）                                               |
| Surfaces  | admin endpoint `mcp-tokens/[id].delete.ts`（read+delete）、DO `initialize`（upsert）、新內部 endpoint（DO sessionId 寫入 KV 入口） |

### Entity: `MCPSessionDurableObject` storage（既有 entity，新增一個 fetch path）

| Dimension     | Values                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| New action    | `__invalidate`（internal-only via HMAC header）→ `storage.deleteAll()` + 清 in-memory state                   |
| Auth          | HMAC signature on `X-MCP-Internal-Invalidate` header（key 來自既有 `MCP_AUTH_HMAC_SECRET` 或同等內部 secret） |
| State changes | invalidate 後 DO 進入「已清空」狀態；下次 initialize 視為新 session（既有 lifecycle 不變）                    |
| Surfaces      | DO `fetch()` handler（既有 GET/DELETE 405 短路上方加 internal bypass 分支）                                   |

## User Journeys

**No user-facing journey (admin/system flow，無 end-user UX 改動)**

理由：本 change 純粹改善 admin token revoke 操作的 cascade cleanup 行為。Admin UI 既有 revoke flow（按鈕 / confirmation / list refresh）完全不變，使用者體感是「revoke 後感覺更乾淨」（DO storage 立即清空），但 UI 層無新元件、無新 state、無新文案。End user（chat user / MCP client）不可感知（被 revoke 的 token 持有者本來就不該繼續操作）。

實際 admin 流程：

- **Admin** 開 `/admin/tokens` → 找到要 revoke 的 token → 點「Revoke」→ confirm dialog → 後端走 `mcp-tokens/[id].delete.ts` → cascade cleanup KV + DO → list refresh（既有 UX，無變化）

## Implementation Risk Plan

- **Truth layer / invariants**: KV `mcp:session-by-token:<tokenId>` 是 token-to-session 的 best-effort 索引（可能漏寫 / stale），不是 source of truth；DO TTL alarm 仍是最終 safety net。HMAC 簽章是 invalidate 唯一 trust anchor，secret 必須來自 runtime config，不可 hard-code。Token revoke 主流程（mcp_tokens.status / audit log）行為不變。
- **Review tier**: Tier 2 — 動 admin endpoint + DO routing + 引入新 KV namespace + HMAC 簽章流程，無 schema migration、無 auth/permission 邏輯變動，但跨多模組需 spectra-audit + code review。
- **Contract / failure paths**: (1) KV 讀失敗 → revoke 主流程不被 block（cascade cleanup 是 best-effort，DO TTL alarm 兜底）；(2) DO fetch 失敗（DO offline / 已自然 expire）→ swallow error + log warning，不影響 revoke 主流程；(3) HMAC 驗證失敗 → DO 回 403（不是 405），明確區分「invalid internal call」與「stateless GET/DELETE 短路」；(4) Race condition：revoke 與 active tool call 同時 → DO 可能在 cleanup 中收到 in-flight request，靠既有 token middleware 401 擋下，cleanup 後 storage 空 = 與正常 expire 同態。
- **Test plan**: Unit — KV index helper（upsert sessionId list / read list / delete entry）；HMAC sign/verify helper（happy path + tampering detection）；DO fetch dispatcher 對 `X-MCP-Internal-Invalidate` 的 routing。Integration — `test/integration/mcp-token-revoke-cascade.spec.ts` 模擬 revoke endpoint → fetch DO → assert storage empty + list cleared；token revoke 同 sessionId 後續 request 回 404 / empty。Manual evidence — local `pnpm dev` 跑 admin revoke flow，wrangler tail（或 evlog）觀察 DO invalidate 日誌；production deploy 後對一個測試 token 跑同流程驗證 storage 立即清空。
- **Artifact sync**: `openspec/specs/oauth-remote-mcp-auth/spec.md`（spec delta：加 cascade-invalidate requirement）；`docs/tech-debt.md`（archive 時 TD-040 改 done + Resolved）；無 migration、無 wrangler binding 變更（沿用既有 `KV` + `MCP_SESSION` binding）；無 env var 新增（`MCP_AUTH_HMAC_SECRET` 既有）；無 CHANGELOG（admin 內部 plumbing）。

## Impact

- Affected specs: `oauth-remote-mcp-auth`（Modified — 加 token revocation cascade-invalidate active session 要求）
- Affected code:
  - Modified: `server/api/admin/mcp-tokens/[id].delete.ts`、`server/durable-objects/mcp-session.ts`
  - New: `server/utils/mcp-token-session-index.ts`（KV 索引 helper：upsert / read / delete）、`server/utils/mcp-internal-invalidate.ts`（HMAC sign helper + DO 端 verify helper，可與 mcp-internal-invalidate 同檔）、`test/integration/mcp-token-revoke-cascade.spec.ts`、`test/unit/mcp-token-session-index.spec.ts`、`test/unit/mcp-internal-invalidate.spec.ts`
  - Removed: (none)
- Dependencies / bindings: 無新 wrangler binding（沿用既有 `KV` + `MCP_SESSION`）；無新 env var（HMAC secret 沿用既有）；無新 npm package
- Parallel change coordination: 與 `add-sse-resilience`（active）完全 disjoint files（後者動 SSE chat 流，本 change 動 MCP token / DO storage）；可獨立推進
