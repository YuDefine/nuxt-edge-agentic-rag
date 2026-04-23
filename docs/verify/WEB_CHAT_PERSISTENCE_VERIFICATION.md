# Web Chat Persistence Verification

本文件對應 `complete-web-chat-persistence` change 的驗收與報告證據。目標是用可重跑的自動化流程，證明 Web 聊天已具備伺服器支撐的對話持久保存，而不是僅靠前端暫存。

## 驗證範圍

- 建立第一個 Web 對話時，`/api/chat` 會建立持久化 `conversationId`
- 重新整理頁面後，歷史列表與訊息內容會由伺服器狀態重建
- 選取歷史對話會切換到該對話的持久化訊息與引用
- 同一對話續問時，會重用既有 `conversationId`
- 刪除對話後，列表、詳情與重整後畫面都不再回復已刪內容

## 自動化覆蓋

### UI 端對端

- `e2e/chat-persistence.spec.ts`
- 驗證 create / reload / select / follow-up / delete 五個 checkpoint
- 每次成功執行會輸出：
  - `screenshots/chat-persistence/01-create.png`
  - `screenshots/chat-persistence/02-reload.png`
  - `screenshots/chat-persistence/03-select.png`
  - `screenshots/chat-persistence/04-follow-up.png`
  - `screenshots/chat-persistence/05-delete.png`
  - `docs/verify/evidence/web-chat-persistence.json`

### 應用層與狀態管理

- `test/integration/chat-route.test.ts`
- `test/integration/conversation-create.test.ts`
- `test/unit/chat-conversation-state.test.ts`
- `test/unit/chat-conversation-session.test.ts`
- `test/unit/chat-conversation-history.test.ts`

上述測試分別鎖定：

- `/api/chat` 建立或重用 `conversationId`
- `/api/conversations*` 讀取與刪除契約
- 前端 session restore / history select / delete eviction 行為

## 執行方式

```bash
pnpm exec playwright test e2e/chat-persistence.spec.ts
vp test run --config ./vitest.config.ts \
  test/unit/chat-conversation-state.test.ts \
  test/unit/chat-conversation-session.test.ts \
  test/unit/chat-conversation-history.test.ts \
  test/integration/chat-route.test.ts \
  test/integration/conversation-create.test.ts
rtk pnpm typecheck
```

## 證據對照

| Checkpoint  | 自動化證據                                    | 說明                                            |
| ----------- | --------------------------------------------- | ----------------------------------------------- |
| `create`    | `01-create.png` + `web-chat-persistence.json` | 首次送出不帶 `conversationId`，並建立持久化對話 |
| `reload`    | `02-reload.png` + `detailReadLog`             | 重整後仍以 detail read 重建訊息與引用           |
| `select`    | `03-select.png` + `detailReadLog`             | 歷史選取會切換到指定對話內容                    |
| `follow_up` | `04-follow-up.png` + `requestLog`             | 第二次送出沿用同一個 `conversationId`           |
| `delete`    | `05-delete.png` + `deleteLog`                 | 刪除後列表移除、detail 404、重整不回復          |

## 報告引用方式

`local/reports/latest.md` 若宣稱「Web 聊天訊息持久保存已完成」，應至少同時引用：

- 本文件 `docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md`
- `docs/verify/evidence/web-chat-persistence.json`
- `e2e/chat-persistence.spec.ts`

缺任一者，都不應把該能力寫成「已完成並驗證」。
