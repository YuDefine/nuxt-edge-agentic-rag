# Handoff

## In Progress

### `wire-do-tool-dispatch` — Production flag 已 flip，進 24h 監控期

- **Production flag flipped** at v0.43.3（`bc85403` 2026-04-25 06:17 改 `wrangler.jsonc` → `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION="true"`；`9971bc2` 發布；staging+production deploy 綠）
- Code 18/24 ✅；tasks §7.2 flip 動作完成，但 24h 密集監控 + 任一 anomaly 立刻 flag=false 的觀察期尚未結束
- 剩：§7.2 監控窗 → §7.3（7 天後標 `TD-030` + `TD-041` done）→ §8.1–§8.4 使用者人工檢查 → archive
- Claim: `charles@charlesdeMac-mini.local`（最後 heartbeat 2026-04-24T21:40；若下個 session 接手先更新 heartbeat 或 `pnpm spectra:release` + 新 claim）

### `upgrade-mcp-to-durable-objects` — 等 wire-do archive

- 17/27 tasks (63%)，session lifecycle scope
- 兩 change 共碰 `mcp-knowledge-tools` spec → mutex；**MUST** 等 `wire-do-tool-dispatch` archive 才能續推或評估一起收斂
- 未 claim；下次接手前先 `pnpm spectra:claim -- upgrade-mcp-to-durable-objects`

## Blocked

_（無強 blocker。已知 `TD-045` 本機 `/api/auth/me/credentials` 間歇 500 narrow scope 已上 v0.43.2 + v0.43.3（`4107357` 收斂 NuxtHub v0.10.7 自動處理掉 Problem #1/#2），剩 binding 500 trace；`TD-049` Cloudflare Pages deploy API 8000111 workaround `in-progress` 且連續 3 次 staging+production 都綠 — 皆不阻擋主線 rollout。）_

## Next Steps

1. **Anomaly 監控**（tasks §7.2）— production flag=true 起算 24 小時內，`wrangler tail` 密集觀察 production Worker log；看到 `Reflect.ownKeys` TypeError / 401 auth context failure / tool call 回 501 / Claude.ai 回 "Error occurred during tool execution" 任一 → **hot-patch flag=false**（CF dashboard 或 API binding edit，不需 redeploy；後續 24h 內 MUST 把 `wrangler.jsonc` 改回 false 並 redeploy，避免 source vs runtime 漂移到下次 deploy）
2. **7 天穩定觀察**（tasks §7.3）— 監控窗過後若無異常，`docs/tech-debt.md` 把 `TD-030`（Claude.ai re-init 循環）+ `TD-041`（DO tool dispatch wire-up）Status 標 `done`，各附一句 one-liner
3. **使用者人工檢查**（tasks §8.1–§8.4，Claude 不可代勾）
   - §8.1 Claude.ai production 連續 3 次 `AskKnowledge` 不同 query，UI 看到正確回答
   - §8.2 MCP Inspector / Claude Desktop production 連線，`tools/list` 回 4 個 tool
   - §8.3 wrangler tail 24h 無 `Reflect.ownKeys` / 無 401 auth context failure
   - §8.4 `NUXT_MCP_AUTH_SIGNING_KEY` staging/prod 為**不同**高熵值，不出現在 repo / logs / error messages
4. **Archive** — §7.2/§7.3/§8 全過 → `spectra-archive wire-do-tool-dispatch` → 續推或一起收斂 `upgrade-mcp-to-durable-objects`
5. **Operational chore**（不阻擋 archive）— Notion Secret 頁 staging 區塊補 `agentic-rag-staging` AutoRAG / Gateway 已建（人工，需本機 mint token 寫入明文 secret）
