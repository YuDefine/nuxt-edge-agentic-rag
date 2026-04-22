# 開發者文件總覽

本目錄同時扮演兩個角色：

- 作為 repo 內直接瀏覽的文件入口。
- 作為 VitePress 文件站的內容來源。

這份文件的目的，是讓開發者先掌握文件結構與來源邊界，再依任務進入正確的操作手冊、規則入口或決策紀錄。

## 適用範圍

- 新加入專案、需要快速完成 onboarding 的開發者。
- 需要部署、驗證、除錯或查找既有決策背景的協作者。
- 需要確認規則、規格與治理文件分工的維護者。

## 快速開始

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

- `pnpm docs:dev`：啟動本機文件站，預設埠號為 `4173`。
- `pnpm docs:build`：驗證文件內容可正常通過 VitePress 建置。
- `pnpm docs:preview`：以正式建置結果進行本機預覽。

如果你是第一次接手專案，建議先讀 [Onboarding Guide](./onboarding.md)，再回頭依任務查看其他區塊。

## 環境與端點

| 環境       | 端點                                      | 備註                                                                                                                                                                                                          |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local      | `http://localhost:3010`                   | Nuxt 開發伺服器預設埠號；`.env` 與 `.env.example` 的 `E2E_BASE_URL` 也使用此位址。                                                                                                                            |
| Production | `https://agentic.yudefine.com.tw`         | 正式環境對外網域；對應 `wrangler.jsonc` 的 Cloudflare route 設定。                                                                                                                                            |
| Staging    | `https://agentic-staging.yudefine.com.tw` | Staging 環境對外網域；對應 `wrangler.staging.jsonc` 的 Cloudflare route 設定，並由 `.github/workflows/deploy.yml` 的 `deploy-staging` job 透過 `scripts/render-staging-wrangler.mjs` 產生實際部署設定後發布。 |

### 文件站網址

| 類型            | 來源                                           | 備註                                                                                                                     |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Production Docs | `https://agentic-docs.yudefine.com.tw`         | 對應 GitHub repository variable `DOCS_PRODUCTION_URL`；Cloudflare Pages 正式文件站 custom domain。                       |
| Staging Docs    | `https://agentic-docs-staging.yudefine.com.tw` | 對應 GitHub repository variable `DOCS_STAGING_URL`；DNS 會指向 `staging` branch preview alias，作為 staging 文件站網址。 |

文件站網址目前以 GitHub repository variables 管理，避免在 repo 內硬編碼錯誤或過期的 docs 網域；[deploy workflow](../.github/workflows/deploy.yml) 會在 app deploy 同一條流程內發布 docs，並自動同步對應的 Cloudflare Pages custom domain；必要時也可用 [docs-domain-sync workflow](../.github/workflows/docs-domain-sync.yml) 單獨補跑修復。

若需要查部署現況或正式上線流程，請搭配 [驗證指南總覽](./verify/index.md) 與 [決策紀錄](./decisions/index.md) 一起閱讀。

## 建議閱讀順序

### 1. 先建立專案地圖

- [Onboarding Guide](./onboarding.md)
- [專案結構](./STRUCTURE.md)
- [文件首頁](./index.md)

### 2. 再依任務進入對應文件

- 要部署、驗證或處理事故：看 [驗證指南總覽](./verify/index.md)
- 要查維運短手冊：看 [Runbooks](./runbooks/index.md)
- 要理解既有決策：看 [決策紀錄](./decisions/index.md)
- 要查規則與 Spectra 規格入口：看 [規則入口](./rules/index.md) 與 [規格入口](./specs/index.md)

### 3. 最後再深入單一文件

- `verify/` 內以可操作、可驗證的手冊為主。
- 根目錄的 design tokens、manual review、tech debt 偏向專案治理與長期維護資訊。

## 文件區塊說明

| 路徑                | 用途                                 | 主要讀者                         |
| ------------------- | ------------------------------------ | -------------------------------- |
| `verify/`           | 部署、驗證、QA、保留策略等操作型文件 | 開發與維運人員                   |
| `runbooks/`         | 較短、單一主題的操作手冊             | 需要快速查表的協作者             |
| `decisions/`        | 已記錄的技術決策與背景               | 需要理解架構選擇的開發者         |
| `sample-documents/` | 知識庫與文件樣本                     | 建模、測試與展示用途             |
| `rules/`            | 文件站中的規則導覽頁                 | 需要查流程與約束的開發者         |
| `specs/`            | Spectra 規格導覽頁                   | 需要查功能規格與 change 的開發者 |

## Source of Truth 邊界

- `docs/` 提供可閱讀、可渲染的正式文件內容。
- `.claude/rules/` 與 `.github/instructions/` 才是規則原始來源；`docs/rules/` 只負責入口導覽。
- `openspec/specs/` 與 `openspec/changes/` 才是 Spectra 規格原始來源；`docs/specs/` 只負責入口導覽。
- VitePress 文件站的部署流程位於 [deploy workflow](../.github/workflows/deploy.yml) 內的 docs jobs，靜態輸出會發布到 Cloudflare Pages。

## 維護原則

- 先改善導覽與資訊架構，再做大規模檔名搬動。
- 新增或調整 section index 時，需同步更新 [docs/.vitepress/config.ts](./.vitepress/config.ts) 的 nav 與 sidebar。
- `verify` 目前保留既有檔名，是因為 repo 內仍有大量明確路徑引用。
- 如果未來要 rename，應先批次更新 openspec、報告、workflow 與程式碼中的引用。
