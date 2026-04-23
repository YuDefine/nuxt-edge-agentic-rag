## Why

目前專案雖然已安裝並註冊 `nuxt-charts`，但實際圖表呈現仍分散成手刻 CSS bar list 與一般 block 元件，造成圖表互動、樣式語意、可重用性與後續維護方式不一致。既有 archived change 也已留下兩個明確訊號：`/admin/usage` 原本預期可用 `nuxt-charts`，`/admin/debug/latency` 則保留「未來可切到 `nuxt-charts`」的決策，因此現在收斂為單一圖表方案可消除分岐並降低後續新增圖表的決策成本。

## What Changes

- 將目前所有以「圖表／趨勢摘要」呈現資料、但仍以手刻 CSS bars 實作的管理面介面，統一改為 `nuxt-charts` 元件。
- 收斂 `/admin/usage` 的 timeline 視覺化契約，讓歷史 token usage 以正式 chart component 呈現，而不是自繪 bar list。
- 收斂 `/admin/debug/latency` 的 outcome breakdown 視覺化契約，讓 answered / refused / forbidden / error 分布改由正式 chart component 呈現，同時維持 redaction-safe aggregate 行為。
- 補上共通的 chart data mapping、空狀態、無障礙標示與測試要求，避免每個頁面各自定義資料轉換與色彩語意。
- 保持現有 server API response shape、admin 權限邊界、feature flag 與 redaction 規則不變；本 change 僅收斂前端圖表呈現層。

## Non-Goals

- 不新增新的 analytics 指標、查詢維度或後端聚合欄位。
- 不改動 `GET /api/admin/usage` 與 `GET /api/admin/debug/latency/summary` 的資料契約。
- 不把所有數字摘要卡、quota progress 或非圖表 UI 一併改寫成 `nuxt-charts`。
- 不引入第二套圖表函式庫，也不移除既有 `nuxt-charts` module 設定。

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `admin-usage-dashboard`: usage timeline 的需求改為以 `nuxt-charts` 提供正式 chart component 呈現歷史 token/request 趨勢，並定義圖表空狀態與資料映射契約。
- `latency-and-outcome-observability`: outcome summary 的需求改為以 `nuxt-charts` 呈現 redaction-safe aggregate 分布，並要求圖表視覺化不得弱化既有 outcome 類別與 null-safe 摘要語意。

## Impact

- Affected specs: `admin-usage-dashboard`, `latency-and-outcome-observability`
- Affected code:
  - Modified: `app/components/admin/usage/TimelineChart.vue`
  - Modified: `app/pages/admin/usage.vue`
  - Modified: `app/components/debug/OutcomeBreakdown.vue`
  - Modified: `app/pages/admin/debug/latency/index.vue`
  - Modified: `e2e/td003-contrast.spec.ts`
  - Modified: `e2e/observability-review.spec.ts`
  - New: `test/unit/admin-usage-timeline-chart.test.ts`
  - New: `test/unit/debug-outcome-breakdown.test.ts`
  - New: `app/utils/chart-series.ts`
- Affected dependencies and systems:
  - Reuse existing `nuxt-charts` module and auto-imported chart components; no new external dependency is introduced.
  - No API, runtime binding, secret, or environment isolation rule changes.
