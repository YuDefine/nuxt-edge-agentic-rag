# Onboarding Guide

本頁面提供新接手開發者的最短進入路徑，目標是在第一個工作階段內建立專案地圖、啟動本機環境，並知道遇到不同任務時應該查哪一類文件。

## 你會在這裡得到什麼

- 專案入口文件的閱讀順序。
- 本機開發與文件站的常用命令。
- 規則、規格、驗證與決策文件的查找方式。
- 開始動手前應先確認的邊界與來源。

## 建議閱讀順序

1. 先讀 [開發者文件總覽](./README.md) 確認 docs 的角色與文件分工。
2. 再讀 [專案結構](./STRUCTURE.md) 建立目錄與模組地圖。
3. 需要查開發約束時，看 [規則入口](./rules/index.md)。
4. 需要查功能需求與變更範圍時，看 [規格入口](./specs/index.md)。
5. 需要查部署、驗收或回復流程時，看 [驗證指南](./verify/index.md)。
6. 需要理解既有技術選擇時，看 [決策紀錄](./decisions/index.md)。

## 本機常用命令

```bash
pnpm install
pnpm dev
pnpm docs:dev
pnpm check
pnpm test
pnpm docs:build
```

- `pnpm dev`：啟動 Nuxt 開發伺服器，預設埠號為 `3010`。
- `pnpm docs:dev`：啟動文件站，預設埠號為 `4173`。
- `pnpm check`：執行格式、lint 與 typecheck。
- `pnpm test`：執行主要測試流程。
- `pnpm docs:build`：驗證文件站建置。

## Source of Truth

- 規則原始來源位於 `.claude/rules/` 與 `.github/instructions/`。
- Spectra 規格原始來源位於 `openspec/specs/`、`openspec/changes/` 與 `openspec/ROADMAP.md`。
- `docs/` 提供可閱讀的入口、導覽與正式操作文件，但不取代上述原始來源。

## 開始實作前的檢查清單

1. 確認你要改的是既有規格、進行中 change，還是新的需求。
2. 確認是否已存在相關規則、決策或驗證文件，避免與既有流程衝突。
3. 確認本機環境可啟動，至少能執行 `pnpm dev` 或對應的驗證命令。
4. 若要改文件入口或 section index，記得同步更新 [docs/.vitepress/config.ts](./.vitepress/config.ts)。

## 依任務快速查找

### 我要改功能

- 先看 [規格入口](./specs/index.md) 與 [規則入口](./rules/index.md)。
- 若功能涉及既有架構限制，再看 [決策紀錄](./decisions/index.md)。

### 我要部署或驗證

- 先看 [驗證指南](./verify/index.md)。
- 只需要單一主題短流程時，再看 [Runbooks](./runbooks/index.md)。

### 我要更新文件站

- 先看 [開發者文件總覽](./README.md) 與 [文件首頁](./index.md)。
- 調整導覽後務必執行 `pnpm docs:build` 驗證。

## 第一週建議完成的事

1. 本機跑通 `pnpm dev` 與 `pnpm docs:dev`。
2. 讀完 [專案結構](./STRUCTURE.md) 與你目前任務相關的 rules、specs、verify 文件。
3. 能說清楚這個專案的文件邊界，以及 rules、specs、verify、runbooks 各自負責什麼。
