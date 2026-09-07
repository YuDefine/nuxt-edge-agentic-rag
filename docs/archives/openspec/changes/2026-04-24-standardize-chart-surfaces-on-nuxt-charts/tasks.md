## 1. Chart Foundation

- [x] 1.1 完成「集中 chart data mapping 與 formatter 到共用 helper」，新增 `app/utils/chart-series.ts` 封裝 usage timeline labels、outcome category ordering、series mapping 與色彩語意。

## 2. Usage Timeline Migration

- [x] [P] 2.1 完成「以 `LineChart` 與 `BarChart` 對齊現有兩類資料語意」中的 `Usage Timeline Uses Standard Chart Components`，將 `app/components/admin/usage/TimelineChart.vue` 改為使用 `nuxt-charts` `LineChart` 呈現既有 `timeline` payload。
- [x] 2.2 在 `app/pages/admin/usage.vue` 落實「維持既有 API 與 redaction 邊界，只替換視覺層」，保留現有 loading / empty / error / unauthorized state，並確認 chart rendering 不新增任何 analytics request。

## 3. Outcome Breakdown Migration

- [x] [P] 3.1 完成「以 `LineChart` 與 `BarChart` 對齊現有兩類資料語意」中的 `Outcome Breakdown Uses Standard Chart Components`，將 `app/components/debug/OutcomeBreakdown.vue` 改為使用 `nuxt-charts` `BarChart` 呈現四個 outcome aggregates。
- [x] 3.2 在 `app/pages/admin/debug/latency/index.vue` 落實「維持既有 API 與 redaction 邊界，只替換視覺層」，保留 latency summary cards、admin gating 與 redaction-safe aggregate 頁面結構。

## 4. Automated Verification

- [x] 4.1 完成「以單元 + E2E 驗證圖表狀態與可讀性」，新增 `test/unit/admin-usage-timeline-chart.test.ts` 與對 `app/utils/chart-series.ts` 的測試，驗證 range label、empty timeline 與 chart series mapping。
- [x] [P] 4.2 完成「以單元 + E2E 驗證圖表狀態與可讀性」，新增 `test/unit/debug-outcome-breakdown.test.ts` 並更新 `e2e/td003-contrast.spec.ts`、`e2e/observability-review.spec.ts`，驗證 zero-count categories、對比可讀性與實頁面呈現。

## 5. Design Review

- [x] 5.1 對 `app/pages/admin/usage.vue`、`app/components/admin/usage/TimelineChart.vue`、`app/pages/admin/debug/latency/index.vue`、`app/components/debug/OutcomeBreakdown.vue` 執行 Design Review，確認 Fidelity、responsive、keyboard flow 與 a11y 報告皆符合專案門檻。
- [x] 5.2 執行 `/audit` 與 `/review-screenshot` 驗證圖表替換後的視覺品質與介面穩定性，修正 Critical findings 與顯著視覺回歸。

## 6. Final Verification

- [x] 6.1 執行變更範圍內的 unit / e2e / typecheck 驗證，並人工走查 `/admin/usage` 與 `/admin/debug/latency` 的 loading、ready、empty、error、unauthorized 狀態。
