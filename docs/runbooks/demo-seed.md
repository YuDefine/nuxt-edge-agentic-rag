# Production / Staging Demo Seed

Production 與 staging 的展示資料由 repo 內 `scripts/demo-seed/` 維護，透過一次性 remote Wrangler worker 寫入對應環境的 D1 / R2，並觸發 AI Search sync。

## 覆蓋範圍

- 12 份文件、14 個版本、94 個 source chunks，其中 11 份 active、1 份 archived。
- internal / restricted access level 皆有 current chunks 與 citation metadata。
- chat history、messages、citation replay、query logs、debug latency、usage trend、MCP tokens、members / roles、guest policy 皆有資料。
- demo rows 使用 `demo-staging-*` / `demo-production-*` 前綴，重跑時只清同環境 demo namespace。

## 指令

Dry-run：

```bash
pnpm demo-seed staging
pnpm demo-seed production
```

寫入並同步 AI Search：

```bash
pnpm demo-seed staging --apply
pnpm demo-seed production --apply
```

只驗證 AI Search binding structured filters：

```bash
pnpm demo-seed staging --verify-only
pnpm demo-seed production --verify-only
```

## 驗證門檻

- D1：`documents=12`、`document_versions=14`、`source_chunks=94`、`citation_records=12`、`query_logs=16`、`messages=18`、`mcp_tokens=4`、demo users `5`。
- R2：`normalized-text/demo-<env>-ver-legacy-procurement-2024-v1/0006.txt` 可下載。
- AI Search：internal 查詢 `PR 和 PO 的差別` 與 restricted 查詢 `restricted access 可以查哪些預算資料` 都要回 active / current / citation metadata 完整的 chunks。
- HTTP：`https://agentic.yudefine.com.tw` 與 `https://agentic-staging.yudefine.com.tw` 都要回 200。

## 安全邊界

- 腳本不產生可用 bearer token，只寫入展示用 token hash。
- `guest_policy` 只在缺 row 時 `INSERT OR IGNORE`，不覆蓋既有 production 設定。
- R2 清理只刪 `demo-seed/<env>/` 與 `normalized-text/demo-<env>-ver-` 前綴。
