# Handoff

## In Progress

### `wire-do-tool-dispatch` — §5.x + §6.x 全綠，等 §7.1 acceptance 升級

- **2026-04-25 本 session 完成**：
  - §5.x SSE Tests 4/4：`test/integration/mcp-session-sse.spec.ts` 共 13 it block 全綠（5.x.1×4 + 5.x.2×3 + 5.x.3×2 + 5.x.4×4），3 連續 run 穩定
  - §6.x SSE 驗證：integration test 13/13 ✅；既有 stateless test 不破壞；DO storage event queue alarm cleanup 由 5.x.4 #2 (`DELETE clears all sse-event:* storage rows + cancels alarm`) 涵蓋並通過
  - Production-side fix：`server/durable-objects/mcp-session.ts:469-481` `TransformStream` readable hwm `0` → `Number.POSITIVE_INFINITY`，避免 `: connected` primer write 在 fetch handler return 前 backpressure deadlock（兼修 prod 慢 client 韌性）
  - design.md SSE section 對齊實作（broadcast routing + single counter encoding + sequence diagram eventId 改 `e-<padded>` 格式）
  - §7.1 SSE-aware mock client 已寫：`scripts/mcp/staging-sse-acceptance.mts` + `pnpm mcp:acceptance:staging` alias（待 staging flip true 才能跑）
- **Tasks 狀態**（30/34, 88%）：§1–§4 + §4.x + §5.x + §6.x 全綠；§7.1 退回 in-progress（acceptance 升級新標準）；§7.2 / §7.3 / §8.1–§8.4 待做
- **v0.43.4 stop-gap 已收尾**：`448cf07` deploy v0.43.4，production runtime flag = false 確認；目前不會撞 GET /mcp 405 / OAuth 循環
- **下次 flip true 前缺**：§7.1 升級 acceptance 三項全綠（(a) curl 4 tool call + (b) SSE-aware mock client + (c) 真實 Claude.ai 3 query UI 顯示真實答案）+ §7.2 production flip 重做 + §7.3 7 天觀察 + §8.1–§8.4 人工檢查
- Claim: `unknown:charles@charlesdeMac-mini.local`（heartbeat 2026-04-25）

### `upgrade-mcp-to-durable-objects` — 等 wire-do archive

- 17/27 tasks (63%)，session lifecycle scope
- 兩 change 共碰 `mcp-knowledge-tools` spec → mutex；**MUST** 等 `wire-do-tool-dispatch` archive 才能續推或評估一起收斂
- 未 claim

## Recently Archived（2026-04-25）

- **`add-new-conversation-entry-points`**：3 處新對話入口（chat header / sidebar expanded / sidebar collapsed plus）+ `clearConversationSessionStorage` helper + 5/5 e2e 全綠 + Design Review Fidelity 通過。spec `web-chat-ui` modified 1 + added 1。TD-048 → done。Safari private mode 實機 follow-up 登記 **TD-054**（archive 後補；helper try/catch 已涵蓋 QuotaExceededError）。
- **`fix-user-profile-id-drift`**：`syncUserProfile` utility（email_normalized-first lookup + app-level migrate children + env-gate rethrow + redacted log hint）+ ADR + 8 unit tests + live INSERT/migrate branch verify。spec `auth-storage-consistency` added 3 Requirements。TD-044 → done。同步附帶 **TD-052 done**（passkey-first-link-google.spec.ts mock 對齊 syncUserProfile 路徑）。Production 1 週 wrangler tail 觀察登記 **TD-053**（archive 後 follow-up）。

## Blocked

_（無強 blocker。已知 `TD-045` 本機 cleanroom rebuild 受 NuxtHub `applyMigrationsDuringDev` opt-out 阻擋；`TD-049` Cloudflare Pages deploy API 8000111 workaround `in-progress` 且連續 3 次 staging+production 都綠 — 皆不阻擋主線 rollout。）_

## Next Steps

1. **§7.1 acceptance 升級三項全綠**：
   - (a) curl 4 tool call 全 `isError: false`
   - (b) SSE-aware mock client（`pnpm mcp:acceptance:staging` 已寫好，等 staging flip true 跑）
   - (c) **真實 Claude.ai 連 staging 走 OAuth flow + 3 個 askKnowledge query UI 顯示真實答案**（非 "Authorization failed" / "Tool execution failed"）
2. **§7.2 production flip true 重做**（24h 監控 + 任一 anomaly 立刻 flag=false hot-patch）
3. **§7.3 7 天穩定觀察** → `docs/tech-debt.md` 把 `TD-030` + `TD-041` Status 標 `done`
4. **§8.1–§8.4 使用者人工檢查**（Claude 不可代勾）
5. **Archive** — `spectra archive wire-do-tool-dispatch` → 續推或一起收斂 `upgrade-mcp-to-durable-objects`
6. **Operational chore**（不阻擋 archive）— Notion Secret 頁 staging 區塊補 `agentic-rag-staging` AutoRAG / Gateway 已建（人工，需本機 mint token 寫入明文 secret）；staging R2 sample doc seed（TD-050）
7. **Archive 後 follow-up**（不擋 wire-do）：TD-053 production 觀察 / TD-054 Safari private mode 實機 / TD-045 cleanroom rebuild dev 解鎖
