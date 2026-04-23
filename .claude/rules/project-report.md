---
description: 專題報告治理規則，定義 current report、封存方式與同步更新責任
globs: ['reports/**/*.md', 'CLAUDE.md', 'AGENTS.md']
---

# Project Report

本專案的專題報告治理規則如下：

- 專題報告以 `reports/latest.md` 為 current report。
- 影響報告內容的實作，必須同步更新報告。
- 歷史版本只可封存到 `reports/archive/main-vX.Y.Z.md`，不得覆寫既有版本檔。

## Intent

- `reports/latest.md` 是進行中的主版本。
- `reports/archive/` 只保存歷史快照，不承載 ongoing truth。
- 報告內容要跟實作保持一致，避免 code/document drift。
