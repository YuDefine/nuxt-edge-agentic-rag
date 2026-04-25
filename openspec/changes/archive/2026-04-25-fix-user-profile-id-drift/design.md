## Context

- **觸發事件**：`consolidate-conversation-history-config` §7.4 人工檢查時 local dev 反覆撞到 `/api/chat` 500 `D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY`。追查發現是 `server/auth.config.ts` L487-513 `session.create.before` hook 的 `user_profiles` upsert 被 UNIQUE(email_normalized) 衝突打掉後靜默 catch，導致新 better-auth user 在 `user_profiles` 裡沒對應 row。
- **Stakeholders**：
  - 所有 web chat 使用者（依 `conversations.user_profile_id` / `messages.user_profile_id` FK 寫入）
  - admin（依 `query_logs.user_profile_id` 觀察 dashboard）
  - dev / 人工檢查 / screenshot review（local reset DB 後的首次使用）
- **Current invariants**：
  - `user_profiles.email_normalized` — `NOT NULL UNIQUE`（migration `0001_bootstrap_v1_core.sql:54`）
  - `user_profiles.id` — PRIMARY KEY，理應與 better-auth `user.id` 一對一
  - 4 個 children FK（`conversations.user_profile_id` / `query_logs.user_profile_id` / `messages.user_profile_id` / `documents.created_by_user_id`）皆為 bare `REFERENCES user_profiles(id)`，**未帶 ON UPDATE CASCADE**（SQLite 預設 NO ACTION）
- **Constraint 1**：SQLite 改 FK cascade 需要整表 rebuild（參見 `0010_fk_cascade_repair.sql` 先例，每個 child table 一次 new-table + copy + drop + rename），成本高且 touch range 大。
- **Constraint 2**：better-auth hook runtime 在 session 建立時執行，無法回傳 error UI 給使用者 — 只能 log + 決定 rethrow vs swallow。
- **Constraint 3**：Production D1 目前未重現此 bug（staff 不會手動刪 `user` row）；local dev 最易踩到，staging 次之。修復風險不能 block 已登入 production 使用者。

## Goals / Non-Goals

### Goals

- 消除 stale `user_profiles` row + 新 better-auth user.id 情境下的 `/api/chat` 500 FK error
- 在 `NODE_ENV !== 'production'` 下讓非預期 hook error 立即顯性（rethrow）
- Production catch 路徑輸出 **actionable log hint**，讓下次類似 incident 不需重讀 TD entry
- Spec 層將 `session.create.before` 的 UNIQUE 衝突行為納入 `auth-storage-consistency` 規範

### Non-Goals

- **不改 DB schema 加 ON UPDATE CASCADE**（理由見 Decision 1）
- **不改 `user_profiles.email_normalized` 為 nullable**（TD-009 獨立 scope）
- **不改 better-auth `user` 表**（bug 在我方 hook 實作，不在 upstream）
- **不處理 TD-047**（SSE ready-then-error orphan conversation，獨立 bug）

## Decisions

### 1. App-level migrate children 而非 ON UPDATE CASCADE

**選擇**：在 hook 內用 app-level transaction 逐一 UPDATE children `.user_profile_id` 後再更新 `user_profiles.id`，不改 DB FK schema。

**Alternatives considered**：

- **Schema 改 ON UPDATE CASCADE**：每個 child table 需走 new-table + copy + drop + rename（SQLite 限制），總 migration SQL 量可觀（估 300-500 行）；而且 `user_profiles` 自己的 PK UPDATE 觸發 cascade，仍然要處理 tx 語意（失敗時誰 rollback）。`0010_fk_cascade_repair.sql` 已顯示 rebuild 型 migration 的成本。**否決**。
- **每次登入檢查 stale + rewrite `user_profiles.id` + cascade via schema**：同上，schema 成本高；且此路徑只在 stale 情境觸發（非常態），為 hot path 加成本 schema 不划算。**否決**。
- **本方案（app-level migrate）**：只在 stale 情境觸發，常態 path 無額外成本；tx 語意由 drizzle `db.transaction` 保證（D1 batch statement）。**採用**。

**Why**：bug 觸發頻率低（只在 better-auth user 刪重建時），app-level 處理範圍可控；schema 改動是 Tier 3 migration，本 bug 不值得擴大爆炸半徑。

### 2. Migrate 流程用「UPDATE children → UPDATE user_profiles.id」順序

**選擇**：Transaction 內順序為：

1. `UPDATE conversations SET user_profile_id = :newId WHERE user_profile_id = :staleId`
2. `UPDATE query_logs SET user_profile_id = :newId WHERE user_profile_id = :staleId`
3. `UPDATE messages SET user_profile_id = :newId WHERE user_profile_id = :staleId`
4. `UPDATE documents SET created_by_user_id = :newId WHERE created_by_user_id = :staleId`
5. `UPDATE user_profiles SET id = :newId, role_snapshot = :finalRole, admin_source = :adminSource WHERE id = :staleId`

**Alternatives considered**：

- **DELETE stale + INSERT new**：children 會變成孤兒（FK 指向不存在的 id）。除非同時 DELETE children，否則不可行；而 DELETE children 等於丟掉歷史對話 / query log，不可接受。**否決**。
- **反過來先 UPDATE user_profiles.id 再 UPDATE children**：SQLite `NO ACTION` 會讓這一步直接 FK fail，因為 children 還指向舊 id。**否決**。
- **本方案**：先斷開 children 對 stale 的依賴，再改 stale 自己的 id，FK check 全程滿足。**採用**。

**Why**：順序由 FK 依賴決定 — children 必須先重新綁到 new id，parent 才能改。

### 3. 衝突判定：email_normalized-first 查找 + id 比對

**選擇**：hook 進入時先 `SELECT id FROM user_profiles WHERE email_normalized = :email`。

- 無 row：原 insert 路徑
- 有 row + `id === session.userId`：原 onConflictDoUpdate on id（無 migrate）
- 有 row + `id !== session.userId`：走 Decision 2 的 migrate tx

**Alternatives considered**：

- **繼續原 onConflictDoUpdate + catch UNIQUE err**：本 bug 的起點，swallow 違反 invariant。**否決**。
- **onConflictDoUpdate target: email_normalized + SET id = excluded.id**：需要 ON UPDATE CASCADE 才能讓 children 跟上（Decision 1 Non-Goal）。若無 cascade，此 UPDATE 會 FK fail。**否決**。
- **本方案**：明確查找再分支，邏輯可 unit test，catch 範圍縮小。**採用**。

**Why**：明確的 SELECT → branch 比 upsert + catch race 更 deterministic；利於單元測試覆蓋 4 條路徑。

### 4. Catch 行為 env-gate：non-production rethrow

**選擇**：hook 最外層 catch 內：

```ts
authLog.error('user_profiles sync failed', { userId, email, error, hint: '...' })
if (process.env.NODE_ENV !== 'production') throw error
// production: swallow, return (不 block login)
```

**Alternatives considered**：

- **永遠 swallow（現況）**：local 難 debug、bug 可永久藏身。**否決**。
- **永遠 rethrow**：production 若真遇 hook transient error（D1 timeout 等）直接 block login，UX 太嚴苛。**否決**。
- **本方案**：local / staging 立刻 fail fast（`NODE_ENV=development` or unset），production 保留保守行為。**採用**。

**Why**：bug 的 cost function 不對稱 — dev miss bug 成本 > prod occasional block-login；env-gate 平衡兩邊。

### 5. Log hint 用 structured fields

**選擇**：catch 內 log 額外帶 `hint: 'Stale user_profiles row may exist with same email_normalized but different id; app-level migrate likely failed; inspect user_profiles + children FKs.'`。不印明文 email（取 `emailNormalized.slice(0, 3) + '***'` 或不印）。

**Alternatives considered**：

- **只 log error.message**：下次 incident 又得從頭讀 hook。**否決**。
- **印完整 email**：PII log 風險。**否決**。
- **本方案**：structured + redacted。**採用**。

## Risks / Trade-offs

- **[Risk] hook 在 production 首次 log 到新 hint 可能觸發誤報**
  → Mitigation：deploy 前先搜尋 production log 1 週的 `user_profiles sync failed` 計數；若 > 0 則先定位真因（可能不是 stale row），確認無 false positive 再 flip。
- **[Risk] app-level migrate tx 在 D1 failure 場景下部分 children UPDATE 成功、user_profiles.id UPDATE 失敗**
  → Mitigation：drizzle `db.transaction` 對 D1 保證原子性（底層 `BEGIN ... COMMIT`）；unit test 明確 stub mid-tx throw 驗證 rollback 行為；production 若真中斷則 log 帶 hint，下次登入重試（冪等：migrate 條件為 `WHERE email_normalized = ? AND id != ?`，成功後不再觸發）。
- **[Risk] `NODE_ENV` 在 Cloudflare Workers runtime 非預期值（undefined 或 'preview'）**
  → Mitigation：判斷邏輯為「非 'production' 都 rethrow」— 保守側偏向 fail fast，preview / staging 反而是期望 rethrow 的地方。明確文件化 `NODE_ENV` semantics 在 `docs/decisions/`。
- **[Risk] 測試 coverage 漏掉真實 better-auth hook runtime 差異**
  → Mitigation：proposal 明說不寫 integration test；local 實戰驗收（Acceptance 清單）補位，archive 前必做。

## Migration Plan

- **Deploy**：single code deploy，無 DB migration 動作。flag 無需建。
- **Rollback**：revert commit 即可（hook 不依賴持久化 state；revert 後 stale row 仍會被 swallow，退回原行為 — 仍是 bug，但不會造成資料損害）。
- **Observability**：archive 後 1 週內 `wrangler tail` 搜尋 production log 關鍵字 `user_profiles sync failed`，驗證 hint 是否出現 + 出現頻率。

## Open Questions

- **Q1**：drizzle `db.transaction` 在 NuxtHub + D1 runtime 下的實作是否支援 SAVEPOINT（partial rollback）？若不支援，migrate tx 只能全成功或全失敗，對本 change 足夠；但若未來要加 per-table retry，需要 re-evaluate。
- **Q2**：`NODE_ENV=preview`（Cloudflare Pages preview）下的預期行為？目前設為 rethrow（非 production 都 rethrow），確認使用者是否同意。
- **Q3**：production catch 路徑是否要加 **`Sentry` / evlog 事件分類**（例如 `event: 'auth.user_profiles.sync_failed'`）方便後續 alert 搜尋？當前 starter pack 無 Sentry integration，先用 `log.error` 結構化 field，未來可升級。
