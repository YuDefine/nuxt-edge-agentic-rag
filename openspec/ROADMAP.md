# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Parallel Execution Strategy

> 時程壓力：5 天內完成 v1.0.0 核心閉環（截止 2026-04-22）

> 目前狀態（2026-04-17 重測）：bootstrap 與 add-v1-core-ui **實作全部完成**，僅剩 13 項人工驗收（bootstrap 5 項 + add-v1-core-ui 7 項 + add-v1-core-ui 主 task `6.2`）。原先標記為 parked 的 3 個 change 其「無阻塞」子項也已完成：test-coverage 1.x（foundations）、governance 3.x（config snapshot）全綠。Phase A 剩下的是**人工驗收 + 文件補完 + 測試案例擴充**。

### 變更總覽（6 Changes）

| Change                          | Status      | Tasks | 實況                                                                             |
| ------------------------------- | ----------- | ----- | -------------------------------------------------------------------------------- |
| `bootstrap-v1-core-from-report` | in-progress | 28/34 | 實作 100%。剩 6.2 人工驗收 #1–#5（需 staging）                                   |
| `add-v1-core-ui`                | in-progress | 41/49 | 實作 100%。剩 7 項人工檢查 #1/#3–#8（需 staging）                                |
| `governance-refinements`        | in-progress | 4/17  | 3.x config snapshot 全完。剩 1.x conversation、2.x retention、4.x docs/checklist |
| `test-coverage-and-automation`  | in-progress | 8/43  | 1.x foundations 全完 + TC-01~03 + A01~02。剩 TC-04~20、A03~13、EV-01~04          |
| `admin-ui-post-core`            | draft       | 0/33  | 未啟動。等 core UI patterns 確立                                                 |
| `observability-and-debug`       | draft       | 0/21  | 未啟動。依賴 governance latency 欄位                                             |

### 依賴關係圖（2026-04-17 重算）

```
     bootstrap + add-v1-core-ui (實作 100%, 剩 13 項人工驗收)
           │
           ▼
     ┌─────────────────────────────────────────────┐
     │  Phase A 收尾 = 人工驗收 + 文件 + 測試擴充  │
     └──────────────────────┬──────────────────────┘
                            │
     ┌──────────────────────┼──────────────────────┐
     ▼                      ▼                      ▼
  已可做                已可做               已可做但量大
  gov 4.1-4.2         tc 2.4-20 / 3.x       (挑重點先做)
  (docs + checklist)   (TC-* 自動化)         A03-13, EV-01-04
```

### 平行化可行性矩陣（2026-04-17 更新）

| Change               | 🟢 現在可做（人工驗收不阻塞）                 | 🟡 等驗收通過再做                         | 備註                                                 |
| -------------------- | --------------------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| `bootstrap`          | **6.2 人工驗收** #1–#5（需 staging）          | —                                         | 主線                                                 |
| `add-v1-core-ui`     | **人工檢查** #1/#3–#8（需 staging）           | —                                         | 實作已完                                             |
| `governance`         | 4.1 docs/verify 更新、4.2 rollout checklist   | 1.x conversation lifecycle、2.x retention | 4.x 純文件/checklist，直接支援 bootstrap 驗收        |
| `test-coverage`      | 2.4–3.10（TC-04~20 自動化）、4.1–4.18（A/EV） | —                                         | 35 tasks 量大，建議挑 TC-12/18、A03/A04 等高價值案例 |
| `admin-ui-post-core` | 無                                            | 全部                                      | 等 core UI patterns                                  |
| `observability`      | 無                                            | 全部                                      | 依賴 governance latency 欄位                         |

### 建議執行順序（時間軸 2026-04-17 重排）

```
Week 1 (今天 → 04-22, 5 天)
├─ [主線] bootstrap 6.2 + add-v1-core-ui 人工驗收（共 13 項）
│   └─ 需使用者在 staging 逐項確認
│
├─ [平行 A] governance 4.1 + 4.2（純文件/checklist）  ← 立刻可做
│   └─ 產出 docs/verify 更新 + rollout checklist，支援驗收
│
└─ [平行 B] test-coverage 挑 3-5 個高價值 TC-* 自動化  ← 立刻可做
    └─ 優先 TC-12 MCP replay、TC-18 current-version-only、TC-13 restricted

Week 2 (04-22 →)
├─ 驗收全通過 → archive bootstrap + add-v1-core-ui
├─ governance 1.x conversation lifecycle + 2.x retention
├─ test-coverage 剩餘 TC-* 與 A/EV 輸出
├─ admin-ui-post-core 全部
└─ observability-and-debug（最後）
```

### 並行分派建議（2026-04-17 更新）

| Track | Change               | 可 `/assign`？ | 現在可做 tasks                    | 備註                             |
| ----- | -------------------- | -------------- | --------------------------------- | -------------------------------- |
| Core  | `bootstrap`          | ❌             | 6.2 人工驗收                      | 需使用者在 staging 操作          |
| Core  | `add-v1-core-ui`     | ❌             | 7 項人工檢查                      | 需使用者在 staging 操作          |
| A     | `governance`         | ✅             | 4.1, 4.2                          | 純文件，可立即開工               |
| B     | `test-coverage`      | ✅             | 2.4, 2.6, 3.2, 3.8 等高價值 TC-\* | 可挑子集並行                     |
| D     | `admin-ui-post-core` | ❌             | 無                                | 等驗收                           |
| E     | `observability`      | ❌             | 無                                | 等驗收 + governance latency 欄位 |

### 依賴鏈（阻塞關係）

```
observability-and-debug
    ↑ 依賴 latency 欄位
governance-refinements 1.x/2.x
    ↑ 依賴 bootstrap 驗收通過（確認 schema 不再動）
bootstrap + add-v1-core-ui 驗收
```

```
admin-ui-post-core
    ↑ 依賴 mcp_tokens/query_logs API + core UI patterns 確立
bootstrap + add-v1-core-ui 驗收
```

## Current Phase Gates

### Phase A: 核心閉環收尾（目前階段）

- [x] 6.1 Test Coverage & Smoke
- [x] 6.1b Deploy to Staging
- [x] add-v1-core-ui 實作（navigation、chat、admin documents、design review）
- [ ] bootstrap 6.2 Manual Acceptance #1–#5（需 staging）
- [ ] add-v1-core-ui 人工檢查 #1/#3–#8（需 staging）
- [ ] **[平行] governance 4.1 docs/verify 更新 + 4.2 rollout checklist**
- [ ] **[平行] test-coverage 高價值 TC-\* 自動化（挑子集）**

### Phase B: 同版後置 Unpark

驗收全通過後：

```bash
spectra unpark admin-ui-post-core
spectra unpark observability-and-debug
# governance + test-coverage 已 in-progress，不需 unpark
```

### Phase C: 最終歸檔

- 所有 6 個 changes 完成後，依序 `spectra archive <change-name>`
- 更新報告 main-v0.0.37.md 記錄實作成果

## Next Moves

### 立即可做（無阻塞，今天開工）

- [high] **使用者親跑 staging 驗收**：bootstrap 6.2 #1–#5 + add-v1-core-ui 人工檢查 #1/#3–#8
- [mid] **test-coverage 剩餘 TC-\***：TC-04 / TC-06–11 / TC-14 / TC-16–17 / TC-19–20（已完成 TC-12/13/15/18）
- [mid] **抽 hub:db mock 共用 helper**：將 `vi.mock('../../server/utils/database', ...)` 抽成 `test/integration/helpers/database.ts`，套用到 4 個 pre-existing fail 檔（chat-route / citations-route / mcp-routes / publish-route）— 依賴：無
- [low] **getDocumentChunk 403 寫 query_logs**：對齊 spec status='blocked'，`server/api/mcp/chunks/[citationId].get.ts` + `server/utils/mcp-replay.ts` 在 403 throw 前加 INSERT — 依賴：無
- [low] **CREDIT_CARD_PATTERN 加入 CREDENTIAL_PATTERNS**：`shared/utils/knowledge-audit.ts` 對信用卡號改走 `shouldBlock=true` 而非 only-redact — 依賴：無

### 等驗收通過後

- [high] archive bootstrap + add-v1-core-ui
- [mid] governance 1.x conversation lifecycle、2.x retention cleanup
- [mid] test-coverage 剩餘 TC-\* 與 A01–A13 / EV-01–EV-04 輸出
- [mid] admin-ui-post-core 全部

### 最後階段

- [low] observability-and-debug：依賴 governance latency 欄位
- [low] 報告更新至 main-v0.0.37.md，記錄完整實作成果

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-17T09:53:15.179Z_

6 active changes (0 ready · 4 in progress · 2 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **add-v1-core-ui** — 42/49 tasks (86%)
- **bootstrap-v1-core-from-report** — 28/34 tasks (82%)
- **governance-refinements** — 6/17 tasks (35%)
- **test-coverage-and-automation** — 12/43 tasks (28%)

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
