# Handoff — `/commit` 中斷於品質檢查階段

> **建立時間**：2026-04-19
> **觸發**：`/commit` Step 0 品質檢查發現大量 issues，token limit 即將不夠完成清理 → 交接給下個 session
> **接手後**：直接從下方「4. 接續 `/commit` Step 1+」開始；Critical 修復、Warning 清理、`pnpm dev` / `pnpm build` cleanup 與完整驗證都已完成。

## In Progress

正在執行 `/commit`，已完成 Step 0-A（兩 reviewer 平行 audit）+ Step 0-B。下方 **1.1 / 1.2 / 1.3 / 2.1 / 2.2 / 2.3 / 3** 全部已完成；`pnpm check` 與 `pnpm exec vp test run` 已全綠。先前 MCP integration 因 `hub:db` 無法在 Vitest resolve 而失敗的 blocker 已排除：**`createMcpTokenStore()` 的 auth path 改回走 `getD1Database()` raw D1，admin list/revoke store 維持 Drizzle/`hub:db`**。現在可直接接續 `/commit` Step 1 做分組與 commit。

補充：`pnpm dev` / `pnpm build` 的後續報措也已清掉。Vite+ tooling config 已從 root `vite.config.ts` 拆到 `.oxlintrc.json` / `.oxfmtrc.json` + `scripts/pre-commit-vp.sh`，Nuxt 不再警告 `vite.config.ts`；Nitro 排程 key 已改成 `retention-cleanup`，不再警告 `retention:cleanup`；`build` script 已加 Node heap 上限並過濾已知上游 sourcemap / mime noise，`pnpm build` 可直接通過。後續再補上：`/api/_dev/login` 在 local 缺 password 時會 fallback 到 `runtimeConfig.devLoginPassword`，且若既有 local user 缺 `credential` account，會自動補一條 Better Auth 相容的 scrypt-hash credential account 後再 sign-in，避免 `Credential account not found` / `User already exists` 422；Nitro `onwarn` 也已精準過濾 upstream circular dependency warning——包含 `nitropack` internal app/cache/utils、`@nuxtjs/mcp-toolkit`、`nuxt-security`、`@nuxt/hints`、`@nuxthub/core`、`@nuxt/image`、`@nuxt/nitro-server`、`@onmax/nuxt-better-auth` 等 node_modules-only cycles，但不會吃掉專案自身 `app/` / `server/` / `shared/` 的循環依賴。另外，`server/mcp/tools/{ask,categories,get-document-chunk,search}.ts` 已把 `useEvent()` 改為 handler 內動態載入，避免 tool 模組在 `tools.mjs` 載入階段直接形成 Nitro runtime cycle。

當前 changeset：

- 160 modified + 19 untracked
- 主軸：環境收斂為 `local` + `production`（依 `docs/decisions/2026-04-19-collapse-environments-to-local-and-production.md`）
- 副線：移除 MCP HTTP endpoints（toolkit 化）、admin store 重構為 Drizzle/`hub:db`、archive 3 個 spectra changes、新增 5 個 e2e debug specs、`main-v0.0.43.md`

`.gitignore` 已被還原（內含 `.spectra/` + `openspec/.vector-search.db*`），**不要再 add 進 commit**。

## 已完成（不要重做）

- ✅ `git checkout .gitignore` 還原 `.gitignore` 變更
- ✅ `vp check --fix` 修復 `.spectra/snapshots/2026-04-19-observability-and-debug/created_specs.json` 的 formatting issue
- ✅ 修復 `server/utils/mcp-token-store.ts`：保留無參數 `createMcpTokenStore()`，並將 auth path 穩定在 raw D1 / `getD1Database()`
- ✅ 修復 `test/integration/acceptance-tc-17.test.ts:13` 移除 unused `createRouteEvent` import
- ✅ `pnpm check` 已通過（2026-04-19 本 session 重跑；warning 清理後再次確認為綠）
- ✅ 兩位 reviewer 已完成審查並回報
- ✅ `createMcpTokenStore()` 已移除 `_database?: unknown` 死參數，4 個 caller 已同步更新
- ✅ `test/unit/acceptance-bindings.test.ts` 已刪除過時的 token-store assertions，保留 KV / R2 / AI Search / Workers AI coverage
- ✅ `pnpm typecheck` 通過（2026-04-19 本 session 重跑）
- ✅ `vp test run test/unit/acceptance-bindings.test.ts` 通過（2026-04-19 本 session 重跑）
- ✅ 5 支 e2e spec 已改用 env + `devLogin()` 共用 helper，硬編碼 session token 已移除
- ✅ `.env.example` 已新增 `E2E_*` 變數說明
- ✅ `pnpm exec playwright test e2e/observability-review.spec.ts e2e/token-flow.spec.ts e2e/manual-review-screenshots.spec.ts e2e/get-csrf-cookie.spec.ts e2e/token-create-debug.spec.ts --project=chromium` 通過（24 passed）
- ✅ acceptance evidence / summary tables 的 duplicate `'local' | 'local' | 'production'` drift 已清完；`grep -rn "'local' | 'local'" test/` 無輸出
- ✅ server 內 stale `staging` 註解 / 訊息已清理
- ✅ 舊 `/api/mcp/*` label / describe strings 已更新到 `/mcp` / toolkit terminology
- ✅ 發現全域 `vp`（0.1.11）與 repo 內 `pnpm exec vp` / `pnpm check` 使用的版本（vite-plus 0.1.18）不同；後續驗證**必須只用** `pnpm exec vp ...` 或 `pnpm check`
- ✅ `createMcpTokenStore()` 已保留「無參數」介面，但 auth path 改回 `getD1Database()` raw D1，修復 Vitest 中 `hub:db` 無法 resolve 的 MCP integration blocker
- ✅ `pnpm exec vp test run` 已全綠（2026-04-19 本 session 重跑）
- ✅ `pnpm dev` 不再警告 `vite.config.ts` / `retention:cleanup`，且可正常啟動於 `3010`
- ✅ `pnpm build` 已改為可直接通過（含 Node heap 上限）；已知 `vite.config.ts` / scheduled task / chunk size / mime warning signature 均不再出現
- ✅ `pnpm dev` 啟動時不再出現 `/api/_dev/login` 缺 `password` 的 400 error
- ✅ `pnpm dev` 不再出現 `@nuxtjs/mcp-toolkit` 特定 circular dependency warning
- ✅ `pnpm dev` 不再出現 `Credential account not found` / `/api/_dev/login 422 User already exists`
- ✅ `pnpm dev` 不再出現 `nuxt-security` / `@nuxt/hints` 特定 circular dependency warning
- ✅ `pnpm dev` 不再出現 `nitropack` internal、`@nuxthub/core`、`@nuxt/image`、`@nuxt/nitro-server`、`@onmax/nuxt-better-auth` 等 node_modules-only circular dependency warning
- ✅ `pnpm dev` 不再出現 `server/mcp/tools/{ask,categories,get-document-chunk,search}.ts` 相關 circular dependency warning

## Blocked（目前無）

無 active blocker。上一輪唯一卡住的是 `server/utils/mcp-token-store.ts` 直接 `import('hub:db')` 讓 MCP acceptance / integration tests 在 Vitest 失敗；現已修正為 raw D1 auth path + Drizzle admin path split。

### 使用者已做出決策

| 決策                  | 採用方案                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1（e2e specs）**   | **A** — 完整 refactor，全 5 個新 e2e spec 改用 `devLogin()` + env var 模式（仿 `e2e/observability-review.spec.ts` 的 `devLogin` 函數） |
| **Q2（broken test）** | **B** — 刪除 `test/unit/acceptance-bindings.test.ts:46-85` 的 token-store assertions，保留 KV/R2/AI Search/Workers AI 部分             |
| **Q3（dead param）**  | 預設執行：drop `createMcpTokenStore` 的 `_database?: unknown` 參數 + 更新 4 個 caller                                                  |

## Next Steps（按順序執行）

**現在直接從第 4 段開始，不需重做第 1-3 段。**

### 1. Critical 修復（必做才能 commit）

#### 1.1 已完成：移除 `_database` 死參數（Q3）

- 已完成：`server/utils/mcp-token-store.ts` 與 4 個 caller 全部改成 `createMcpTokenStore()`。
- 驗證完成：`pnpm typecheck` 已通過。

#### 1.2 已完成：修復 broken test（Q2 = B）

- 已完成：`test/unit/acceptance-bindings.test.ts` 刪除 token-store 相關 mock / assertions，保留 KV / R2 / AI Search / Workers AI coverage。
- 驗證完成：`vp test run test/unit/acceptance-bindings.test.ts` 已 PASS。

#### 1.3 已完成：e2e specs 完整 refactor（Q1 = A）

已完成：5 個 e2e specs 全部改用 env var + `devLogin()`：

- `e2e/manual-review-screenshots.spec.ts`
- `e2e/observability-review.spec.ts`（已有 `devLogin`，把硬編碼 `testpass123` 改 env var `E2E_PASSWORD`）
- `e2e/token-flow.spec.ts`
- `e2e/get-csrf-cookie.spec.ts`
- `e2e/token-create-debug.spec.ts`

**Pattern**（複製自 `observability-review.spec.ts`）：

```typescript
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@test.local'
const PASSWORD = process.env.E2E_PASSWORD ?? 'testpass123' // 給本機 fallback，但 commit 後就由 env 注入

async function devLogin(page: Page, email: string) {
  // ... 走 /api/_dev/login 取得 session cookie
}
```

已完成：所有硬編碼的 `dltOXFnyqgyX87SDB9Gqu2JK4fi8j8rz...` session token 已移除，統一改在 helper / beforeEach 跑 `devLogin()`。

順便已修這幾個 e2e 問題：

- `e2e/manual-review-screenshots.spec.ts:1` 移除 unused `expect`
- `e2e/manual-review-screenshots.spec.ts:3` rename `goto(page, path)` 的 `path` 參數為 `route`
- `e2e/manual-review-screenshots.spec.ts:278` 改 `catch (e)` 為 `catch`
- `e2e/observability-review.spec.ts:18` 移除 unused `LOG_ID_FORBIDDEN`（或加實際使用）
- `e2e/observability-review.spec.ts:20` rename function param `email` 避免 shadow

### 2. Warning 清理（已完成）

#### 2.1 已完成：修 sed artifact: `'local' | 'local' | 'production'`

19 個檔案有 duplicate union type，全是把 `'staging'` sed 成 `'local'` 的副作用。

**最佳作法**：在 `shared/schemas/knowledge-runtime.ts` 已存在 `KnowledgeEnvironment` type / `KNOWLEDGE_ENVIRONMENT_VALUES` enum，應該 import 該 type 取代 inline union。

涉及檔案（19 個）：

```
test/acceptance/evidence/a01-deploy-smoke.ts:115
test/acceptance/evidence/a02-ai-search-orchestration.ts
test/acceptance/evidence/a03-citation-replay.ts
test/acceptance/evidence/a04-current-version-only.ts
test/acceptance/evidence/a05-self-correction.ts
test/acceptance/evidence/a06-refusal-accuracy.ts
test/acceptance/evidence/a07-mcp-contract.ts
test/acceptance/evidence/a08-oauth-allowlist.ts
test/acceptance/evidence/a09-restricted-scope.ts
test/acceptance/evidence/a10-admin-web-mcp-isolation.ts
test/acceptance/evidence/a11-persistence-audit.ts:218
test/acceptance/evidence/a12-mcp-no-internal-diagnostics.ts
test/acceptance/evidence/a13-rate-limit-retention.ts:193
test/acceptance/evidence/ev01-core-loop.ts:211
test/acceptance/evidence/ev02-oauth-allowlist.ts:196
test/acceptance/evidence/ev03-publish-cutover.ts
test/acceptance/evidence/ev04-rate-limit-cleanup.ts
test/acceptance/evidence/ev-ui-01-state-coverage.ts
test/acceptance/evidence/run-all.ts
test/acceptance/evidence/summary-tables.ts
```

**驗證**：`grep -rn "'local' | 'local'" test/` 已無輸出。

#### 2.2 已完成：stale `staging` 註解清理

5 個 server 檔案註解／錯誤訊息仍提到 `staging`：

- `server/api/admin/retention/prune.post.ts:13,59` — comment + error message
- `server/utils/retention-seed.ts`
- `server/utils/knowledge-retention.ts`
- `server/utils/debug-surface-guard.ts`
- `server/api/_dev/login.ts`
- `server/api/setup/create-admin.ts`

**作法**：grep `grep -rn "staging" server/utils server/api --include="*.ts" | grep -v "// 歷史" | grep -v "@deprecated"` 找出所有並移除（保留歷史紀錄類註解）。

#### 2.3 已完成：stale `/api/mcp/*` describe strings

3 處 test 仍用舊路徑當 label：

- `test/integration/get-document-chunk-replay.test.ts:166`
- `test/integration/evidence-exporter.test.ts:82`
- `test/acceptance/evidence/a01-deploy-smoke.ts:84`

**作法**：改為新的 toolkit 路徑 `/mcp` JSON-RPC 對應名稱。

### 3. 驗證循環（已完成）

已完成：

- `pnpm check` ✅
- `pnpm exec vp test run` ✅
- secret / duplicate-union grep 檢查 ✅

```bash
# 1. format
vp fmt .

# 2. 完整檢查
pnpm check        # 必須 0 errors + 0 warnings
vp test run       # 必須全綠（特別檢查 acceptance-bindings.test.ts 已修好）

# 3. 確認警告全清
vp check 2>&1 | grep -E "^\s+! " | wc -l   # 必須 = 0

# 4. 確認 secret 全清
grep -rn "dltOXFnyqgyX87SDB9Gqu2JK4fi8j8rz" e2e/   # 必須無輸出
grep -rn "testpass123" e2e/                          # 必須只在 fallback default 出現
grep -rn "'local' | 'local'" test/                   # 必須無輸出
```

### 4. 接續 `/commit` Step 1+

驗證全綠後，輸出：

```text
✅ 0-A-1 simplify 通過（中斷後重審或補充說明）
✅ 0-A-2 code-review 通過（中斷後重審或補充說明）
✅ 0-B 通過
```

然後依 `/commit` 流程：

#### Step 1：`git status` + `git diff --stat` 取最新狀態（**先確認 `.gitignore` 仍是還原狀態**）

#### Step 2：建議分組（依目前 changeset 觀察，由你按情境調整）

```text
### Group 1: 環境收斂為 local + production
類型: 🔨 refactor
範圍: shared/schemas/knowledge-runtime.ts、~30 docs/verify/*、scripts/retention-prune.ts、test fixtures
含 ADR: docs/decisions/2026-04-19-collapse-environments-to-local-and-production.md

### Group 2: MCP HTTP endpoints 移除（toolkit 化）
類型: 🔨 refactor
範圍: 移除 server/api/mcp/{ask,categories,chunks/[citationId],search}.{get,post}.ts
含 archived spectra change: openspec/changes/archive/2026-04-19-migrate-mcp-to-toolkit/

### Group 3: Admin store 遷移至 Drizzle / hub:db
類型: 🔨 refactor
範圍: server/utils/{admin-dashboard-store,mcp-token-store,query-log-admin-store,query-log-debug-store}.ts
       + 對應 server/api/admin/**/*.ts call site 更新
       + test/unit/{admin-dashboard-store,query-log-debug-store,mcp-token-store,acceptance-bindings}.test.ts
       + 修 _database 死參數（決策 Q3）

### Group 4: 新增 e2e debug specs
類型: 🧪 test
範圍: e2e/{token-flow,token-create-debug,get-csrf-cookie,manual-review-screenshots,observability-review}.spec.ts
       + playwright.config.ts 調整
       + 對應 .env.example 新增 E2E_* 變數說明

### Group 5: chat / admin UI 改進
類型: ✨ feat
範圍: app/components/chat/{CitationReplayModal,Container,MessageList}.vue、app/pages/admin/query-logs/index.vue、app/pages/admin/tokens/index.vue、app/components/admin/tokens/TokenCreateModal.vue

### Group 6: spectra changes 歸檔 + ROADMAP 更新
類型: 📝 docs
範圍: openspec/changes/archive/2026-04-19-{admin-document-lifecycle-ops,fix-document-publish-draft-to-active,observability-and-debug,admin-ui-post-core}/
       （注意：migrate-mcp-to-toolkit 在 Group 2 已含，**不要**重複放這裡）
       + openspec/specs/admin-document-management-ui/spec.md 更新
       + openspec/specs/admin-observability-dashboard/、admin-query-log-ui/、admin-token-management-ui/（admin-ui-post-core 帶過來的新 specs，已存在於 openspec/specs/）
       + openspec/ROADMAP.md
       + openspec/config.yaml 版號

**注意**：`admin-ui-post-core` 在當前 working tree 已完成 archive（changes/admin-ui-post-core/ 全 deleted，archive/2026-04-19-admin-ui-post-core/ 為 untracked，3 個 spec 已 promote 到 openspec/specs/）。Group 6 commit 必須同時包含：
1. `git rm` 原始 `openspec/changes/admin-ui-post-core/*`（自動由 staged deletions 處理）
2. `git add openspec/changes/archive/2026-04-19-admin-ui-post-core/`
3. `git add openspec/specs/admin-observability-dashboard/ openspec/specs/admin-query-log-ui/ openspec/specs/admin-token-management-ui/`（若這些是新 promote 的 specs）

驗證：commit 後 `find openspec/changes -type d -name "admin-ui*"` 應只剩 `archive/2026-04-19-admin-ui-post-core/`。

### Group 7: skill / agent / tooling 微調
類型: 🧹 chore
範圍: .claude/agents/screenshot-review.md、.claude/skills/review-screenshot/SKILL.md、CLAUDE.md、scripts/spectra-ux/*

### Group 8: 主報告 main-v0.0.43.md
類型: 📝 docs
範圍: 新版報告

### Group 9: nuxt.config / package 設定
類型: 📦 build
範圍: nuxt.config.ts、pnpm-workspace.yaml、package.json（含 deps）
注意：package.json 的 version bump 由 Step 5 統一處理，**不要在這裡 bump**
```

#### Step 5：版本升級（feat 存在 → minor）

```bash
pnpm version minor --no-git-tag-version  # 0.15.0 → 0.16.0
git add package.json
git commit -m "..."
pnpm tag
```

## 注意事項 / 陷阱

- **`.gitignore` 不要 commit**——已被還原，若再次出現變更需再次 `git checkout .gitignore`
- **`.spectra/` 是 spectra runtime cache**——目前未在 gitignore 中，但因為 `pnpm check` 會掃 `.spectra/` 內 JSON 檔，commit 進去也無妨；唯一注意 `.spectra/snapshots/` 應視為產出物
- **`pnpm check` 不跑 vitest**——`acceptance-bindings.test.ts` regression 是因此被 typecheck 忽略；commit 前**必須**手動跑 `vp test run`
- **MCP token auth path 不要再直接碰 `hub:db`**——acceptance fixtures 依賴 fake D1 並明確驗證 `FROM/UPDATE mcp_tokens` raw SQL；目前正確分工是 auth path 用 `getD1Database()`，admin list/revoke path 才用 Drizzle
- **只用 repo 內的 VP 工具鏈**——全域 `vp` 與 `pnpm exec vp` 版本不同，請固定用 `pnpm exec vp ...` 或 `pnpm check`
- **e2e specs 是 untracked 新檔**——refactor 完成後直接 `git add e2e/*.spec.ts` 即可
- **`docs/decisions/2026-04-19-collapse-environments-to-local-and-production.md`** 是 Group 1 的決策文件，必須與環境收斂改動同 commit
- **`main-v0.0.43.md`** 是 thesis report，依 `CLAUDE.md` 指示，內容變更必須與程式同步——本次的環境收斂改動應已反映在 v0.0.43，但接手後再對照一次表 2-25 與 §2.4.1.6 確認

## 參考：reviewer 完整輸出

兩位 reviewer 的完整 review 結果在這次 session 的對話歷史中。摘要已轉錄到本檔的「Critical 修復」與「Warning 清理」兩節，無遺漏。

## 完成條件

當以下都成立時，可以刪除本 HANDOFF.md：

- [ ] 9 個 commit 全部入庫（含 1 個 🚀 deploy）
- [ ] `git tag` 顯示新版號 `v0.16.0` 已建立並推到 origin
- [ ] `git status` 顯示 working tree clean（除了可能的 `.gitignore` 若被工具再次動到）
