## 1. 批次 1：Vitest alias parity with Nuxt runtime

- [x] 1.1 在 `vitest.config.ts` 的 `aliases` 物件補上 `#shared` 指向 `./shared`、`#server` 指向 `./server`（Vitest alias parity with Nuxt runtime 前置條件）
- [x] 1.2 跑 `pnpm typecheck` 與 `pnpm test`（所有 project），確認沒有既有測試因新增 alias 出現解析衝突（baseline：3 個既有失敗測試與 alias 無關，stash 前後數字一致）
- [x] 1.3 Commit 批次 1（單獨 commit，方便之後 revert）

## 2. 批次 2：app/ 與 server/ 原始碼導入 alias（Alias-based cross-module imports 第一階段）

- [x] 2.1 [P] 改 `app/composables/useUserRole.ts`：`../../shared/schemas/knowledge-runtime` → `#shared/schemas/knowledge-runtime`（Alias-based cross-module imports 第一筆）
- [x] 2.2 [P] 改 `server/auth.config.ts`：`../shared/schemas/knowledge-runtime` → `#shared/schemas/knowledge-runtime`（發現 jiti loader 無法解析 `#shared`，已加註解保留相對路徑並更新 spec 的 Exception 條款）
- [x] 2.3 [P] 改 `server/plugins/sync-admin-roles.ts`：`../utils/knowledge-runtime` → `#server/utils/knowledge-runtime`
- [x] 2.4 [P] 改 `server/utils/**.ts` 中 13 處 `../../shared/...` 為 `#shared/...`（檔案：`allowlist.ts`、`document-list-store.ts`、`document-publish.ts`、`document-store.ts`、`document-sync.ts`、`knowledge-answering.ts`、`knowledge-retrieval.ts`、`knowledge-runtime.ts`、`mcp-ask.ts`、`mcp-auth.ts`、`mcp-token-store.ts`、`web-chat.ts` 等）
- [x] 2.5 [P] 改 `server/api/**/*.ts` 中所有 `../../../utils/...`、`../../utils/...` 為 `#server/utils/...`（約 20+ 檔）
- [x] 2.6 跑 `pnpm typecheck` 全綠
- [x] 2.7 跑 `pnpm test`（所有 project）全綠（與 batch 1 baseline 完全一致：44 passed / 3 pre-existing failed）
- [x] 2.8 跑 `pnpm lint` 全綠（與 baseline 完全一致：1 pre-existing warning 不相關）
- [x] 2.9 搜尋殘留：`grep -rE "from ['\"]\.\.\/" app/ server/ shared/` 應只剩 sibling 相對路徑（`./xxx`）或本次規則允許的 within-folder 匯入
- [ ] 2.10 Commit 批次 2

## 3. 批次 3：test/ 導入 alias（Alias-based cross-module imports 第二階段）

- [ ] 3.1 [P] 改 `test/unit/**/*.ts` 中 25 處 `../../server/utils/...` 為 `#server/utils/...`
- [ ] 3.2 [P] 改 `test/unit/**/*.ts` 中 16 處 `../../shared/...` 為 `#shared/...`
- [ ] 3.3 [P] 改 `test/unit/**/*.ts` 中 2 處 `../../app/utils/assert-never` 為 `~/utils/assert-never`
- [ ] 3.4 [P] 改 `test/integration/**/*.ts` 的 `../../` 匯入為對應 alias
- [ ] 3.5 [P] 改 `test/acceptance/**/*.ts` 與 `test/nuxt/**/*.ts`（若有）的 `../../` 匯入為對應 alias
- [ ] 3.6 跑 `pnpm test`（所有 project）全綠，確認 Vitest alias parity with Nuxt runtime 生效
- [ ] 3.7 跑 `pnpm lint` 與 `pnpm typecheck` 全綠
- [ ] 3.8 搜尋殘留：`grep -rE "from ['\"]\.\.\/" test/` 應只剩 sibling 相對路徑（`./xxx`）
- [ ] 3.9 Commit 批次 3

## 4. 收尾驗證

- [ ] 4.1 跑完整 `pnpm check`（format + lint + typecheck + test）全綠
- [ ] 4.2 `git diff main...` 檢視三批次合計 diff，確認沒有意外變動 runtime 行為的 import（只有字串前綴改變）
- [ ] 4.3 全 repo 殘留搜尋 `grep -rE "from ['\"]\.\.\/\.\." app/ server/ shared/ test/`，應為 0
