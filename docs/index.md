---
layout: home

hero:
  name: Nuxt Edge Agentic RAG Docs
  text: 開發者文件中心
  tagline: 面向開發、驗證與維運的正式文件入口，協助開發者快速定位正確來源與操作手冊。
  actions:
    - theme: brand
      text: 新手上手
      link: /onboarding
    - theme: alt
      text: 閱讀文件導覽
      link: /README
    - theme: alt
      text: 驗證指南
      link: /verify/

features:
  - title: 任務導向導覽
    details: 依照開發、驗證、維運與決策查找需求安排入口，不需先掃完整檔名清單。
  - title: 明確區分來源
    details: docs 提供可閱讀的導覽與操作說明；規則與 Spectra 規格仍維持在原始來源維護。
  - title: 適合新進開發者接手
    details: 先建立專案地圖，再依任務進入對應文件，降低 onboarding 與交接成本。
---

## 適用對象

- 第一次接手這個 repo，需要快速建立文件地圖的開發者。
- 需要部署、驗證、除錯或回溯決策背景的維運與開發人員。
- 需要查詢規則、規格與治理文件邊界的協作者。

## 快速開始

1. 執行 `pnpm docs:dev` 啟動本機文件站預覽，預設埠號為 `4173`。
2. 執行 `pnpm docs:build` 驗證 VitePress 可正常建置。
3. 若要模擬正式站點，執行 `pnpm docs:preview`。
4. 若你是第一次接手專案，先讀 [Onboarding Guide](./onboarding.md)。

## 建議閱讀順序

### 第一次接手專案

1. 先看 [開發者文件總覽](./README.md)
2. 再看 [專案結構](./STRUCTURE.md)
3. 依任務進入 [驗證指南](./verify/index.md)、[規則入口](./rules/index.md)、[規格入口](./specs/index.md) 或 [決策紀錄](./decisions/index.md)

### 功能開發前查規則與規格

- 先看 [規則入口](./rules/index.md) 確認開發約束與流程。
- 再看 [規格入口](./specs/index.md) 確認目前的 Spectra 規格與變更。
- 若需要歷史背景，再補讀 [決策紀錄](./decisions/index.md)。

### 部署、驗證或故障處理

- 進入 [驗證指南總覽](./verify/index.md) 查部署、驗收、A11y 與回復流程。
- 短篇操作手冊集中於 [Runbooks](./runbooks/index.md)。

## 文件邊界與來源

- `docs/` 是 VitePress 的內容來源，也是 repo 內可直接瀏覽的文件入口。
- `rules/` 與 `specs/` 在文件站中提供導覽；實際原始來源分別位於 `.claude/rules/`、`openspec/specs/` 與 `openspec/changes/`。其中 project-wide instruction 會同步反映到 `AGENTS.md` 與 `CLAUDE.md`。
- `verify/`、`runbooks/`、`decisions/` 與根目錄治理文件屬於開發者可直接閱讀與維護的正式文件。

## 維護原則

- 新增 section index 或調整文件入口時，需同步更新 [docs/.vitepress/config.ts](./.vitepress/config.ts) 的 nav 與 sidebar。
- 優先改善導覽與敘述品質，再評估檔名搬動或資料夾重組。
- 若要 rename 已存在文件，必須先更新 openspec、報告、workflow 與程式碼中的明確引用。

## 主要入口

- [Onboarding Guide](./onboarding.md)
- [開發者文件總覽](./README.md)
- [專案結構](./STRUCTURE.md)
- [驗證指南](./verify/index.md)
- [Runbooks](./runbooks/index.md)
- [決策紀錄](./decisions/index.md)
- [Solutions](./solutions/index.md)
- [Evals](./evals/index.md)
- [規則入口](./rules/index.md)
- [規格入口](./specs/index.md)
