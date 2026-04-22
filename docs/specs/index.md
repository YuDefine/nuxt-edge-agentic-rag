# Spectra 規格

本頁提供 Spectra 規格的開發者閱讀入口，用來說明應該去哪一層文件查需求、變更範圍與整體進度。規格原始來源仍以 repo 內的 openspec 目錄為準。

## Source of Truth

- 穩定規格位於 openspec/specs/。
- 進行中的變更位於 openspec/changes/。
- 整體進度與可並行性位於 openspec/ROADMAP.md。

本頁不複製規格全文，只負責導覽與閱讀順序。

## 依問題類型選擇入口

### 穩定規格

- 用來回答「這個功能現在應該如何運作？」
- 適合在修改既有功能、補測試或釐清預期行為時先查閱。

### 進行中的變更

- 用來回答「這次 change 要改什麼、任務有哪些、目前進度如何？」
- 適合在實作、續做或 code review 當下對照 proposal、design 與 tasks。

### 整體進度

- 用來回答「目前有哪些 active changes、哪些工作可並行、下一步是什麼？」
- 適合在安排優先序、判斷相依性或準備交接時查閱。

## 建議閱讀順序

1. 先看對應功能的穩定規格。
2. 如果正在處理特定 change，再看對應的 change proposal、design 與 tasks。
3. 如果要判斷優先序、相依性或是否可並行，再看 roadmap。

## 開發判斷準則

- 問題是「目前系統應該怎麼做」時，先查穩定規格。
- 問題是「這次要怎麼改」時，先查 change proposal、design 與 tasks。
- 問題是「這項工作與其他工作如何協調」時，先查 roadmap。

## 相關入口

- 若需要查實作規範，回到 [規則入口](../rules/index.md)。
- 若需要了解專案決策背景，回到 [決策紀錄](../decisions/index.md)。
- 若是新接手專案，先看 [Onboarding Guide](../onboarding.md)。
