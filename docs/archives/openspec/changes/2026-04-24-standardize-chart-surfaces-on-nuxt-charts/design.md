## Context

專案已在 `package.json` 與 `nuxt.config.ts` 中安裝並啟用 `nuxt-charts`，但目前真正的圖表視覺化仍分成兩條路徑：`app/components/admin/usage/TimelineChart.vue` 以自繪 bar list 呈現 token timeline，`app/components/debug/OutcomeBreakdown.vue` 以自繪橫向 bars 呈現 outcome aggregates。這造成同一專案內對於「圖表」的元件語意、色彩配置、互動能力與測試策略不一致。

這次 change 是前端呈現層的收斂，不改動 `GET /api/admin/usage` 與 `GET /api/admin/debug/latency/summary` 的 response shape，也不改動 admin 權限、feature flag、redaction-safe aggregate 或任何 runtime binding。由於 `nuxt.config.ts` 已設定 `ssr: false`，先前 archived change 對於 SSR / hydration 成本的顧慮已不再是這次標準化的主要阻礙；真正的風險轉為圖表資料映射、空狀態維持與測試穩定性。

## Goals / Non-Goals

**Goals:**

- 讓 `/admin/usage` 與 `/admin/debug/latency` 的圖表視覺化統一改走 `nuxt-charts`。
- 讓不同頁面共享一致的 chart data mapping、色彩語意與 label formatter，避免每個元件各自轉資料。
- 維持既有 API 契約、admin / debug gating、redaction-safe aggregate 行為與空 / 錯誤狀態。
- 補足單元與 E2E 驗證，確認圖表替換後仍可測、可讀且不破壞現有頁面流程。

**Non-Goals:**

- 不新增新的 analytics 指標、維度或後端聚合欄位。
- 不將 quota progress、summary cards 或純文字 KPI 改寫成 chart。
- 不額外引入第二套圖表函式庫或自建 chart rendering abstraction layer。
- 不重做 admin usage 或 debug latency 頁面的資訊架構。

## Decisions

### 以 `LineChart` 與 `BarChart` 對齊現有兩類資料語意

`/admin/usage` 的 `timeline` 屬於有序時間序列，採用 `nuxt-charts` 的 `LineChart` 最符合「沿時間看 token 趨勢」的語意；`/admin/debug/latency` 的 outcome aggregates 是離散類別分布，採用 `BarChart` 最能直接表達 answered / refused / forbidden / error 的相對量。

Rationale:

- timeline 已有 `timestamp` 與 `tokens`，不需要額外 server aggregation 即可映射成折線圖。
- outcome breakdown 是固定四個 category，柱狀圖比 donut 更容易在小卡片內維持標籤可讀性與 zero-count 對照。
- 兩個 surface 分別對應時間序列與類別比較，統一但不強迫同一 chart 類型。

Alternatives considered:

- 繼續使用自繪 CSS bars：維護成本低，但無法形成專案級統一契約，也缺少正式 chart 元件的一致互動與擴充空間。
- usage 改用 `BarChart`：可行，但會弱化趨勢連續性。
- outcome 改用 `DonutChart`：視覺吸引力較高，但在窄卡片與多類別標籤下可讀性較差。

### 集中 chart data mapping 與 formatter 到共用 helper

新增一個前端共用 helper（暫定 `app/utils/chart-series.ts`），負責把 usage timeline buckets 與 outcome aggregates 轉成 `nuxt-charts` 所需的 series / categories / label formatter 輸入。頁面與元件只負責組裝 state，不重複實作資料轉換。

Rationale:

- 目前 `TimelineChart.vue` 已內含 timestamp format 與 percent 計算；改 chart 後若仍把 mapping 分散在元件內，後續新增圖表會再次複製類似邏輯。
- 把 mapping 拉到 helper 可讓 unit tests 直接驗證 range label、zero bucket、category ordering，而不依賴完整 DOM screenshot。
- 可讓 usage 與 debug 共享色彩命名與 label 格式規則，降低 drift。

Alternatives considered:

- 每個 chart component 內自行 computed mapping：上手較快，但測試重點會和 DOM 結構綁死。
- 建立更大的 charts composable 層：對目前只有兩個 chart surface 來說過重。

### 維持既有 API 與 redaction 邊界，只替換視覺層

後端 `timeline`、`outcomes`、權限檢查與 redaction-safe aggregate 不變；前端改為用現有 payload 驅動 `nuxt-charts`。圖表不得觸發額外 analytics request，也不得要求新的 raw-content 欄位。

Rationale:

- 本 change 的目的在於標準化圖表，不在於擴張資料契約。
- `latency-and-outcome-observability` 明確要求 redaction-safe aggregate；若為了 chart tooltip 或 legend 再取 raw content，將直接違反 capability 邊界。
- 維持 server response 不變可避免把單純 UI refactor 變成跨層風險。

Alternatives considered:

- 為 chart 專門新增 server DTO：會增加 migration 與測試面，但對目前需求沒有必要。

### 以單元 + E2E 驗證圖表狀態與可讀性

測試分成兩層：第一層以 unit tests 驗證 helper 與 chart component 的資料映射、類別順序、空陣列與零值處理；第二層更新既有 E2E / screenshot 驗證，確保 `/admin/usage` 與 `/admin/debug/latency` 在實頁面中仍維持可見、可辨識且不出現對比退化。

Rationale:

- chart library 的 DOM 結構可能比手刻 bars 更複雜，若只靠 E2E，失敗原因會過於粗糙。
- 既有 `e2e/td003-contrast.spec.ts` 與 observability review 已覆蓋實頁面，適合承接回歸驗證。
- 把 mapping logic 抽出後，unit tests 可以穩定驗證重要語意而不綁定 SVG 細節。

Alternatives considered:

- 僅保留 screenshot review：無法穩定捕捉資料映射錯誤。
- 為 chart SVG 做過細 selector 斷言：脆弱，且與 library 內部實作高度耦合。

## Risks / Trade-offs

- [圖表 library DOM 與樣式較重] → 先限制 scope 到兩個既有 surface，避免順手擴大到所有 KPI 區塊；若需要可於 apply 階段量測 bundle 影響。
- [既有空狀態被 chart placeholder 取代] → 明確保留頁面層 loading / empty / error / unauthorized 分支，只有 ready state 進入 chart rendering。
- [顏色語意與無障礙退化] → 在 helper 層固定 outcome category 對應色彩，並保留文字標籤與摘要數字，不讓資訊只存在於顏色。
- [測試對 library DOM 過度耦合] → 單元測試聚焦 mapping 輸出與可見文字；E2E 驗證聚焦使用者可觀察結果而非 SVG 內部細節。

## Migration Plan

1. 先建立 spec delta，明確要求 usage timeline 與 outcome breakdown 使用 `nuxt-charts`。
2. 在 apply 階段新增 chart data helper，讓兩個 chart surface 先完成純資料映射測試。
3. 逐一替換 `TimelineChart.vue` 與 `OutcomeBreakdown.vue`，保留其所在頁面 state 分支與權限控制。
4. 更新 unit / E2E 驗證，確認 contrast、empty state、zero-count 類別與頁面可讀性。
5. 若任何 chart library 兼容性問題阻斷交付，可在單一 commit 內回退到舊元件實作，因為 server payload 與 page state 未改動。

## Open Questions

- 無阻塞性 open question；`nuxt-charts` 已是既有依賴，元件類型與 scope 也已足夠明確，可直接進入 apply。
