## Why

目前 Web chat 的串流體驗仍是先取得完整回答，再由前端 `simulateStreaming()` 模擬逐字顯示。這讓系統無法誠實主張已具備真串流能力，也無法量測首字延遲或驗證端到端中斷語義。這個 change 要把 Web chat 回答通道升級為可驗證的 SSE 真串流，讓回答體驗、觀測資料與對外說法一致。

## What Changes

- 將 Web chat 的回答傳輸改為 SSE 真串流，讓 client 逐步接收並顯示回答內容。
- 移除對 `simulateStreaming()` 類型假串流行為的依賴，改以 server 實際送出的串流事件驅動 UI。
- 補上 `first_token_latency` 的量測與觀測鏈，使真串流可被驗證與答辯引用。
- 將停止回答的互動升級為 end-to-end 可中斷語義，而非僅停止前端顯示。
- 確保 citation、refusal、error 行為在串流上線後不退化。

## Non-Goals

- 不把 MCP 問答改成串流；本 change 只處理 web chat。
- 不在本 change 中重新定義 Workers AI answer / judge 接入；該能力由獨立 proposal 處理。
- 不把 dashboard、長期延遲分析或多通道串流協定統一納入本 change。

## Capabilities

### New Capabilities

- `web-chat-sse-streaming`: 定義 Web chat 使用 SSE 進行真串流、首字延遲量測、端到端中斷與行為一致性要求。

### Modified Capabilities

(none)

## Impact

- Affected specs: `web-chat-sse-streaming`
- Affected code:
  - New: `openspec/specs/web-chat-sse-streaming/spec.md`
  - Modified: `app/components/chat/Container.vue`, `app/components/chat/StreamingMessage.vue`, `server/api/chat.post.ts`, `server/utils/web-chat.ts`, `server/utils/knowledge-audit.ts`, `HANDOFF.md`
  - Removed: (none)
