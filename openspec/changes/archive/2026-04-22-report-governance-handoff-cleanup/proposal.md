## Why

目前 `template/HANDOFF.md` 混入了兩類不屬於 session 交接的持久內容：一是 `reports/latest.md` 與 `reports/archive/` 的治理規則，二是 demo 資料現況、補件方向與可回填素材摘要。這些內容若繼續留在 handoff，會造成 handoff、`openspec/ROADMAP.md` 與報告本體之間的職責重疊，讓後續 session 難以判斷哪一份才是應持續維護的真相來源。

這個 change 的目標是把 handoff 收斂回短期交接用途，並將跨 session 仍成立的規則與規劃移到更合適的 OpenSpec artifacts，避免同一批結論同時存在於多個位置後逐步漂移。

## What Changes

- 明確定義 `template/HANDOFF.md` 僅承載短期、session-bound 的交接資訊，不再保存 `reports/latest.md` 的持久治理結論與長期規劃。
- 建立 `reports/latest.md` 與 `reports/archive/` 的治理邊界，將「current report 單一本體」與「archive 僅作歷史快照」的規則正式化到 change artifact。
- 將目前 handoff 中與 `reports/latest.md` 相關的現況判定、評審補件方向與 demo 資料盤點摘要，改由 `openspec/ROADMAP.md` 的手動區塊承接，作為跨 session 的規劃與 next moves。
- 釐清後續更新路徑：文件治理規則改動應更新對應 change artifact；會隨進度變動的專案現況與待辦則更新 `openspec/ROADMAP.md`；報告正文內容則回寫 `reports/latest.md`。

## Non-Goals

- 不在本 change 內改寫 `reports/latest.md` 正文內容，也不新增答辯補件資料。
- 不處理 handoff 內其他主題，例如 Claude Desktop / MCP connector 的技術結論與產品化方向。
- 不新增或修改任何產品功能 spec；本 change 只處理 repo 內文件治理與 OpenSpec workflow 的落點。

## Capabilities

### New Capabilities

- `report-artifact-governance`: 定義 `reports/latest.md`、`reports/archive/`、`openspec/ROADMAP.md` 與 `template/HANDOFF.md` 的職責邊界與維護規則

### Modified Capabilities

(none)

## Impact

- Affected specs: none
- Affected code:
  - `template/HANDOFF.md`
  - `openspec/ROADMAP.md`
  - `openspec/changes/report-governance-handoff-cleanup/design.md`
  - `openspec/changes/report-governance-handoff-cleanup/tasks.md`
  - `reports/latest.md`（僅作為治理規則所指向的正文本體，不必然在本 change 內直接修改）
