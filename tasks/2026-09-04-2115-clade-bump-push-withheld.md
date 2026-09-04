# clade bump 連續 4 版 push-withheld 排查

**開工**：2026-09-04 21:15　**pane**：w7:pCB（由 clade 主線 w7:pC7 派出）

## 訊號
`node scripts/propagate.ts` 對本 repo 連續 4 版（v1.12.12 → v1.12.15）回 `push-withheld`，
最舊已 26 小時。`git rev-list --count @{u}..HEAD` = 5。

## 成因（已查明，非猜測）
clade `scripts/propagate.ts` 的 `shouldPush()`：branch 上存在**任一** propagate 自己沒建的
未推 commit（collateral）時，整批 withhold 並要求人工 review 後自行 push。

本 repo 的 collateral 是 `01bc7a09`（2026-09-03 19:11，`HANDOFF.md` 一行，TD-904 chore，
Charles 授權的全 fleet purge-injected-decisions 清理）。它一旦落在 main 且沒被推，
之後**每一趟** propagate 都會被同一顆 commit 擋住 —— 這是自我維持的累積形狀，
與 TD-270（nuxt-supabase-starter 靜默落後 67 版）同源。

判定：**不是刻意保留，是沒人推**。01bc7a09 內容是已授權的 chore，可安全落地。

## 並行協調（session-tasks § 並行爭用 Step 0）
同 repo 另有 w7:pCA 在跑 TD-912（scripts.tag 移除 git push）。已 `herdr agent prompt` 詢問並取得回覆：
- 它只改 `package.json` 一行（`git tag v… && git push origin --tags` → `git tag v…`），0 commit
- 43 個 dirty 檔（含 `.cursor/**` 整批刪除）**不是**它造成的，mtime 早於它開工
- 它沒碰 pre-push hook / propagate

→ 兩件事無關。我的 push 只推既有 5 個 commit（純 ff），不動 working tree / index。

## 動作
- [x] 查明 withheld 成因（非直接 push）
- [x] 與 w7:pCA 協調
- [x] `git push origin main` → `@{u}..HEAD` 歸零（2026-09-04 21:2x，4a9b68d5..6480a6ed，pre-push 全綠 exit 0）
- [x] 登記 TD-072
