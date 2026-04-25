# 人工檢查歸檔

已完成的人工檢查項目會由 `/review-archive` 追加到下方分隔線之後，最新紀錄排在最上面。

---

## 2026-04-25 — `add-mcp-tool-selection-evals`

> Specs: `mcp-tool-selection-evals`

- [x] #7.1 使用者 review `test/evals/fixtures/mcp-tool-selection-dataset.ts` 的 query 文案，確認每筆代表典型真實使用者提問（非造假 / 非模板化）
- [x] #7.2 使用者檢視首次 baseline 分數合理性：若 overall < 70% 或任何個別 tool 完全掉分，代表 metadata / description 可能有問題，需討論是否進 `enhance-mcp-tool-metadata` apply 後再 rebaseline
- [x] #7.3 使用者確認 `.env.example` 與 `docs/evals/mcp-tool-selection.md` 的 API key 命名、警語、成本估算足夠清楚，新進 contributor 跑 `pnpm eval` 不會意外燒錢

> ✅ 全部歸檔於 2026-04-25 → docs/manual-review-archive.md

---

## 2026-04-25 — `fix-user-profile-id-drift`

> Specs: `auth-storage-consistency`

- [x] #9.1 使用者依 Task 7.1 cleanroom 跑一次，`/api/chat` 200 — 使用者 OK 2026-04-25：live INSERT branch verify ✓（建 `verify-td044@example.com` user → user_profiles row id 與 user.id 一致 `R3Eh0yMx...`）。`@followup[TD-045]` cleanroom rebuild aspect 仍 deferred
- [x] #9.2 使用者依 Task 7.2 stale row 情境跑一次，`/api/chat` 200 + DB 顯示 children 遷移正確 — 使用者 OK 2026-04-25：live migrate branch verify ✓（手動 DELETE user 保留 stale profile → re-login → user_profiles.id flip 至新 id `jtXc0Q4S...`、stale row 0 rows、新 row 1 row、email_normalized 一致；4 child UPDATE + parent.id flip 正確）
- [x] #9.3 使用者確認 production 部署後 1 週內 `wrangler tail --env production` 搜 `user_profiles sync failed` — 若 > 0 則讀 `hint` 判斷是否為預期情境（skip — archive 後 follow-up，登記 `@followup[TD-053]`；不阻擋 archive）
- [x] #9.4 使用者確認 `docs/decisions/2026-04-25-user-profiles-app-level-migrate.md` trade-off 與實作一致 — 使用者 OK 2026-04-25：ADR vs 實作預檢通過（5 Decisions + 3 Trade-offs 全部對齊 `server/utils/user-profile-sync.ts` + `server/auth.config.ts:488-502`）

> ✅ 全部歸檔於 2026-04-25 → docs/manual-review-archive.md

---

## 2026-04-25 — `add-new-conversation-entry-points`

> Specs: `web-chat-ui`

- [x] #7.1 進對話 A 中、點 chat header 新對話按鈕 → messages 清空 / sidebar A 不再 highlight / sessionStorage `web-chat:active-conversation:${userId}` key 移除 — 使用者 OK 2026-04-25：`e2e/new-conversation-button.spec.ts` (a) 全綠驗證
- [x] #7.2 新對話畫面點 sidebar 的對話 B → 載入 B 歷史 messages / sidebar B highlight / sessionStorage 寫入 B.id — 使用者 OK 2026-04-25：(b) 含 `expect.poll` 處理 async write
- [x] #7.3 點過新對話、未送任何訊息直接 reload → 仍是新對話畫面（不 auto-restore 任何舊對話）— 使用者 OK 2026-04-25：(c) 全綠
- [x] #7.4 完全沒點過新對話、沒切 sidebar 即 reload → auto-restore 上次對話（既有重度使用者體驗不退步）— 使用者 OK 2026-04-25：(d) 全綠
- [x] #7.5 在 `< lg` 視窗 drawer 開啟狀態下點側欄 collapsed plus 按鈕 → drawer 關閉 + 進新對話畫面 + sidebar 不再 highlight 任何項 — 使用者 OK 2026-04-25：(e) 全綠
- [x] #7.6 Safari private mode 點任一新對話按鈕 → 仍能進新對話畫面、無 error toast、無 console error（skip — 使用者 2026-04-25 授權 archive 前不驗；`clearConversationSessionStorage` helper 內建 try/catch 涵蓋 QuotaExceededError，理論上安全；登記 `@followup[TD-054]` 待後續 Safari 實機補上）

> ✅ 全部歸檔於 2026-04-25 → docs/manual-review-archive.md
> 備註：原 spec 5 個 scenarios 中 4 個失敗（selector 過寬、`addInitScript` reload 重 set storage、drawer/sidebar 雙 testid 撞 strict mode）。Claim 接手後修：(a)/(b) `getByTestId('conversation-row-button').filter` 鎖 row、(c) 改 `evaluate + reload` 設 storage、(b) 加 `expect.poll`、(e) `getByRole('dialog').getByTestId(...)` scope。修完 5/5 全綠（10.4s）

---

## 2026-04-25 — `consolidate-conversation-history-config`

> Specs: `web-chat-ui`

- [x] #7.1 實際在 local dev 登入 → 回首頁確認 `/api/conversations` 只發一次、sidebar 與 drawer 顯示同一列表
- [x] #7.2 點選舊 conversation → 訊息面板換成該 conversation 內容
- [x] #7.3 刪除 conversation → 從列表消失、若刪除的是 active 則訊息面板清空並顯示 cleared 提示
- [x] #7.4 手動觸發一次 refresh（送出新訊息建立新 conversation）→ 新 conversation 出現在列表、active 狀態正確
- [x] #7.5 故意把某個 active conversation 從 DB 刪掉再 refresh → cleared notification 出現、訊息面板清空

> ✅ 全部歸檔於 2026-04-25 → docs/manual-review-archive.md
