# Handoff

_目前無進行中的 spectra change，無未接手項目。_

## Recently Archived（2026-04-25）

- **`wire-do-tool-dispatch`**：v0.43.4 stop-gap → v0.44.0/.1 / v0.45.0/.1 4-layer fix → v0.46.0 production flip true。staging acceptance 12/12 全綠，production worker fetch handler 正常驗證 bearer + 無 ownKeys/TypeError。§6.4 streaming bypass 架構決策見 ADR `docs/decisions/2026-04-25-cloudflare-sse-streaming-bypass.md`。TD-030 + TD-041 standalone done。
- **`upgrade-mcp-to-durable-objects`**：session lifecycle scope 由 wire-do archive 等價覆蓋（acceptance 12/12 含 lifecycle / DELETE / Last-Event-Id replay 完整流程）；§6/§7/§8 task 全 [x] 收。
- **`add-mcp-tool-selection-evals`**：eval harness、dataset、scorer、文件、dev token CLI、bearer-token client wiring、baseline 與 manual review 皆已落地。
- **`fix-user-profile-id-drift`**：`session.create.before` hook 改寫 + ADR + 8 unit tests + live verify。TD-044 done。
- **`add-new-conversation-entry-points`**：chat header 新對話按鈕 + reload + Safari private mode 相容 + e2e 5/5 + Design Review。TD-048 done。
- **`consolidate-conversation-history-config`**：`createChatConversationHistory` factory；TD-046 staging AutoRAG 建立 done。

## Backlog（隨時可獨立進，無 active spectra change 阻擋）

詳見 `openspec/ROADMAP.md` `## Next Moves`：

- **近期**：TD-050 staging R2 seed / TD-049 CF Pages deploy API workaround 觀察 / TD-047 SSE error path / TD-009 user_profiles email_normalized nullable
- **中期**：TD-015 + TD-019 + TD-016 SSE 合併處理
- **長期**：TD-027 MCP connector first-time auth / `discuss-mcp-resource-layer` / `discuss-mcp-elicitation-for-ask` / `discuss-mcp-async-context-refactor`

## Archive 後 follow-up（不擋任何 active work）

- **TD-053** wire-do production 7 天觀察 — wire-do archive 後常規 wrangler tail / dashboard alert
- **TD-054** Safari private mode `clearConversationSessionStorage` 實機驗證 — helper 已內建 QuotaExceededError catch
- **TD-045** Local NuxtHub cleanroom rebuild 受 `applyMigrationsDuringDev` opt-out 阻擋（不影響 production）
