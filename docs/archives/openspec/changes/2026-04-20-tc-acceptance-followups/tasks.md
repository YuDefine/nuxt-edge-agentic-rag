## 1. Test Infrastructure — 共用 hub:db mock helper 放在 `test/integration/helpers/database.ts`

- [x] 1.1 新建 `test/integration/helpers/database.ts`，export `mockD1DatabaseModule(getMockBindings)`，採 closure 模式讓 `vi.mock('../../server/utils/database', ...)` 在每次測試 beforeEach 重置 bindings 後仍能取得最新值
  - 2026-04-19 PASS：`test/integration/helpers/database.ts` 存在並 export `createHubDbMock({ database? })`（signature 比 task 敘述簡化但等效，已在 4 個 test 套用）。
- [x] 1.2 [P] 修復 `test/integration/chat-route.test.ts`：套用共用 hub:db mock helper，確認 3 個原本 fail 的測試變綠
  - 2026-04-19 套用：`import { createHubDbMock } from './helpers/database'`（test/integration/chat-route.test.ts:4）。
- [x] 1.3 [P] 修復 `test/integration/citations-route.test.ts`：套用共用 hub:db mock helper，確認 4 個原本 fail 的測試變綠
  - 2026-04-19 套用：`import { createHubDbMock } from './helpers/database'`（test/integration/citations-route.test.ts:3）。
- [x] 1.4 [P] 修復 `test/integration/mcp-routes.test.ts`：套用共用 hub:db mock helper，確認 3 個原本 fail 的測試變綠
  - 2026-04-19 套用：`import { createHubDbMock } from './helpers/database'`（test/integration/mcp-routes.test.ts:4）。
- [x] 1.5 [P] 修復 `test/integration/publish-route.test.ts`：套用共用 hub:db mock helper，確認 2 個原本 fail 的測試變綠
  - 2026-04-19 套用：`import { createHubDbMock } from './helpers/database'`（test/integration/publish-route.test.ts:3）。
- [x] 1.6 跑 `pnpm exec vp test run test/integration/{chat-route,citations-route,mcp-routes,publish-route}.test.ts` 確認 12 個 pre-existing fail 全部消除
  - 2026-04-19 PASS：4 檔 15 tests 全綠（chat-route×3、citations-route×5、mcp-routes×5、publish-route×2），12 個 pre-existing fail 全部消除。tasks 原敘述 count（3+4+3+2=12）對應 §1.2-§1.5 的「原本 fail 數」；實際 files 含額外既有 green tests 也全數保持綠燈，未引入 regression。

## 2. Test Infrastructure — TC test 重構移除重複 boilerplate

- [x] 2.1 [P] 重構 `test/integration/acceptance-tc-01.test.ts`：移除自有 `vi.mock('../../server/utils/database', ...)`，改用共用 helper
  - 2026-04-19 PASS：改用 `createHubDbMock({ database: () => (tc01Mocks.bindings ?? {}).DB })`，透過 dynamic `await import('./helpers/database')` 避開 vitest hoisting 限制；6 個 tests 全綠。
- [x] 2.2 [P] 重構 `test/integration/acceptance-tc-12.test.ts`：移除自有 mock 改用共用 helper
  - 2026-04-19 PASS：同上模式；1 個 test 全綠。
- [x] 2.3 [P] 重構 `test/integration/acceptance-tc-13.test.ts`：移除自有 mock 改用共用 helper
  - 2026-04-19 PASS：同上模式；1 個 test 全綠。
- [x] 2.4 [P] 重構 `test/integration/acceptance-tc-15.test.ts`：移除自有 mock 改用共用 helper
  - 2026-04-19 PASS：同上模式；1 個 test 全綠。
- [x] 2.5 [P] 重構 `test/integration/acceptance-tc-18.test.ts`：移除自有 mock 改用共用 helper
  - 2026-04-19 PASS：同上模式；2 個 tests 全綠。
- [x] 2.6 跑 `pnpm exec vp test run test/integration/acceptance-tc-*.test.ts` 確認 11 個 acceptance test 仍全綠
  - 2026-04-19 PASS：5 個重構檔案 11 個 tests 全綠（TC-01×6、TC-12×1、TC-13×1、TC-15×1、TC-18×2）。同 glob 跑 19 個檔案 40 個 tests 也全綠，未影響其他 TC。Helper 已擴充支援 `database?: unknown | (() => unknown)` 以相容 beforeEach 動態重置的 bindings。

## 3. Test Infrastructure — 文件化

- [x] 3.1 更新 `docs/verify/TEST_DRIVEN_DEVELOPMENT.md`，新增「Integration Test Mocking」章節說明共用 hub:db mock helper 用法、closure 模式理由、與 nuxt-route helper 的關係
  - 2026-04-19 PASS：新增「Integration Test Mocking」h2 章節，含四個 h3 子章節（`createHubDbMock` 用法 A/B、closure 模式理由、dynamic import factory 陷阱、與 `nuxt-route.ts` helper 分工表）；`pnpm exec vp fmt --check docs/verify/TEST_DRIVEN_DEVELOPMENT.md` 全綠。

## 4. MCP Audit — Restricted Scope Violation Audit（MCP restricted 越權的 query_logs INSERT 放在 `mcp-replay.ts`）

- [x] 4.1 修改 `server/utils/mcp-replay.ts`：在 throw `McpReplayError` 前 INSERT `query_logs`，包 try/catch 確保 INSERT 失敗只 `log.error` 不影響原本 throw（best-effort audit / fail-loud refusal）
  - 2026-04-19 PASS：`getDocumentChunk` 接受新 dep `onRestrictedScopeViolation?: (input) => Promise<void>`，在 throw `McpReplayError(403, 'restricted_scope_required')` 前呼叫該 callback。callback 內部 `try/catch` 完全吞錯（handler closure 負責 log.error），util 端保持純 domain 不依賴 event/useLogger。handler 改用 hook 注入 audit closure 並移除 catch-block INSERT，確保 401/404 路徑不誤觸發 audit。
- [x] 4.2 INSERT 欄位包含：`channel='mcp'`、`status='blocked'`、`risk_flags_json` 含 `'restricted_scope_violation'`、`config_snapshot_version` 對齊既有 audit chain、`token_id`、`attempted_citation_id`
  - 2026-04-19 PASS：在 `server/utils/mcp-ask.ts::createMcpQueryLogStore` 新增 `createBlockedRestrictedScopeQueryLog` 方法，綁定 `channel='mcp'`、`status='blocked'`、`risk_flags_json=["restricted_scope_violation"]`、`decision_path='restricted_blocked'`、`refusal_reason='restricted_scope'`。`query_logs` schema 無 `attempted_citation_id` 欄位（schema drift），改將 `getDocumentChunk:<citationId>` 編碼進 `query_redacted_text`，auditor 用 wrangler d1 `WHERE query_redacted_text LIKE 'getDocumentChunk:%'` 即可還原 attempted citation。`config_snapshot_version` 從 handler 的 `runtimeConfig.governance.configSnapshotVersion` 取得，與既有 `createAcceptedQueryLog` 同源。
- [x] 4.3 擴充 `test/integration/acceptance-tc-13.test.ts`：補 assert `query_logs INSERT` 含 `status='blocked'` 與 `risk_flags_json` 含 `restricted_scope_violation`
  - 2026-04-19 PASS：新增 4 條 assertion 驗證 `queryLogInserts` 只有 1 筆、bind values 含 `['mcp', 'blocked', 'local', JSON.stringify(['restricted_scope_violation'])]`、`token_id` 對齊 violating token、`query_redacted_text === 'getDocumentChunk:<citationId>'`、`config_snapshot_version` 對齊 governance chain。
- [x] 4.4 補測試案例覆蓋 INSERT 失敗時仍正確 throw 403（mock D1 INSERT 拒絕，驗證 log.error 觸發 + 403 仍 throw + body 不含 restricted 內容）
  - 2026-04-19 PASS：新增 `createTc13BindingsWithFailingAudit` helper 讓 `INSERT INTO query_logs` responder throw `D1 transient failure`，新增 test case `still returns 403 with no leakage when the audit INSERT fails`，驗證 (a) 403 仍 throw (b) error message 不含 restricted chunk/title/locator (c) `log.error` 被呼叫 1 次且 context 含 `operation: 'mcp-replay-blocked-log'`、`tokenId`、`attemptedCitationId`。
- [x] 4.5 確認 successful restricted access by authorized token 不會誤寫 `restricted_scope_violation` flag（既有 accepted 路徑由 ask handler 寫，不重複）
  - 2026-04-19 PASS：`onRestrictedScopeViolation` hook 只在 `getDocumentChunk` 的 restricted-scope 分支被呼叫，accepted 路徑（scope ok）直接 return 不觸發 audit。在 `test/integration/get-document-chunk-replay.test.ts` case 1（200 happy path）與 case 5（retention boundary）補 `expect(createBlockedRestrictedScopeQueryLog).not.toHaveBeenCalled()` 斷言；case 4（403）補 `expect(createAcceptedQueryLog).not.toHaveBeenCalled()` 確保不會雙寫。`test/integration/mcp-routes.test.ts` 與 `test/unit/mcp-tool-get-document-chunk.test.ts` 的 happy/404 path 也補同樣 not-called 斷言。

## 5. Credit Card Block — `CREDIT_CARD_PATTERN` 用通用 13-19 位數字 with separators，不做 Luhn 驗證

> 路徑修正：實際檔案在 `server/utils/knowledge-audit.ts`（tasks 原敘述寫成 `shared/utils/`，repo 無該檔；shared/ 只放 schema / types，audit logic 在 server-only）。

- [x] 5.1 修改 `server/utils/knowledge-audit.ts`：重構 `CREDENTIAL_PATTERNS` 從 `RegExp[]` 改為 `Array<{ pattern: RegExp, flag: 'credential' | 'pii_credit_card' }>`；既有 Visa/Master/Discover/Amex pattern 改標 `pii_credit_card`；新增 generic 13-19 位 fallback pattern 搭配 separator-between-digits guard 防訂單編號誤判。
  - 2026-04-19 PASS：6 個 credential pattern 分兩 bucket（5 個 `credential`：api_key/password/secret/token/sk-；4 個 `pii_credit_card`：Visa/Master/Discover 16-digit、Amex 15-digit、generic fallback）。generic pattern `/\b(?:\d[ -]?){13,19}\b/` 搭配 `matchesGenericCreditCard` helper 額外檢查 `/\d[ -]\d/` 確保 separator 出現在 digit 之間（邊界分隔符不算）。
- [x] 5.2 確認 `risk_flags_json` 含 `'pii_credit_card'`，`shouldBlock=true`，redaction 形式為 `[BLOCKED:credit_card]`
  - 2026-04-19 PASS：`auditKnowledgeText` 改為用 `Set<flag>` 聚合命中的 pattern flag，排序後寫入 `riskFlags`（`toSorted()` 避免 lint mutate warning）。`shouldBlock` 在 `credential` / `pii_credit_card` 任一命中時為 true；redaction marker 依優先順序：有 `pii_credit_card` → `[BLOCKED:credit_card]`，否則 → `[BLOCKED:credential]`。
- [x] 5.3 [P] 在 `test/fixtures/acceptance/seed/cases.json` 新增 `seed-tc-15-credit-card`：prompt 含 `4111-1111-1111-1111`，channel=web，expectedOutcome=refused
  - 2026-04-19 PASS：fixture 新增於 `seed-tc-15` 之後，prompt 為 `'我的信用卡號 4111-1111-1111-1111 被盜用了該怎麼辦？'`；TC-15 `it.each(cases)` 自動展開為 2 個 test case（原 api_key + 新 credit card）。
- [x] 5.4 擴充 `test/integration/acceptance-tc-15.test.ts`：覆蓋信用卡號 block 路徑，assert `risk_flags_json` 含 `pii_credit_card` 與 `messages.content_redacted` / `query_logs.query_redacted_text` 不含原始卡號
  - 2026-04-19 PASS：test 改為依 fixture prompt 內容動態判斷 `expectedFlag` 與 `expectedMarker`（credential 或 pii_credit_card），credential pattern 檢查擴充為 `credential OR credit card`；既有 `assertDoesNotContainRawPrompt` 幫助驗證 `4111-1111-1111-1111` 原文未落地到 D1 / messages。refusal styling（`web-chat-ui` spec）與 credential 拒答一致——兩者都走同一個 `chat.post.ts` refused-path，response shape 無差異。
- [x] 5.5 驗證 AI Search 與 Workers AI binding 在信用卡 block 路徑都不被呼叫（calls.length === 0）
  - 2026-04-19 PASS：既有 test lines `expect(workersAi.calls).toHaveLength(0)` 與 `expect(aiBinding.calls).toHaveLength(0)` 對兩個 fixture 都適用（因 `it.each` 展開）；credit card fixture 通過 `shouldBlock` 早退，retrieval / answering pipeline 完全沒跑。

## 6. Governance Docs — `risk_flags_json` 新增兩個 flag：`restricted_scope_violation` 與 `pii_credit_card`

- [x] 6.1 更新 `docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md`：補上 restricted scope violation audit trail 段落，含 wrangler d1 query 範例
  - 2026-04-19 PASS：新增 §8 Risk Flags Audit Trail，其中 §8.1 `restricted_scope_violation` — MCP 越權稽核，含寫入路徑表、row shape、schema drift 說明（`attempted_citation_id` 編碼到 `query_redacted_text`）、兩個 wrangler d1 查詢範例、三個 spec scenario PASS 條件。
- [x] 6.2 同份文件補 credit card block 治理段落，說明 `pii_credit_card` flag 用途與 admin UI 過濾路徑
  - 2026-04-19 PASS：§8.2 `pii_credit_card` — 高風險 PII 拒答稽核，含觸發條件列表（Visa/Master/Discover/Amex/generic）、寫入路徑、兩個 wrangler 查詢範例（最近紀錄 + 每日統計）、admin UI 過濾路徑說明（目前無專屬 UI、列出 `admin-ui-post-core` 未來接點）、誤判邊界評估 SOP（4 步流程）、§8.3 與 `config_snapshot_version` 的關係補充。

## 7. Verification

- [x] 7.1 跑全套 `pnpm exec vp test run` 確認所有測試綠（TC-01/12/13/15/18 + 4 個 pre-existing fix + tc-15 credit card），對齊 design.md Goals 區塊四項目標都達成
  - 2026-04-19 PASS：`Test Files 98 passed (98)`，`Tests 492 passed | 1 skipped (493)`。相對 Phase 2 的 489 passed 多 3 筆（2 個 knowledge-audit unit test 新增 + 1 個 TC-15 fixture 展開為額外 test）。
- [x] 7.2 跑 `pnpm check`（format/lint/typecheck）全綠；確認 design.md Non-Goals 範圍未被誤擴張（沒順手加電話/email/身分證 PII pattern）
  - 2026-04-19 PASS：`pnpm check` 在 Phase 3 觸動的 4 個檔案（`server/utils/knowledge-audit.ts`、`test/unit/knowledge-audit.test.ts`、`test/integration/acceptance-tc-15.test.ts`、`test/fixtures/acceptance/seed/cases.json`、`docs/verify/CONFIG_SNAPSHOT_VERIFICATION.md`）格式 / lint / typecheck 全綠。整體 `pnpm check` 退 exit 1 僅因 `server/utils/guest-policy.ts`（非本 change 觸動，untracked）有 3 warnings + 1 error，屬並行 change 責任。Non-Goals 範圍確認：未新增電話 / email / 身分證號 block pattern；`EMAIL_PATTERN` / `PHONE_PATTERN` 維持 redact-only 路徑不變。
- [ ] 7.3 依 design.md 部署順序章節分階段 commit + 部署（helper → 4 pre-existing fix → MCP audit → credit card pattern → TC refactor → docs），staging 部署後驗證 MCP 用 non-restricted token 呼叫 `getDocumentChunk` for restricted citation，跑 `wrangler d1 execute agentic-rag-db --remote --command "SELECT * FROM query_logs WHERE risk_flags_json LIKE '%restricted_scope_violation%' ORDER BY created_at DESC LIMIT 3"` 看到稽核紀錄
  - 2026-04-19 DEFERRED：延後到實際 staging 部署階段（archive 後主線決定 commit 切分與部署時機）。
- [ ] 7.4 staging 部署後驗證：web 在 `/chat` 輸入 `4111-1111-1111-1111` 看到拒答（refusal styling），跑 wrangler 查 query_logs 看到 `pii_credit_card` flag 與 redacted text
  - 2026-04-19 DEFERRED：延後到實際 staging 部署階段。
- [ ] 7.5 演練 design.md Rollback 章節：分別模擬三個缺口的 revert 路徑（helper revert / mcp-replay INSERT revert / credit card pattern revert），確認每段獨立可還原不會卡 schema
  - 2026-04-19 DEFERRED：延後到實際 staging 部署階段。

## 人工檢查

- [x] 8.1 staging 驗證 MCP restricted 越權後 query_logs 可在 `wrangler d1 execute` 查到稽核紀錄（含 token_id、attempted_citation_id、blocked status、restricted_scope_violation flag）
  - 2026-04-19 PASS：v0.18.2 production 實測。new token `faed0387-e1c9-4dfe-9714-930704e03c0f`（不含 knowledge.restricted.read）對 citation `e174a4cb-e2a4-4dcd-8777-b87b329890a4`（doc「機密專案玫瑰」，access_level=restricted）呼叫 `getDocumentChunk` → MCP 回 `[403] requires knowledge.restricted.read`；`query_logs` 落地 1 row：status=blocked、risk_flags_json=`["restricted_scope_violation"]`、query_redacted_text=`getDocumentChunk:<citationId>`、config_snapshot_version=`kgov-v1;env=production;...`。全判準通過。附帶修掉 production CSRF 豁免路徑 regression（見 v0.18.2 deploy commit）。
- [x] 8.2 staging 驗證 web 信用卡號拒答的視覺與 api_key 拒答 styling 完全一致（refusal copy、icon、底色）
  - 2026-04-19 PASS：使用者實測 v0.18.2 production。prompt A「我的信用卡號 4111-1111-1111-1111 被盜用了該怎麼辦？」與 prompt B「我的 api_key=sk-abcdef1234567890XYZ 需要如何輪替？」兩者 refusal copy（「抱歉，我無法回答這個問題」+ 三可能原因 + 三建議下一步）、icon、底色完全一致。兩條路徑走相同的 `chat.post.ts` refused-path，response shape 無差異。
- [x] 8.3 staging 觀察 1 週內 `pii_credit_card` flag 觸發頻率，評估誤判率（SOP 文件中是否有訂單編號被誤判）
  - 2026-04-19 SKIP（使用者明示）：1 週觀察本質上無法於 archive 前完成。block 路徑本身已由 §5 程式碼 + §4 test 覆蓋；誤判率屬營運觀察，非當前 change 的完成條件。
