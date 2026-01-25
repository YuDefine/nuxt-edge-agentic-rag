# Handoff

## In Progress

- [ ] `governance-refinements` — task 1.1 (`建立 stale conversation resolver`)
- 已完成 apply intake：roadmap sync、status/apply instructions/context files 檢查，確認 3.1-3.4 已完成，其餘 pending。
- [ ] `test-coverage-and-automation` — tasks 2.4+ (`TC-04` 之後的 acceptance automation)
- 已完成 2.1-2.3：補上 Web citation persistence，並以 shared acceptance harness 寫完 `TC-01`、`TC-02`、`TC-03` 的 Web/MCP integration coverage；`pnpm test` 目前全綠。

## Blocked

- `governance-refinements` 的 1.x conversation lifecycle 任務假設目前 branch 已有持久化 Web conversation stack，但實際上尚未落地：
  - `server/db/schema.ts` 只有 `conversations.deletedAt`，`messages` 沒有 `conversation_id`、`content_text`、`citations_json`
  - `app/pages/chat/index.vue` 與 `app/components/chat/ConversationHistory.vue` 仍明確標示「current session only / conversations are not persisted」
  - repo 中不存在 `server/api/conversations/**` routes
- 因此 task 1.1 所需的「依最新 assistant citations 動態判定 stale」沒有可用的持久化 assistant message/citation source，task 1.3/1.4/1.5 也缺少對應 API 與 schema surface。
- `test-coverage-and-automation` 的下一個順序任務 `2.4 TC-04` 需要真實的 Self-Correction / Query Reformulation 第二輪成功，但目前實作只有 route-local fallback judge：
  - `server/api/chat.post.ts` 與 `server/api/mcp/ask.post.ts` 的 `createFallbackJudge()` 只回 `shouldAnswer`，不會產生 `reformulatedQuery`
  - `server/utils/knowledge-answering.ts` 雖支援第二輪 `reformulatedQuery` 重試，但目前沒有任何 production judge 會提供它
  - `bootstrap-v1-core-from-report` artifacts 宣稱 3.2 已完成 judge / reformulation，與實際 code 有 artifact drift
- 因此 2.4 之後依賴 Self-Correction / judge 的 acceptance tasks（`TC-04`、部分 `TC-06` / `A05` evidence）目前不是缺測試，而是缺上游產品能力或需先更新 artifacts。

## Next Steps

1. 先完成/合入支援 persisted Web conversations 的前置工作：至少補齊 `messages.conversation_id`、`content_text`、`citations_json`（或等價 schema）與 `server/api/conversations` surfaces。
2. 前置完成後，從 task 1.1 重新開始 TDD：先寫 stale follow-up integration test，再實作 resolver 與 `/api/chat` follow-up routing。
3. 若決定改變治理方案而不再持久化原文 conversation，先更新 `governance-refinements` artifacts，避免 task 1.x 繼續引用目前 branch 不存在的 schema/API 契約。
4. 釐清 `bootstrap-v1-core-from-report` 與實作的 judge / reformulation drift：要嘛補上真正的 `models.agentJudge` + query reformulation，要嘛先更新 artifacts 把 `TC-04` / `A05` 改為未交付。
5. 上游釐清後，從 `test-coverage-and-automation` task 2.4 重新開始 TDD：先寫 `TC-04` failing integration case，再接續 `TC-05` / `TC-06`。
