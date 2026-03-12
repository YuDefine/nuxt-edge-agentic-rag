# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-19 下午）：v1.0.0 核心閉環與 post-core（admin-ui-post-core / observability-and-debug）皆已 archive、人工檢查全數 PASS。報告 `main-v0.0.43.md` 為當前版本。下午做 parked backlog 整理：unpark 8 個 → 刪除 2 個重複（archive 已涵蓋）、合併 1 對 responsive 雙胞胎（保留 mobile-first 的 `responsive-and-a11y-foundation`）、逐一核對實作進度，留下 **5 個 active change**。

### Active Changes 實況（核對 codebase 後的真實進度）

| Change                             | Tasks | 實況                                                                                   |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------------- |
| `member-and-permission-management` | 0/48  | 尚未實作：無 `guest_policy` / `system_settings` / `/admin/members` / role enum 三級化  |
| `responsive-and-a11y-foundation`   | 0/63  | 尚未實作；proposal + Entity Matrix + Journeys 已齊備（mobile-first + hybrid table）    |
| `tc-acceptance-followups`          | 5/33  | §1 hub:db mock helper 完成；§2-§6 未做（MCP audit flag、credit card flag、seed、docs） |
| `deployment-manual`                | 0/19  | 尚未實作：`main-v0.0.43.md` 仍只有附錄 A/B/C，缺附錄 D                                 |
| `add-ai-gateway-usage-tracking`    | 0/48  | 完全未實作：無 `ai_gateway` binding、無 `/admin/usage`、無 Analytics API 接線          |

## Next Moves

### 本輪優先序（依 memory B11/B16 決策）

- [high] **member-and-permission-management** — B16 v1.0.0 範圍：三級 Admin/Member/Guest + `guest_policy` dial；blocks `responsive-and-a11y-foundation` 的 layout 改造
- [mid] **responsive-and-a11y-foundation** — B11 v1.0.0 全裝置適配 + WCAG AA baseline；建議於 B16 的 Guest/Member UI 落地後再起，避免二次改 layout
- [mid] **tc-acceptance-followups** — staging 硬化：補 `restricted_scope_violation` 與 `pii_credit_card` flag、seed case、tc-15 信用卡測試、acceptance-tc 共用 helper 重構、docs；獨立於前二者可並行
- [mid] **deployment-manual** — 附錄 D 部署手冊（報告文字層，v0.0.44+）；純文件工作可與 code change 並行
- [low] **add-ai-gateway-usage-tracking** — post-v1 observability；等前述收尾再評估

### 依賴 / 互斥

- `responsive-and-a11y-foundation` ↔ `member-and-permission-management`：共用 `app/layouts/default.vue`、chat 入口與 admin 表格；建議**串行**（B16 先）
- `tc-acceptance-followups` / `deployment-manual` / `add-ai-gateway-usage-tracking`：彼此獨立、與上述兩者亦獨立，可並行

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-19T13:58:59.718Z_

5 active changes (0 ready · 4 in progress · 1 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **deployment-manual** — 11/19 tasks (58%)
- **member-and-permission-management** — 19/49 tasks (39%)
  - Specs: `admin-document-management-ui`, `web-chat-ui`
- **responsive-and-a11y-foundation** — 22/63 tasks (35%)
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
