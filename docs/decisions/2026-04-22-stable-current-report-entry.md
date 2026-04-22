# Stable Current Report Entry

## Decision

專題報告 current draft 收斂到 `reports/latest.md`；歷史版本收納於 `reports/archive/`。其他需要表達「目前報告版本」的文件，預設引用 `reports/latest.md`，不再把 current pointer 寫死為具體版本檔名，也不再假設 repo root 有 `latest.md`。

## Context

2026-04-22 結構整理時，reports 結構又往前收斂了一步：current report 已改為 `reports/latest.md` 本體，`main-v0.0.48.md` 到 `main-v0.0.50.md` 位於 `reports/archive/`。但 `AGENTS.md`、`CLAUDE.md` 與 `openspec/ROADMAP.md` 仍沿用舊寫法，把 current report 指向 root 的 `latest.md`。這讓 repo 產生一個脆弱模式：

- 升版時必須同步修改多個 current pointer
- 只要漏改一處，就會出現「比較新的版本被 archive，但 repo 對外仍宣稱舊版是 current」的漂移
- 難以區分哪些檔案是在保存歷史證據，哪些檔案只是想表達「現在請看這份」

## Alternatives Considered

- **方案 A：繼續直接在各處寫死版本號**
  - 優：最直觀
  - 缺：每次升版都要人工追 pointer，極易漂移

- **方案 B：把 current report 本體移到 `reports/latest.md`，archive 保持版本化命名**（採用）
  - 優：`reports/` 內可自洽表達 current 與 archive；repo root 不再承擔報告入口責任
  - 缺：所有舊的 `latest.md` current pointer 都必須改成 `reports/latest.md`

- **方案 C：保留 root `latest.md` 作 wrapper，實體報告另放 `reports/`**
  - 優：可維持舊入口相容
  - 缺：會多一層 wrapper，且 root / reports 兩地語意重疊

## Reasoning

這個 repo 真正缺的不是更多版本檔，而是讓 reports 自己成為一個完整子結構：`reports/latest.md` 表示 current draft，`reports/archive/` 表示歷史快照。這樣能把「現在該看哪一份」與「當時是第幾版」兩種語意留在同一個目錄層內，不必再讓 repo root 承擔報告入口。

這也能讓後續規則更清楚：會隨內容前進的 current pointer 用 `reports/latest.md`，需要可追溯證據的規格或歷史文件，才保留 `reports/archive/main-vX.Y.Z.md`。

## Trade-offs Accepted

- current report 實體已移入 `reports/latest.md`，因此所有舊的 root `latest.md` 假設都必須同步收斂
- `openspec/specs/*` 中作為歷史來源證據的 `main-v0.0.48.md` 引用暫不改動，之後若要進一步清理，需逐一判斷是否仍應保留 immutable reference

## Supersedes

補充並延伸 [2026-04-22 Canonical Test Roots And Repo Archives](./2026-04-22-canonical-test-roots-and-repo-archives.md) 中關於 current report pointer 漂移的處理策略。
