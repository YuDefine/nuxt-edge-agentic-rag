## Context

Web chat SSE 流跨三層：(1) **server emit 端** — `server/api/chat.post.ts:createSseChatResponse` 透過 Web Standard `ReadableStream.start()` enqueue SSE 事件（`ready` / `delta` / `complete` / `refusal` / `error`）；(2) **server reader 端** — `server/utils/workers-ai.ts:readStreamedTextResponse` 讀 Workers AI upstream SSE 並 emit chat delta；(3) **client reader 端** — `app/utils/chat-stream.ts:readChatStream` 讀 server SSE 並轉 onTextDelta + onReady（onReady 為 TD-047 剛 land）+ terminal event。

兩個獨立但相關的問題：

- **TD-015 (long-connection liveness)**: CF Workers / edge / 中間代理對「長時間 idle SSE 連線」會主動關閉（觀察值 ~30s）。`createSseChatResponse` 在 `ready` 後到 Workers AI 首 token delta 之間若延遲 ≥ 30s（slow upstream / cold cache），client 看到 connection close，後續 retrieve / generate 結果無法送達 UI
- **TD-019 (reader drift risk)**: `readChatStream` 與 `readStreamedTextResponse` 兩處 SSE block parsing 行為（`reader.read()` → `decoder.decode({ stream: true })` → `split('\n\n')` → `buffer.pop()` → handle 每 block → abort handler 安裝 → finally `removeEventListener` + `releaseLock`）幾乎 1:1 雷同。差異只在 block handler（client 解 chat event type、server 認 `[DONE]` sentinel + JSON delta）。並行維護易漂移（一邊修 bug 另一邊漏改）

剛 land 的 TD-047 已把 `readChatStream` input 抽成 `ReadChatStreamInput` interface 並加 `onReady` callback；TD-016 已把 `isAbortError` / `createAbortError` 抽到 `shared/utils/abort.ts`。本 change 延續同方向：把 reader plumbing 也抽出，且把 server-side 的 liveness 補上。

## Goals / Non-Goals

**Goals:**

- SSE 長連線在 first-token 延遲 ≥ 30s 時不被中間層關閉（client 持續收到事件流）
- `app/utils/chat-stream.ts` 與 `server/utils/workers-ai.ts` 的 SSE reader plumbing 共用同一份模組，避免後續 drift
- 既有 SSE event contract（`ready` / `delta` / `complete` / `refusal` / `error` payload shape + 時序）完全不變
- 既有 first-token / total duration evlog 觀測欄位不受 heartbeat 干擾（heartbeat 不能誤算為 first delta）

**Non-Goals:**

- 不引入 WebSocket 或 alternative transport
- 不改 SSE event type / payload shape / cancel 語意
- 不改 Workers AI upstream（`readStreamedTextResponse` 的 `[DONE]` sentinel 解析邏輯保留，只把 reader plumbing 抽出）
- 不動 MCP DO transport（已自行處理 SSE 跨 DO，不經 createSseChatResponse）
- 不調整 evlog SSE 觀測 schema

## Decisions

### Heartbeat Interval: 15 seconds

每 15 秒 enqueue 一行 `: keep-alive\n\n`（SSE 註解語法，client EventSource 與 fetch reader 都會自動 ignore；`readSseStream` 的 block parser 也應跳過註解 block 不轉發）。

**Why 15s**: 顯著小於 CF / 多數 proxy 的 ~30s idle threshold，留 2x margin；同時不會過頻發送（每分鐘 4 行 < 200 bytes，bandwidth 與 evlog 噪音皆可忽略）。

**Alternatives considered**:

- 20s — 仍在 30s 內但 margin 較緊；若 proxy 採 25s threshold 會破
- 10s — margin 大但每分鐘 6 行，evlog 容易吵
- 動態 interval（基於上次 emit 時間）— 增複雜度，本 change 不必要

### Heartbeat Implementation: setInterval inside ReadableStream.start

`createSseChatResponse` 的 `ReadableStream.start(controller)` 內：

1. `const heartbeat = setInterval(() => { if (closed) return; controller.enqueue(encoder.encode(': keep-alive\n\n')) }, 15000)`
2. 用 `closed` boolean flag 守門（避免 race：upstream 完成後 controller close 仍有 in-flight tick）
3. `cleanup` 路徑（terminal / abort / error）必呼叫 `clearInterval(heartbeat)` + 設 `closed = true`

**Why setInterval over async loop**: setInterval 在 Workers runtime 內穩定，cleanup 語意清楚；async `while (true) await sleep(15000)` 需要額外管理 promise / abortcontroller，沒收益。

**Alternatives considered**:

- 只在「有 in-flight upstream」時 heartbeat — 增邏輯複雜度，每個 await 點都要插 hook
- 用 ReadableStream `pull()` — pull 是 backpressure mechanism，不適合 push timer

### Shared SSE Reader API

新增 `shared/utils/sse-parser.ts`：

```ts
export interface SseBlock {
  raw: string // 完整 block 文字（含 event:/data:/id: 行）
}

export interface ReadSseStreamInput {
  onBlock: (block: SseBlock) => Promise<'continue' | 'terminate'> | 'continue' | 'terminate'
  signal?: AbortSignal
}

export async function readSseStream(response: Response, input: ReadSseStreamInput): Promise<void>
```

**Behavior**:

- 若 `response.body` 缺失 → throw `Error('SSE stream missing body')`（caller 自己包成 domain-specific error）
- `signal.aborted` 起點檢查 → 立即 throw `createAbortError()`
- 主迴圈：`reader.read()` → `decoder.decode({ stream: true })` → `buffer.split('\n\n')` → `buffer = blocks.pop() ?? ''` → for each `block.trim()`（**忽略空 block 與註解-only block**）→ `await onBlock({ raw: block })`
- onBlock 回 `'terminate'` → 跳出 loop（caller 已拿到 terminal event）
- 任一點 `signal.aborted` → throw `createAbortError()`
- finally：`signal?.removeEventListener('abort', ...)` + `reader.releaseLock()`

**Why include comment-block filter inside parser**: heartbeat block (`: keep-alive`) 不該污染 caller 的 event stream，集中在 parser 層處理；caller (chat-stream / workers-ai) 不需重複加 filter。

**Why expose `'continue' | 'terminate'` instead of return value**: caller 對 terminal 條件不同（chat-stream 看 event type、workers-ai 看 `[DONE]` sentinel），傳入 callback decide 比 parser 內 hard-code 更乾淨。

**Alternatives considered**:

- AsyncIterator pattern — 跨 client/server 在 ESLint config 與 polyfill 上略麻煩；callback 簡單夠用
- 直接 export low-level `for-await` reader — caller 仍要重複 abort/finally 邏輯，沒解 TD-019 root cause

### Abort Race Handling

`readSseStream` 的 abort 處理沿用既有 `readChatStream` pattern（已驗證）：

- `signal?.addEventListener('abort', () => void reader.cancel(createAbortError()), { once: true })`
- main loop 多處檢查 `signal.aborted` → throw `createAbortError()`
- finally 清 listener + releaseLock

server emit 端的 heartbeat interval 必須 listen request abort：`createSseChatResponse` 既有 abort path 加一行 `clearInterval(heartbeat)`。

### Comment Block Detection

SSE 註解規則：以 `:` 開頭的行為註解。`readSseStream` block-level 過濾：

```ts
const trimmed = block.trim()
if (!trimmed) continue // 空 block
const lines = trimmed.split('\n')
if (lines.every((line) => line.startsWith(':'))) continue // 純註解 block (含 heartbeat)
await input.onBlock({ raw: trimmed })
```

**Why per-block not per-line**: SSE block-level 是 parser 自然單位，per-line filter 會增複雜度且不必要（mixed comment+data block 在實務 SSE 流幾乎不存在）。

## Risks / Trade-offs

- **[Risk] heartbeat interval 過大 / proxy threshold 比預期短**：若實際 proxy 用 12s threshold，15s heartbeat 仍會掉 → **Mitigation**: 把 interval 包成 const + 加 inline 註解寫明假設；future 觀察到 production 仍掉線再下調到 10s（bandwidth 仍可接受）
- **[Risk] heartbeat 與 first-token 觀測 race**：若 first-delta 與 heartbeat 同 100ms 內 emit，evlog 順序可能交錯 → **Mitigation**: first-token-ts 已在 emit `delta` 時打點，與 heartbeat 無直接耦合；確認 evlog 不把 `: keep-alive` 行誤算為 delta
- **[Risk] readSseStream 抽出後 chat-stream / workers-ai 行為微差導致 regression**：抽 helper 最常見的 trap → **Mitigation**: 嚴格 TDD，先擴充既有 chat-stream / workers-ai unit test 覆蓋 edge case（partial buffer / abort mid-stream / multi-block），再 refactor；refactor 前後都跑全 unit + integration suite
- **[Risk] shared 模組跨 runtime 邊界差異**：DOMException / TextDecoder / ReadableStream 在 browser 與 Workers runtime 都原生可用，但 ESLint 規則或 tsconfig 的 lib 設定可能漏 → **Mitigation**: 既有 `shared/utils/abort.ts` 已驗證 pattern；新檔案沿用同 import path / same lib 設定
- **[Trade-off] 集中 heartbeat 過濾在 parser 內**：caller 失去「拿到所有 raw block 的能力」 → 接受，因為 caller 從未需要這能力，集中在 parser 內讓 emit 端的 heartbeat 對 caller 透明

## Migration Plan

無 schema / 無 env var / 無 runtime config / 無 binding 變更。Deploy 路徑：

1. land code + tests → CI 全綠 → merge main
2. production deploy 後觀察 wrangler tail：confirm `: keep-alive` 行有出現在 chat SSE 流（local + production）
3. 觀察 7 天，confirm 無 regression（無 chat 連線異常掉線、無 evlog first-token 異常）
4. archive 時 TD-015 + TD-019 改 `done`

Rollback：純 code revert，無資料 / 配置殘留。

## Open Questions

無。15s heartbeat 是合理初始值，shared reader API 已對齊兩個現有 caller 的實際需求。
