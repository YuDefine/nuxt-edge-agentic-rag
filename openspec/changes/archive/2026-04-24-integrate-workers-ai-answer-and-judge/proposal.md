## Why

目前 Web 與 MCP 問答流程雖已把 `answer` 與 `judge` 抽成可注入依賴，但實際仍使用 fallback answer / fallback judge，導致專案無法誠實主張回答層已正式接入 Workers AI，也無法用固定題組建立可答辯的成本與延遲基準。這個 change 要先把回答層的核心決策補成可驗證的真實模型路徑，為後續成本估算、對外說法與真串流能力建立可信基線。

## What Changes

- 讓 Web 問答 accepted path 與 judge path 使用真實 Workers AI 呼叫，不再依賴 fallback answer / fallback judge 作為正式回答層。
- 讓 MCP 問答 accepted path 與 judge path 使用同一套真實 Workers AI 能力，維持 Web / MCP 共用回答治理核心。
- 補齊固定題組與可重跑 smoke 所需的驗證面，讓 Web / MCP 都能提出 accepted path 的真實呼叫證據。
- 建立少量真實 Workers AI 實測 baseline，供成本與延遲的情境估算引用。
- 維持 refused path 的既有拒答行為與治理邊界，但不把「證明 0 次模型呼叫」列為本 change 的最低驗收。

## Non-Goals

- 不把前端假串流改成真串流；真串流另立 proposal 處理。
- 不把 MCP 串流、首字延遲 UX、SSE 協定設計納入本 change。
- 不把大規模 benchmark、長期壓測或完整成本報表系統納入本 change。
- 不重寫既有 retrieval、citation replay、restricted-scope 攔截或 conversation lifecycle 規則。

## Capabilities

### New Capabilities

- `workers-ai-grounded-answering`: 定義 Web 與 MCP 在 accepted path / judge path 上使用真實 Workers AI 的回答、驗證與證據要求。

### Modified Capabilities

(none)

## Impact

- Affected specs: `workers-ai-grounded-answering`
- Affected code:
  - New: `openspec/specs/workers-ai-grounded-answering/spec.md`
  - Modified: `server/api/chat.post.ts`, `server/mcp/tools/ask.ts`, `server/utils/knowledge-answering.ts`, `server/utils/web-chat.ts`, `server/utils/mcp-ask.ts`, `server/utils/knowledge-audit.ts`, `server/utils/usage-analytics.ts`, `HANDOFF.md`
  - Removed: (none)
