## Why

`main-v0.0.36.md` 把 `A01-A13`、`TC-01-TC-20` 與 `EV-01-EV-04` 定義成答辯與驗收基準，但目前 repo 只有 bootstrap 核心 change 的局部 smoke 與人工檢查前置，還沒有一套可重跑、可產證據、可阻擋回歸的自動化驗證層。若沒有把這些案例落成測試與證據輸出，之後即使功能可用，也無法穩定證明 current-version-only、citation replay、restricted 隔離、redaction 與 MCP 契約長期成立。

## What Changes

- 建立一個以報告驗收矩陣為中心的 automation change，將 `TC-01-TC-20`、`A01-A13` 與 `EV-01-EV-04` 轉為可執行測試與證據產出。
- 補齊 Web、MCP、publish pipeline、retention cleanup 與 OAuth/allowlist 權限重算所需的 shared fixtures、bindings mocks、session helpers 與 contract assertions。
- 讓自動化輸出直接保存 `config_snapshot_version`、`http_status`、decision path、citation evidence 與必要的截圖/summary 檔，對齊報告第三章與第四章的回填格式。
- 收斂 seed、dev-calibration、frozen-final 三種資料集用法，避免驗收集被調參與 prompt 漂移污染。

## Non-Goals

- 不在此 change 內新增產品功能或改寫既有業務邏輯，除非為了讓案例可測而補齊必要測試鉤子。
- 不把人工檢查完全取代；瀏覽器實際操作、OAuth 畫面與 staging deploy 仍保留人工驗收責任。
- 不把 production 資料、production MCP 或 production OAuth 帳號引入自動化流程。

## Capabilities

### New Capabilities

- `acceptance-evidence-automation`: 將報告中的 acceptance、test case 與 evidence matrix 固化為可重跑的自動化驗證與證據輸出。

### Modified Capabilities

(none)

## Impact

- Affected specs: `acceptance-evidence-automation`
- Affected code: `test/**`, `e2e/**`, `vitest.config.ts`, `playwright.config.ts`, `scripts/checks/**`, `docs/verify/**`, `docs/manual-review-checklist.md`
