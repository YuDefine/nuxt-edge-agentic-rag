## Context

bootstrap change 已把 `v1.0.0` 核心流程切成可實作 specs，但報告真正要求的是「可以被驗證」。這代表測試不能只檢查 route 有沒有回 200，也不能只看 mock 元件是否存在，而是要對照 `main-v0.0.36.md` 中的 `gold facts`、必要引用、不可犯錯、acceptance ID 與 EV 證據格式，建立一套從單元測試到 MCP contract 驗證都能重跑的證據層。

這個 change 的目標不是新增需求，而是把報告裡已經宣告的驗收矩陣轉成實際能阻擋回歸的 automation baseline。

## Goals / Non-Goals

**Goals:**

- 將 `TC-01-TC-20`、`A01-A13`、`EV-01-EV-04` 分別映射到對應測試層級與輸出格式。
- 建立一致的 fixtures、mock bindings 與 helper，讓 Web 與 MCP 可共用同一組知識資料、版本狀態與權限矩陣。
- 自動輸出與報告回填格式相容的摘要資料，例如 `config_snapshot_version`、decision path、citation evidence、拒答證據與 `429`/cleanup 驗證紀錄。
- 明確區分 seed、dev-calibration 與 frozen-final，用測試資料治理防止驗收基準漂移。

**Non-Goals:**

- 不在測試中重做第二套產品邏輯；測試 helper 只能建立資料與驗證觀察，不得取代實際 server 行為。
- 不用過度 mock 取代需要驗證的 side effects，例如 publish transaction、current-version-only 過濾或 citation replay。
- 不把 staging 人工檢查改成假自動化；OAuth、部署與視覺 QA 仍需保留人工或截圖驗證。

## Decisions

### 四層測試架構

測試分成四層：

1. **Unit**：檢查純函式與 shared policy，如 score routing、redaction policy、category counting、config snapshot version derivation。
2. **Integration**：以 Nuxt server route / handler 為主，驗證 publish、chat、MCP、cleanup 等核心契約。
3. **E2E**：用 Playwright 驗證 Web 問答、Admin UI 與 restricted 可見性等跨頁流程。
4. **Contract/Evidence**：以 JSON summary、response snapshot、backdated cleanup record、`429` 紀錄與 MCP response schema 產出可回填報告的證據。

這樣可以避免所有案例都被擠進昂貴的 e2e，也避免 unit 測試虛假地證明整體流程成立。

### 資料集分層

自動化資料必須明確分為：

- `seed`: 最小功能資料，用於本地快速確認路由與 schema。
- `dev-calibration`: 允許在正式驗收前調整門檻與 prompt 的資料集。
- `frozen-final`: 正式驗收用資料集，一旦凍結後只允許增加案例，不允許為了讓測試綠而更改預期結果。

測試 helper 必須強制標示使用的是哪一層資料，避免開發中誤把 dev-calibration 的寬鬆預期帶進正式驗收統計。

### 契約先於截圖

報告要求的 `A07`、`A12` 與多個 `TC` 案例都屬對外契約驗證，優先應由 integration / contract test 保證，例如：

- `searchKnowledge` no-hit 一律 `200` + `results: []`
- `getDocumentChunk` restricted 越權一律 `403`
- MCP response 不得暴露 `retrievalScore`、`decisionPath`、`documentVersionId`

截圖與 manual review 只補人類可見流程，不取代契約驗證。

### 證據輸出格式固定化

所有 acceptance automation 都必須能輸出至少以下欄位：`acceptanceId`、`testCaseId`、`channel`、`http_status`、`decision_path`、`config_snapshot_version`、`passed`、`evidence_refs`。對應 `EV-xx` 的自動化還需輸出 backdated record、cleanup run、deploy metadata 或 response snapshots 的檔案路徑。

這能讓第三章與第四章回填不必重新手抄測試結論，也能讓未來變更直接比較同一批格式化結果。

## Risks / Trade-offs

- [測試過度 mock]：若 helper 把 publish、retrieval 或 replay 假造掉，測試會失真。需優先 mock 外部 binding，而不是 mock 內部 orchestration。
- [維護成本增加]：43 個 tasks 代表驗收矩陣很重，但這比答辯前臨時人工補資料可靠。
- [資料集漂移]：若沒有 frozen-final discipline，驗收統計會失去比較意義。
- [本地與 staging 差異]：需保留一部分 evidence 專門驗證 Cloudflare bindings 與 staging deploy，不可全部只在本地 mock 通過。

## Migration Plan

1. 先建 shared fixtures、binding mocks、auth/token helpers，讓核心 route 可在本地 integration 測試中啟動。
2. 依 `TC-01-TC-20` 逐案落成，優先處理會直接卡答辯的 current-version-only、citation replay、restricted 隔離與 no-internal-diagnostics。
3. 再補 `A01-A13` 與 `EV-01-EV-04` 的 summary exporter，讓 acceptance 與 evidence 可由單一命令產出。
4. 最後把這些命令接到 CI / local scripts，並同步更新 verify 文件與回填模板。

## Execution Strategy

### Test Layer Mapping

| 類型              | 主要層級               | 補充層級               |
| ----------------- | ---------------------- | ---------------------- |
| `TC-01` ~ `TC-11` | integration            | unit                   |
| `TC-12` ~ `TC-20` | integration + contract | e2e                    |
| `A01` ~ `A13`     | acceptance summary     | evidence export        |
| `EV-01` ~ `EV-04` | evidence export        | staging/manual linkage |

### Command Surface

- `pnpm test:unit`：shared policies、helpers、snapshot derivation
- `pnpm test:integration`：publish/chat/MCP/contracts/cleanup
- `pnpm test:e2e`：Web Admin / User critical flows
- `pnpm verify:acceptance`：輸出 A/TC/EV 對照 summary 與 evidence refs

### Guardrails

- 測試輸出必須保留 `config_snapshot_version`
- 不允許 assertion 依賴 mock-only DOM 或 test-only production method
- `frozen-final` 案例更新需要在 summary 中標註版本變更理由

## Open Questions

- `frozen-final` 最終應保留 30 筆還是 50 筆案例，需依 staging 執行時間與維護成本決定。
- MCP Inspector / Claude Desktop 的外部整合驗證，應以 mock transport 還是真實本地 server 連線為主要自動化方式，需在實作前決定。
