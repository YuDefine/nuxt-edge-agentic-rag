# 專案結構說明

本文件描述目前 repo 的 canonical roots、責任邊界，以及幾個容易混淆的重疊區域。目的不是列出每一個檔名，而是讓維護者先知道「應該去哪裡找」與「哪裡才是 source of truth」。

## 結構總覽

本 repo 目前同時承載四個層次：

1. 產品程式碼：`app/`、`server/`、`shared/`
2. 驗證與測試：`test/`、`e2e/`、`docs/verify/`
3. 規格與治理：`openspec/`、`docs/`、根目錄治理文件
4. Agent 與工具鏈：`.claude/`、`.agents/`、`.agent/`、`scripts/`

## Canonical Roots

| 路徑         | 角色              | 說明                                                                                 |
| ------------ | ----------------- | ------------------------------------------------------------------------------------ |
| `app/`       | 前端應用          | Nuxt 頁面、元件、composables、UI 專用型別與工具                                      |
| `server/`    | 後端應用          | Nitro API、資料存取、伺服器工具、背景任務相關邏輯                                    |
| `shared/`    | 共用契約          | 前後端共用 schema、型別與純工具                                                      |
| `docs/`      | 文件站內容        | VitePress 入口、操作文件、導覽頁與治理文件                                           |
| `openspec/`  | 規格系統          | 穩定規格、進行中 changes、roadmap                                                    |
| `test/`      | Vitest 測試       | unit、integration、acceptance 與 fixture                                             |
| `e2e/`       | Playwright 測試   | UI 與 journey 驗證規格                                                               |
| `scripts/`   | 工具腳本          | 建置、檢查、修補、部署與維運腳本                                                     |
| `HANDOFF.md` | session 交接      | repo root 的 canonical handoff artifact，只保留尚未接手的 WIP / blocker / next steps |
| `template/`  | 模板資產          | 保留樣板或範本用途，不再承擔 live handoff artifact                                   |
| `.claude/`   | Claude 工作流來源 | rules、skills、hooks、commands、agents                                               |
| `.agents/`   | Agent 資產鏡像    | 以 skill 為主的鏡像內容                                                              |
| `.agent/`    | Agent 工作流      | 較小型的 workflow 定義區                                                             |
| `build/`     | 建置程式碼        | 目前是 hand-written build logic，不是輸出產物                                        |

## 產品程式碼

### `app/`

`app/` 是 Nuxt 前端主體，主要結構如下：

- `pages/`：目前以 `account/`、`admin/`、`auth/`、`chat/` 為主
- `components/`：目前以 `admin/`、`auth/`、`chat/`、`debug/`、`documents/` 分組
- `composables/`：畫面與資料互動邏輯
- `layouts/`、`middleware/`：路由與頁面殼層
- `types/`：前端顯示層或頁面專用型別
- `utils/`：前端工具

### `server/`

`server/` 是 Nitro 伺服器層，主要結構如下：

- `api/`：HTTP handler，現有分組包括 `_dev/`、`admin/`、`auth/`、`citations/`、`conversations/`、`documents/`、`guest-policy/`、`setup/`、`uploads/`
- `database/`：目前放 migration
- `db/`：目前放 runtime schema 定義
- `entry/`、`mcp/`、`plugins/`、`tasks/`、`utils/`：伺服器啟動、MCP、插件、任務與工具

### `shared/`

`shared/` 放跨前後端的契約層：

- `schemas/`：Zod schema 與輸入驗證結構
- `types/`：共享型別
- `utils/`：純函式工具，例如 exhaustive switch 相關 helper

## 文件、規格與治理

### `docs/`

`docs/` 同時是 repo 內可直接閱讀的文件入口，也是 VitePress 文件站的內容來源。它負責：

- onboarding 與文件導覽
- `verify/`、`runbooks/`、`decisions/` 等正式操作與治理文件
- `solutions/`、`evals/` 這類除錯解法與評測沉澱
- `rules/`、`specs/` 這類入口頁

`docs/` 不是所有知識的唯一來源。部分內容只提供入口，不保存原始定義。

### `openspec/`

`openspec/` 是 Spectra 規格系統的原始來源：

- `specs/`：穩定規格
- `changes/`：進行中與已歸檔 change
- `ROADMAP.md`：當前進度、可並行性與 next moves

### Agent 與規則來源

目前需要明確區分三種層次：

- `.claude/rules/`：主要規則來源
- `.agents/`、`.agent/`：agent 資產與 workflow 鏡像

若要查「規則原文」，先看 `.claude/rules/`。若要查「規格原文」，先看 `openspec/`。`docs/rules/` 與 `docs/specs/` 只做導覽。

## 測試與驗證

### `test/`

`test/` 是目前的 Vitest 主測試樹：

- `unit/`
- `integration/`
- `acceptance/`
- `fixtures/`
- `helpers/`

### `e2e/`

`e2e/` 是 Playwright 規格根目錄，集中 UI、journey 與驗收型端到端測試。

### `tests/`

`tests/` 目前存在，但不是主要 tracked 測試根目錄。新增正式測試時，優先沿用現行慣例：Vitest 放 `test/`，Playwright 放 `e2e/`。

## 工具與建置

### `scripts/`

`scripts/` 放各式執行腳本，包括：

- 檢查與 gate
- deploy 與 health check
- 開發期 patch
- Spectra roadmap / follow-up 工具

### `build/`

`build/` 目前是建置邏輯來源的一部分，例如 Nitro rollup 設定。它不是像 `.nuxt/` 或 `.output/` 那種可丟棄的產物目錄。

### 常見忽略輸出

以下目錄主要是本機或 CI 產物，不視為結構核心：

- `.nuxt/`
- `.output/`
- `coverage/`
- `screenshots/`
- `test-results/`
- `tmp/`
- `.spectra/`

## 已知重疊與判讀原則

### `docs/` vs `openspec/`

- `docs/`：可閱讀入口、正式操作文件、決策、除錯解法與評測沉澱
- `openspec/`：規格原文與 change lifecycle

### `docs/decisions/` vs `docs/solutions/`

- `decisions/`：跨任務生效的技術選擇與架構取捨
- `solutions/`：個案 debug 心得與 workaround 的可重用記錄

### `.claude/` vs `.agents/` vs `.agent/`

- `.claude/`：Claude workflow 原始資產
- `.agents/`：skill 為主的鏡像
- `.agent/`：較小型 workflow 區

### `app/types/` vs `shared/types/`

- `shared/types/`：跨前後端契約
- `app/types/`：前端專用顯示型別

### `server/database/` vs `server/db/`

- `server/database/`：migration 與資料庫變更歷史
- `server/db/`：runtime schema 與資料存取結構

## 新接手閱讀順序

1. 先看 `docs/README.md`
2. 再看本文件確認 canonical roots
3. 若是功能工作，進 `openspec/` 與 `docs/rules/`
4. 若是產品開發，進 `app/`、`server/`、`shared/`
5. 若是測試或驗證，進 `test/`、`e2e/`、`docs/verify/`

## 相關文件

- [開發者文件總覽](./README.md)
- [規則入口](./rules/index.md)
- [規格入口](./specs/index.md)
- [驗證指南](./verify/index.md)
