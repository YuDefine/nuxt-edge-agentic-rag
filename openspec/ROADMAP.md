# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Parallel Execution Strategy

> 時程壓力：7 天內完成 v1.0.0 核心閉環（截止 2026-04-22）

### 依賴關係與並行軌道

```
Day 1-2: Foundation (blocker)
┌─────────────────────────────────────┐
│  1.1 Schema & Runtime Config        │  ← 必須先完成，所有都依賴
└─────────────────────────────────────┘
                  │
                  ▼
Day 2-3: 三軌並行
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Track A      │  │ Track B      │  │ Track C      │
│ 1.2 Auth     │  │ 2.1 Upload   │  │ 5.1 Rate     │
│              │  │ 2.2 Version  │  │     Limits   │
└──────────────┘  └──────────────┘  └──────────────┘
        │                 │
        ▼                 ▼
Day 4-5: 匯合
┌─────────────────────────────────────┐
│  2.3 Publish State Machine          │
│  3.1 Retrieval & Verification       │
│  3.2 Confidence Routing & Citation  │
└─────────────────────────────────────┘
                  │
                  ▼
Day 5-6: 後置並行
┌──────────────┐  ┌──────────────┐
│ 4.1 MCP Auth │  │ 5.2 Redact   │
│ 4.2 Ask Tool │  │              │
└──────────────┘  └──────────────┘
                  │
                  ▼
Day 7: 驗收
┌─────────────────────────────────────┐
│  6.1 Test Coverage & Smoke          │
│  6.2 Manual Acceptance              │
└─────────────────────────────────────┘
```

### 並行分派建議

| Track | Tasks                   | 可用 `/assign` 分派 | 備註                       |
| ----- | ----------------------- | ------------------- | -------------------------- |
| A     | 1.2 Auth & Allowlist    | ✅                  | 依賴 1.1 schema            |
| B     | 2.1, 2.2 Upload/Version | ✅                  | 依賴 1.1 schema            |
| C     | 5.1 Rate Limits         | ✅                  | 只依賴 KV binding          |
| Main  | 2.3, 3.x, 4.x           | ❌                  | 核心流程，需串行確保一致性 |

## Next Moves

### 近期

- [high] **立即開始** 1.1 Schema & Runtime Config — 所有後續 tasks 的 blocker
- [high] 1.1 完成後，啟動 Track A/B/C 並行

### 中期

- [mid] 完成六步最小閉環後，啟動 `[P]` 同版後置項（MCP tools 4.2/4.3）

### 長期

(依專題進度補充)

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-15T16:02:56.133Z_

1 active change (0 ready · 0 in progress · 1 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

_(none)_

### Draft

- **bootstrap-v1-core-from-report** — 0/26 tasks (0%)

### Blocked

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/active -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->

## Parallel Tracks

> Which active changes can be worked on **simultaneously** without stepping on each other.

### Independent (can run in parallel)

- `bootstrap-v1-core-from-report`

### Mutex (same spec touched)

_(none)_

### Blocked by dependency

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/parallelism -->

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Next Moves

_(尚未累積)_

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
