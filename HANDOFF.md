# Handoff

## In Progress

### `wire-do-tool-dispatch` — v0.43.4 stop-gap rollback 中（SSE scope expansion 進行中）

- **狀態回正中**：v0.43.3（`bc85403` flag → true、`9971bc2` release）上 production 後實測 Claude.ai 撞 GET /mcp 405 → OAuth 循環（"Authorization with the MCP server failed"）。Root cause = stateful DO transport 缺 GET /mcp SSE channel；MCP spec 2025-11-25 對 GET 405 雖 spec-compliant，但 Claude.ai client fallback 行為是重 OAuth 而非 POST-only，且 stateful server 缺 SSE = 名實不符。
- **v0.43.4 stop-gap rollback**（進行中）：`wrangler.jsonc` flag → `false` + patch bump v0.43.3 → v0.43.4 + tag push → CI auto deploy production。完成後 production runtime flag 回 false，回到 v0.42.x stateless behavior。CI deploy 完成後**MUST**用 `wrangler versions view` 確認 production runtime flag = false 才算 stop-gap 收尾。
- **Tasks 狀態**（22/34, 65%）：§1–§4 全綠、§4.x SSE on DO 5/5 已完成、§5.x SSE Tests 0/4 未做、§6.3 / §6.x 未做、§7.1 退回 in-progress（acceptance 升級新標準）、§7.2 / §7.3 / §8.1–§8.4 未做。
- **下次 flip true 前缺**：§5.x（SSE integration tests x4：basic SSE、Last-Event-Id replay、multi-connection、DELETE）+ §6.x（SSE-specific 驗證 + DO storage event queue alarm cleanup）+ §7.1 升級 acceptance 三項全綠（curl 4 tool call + SSE-aware mock client + 真實 Claude.ai 3 query UI 顯示真實答案）。
- Claim: `unknown:charles@charlesdeMac-mini.local`（2026-04-25 接手 v0.43.3 broken state，執行 v0.43.4 stop-gap rollback）

### `upgrade-mcp-to-durable-objects` — 等 wire-do archive

- 17/27 tasks (63%)，session lifecycle scope
- 兩 change 共碰 `mcp-knowledge-tools` spec → mutex；**MUST** 等 `wire-do-tool-dispatch` archive 才能續推或評估一起收斂
- 未 claim；下次接手前先 `pnpm spectra:claim wire-do-tool-dispatch` 之外另開 claim

### `add-new-conversation-entry-points` — 實作 + Design Review 全完，剩人工檢查（TD-048）

- 19/26 tasks (73%)；§1–§5 (Helper / 元件 / page 串接 / unit + e2e tests / Design Review) 全 [x]；§6.1 TD-048 → in-progress 已標
- 剩 §6.2（archive 前 TD-048 → done）+ §7.1–§7.6 人工檢查 6 項（chat header 點按鈕、reload 行為、Safari private mode）
- 證據：`design-review.md` Fidelity 已通過、`e2e/new-conversation-button.spec.ts` 5 場景 spec、unit test 覆蓋 helper / orchestration
- 獨立 spec（`web-chat-ui`），與其他 active change 不衝突，可並行推進
- Stale claim（heartbeat 2026-04-24T22:39Z）；接手前先 `pnpm spectra:claim add-new-conversation-entry-points`

### `fix-user-profile-id-drift` — Tier 3 實作 + ADR 全完，剩人工檢查（TD-044）

- 18/25 tasks (72%)；§1–§6 (hook → utility migration + 3 Requirements + 8 unit tests + ADR `docs/decisions/2026-04-25-user-profiles-app-level-migrate.md`) 全 [x]
- §7.3 Non-Goals 邊界 + §8.1 TD-044 → in-progress + §8.2 ADR 已標 [x]
- 剩 §7.1 cleanroom 驗證（rm sqlite + dev + /api/chat 200）+ §7.2 stale row migrate 實機 + §8.3 archive 前 TD-044 → done + §9.1–§9.4 人工檢查 4 項
- **§9.3 production 1 週觀察**是 deploy 後才能驗（不阻擋 archive，可在 archive 後 follow-up）
- ADR vs 實作預檢通過：5 Decisions + 3 Trade-offs 全部與 `server/utils/user-profile-sync.ts` + `server/auth.config.ts:488-502` 一一對齊
- 獨立 spec（`auth-storage-consistency`），與其他 active change 不衝突，可並行推進
- Stale claim（heartbeat 2026-04-24T22:45Z）；接手前先 `pnpm spectra:claim fix-user-profile-id-drift`

## Blocked

_（無強 blocker。已知 `TD-045` 本機 `/api/auth/me/credentials` 間歇 500 narrow scope 已上 v0.43.2 + v0.43.3，剩 binding 500 trace；`TD-049` Cloudflare Pages deploy API 8000111 workaround `in-progress` 且連續 3 次 staging+production 都綠 — 皆不阻擋主線 rollout。）_

## Next Steps

1. **先確認 v0.43.4 stop-gap rollback 完成**：`pnpm exec wrangler versions view <latest> --name nuxt-edge-agentic-rag` 中 `env.NUXT_KNOWLEDGE_FEATURE_MCP_SESSION` 為 `"false"`；GitHub Actions deploy.yml production job 綠
2. **§5.x SSE Tests** — 4 個 integration test：
   - 5.x.1 basic SSE channel（GET /mcp + Content-Type: text/event-stream + server-initiated notifications）
   - 5.x.2 Last-Event-Id replay（reconnect 後不重複收 event-N-1）
   - 5.x.3 multi-connection（兩條 SSE channel server-initiated round-robin / newest-active）
   - 5.x.4 DELETE（清空 storage events:\* + close streams + cancel alarm）
3. **§6.x SSE-specific 驗證** — `pnpm check` 全綠 + 既有 stateless test 不破壞 + DO storage event queue alarm cleanup
4. **§7.1 acceptance 升級三項全綠**：
   - (a) curl 4 tool call 全 `isError: false`
   - (b) SSE-aware mock client（ReadableStream consume + Last-Event-Id replay simulation）
   - (c) **真實 Claude.ai 連 staging 走 OAuth flow + 3 個 askKnowledge query UI 顯示真實答案**（非 "Authorization failed" / "Tool execution failed"）
5. **§7.2 production flip true 重做**（24h 監控 + 任一 anomaly 立刻 flag=false hot-patch）
6. **§7.3 7 天穩定觀察** → `docs/tech-debt.md` 把 `TD-030` + `TD-041` Status 標 `done`
7. **§8.1–§8.4 使用者人工檢查**（Claude 不可代勾）
8. **Archive** — `spectra-archive wire-do-tool-dispatch` → 續推或一起收斂 `upgrade-mcp-to-durable-objects`
9. **Operational chore**（不阻擋 archive）— Notion Secret 頁 staging 區塊補 `agentic-rag-staging` AutoRAG / Gateway 已建（人工，需本機 mint token 寫入明文 secret）；staging R2 sample doc seed（TD-050）
