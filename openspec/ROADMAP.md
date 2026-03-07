# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Parallel Execution Strategy

> 目前狀態（2026-04-19 重測）：v1.0.0 核心閉環已全部 archive（bootstrap-v1-core-from-report / add-v1-core-ui / governance-refinements / test-coverage-and-automation / migrate-mcp-to-toolkit）。剩 2 個 post-core changes 實作 100% 完成，等 `/review-screenshot` + 使用者人工驗收即可 archive。

### 變更總覽（2 Active Changes）

| Change                    | Status      | Tasks | 實況                                                  |
| ------------------------- | ----------- | ----- | ----------------------------------------------------- |
| `admin-ui-post-core`      | in-progress | 33/39 | 實作 100%。剩 5.4 `/review-screenshot` + 5 項人工檢查 |
| `observability-and-debug` | in-progress | 21/25 | 實作 100%。剩 5.3 `/review-screenshot` + 3 項人工檢查 |

### 依賴關係圖（2026-04-19 重算）

```
  admin-ui-post-core           observability-and-debug
  (33/39, 85%)                 (21/25, 84%)
        │                              │
        └──────────────┬───────────────┘
                       ▼
         兩者獨立，無 mutex（spec 無重疊）
                       │
                       ▼
         剩 /review-screenshot + 人工檢查 → archive
```

### 平行化可行性矩陣（2026-04-19 更新）

| Change                    | 🟢 現在可做                            | 🟡 需使用者 / staging        | 備註                               |
| ------------------------- | -------------------------------------- | ---------------------------- | ---------------------------------- |
| `admin-ui-post-core`      | 5.4 `/review-screenshot`（dev server） | 人工檢查 #1–#5（需 staging） | 不動核心 spec，純新增 admin 功能   |
| `observability-and-debug` | 5.3 `/review-screenshot`（dev server） | 人工檢查 #1–#3（需 staging） | 新增 query_logs debug 欄位（0005） |

### 並行分派建議（2026-04-19 更新）

| Track | Change                    | 可 `/assign`？ | 現在可做 tasks             | 備註                          |
| ----- | ------------------------- | -------------- | -------------------------- | ----------------------------- |
| A     | `admin-ui-post-core`      | ✅             | 5.4 `/review-screenshot`   | 啟 dev server 後派 agent 截圖 |
| B     | `observability-and-debug` | ✅             | 5.3 `/review-screenshot`   | 啟 dev server 後派 agent 截圖 |
| A + B | 人工檢查                  | ❌             | 共 8 項（admin 5 + obs 3） | 需使用者在 staging 親跑       |

## Current Phase Gates

### Phase A: Post-Core 收尾（目前階段）

- [ ] `admin-ui-post-core` 5.4 `/review-screenshot`
- [ ] `admin-ui-post-core` 人工檢查 #1–#5（需 staging）
- [ ] `observability-and-debug` 5.3 `/review-screenshot`
- [ ] `observability-and-debug` 人工檢查 #1–#3（需 staging）

### Phase B: 最終歸檔

- [ ] `spectra archive admin-ui-post-core`
- [ ] `spectra archive observability-and-debug`
- [ ] 更新報告 main-v0.0.42.md 記錄 post-core 實作成果

## Next Moves

### 立即可做（無阻塞，今天開工）

- [high] **啟 dev server → `/review-screenshot` 驗證 admin 後置頁面**：cover `app/pages/admin/tokens/**`、`/admin/query-logs/**`、`/admin/dashboard`
- [high] **啟 dev server → `/review-screenshot` 驗證 internal debug pages**：cover `app/pages/admin/debug/query-logs/[id].vue` + latency summary surface
- [high] **使用者親跑 staging 驗收**：admin-ui-post-core 人工檢查 #1–#5 + observability-and-debug 人工檢查 #1–#3（共 8 項）

### 驗收通過後

- [high] `spectra archive admin-ui-post-core`
- [high] `spectra archive observability-and-debug`
- [mid] 更新 main-v0.0.42.md 記錄 admin 後置 UI + observability debug surface 實作
- [mid] 建立下一個 change proposal（依使用者意圖決定，尚未定案）

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-19T08:58:02.527Z_

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

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Parked Changes Backlog

_(none — 原列 4 個 parked changes 已全部 unpark，其中 `test-coverage-and-automation` / `governance-refinements` 已 archive；`admin-ui-post-core` / `observability-and-debug` 目前為 in-progress，見上方 Active Changes。)_

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
