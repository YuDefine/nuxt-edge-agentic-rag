## Context

bootstrap change 已經把 redaction、retention window 與 current-version-only 寫進核心 specs，但報告還有一批更細的治理語意尚未被落成 executable artifact：

- 刪除對話後，`title` 與 `messages.content_text` 不能只是從 UI 隱藏，而是必須清空、硬刪除或進入不可回復狀態。
- Web follow-up 不得把舊版本引用當作永久真相；當引用版本不再 current 時，對話必須被視為 stale 並重新檢索。
- `config_snapshot_version` 不是裝飾欄位，而是所有 acceptance 統計能否比較的前提。

這些都屬於報告要求的程式碼面，不補上就很難宣稱 v1.0.0 的治理條件已完整實作。

## Goals / Non-Goals

**Goals:**

- 把對話生命週期、cleanup 排程與 config snapshot 版本治理從報告文字變成可實作、可測試的行為。
- 明確切開 user-visible data 與 audit-only residue，避免刪除與 retention 規則互相衝突。
- 確保 Web、MCP、tests、debug surfaces 都共享同一套 threshold / feature flag 版本來源。

**Non-Goals:**

- 不在此 change 中新增 dashboard、debug 面板或額外運營指標。
- 不改變 `v1.0.0` 的 feature scope，例如 Passkey、MCP Session 或 Cloud fallback。
- 不為了 cleanup job 方便而削弱 retention 期間的 replay 契約。

## Decisions

### Conversation Lifecycle Is Dynamic, Not Cached Truth

stale 判定只可由最新 assistant message 的 `citations_json.document_version_id` 與 D1 `is_current` 動態重算。若為效能考量加上快取欄位，那也只能是衍生資訊，不能取代正式判定。這保證版本切換後，follow-up 不會錯誤沿用舊版知識。

### Delete Means Content Becomes Irrecoverable To Users

刪除對話後，對一般 UI 與 API 來說，該對話必須立即消失；同時 `title` 與 `messages.content_text` 需要被清空、硬刪除或進入不可回復狀態。允許留下的只有遮罩後審計副本與必要事件 metadata，而且這些資料不得重新回到使用者讀取路徑或模型上下文。

### Retention Job Protects Replay Window First

cleanup 的目標不是越快刪越好，而是在 180 天內完整保留 replay 所需證據，超過門檻後再一致地過期。這代表 cleanup job 必須同時理解 `query_logs`、`citation_records`、`source_chunks.chunk_text` 與 revoked token metadata，而不能只刪某一張表。

### Config Snapshot Version Is A Shared Governance Contract

`config_snapshot_version` 必須由共享 runtime config 或等價 shared module 推導，包含 thresholds、model roles、feature flags 與環境差異。任何 surface 都只能讀取，不得自行 hardcode。當門檻值或 flag 組合變更時，版本需要同步遞增，否則 acceptance 統計無法比較。

## Risks / Trade-offs

- [刪除與稽核衝突]：若沒有清楚區分 content purge 與 audit residue，容易不是刪太多，就是殘留可還原原文。
- [cleanup 破壞 replay]：若只按單表 TTL 清理，可能讓 retention 內的 citation replay 失效。
- [threshold drift]：若 debug UI、tests、MCP routes 各自硬編常數，`config_snapshot_version` 就會失去意義。
- [stale 重算成本]：每次 follow-up 都回查版本狀態會增加成本，但比錯用舊版知識安全。

## Migration Plan

1. 先補 shared governance helpers：stale resolver、delete purge policy、config snapshot builder、cleanup selector。
2. 再更新 conversations/chat/MCP 路徑，讓它們統一依賴 shared helpers。
3. 加上 scheduled cleanup job 與 backdated verification harness。
4. 最後補 integration tests 與 verify docs，讓這些治理規則成為可驗證行為，而不是口頭約定。

## Execution Strategy

### Dependency Order

1. `config-snapshot-governance`
2. `conversation-lifecycle-governance`
3. `retention-cleanup-governance`

### Validation Strategy

- Integration tests：對話刪除、stale follow-up、replay expiry、config version stamping
- Backdated verification：cleanup 以縮短 TTL 或 backdated records 驗證
- Manual confirm：檢查刪除後 UI/API 不再出現原文內容

## Open Questions

- cleanup job 最適合掛在 NuxtHub scheduled task、Cloudflare Cron 還是 repo 內既有 scripts，需依部署方式確認。
- `config_snapshot_version` 是否需要序列化成 human-readable 組合字串，還是 opaque version id 即可，需在實作前定案。
