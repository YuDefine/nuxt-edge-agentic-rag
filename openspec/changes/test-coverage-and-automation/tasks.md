## 1. Verification Foundations

- [x] 1.1 建立 `test/acceptance/registry`，用單一 manifest 對齊 `TC-01..TC-20`、`A01..A13`、`EV-01..EV-04` 與報告章節來源。
- [x] 1.2 建立 D1、KV、R2、AI Search、Workers AI 的 bindings mocks / fakes，讓 integration 測試能跑真實 orchestration。
- [x] 1.3 建立 Web Session、Admin allowlist、MCP token 與 scope 的測試 helper，覆蓋 User/Admin/restricted/no-scope 幾種角色組合。
- [x] 1.4 建立 `seed`、`dev-calibration`、`frozen-final` 三層 fixture loader，避免驗收案例與調參案例混用。
- [x] 1.5 新增本地與 CI 指令入口，例如 `pnpm verify:acceptance`、`pnpm test:contracts` 與分層 test filters。

## 2. Case Automation — TC-01 到 TC-10

- [ ] 2.1 自動化 `TC-01` 一般定義題，驗證 direct answer + valid citation。
- [ ] 2.2 自動化 `TC-02` SOP 程序題，驗證程序步驟與責任角色引用正確。
- [ ] 2.3 自動化 `TC-03` 欄位定義題，驗證欄位語境與 citation support。
- [ ] 2.4 自動化 `TC-04` 模糊查詢，驗證 Self-Correction 觸發與第二輪成功條件。
- [ ] 2.5 自動化 `TC-05` Web 多輪追問，驗證 `conversationId` 上下文延續與 stale 保護。
- [ ] 2.6 自動化 `TC-06` 跨文件比較，驗證至少兩份不同文件引用與 judge / reformulation 路徑。
- [ ] 2.7 自動化 `TC-07` 知識庫外問題，驗證零引用拒答。
- [ ] 2.8 自動化 `TC-08` 系統能力外問題，驗證不宣稱已執行交易寫入。
- [ ] 2.9 自動化 `TC-09` 敏感查詢，驗證高風險政策阻擋與不落原文。
- [ ] 2.10 自動化 `TC-10` 制度查詢，驗證 direct answer 與制度文件引用。

## 3. Case Automation — TC-11 到 TC-20

- [ ] 3.1 自動化 `TC-11` 條件式程序題，驗證 direct 或 judge_pass 路徑。
- [ ] 3.2 自動化 `TC-12` MCP 互操作鏈，驗證 `askKnowledge` 到 `getDocumentChunk` 的 replay 一致性。
- [ ] 3.3 自動化 `TC-13` restricted citation 越權，驗證 `403` 與零內容洩漏。
- [ ] 3.4 自動化 `TC-14` Admin Web restricted 讀取，驗證 Admin Web 與 MCP scope 邊界分離。
- [ ] 3.5 自動化 `TC-15` 高風險輸入治理，驗證 `messages.content_text` 與 `query_logs` 只落遮罩資料。
- [ ] 3.6 自動化 `TC-16` `searchKnowledge` no-hit 契約，驗證 `200` + `results: []`。
- [ ] 3.7 自動化 `TC-17` restricted existence-hiding，驗證 `askKnowledge` 拒答與 `searchKnowledge` 空結果。
- [ ] 3.8 自動化 `TC-18` current-version-only 切版案例，驗證舊版引用不再出現在正式回答。
- [ ] 3.9 自動化 `TC-19` `listCategories` 計數規則，驗證 active + current 去重邏輯。
- [ ] 3.10 自動化 `TC-20` MCP 契約瘦身，驗證回應不暴露內部診斷欄位。

## 4. Acceptance And Evidence Outputs

- [ ] 4.1 建立 `A01` 部署成功驗證輸出，連結 deploy metadata、smoke 結果與環境標識。
- [ ] 4.2 建立 `A02` AI Search + Agent orchestration 驗證輸出，彙整代表性 query logs 與 citation evidence。
- [ ] 4.3 建立 `A03` citation replay 驗證輸出，對照 `source_chunks`、`citation_records` 與 replay response。
- [ ] 4.4 建立 `A04` current-version-only 驗證輸出，保存切版前後 answer/citation 差異。
- [ ] 4.5 建立 `A05` Self-Correction 改善報告，對照重試前後結果與 path。
- [ ] 4.6 建立 `A06` 拒答正確率輸出，彙整越界、高風險與系統能力外案例。
- [ ] 4.7 建立 `A07` MCP 四工具驗證輸出，至少含 Inspector/contract snapshot 對照。
- [ ] 4.8 建立 `A08` OAuth 與 allowlist 權限重算輸出，串接登入與角色切換證據。
- [ ] 4.9 建立 `A09` restricted scope + redaction 驗證輸出。
- [ ] 4.10 建立 `A10` Admin Web restricted 可讀與 MCP 隔離輸出。
- [ ] 4.11 建立 `A11` 高風險原文不落地稽核輸出。
- [ ] 4.12 建立 `A12` no-internal-diagnostics MCP contract snapshot。
- [ ] 4.13 建立 `A13` rate limit + retention 可驗證性輸出。
- [ ] 4.14 建立 `EV-01` 核心閉環 smoke exporter，保存 deploy、登入、發布、問答、replay 串接證據。
- [ ] 4.15 建立 `EV-02` OAuth / allowlist 變更後權限重算 exporter。
- [ ] 4.16 建立 `EV-03` publish no-op、rollback 與版本切換 evidence exporter。
- [ ] 4.17 建立 `EV-04` `429`、backdated record 與 cleanup run exporter。
- [ ] 4.18 產出與報告第三章/第四章相容的 summary tables 與 evidence refs，固定包含 `config_snapshot_version`。
