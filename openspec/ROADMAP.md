# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-20 更新）：Production 跑 v0.18.5。v1 三條 wip 全部 archive：
>
> - `fix-better-auth-timestamp-affinity`（2026-04-20 archive）
> - `member-and-permission-management`（2026-04-20 archive）
> - `responsive-and-a11y-foundation`（2026-04-20 archive）
>
> **目前 0 wip，只有 1 draft**（`add-ai-gateway-usage-tracking`，post-v1 low priority）。v1 收尾完成，進入 tech debt 清理階段。
>
> **Active tech debt**（`docs/tech-debt.md`）：
>
> - TD-006（mid）— Nuxt UI subtle variant tonal badge 對比度不足（新登，需 design 決策方向）
> - TD-001（low）— mcp-token-store libsql 不相容（local dev 體驗）
>
> **Recently resolved**（2026-04-20）：
>
> - TD-002 — guest_policy runbook + JSDoc 反向說明
> - TD-003 — text-dimmed → text-muted 批次
> - TD-004 — 首頁 button hit-target
> - TD-005 — admin 頁面 a11y violations 批次
>
> **不應該做的**：
>
> - 專題報告升版 — `main-v0.0.44.md` 是實作前骨架版，正確升版時機是實際驗收回填 TC-xx / EV-xx 階段
> - `add-ai-gateway-usage-tracking` 推進 — 使用者明標 post-v1 low priority

## Next Moves

### 本輪優先序

- [mid, 需 design 討論] **TD-006 tonal badge 對比度** — 需決策方向（調 theme token / 換 variant / 接受 exception）
- [mid] **Apply migration 0006** — 仍待 schedule
- [low] **TD-001 mcp-token-store 遷移 Drizzle** — local dev 體驗修復
- [low] **add-ai-gateway-usage-tracking** — post-v1 評估

### 依賴 / 互斥

- TD-006 需要 design 先決策（影響範圍：所有 tonal badge pattern 消費點）；決策後可 agent 獨立落地
- `add-ai-gateway-usage-tracking`：獨立 draft，無依賴

### 已識別的 follow-up（非 blocking，列此備忘）

- `server/utils/admin-session.ts` allowlist fallback：Phase 3 hook 穩定後可刪（code-review warning）。**時序條件**：需等 migration 0006 apply 到 prod + Phase 3 hook deploy 後活躍 session 都經過 `session.create.before` 重簽 + 觀察期內 fallback 分支零觸發（先加 `consola.warn` instrumentation 佐證）再動手。**處理時機**：v1.0.0 archive 之後當獨立 low-priority refactor。
- `mcp_tokens.created_by_user_id` 未來加 `NOT NULL`（backfill 完 legacy token 後）
- `chat.post.ts` 等的雙重 session 讀取已由 simplify 合併為 `fullSession`，其他 handler 仍有類似 pattern 可 follow-up

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-20T07:52:18.732Z_

1 active change (0 ready · 0 in progress · 1 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

_(none)_

### Draft

- **add-ai-gateway-usage-tracking** — 0/48 tasks (0%)

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
