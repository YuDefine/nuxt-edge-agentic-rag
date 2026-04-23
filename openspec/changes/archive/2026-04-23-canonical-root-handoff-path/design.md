## Context

目前 repo 的 live workflow 已把 handoff 視為 repo root `HANDOFF.md`：

- `AGENTS.md` 與 `.github/instructions/handoff.instructions.md` 都要求在專案根目錄建立 `HANDOFF.md`
- `openspec/ROADMAP.md` 與 `scripts/spectra-ux/roadmap-sync.mts` 的提示也使用 `HANDOFF.md`

但檔案系統與部分 live OpenSpec 仍保留 `template/HANDOFF.md`：

- `template/HANDOFF.md` 是目前唯一存在的 handoff 檔
- `openspec/specs/report-artifact-governance/spec.md` 的 requirement 仍以 `template/HANDOFF.md` 為 canonical handoff artifact
- 多個 live spec 的 `@trace` metadata 仍引用 `template/HANDOFF.md`

這代表同一件事存在兩套真相來源：agent workflow 期待 root `HANDOFF.md`，spec / 實體檔案卻仍停在 `template/HANDOFF.md`。若直接搬移或刪除 `template/`，未同步的 live spec 與 trace 會立刻失真。

## Goals / Non-Goals

**Goals:**

- 將 repo root `HANDOFF.md` 定義為唯一 canonical handoff artifact
- 保留 handoff 的 session-scoped 性質，不讓 `HANDOFF.md` 重新承載跨 session roadmap 內容
- 將目前仍有效的 handoff 狀態搬到 root，並移除 `template/` 對 handoff 的責任
- 重寫 live spec / trace 中仍指向 `template/HANDOFF.md` 的路徑，讓 live guidance 一致

**Non-Goals:**

- 不改寫 `openspec/changes/archive/` 的歷史內容
- 不重構 handoff 格式本身或新增新的 workflow 欄位
- 不順手修補其他 active change 的 closeout、task 狀態或 manual review 缺口

## Decisions

### Canonical path becomes repo root HANDOFF.md

`HANDOFF.md` 改為唯一 canonical handoff artifact。所有 live requirement、trace 與 workflow 提示都必須對齊此路徑。

選這個方案的原因：

- agent workflow 已經使用 root `HANDOFF.md`，成本最低
- handoff 是 repo-scoped session artifact，放在 root 比 `template/` 更符合語義
- 與 `openspec/ROADMAP.md`、`.spectra/claims/**` 的分工更清楚

替代方案是保留 `template/HANDOFF.md` 並把 instruction 層改回 template 路徑；這會讓現行 workflow 與現有 claim / roadmap 文案全部倒退，不採用。

### Archive references remain untouched

`openspec/changes/archive/**` 仍保留 `template/HANDOFF.md` 的歷史敘述，不進行 retroactive rewrite。此次只修改 live spec、live instruction 與 working-tree artifact。

選這個方案的原因：

- archive 是歷史記錄，不應被新規範回寫
- 使用者要確認的是現在是否可安心刪除 `template/`，答案應由 live truth 決定

替代方案是全 repo 全量取代 `template/HANDOFF.md`；這會污染歷史變更脈絡，不採用。

### Migrate current contents before deleting template

刪除 `template/HANDOFF.md` 前，先把其中仍有效的 session-scoped 狀態整理後寫入 root `HANDOFF.md`，再移除舊檔與空目錄。

選這個方案的原因：

- handoff 規則允許 `HANDOFF.md` 被 commit，且要求資訊不能只留在對話裡
- 原 `template/HANDOFF.md` 含有仍待接手的 active change closeout，不應在刪目錄時一併丟失
- 過期 blocker 可在搬移時一起清理，避免 stale handoff 延續到新路徑

替代方案是直接刪檔、不保留內容；這會違反 handoff 規則，不採用。

## Risks / Trade-offs

- [Risk] live spec 仍有漏網的 `template/HANDOFF.md` 引用 → Mitigation: 以 `rg` 對 live paths 做完整掃描，archive 路徑另外排除
- [Risk] 直接搬舊 handoff 會把已解決 blocker 一起帶到 root → Mitigation: 依 `openspec/ROADMAP.md` 與 active tasks 先重寫內容，再建立 root `HANDOFF.md`
- [Risk] 這次 change 新增一份治理決策，未同步到 decisions 導致之後再度分裂 → Mitigation: 補一份 ADR，說明 root handoff 為 canonical path

## Migration Plan

1. 建立 spec delta，將 `report-artifact-governance` 的 handoff path 正規化為 root `HANDOFF.md`
2. 重寫 live `openspec/specs/**/spec.md` 中仍指向 `template/HANDOFF.md` 的 trace / requirement 文字
3. 以整理後的有效內容建立 root `HANDOFF.md`
4. 刪除 `template/HANDOFF.md`，並移除空的 `template/` 目錄
5. 以 `rg` 與 `spectra analyze` 驗證 live references 與 change artifacts 一致

## Open Questions

- 無
