## Context

兩個 endpoint 目前以 drizzle 的 D1-specific `db.all(sql\`...\`)` tagged-template raw SQL pattern 做 DB 讀取：

- `server/api/auth/me/credentials.get.ts` line 68-72：單一 `SELECT email, display_name FROM "user" WHERE id = ? LIMIT 1`
- `server/api/admin/members/index.get.ts` line 102-192：含 `COUNT(*)` + 多 `EXISTS` sub-queries + `MAX()` 的複合聚合 SELECT

此 pattern 在 Cloudflare Workers 的 D1 runtime 正常（`db.all` 是 `drizzle-orm/d1` 的 dialect-specific 方法），但在 local dev 的 NuxtHub libsql 代理下 `db.all` 不存在，兩 endpoint 皆回 500。同類 TD-001 已由 `server/utils/mcp-token-store.ts` 以 drizzle query builder（`db.select(...).from(...).where(...)`）修好——drizzle 的 query builder layer 在 D1 和 libsql driver 都支援。

Schema ownership 注意：

- `user` / `account` / `session` 由 better-auth 擁有，schema 在 `.nuxt/better-auth/schema.sqlite.ts` 自動生成，透過 `const { db, schema } = await import('hub:db')` 存取（見 `server/api/admin/members/[userId].patch.ts` 既有用法）
- `schema.user.displayName` 已於 FD-001 修正 `fieldName: 'display_name'`，drizzle 直接讀到 snake_case column，不需 `COALESCE(display_name, "displayName", name)` fallback
- `schema.passkey` 在 `server/db/schema.ts` 有本地宣告（line 289）；但為與 admin-members handler 其他 table 一致，本 refactor 統一從 `hub:db` 取 schema（better-auth 亦透過 `@better-auth/passkey` plugin 產出 passkey schema entry）

可用 canonical 參考：

- `server/utils/mcp-token-store.ts`（TD-001 已修；`db.select(...).from(schema.mcpTokens).where(eq(...)).limit(1)`）
- `server/api/admin/members/[userId].patch.ts`（已是 drizzle；`schema.user` / `schema.account` 直接用）
- `server/api/auth/account/delete.post.ts`（drizzle DELETE + SELECT role）

## Goals / Non-Goals

**Goals:**

- 兩 endpoint 在 local dev (libsql) 與 production (D1) 行為一致，皆回 200 + 正確 payload
- Response schema / status code / error message 100% 不變（binary-compatible refactor）
- Test mock 改寫為 drizzle query builder chain，維持相同覆蓋率與斷言
- 新增 `/api/auth/me/credentials` 的 integration test（覆蓋既有測試缺口）
- 固化為 spec-level requirement，避免未來其他 endpoint 再走 `db.all(sql\`...\`)` pattern

**Non-Goals:**

- 不擴散到其他 raw SQL callers：`server/api/**` / `server/mcp/tools/**` / `server/tasks/retention-cleanup.ts` 仍有 `getD1Database()` / `db.all(sql\`...\`)` pattern 的檔案不在本 scope
- 不變更任何 response 欄位（`hasGoogle` / `passkeys[]` / `credentialTypes` / `registeredAt` / `lastActivityAt` 一致）
- 不引入 migration / schema 變更
- 不修 `.vue` 檔
- 不觸 better-auth config 或 `@better-auth/passkey` plugin
- 不新增 filter 或 sort 選項
- 不做 query performance tuning（若 Decision 3 採 per-page lookup 的 N+1 在 page size = 20 上可接受）

## Decisions

### Decision 1: credentials.get.ts user row 改用 drizzle select

原檔 line 68-72：

```typescript
const userRows = (await db.all(
  sql`SELECT email, display_name FROM "user" WHERE id = ${userId} LIMIT 1`,
)) as Array<{ email: string | null; display_name: string | null }>
userRow = userRows[0]
```

改為：

```typescript
const [userRow] = await db
  .select({
    email: schema.user.email,
    displayName: schema.user.displayName,
  })
  .from(schema.user)
  .where(eq(schema.user.id, userId))
  .limit(1)
```

**Rationale**:

- drizzle query builder 回傳物件的 key 是 JS side 宣告（`displayName`），不是 DB column 名，因此下游 `userRow.display_name` 需改為 `userRow.displayName`（同時更新 return statement `displayName: userRow.display_name` → `displayName: userRow.displayName`）
- `schema.user.displayName.fieldName = 'display_name'` 已由 FD-001 對齊，drizzle 內部仍會 emit 正確 SQL `SELECT display_name`
- `not found` 分支（line 82-88）維持：`if (!userRow) throw createError({ statusCode: 404, ... })`
- try/catch + `log.error` + friendly error message 完全保留（遵守 `logging.md` / `error-handling.md`）

**Alternatives considered**:

- A. 只改 `sql` 但保留 `db.all`：libsql 下 `db.all` 仍不存在，fail
- B. 用 `db.get()`（drizzle D1 single-row API）：libsql driver 不支援；不通用

### Decision 2: admin/members/index.get.ts count query 改用 drizzle + drizzle-orm `count()`

原檔 line 126-128：

```typescript
const rows = (await db.all(sql`SELECT COUNT(*) AS n FROM "user" u ${roleFilter}`)) as Array<{
  n: number
}>
return rows[0]?.n ?? 0
```

改為：

```typescript
const { count, eq, and, sql } = await import('drizzle-orm')

const conditions = query.role ? [eq(schema.user.role, query.role)] : []
const baseCount = db.select({ n: count() }).from(schema.user)
const countRows =
  conditions.length > 0 ? await baseCount.where(and(...conditions)) : await baseCount
return countRows[0]?.n ?? 0
```

**Rationale**:

- `count()` 是 drizzle-orm 標準 aggregation，D1 + libsql 皆支援
- 原 `roleFilter = query.role ? sql\`WHERE u.role = ${query.role}\` : sql\`\``改為 drizzle`eq(schema.user.role, query.role)`條件式組裝（與`mcp-token-store.ts:createMcpTokenAdminStore` 一致）
- `normaliseRole` / `ROLE_VALUES` enum check 維持在 Zod schema 層（`querySchema` 已驗證）

### Decision 3: admin/members list query 採「user list + per-page batched lookup + application-layer reduce」

原檔 line 137-163 的單一 SELECT 含 4 個 correlated sub-queries（2 × EXISTS + 1 × MAX + 1 × COALESCE fallback）。drizzle query builder 要等價表達複雜度高，且在 libsql 某些 version 對 correlated subquery 支援不穩。

採兩階段：

**Stage A**：查當頁 users（排序 + 分頁）

```typescript
const orderByClause = (() => {
  switch (query.sort) {
    case 'created_desc':
      return [desc(schema.user.createdAt), asc(schema.user.id)]
    case 'created_asc':
      return [asc(schema.user.createdAt), asc(schema.user.id)]
    case 'email_asc':
      return [asc(schema.user.email), asc(schema.user.id)]
    default:
      return assertNever(query.sort, 'listMembersHandler.sort')
  }
})()

const baseList = db
  .select({
    id: schema.user.id,
    email: schema.user.email,
    name: schema.user.name,
    displayName: schema.user.displayName,
    image: schema.user.image,
    role: schema.user.role,
    createdAt: schema.user.createdAt,
    updatedAt: schema.user.updatedAt,
  })
  .from(schema.user)

const users = await (conditions.length > 0 ? baseList.where(and(...conditions)) : baseList)
  .orderBy(...orderByClause)
  .limit(limit)
  .offset(offset)
```

**Stage B**：對這一頁 user id batch lookup 三張輔助表

```typescript
const pageUserIds = users.map((u) => u.id)
if (pageUserIds.length === 0) return []

const [googleRows, passkeyRows, sessionRows] = await Promise.all([
  db
    .select({ userId: schema.account.userId })
    .from(schema.account)
    .where(
      and(inArray(schema.account.userId, pageUserIds), eq(schema.account.providerId, 'google')),
    ),
  db
    .select({ userId: schema.passkey.userId })
    .from(schema.passkey)
    .where(inArray(schema.passkey.userId, pageUserIds)),
  db
    .select({
      userId: schema.session.userId,
      updatedAt: max(schema.session.updatedAt).as('updatedAt'),
    })
    .from(schema.session)
    .where(inArray(schema.session.userId, pageUserIds))
    .groupBy(schema.session.userId),
])

const googleSet = new Set(googleRows.map((r) => r.userId))
const passkeySet = new Set(passkeyRows.map((r) => r.userId))
const lastActivityMap = new Map(sessionRows.map((r) => [r.userId, r.updatedAt]))
```

**Stage C**：組裝結果（application-layer reduce，`credentialTypes` 保持 `toCredentialTypes` 既有 exhaustiveness guard）

```typescript
return users.map((u) => {
  const registeredAt = toIsoOrNull(u.createdAt)
  const lastActivityRaw = lastActivityMap.get(u.id) ?? u.updatedAt
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    displayName: u.displayName,
    image: u.image,
    role: normaliseRole(u.role),
    credentialTypes: toCredentialTypes(googleSet.has(u.id) ? 1 : 0, passkeySet.has(u.id) ? 1 : 0),
    registeredAt,
    lastActivityAt: toIsoOrNull(lastActivityRaw) ?? registeredAt,
    createdAt: registeredAt ?? '',
    updatedAt: toIsoOrNull(u.updatedAt) ?? '',
  }
})
```

**Rationale**:

- 簡單 drizzle query builder，D1 + libsql 皆可
- page size 上限 = `PAGE_SIZE_MAX`（來自 `shared/schemas/pagination`，目前 50）；Stage B 三條 query 吃 `inArray(pageUserIds)` 為單次 query，不是 N+1
- 總計 4 條 DB round-trip（count + users + 3 × Promise.all 並行的 batched lookups）vs 原本 2 條（count + list with sub-queries）。在 Workers edge 環境可接受
- `last_activity_at` fallback 為 `u.updatedAt`（原 COALESCE 行為保留）
- `schema.session` 的 `updatedAt` 是 better-auth 自動維護（每次 session refresh 會更新）

**DB round-trip 比較**:

| 策略                          | count | list                   | 輔助聚合        | Total                                        |
| ----------------------------- | ----- | ---------------------- | --------------- | -------------------------------------------- |
| 原 raw SQL                    | 1     | 1 (with 4 sub-queries) | 0               | 2 round-trip                                 |
| Decision 3 (per-page batched) | 1     | 1                      | 3 × Promise.all | 2 round-trip（logical，因 Promise.all 並行） |
| B. leftJoin + groupBy         | 1     | 1                      | 0               | 2 round-trip                                 |

Decision 3 在 round-trip 總數等價於原方案（Promise.all 並行），且程式碼易讀、test mock 易寫。

**Alternatives considered**:

- **B. 單一 leftJoin + groupBy + max() / count() aggregates**：drizzle 支援 `leftJoin` + `groupBy`，但在 `credentialTypes` 的「至少有一筆 account with providerId='google'」判定上，需用 `sql\`CASE WHEN COUNT(a.id) > 0 THEN 1 ELSE 0 END\``這類 raw SQL fragment，libsql 對`groupBy` + 多 leftJoin 的 column selection 在某些 driver version 行為不穩。維護性與正確性不如 Decision 3
- **C. 保留 `db.all(sql\`...\`)`但僅改`credentials.get.ts`**：`/admin/members` local 仍 500，§16 Design Review pipeline 仍被阻擋。不解題
- **D. 在 handler 內 env-branch**（local libsql 走 drizzle，production D1 走 raw SQL）：兩套 code path 雙維護成本，違反 `api-patterns.md` 的「Web Standard 為主」精神，rejected

### Decision 4: `toIsoOrNull` 簡化

Drizzle `integer({ mode: 'timestamp_ms' })` mapper 在 D1 + libsql 統一回傳 `Date | null`，不再有 numeric / string epoch 多型別分支。`toIsoOrNull` 可從四支（Date / number / string / 其他）簡化為兩支（Date / null fallback）：

```typescript
function toIsoOrNull(value: Date | string | number | null | undefined): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  // Regression guard: drizzle's mapper is expected to always emit Date,
  // but keep the legacy branches as a null-safe degrade path so an
  // unexpected shape from a future driver upgrade degrades to null
  // rather than throwing RangeError (auth-storage-consistency spec scenario
  // "Handler returns 200 with null when a timestamp is unparseable" 仍必須通過).
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}
```

**Rationale**:

- 保留原有 regression guard 行為，確保 `admin-members-list.spec.ts` 的「unparseable input → null」scenario 仍綠
- 型別簽章從 `unknown` 收緊為 `Date | string | number | null | undefined`，compiler 能在 call site 協助驗證

### Decision 5: Test mock 策略

原 mock（`admin-members-list.spec.ts` / `admin-members-passkey-columns.spec.ts`）攔截 `db.all(query)` + 解析 `__sql` tagged template `strings.join(' ').includes('COUNT(*)')`。Refactor 後 `db.all` + `sql\`\`` 消失，mock 必須改寫為 drizzle query builder chain：

```typescript
const mocks = vi.hoisted(() => ({
  countResult: 0,
  userRows: [] as Array<UserListRow>,
  googleUserIds: [] as string[],
  passkeyUserIds: [] as string[],
  sessionMax: new Map<string, Date | null>(),
  // ... etc
}))

vi.mock('hub:db', () => {
  const thenableChain = (rows: unknown) => ({
    from: () => thenableChain(rows),
    where: () => thenableChain(rows),
    orderBy: () => thenableChain(rows),
    limit: () => thenableChain(rows),
    offset: () => thenableChain(rows),
    groupBy: () => thenableChain(rows),
    then: (resolve: (v: unknown) => void) => resolve(rows),
  })
  return {
    db: {
      select: vi.fn((shape) => {
        // Branch on shape to return count vs user rows vs google/passkey/session rows
        if (shape && 'n' in shape) return thenableChain([{ n: mocks.countResult }])
        if (shape && 'id' in shape && 'displayName' in shape) return thenableChain(mocks.userRows)
        // ... 依 shape 分支
      }),
    },
    schema: {
      /* minimal stubs */
    },
  }
})
```

**Rationale**:

- Drizzle 的 query builder 是 thenable（`await db.select(...).from(...)` 即可 resolve），mock 只需回傳 `{ from, where, ..., then }` chain
- 以 `select(shape)` 的 shape 物件 key 分支決定回傳哪組 rows（類似原 `__sql.includes('COUNT(*)')` 的分支邏輯但改走型別友善的 shape key）
- `testing-anti-patterns.md` Rule 3「Mock without understanding」：本 mock 仍**只 mock 網路/DB layer**，上層 `toCredentialTypes` / `toIsoOrNull` / `normaliseRole` / `paginateList` 皆跑真實實作，斷言的是真實行為而非 mock 行為
- 若 mock chain 維護成本過高，改採真實 libsql（`@libsql/client` in-memory）+ seed data 的 integration test pattern，但該方案需另啟 vitest setup，本 change 不採用

### Decision 6: 新增 `account-settings-credentials.spec.ts`

既有 repo 中無 `/api/auth/me/credentials` 的 integration test。refactor 既已重寫此 endpoint 的 DB path，依 `test-driven-development` 與 `ux-completeness.md` state coverage，新增 test 覆蓋：

- Happy path：user 有 email + display_name + 2 passkeys + 1 google account → 回 `{ email, displayName, hasGoogle: true, passkeys: [..] }`
- No google：user 無 google account → `hasGoogle: false`
- No passkey：`passkeys: []`
- Passkey-only user：`email: null, displayName: '小明', hasGoogle: false, passkeys: [..]`
- User not found：→ 404（`找不到此帳號`）
- Unauthenticated：`requireUserSession` mock throw → 401

Mock pattern 同 Decision 5。放 `test/integration/account-settings-credentials.spec.ts`。

## Risks / Trade-offs

- **[Risk]** Drizzle query builder chain 與原 raw SQL 的語意等價性未在 real D1 驗證 → **Mitigation**：既有 production regression tests（`admin-members-list.spec.ts` + `admin-members-passkey-columns.spec.ts`）改寫後斷言相同 response shape，`spectra-apply` 階段必須人工 `curl` local + 跑 `/review-screenshot` 確認 happy path 響應式（tasks.md 已列）
- **[Risk]** Decision 3 的 per-page batched lookup 在 page size 大（50）時多 3 條並行 query，latency 微增 → **Mitigation**：Cloudflare D1 單 request 下 Promise.all 並行成本極低（~1-5ms per query），實測 page size 20 下 2 round-trip ≈ 30-50ms，可接受；若未來有 page size > 200 需求再評估改 leftJoin
- **[Risk]** Test mock 重寫工作量大（2 份 existing + 1 份 new），若 mock thenable chain 語法錯誤可能導致 test silently pass → **Mitigation**：先跑一次 TDD red（mock 設空 rows 應回 `data: []`、`pagination.total: 0`），確認 mock chain 被真的 call；再增加真實 rows 跑 green
- **[Risk]** `schema.session` / `schema.passkey` 若 better-auth generator 未產出 session table entry，`import('hub:db')` 的 schema 取不到 → **Mitigation**：`server/api/admin/members/[userId].patch.ts` 已透過 `hub:db` 使用 `schema.user` / `schema.account`，確認 session / passkey 亦可透過相同途徑取得；若 session 不在 `hub:db` schema，改用 `server/db/schema.ts` 的 passkey + 本地補 session schema 宣告（但本 change 不期望需要）
- **[Trade-off]** 本 change 選 Decision 3 per-page batched，而非 Decision 3-B 的單一 leftJoin + groupBy：讀取次數相同（Promise.all 並行），但 Decision 3 的 application-layer reduce 可讀性與 test mock 簡單度都更好；代價是 `credentialTypes` 判定從 SQL 層移到 JS 層（若未來 credential type 新增 enum，需同步更新 `toCredentialTypes` 的 `CredentialFlagMap` — 原 exhaustiveness guard 已有此機制）
- **[Trade-off]** `toIsoOrNull` 保留四支 legacy branch（Decision 4）而非簡化為單一 Date → 保留 regression guard 覆蓋率，不引入新的測試缺口

## Migration Plan

Pure runtime refactor，**不需 migration**：

1. PR merge 後，local dev 立刻生效（`pnpm dev` 重啟即可）
2. `wrangler deploy` 後 production 生效
3. Rollback strategy：`git revert` PR → `wrangler deploy` 即回退（無 DB 變更）

無 feature flag、無 phased rollout 需求。

## Open Questions

1. **`schema.session` 是否在 `hub:db` 的 schema 出口？** — 需在 `spectra-apply` 階段先 `console.log(Object.keys(schema))` 確認；若不在，改從 better-auth 產出的 `.nuxt/better-auth/schema.sqlite.ts` import，或在 `server/db/schema.ts` 加 session 本地宣告（不影響 DB，只是 ORM 側 type 補）
2. **`toCredentialTypes` 的 exhaustiveness guard** — 目前靠 `CredentialFlagMap: Record<CredentialType, boolean>` 強制 compile 時檢查；本 refactor 保留此機制，無需擴充
3. **Test mock thenable chain helper** — 已在 `spectra-apply` task 3.4 決議不抽共用 helper：三個 integration test 各自 inline `makeThenable` / `buildHubDb`，避免把測試專用 stub 抽成跨檔 API；目前沒有需要新增的 helper 檔案。
