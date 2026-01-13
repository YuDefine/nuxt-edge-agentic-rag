> **標記說明**：`[P]` = 同版後置項（Post-core），須待六步最小閉環完成後才開始實作。

## 1. Foundations

- [x] 1.1 Schema & Runtime Config — 建立 `documents`、`document_versions`、`source_chunks`、`citation_records`、`messages`、`query_logs`、`mcp_tokens`、`user_profiles` 所需 schema、shared types 與 runtime config，覆蓋 `Runtime Admin Allowlist`、`Versioned Replay Truth`、`Masked Audit Records`、`Environment Isolation`。
- [x] 1.2 Auth & Allowlist — 串起 better-auth、Google OAuth、`ADMIN_EMAIL_ALLOWLIST` 與 `allowed_access_levels` 推導，落地 `Runtime Admin Allowlist` 與 `Channel Access Matrix`。

## 2. Document Lifecycle & Publish Pipeline

- [x] 2.1 Staged Upload — 實作 presign / finalize 流程與檔案驗證，完成 `Staged Upload Finalization`。
- [x] 2.2 Version Preprocessing — 實作 normalized text 前處理、`source_chunks` 預建與 smoke probes，完成 `Versioned Replay Truth`。
- [x] 2.3 Publish State Machine — 實作 publish state machine、同版 reindex guard 與 no-op 重送語意，完成 `Current Version Publishing`。

## 3. Web Answering Orchestrator

- [x] 3.1 Retrieval & Verification — 建立規則式 Query Normalization、AI Search 封裝與 D1 post-verification，完成 `Verified Current Evidence Retrieval`。
- [x] 3.2 Confidence Routing & Citation — 實作分段評分、judge / reformulation、拒答與引用組裝，完成 `Confidence Routed Answering` 與 `Citation Mapped Responses`。

## 4. MCP Contract Surface

- [x] 4.1 Token Auth & Scope — 建立 token 雜湊保存、scope 驗證與 401/403 邊界，完成 `Stateless MCP Authentication`。
- [x] [P] 4.2 Ask & Replay Tools — 實作 `askKnowledge` 與 `getDocumentChunk`，完成 `Stateless Ask And Replay`。
- [x] [P] 4.3 Search & Categories Tools — 實作 `searchKnowledge` 與 `listCategories`，完成 `Filtered Search And Categories`。

## 5. Governance & Environment Controls

- [x] 5.1 Rate Limits & Env Binding — 以 KV 實作各通道限流與環境綁定驗證，完成 `Per-Channel Rate Limits` 與 `Environment Isolation`。
- [x] 5.2 Redaction & Retention — 實作 redaction、`query_logs`／`messages` 寫入規則與 retention 清理流程，完成 `Masked Audit Records` 與 `Retention And Replay Window`。

## 6. Verification & Rollout

- [x] 6.1 Test Coverage & Smoke — 補齊 unit / integration / e2e coverage 與 staging smoke 驗證，覆蓋 `Runtime Admin Allowlist`、`Current Version Publishing`、`Confidence Routed Answering`、`Stateless Ask And Replay`、`Filtered Search And Categories`。
- [ ] 6.2 Manual Acceptance — 以人工檢查完成六步最小閉環驗收，確認 current-version-only、restricted 隔離、citation replay 與 redaction 都成立後，再開啟同版後置項。

## 7. Design Review

> 適用於所有涉及 UI 的 tasks（1.2 Auth UI、2.x 文件管理 UI、3.x 問答 UI）

- [x] 7.1 檢查 `.impeccable.md` 是否存在，若無則執行 `/teach-impeccable`
- [ ] 7.2 執行 `/design improve` 對 `app/pages/**`、`app/components/**`（含 Design Fidelity Report）
- [ ] 7.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [ ] 7.4 依 `/design` 計劃按 canonical order 執行 targeted skills
- [ ] 7.5 執行 `/audit` — 確認 Critical = 0
- [ ] 7.6 執行 `/review-screenshot` — 視覺 QA
- [ ] 7.7 Fidelity 確認 — `design-review.md` 中無 DRIFT 項

## 人工檢查

> 來源：`bootstrap-v1-core-from-report` | Specs: `knowledge-access-control`, `document-ingestion-and-publishing`, `web-agentic-answering`, `mcp-knowledge-tools`, `governance-and-observability`

- [ ] #1 實際以 Web User / Web Admin 走登入與導頁，確認 allowlist、角色與可見範圍符合規格。
- [ ] #2 以 `md` 或 `txt` 文件完成 presign → finalize → sync → publish → Web 問答 → 引用回放 的最小閉環。
- [ ] #3 將同一文件切到新版後重新提問，確認正式回答不再使用舊版內容，且舊 citation 在保留期限內仍可回放。
- [ ] #4 以未具 `knowledge.restricted.read` 的 token 驗證 `searchKnowledge` / `askKnowledge` 的 existence-hiding，以及 `getDocumentChunk` 的 `403` 邊界。
- [ ] #5 檢查 `query_logs`、`messages` 與 rate limit 結果，確認沒有未遮罩敏感資料且超限時正確回 `429`。
