## Why

`main-v0.0.36.md` 對治理語意寫得比目前 code 與 specs 更細，特別是對話刪除後的原文清理、stale 對話重算、180 天 retention cleanup 與 `config_snapshot_version` 的共用版本治理。這些規則如果只停留在報告正文，後續實作很容易各自 hardcode 或以 UI convenience 取代正式真相來源，最後造成 Web、MCP、cleanup job 與驗收資料彼此脫鉤。

## What Changes

- 把 conversation lifecycle、retention cleanup 與 config snapshot governance 從高層描述補成可執行的 specs 與 tasks。
- 明確定義對話刪除、`messages.content_text` 清理、stale follow-up 重算與 audit residue 的邊界。
- 補齊 180 天 retention cleanup 的排程、加速驗證策略與 replay-before-expiry / replay-after-expiry 契約。
- 收斂 shared config snapshot version 與 threshold source of truth，避免 chat、MCP、tests、debug UI 各自硬編常數。

## Non-Goals

- 不擴充新的 end-user 功能或改變 MCP 對外契約。
- 不把 retention 規則拉長到報告外的新資料類型，僅處理 `query_logs`、`citation_records`、`source_chunks.chunk_text` 與 token metadata。
- 不在這個 change 中實作新的 dashboard 或 debug 面板；那些屬於後續 UI changes。

## Capabilities

### New Capabilities

- `conversation-lifecycle-governance`: 對話刪除、stale 重算與上下文可見性治理。
- `retention-cleanup-governance`: 180 天保留、cleanup job 與 replay 過期契約。
- `config-snapshot-governance`: 共用常數版本、threshold source of truth 與驗收版本戳記治理。

### Modified Capabilities

(none)

## Impact

- Affected specs: `conversation-lifecycle-governance`, `retention-cleanup-governance`, `config-snapshot-governance`
- Affected code: `server/api/chat.post.ts`, `server/api/conversations/**`, `server/api/mcp/**`, `server/utils/**`, `shared/**`, `app/composables/**`, `scripts/**`, `docs/verify/**`
