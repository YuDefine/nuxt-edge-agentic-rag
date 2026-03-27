# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-20 晚 → 2026-04-21 更新）：Production 跑 v0.18.5。`tc-acceptance-followups` + `deployment-manual` 已 archive（2026-04-20）。剩 4 條 active：3 條 code 完成等人工驗證、1 條 draft（post-v1 low priority）。
>
> **三條 wip 都卡在需使用者親自操作的驗證步驟**（admin OAuth + 三斷點截圖 + 人工 §11 checklist），agent 無法代勞。
>
> **可做的 hygiene 工作**（不需 admin session）：
>
> - 本輪主線已處理：ROADMAP MANUAL 修正、repo-wide `motion-reduce:animate-none` 補全（findings 標的 Cross-Change DRIFT）
>
> **不應該做的**：
>
> - 專題報告升版 — `main-v0.0.44.md` 是實作前骨架版（多處「待驗證」「待於建置時鎖定」標記），B16 屬內部技術債修復，不觸動功能規格 / 介面 / 資料表概念層；正確升版時機是實際驗收回填 TC-xx / EV-xx 階段
> - `add-ai-gateway-usage-tracking` 推進 — 使用者明標 post-v1 low priority，硬推違反優先序

### Active Changes 實況

| Change                               | Tasks        | 實況                                                                                                                           |
| ------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `fix-better-auth-timestamp-affinity` | 23/26 (88%)  | Phase 2（migration 0007）+ Phase 3（endpoint cleanup）已 deploy v0.18.5；剩 §4 staging 人工檢查                                |
| `member-and-permission-management`   | 37/49 (76%)  | code 100%（Phase 1-5 含 design-review-combo 善後：neutral 色 DRIFT + a11y polish）；剩 §10 三斷點截圖 + §11 人工檢查（10 項）  |
| `responsive-and-a11y-foundation`     | 44/63 (70%)  | code 100%（Phase A + Phase B-2 合併 + a11y polish）；剩 §10.4.1 三斷點截圖（xs 360 / md 768 / xl 1280）+ §11 人工檢查（10 項） |
| `add-ai-gateway-usage-tracking`      | 0/48 (draft) | 未啟動（post-v1 low priority）                                                                                                 |

## Next Moves

### 本輪優先序

- [critical path, 需使用者] **三條 wip 的人工檢查**（三條平行，共用 admin OAuth session 可一次做完）：
  - `fix-better-auth-timestamp-affinity` §4 staging 人工檢查
  - `member-and-permission-management` §10 三斷點截圖 + §11（10 項：admin UI / guest dial / OAuth 降級 / MCP role gate）
  - `responsive-and-a11y-foundation` §10.4.1 三斷點截圖（xs 360 / md 768 / xl 1280）+ §11（10 項：iPhone SE / iPad Mini / 鍵盤 walkthrough / 色弱模擬）
- [mid] **Apply migration 0006** — 仍待 schedule
- [low] **add-ai-gateway-usage-tracking** — post-v1，v1 收尾後評估

### 依賴 / 互斥

- 三條 wip 彼此 **independent**（無 spec collision），人工檢查可一次 session 連跑
- **Design Gate 擋 archive**：`pre-archive-design-gate.sh` 要求 `design-review.md` Fidelity evidence + tasks §10 全勾；三斷點截圖需 admin OAuth session 由使用者完成
- `add-ai-gateway-usage-tracking`：獨立 draft，無依賴

### 已識別的 follow-up（非 blocking，列此備忘）

- `server/utils/admin-session.ts` allowlist fallback：Phase 3 hook 穩定後可刪（code-review warning）。**時序條件**：需等 migration 0006 apply 到 prod + Phase 3 hook deploy 後活躍 session 都經過 `session.create.before` 重簽 + 觀察期內 fallback 分支零觸發（先加 `consola.warn` instrumentation 佐證）再動手。**處理時機**：v1.0.0 archive 之後當獨立 low-priority refactor，**不併入 B16 的 archive gate**（避免觀察期擋 archive）。
- `mcp_tokens.created_by_user_id` 未來加 `NOT NULL`（backfill 完 legacy token 後）
- `chat.post.ts` 等的雙重 session 讀取已由 simplify 合併為 `fullSession`，其他 handler 仍有類似 pattern 可 follow-up

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-19T17:50:54.535Z_

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
