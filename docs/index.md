---
layout: home

hero:
  name: Nuxt Edge Agentic RAG Docs
  text: 開發者文件入口
  tagline: 讓新進開發者能先找到路，再進到正確文件，而不是先淹沒在檔名裡。
  actions:
    - theme: brand
      text: 先看結構
      link: /STRUCTURE
    - theme: alt
      text: docs README
      link: /README
    - theme: alt
      text: 驗證指南
      link: /verify/

features:
  - title: 先找任務，再找文件
    details: 入口頁改成依工作情境導向，部署、驗證、規則、決策各自有明確入口。
  - title: 兼顧 repo 與文件站
    details: 補上 docs 與 verify 的 README，讓 GitHub 檔案樹與 VitePress 兩邊都好找。
  - title: 保守整理，不打斷引用
    details: 既有檔名與位置先保留，先把導航品質做對，再考慮第二階段 rename。
---

## 你現在應該從哪裡開始

### 我是第一次接手這個 repo

1. 看 [README](./README.md)
2. 看 [STRUCTURE](./STRUCTURE.md)
3. 再依任務進 verify、rules、specs 或 decisions

### 我要部署、驗證或處理故障

- 進 [verify/index](./verify/index.md)
- 從 Deployment Runbook、Disaster Recovery Runbook、checklists 開始

### 我要改功能，但不確定有哪些既有規則

- 看 [rules/index](./rules/index.md)
- 看 [specs/index](./specs/index.md)
- 需要背景再補 [decisions/index](./decisions/index.md)

## 目前整理方式

- 根目錄保留專案層文件，例如結構說明、design tokens、manual review 與 tech debt。
- verify、runbooks、decisions、sample-documents 各自有 section index，先把入口理清。
- docs 與 verify 都補了 README，讓 repo 檔案樹與文件站的入口一致。
- 既有 Markdown 檔案不搬家，降低與目前工作樹衝突的風險。

## 文件邊界

- 文件站裡放的是可公開渲染、適合閱讀的 Markdown。
- 真正的規則內容仍以 `.claude/rules/` 與 `.github/instructions/` 為主。
- 真正的 spec 內容仍以 `openspec/specs/` 與 `openspec/changes/` 為主。

## 現在文件站已經做到的事

- 有首頁、側欄、section index 與 repo README 入口。
- verify 區已按主題分組，不再是單一長清單。
- build 已通過，可直接用 `pnpm docs:dev` 預覽。
