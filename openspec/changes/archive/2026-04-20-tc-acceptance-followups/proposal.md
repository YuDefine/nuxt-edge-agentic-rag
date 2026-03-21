## Why

TC-12/13/15/18 acceptance 自動化（commit `13820db`）過程中暴露三個 production code 與 test infrastructure 缺口，互相獨立但都不在既有 change scope 內：

1. **`hub:db` 在 vitest 環境無法 resolve**，導致 4 個 pre-existing integration test 檔（chat-route / citations-route / mcp-routes / publish-route）共 12 個 fail；新增的 5 個 TC test 各自重複 `vi.mock('../../server/utils/database', ...)` boilerplate
2. **`getDocumentChunk` restricted 越權回 403 時不寫 `query_logs`**，違反 `Masked Audit Records` 與 `restricted scope governance` 的稽核契約 — 攻擊者可重複嘗試而不留痕跡
3. **`CREDIT_CARD_PATTERN` 未列入 `CREDENTIAL_PATTERNS`**，使用者輸入信用卡號（如 `4111-1111-1111-1111`）只被遮罩、不會 block，與 `Masked Audit Records` 對高風險輸入「拒答 + 不落原文」的預期不一致

這些缺口都是 staging 上線前必須補齊的硬化工作，但拆分為三個獨立 change 會造成過度切割（test infra 與 production code 共享測試驗證），合併成一個 followup change 比較精準。

## What Changes

### 缺口 1：抽 hub:db mock 共用 helper

- **新增** `test/integration/helpers/database.ts`，export `mockD1DatabaseModule(mocks)`
- **修改** `test/integration/{chat-route,citations-route,mcp-routes,publish-route}.test.ts`，套用 helper（淨修復 12 個 pre-existing fail）
- **重構** `test/integration/acceptance-tc-{01,12,13,15,18}.test.ts`，改用共用 helper 移除重複 boilerplate
- **文件化**於 `docs/verify/TEST_DRIVEN_DEVELOPMENT.md` 補 `hub:db` mock 章節

### 缺口 2：MCP `getDocumentChunk` 403 路徑寫 query_logs

- **修改** `server/utils/mcp-replay.ts`：在 throw `McpReplayError` 前 INSERT `query_logs`：
  - `channel='mcp'`
  - `status='blocked'`
  - `risk_flags_json` 含 `'restricted_scope_violation'`
  - `config_snapshot_version` 對齊既有 audit chain
- **可能修改** `server/api/mcp/chunks/[citationId].get.ts`：若 catch + 寫 log 設計上更乾淨
- **修改** `test/integration/acceptance-tc-13.test.ts`：補 assert `query_logs INSERT` 含 `status='blocked'` 與 risk flag

### 缺口 3：信用卡號加入 credential block 路徑

- **修改** `shared/utils/knowledge-audit.ts`：新增 `CREDIT_CARD_PATTERN`，merge 進 `CREDENTIAL_PATTERNS`
- 確認 `risk_flags_json` 含 `'pii_credit_card'`、`shouldBlock=true`
- **新增** `test/fixtures/acceptance/seed/cases.json` case `seed-tc-15-credit-card`：prompt 含信用卡號 → expected `refused`
- **修改** `test/integration/acceptance-tc-15.test.ts`：擴充覆蓋信用卡號 block 路徑

### 文件補齊

- **修改** `docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md` 或 `docs/verify/RETENTION_CLEANUP_VERIFICATION.md`：補 restricted audit trail 與 credit card block 治理段落

## Non-Goals

- 不擴展 redaction / block 到其他 PII 類型（電話、email、身分證號）— 留給未來獨立 change 評估
- 不重構 `mcp-replay.ts` 整套架構，只在 403 throw 前加 INSERT
- 不修改 TC-01 ~ TC-03 既有測試語意（只改 mock 來源至共用 helper）
- 不引入新的 redaction 配置層（如 admin-tunable PII 列表）— v1.0.0 維持 hardcoded patterns
- 不依賴 `admin-ui-post-core` 的 query logs UI 才能驗證稽核紀錄（用 `wrangler d1 execute` 查即可，UI 完成後再追加人工檢查）

## Capabilities

### New Capabilities

- `mcp-restricted-audit-trail`：MCP restricted scope 越權嘗試必須寫入 query_logs 留下稽核軌跡，包含 token_id、attempted_citation_id、status='blocked' 與 risk_flags

### Modified Capabilities

- `web-chat-ui`：擴充高風險輸入治理範圍納入信用卡號 block（不只遮罩）— 影響使用者在 chat 輸入信用卡號時的視覺回饋與拒答訊息

## Impact

- **Affected specs**:
  - `mcp-restricted-audit-trail`（新建）
  - `web-chat-ui`（modified — 信用卡號治理段落）
- **Affected code**:
  - `server/utils/mcp-replay.ts`（query_logs INSERT in 403 path）
  - `server/api/mcp/chunks/[citationId].get.ts`（可能調整 catch 流程）
  - `shared/utils/knowledge-audit.ts`（CREDIT_CARD_PATTERN）
  - `test/integration/helpers/database.ts`（新增）
  - `test/integration/{chat-route,citations-route,mcp-routes,publish-route}.test.ts`（修復）
  - `test/integration/acceptance-tc-{01,12,13,15,18}.test.ts`（重構或擴充）
  - `test/fixtures/acceptance/seed/cases.json`（新 case）
- **Affected docs**:
  - `docs/verify/TEST_DRIVEN_DEVELOPMENT.md`（test infra 章節）
  - `docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md` 或 `RETENTION_CLEANUP_VERIFICATION.md`（治理段落）
- **Affected milestones**：v1.0.0 staging hardening；不阻擋核心閉環，但建議 staging 驗收前完成
- **Runtime / bindings**：無新增 binding；無 schema migration（query_logs 既有 columns 已涵蓋）
- **Governance**：對齊 `Masked Audit Records` 與 `restricted scope governance`，不改變 config snapshot 結構
