# Handoff

## In Progress

- [ ] `governance-refinements` — task 1.1 (`建立 stale conversation resolver`)
- 已完成 apply intake：roadmap sync、status/apply instructions/context files 檢查，確認 3.1-3.4 已完成，其餘 pending。

## Blocked

- `governance-refinements` 的 1.x conversation lifecycle 任務假設目前 branch 已有持久化 Web conversation stack，但實際上尚未落地：
  - `server/db/schema.ts` 只有 `conversations.deletedAt`，`messages` 沒有 `conversation_id`、`content_text`、`citations_json`
  - `app/pages/chat/index.vue` 與 `app/components/chat/ConversationHistory.vue` 仍明確標示「current session only / conversations are not persisted」
  - repo 中不存在 `server/api/conversations/**` routes
- 因此 task 1.1 所需的「依最新 assistant citations 動態判定 stale」沒有可用的持久化 assistant message/citation source，task 1.3/1.4/1.5 也缺少對應 API 與 schema surface。

## Next Steps

1. 先完成/合入支援 persisted Web conversations 的前置工作：至少補齊 `messages.conversation_id`、`content_text`、`citations_json`（或等價 schema）與 `server/api/conversations` surfaces。
2. 前置完成後，從 task 1.1 重新開始 TDD：先寫 stale follow-up integration test，再實作 resolver 與 `/api/chat` follow-up routing。
3. 若決定改變治理方案而不再持久化原文 conversation，先更新 `governance-refinements` artifacts，避免 task 1.x 繼續引用目前 branch 不存在的 schema/API 契約。
