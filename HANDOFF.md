# Handoff

## In Progress

### v0.42.0 已發布（2026-04-24）

- `main` push `a2ecbb1` → staging deploy 全綠：run `24898590937`
- tag `v0.42.0` → production deploy + docs production + smoke + notify 全綠：run `24898814022`
- 版本：`0.41.0` → `0.42.0`（minor）
- staging smoke-test 有 annotation：GitHub runner health check target 被 Cloudflare WAF/Bot protection 回 `403`，但 workflow 判定成功；與先前 custom domain smoke 情況一致。

### `wire-do-tool-dispatch`

- Progress: 17/24 tasks（71%）；DO 內 `McpServer` lazy init、4 個 tool dispatch、auth context HMAC forward、DO-aware H3Event shim 已落地並發布。
- Staging 已透過 `main` deploy；production build 已部署，但 `wrangler.jsonc` / production build-time flag 仍維持 `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=false`，避免未完成 soak 前切 production 流量。
- 剩餘：staging 3 天 soak、production flag flip、7 天觀察後關閉 TD-030 / TD-041。

### `upgrade-mcp-to-durable-objects`

- Progress: 17/27 tasks（63%）；session lifecycle scope 仍 active，與 `wire-do-tool-dispatch` 同碰 `mcp-knowledge-tools`，ROADMAP 標為 mutex。
- 後續應確認是否由 `wire-do-tool-dispatch` 完成 rollout 後一起 archive / 收斂。

### `add-mcp-tool-selection-evals`

- Progress: 25/28 tasks（89%）；eval harness、dataset、scorer、docs、dev MCP token helper、bearer token client wiring、baseline / fail-path 驗證、`pnpm check` 與 `pnpm test` 已完成。
- 剩餘：3 個使用者人工 review gate：dataset query 文案真實性、baseline 分數合理性、`.env.example` / `docs/evals/mcp-tool-selection.md` 的 API key / 成本警語清楚度。

## Blocked

- 截圖審查時 local dev `/api/auth/me/credentials` 曾間歇性回 `500`：`[nuxt-hub] DB binding not found`。UI 本身無阻塞缺陷，但完整 dark mode 正常態審查被 local binding 問題限制；若要追，先看 NuxtHub local DB binding 初始化。

## Next Steps

1. 對 `wire-do-tool-dispatch` 做 staging soak：`NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`，Claude.ai / MCP Inspector 連續測 `AskKnowledge`、`SearchKnowledge`，tail 確認無 `ownKeys`、無 re-init loop、無 auth context failure。
2. staging soak 通過後再 flip production `NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true`，24 小時密集 tail；任一 anomaly 立刻 flag=false。
3. 7 天 production 穩定後，把 `docs/tech-debt.md` 的 TD-030 / TD-041 標 done，並 archive `wire-do-tool-dispatch` / 收斂 `upgrade-mcp-to-durable-objects`。
4. 完成 `add-mcp-tool-selection-evals` 3 個人工 review gate（tasks 7.1–7.3）；目前 TD-043 記錄了 Evalite afterAll fail 不 propagate 的風險。
5. 追 local dev binding 問題：`/api/auth/me/credentials` 的 NuxtHub DB binding 500 會影響 screenshot review 穩定性。
