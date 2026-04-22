## Context

目前 `template/HANDOFF.md` 同時承載了 session 交接提醒、`reports/latest.md` 的治理規則，以及與答辯補件相關的跨 session 現況與後續工作。這使 handoff 不再只是「下一位接手的人現在要知道什麼」，而變成混合型的長期知識儲存點。

repo 內已存在更適合承接持久資訊的兩個位置：

- `reports/latest.md`：current report 正文本體
- `openspec/ROADMAP.md`：由 spectra-ux 維護的跨 session 規劃與 next moves 儀表板

若不把這些邊界正式化，後續 session 很容易在 handoff、roadmap 與 report 正文之間重複抄寫同一批結論，最後出現來源漂移。

## Goals / Non-Goals

**Goals:**

- 定義 `reports/latest.md` 與 `reports/archive/` 的治理邊界，讓 current report 與歷史快照有單一、清楚的職責。
- 讓 `template/HANDOFF.md` 回到短期交接用途，只保留 session-bound 的提醒、blocker 與立即 next steps。
- 為 `openspec/ROADMAP.md` 指定承接跨 session 現況、補件方向與可持續追蹤的手動 backlog。
- 提供可執行的搬移規則，讓目前 handoff 內的 `reports/latest.md` 相關內容能按性質分流。

**Non-Goals:**

- 不重寫 `reports/latest.md` 正文內容。
- 不處理 handoff 內與 Claude Desktop / MCP connector 相關的另一條主題。
- 不改動任何產品 runtime、API、schema 或使用者介面。

## Decisions

### Decision: 以資訊存續時間切分 report artifacts

**採用**：用「資訊會持續多久仍然成立」作為主要分類軸。

- 短期、session-bound、下一位接手立即要知道的內容 → `template/HANDOFF.md`
- 跨 session 仍成立的規劃、現況判定與 next moves → `openspec/ROADMAP.md`
- 報告正文與正式敘述 → `reports/latest.md`
- 關於 artifact 職責邊界本身的治理規則 → 本 change artifacts

**理由**：目前 handoff 的問題不是內容真假，而是不同存續時間的資訊被放在同一份文件，導致 handoff 被當成半永久知識庫使用。

**替代方案**：把所有結論都寫回 `reports/latest.md`。不採用，因為 roadmap 與 workflow 決策不適合混入報告正文。

### Decision: current report / archive 邊界由專屬 capability 規範

**採用**：建立 `report-artifact-governance` capability，專門描述 repo 內 report artifacts 的職責與更新規則。

**理由**：這批規則不是既有產品 spec 的 requirement，也不屬於某個 active product change。獨立 capability 能避免把 repo workflow 汙染進產品能力規格。

**替代方案**：把規則掛進既有 `acceptance-evidence-automation` 或 `governance-and-observability`。不採用，因為那些 spec 關心的是產品驗證與治理行為，不是 repo 內報告文件維護。

### Decision: handoff 中的 `reports/latest.md` 相關內容按三類分流

**採用**：對現有 handoff 內容做以下分流：

- `reports/latest.md` 是 current report、本體唯一來源；`reports/archive/` 只保留歷史快照 → capability spec / design 決策
- demo 資料目前足夠最小答辯閉環，但不足完整驗收展示 → `openspec/ROADMAP.md`
- 三包補件方向與可回填 demo 素材摘要 → `openspec/ROADMAP.md`

**理由**：第一類是穩定治理規則；後兩類是會隨專案進度變動的 planning context。

**替代方案**：把三類內容全部留在 handoff，只加註說明。不採用，因為 handoff 仍會持續累積持久資訊。

## Risks / Trade-offs

- [Risk] `openspec/ROADMAP.md` 可能開始承載較多報告脈絡，手動區塊變長。 → Mitigation：只保留現況判定、缺口與 next moves，不複製報告正文。
- [Risk] 新增 repo workflow capability 會讓 spec tree 多一條非產品功能 spec。 → Mitigation：明確將 capability 目的限定為 artifact governance，不與 runtime behavior 混寫。
- [Risk] 若只搬 `reports/latest.md` 相關段落，handoff 仍可能被其他主題重複塞滿。 → Mitigation：本次先建立分類規則，後續主題可依同樣準則續清。

## Migration Plan

1. 先建立 `report-artifact-governance` spec，將 artifact 邊界與更新責任寫成可驗證規則。
2. 依 spec 與 design 將 handoff 中 `reports/latest.md` 相關段落分流到 change artifacts 與 `openspec/ROADMAP.md`。
3. 清理 `template/HANDOFF.md`，只留下短期交接所需內容。
4. 後續如有新的 report governance 決策，優先更新對應 change/spec artifact，而非回填 handoff。

## Open Questions

- 是否要在 `AGENTS.md` 額外補一句，明示 handoff 不應承載跨 session roadmap 內容。
- 是否要為 `openspec/ROADMAP.md` 的 report-related 手動條目建立更固定的段落命名，以降低後續 drift。
