# Tech Debt Register

追蹤 `@followup[TD-NNN]` marker 對應的未解決項目。所有在 `openspec/changes/**/tasks.md` 裡出現的 marker 都必須在此有對應 entry，否則 `spectra-archive` 會被 `pre-archive-followup-gate.sh` 攔截。

規則詳見 `.claude/rules/follow-up-register.md`。

---

## Index

| ID     | Title                                                     | Priority | Status | Discovered                        | Owner |
| ------ | --------------------------------------------------------- | -------- | ------ | --------------------------------- | ----- |
| TD-001 | mcp-token-store libsql 不相容                             | low      | done   | 2026-04-20 B16 #10                | —     |
| TD-002 | guest_policy DB-direct UPDATE 造成 cache drift            | mid      | done   | 2026-04-20 B16 #7                 | —     |
| TD-003 | text-dimmed 對比度不足（cross-change residual）           | mid      | done   | 2026-04-20 B17 C#11.9             | —     |
| TD-004 | 首頁 Google login button 高度 36px < WCAG 40px            | high     | done   | B17 viewport-baseline.spec.ts     | —     |
| TD-005 | Admin 頁面 a11y violations 批次（@nuxt/a11y 首輪掃描）    | high     | done   | 2026-04-21 RAF @nuxt/a11y         | —     |
| TD-006 | Nuxt UI subtle variant tonal badge 對比度不足             | mid      | done   | 2026-04-20 TD-003 e2e exclude     | —     |
| TD-007 | 裝飾 icon tonal color 低於 WCAG 1.4.11 non-text AA        | low      | done   | 2026-04-20 TD-006 review          | —     |
| TD-008 | acceptance-tc-0x MCP 整合測試在 TD-001 修後破損           | mid      | done   | 2026-04-20 add-ai-gateway         | —     |
| TD-009 | user_profiles.email_normalized 全面改 nullable            | mid      | done   | 2026-04-21 passkey-authentication | —     |
| TD-010 | credentials / admin-members endpoint libsql 不相容        | mid      | done   | 2026-04-21 passkey §16 DR         | —     |
| TD-011 | migration 0009 FK cascade 設計不符 self-delete / audit    | high     | done   | 2026-04-21 passkey §17.8          | —     |
| TD-012 | passkey-first → link Google 被 better-auth email 檢驗擋住 | high     | done   | 2026-04-21 passkey §17.3          | —     |
| TD-013 | /account/settings 新增 passkey 缺 naming dialog           | low      | done   | 2026-04-21 passkey §17.2          | —     |
| TD-014 | error-sanitizer 後 12 test 抛 evlog Logger not init       | mid      | done   | 2026-04-21 drizzle-refactor apply | —     |

---

## TD-001 — mcp-token-store libsql 不相容

**Status**: done
**Resolved**: 2026-04-20 — `createMcpTokenStore()` 3 個 function 遷移 Drizzle ORM（commit 1f6a4d1）+ 新增 `test/integration/mcp-token-store.spec.ts` 8 test cases 覆蓋 CRUD / scope / expiry / touch
**Priority**: low
**Discovered**: 2026-04-20 — `member-and-permission-management` 人工檢查 #10
**Location**: `server/utils/mcp-token-store.ts` (`createMcpTokenStore()` 的 createToken / findUsableTokenByHash / touchLastUsedAt — `revoke` 在 `createMcpTokenAdminStore()` 已是 Drizzle，不在本 TD 範圍)
**Related markers**: search `@followup[TD-001]` in repo

### Problem

`mcp-token-store` 使用 D1 `$client.prepare()` raw API。Local dev 用 libsql（see `scripts/patch-hub-db-dev.mjs`），`$client` 不支援 `.prepare()` / `.bind()` / `.first()` 等 D1-specific method，call 時拋 `database.prepare is not a function`。

影響：

- Local dev 無法 call `/mcp` endpoint 的 Bearer token 驗證流程
- B16 人工檢查 #10（Guest MCP askKnowledge 錯誤碼）local 跑不起來，只能 production 驗
- 未來若要 local 端寫 integration test 覆蓋 MCP 流程也會撞牆

Production (Cloudflare Workers + D1) 運作正常。

### Fix approach

改用 Drizzle ORM：`getDrizzleDb()` 取代 `getD1Database()`。`createMcpTokenStore()` 的 3 處 raw SQL 皆有對應 drizzle 表達式：

- `createToken` → `db.insert(schema.mcpTokens).values({...})`
- `findUsableTokenByHash` → `db.select(...).from(schema.mcpTokens).where(and(eq, eq, eq)).limit(1)` + JS 層 expires check 保留（避免跨 dialect NULL 比對語意差異）
- `touchLastUsedAt` → `db.update(schema.mcpTokens).set({ lastUsedAt }).where(eq(...))`

同檔 `createMcpTokenAdminStore()`（含 `revokeTokenById` / `listTokensForAdmin` / `countTokensForAdmin`）**早已是 Drizzle**，作為 canonical pattern 參考，不在本 TD 遷移範圍。其他 repo 內仍使用 `getD1Database()` 的 callers（`server/api/*` / `server/mcp/tools/*` / `server/tasks/retention-cleanup.ts`）可留作 future TD 評估。

### Acceptance

- Local `pnpm dev` 可 call `/mcp` 並通過 Bearer token 驗證（沒 `database.prepare is not a function`）
- 新 spec `test/integration/mcp-token-store.spec.ts` 覆蓋 CRUD + scope check
- B16 人工檢查 #10 local 可重跑，GUEST_ASK_DISABLED / ACCOUNT_PENDING 皆通過

---

## TD-002 — guest_policy DB-direct UPDATE 造成 cross-Worker cache drift

**Status**: done
**Resolved**: 2026-04-20 — 選項 A 落地：新增 `docs/runbooks/guest-policy.md` runbook + `setGuestPolicy()` JSDoc 加反向說明
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

**Status**: done
**Resolved**: 2026-04-20 — 7 個檔共 13 處 `text-dimmed` → `text-muted`（commit 3a01a9f），regression guard `e2e/td003-contrast.spec.ts` 7/7 pass
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

---

## TD-006 — Nuxt UI subtle variant tonal badge 對比度不足

**Status**: done
**Resolved**: 2026-04-20 — 按 nuxt/ui #1284 官方推薦做 per-component compoundVariants override in `app/app.config.ts`（badge / alert / button × {primary, info, success, warning, error} × {subtle, soft} 共 30 entries，text 用 `-700 dark:-200` shade 達 WCAG AA）+ 附帶修 2 處 raw `text-{color}` (`app/pages/admin/debug/query-logs/[id].vue` redaction notice、`app/components/chat/MessageInput.vue` validation/char-count)。`e2e/td003-contrast.spec.ts` 移除 4 個 detail page `.exclude(...)` 並 7/7 pass
**Priority**: mid
**Discovered**: 2026-04-20 — TD-003 `e2e/td003-contrast.spec.ts` 掃 `/admin/debug/query-logs/[id]` 時 axe-core 回報，用 `.exclude()` 暫時排除
**Location**:

- `app/pages/admin/debug/query-logs/[id].vue`（redaction notice `<p class="text-warning">`、refusal badge、pii_request badge、score badge）
- 任何使用 `bg-{color}/10 + text-{color}` subtle pattern 的 UBadge / UButton / 其他 Nuxt UI 元件
- **Related markers**: search `@followup[TD-006]` in repo

### Problem

Nuxt UI `subtle` variant 的 tonal 配色在 `bg-default` 上對比度不足 WCAG AA 4.5:1（小字）/ 3:1（大字 / 非文字）：

| Selector                                                | FG 色碼 | BG 色碼 | 實測對比度 | WCAG AA 要求 |
| ------------------------------------------------------- | ------- | ------- | ---------- | ------------ |
| `p.text-warning` (redaction notice)                     | #f0b100 | #ffffff | 1.91:1     | 4.5:1        |
| `pii_request` badge (bg-warning/10 + text-warning)      | #f0b100 | #fef7e5 | 1.78:1     | 4.5:1        |
| `超出允許範圍` refusal badge (bg-error/10 + text-error) | #fb2c36 | #ffeaeb | 3.3:1      | 4.5:1        |
| `評審通過` score badge (bg-success/10 + text-success)   | #00c950 | #e5faee | 2.03:1     | 4.5:1        |

這是 Nuxt UI design system token 層級的問題，不是單一 component 使用錯誤。`subtle` variant 以 10% opacity tint 作 bg，text 保留原 token 的中飽和度顏色 — warning / error / success 三色的中飽和度都低於 AA 門檻。

### Fix approach

可能路徑（需討論）：

1. **調整 Nuxt UI theme token**：`app.config.ts` 或 `main.css` 覆蓋 `--ui-color-warning / --ui-color-error / --ui-color-success` 為更深色版本（例：`warning.600` → `warning.700`）。影響範圍：所有用這些色 token 的 component。
2. **換 variant**：redaction notice / badge 改用 `solid` variant（full-saturation bg + white text）或 `outline` variant。代價：視覺層次變強，可能與 design 風格衝突。
3. **升級 Nuxt UI**：若上游已修，升版即可。查 changelog。
4. **接受現狀 + 文件化 exception**：在 design-review-findings.md 和 a11y report 明確宣告這些 token 組合為已知 exception；不掃 tonal badge。最差選項，但若修法成本過高可接受。

**決策點**：需與 design 討論哪個方向。**不在當前 TD 範圍內自動選**。

### Acceptance

- `e2e/td003-contrast.spec.ts` 移除 `.exclude('p.text-warning')`、`.bg-warning\\/10`、`.bg-error\\/10`、`.bg-success\\/10` 四個排除
- axe-core 對 detail page + 所有使用 tonal badge pattern 的頁面 color-contrast 0 violation
- 或：明確登記 design decision 為 exception，更新 findings 標記不再追蹤

---

## TD-007 — 裝飾 icon tonal color 低於 WCAG 1.4.11 non-text contrast

**Status**: done
**Resolved**: 2026-04-20 — Audit 全 repo 14 處 `<UIcon text-{color}>` 使用點，**全部判定為 decorative**（鄰近 heading / label / status text 已表達語義，icon 僅視覺重複）。12 處加 `aria-hidden="true"`（2 處原本已有）+ 0 處 informational，按 WCAG 1.4.11 decorative 圖形不計入 3:1 要求
**Priority**: low
**Discovered**: 2026-04-20 — TD-006 code-review 掃同專案 raw `text-{color}` 時連帶發現
**Location**:

- `app/pages/account-pending.vue:36` — `<UIcon text-warning size-7>`
- `app/pages/admin/debug/latency/index.vue:131` — `<UIcon text-warning size-10>`
- `app/pages/admin/debug/query-logs/[id].vue:118,146` — `<UIcon text-warning/error size-10>`
- `app/pages/admin/documents/[id].vue:421` — `<UIcon text-primary size-5>`
- `app/components/chat/GuestAccessGate.vue:64` — `<UIcon text-warning>` on `bg-warning/10`
- `app/components/documents/LifecycleConfirmDialog.vue:103,105` — 動態 `text-error` / `text-warning`
- `app/components/documents/UploadWizard.vue:871,895,966` — `<UIcon text-error/primary>`
- `app/components/chat/CitationReplayModal.vue:121,138` — `<UIcon text-primary>`

**Related markers**: search `@followup[TD-007]` in repo

### Problem

WCAG 1.4.11 Non-Text Contrast (AA) 要求傳達資訊的 icon / 圖形元件對比度 ≥ 3:1。Nuxt UI 預設 `text-{color}` 指向 `-500` shade：

- `text-warning` (`#f0b100`) on `bg-default` (white) ≈ 1.9:1
- `text-primary` (`#00c950`) on white ≈ 1.8:1
- `text-error` (`#fb2c36`) on white ≈ 3.3:1 — 邊緣

全部低於 3:1（或僅邊緣 pass）。TD-006 scope 只含 text，不處理 icon 對比度；`e2e/td003-contrast.spec.ts` 目前只掃 `color-contrast` rule（針對 text），未納入 `non-text-contrast` rule。若未來擴充 axe 掃 `wcag2aaa` 或 `non-text-contrast`，此類會爆大量 violation。

### Fix approach

與 TD-006 同策略不適用（compoundVariants 只覆蓋 component 的文字 class，不影響 icon 內的 SVG fill）。可能路徑：

1. **Icon 改用 `text-{color}-700 dark:text-{color}-200`**：跟 TD-006 raw text 修法一樣，但 icon 視覺會變重
2. **改用 solid chip 包住 icon**：`<span class="rounded-full bg-warning p-2"><UIcon class="text-inverted" /></span>` — full-sat bg + inverted（通常 white）text 對比 ≥ 4.5:1
3. **axe rule 維持不掃 non-text-contrast**：若這些 icon 都是 decorative（`aria-hidden="true"`），WCAG 1.4.11 不要求（只影響 informational icon）。先 audit 每個使用點的語意，decorative 的保留，informational 的才修

建議先做 audit（選項 3 的第一步），再依結果決定選項 1 / 2。

### Acceptance

- 每處 icon 使用點明確標為 decorative（`aria-hidden="true"`）或 informational
- Informational icon 對比度 ≥ 3:1（可實測驗證）
- 若擴充 `e2e/td003-contrast.spec.ts` 加 `non-text-contrast` rule，全 pass

---

## TD-008 — acceptance-tc-0x MCP 整合測試在 TD-001 修後破損

**Status**: done
**Resolved**: 2026-04-20 — commit 446c97d。Group B 11 個測試改用 `createHubDbMock` helper 一次補齊 `getD1Database` + `getDrizzleDb` 兩個 export；`mcp-tool-runner` 加 `actor` / `tokenStore` injection point + `createStubMcpTokenStoreFromActor` helper；刪除 TD-001 後失效的 stale raw SQL assertion。`pnpm test:integration`：16 failed → 0 failed（51/51 files / 260 passed + 1 skipped）
**Priority**: mid
**Discovered**: 2026-04-20 — 跑 `pnpm test:integration` 為了驗證 add-ai-gateway-usage-tracking 改動時發現 16 個 acceptance-tc-_.test.ts 失敗
**Location**: `test/integration/acceptance-tc-_.test.ts`（TC-01 / 04 / 06 / 07 / 08 / 09 / 10 / 11 / 12 / 13 / 14 / 16 / 17 / 18 / 19 / 20）+ `test/integration/helpers/mcp-tool-runner.ts:68`
**Related markers**: 目前無 tasks.md marker；純 pre-existing broken test，non-blocking for add-ai-gateway-usage-tracking archive

### Problem

TD-001 修復後（commit 1f6a4d1，mcp-token-store 遷移 Drizzle）兩類 failure 開始發生：

1. `Error: [vitest] No "getDrizzleDb" export is defined on the "../../server/utils/database" mock` — acceptance-tc-04 / 06 / 07 / 08 / 09 / 11 / 13 / 14 / 16 / 17 / 18 / 19 / 20。Drizzle 遷移後 `server/utils/database.ts` 新增 `getDrizzleDb` export，但這些 tests 的 `vi.mock('../../server/utils/database', ...)` 只 stub 原本的 `getD1Database`，沒加 `getDrizzleDb`。
2. `TypeError: Cannot read properties of undefined (reading 'id')` at `mcp-tool-runner.ts:68` — acceptance-tc-01 / 10 / 12 的 `runMcpCase` 經由 `runMcpMiddleware` 解析 token，但 mock auth context 形狀對不上 Drizzle 遷移後的 shape（token record 的 `id` 欄位路徑改了）。

影響：

- `pnpm test:integration` 非綠，擋 CI（若有）與 commit 流程的「全綠再進 archive」慣例
- Acceptance TC 無法 local 驗證 — 本次 add-ai-gateway-usage-tracking 的 AI binding 改動是否影響 MCP read path，只能靠 unit-level mock（`mcp-tool-ask.test.ts` / `mcp-tool-search.test.ts`）推論；無 end-to-end 覆蓋

**本次確認 pre-existing**：`git stash` 我的 gateway 改動後跑 HEAD 上的 `acceptance-tc-01.test.ts` 仍 3/6 failed，failure log 完全一致。與 add-ai-gateway-usage-tracking 無關。

### Fix approach

1. 每個 acceptance-tc-\*.test.ts 的 `vi.mock('../../server/utils/database', ...)` 加 `getDrizzleDb: vi.fn().mockResolvedValue(...)` stub，或抽共用 helper `createDatabaseMock()`（類似 `createHubDbMock`）統一處理
2. `mcp-tool-runner.ts` 的 token resolution 看當前 mcp middleware 的 token record shape，更新 mock auth context
3. 考慮把 D1/Drizzle 的 test mock centralize 到 `test/integration/helpers/database.ts`（目前 `createHubDbMock` 只處理 hub db，沒涵蓋 `getDrizzleDb` 單獨 export）

### Acceptance

- `pnpm test:integration` 全綠（> 95% 通過，非 flake）
- `acceptance-tc-01 / 04 / 06 / 07 / 08 / 09 / 10 / 11 / 12 / 13 / 14 / 16 / 17 / 18 / 19 / 20` 皆 pass
- 未來 Drizzle schema 再變動時 mock 能跟上（helper 集中化的副產品）

---

## TD-009 — user_profiles.email_normalized 全面改 nullable

**Status**: done
**Priority**: mid
**Discovered**: 2026-04-21 — `passkey-authentication` change migration planning
**Location**: `server/db/schema.ts` (`userProfiles.emailNormalized`), `server/database/migrations/0009_passkey_and_display_name.sql` (deferred from migration)
**Related markers**: search `@followup[TD-009]` in repo

### Problem

`passkey-authentication` change 的 design 原本規劃 `user_profiles.email_normalized` 同步改 nullable（落實 Decision 2 的完整語意），但 migration 0009 實務評估後延後：

- `user_profiles` 的 FK children 包含 `conversations`、`query_logs`、`messages`、`documents`，改 `email_normalized` nullable 必須 rebuild `user_profiles` + 其 FK 子樹（仿 0007 的 D1 cascade 模式）
- 0009 本身已經 rebuild `user` 樹的 8 張表（user / account / session / member_role_changes / mcp_tokens / query_logs / citation_records / messages），再加 `user_profiles` 樹 rebuild 會讓 migration 超過安全 review surface（估計 700+ 行 SQL，大量 edge case）
- 目前的 workaround：passkey-only 使用者的 `email_normalized` 寫入 sentinel 值 `'__passkey__:' || user.id`（保證 unique by PK），`isAdminEmailAllowlisted` 不會誤判（sentinel 含 `:`，不是合法 email 字元）

### Fix approach

獨立 change `passkey-user-profiles-nullable-email`，單一職責：

1. Migration 0010 rebuild `user_profiles` + FK children（conversations、query_logs、messages、documents）
2. `user_profiles.email_normalized` 改 `NULL` + partial unique index（`WHERE email_normalized IS NOT NULL AND email_normalized NOT LIKE '__passkey__:%'`）
3. Data migration：掃 sentinel 值 → 改為 NULL
4. 更新 `server/utils/` upsert 邏輯不再寫 sentinel
5. 更新 `auth-storage-consistency` spec requirement（移除 sentinel scenario，換成純 nullable scenario）

### Acceptance

- `PRAGMA table_info(user_profiles)` 顯示 `email_normalized` 允許 NULL
- 原 passkey-only 使用者 row 的 `email_normalized = NULL`（sentinel 已遷移）
- 相關查詢 code path（`isAdminEmailAllowlisted` 等）皆加 `email_normalized IS NOT NULL` guard
- `PRAGMA foreign_key_check` 零 row
- `spectra analyze` 對 `passkey-authentication` archived spec 的 nullable rule 生效

---

## TD-010 — credentials / admin-members endpoint libsql 不相容

**Status**: done
**Resolved**: 2026-04-23 — portable ORM refactor、local happy-path 響應式驗證與 production `/account/settings` + `/admin/members` manual regression evidence 全數補齊，`drizzle-refactor-credentials-admin-members` closeout 條件滿足
**Priority**: mid
**Discovered**: 2026-04-21 — `passkey-authentication` §16 Design Review 跑 `/review-screenshot` 時，`/account/settings` 與 `/admin/members` 兩頁回 500
**Location**:

- `server/api/auth/me/credentials.get.ts`（`db.all(sql\`SELECT ... COALESCE(display_name, "displayName", name) ...\`)`）
- `server/api/admin/members/index.get.ts:127-164`（`db.all(sql\`... EXISTS (SELECT 1 FROM account) ...\`)`）

**Related markers**: search `@followup[TD-010]` in repo

**Progress update (2026-04-21)**:

- Local dev `http://localhost:3010` 以 `/api/_dev/login` 建立 `admin@test.local` session 後重新驗證 TD-010 happy path。
- `/api/auth/me/credentials` 回 200：`email = "admin@test.local"`, `displayName = "Test Admin"`, `hasGoogle = false`, `passkeys = []`。
- `/api/admin/members?page=1&pageSize=20` 回 200，`data.length = 17`，列資料包含 `displayName` / `credentialTypes` / `registeredAt` / `lastActivityAt`。
- Playwright 載入 `/account/settings` 與 `/admin/members` 皆 HTTP 200、停留在目標 URL、未偵測已知 error text；截圖在 `screenshots/local/td010-continuation/`。
- 2026-04-23 使用者於 production admin session 手動驗證：`/account/settings` happy path 正常顯示 email / display name / passkey / Google 綁定區塊；`/admin/members` happy path 正常顯示會員列表 / role badge / credential badges / last activity，且本次資料量全部落於單頁，未出現 `500` / `暫時無法載入會員清單` / error state。
- local UI、production D1 回歸與 §16 responsive pipeline 已全數補齊，Status 更新為 `done`。

### Problem

兩個 endpoint 使用 `db.all(sql\`...\`)`raw SQL + tagged template（drizzle 的 D1-specific API），在 production D1 正常運作，但在 local dev 的 libsql 環境下`db.all` 不存在／行為不同，導致 endpoint 500。同類型問題見 TD-001（已修）。

影響範圍：

- `/account/settings` 頁面無法在 local 渲染 happy path（永遠 error state）
- `/admin/members` 列表無法在 local 渲染 happy path（永遠 error state）
- §16 Design Review 響應式截圖 6/12 只能拍到 error state；happy path 留待 §17 人工檢查（在 production／或修完 TD-010 的 local）驗證
- `admin-members-list.spec.ts` 與 `admin-members-passkey-columns.spec.ts` 這類 integration test 若依賴 local libsql 會 mock／skip，production 側才真正驗證

### Fix approach

仿 TD-001 做法，把 raw SQL 改寫為 Drizzle ORM query：

1. **`credentials.get.ts`**：
   - `SELECT email, display_name, hasGoogle, passkeys[]` 拆成 3 條 drizzle query（user / account filter providerId='google' / passkey by userId）
   - 取消 `COALESCE(display_name, "displayName", name)` — FD-001 既已改以 `fieldName: 'display_name'` 對齊 schema，drizzle `schema.user.displayName` 直接讀到 snake_case 值
2. **`admin/members/index.get.ts`**：
   - `EXISTS (SELECT 1 FROM account WHERE providerId = 'google' ...)` → drizzle `leftJoin` + `groupBy` 或 subquery（drizzle-orm 支援 `sql\`EXISTS(...)\`` inline but 需保 libsql 相容寫法）
   - `credentialTypes` 聚合改以 application-layer 組裝（查 account 後 reduce）
   - `registeredAt` / `lastActivityAt` drizzle query 直接可得（`user.createdAt`、`session.createdAt` max）

### Acceptance

- Local dev 環境（hub:db sqlite）執行 `curl /api/auth/me/credentials` with 有 session 的 cookie → 200 with correct payload
- Local dev 執行 `curl /api/admin/members` with admin cookie → 200 with correct payload
- 再次跑 `/review-screenshot` 應可拍到 happy path 的響應式佈局
- production D1 側回歸：`admin-members-list.spec.ts` + `admin-members-passkey-columns.spec.ts` 全綠

---

## TD-011 — migration 0009 FK cascade 設計不符 self-delete / audit 語意

**Status**: done
**Resolved**: 2026-04-23 — migration `0010_fk_cascade_repair.sql` 已套用至 production D1，並以 `v0.28.12` 完成 passkey-only self-delete production closeout
**Priority**: high
**Discovered**: 2026-04-21 — `passkey-authentication` §17.8 passkey-only 自刪實測，`/api/auth/account/delete` 回 500 Failed query，sqlite FK 阻擋 user row 刪除
**Location**: `server/database/migrations/0009_passkey_and_display_name.sql`

- `member_role_changes` (line ~296-304): `FOREIGN KEY (user_id) REFERENCES user_new(id)` 無 ON DELETE 子句 → 預設 NO ACTION → 阻擋 user row 刪除
- `mcp_tokens` (line ~183): `created_by_user_id TEXT NOT NULL REFERENCES user_new(id)` 同樣無 ON DELETE → 阻擋刪除

**Related markers**: search `@followup[TD-011]` in repo

**Progress update (2026-04-21)**:

- `server/database/migrations/0010_fk_cascade_repair.sql` 已套用到 production D1 `agentic-rag-db`（database_id `3036df7f-d54b-4d36-a33d-ecbb551fc278`）。
- Pre-apply backup 已下載：`backups/backup-pre-0010-20260421.sql`。
- Production baseline / post-apply row count 一致：`member_role_changes=2`, `mcp_tokens=3`, `query_logs=72`, `citation_records=37`, `messages=81`, `"user"=2`。
- Post-apply PRAGMA 驗證通過：`foreign_key_check` empty；`member_role_changes` 無 FK；`mcp_tokens.created_by_user_id` 為 `ON DELETE CASCADE`；`query_logs.mcp_token_id` 為 `ON DELETE SET NULL`。
- Local WebAuthn 自刪驗證通過：Playwright virtual authenticator 建立 passkey-first user `td011-mo8ftwv1`，插入 local `mcp_tokens` row 後完成 `/account/settings` 刪除流程；`POST /api/auth/account/delete` 回 200、導回 `/`、`member_role_changes.reason = 'self-deletion'` tombstone 保留、該 user 的 token count 回 0；截圖 `screenshots/local/td011-self-delete-local.png`。
- Local `.data/db/sqlite.db` compatibility DB 也已修正 query_logs / citation_records / messages FK rebind，`query_logs.mcp_token_id` 指向 canonical `mcp_tokens(id) ON DELETE SET NULL`。
- 2026-04-23 production closeout 已完成：`v0.28.12` 重新實測 passkey-only test user 自刪，`generate-authenticate-options` / `verify-authentication` / `/api/auth/account/delete` / `/api/auth/sign-out` 全部回 `200`；最終 hard redirect 回 `/`，`/api/auth/get-session` 回 `null`，首頁恢復登入文案。
- 同輪 production D1 驗證：`member_role_changes` latest row `reason = 'self-deletion'`；`"user"` / `passkey` / `mcp_tokens` 對該 test user 的 count 全為 `0`。
- TD-011 已完成收尾，Status 改為 `done`，保留條目供後續追溯。

### Problem

task 7.2 設計意圖：

> `member_role_changes` 寫入 `reason = 'self-deletion'` 後保留為 tombstone

但實際 migration 0009 給 `member_role_changes.user_id` 加上 FK 且沒有 ON DELETE 子句，SQLite 預設 NO ACTION = RESTRICT → 當存在 audit row 時，delete user row 被 DB 層阻擋。tombstone 完全無法寫入。

`mcp_tokens.created_by_user_id` 類似問題，雖然語意該是「user 刪除 → token 也失效（cascade）」，但 migration 也沒寫 ON DELETE CASCADE。

影響：

- Passkey-only user 自刪（§17.8 人工檢查）在 **production + local** 皆 500
- Audit tombstone 機制完全無效（`passkey-authentication` 的合規承諾 broken）
- Admin 用 `/api/admin/members/:userId` 刪除使用者也會撞同一顆石頭

本 session 曾套用 local-only 修正（直接 rebuild 兩個表）；後續已由 migration 0010 正規化並套用到 production D1。

### Fix approach

新 migration `0010_fk_cascade_repair.sql`（範圍於 2026-04-21 spectra-apply 兩次擴大：先擴成 5 表 rebuild 鏈，再加 query_logs 語意變更）：

1. **`member_role_changes`**：rebuild 移除 FK constraint（audit tombstone 需要在 user 刪除後仍存活，所以 `user_id` 只是純 text reference，不設 FK）。index `idx_member_role_changes_user_created` 保留。
2. **`mcp_tokens`**：rebuild 把 `created_by_user_id` 改為 `REFERENCES "user"(id) ON DELETE CASCADE`，讓 token 隨 user 刪除自動清除。
3. **`query_logs`**：rebuild 把 `mcp_token_id` 改為 `REFERENCES "mcp_tokens"(id) ON DELETE SET NULL`（若保持預設 `NO ACTION` 則 user → mcp_tokens CASCADE 會被此 FK RESTRICT，TD-011 的 bug 只會往下移動一層；TDD red 測試已證實）。observability log 保留，token 歸屬在 token 已刪除後 NULL 化。
4. **`citation_records` / `messages`**：連帶 FK re-bind 到新 `query_logs`，columns 與 ON DELETE 子句完全保持 0009 狀態。
5. 走 0007 / 0008 / 0009 的 rebuild 模式（`PRAGMA defer_foreign_keys = ON` → `*_new` + `INSERT SELECT` → children-first `DROP` → `RENAME`）。children-first DROP（`messages → citation_records → query_logs → mcp_tokens`）避免 `messages.query_log_id ON DELETE SET NULL` 在 DROP query_logs 時靜默觸發。
6. Release checklist：在 production D1 apply 前確認備份 + 五張 rebuild 表 row count 對照。

### Acceptance

- `PRAGMA foreign_key_check` 對 `member_role_changes` / `mcp_tokens` / `query_logs` / `citation_records` / `messages` 回 empty
- `PRAGMA foreign_key_list(query_logs)` 顯示 `mcp_token_id` 的 `on_delete = 'SET NULL'`
- `DELETE FROM "user" WHERE id = '<passkey-only-test-user>'` 成功（由 `/api/auth/account/delete` 觸發），audit row 保留，相關 token CASCADE 清除
- user 刪除後其 query_logs 仍存在，`mcp_token_id` 為 NULL，`query_redacted_text` / `created_at` / `channel` / `environment` 不變
- §17.8 人工檢查 local + production 皆通過
- `test/integration/passkey-self-delete.spec.ts` 新增 test case 覆蓋 audit tombstone 存在時能成功刪除 user，以及 query_logs 在 token cascade 後保留且 `mcp_token_id = NULL`

---

## TD-012 — passkey-first → link Google 被 better-auth email 檢驗擋住

**Status**: done
**Priority**: high
**Discovered**: 2026-04-21 — `passkey-authentication` §17.3 實機測試 passkey-first 帳號點 `/account/settings` 的「綁定 Google 帳號」，`/api/auth/link-social` 回 200 但 OAuth callback 回 `please_restart_the_process`，後端 log 顯示 `Failed to parse state: link.email expected string, received null`

**Location**:

- `app/pages/account/settings.vue` `handleLinkGoogle` call path
- better-auth core `parseGenericState` / `link-social` endpoint（`node_modules/better-auth/dist/api/routes/account.mjs` 約 line 148）要求 `session.user.email` 非空

**Related markers**: search `@followup[TD-012]` in repo

### Problem

better-auth `linkSocial` endpoint 在建構 OAuth state 時，把 `session.user.email` 塞進 `link.email` 欄位並用 Zod 驗證必須是 string。passkey-first 帳號（`email = NULL`）直接通不過 state parse → OAuth callback 拒絕。

這是 better-auth 設計層的限制（intent 是用 email 比對防 account takeover），無法透過 `allowDifferentEmails: true` 之類 config 繞過；config 在 parse 之後才生效。

影響：`passkey-authentication` 的 Decision 5 / §17.3 scenario「passkey-first 使用者綁 Google」**無法透過 better-auth 原生 API 實作**。

目前 workaround：已不需要。2026-04-23 已透過 `passkey-first-link-google-custom-endpoint` change 落地 custom endpoint pair，並完成 local / production 人工驗證、allowlist 升權驗證與 archive。

### Fix approach

新增 custom endpoint pair（繞開 better-auth linkSocial，自建 OAuth flow）：

1. `GET /api/auth/account/link-google-for-passkey-first`
   - `requireUserSession` + 驗 `session.user.email === null`
   - 建 OAuth state（自己的 cookie / KV key，帶 session.user.id）
   - redirect 到 Google authorization URL（用現有 `NUXT_OAUTH_GOOGLE_CLIENT_ID` 與 redirect_uri）
2. `GET /api/auth/account/link-google-for-passkey-first/callback`
   - 收 Google `code` + 自家 state
   - 用 code 換 access token + id_token（直接 fetch Google token endpoint）
   - 解 id_token 取 email / name / image
   - 檢查 email 是否已在其他 user.id 上使用 → 若 yes 回 `EMAIL_ALREADY_LINKED` 409
   - `UPDATE "user" SET email = <google-email>, image = <google-image> WHERE id = <session.user.id>`
   - `INSERT INTO account (userId, providerId='google', accountId, accessToken, idToken, refreshToken, scope, createdAt, updatedAt) VALUES (...)` 跟 better-auth schema 對齊
   - `databaseHooks.session.create.before` 下次會自動走 reconciliation（跑 allowlist 比對 → 升 admin 若符合）
   - redirect 回 `/account/settings?linked=google`
3. `app/pages/account/settings.vue` 的 `handleLinkGoogle` 改指向新 endpoint（僅當 `credentials.email === null`；否則仍用 better-auth linkSocial）

### Acceptance

- passkey-first 使用者（email=NULL）點「綁定 Google 帳號」→ OAuth 走通 → email 填入 + Google account row 建立 + passkey row 保留 → 下次登入可用 passkey 或 Google 任一
- 衝突處理：若 Google email 已屬另一 user.id → 409 UX 顯示清楚
- Allowlist reconciliation：若綁的 Google email 在 `ADMIN_EMAIL_ALLOWLIST` → 下次 session refresh 自動升 admin（既有 `session.create.before` 機制）
- `test/integration/passkey-first-link-google.spec.ts` 覆蓋 happy path + 衝突 409 + allowlist upgrade

---

## TD-013 — /account/settings 新增 passkey 缺 naming dialog

**Status**: done
**Resolved**: 2026-04-21 — `app/pages/account/settings.vue` 新增 `nameDialogOpen` / `passkeyNameInput` state + UModal（輸入 passkey 名稱 + 驗證 + 傳給 `client.passkey.addPasskey({ name })`）
**Priority**: low
**Discovered**: 2026-04-21 — `passkey-authentication` §17.2 實機驗證 Google-first 加綁 passkey，列表顯示「未命名 passkey」
**Location**: `app/pages/account/settings.vue` `handleAddPasskey`
**Related markers**: search `@followup[TD-013]` in repo

### Problem

`handleAddPasskey` 直接呼叫 `client.passkey.addPasskey()` 沒有傳 `name`，`passkey.name` 欄位留空 → 列表顯示「未命名 passkey」，多個裝置時難以辨識（尤其 revoke 誤刪風險）。

### Fix applied

加一個 naming dialog：點「新增 Passkey」不直接啟動 ceremony，先開 modal 讓使用者輸入名稱（maxlength 40，必填），確認後帶 `name` 呼叫 addPasskey。驗證失敗或空字串在 modal 內直接顯示 inline error。

---

## TD-014 — error-sanitizer 後 12 test 拋 evlog Logger not init

**Status**: done
**Resolved**: 2026-04-24 — 本地重跑 `pnpm test:integration` 已恢復全綠（72 files / 364 tests passed / 1 skipped），不再重現 `evlog Logger not initialized`
**Priority**: mid
**Discovered**: 2026-04-21 — `drizzle-refactor-credentials-admin-members` apply 階段跑 `pnpm test:integration` 發現，pre-existing 非本次引入
**Location**: 影響的 test 檔：

- `test/integration/acceptance-tc-ui-state.test.ts`（5 個 sub-test）
- `test/integration/admin-documents-route.test.ts`（3 個）
- `test/integration/dev-login-route.test.ts`（2 個）
- `test/integration/publish-route.test.ts`（2 個）

**Related markers**: search `@followup[TD-014]` in repo

### Problem

v0.25.0 commit `df49b11` 引入「全站 server API 錯誤訊息洩漏防護」的 error-sanitizer nitro plugin。該 plugin 改動了 evlog logger 的初始化時序，造成上述 12 個 integration test 在呼叫 handler 時拋出：

```
[evlog] Logger not initialized. Make sure the evlog Nitro plugin is registered. If using Nuxt, add "evlog" to your modules.
```

影響：

- `pnpm test:integration` full run 現在有 12 個紅燈（但全是 pre-existing / 非 TD-010 引入）
- CI 如果有 test gate 會被擋；production D1 端 runtime 看起來 OK（handler 仍正常執行，只是 test stub 少了 plugin）

本 TD 不在 TD-010 scope（TD-010 是 refactor drizzle query builder，與 evlog plugin 時序無關），但 apply 階段發現需登記。

### Resolution note

2026-04-24 重新執行 `pnpm test:integration`，受影響 integration suite 已不再出現 logger 初始化錯誤；目前 repo 內也沒有殘留 `@followup[TD-014]` marker。此條保留於 tech debt register 僅供追溯，不再列為 open item。

### Acceptance

- `pnpm test:integration` 全綠（除非後續有其他新的 real regression）
- 不得以 `.skip` 繞過
- TD-014 marker 在修復 PR 的 tasks 標註 @followup[TD-014]
