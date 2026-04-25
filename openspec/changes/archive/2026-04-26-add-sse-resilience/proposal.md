## Why

Web chat SSE 流目前有兩個獨立但相關的韌性問題：(1) **TD-015** — `createSseChatResponse` 在 `ready` 後到 Workers AI 首 token 之間若延遲 ≥ 30s，CF edge / 瀏覽器代理會主動關閉長連線（缺 keep-alive），客戶端看到 `NetworkError / connection closed`；(2) **TD-019** — `app/utils/chat-stream.ts:readChatStream`（client 端）與 `server/utils/workers-ai.ts:readStreamedTextResponse`（server 端）的 SSE reader 行為（`reader.read()` → `decoder.decode` → `split('\n\n')` → `buffer.pop()` → parse block，含 abort handler / finally / releaseLock）幾乎 1:1 雷同，分別維護有漂移風險（一邊修 bug 另一邊漏改）。兩條落在同一片 SSE plumbing，合併處理 ROI 較高。

## What Changes

- `server/api/chat.post.ts` 的 `createSseChatResponse` `ReadableStream.start` 內啟動 keep-alive 迴圈：每 15-20 秒 enqueue `: keep-alive\n\n` SSE 註解行，直到 stream 自然 terminate 或 abort
- 新增 `shared/utils/sse-parser.ts`：export `readSseStream(response, { onBlock, signal })` 統一處理 reader / decoder / block 切分 / abort handler / finally / releaseLock
- `app/utils/chat-stream.ts:readChatStream` 改用 `readSseStream`，block handler 解析 chat event type → ChatStreamTerminalEvent
- `server/utils/workers-ai.ts:readStreamedTextResponse` 改用 `readSseStream`，block handler 認 `[DONE]` sentinel + json delta
- `web-chat-sse-streaming` spec 新增 Requirement：SSE transport SHALL emit liveness signal at least every N seconds while stream is open；既有 first-token / cancel / outcome contract 不變

## Non-Goals

- **NEVER** 改 SSE event type / payload shape（`ready` / `delta` / `complete` / `refusal` / `error` 仍 1:1）
- **NEVER** 改 first-token latency 或 cancel 語意
- **NEVER** 動 MCP 端的 SSE / streaming（MCP via DO transport，已有 SSE channel，不在本 change scope）
- **NEVER** 引入 WebSocket 或 alternative transport（heartbeat 是 SSE 內 minimal patch）
- 不調整 evlog SSE 觀測欄位（既有 wide event 已含 first-token / total duration）

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-chat-sse-streaming`: 新增 SSE liveness / heartbeat requirement；既有 first-token 觀測 / cancel / outcome 行為不變但需 doc heartbeat 不影響 first-token measurement（避免把 keep-alive 行誤算成 first delta）

## Affected Entity Matrix

本 change 不觸動 DB schema、enum、shared types、或 migration。不需要 Entity Matrix。

## User Journeys

**No user-facing journey (backend-only, SSE plumbing resilience)**

理由：本 change 純粹改善 SSE transport 的長連線韌性與 reader 模組共用度。Web chat UI 看到的事件類型與時序不變；唯一可感知差異是「Workers AI 首 token 延遲 > 30s 時不再掉線」，這是隱性可靠性提升，不引入新 user surface 或新互動。MCP / admin / auth 流程完全不受影響。

## Implementation Risk Plan

- **Truth layer / invariants**: SSE event contract 由 `web-chat-sse-streaming` spec 定義；keep-alive 必須走 SSE 註解語法（`:` 開頭行），client EventSource / fetch reader 應自動 ignore；`shared/utils/sse-parser.ts` 是 client + server 雙端共用模組，DOMException-based AbortError 跨 runtime 一致；既有 wide event 觀測欄位（first-token-ts / total duration）不得受 heartbeat 干擾
- **Review tier**: Tier 2 — 動 SSE 流核心 + 抽 shared util 跨 client/server，行為敏感（heartbeat 時序、abort race、reader release），但無 schema / auth / permission / raw SQL 動到；spectra-audit + code review
- **Contract / failure paths**: heartbeat 在 `closed` 旗標 set 後不得再 enqueue（避免 `enqueue() on closed controller`）；abort 中 keep-alive 迴圈須與 reader cancel 一起收尾；shared reader 對 malformed SSE block / 中途 reader.cancel / signal abort / source disconnect 四種失敗路徑須與既有兩處 caller 行為等價（既有 `ChatStreamError` / workers-ai 終止語意不變）
- **Test plan**: Unit — `test/unit/sse-parser.spec.ts` 覆蓋 normal block / multi-block buffer / partial trailing block / abort mid-stream / decoder UTF-8 邊界；擴充 `test/unit/chat-stream.test.ts` 確認 readChatStream wrapper 仍綠；擴充 `test/unit/workers-ai.test.ts` 確認 [DONE] sentinel 仍正確終止；新增 keep-alive heartbeat unit test（mock slow first-token，assert `: keep-alive` block 至少送一次）；Integration — 沿用既有 chat SSE integration test 確認 contract 不破；Manual — production observability 驗證 30s+ 延遲 chat 不再掉線
- **Artifact sync**: `openspec/specs/web-chat-sse-streaming/spec.md`（spec delta：加 liveness requirement）、`docs/tech-debt.md`（archive 時 TD-015 + TD-019 改 done + Resolved），無 migration / 無 env var / 無 runtime config 變更 / 無 wrangler binding 變更

## Impact

- Affected specs: `web-chat-sse-streaming`（Modified — 加 SSE liveness / heartbeat requirement）
- Affected code:
  - Modified: `server/api/chat.post.ts`, `app/utils/chat-stream.ts`, `server/utils/workers-ai.ts`, `test/unit/chat-stream.test.ts`, `test/unit/workers-ai.test.ts`
  - New: `shared/utils/sse-parser.ts`, `test/unit/sse-parser.spec.ts`
  - Removed: (none)
- Dependencies / bindings: 無新套件、無 env var、無 runtime config、無 wrangler binding 變更
- Parallel change coordination: 與 MCP DO 主軸完全獨立（後者透過 DoJsonRpcTransport，不經 createSseChatResponse），可獨立推進
