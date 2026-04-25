## 1. Shared SSE Reader API（plumbing 抽出）

- [x] 1.1 先寫 `test/unit/sse-parser.spec.ts` failing tests：normal block / multi-block buffer / partial trailing block / abort mid-stream / signal pre-aborted（throw `createAbortError`）/ decoder UTF-8 邊界 / Comment Block Detection（`: keep-alive` 等註解 block 不轉發給 onBlock）/ onBlock 回 `'terminate'` 跳出 loop / `response.body` 缺失 throw error
- [x] 1.2 實作 `shared/utils/sse-parser.ts`（export `readSseStream` + `ReadSseStreamInput` + `SseBlock`），對應 design Shared SSE Reader API：reader/decoder/buffer.split('\n\n') 主迴圈、Abort Race Handling（`signal.addEventListener('abort', () => reader.cancel(createAbortError()))` 配合 main loop `signal.aborted` 檢查 + finally 清 listener + releaseLock）、Comment Block Detection（block-level 過濾 lines 全 `:` 開頭時 skip）
- [x] 1.3 跑 `pnpm test test/unit/sse-parser.spec.ts` 全綠 + `pnpm typecheck` 全綠

## 2. chat-stream.ts 改用 shared reader

- [x] 2.1 確認既有 `test/unit/chat-stream.test.ts` 與 `test/unit/chat-container-streaming-contract.test.ts` 全綠（pre-refactor baseline，含 TD-047 onReady callback path）
- [x] 2.2 把 `app/utils/chat-stream.ts:readChatStream` 內部的 reader / decoder / buffer.split / abort / finally 改用 `readSseStream`，block handler 沿用既有 `parseChatStreamEvent` + `handleEventBlock` 邏輯（terminal 用 onBlock 回 `'terminate'`），保留 `ReadChatStreamInput` 簽章與 `onReady` callback 不變
- [x] 2.3 跑 chat-stream / chat-container-streaming-contract / chat-error-classification 三組 spec 全綠 + `pnpm typecheck` 全綠

## 3. workers-ai.ts 改用 shared reader

- [x] 3.1 確認既有 `test/unit/workers-ai.test.ts` 與 `test/unit/workers-ai-accepted-path-samples.test.ts` 全綠（pre-refactor baseline）
- [x] 3.2 把 `server/utils/workers-ai.ts:readStreamedTextResponse` 內部的 reader / decoder / buffer.split / abort / finally 改用 `readSseStream`，block handler 認 `[DONE]` sentinel（`onBlock` 回 `'terminate'`）+ JSON delta parsing，保留外部簽章與 emit 行為不變
- [x] 3.3 跑 workers-ai 兩組 spec + chat-route integration spec 全綠 + `pnpm typecheck` 全綠

## 4. Server SSE liveness heartbeat

- [x] 4.1 先寫 `test/unit/chat-route-heartbeat.spec.ts`（或擴充既有 chat-route spec）failing test：mock slow first-token（首 delta 延遲 ≥ 30s），assert `: keep-alive\n\n` block 至少 emit 1 次（驗證 Web chat SSE stream SHALL emit liveness signal during long idle gaps）；另一 case：terminal 後 controller closed flag set，liveness signal 不再 enqueue（避免 enqueue on closed controller）
- [x] 4.2 `server/api/chat.post.ts:createSseChatResponse` 的 `ReadableStream.start(controller)` 內加 Heartbeat Implementation: setInterval inside ReadableStream.start —— `setInterval(() => { if (closed) return; controller.enqueue(encoder.encode(': keep-alive\n\n')) }, HEARTBEAT_INTERVAL_MS)`，常數 `HEARTBEAT_INTERVAL_MS = 15000` 對應 design Heartbeat Interval: 15 seconds 並加 inline 註解寫明假設
- [x] 4.3 cleanup 路徑（terminal complete / refusal / error / abort）必呼叫 `clearInterval(heartbeat)` + 設 `closed = true`；abort listener 需與 heartbeat clearInterval 一起收尾
- [x] 4.4 跑 chat-route integration spec + heartbeat unit spec 全綠 + 全 unit + integration suite 確認無 regression

## 5. Spec / 文件同步

- [ ] 5.1 archive 時把 `openspec/changes/add-sse-resilience/specs/web-chat-sse-streaming/spec.md` delta 合併進 `openspec/specs/web-chat-sse-streaming/spec.md` 主規格（spectra-archive 自動處理）
- [ ] 5.2 archive 時 `docs/tech-debt.md` 把 TD-015（SSE 長連線缺 heartbeat）改 Status: done 並補 Resolved 一段；TD-019（SSE reader pattern 抽共用）同樣改 done 並補 Resolved

## 6. Verification

- [x] 6.1 `pnpm typecheck` 全綠
- [x] 6.2 `pnpm test --project unit` 全綠（含新增 sse-parser.spec.ts + chat-route-heartbeat 相關 spec + 既有 chat / workers-ai spec）
- [x] 6.3 `pnpm test --project integration` 全綠
- [x] 6.4 `pnpm spectra:followups` 確認無 drift（TD-015 / TD-019 marker 對應 register 已標 done）

## 7. 人工檢查

- [ ] 7.1 local `pnpm dev` 啟動後 curl 一次 chat（或 UI 發送），用 `wrangler tail` / network panel 觀察 SSE 流出現 `: keep-alive` 行（heartbeat 已 wire up）
- [ ] 7.2 production deploy 後 wrangler tail 觀察一條真實 chat 請求，確認 `: keep-alive` 行有出現
- [ ] 7.3 production 觀察 7 天，確認無 chat 異常掉線（對照觀察期前後的 evlog `chat.error` 計數，無顯著上升）@followup[TD-015]
- [ ] 7.4 確認 first-token latency evlog 欄位（existing wide event）不受 heartbeat 干擾（隨機抽 10 條 production chat run，first-token-ts 對 first delta event time 一致，無被 keep-alive 行誤計）
