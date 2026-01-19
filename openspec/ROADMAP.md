# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Parallel Execution Strategy

> 時程壓力：7 天內完成 v1.0.0 核心閉環（截止 2026-04-22）

> 目前狀態：已建立 6 個 Spectra changes 覆蓋報告 v0.0.36 的完整程式碼面向。`bootstrap-v1-core-from-report` 與 `add-v1-core-ui` 共同構成核心閉環的 backend / UI 主線；其餘 4 個為同版後置或驗證/治理補完，等待核心驗收完成後推進。

### 變更總覽（6 Changes）

| Change                          | Status      | Tasks | 說明                                                   |
| ------------------------------- | ----------- | ----- | ------------------------------------------------------ |
| `bootstrap-v1-core-from-report` | in-progress | 27/33 | 核心閉環後端/治理：Auth, Upload, Publish, Chat, MCP    |
| `add-v1-core-ui`                | draft       | 0/34  | 核心閉環 UI：Chat、對話歷史、Citation Replay、文件管理 |
| `test-coverage-and-automation`  | parked      | 0/43  | TC-01~TC-20, A01~A13 驗收測試框架                      |
| `governance-refinements`        | parked      | 0/17  | 對話生命週期、retention cleanup、config 版本           |
| `admin-ui-post-core`            | parked      | 0/33  | Token 管理 UI、Query Logs UI、Dashboard                |
| `observability-and-debug`       | parked      | 0/21  | Debug 面板、延遲追蹤、決策路徑顯示                     |

### 依賴關係圖（2026-04-16 分析）

```
                    ┌─────────────────────────────────────────────────┐
                    │  bootstrap-v1-core-from-report (82%)            │
                    │  輸出: Auth/Session API, Document API,          │
                    │        Chat/Streaming API, MCP tools,           │
                    │        DB schema (8 tables), Governance rules   │
                    └──────────────────────┬──────────────────────────┘
                                           │
           ┌───────────────┬───────────────┼───────────────┬───────────────┐
           │               │               │               │               │
           ▼               ▼               ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │ add-v1-     │ │ test-       │ │ governance- │ │ admin-ui-   │ │ observ-     │
    │ core-ui     │ │ coverage    │ │ refinements │ │ post-core   │ │ ability     │
    │ (34 tasks)  │ │ (43 tasks)  │ │ (17 tasks)  │ │ (33 tasks)  │ │ (21 tasks)  │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │               │               │
           │               │               │               │               │
    強依賴 API      強依賴功能存在   部分依賴 schema   強依賴 API     依賴 governance
    整合部分        才能寫 TC-*     (1.x/2.x)       + core UI      latency 欄位
                                                     patterns
```

### 平行化可行性矩陣

| Change               | 硬依賴              | 🟢 可先做（無阻塞）                                                                            | 🟡 需等待 bootstrap                                                             | 備註                    |
| -------------------- | ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------- |
| `bootstrap`          | 無                  | 6.2 人工驗收                                                                                   | —                                                                               | 主線，優先完成          |
| `add-v1-core-ui`     | bootstrap API       | 2.1 badge/label 元件<br>2.2 list table 元件<br>3.1-3.5 chat components<br>4.x navigation shell | 1.x data loaders<br>2.3-2.8 wizard 整合<br>3.6-3.9 API 整合<br>5.x verification | **可先做 skeleton**     |
| `test-coverage`      | bootstrap 功能      | 1.1 registry manifest<br>1.2-1.4 mocks/helpers<br>1.5 CLI 入口                                 | 2.x-4.x TC-\* 案例                                                              | **可先做基礎設施**      |
| `governance`         | bootstrap schema    | 3.1-3.4 Config Snapshot                                                                        | 1.x conversation lifecycle<br>2.x retention cleanup                             | **可先做 3.x**          |
| `admin-ui-post-core` | bootstrap + core UI | 無                                                                                             | 全部                                                                            | 等核心 UI 確立 patterns |
| `observability`      | governance latency  | 無                                                                                             | 全部                                                                            | 最後階段                |

### 建議執行順序（時間軸）

```
Week 1 (現在 → 04-22)
├─ [主線] bootstrap 6.2 人工驗收 ←──────────────────────────────────┐
│                                                                    │
├─ [平行 A] add-v1-core-ui skeleton (無 API 依賴的 components)       │
│   └─ 2.1 badge/label, 2.2 list table, 3.1-3.5 chat components     │
│                                                                    │
├─ [平行 B] test-coverage 基礎設施                                   │
│   └─ 1.1 registry, 1.2-1.4 mocks/helpers, 1.5 CLI                 │
│                                                                    │
└─ [平行 C] governance Config Snapshot                               │
    └─ 3.1-3.4 shared constants, drift guard                         │
                                                                     │
                          ▼ bootstrap 驗收通過後 ◄───────────────────┘

Week 2 (04-22 →)
├─ [接續] add-v1-core-ui API 整合 (1.x, 2.3-2.8, 3.6-3.9, 5.x)
│
├─ [接續] test-coverage TC-01~TC-20, A01~A13 案例
│
├─ [接續] governance 1.x conversation, 2.x retention
│
├─ [新開] admin-ui-post-core 全部
│
└─ [最後] observability-and-debug（等 governance latency 欄位）
```

### 並行分派建議（更新版）

| Track | Change               | 可 `/assign`？ | 現在可開始的 tasks     | 備註                                |
| ----- | -------------------- | -------------- | ---------------------- | ----------------------------------- |
| Core  | `bootstrap`          | ❌             | 6.2 人工驗收           | 需人工操作 staging                  |
| A     | `add-v1-core-ui`     | ⚠️ 部分        | 2.1, 2.2, 3.1-3.5, 4.x | skeleton only，API 整合等 bootstrap |
| B     | `test-coverage`      | ⚠️ 部分        | 1.1-1.5                | 基礎設施 only，TC-\* 等功能存在     |
| C     | `governance`         | ⚠️ 部分        | 3.1-3.4                | Config Snapshot only                |
| D     | `admin-ui-post-core` | ❌             | 無                     | 等 core UI patterns 確立            |
| E     | `observability`      | ❌             | 無                     | 依賴 governance latency 欄位        |

### 依賴鏈（阻塞關係）

```
observability-and-debug
    ↑ 依賴 1.x debug data (latency 欄位)
governance-refinements
    ↑ 依賴 conversations/messages/query_logs schema
bootstrap-v1-core-from-report
```

```
admin-ui-post-core
    ↑ 依賴 mcp_tokens/query_logs API + core UI patterns
bootstrap-v1-core-from-report + add-v1-core-ui
```

## Current Phase Gates

### Phase A: 核心閉環收尾（目前階段）

- [x] 6.1 Test Coverage & Smoke — 已完成單元/整合/e2e 骨架
- [x] 6.1b Deploy to Staging — staging / production bindings 與 deploy URL 已建立
- [ ] add-v1-core-ui — 補齊核心 Web/Admin UI，讓人工驗收可透過頁面實際操作
- [ ] 6.2 Manual Acceptance — #1-#5 人工檢查，依賴 staging 環境

### Phase B: 同版後置 Unpark

驗收 #1-#5 全數通過後：

```bash
spectra unpark test-coverage-and-automation
spectra unpark governance-refinements
spectra unpark admin-ui-post-core
spectra unpark observability-and-debug
```

### Phase C: 最終歸檔

- 所有 6 個 changes 完成後，依序 `spectra archive <change-name>`
- 更新報告 main-v0.0.37.md 記錄實作成果

## Next Moves

### 立即可平行（無阻塞）

- [high] **bootstrap 6.2**：人工驗收 #1-#5（需 staging 環境）
- [high] **add-v1-core-ui skeleton**：2.1 badge/label、2.2 list table、3.1-3.5 chat components、4.x navigation
- [mid] **test-coverage 基礎設施**：1.1-1.5 registry/mocks/helpers/CLI
- [mid] **governance Config Snapshot**：3.1-3.4 shared constants/drift guard

### 等 bootstrap 驗收後

- [high] add-v1-core-ui API 整合（1.x, 2.3-2.8, 3.6-3.9, 5.x）
- [high] test-coverage TC-01~TC-20、A01~A13 案例
- [mid] governance 1.x conversation lifecycle、2.x retention cleanup
- [mid] admin-ui-post-core 全部（依賴 core UI patterns）

### 最後階段

- [low] observability-and-debug：依賴 governance latency 欄位
- [low] 報告更新至 main-v0.0.37.md，記錄完整實作成果

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-16T12:49:33.135Z_

6 active changes (0 ready · 4 in progress · 2 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **add-v1-core-ui** — 31/34 tasks (91%)
- **bootstrap-v1-core-from-report** — 28/34 tasks (82%)
- **governance-refinements** — 4/17 tasks (24%)
- **test-coverage-and-automation** — 5/43 tasks (12%)

### Draft

- **admin-ui-post-core** — 0/33 tasks (0%)
- **observability-and-debug** — 0/21 tasks (0%)

### Blocked

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/active -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->

## Parallel Tracks

> Which active changes can be worked on **simultaneously** without stepping on each other.

### Independent (can run in parallel)

- `add-v1-core-ui`
- `admin-ui-post-core`
- `bootstrap-v1-core-from-report`
- `governance-refinements`
- `observability-and-debug`
- `test-coverage-and-automation`

### Mutex (same spec touched)

_(none)_

### Blocked by dependency

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/parallelism -->

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Parked Changes Backlog

> 以下 4 個 changes 已建立完整 artifacts，等待 bootstrap 核心驗收完成後 unpark

### test-coverage-and-automation（43 tasks）

- TC-01~TC-20 驗收測試案例自動化
- A01~A13 驗收對照項目自動化
- Vitest + Playwright 測試框架整合
- Mock utilities（Cloudflare bindings、Auth session）

### governance-refinements（17 tasks）

- 對話生命週期（stale 偵測、刪除流程）
- Retention cleanup（180 天自動清理、NuxtHub scheduled task）
- Config 版本控制（ConfigSnapshot 結構、版本遞增協議）

### admin-ui-post-core（33 tasks）

- MCP Token 管理 UI（列表、建立、撤銷）
- Query Logs 檢視 UI（列表、篩選、詳情）
- Dashboard 統計卡片（問答數、文件數、Token 數）

### observability-and-debug（21 tasks）

- Debug 分數面板（confidence、retrieval、answer 分數視覺化）
- 延遲追蹤（first_token_latency_ms、completion_latency_ms）
- 決策路徑顯示（badge、流程視覺化）

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
