# Handoff

## In Progress

- 無 active spectra change（v0.47.0 已 deploy，staging 綠燈、tag 已推）

## Blocked

- 無

## Next Steps

1. **Pop 兩個 stash 還原 active session WIP**（最緊急）：
   - `stash@{0}: wip-2-active-work-during-rebase-prep` — rebase 期間額外
     抽離的 active session 變更
   - `stash@{1}: wip-before-rebase-drop-5d4356e-747bb91` — 早期 stash 的
     原始 untracked 與 modified
   - 注意：`local/excalidraw-diagram-workbench` submodule pointer 在 commit
     期間已從 `c8f70cd` bump 到 `c38fbdd`（commit `7b3ec64`），pop 時若舊
     stash 帶不同 sha，依現況判斷保留哪個

2. **TD register 更新**：本次 release 涉及多個 TD，逐一回頭核對 status：
   - TD-019 evalite regression exit code wrapper — 已合入 (`c610c04`)，
     可標 done；待 evalite 升級後再拆 wrapper
   - TD-029 MCP alias drift gate — 已合入靜態 spec (`179607c`)，可標 done
   - TD-042 NuxtHub local KV bridge — 已合入 (`d4faa0e`)，可標 done
   - TD-016 abort utility 抽出 — **僅完成 utility 與 unit spec
     (`07c613c`)**；尚未 migrate `app/utils/chat-stream.ts`、
     `app/utils/chat-error-classification.ts`、`server/utils/workers-ai.ts`、
     `server/utils/web-chat.ts`、`server/api/chat.post.ts` 等 5 處重複實作。
     status 仍 in-progress

3. **`todo.md` 12 項報告待辦**：本次釋出處理 TODO-10（local KV bridge），
   其餘 11 項仍待跟進；TODO-07「stateful MCP 報告文字對齊 v0.46.0+」優先

## 注意事項

- 本 session 透過 `git push --force-with-lease` 改寫了遠端 history，
  drop 掉 commit `5d4356e`（無效的 .eslintignore/.prettierignore）與
  `747bb91`（excalidraw submodule pointer 至 `e78cd54`，已重新 bump 至
  `c38fbdd`）。若有其他 fetch 過舊 history 的 clone，需 `git fetch &&
git reset --hard origin/main`
