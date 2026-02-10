## Why

專案中有 157 處 `../` / `../../` / `../../../` 相對路徑 import，跨越 `app/`、`server/`、`shared/`、`test/` 四個來源樹。相對路徑讓檔案搬家時必須手動調層數、review 時難以判斷跨模組邊界、新加入的讀者必須心算路徑才能知道 import 的是什麼。Nuxt 4 已內建 `~/`、`~~/`、`#shared`、`#server` 這四個 alias，目前未被利用。

## What Changes

- 將 `app/`、`server/`、`shared/` 原始碼中的相對路徑 import 統一改用 Nuxt 4 內建 alias：
  - `../../shared/...`（跨模組） → `#shared/...`
  - `../../utils/...`（server 內跨深度） → `#server/utils/...`
  - `../../app/utils/...`（測試指向 app） → `~/utils/...`
- 將 `test/` 目錄中的相對路徑 import 統一改用 alias；其中 `#shared` / `#server` 需要在 `vitest.config.ts` 的 `aliases` 物件補上對應條目（目前只設了 `~` / `@` / `~~` / `@@`）。
- 分批提交降低 review 負擔：
  - 批次 1：`vitest.config.ts` 補 `#shared` / `#server` alias（前置條件，讓測試檔能用）。
  - 批次 2：`app/` + `server/` 原始碼（27 檔）。
  - 批次 3：`test/` 檔案（37 檔）。
- `nuxt.config.ts` 本身**不新增** `alias` 欄位——所有需要的 alias 都是 Nuxt 4 內建。

## Non-Goals

- **不**變動 import 順序、`eslint-plugin-import` 規則、或 `oxlint` 設定。
- **不**自動化為 lint rule（例如 `no-relative-parent-imports`）；本次只做機械替換，lint 化另案處理。
- **不**動 `e2e/`、`scripts/`、`docs/` 目錄（這些執行環境不走 Nuxt alias）。
- **不**處理 Node 內建模組的相對 require 或 monorepo 外部 workspace 引用。
- **不**改變任何 runtime 行為；所有變更都是純 import 路徑字串替換，typecheck 與 test 結果應完全一致。

## Capabilities

### New Capabilities

- `import-conventions`: 定義此 repo 跨模組 import 的強制路徑前綴（`~/`、`#shared`、`#server`），以及 `vitest.config.ts` 與 Nuxt 內建 alias 必須同步的約束。這條 convention 讓後續 lint rule 或 audit script 有 spec-level 依據。

### Modified Capabilities

（無。）

## Affected Entity Matrix

無——本次 refactor 不觸及任何 DB entity、table、column、enum，純粹是 TypeScript import 路徑字串替換。

## User Journeys

**No user-facing journey (backend-only)**

理由：這是 repo 層級的 import 路徑慣例統一，所有變更都是編譯期路徑解析，執行後沒有任何 user-facing surface（UI、API response、errors、DB schema）會改變。驗證靠 `pnpm check` 全綠 + 既有 test suite 全綠。

## Impact

- **Affected specs**: 僅新增 `import-conventions` spec（repo-level convention，無 user-facing 行為）。不觸及 `admin-document-management-ui` 或 `web-chat-ui` 的行為定義。
- **Affected code**：
  - `vitest.config.ts`（新增 `#shared` / `#server` alias）
  - `app/composables/useUserRole.ts`（1 檔 / 1 import）
  - `server/**/*.ts`（27 檔 / 約 50 imports，主要 `server/utils/` 與 `server/api/`）
  - `test/unit/**/*.ts`、`test/integration/**/*.ts`、`test/acceptance/**/*.ts`（37 檔 / 約 100 imports）
- **Affected bindings / runtime**：無（純編譯期路徑解析）。
- **風險與驗證**：
  - Nuxt 4 已經提供 `#shared` / `#server`，但這些是 **Nuxt 的 TS path**，在 `vitest` 獨立執行時若沒手動同步就會解析失敗——批次 1 必須先做完才能進批次 2/3。
  - 每批次完成後必須跑 `pnpm check`（typecheck + lint + test）全綠才算完成，確保路徑替換無遺漏或錯置。
  - 分批提交確保若某批次產生回歸，可單獨 revert，不影響其他批次。
