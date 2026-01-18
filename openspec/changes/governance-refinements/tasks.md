## 1. Conversation Lifecycle Governance

- [ ] 1.1 建立 stale conversation resolver，依最新 assistant `citations_json.document_version_id` 與 D1 `is_current` 動態重算。
- [ ] 1.2 更新 Web chat follow-up 路徑，讓 stale 對話改走 fresh retrieval，而不是沿用舊引用鏈。
- [ ] 1.3 在 conversation list/detail API 全面套用 `deleted_at` 過濾與可見性邏輯。
- [ ] 1.4 實作對話刪除時的 `title` / `messages.content_text` purge policy，確保原文不可回復。
- [ ] 1.5 保留 audit-safe residue，但禁止其重新回到一般 UI/API 與模型上下文。
- [ ] 1.6 補齊對話刪除與 stale follow-up 的 integration tests。

## 2. Retention Cleanup Governance

- [ ] 2.1 建立共享 retention policy constants，涵蓋 `query_logs`、`citation_records`、`source_chunks.chunk_text` 與 token metadata。
- [ ] 2.2 實作 scheduled cleanup job，確保過期清理按完整 audit chain 協調執行。
- [ ] 2.3 保護 retention window 內的 replay 契約，驗證 retention 內仍可 `getDocumentChunk` 回放。
- [ ] 2.4 建立 backdated record / shortened TTL 驗證路徑，供 staging 測試 cleanup。
- [ ] 2.5 補齊 cleanup run、過期 replay 與 retention 邊界的驗證與操作文件。

## 3. Config Snapshot Governance

- [x] 3.1 定義 shared `config_snapshot_version` builder，收斂 thresholds、model roles 與 governed feature flags。
- [x] 3.2 讓 Web、MCP、acceptance exports 與 query logs 都統一寫入 shared version。
- [x] 3.3 建立 drift guard，阻擋 routes、tests、debug surfaces 自行 hardcode decision thresholds。
- [x] 3.4 補齊 config snapshot version bump 與 cross-surface 一致性的 regression tests。

## 4. Verification And Rollout

- [ ] 4.1 更新 `docs/verify/**` 與相關驗收文件，補上 stale、delete purge、retention cleanup、config snapshot 的驗證步驟。
- [ ] 4.2 產出 rollout checklist，列出 cleanup schedule、retention threshold 與 purge policy 的部署前確認項。
