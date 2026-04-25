# Handoff

## In Progress

- [ ] **add-sse-resilience** apply 階段 4/6 完成（已 ship 至 v0.48.0，
      commit `cd43bf2`）。剩 archive 前的兩個收尾區塊：
  - 5.x spec/doc 同步（`/spectra-archive` 流程自動處理）
  - 7.x 人工檢查 3 項（local tail + production tail + first-token evlog
    抽樣，皆可立即驗收）
- 觸動檔案：`shared/utils/sse-parser.ts`、`server/utils/chat-sse-response.ts`、
  `app/utils/chat-stream.ts`、`server/utils/workers-ai.ts`、
  `server/api/chat.post.ts`，皆於 `cd43bf2` 入庫。
- TD-015 / TD-019 狀態仍 open，archive 時改 done + Resolved（tasks 5.2
  自動處理）。

## Blocked

- 無

## Next Steps

1. local `pnpm dev` 啟動後 curl `/api/chat` 一次（或 UI 發訊息），用
   `wrangler tail` / network panel 確認 SSE 流出現 `: keep-alive` 行
   （tasks 7.1）。
2. production `wrangler tail` 觀察一條真實 chat 請求，確認 keep-alive 行
   有出現（tasks 7.2）。
3. 從 production 抽 10 條 chat run，確認 first-token-ts 對 first delta
   event time 一致、未被 keep-alive 行誤計（tasks 7.3）。
4. 上述三項驗收完成 → 跑 `/spectra-archive add-sse-resilience`，archive
   流程會自動同步 spec delta 並把 TD-015 / TD-019 標 done。
5. **Parked changes**：`add-mcp-token-revoke-do-cleanup` 與
   `passkey-user-profiles-nullable-email` 仍 parked，待使用者決定
   unpark / 重排 / drop。

## 注意事項

- v0.48.0 修了 code-review 抓出的 heartbeat consumer-cancel race
  （`stopHeartbeat` lift 到外層 closure + `cancel()` 同步停 + try/catch
  兜底），`test/unit/chat-route-heartbeat.spec.ts` 加了 consumer-cancel
  回歸 case。其他 minor / info findings（`SseBlock` wrapper 過薄、
  `onBlock` 回傳型別可簡化、`error as Error` cast 可加 instanceof guard）
  記錄為未來小幅改善，未在本次 scope。
- `local/excalidraw-diagram-workbench` submodule 仍 dirty（sha 不變，僅
  內部 working tree 未 commit），屬使用者個人操作範圍。
- `local/reports/archive/main-v0.0.54-working.md` 在 `/commit` Step 6 期間
  又被另一 session 改動，未納入本次 commit；屬於跨 session 並行 WIP。
