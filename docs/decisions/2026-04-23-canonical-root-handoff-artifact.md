## Decision

repo root `HANDOFF.md` 是本專案唯一 canonical handoff artifact；`template/HANDOFF.md` 不再作為 live handoff 路徑。

## Context

本專案的 live workflow 已要求在 repo root 建立 `HANDOFF.md`，但實體檔案與部分 live OpenSpec 仍停留在 `template/HANDOFF.md`。這造成 instruction、spec 與 working tree 的路徑分裂，任何 agent 都可能依不同來源寫入不同位置。

此外，`template/` 對 handoff 並無語義優勢；它會讓 session-scoped artifact 看起來像樣板檔，而不是當前待接手狀態。

## Alternatives Considered

- 保留 `template/HANDOFF.md`
  - 優點：不用搬移現有檔案
  - 缺點：必須把 `AGENTS.md`、instruction、ROADMAP 與腳本提示全部改回 template 路徑，與現行 workflow 相反
- 同時保留 `template/HANDOFF.md` 與 `HANDOFF.md`
  - 優點：短期相容
  - 缺點：兩份 handoff 同時存在會直接破壞單一真相來源
- 只刪 `template/HANDOFF.md`，不留下 root `HANDOFF.md`
  - 優點：最少檔案
  - 缺點：會丟失尚未接手的 session 狀態，違反 handoff 規則

## Reasoning

選擇 repo root `HANDOFF.md`，因為這已是 live workflow 的既定路徑，而且最符合 handoff 作為 repo-scoped、session-scoped artifact 的語義。這次只改寫 live spec 與 live references，不回寫 `openspec/changes/archive/**`，是為了保留歷史脈絡與當時真相。

## Trade-offs Accepted

- archive 仍會保留 `template/HANDOFF.md` 的舊路徑文字，閱讀歷史變更時需要理解那是舊規範
- root `HANDOFF.md` 可能被 commit 進 git；這是刻意接受的 trade-off，因為跨 session / 跨 runtime 的 handoff 需要可被版本化

## Supersedes

- 無正式 ADR；此決策補足 `report-governance-handoff-cleanup` 之後 live spec 與 live workflow 未完全同步的空缺
