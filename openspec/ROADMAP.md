# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-21 更新）：Production 跑 v0.24.3。無 active change、無 open tech debt、無 follow-up。
>
> **最近完成**（2026-04-21）：
>
> - **專題報告升版至 `main-v0.0.46.md`**（commit `b660c08` → deploy `f264132` / tag `v0.24.3`，patch bump）— 把 2026-04-21 跑通之驗收自動化（Unit 6 / MCP 51 / Integration 260 / TC 42 全綠）、§3.2.3 七張實機截圖（`screenshots/local/report-v46/`）、EV runbook 指向、表 4-1 三級狀態分級、附錄 D-1 AI Gateway env var 寫進第三、四章。`frozen-final` 正式驗收跑報仍留待實模型接入後。
> - **conversation-create test 補 member role**（commit `87bd6ce` → deploy `f3962fa` / tag `v0.24.2`，patch bump）— 消除 `getGuestPolicy` 的 `hub:db` dynamic import warn log 4 次；test 數不變（260 passed / 1 skipped）。
>
> **2026-04-20 完成**：
>
> - **專題報告升版至 `main-v0.0.45.md`**（commit `971511d` / tag `v0.24.1`，patch bump）— 補齊 B16 三級 RBAC、AI Gateway、migration 0007-0008、響應式等已完成實作在第二、三章的敘述；圖表目錄總張數 50 → 53；§5.2.1 新增「已實作但尚未驗收」段落。
> - `add-ai-gateway-usage-tracking` — Phase 1~5 實作 + test + Design Review + 人工檢查 H.1~H.9 全通過 → archive（commit `23d4ffd`）。Cloudflare AI Gateway 外部前置 + Analytics token + wrangler secret 完成；v0.23.0 → v0.23.1 部署上線。
> - TD-001~TD-008 — 技術債全數解決（Drizzle 遷移、guest_policy runbook、text-dimmed 對比度、首頁 hit-target、admin a11y 批次、Nuxt UI variant override、裝飾 icon aria-hidden、acceptance-tc-0x MCP mock drift）。
> - **Follow-up 全清**（2026-04-20 下午）：
>   - `admin-session.ts` allowlist fallback 刪除 — Phase 3 hook (`session.create.before` A/B/C/D drift reconciliation) 已於 B16 archive 時部署並活躍運行，fallback 分支確定無 prod 流量；移除同時精簡註解。
>   - `mcp_tokens.created_by_user_id` 收緊為 NOT NULL（migration 0008）— prod 先 DELETE 4 筆 local/staging test seed（無 query_logs 引用）+ UPDATE 2 筆 prod test token 到 charles user id（保留 audit trail），剩 3 筆全 non-NULL 後才 ALTER；同步清掉 `mcp-role-gate.ts` 的「null as system seed」legacy bypass 與 `McpTokenRecord.createdByUserId` 的 `| null`。
>   - `chat.post.ts` 雙重 session 讀取 follow-up — 全 repo 審視後確認所有 `server/api/**` endpoint 已收斂為單次 session helper（`requireRole` / `requireUserSession` / `requireRuntimeAdminSession`），無其他 handler 殘留此 pattern。
>
> **待辦**（handoff 中）：
>
> - `frozen-final` 驗收跑報：實模型接入後跑 30–50 筆正式測試集，回填 v47 §3.3.2 表 3-7 / 表 3-8 的延遲 / P50 / P95 / Judge 觸發率統計
> - `/chat` 實機截圖重拍「有回答 + 引用卡片」版本（需完整 R2 + AI Search 閉環或 staging 環境）
> - `/admin/usage` 接上真實 `CLOUDFLARE_API_TOKEN_ANALYTICS` 後重拍 loaded 版本
> - 第五章 §5.1 組員心得、§5.2.2 實作前待驗證事項在最終交付前依實際驗收結果回填

## Next Moves

### 本輪優先序

_（等待下一個需求進來再排）_

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-20T13:47:20.452Z_

_No active changes._

### Ready to apply

_(none)_

### In progress

_(none)_

### Draft

_(none)_

### Blocked

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/active -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->

## Parallel Tracks

> Which active changes can be worked on **simultaneously** without stepping on each other.

### Independent (can run in parallel)

_(none)_

### Mutex (same spec touched)

_(none)_

### Blocked by dependency

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/parallelism -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parked -->

## Parked Changes

> 已 `spectra park` 的 changes。檔案暫時從 `openspec/changes/` 移出，
> metadata 保留在 `.spectra/spectra.db`。`spectra unpark <name>` 可取回。

_No parked changes._

<!-- SPECTRA-UX:ROADMAP-AUTO:/parked -->

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Parked Changes Backlog

_(none — 2026-04-19 下午 8 個 parked change 全部 unpark 處理完畢：2 個刪除、1 對合併、5 個留作 active。)_

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
