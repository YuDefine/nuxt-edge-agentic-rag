# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-19 晚，v0.17.0 已 tag）：四條 active change 平行推進一波。報告 `main-v0.0.44.md` 為當前版本（附錄 D 已併入）。本次 commit 9 段入庫（含 deploy）：B16 Phase 1-4 + governance 硬化 + responsive Phase A + deployment-manual + chore 收尾。

### Active Changes 實況（v0.17.0 之後）

| Change                             | Tasks        | 實況                                                                                                                                                    |
| ---------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tc-acceptance-followups`          | 27/33 (82%)  | code/docs 100% 完成（§1-§7.2）；剩 §7.3-§7.5 staging 實測 + §8.1-§8.3 人工檢查，**ready to archive**（staging 項目延後回填）                            |
| `deployment-manual`                | 11/19 (58%)  | runbook + 附錄 D + CI workflow 已落地；剩 §4 acceptance 回填（實際部署後做）+ §人工檢查 #1-#5（純文件閱讀確認），**ready to archive**（回填延後）       |
| `member-and-permission-management` | 19/49 (39%)  | Phase 1-4 完成（types / migration 0006 / helpers / auth hook / Admin API / chat+MCP requireRole / role-gate / sync-admin-roles 刪除）；剩 Phase 5 UI 層 |
| `responsive-and-a11y-foundation`   | 22/63 (35%)  | Phase A 完成（Tailwind xs / nuxt-a11y / hybrid table / 4 元件響應式 / contrast audit / Design Review 流程）；Phase B 待 member-perm Phase 5 完成        |
| `add-ai-gateway-usage-tracking`    | 0/48 (draft) | 未啟動（post-v1 low priority）                                                                                                                          |

## Next Moves

### 本輪優先序

- [high] **Archive 兩條完成的 change**：`tc-acceptance-followups` + `deployment-manual`（code/docs 100%，只剩 staging 實測與人工檢查；用 `/spectra-archive` 把剩餘項目標 deferred）
- [high] **member-and-permission-management Phase 5** — UI 層：`/admin/members/`、`/admin/settings/guest-policy.vue`、`GuestAccessGate.vue`、`/account-pending.vue`、`app/layouts/default.vue` 加 admin 導覽；剩餘 tests (§9.2 oauth-callback / §9.5 e2e chat-guest-states) + Design Review (§10) + 人工檢查 (§11)
- [mid] **responsive-and-a11y-foundation Phase B** — layout drawer (§3)、skip-to-main link (§6.3)、三斷點截圖 (§5.6/§9.4)、Design Review (§10)、人工檢查 (§11)；**建議與 member-perm Phase 5 的 `app/layouts/default.vue` 合併規劃**避免二次改
- [mid] **Apply migration 0006** — `wrangler d1 migrations apply agentic-rag-db --local` 然後 staging（主線決定時機）
- [low] **add-ai-gateway-usage-tracking** — v1 收尾後評估

### 依賴 / 互斥

- `member-perm Phase 5` ↔ `responsive Phase B`：共用 `app/layouts/default.vue`（B16 加 admin nav、B11 加 drawer/skip-link）+ `app/components/chat/GuestAccessGate.vue`（B16 新建、B11 套響應式）→ **強烈建議合併一個 subagent 一次做完**，避免 layout 被改兩次
- `tc-followup` / `deployment-manual`：archive 後互不相干；staging 實測可與 Phase 5 並行
- `add-ai-gateway-usage-tracking`：獨立，待 Phase 5 完成後再評估優先序

### 已識別的 follow-up（非 blocking，列此備忘）

- `server/utils/admin-session.ts` allowlist fallback：Phase 3 hook 穩定後可刪（code-review warning）
- `mcp_tokens.created_by_user_id` 未來加 `NOT NULL`（backfill 完 legacy token 後）
- `chat.post.ts` 等的雙重 session 讀取已由 simplify 合併為 `fullSession`，其他 handler 仍有類似 pattern 可 follow-up

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-19T15:26:08.904Z_

5 active changes (0 ready · 4 in progress · 1 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **deployment-manual** — 16/19 tasks (84%)
- **member-and-permission-management** — 31/49 tasks (63%)
  - Specs: `admin-document-management-ui`, `web-chat-ui`
- **responsive-and-a11y-foundation** — 39/63 tasks (62%)
- **tc-acceptance-followups** — 27/33 tasks (82%)
  - Specs: `web-chat-ui`

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
- `deployment-manual`
- `responsive-and-a11y-foundation`

### Mutex (same spec touched)

- **web-chat-ui** — conflict between: `member-and-permission-management`, `tc-acceptance-followups`

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
