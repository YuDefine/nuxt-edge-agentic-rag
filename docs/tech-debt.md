# Tech Debt Register

追蹤 `@followup[TD-NNN]` marker 對應的未解決項目。所有在 `openspec/changes/**/tasks.md` 裡出現的 marker 都必須在此有對應 entry，否則 `spectra-archive` 會被 `pre-archive-followup-gate.sh` 攔截。

規則詳見 `.claude/rules/follow-up-register.md`。

---

## Index

| ID     | Title                                                  | Priority | Status | Discovered                    | Owner |
| ------ | ------------------------------------------------------ | -------- | ------ | ----------------------------- | ----- |
| TD-001 | mcp-token-store libsql 不相容                          | low      | open   | 2026-04-20 B16 #10            | —     |
| TD-002 | guest_policy DB-direct UPDATE 造成 cache drift         | mid      | open   | 2026-04-20 B16 #7             | —     |
| TD-003 | text-dimmed 對比度不足（cross-change residual）        | mid      | open   | 2026-04-20 B17 C#11.9         | —     |
| TD-004 | 首頁 Google login button 高度 36px < WCAG 40px         | high     | done   | B17 viewport-baseline.spec.ts | —     |
| TD-005 | Admin 頁面 a11y violations 批次（@nuxt/a11y 首輪掃描） | high     | done   | 2026-04-21 RAF @nuxt/a11y     | —     |

---

## TD-001 — mcp-token-store libsql 不相容

**Status**: open
**Priority**: low
**Discovered**: 2026-04-20 — `member-and-permission-management` 人工檢查 #10
**Location**: `server/utils/mcp-token-store.ts` (createToken / findUsableTokenByHash / touchLastUsedAt / revoke)
**Related markers**: search `@followup[TD-001]` in repo

### Problem

`mcp-token-store` 使用 D1 `$client.prepare()` raw API。Local dev 用 libsql（see `scripts/patch-hub-db-dev.mjs`），`$client` 不支援 `.prepare()` / `.bind()` / `.first()` 等 D1-specific method，call 時拋 `database.prepare is not a function`。

影響：

- Local dev 無法 call `/mcp` endpoint 的 Bearer token 驗證流程
- B16 人工檢查 #10（Guest MCP askKnowledge 錯誤碼）local 跑不起來，只能 production 驗
- 未來若要 local 端寫 integration test 覆蓋 MCP 流程也會撞牆

Production (Cloudflare Workers + D1) 運作正常。

### Fix approach

改用 Drizzle ORM：`import { db, schema } from 'hub:db'`。四處 raw SQL 皆有對應 drizzle 表達式：

- `createToken` → `db.insert(schema.mcpTokens).values({...})`
- `findUsableTokenByHash` → `db.select(...).from(schema.mcpTokens).where(and(eq, eq, eq)).limit(1)`
- `touchLastUsedAt` → `db.update(schema.mcpTokens).set({ lastUsedAt }).where(eq(...))`
- `revoke` → `db.update(schema.mcpTokens).set({ status: 'revoked', revokedAt }).where(eq(...))`

其他用 `getD1Database()` 的 store 也可一併評估遷移。

### Acceptance

- Local `pnpm dev` 可 call `/mcp` 並通過 Bearer token 驗證（沒 `database.prepare is not a function`）
- 新 spec `test/integration/mcp-token-store.spec.ts` 覆蓋 CRUD + scope check
- B16 人工檢查 #10 local 可重跑，GUEST_ASK_DISABLED / ACCOUNT_PENDING 皆通過

---

## TD-002 — guest_policy DB-direct UPDATE 造成 cross-Worker cache drift

**Status**: open
**Priority**: mid
**Discovered**: 2026-04-20 — `member-and-permission-management` 人工檢查 #7（production 驗證）
**Location**: `server/utils/guest-policy.ts`（cache 機制）+ operator documentation
**Related markers**: search `@followup[TD-002]` in repo

### Problem

`setGuestPolicy()` 的跨 Worker cache invalidation 依賴 KV `guest_policy:version` stamp：

1. `setGuestPolicy` 寫 D1 `system_settings` + bump KV version
2. 每個 Worker instance 下次 request `getGuestPolicy()` 讀 KV version → 與 cached mismatch → 重讀 D1

B#7 驗證時發現：若 admin 繞過 API 直接 DB UPDATE（例如 `wrangler d1 execute DB --remote --command "UPDATE system_settings..."` 或 D1 console），**不會 bump KV version**，結果是：

- 已有 cached policy 的 Worker instance 繼續回舊 policy
- 沒 cache 的 cold instance 讀到新 policy
- 實測 5 個 parallel request 出現混合結果（2 個舊 / 3 個新）

影響：

- Operational risk：admin 手動改 DB 做緊急 rollback 時會遇到「改了 DB 但 Worker 還回舊值」的困惑
- 沒有告警機制

### Fix approach

選項 A（文件化 + 弱提醒）：

- 在 `docs/runbooks/guest-policy.md` 寫明「必須透過 PATCH /api/admin/settings/guest-policy」
- `setGuestPolicy()` 的 JSDoc 加反向說明（繞過後果）

選項 B（程式層防線）：

- 每次 `getGuestPolicy` 讀 D1 `updated_at` timestamp 與 KV version 比對；若 D1 timestamp 比 KV version 新 → 強制重讀 + 自動 bump KV
- 成本：每次 request 多讀 D1 一欄（或整 row）；與原設計「KV version 快路徑」trade-off
- 適用性：`guest_policy` 讀頻高（每次 chat + MCP 都 hit），原設計刻意避免 D1 讀；加這條會退化 p99

選項 C（隔離通道）：

- 拿掉 DB-direct 權限（IAM 層）；所有寫入必須過 API
- 最徹底但超過 code scope

建議：先做選項 A（低成本即見效），選項 B 視 operator 實際誤操作頻率決定。

### Acceptance

- 選項 A：`docs/runbooks/guest-policy.md` 建檔並在 onboard 文件引用
- 選項 B（若採納）：`guest-policy.spec.ts` 新增「D1 寫入繞過 API 時下次 request 會發現並自動補 bump」的 test

---

## TD-003 — text-dimmed 對比度不足（cross-change residual）

**Status**: open
**Priority**: mid
**Discovered**: 2026-04-20 — `responsive-and-a11y-foundation` C#11.9（axe-core 掃到三頁 color-contrast violation）
**Location**:

- `app/pages/admin/debug/query-logs/[id].vue:180,189`
- `app/components/debug/OutcomeBreakdown.vue:59`
- `app/components/debug/EvidencePanel.vue:53,70,81`
- `app/components/debug/LatencySummaryCards.vue:49,59,69,79,88`
- `app/components/debug/ScorePanel.vue:34,49`
- `app/pages/auth/callback.vue:41`
- `app/components/documents/UploadWizard.vue:646,904`
- 其他未被 axe-core 初始 scan 覆蓋的頁面

**Related markers**: search `@followup[TD-003]` in repo

### Problem

Nuxt UI `text-dimmed` token 在 dark theme 下 computed color `oklch(0.556 0 0)` on parent `bg-default`，對比度 ≈ 3.5:1（需 WCAG AA 4.5:1）。本次 session 已修 footer + chat UI 7 處（ConversationHistory / MessageList / RefusalMessage / index.vue / default.vue footer），但其他頁面約 10+ 處仍殘留。

影響：admin/debug/ 下的 logs、latency cards、auth callback、UploadWizard step state 皆有 a11y 違規；若未來掃這些頁面會報 fail。

### Fix approach

批次替換 `text-dimmed` → `text-muted`（semantic 更合適，對比度充足）。需審視每處語意：

- Muted text（「無資料」「尚未載入」etc）：直接 `text-muted` ✓
- Disabled state（UploadWizard pending step）：可能需 `text-toned` 或保留視覺區分，要 inline review

或升級 token：在 `app.config.ts` 或 `app/assets/css/main.css` 擴充 `--ui-color-text-dimmed` token 為更深色（但會影響 intended design system hierarchy）。

### Acceptance

- axe-core playwright 掃 `/admin/debug/**`、`/admin/tokens`、`/admin/query-logs`、`/auth/callback`、`/admin/documents/upload` 全 0 color-contrast violation
- `docs/design-review-findings.md` #10 的 Cross-Change 備註更新為 resolved

---

## TD-004 — 首頁 Google login button 高度 36px < WCAG 40px

**Status**: done
**Resolved**: 2026-04-20 — `app/pages/index.vue` UButton 加 `class="py-3"`（commit b277b31）
**Priority**: high
**Discovered**: `responsive-and-a11y-foundation` B17 — `e2e/viewport-baseline.spec.ts` 測試既有 fail
**Location**: `app/pages/index.vue`（signed-out 分支 Google login CTA）
**Related markers**: search `@followup[TD-004]` in repo

### Problem

`viewport-baseline.spec.ts` 測試 `/` primary CTA (Google login) 於 360×640 viewport 的 touch target size：

- 測試期望：height ≥ 40px（內註 WCAG 2.5.5 minimum 44×44）
- 實測：36px
- Fail 已存在一段時間，屬 B17 既有技術債

WCAG 2.5.5 Target Size (AA) 要求 touch target ≥ 44×44 CSS px。36px 對手指觸控、運動障礙使用者是明顯風險。

### Fix approach

- 首頁 Google login button 改用較大 `size` prop 或加 `py-3` 讓高度 ≥ 44px
- 同時掃首頁其他 interactive element 的 hit-target
- 跑 `viewport-baseline.spec.ts` 驗證 pass

### Acceptance

- `e2e/viewport-baseline.spec.ts` 全部 pass（包含「primary CTA ≥ 40px」）
- Chrome DevTools 手動實測 iPhone SE viewport 下 button 能輕易點到
- 若連帶觸發其他頁面 hit-target audit 失敗，併入同一修

---

## TD-005 — Admin 頁面 a11y violations 批次（@nuxt/a11y 首輪掃描）

**Status**: done
**Resolved**: 2026-04-20 — UFormField 包裹 + `srOnlyHeader` utility + heading-order 全分支修復 + aria-labelledby 單一 source of truth（commit 285482b）
**Priority**: high
**Discovered**: 2026-04-21 — `responsive-and-a11y-foundation` 將社群版 `nuxt-a11y` 切換為官方 `@nuxt/a11y@1.0.0-alpha.1`，DevTools panel 首輪掃描結果
**Location**: `/admin/query-logs`、`/admin/documents`、`/admin/tokens`、`/admin/debug/latency`
**Related markers**: search `@followup[TD-005]` in repo
**Related findings**: `docs/design-review-findings.md` 2026-04-21 section #13-18

### Problem

@nuxt/a11y DevTools panel 首次全站掃描發現 admin 頁面群有以下違規（非 MPM / RAF scope，屬 Cross-Change DRIFT）：

**Critical（5 elements, 阻擋 WCAG AA）**：

- `/admin/query-logs` — 3 × `button-name`：icon-only `<UButton>` 缺 `aria-label`（可能是 refresh / export / 詳情按鈕）
- `/admin/query-logs` — 2 × `label`：form element 缺 `<label>` 綁定（可能是篩選器的 USelect / UInput）

**Moderate（1 element）**：

- `/admin/debug/latency` — `heading-order`：heading 層級跳階（例如 h1 → h3 漏 h2）

**Minor（3 elements）**：

- `/admin/query-logs` — UTable `empty-table-header`
- `/admin/documents` — UTable `empty-table-header`
- `/admin/tokens` — UTable `empty-table-header`

### Scope 歸屬

- `/admin/query-logs` → `admin-query-log-ui` capability
- `/admin/documents` → `admin-document-management-ui` capability
- `/admin/tokens` → `admin-token-management-ui` capability
- `/admin/debug/latency` → `debug-decision-inspection` capability

不併入 MPM / RAF archive（維持 scope discipline），獨立 low-friction PR 處理。

### Fix approach

1. **button-name（icon-only button）**：給 `<UButton icon="..." />` 加 `aria-label="..."` prop
2. **label（form element）**：
   - `<USelect>` / `<UInput>` 若無 visible label，加 `aria-label`
   - 或用 `<UFormField label="...">` wrap 提供語意 label
3. **heading-order**：檢查 `/admin/debug/latency` 的 heading 結構，補齊中間層級
4. **empty-table-header**（UTable actions column）：
   - 統一 pattern：`header: () => h('span', { class: 'sr-only' }, '操作')`
   - 參考 `/admin/members` 的修復（2026-04-21 已落地）作為 canonical pattern
   - 建議抽成 utility：`srOnlyHeader(label: string)` 於 `shared/utils/table.ts`

### Acceptance

- @nuxt/a11y DevTools 對 `/admin/query-logs`、`/admin/documents`、`/admin/tokens`、`/admin/debug/latency` critical + serious + moderate + minor 全數 0 violation
- axe-core playwright 複掃驗證
- `docs/design-review-findings.md` 2026-04-21 section #13-18 標記 ✅ Resolved
