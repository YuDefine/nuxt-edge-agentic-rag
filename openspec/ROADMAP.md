# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-19 晚，v0.17.0 已 tag）：四條 active change 平行推進一波。報告 `main-v0.0.44.md` 為當前版本（附錄 D 已併入）。本次 commit 9 段入庫（含 deploy）：B16 Phase 1-4 + governance 硬化 + responsive Phase A + deployment-manual + chore 收尾。

> **✅ 2026-04-20 晚 session lock 解除（HANDOFF.md 推進完成）**：
>
> 本次 session 工作已完成，HANDOFF.md 已刪除。剩下純人工驗證項目（非程式工作）。
>
> **本 session 已完成（commit + deploy 上 production）**：
>
> - `fix-better-auth-timestamp-affinity` Phase 2：migration 0007 Option V (8-table cascade rebuild) — commit `24da045`，production apply 成功（42 commands / 9.98ms），messages.query_log_id 70 → 70 preserved
> - `fix-better-auth-timestamp-affinity` Phase 3：endpoint cleanup（移 `sql<>` raw select、簡化 `toIsoOrNull`） — commit `4ab0ece`
> - design-review combo 善後（neutral 色 DRIFT 修 + a11y polish: motion-reduce / aria-label / type=button / 100dvh）— commit `e4e238e`
> - spectra docs / ROADMAP / findings 補錄 — commit `3631164`
> - deploy v0.18.4 + v0.18.5 上 production（agentic.yudefine.com.tw）
>
> **剩下純人工檢查（非程式工作，不擋其他 session）**：
>
> - `member-and-permission-management` §10 三斷點截圖 + §11 人工檢查（10 項：admin UI 操作 / guest policy 切換 / OAuth 降級 / MCP role gate）
> - `responsive-and-a11y-foundation` §10.4.1 三斷點截圖 (xs 360 / md 768 / xl 1280) + §11 人工檢查（10 項：iPhone SE / iPad Mini / 桌機實測 / 鍵盤 walkthrough / 色弱模擬）
> - `tc-acceptance-followups` / `deployment-manual` archive 時 deferred 的 staging 實測項目回填
>
> 這些都需 admin OAuth session 且需要使用者實際操作驗證，不適合 agent 自動跑。
>
> **本 session 觸動的 paths**（會持續寫入，平行 session 不要修改）：
>
> - `server/database/migrations/0007_better_auth_timestamp_affinity.sql`（Option V，~ 380 行）
> - `scripts/checks/verify-auth-storage-consistency.sh`（從 draft 移正、補 8-table FK 校驗）
> - `openspec/changes/fix-better-auth-timestamp-affinity/{tasks.md, design.md, drafts/}`
> - `openspec/changes/member-and-permission-management/tasks.md` §10 / §11
> - `openspec/changes/responsive-and-a11y-foundation/tasks.md` §10
> - `docs/design-review-findings.md`（補 member-perm + responsive 區塊）
> - `app/pages/admin/**` / `app/components/admin/**`（Design Review P1–P3 修 + Phase 3 endpoint cleanup）
> - `server/api/admin/members/index.get.ts`（Phase 3 移除 `toIsoOrNull` raw select）
> - `tmp/prod-backup-0420.sql`（已 export 作 dry-run 基線；gitignored）
> - `template/HANDOFF.md`（完成後刪除）
> - 部署：`pnpm build && pnpm exec wrangler deploy` + `wrangler d1 migrations apply --remote`
>
> **可平行進行**：純文件編修、`add-ai-gateway-usage-tracking` draft，與上述路徑無交集的小工作。
>
> **Previous lock 解除**：`design-review-combo` subagent 善後納入本次推進。

### Active Changes 實況（v0.17.0 之後）

| Change                             | Tasks        | 實況                                                                                                                                                    |
| ---------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tc-acceptance-followups`          | 27/33 (82%)  | code/docs 100% 完成（§1-§7.2）；剩 §7.3-§7.5 staging 實測 + §8.1-§8.3 人工檢查，**ready to archive**（staging 項目延後回填）                            |
| `deployment-manual`                | 11/19 (58%)  | runbook + 附錄 D + CI workflow 已落地；剩 §4 acceptance 回填（實際部署後做）+ §人工檢查 #1-#5（純文件閱讀確認），**ready to archive**（回填延後）       |
| `member-and-permission-management` | 19/49 (39%)  | Phase 1-4 完成（types / migration 0006 / helpers / auth hook / Admin API / chat+MCP requireRole / role-gate / sync-admin-roles 刪除）；剩 Phase 5 UI 層 |
| `responsive-and-a11y-foundation`   | 22/63 (35%)  | Phase A 完成（Tailwind xs / nuxt-a11y / hybrid table / 4 元件響應式 / contrast audit / Design Review 流程）；Phase B 待 member-perm Phase 5 完成        |
| `add-ai-gateway-usage-tracking`    | 0/48 (draft) | 未啟動（post-v1 low priority）                                                                                                                          |

## Next Moves

### 本輪優先序（2026-04-20 主線更新）

- [✅ DONE] **migration 0007（`fix-better-auth-timestamp-affinity` Phase 2 + 3）** — 2026-04-20 晚完成 production apply。Option V 8-table cascade rebuild 治本，`messages` 納入是為了避免 `ON DELETE SET NULL` 清掉 70 筆 message → query_log 連結（C1 fix from code-review）。Phase 3 endpoint cleanup 也已 deploy（v0.18.5）。剩 §4 staging 人工檢查留 manual。
- [high] **Archive 兩條完成的 change**：`tc-acceptance-followups` + `deployment-manual`（code/docs 100%，只剩 staging 實測與人工檢查；用 `/spectra-archive` 把剩餘項目標 deferred）
- [high] **member-and-permission-management Phase 5** — code 100% 落地（含 design-review-combo subagent 4 個 .vue neutral 色 DRIFT 修 + a11y polish）；剩 §10 三斷點截圖 + 人工檢查 (§11)
- [mid] **responsive-and-a11y-foundation Phase B** — code 100% 落地（Phase B-2 合併完成 + a11y polish）；剩 §10.4.1 三斷點截圖 + 人工檢查 (§11)
- [mid] **Apply migration 0006** — 仍待 schedule（與 0007 同 deploy 窗口可一起或分開）
- [low] **add-ai-gateway-usage-tracking** — v1 收尾後評估

### 依賴 / 互斥

- `member-perm Phase 5` ↔ `responsive Phase B`：共用 `app/layouts/default.vue` + `app/components/chat/GuestAccessGate.vue`，Phase B-2 合併已完成
- `tc-followup` / `deployment-manual`：archive 後互不相干；staging 實測可與 Phase 5 並行
- `add-ai-gateway-usage-tracking`：獨立，待 Phase 5 完成後再評估優先序
- **migration 0007 ↔ 其他工作**：✅ DONE — Phase 3 endpoint cleanup 已完成並 deploy v0.18.5
- **Design Review 善後 ↔ archive**：Design Gate (`pre-archive-design-gate.sh`) 仍要求 `design-review.md` Fidelity evidence + tasks §10 全勾，最後一步「三斷點截圖」需 admin OAuth session 由使用者完成 → member-perm + responsive 待人工檢查補完後才可 archive

### 已識別的 follow-up（非 blocking，列此備忘）

- `server/utils/admin-session.ts` allowlist fallback：Phase 3 hook 穩定後可刪（code-review warning）。**時序條件**：需等 migration 0006 apply 到 prod + Phase 3 hook deploy 後活躍 session 都經過 `session.create.before` 重簽 + 觀察期內 fallback 分支零觸發（先加 `consola.warn` instrumentation 佐證）再動手。**處理時機**：v1.0.0 archive 之後當獨立 low-priority refactor，**不併入 B16 的 archive gate**（避免觀察期擋 archive）。
- `mcp_tokens.created_by_user_id` 未來加 `NOT NULL`（backfill 完 legacy token 後）
- `chat.post.ts` 等的雙重 session 讀取已由 simplify 合併為 `fullSession`，其他 handler 仍有類似 pattern 可 follow-up

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-19T17:42:12.578Z_

4 active changes (0 ready · 3 in progress · 1 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **fix-better-auth-timestamp-affinity** — 23/26 tasks (88%)
- **member-and-permission-management** — 37/49 tasks (76%)
  - Specs: `admin-document-management-ui`, `web-chat-ui`
- **responsive-and-a11y-foundation** — 44/63 tasks (70%)

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
- `fix-better-auth-timestamp-affinity`
- `member-and-permission-management`
- `responsive-and-a11y-foundation`

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
