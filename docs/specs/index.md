# Spectra 規格

這一頁是給開發者的規格閱讀入口，不是把 openspec 內容直接複製一份。真正的 spec 仍以 repo 內的 `openspec/` 為準。

## 你要看哪一種內容

### 穩定規格

- 位置：`openspec/specs/`
- 用途：回答「這個功能現在理論上應該怎麼運作？」

### 進行中的變更

- 位置：`openspec/changes/`
- 用途：回答「這次 change 打算改什麼、task 是什麼、目前做到哪？」

### 整體進度

- 位置：`openspec/ROADMAP.md`
- 用途：回答「現在有哪些 active changes、什麼可並行、下一步是什麼？」

## 建議閱讀順序

1. 先看對應功能的 `openspec/specs/`
2. 如果正在做變更，再看 해당 `openspec/changes/<change>/`
3. 如果要判斷優先序或依賴，再看 roadmap

## 開發時的判斷準則

- 問題是「現在系統應該怎麼做」：先找 stable spec。
- 問題是「這次要怎麼改」：先找 change proposal / design / tasks。
- 問題是「這個任務能不能和別的並行」：看 roadmap。
