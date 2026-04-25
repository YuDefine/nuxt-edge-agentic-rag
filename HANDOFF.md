# Handoff

## In Progress

- 無 active spectra change（`fix-fk-rebuild-query-logs-chain` 已於 v0.50.1
  archive 至 `openspec/changes/archive/2026-04-26-fix-fk-rebuild-query-logs-chain/`）
- `local/excalidraw-diagram-workbench` 有他人 session 留下的 24 檔 WIP
  （非本 repo 主線變更，submodule pointer 未變動），需該 session 自行處理

## Blocked

無（v0.50.1 已 push tag，production workflow 已啟動）

## Next Steps

1. **Production deploy 監看** — `gh run list --workflow=deploy.yml --limit=3`
   或 `gh run watch <production run id>` 確認 v0.50.1 production workflow
   通過。本次 deploy 對 D1 是 0015 的慢 no-op（FK 文字本來就 canonical），
   風險低。
2. **TD-055 production D1 對照（archived task 2.8 / 4.5）** —
   production v0.50.1 deploy 後，跑
   `pnpm wrangler d1 execute agentic-rag-db --remote --command "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%REFERENCES %_new(%';"`
   確認回 0 列，以及 `PRAGMA foreign_key_check;` 乾淨。預期 no-op。
   下次 wrangler login 或 deploy 順手做即可。
3. **TD-057 evlog wide event lifecycle 警告** — `[evlog] log.error()
called after the wide event was emitted` 在 production wrangler tail
   出現，影響 SSE stream 真實錯誤可觀察性。獨立 mid 優先 change。
4. **TD-056 judge 模型 max_completion_tokens 200 截斷** — 特定 query
   觸發 JSON parse 失敗 → pipeline_error；persist-refusal 已 cover UX，
   低優先。
5. **TD-049 / TD-050 / TD-047** — 詳見
   `openspec/ROADMAP.md` Next Moves 區塊。
6. **Parked changes** — `add-mcp-token-revoke-do-cleanup`、
   `passkey-user-profiles-nullable-email` 仍 parked，待使用者決定
   unpark / 重排 / drop。

## 注意事項

- v0.50.1 ship：TD-055 修 fresh local libsql 的 FK `_new` 殘留問題。
  對 production D1 是 no-op（FK 文字本來就 canonical），driver
  binding / API 都未變。下次 fresh local dev session 不再需要走
  `.bak-pre-mcptokens-fk` / `.bak-pre-querylogs-fk-v2` 那套
  ad-hoc SQL patch。
- NuxtHub 0.10.7 default `migrationsDirs` 是 `server/db/migrations`
  但本 repo 在 `server/database/migrations`——導致 fresh local DB 重啟
  不會自動 apply migration。本次驗證走「restore backup + sqlite3 cli
  直接套 0015 + 註冊 \_hub_migrations」等價路徑。這是獨立於 TD-055
  的 infra issue，未 register；下次撞到再決定要不要開單。
