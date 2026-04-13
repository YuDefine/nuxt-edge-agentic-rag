# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-20 更新 — Next Move 推進中）：Production 跑 v0.22.1。v1 三條 wip 全部 archive。
>
> **Next Moves 推進紀錄（2026-04-20）**：
>
> - ✅ Migration 0006 production apply — `wrangler d1 migrations list agentic-rag-db --remote` 回 "No migrations to apply"，確認 production 先前已 apply（可能透過 nuxthub auto-deploy）。原 roadmap "待 schedule" 已過時，移除
> - 🟡 `add-ai-gateway-usage-tracking` — Phase 1/2/3/4 實作 + test 完成（code 路徑全通）；Phase 5 Design Review 與 H.1~H.9 人工檢查待 dev server + Cloudflare Dashboard 前置完成
>
> **目前 1 draft 實作中**（`add-ai-gateway-usage-tracking`）。使用者改變決策（從 post-v1 low priority → 推進）；見 2026-04-20 對話。
>
> **Active tech debt**（`docs/tech-debt.md`）：
>
> - TD-008 — acceptance-tc-0x MCP 整合測試在 TD-001 修後破損（pre-existing，mid priority，與 add-ai-gateway 無關但跑 integration test 時發現）
>
> **Recently resolved**（2026-04-20）：
>
> - TD-001 — mcp-token-store Drizzle 遷移
> - TD-002 — guest_policy runbook + JSDoc 反向說明
> - TD-003 — text-dimmed → text-muted 批次
> - TD-004 — 首頁 button hit-target
> - TD-005 — admin 頁面 a11y violations 批次
> - TD-006 — Nuxt UI subtle/soft variant compoundVariants override
> - TD-007 — 裝飾 icon `aria-hidden` 批次（14 處 audit，全為 decorative）
>
> **不應該做的**：
>
> - 專題報告升版 — `main-v0.0.44.md` 是實作前骨架版，正確升版時機是實際驗收回填 TC-xx / EV-xx 階段

## Next Moves

### 本輪優先序

- [high] **add-ai-gateway-usage-tracking 收尾** — 外部前置 + Phase 5 Design Review + 人工檢查 H.1~H.9 + archive
- [mid] **TD-008 acceptance-tc-0x MCP mock fix** — 獨立於 add-ai-gateway，可平行

### 依賴 / 互斥

- `add-ai-gateway-usage-tracking` 收尾依賴**使用者手動**完成：
  1. Cloudflare Dashboard 建 AI Gateway instance `agentic-rag-production`
  2. 產 read-only Analytics API token（scope `Account → Analytics → Read`）
  3. `wrangler secret put CLOUDFLARE_ACCOUNT_ID` 與 `CLOUDFLARE_API_TOKEN_ANALYTICS`
  4. `wrangler.jsonc` 的 `NUXT_KNOWLEDGE_AI_GATEWAY_ID` 補值為 `agentic-rag-production` 後 redeploy

### 已識別的 follow-up（非 blocking，列此備忘）

- `server/utils/admin-session.ts` allowlist fallback：Phase 3 hook 穩定後可刪（code-review warning）。**時序條件**：需等 migration 0006 apply 到 prod + Phase 3 hook deploy 後活躍 session 都經過 `session.create.before` 重簽 + 觀察期內 fallback 分支零觸發（先加 `consola.warn` instrumentation 佐證）再動手。**處理時機**：v1.0.0 archive 之後當獨立 low-priority refactor。
- `mcp_tokens.created_by_user_id` 未來加 `NOT NULL`（backfill 完 legacy token 後）
- `chat.post.ts` 等的雙重 session 讀取已由 simplify 合併為 `fullSession`，其他 handler 仍有類似 pattern 可 follow-up

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-20T10:23:30.017Z_

1 active change (0 ready · 1 in progress · 0 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **add-ai-gateway-usage-tracking** — 21/48 tasks (44%)

### Draft

_(none)_

### Blocked

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/active -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->

## Parallel Tracks

> Which active changes can be worked on **simultaneously** without stepping on each other.

### Independent (can run in parallel)

- `add-ai-gateway-usage-tracking`

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
