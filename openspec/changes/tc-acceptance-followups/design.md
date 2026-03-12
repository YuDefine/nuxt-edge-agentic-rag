## Context

TC-12/13/15/18 acceptance 自動化過程中，主線整合者透過 `vi.mock('../../server/utils/database', ...)` 規避 `hub:db` 在 vitest 環境的 resolution 失敗，事後審查暴露三個累積的硬化缺口：

- 測試環境侵蝕：每個 integration test 各自重複 mock，4 個 pre-existing test 檔（chat-route / citations-route / mcp-routes / publish-route）長期紅燈卻無人修
- MCP 稽核漏洞：restricted token 越權嘗試 `getDocumentChunk` 後只回 403、不寫 query_logs，違反 `Masked Audit Records` 對 attempted access 必須留軌跡的要求
- 高風險輸入分級不一致：信用卡號落 `PHONE_PATTERN` 走 redact-only，但與其他 credential（api_key、sk-）的 block 行為不對稱

三者性質不同（test infra / production audit / governance pattern），但都從同一次 commit 被識別、且都不在既有 change scope 中，合併為一個 followup 比拆三個 propose 高效。

## Goals / Non-Goals

### Goals

- 建立可重用的 `hub:db` mock helper，淨修復 12 個 pre-existing test fail
- 補齊 MCP restricted 越權的 audit chain（query_logs 留紀錄 + risk_flags）
- 對齊高風險輸入治理，信用卡號改走 block 而非 redact-only
- 文件化測試環境 mock 慣例與新增的治理 patterns

### Non-Goals

- 不擴展 redaction / block 到其他 PII（電話、email、身分證號）
- 不重構 `mcp-replay.ts` 整套架構，只在 403 throw 前加 INSERT
- 不修改 TC-01~03 既有測試語意（只改 mock 來源）
- 不引入 admin-tunable PII 配置層
- 不依賴 `admin-ui-post-core` query logs UI 才能驗證稽核（用 wrangler d1 查即可）

## Decisions

### 共用 hub:db mock helper 放在 `test/integration/helpers/database.ts`

**選擇**：新建 helper 檔，export `mockD1DatabaseModule(getMockBindings)`，呼叫端在 `vi.mock` 內傳入 closure 取得當前測試的 bindings。

**理由**：

- TC test 與 route test 共享一致 mock，避免實作飄移
- closure 模式讓每個測試的 `beforeEach` 重置 bindings 後不需重新 setup mock
- 集中於 `test/integration/helpers/` 對齊既有 `nuxt-route.ts` pattern

**替代方案**：

- 放到 `test/acceptance/helpers/bindings.ts` — 否決，因 4 個 pre-existing test 不在 acceptance scope
- 用 `vitest.config.ts` 全域 mock — 否決，無法 per-test 提供不同 bindings

### MCP restricted 越權的 query_logs INSERT 放在 `mcp-replay.ts`

**選擇**：在 `server/utils/mcp-replay.ts` 中 throw `McpReplayError` 前 INSERT query_logs，呼叫端 handler 不需感知。

**理由**：

- `mcp-replay.ts` 是 restricted scope check 的權威所在，audit 寫入緊鄰決策邊界最安全（不會被 catch 漏掉）
- handler 端只負責 HTTP response 轉換，不應重複實作 audit 寫入
- 避免兩處 INSERT 競態（accepted 路徑由 ask handler 寫、blocked 路徑由 replay 寫）

**替代方案**：

- 在 `server/api/mcp/chunks/[citationId].get.ts` catch `McpReplayError` 後寫 — 否決，多個 mcp endpoint 都會用 mcp-replay，分散在每個 handler 容易遺漏
- 加 middleware 統一寫 — 否決，過度抽象，目前只有一個越權場景

### `CREDIT_CARD_PATTERN` 用通用 13-19 位數字 with separators，不做 Luhn 驗證

**選擇**：`/\b(?:\d[ -]?){13,19}\b/g`，不檢查 Luhn checksum。

**理由**：

- 治理目標是「使用者輸入像信用卡號的字串就拒答」，不是「真的是有效信用卡才拒答」
- Luhn 驗證需要額外處理（去除 separator、計算）增加 audit 路徑複雜度
- 寬鬆 pattern 寧可 false positive 也不能 false negative（合規優先）

**替代方案**：

- Luhn 驗證 — 否決，過度精確不符合治理意圖
- 只比對特定卡別前綴（4xxx Visa、5xxx Mastercard）— 否決，限縮覆蓋面

### `risk_flags_json` 新增兩個 flag：`restricted_scope_violation` 與 `pii_credit_card`

**選擇**：用 snake_case 沿用既有 flag 命名慣例（如既有 `pii`、`credential` flag）。

**理由**：

- 與既有 `risk_flags_json` schema 一致，admin UI / query logs 過濾不需特殊處理
- snake_case 對 SQL LIKE / JSON containment 查詢友善

## Risks / Trade-offs

- **[Risk] 抽 helper 時破壞既有 5 個 TC test 的 mock 行為** → Mitigation：先寫 helper + 測試新檔（chat-route 等 4 檔），確認 12 個 fail 變綠後再 refactor TC test，每個 TC 重新跑 vitest 確認；refactor 一次只改一檔
- **[Risk] MCP query_logs INSERT 在 throw 前失敗造成兩段失敗訊息混淆** → Mitigation：包 try/catch，INSERT 失敗只 log.error 不影響原本 throw；測試案例覆蓋 INSERT 失敗 + throw 同時發生的情境
- **[Risk] `CREDIT_CARD_PATTERN` 寬鬆 regex 誤判 SOP 文件中的訂單編號** → Mitigation：限定 13-19 位 + 連續 separator 才匹配，並在 risk_flags 加 `pii_credit_card` 而非 `credential`，便於後續分析誤判率；上線後監控 query_logs 中此 flag 觸發頻率
- **[Risk] refactor 期間 TC-01~18 與 4 個 pre-existing 短暫不一致** → Mitigation：tasks 順序保證 helper 先建立、4 個 pre-existing 先修、TC test 後 refactor；commit 切分讓每階段都可獨立驗證

## Migration Plan

### 部署順序

1. Helper 與 4 個 pre-existing fix（test infra only，不動 production code，可先 commit）
2. MCP query_logs INSERT（production code，需 staging 驗證 audit 紀錄）
3. CREDIT_CARD_PATTERN（production code，需 staging 驗證拒答）
4. TC test refactor（清理 boilerplate，最後做避免影響前面的驗證）
5. 文件更新（同步進每個 commit）

### Rollback

- 缺口 1：revert helper commit，恢復各自 mock（測試會回到之前狀態）
- 缺口 2：revert mcp-replay.ts INSERT，restricted 越權回到「只 403 不留 log」（與 commit 13820db 之前一致）
- 缺口 3：revert knowledge-audit.ts pattern 加入，信用卡號回到 redact-only（與目前一致）

每階段獨立可 revert，不會造成 schema migration 卡死。

## Open Questions

- INSERT 失敗時要不要把 audit chain 視為 best-effort（log.error 不阻擋 throw）還是 fail-loud（兩個 error 都 surface）？預設 best-effort，待 staging 觀察後決定
- `CREDIT_CARD_PATTERN` 是否應該同時加入 `risk_flags_json` 的 `pii` 通用 flag 還是只用 `pii_credit_card` 細分？預設只用細分，便於分流；若 admin UI 過濾以 `pii` 為主再回頭加
- TC test refactor 是否應該等所有 acceptance TC（含未做的 TC-04, 06-11, 14, 16-17, 19-20）都完成後一次重構？預設不等，現有 5 個先 refactor，未來 TC 直接套用 helper
