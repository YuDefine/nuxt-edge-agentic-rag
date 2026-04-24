# Handoff

## In Progress

### `upgrade-mcp-to-durable-objects`（使用者實作中）

- Claim: `charles@charlesdeMac-mini.local`（active heartbeat 2026-04-24T10:53:09Z）
- Progress: 2/25 tasks（8%）
- Working tree WIP（**未 commit**）：
  - `nuxt.config.ts`
  - `openspec/ROADMAP.md`（AUTO sync diff，MANUAL 區尚未更新）
  - `openspec/changes/upgrade-mcp-to-durable-objects/proposal.md`
  - `openspec/changes/upgrade-mcp-to-durable-objects/design.md`（new）
  - `openspec/changes/upgrade-mcp-to-durable-objects/specs/`（new）
  - `openspec/changes/upgrade-mcp-to-durable-objects/tasks.md`（new）
  - `server/utils/mcp-agents-compat.ts`
  - `shared/schemas/knowledge-runtime.ts`（加 `KnowledgeMcpConfig` + `mcp` required field + schema + default）
  - `test/unit/knowledge-runtime-config.test.ts`

## Next Steps

1. **繼續實作 `upgrade-mcp-to-durable-objects`** — 主線；claim 持續 heartbeat，依 tasks.md 推進剩 23 個 task
2. **驗證 v0.38.1 deploy fix 在下次 docs/openspec-only commit 的行為** — 下次 push main 時確認 CI workflow 會觸發、Deploy 的 `verify-ci-gate` pass（不再 15 分鐘 timeout）；若要再保險，可寫一個空白的 docs commit 當 regression smoke
3. **更新 ROADMAP MANUAL 區塊（drift）** — `openspec/ROADMAP.md` 的 `Current State` 還停在 v0.31.0 / 「沒有 active change」，與實際（v0.38.1、`upgrade-mcp-to-durable-objects` 在做）漂移；建議重寫 Current State + Next Moves，反映 v0.37 → v0.38.1 的 fix-mcp 封存 + DO 轉寫路線
4. **fix-mcp-streamable-http-session archive 後續**（已在 3e8bc70 歸檔）— TD-030（Claude.ai re-init 阻擋 tools/call）由 `upgrade-mcp-to-durable-objects` 吸收
5. **其他長期 TD**（見 `docs/tech-debt.md`）
   - TD-027 MCP connector first-time auth — 等 DO 方案完成後一併實測
   - TD-028 DeleteAccountDialog Google reauth callbackURL — 獨立 change 候選
   - TD-009 `user_profiles.email_normalized` nullable migration
   - TD-015 + TD-019 + TD-016 SSE 合併處理
   - TD-026 conversation owner-fallback 重複 config
   - `passkeyFeatureEnabled` 三處重複 → `useFeatureFlags` composable 機會
6. **v0.38.1 deploy 驗證基準**（本輪已完成）
   - Deploy staging run `24886128138` ✅（`verify-ci-gate` 首次在 docs-ish commit 後 pass，而非 15 分鐘 timeout）
   - Deploy production run `24886318941` ✅（tag `v0.38.1`）
7. **日期格式 smoke（遺留）** — `/account/settings`、`/admin/documents/:id`、`/admin/members`、`/admin/query-logs` list+detail、`/admin/tokens` 目視確認
