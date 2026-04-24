# Handoff

## In Progress

### `upgrade-mcp-to-durable-objects`（Pivot C 選定，進 Phase 4）

- Claim: `charles@charlesdeMac-mini.local`
- Progress: 6/25 tasks（24%）
  - ✅ 1.2 runtime config `mcp.sessionTtlMs`（`39ebcb3`）
  - ✅ 2.1 diag patch Round 1 + Round 2 entry log
  - ✅ 2.2 tail 抓到 `[MCP-DIAG-ENTRY]` + `[MCP-DIAG]`（Round 2 實證）
  - ✅ 2.3 revert diag patch（`4448cd3`）+ solution doc + ingest（`b1966ba`）
  - ✅ 3.3 Pivot C 評估：SDK Transport interface 極簡，自寫 shim ~30 行
  - ✅ 3.4 Pivot decision log：**選 Pivot C**
  - ⊘ 3.1 / 3.2 skipped（選 C 後不需要）
  - ↳ 1.1 合併到 4.5（wrangler binding 要 DO class 存在才能 dry-run）
- **Pivot C 關鍵洞察**：SDK `Transport` interface（`start / send / close + onmessage`）極簡，自寫 `DoJsonRpcTransport` 只做 HTTP ↔ JSONRPCMessage 橋接、**從未碰 env proxy**，根除 `Reflect.ownKeys` bug；SDK `McpServer` + `Protocol` 處理所有 request 派遣 / response 組裝
- 詳細記錄：[`docs/solutions/mcp-streamable-http-session-durable-objects.md`](docs/solutions/mcp-streamable-http-session-durable-objects.md) § Pivot Decision — C

## Next Steps

1. **Phase 4 Core Implementation**（依 Pivot C 路線）
   - 4.1 新增 `server/mcp/do-transport.ts`：`DoJsonRpcTransport` class（~30 行）
   - 4.2 新增 `server/mcp/durable-object.ts`：`MCPSessionDurableObject` class + state schema + alarm GC
   - 4.3 DO `fetch()` 實作：HTTP ↔ JSON-RPC 橋接、lazy init McpServer、簽發 Mcp-Session-Id header
   - 4.4 改 `server/mcp/index.ts` 依 `features.mcpSession` 路由
   - 4.5 `wrangler.jsonc` 加 `durable_objects.bindings` MCP_SESSION v1 + dry-run 驗證
   - 4.6 middleware 加過期 session 404 + token revoke 連動清 DO
2. **`assert-never` 重複 util 收斂** — `app/utils/assert-never.ts` 與 `shared/utils/assert-never.ts` 重複（Nuxt auto-import 以 shared 為主），nuxt typecheck 仍噴 WARN；非本 change scope
3. **長期 TD**（見 `docs/tech-debt.md`）
   - TD-027 MCP connector first-time auth — 等 upgrade-mcp-to-durable-objects 完成後一併實測
   - TD-028 DeleteAccountDialog Google reauth callbackURL — 獨立 change 候選
   - TD-009 `user_profiles.email_normalized` nullable migration
   - TD-015 + TD-019 + TD-016 SSE 合併處理
   - TD-026 conversation owner-fallback 重複 config
4. **日期格式 smoke（遺留）** — `/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認
