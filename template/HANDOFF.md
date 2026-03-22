# Handoff

## Context

**2026-04-20 evening**：一個大 session 推完 Phase 1+2，archive 了 `tc-acceptance-followups` + `deployment-manual`。但 `fix-better-auth-timestamp-affinity` Phase 2 的 migration 0007 踩到 Critical bug，停在那裡。

## Committed state

- `v0.18.3`（tag local 已建）— member-perm Phase 5 UI + responsive Phase B layouts + admin UI copy refactor（藏 env var 名）+ fix-better-auth-timestamp-affinity Phase 1 止血（admin members list 不再 500）
- Production 跑在 `v0.18.2`（v0.18.3 尚未 `wrangler deploy`）
- Archived changes：
  - `openspec/changes/archive/2026-04-20-tc-acceptance-followups/`
  - `openspec/changes/archive/2026-04-20-deployment-manual/`

## In Progress（下 session 接手）

### [high] Migration 0007 阻塞 — 需要真實 D1 實測

**Context**：migration 0007 是 `fix-better-auth-timestamp-affinity` Phase 2（table rebuild user + account，TEXT→INTEGER affinity）。

**Critical 發現**（2026-04-20 `/commit` code-review 攔下）：FK=ON runtime 下 `DROP TABLE "user"` 被 `SQLITE_CONSTRAINT_FOREIGNKEY` 擋死。三個解法主線都驗過不靠譜：

| Option                                                 | 結論                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. `PRAGMA foreign_keys = OFF` 前綴                    | SQLite 標準 recipe，本機 FK=ON 下實測可過；**但 D1 文件寫不支援此 PRAGMA**（需真實驗證）                                                                          |
| B. Rebuild 所有 FK children 一次                       | children `_new REFERENCES "user"` 由 name resolution 處理，DROP 舊 user 仍被擋                                                                                    |
| C. `PRAGMA legacy_alter_table = ON` + rename-to-legacy | SQLite docs 說此 pragma 阻止 RENAME 改寫子表 FK，**但 sqlite 3.51 實測結果與 docs 不符**（pragma 設 1 但 FK refs 仍被改寫；RENAME 自身觸發 FK constraint failed） |

**Draft 位置**：

- `openspec/changes/fix-better-auth-timestamp-affinity/drafts/migration-0007.sql.draft`（~235 行，完整 inline 註解 + dry-run checklist + rollback plan）
- `openspec/changes/fix-better-auth-timestamp-affinity/drafts/verify-auth-storage-consistency.sh.draft`（preflight + post-apply 驗證，3 modes）

**下個 session 要做的事（依序）**：

1. **驗證 D1 PRAGMA 支援度**（這是關鍵分歧點）

   ```bash
   # 用 wrangler 真實 D1（不是 sqlite3 CLI）測：
   wrangler d1 execute agentic-rag-db --local --command "PRAGMA foreign_keys = OFF; PRAGMA foreign_keys"
   ```

   - 若 `foreign_keys` 回 `0` → D1 支援 `foreign_keys = OFF`，走 Option A（最簡單）
   - 若 D1 reject 該 PRAGMA → 走 Option B 但需進一步研究子表 rebuild 順序 trick
   - 同步確認 `wrangler d1 migrations apply` 是否在 implicit transaction 內執行（這影響 `defer_foreign_keys` 行為）

2. **根據實測結果重寫 migration 0007**
   - 拿 drafts/migration-0007.sql.draft 為起點
   - 改頭尾 PRAGMA 段落 + 更新 release checklist 註解
   - 重跑 `wrangler d1 execute agentic-rag-db --local` apply 一次 → 若無 error 再驗證 column affinity + FK integrity

3. **完成 fix-better-auth-timestamp-affinity 剩餘 tasks**（§2.6 之後）
   - §2.6（重寫後重跑 code-review agent）
   - §2.7（`/commit` migration 檔）
   - §2.8（安排部署窗口，Phase 1 穩定 24h+ 後 = 本週末之後）
   - §2.9（production apply）
   - §2.10 + §3（Phase 3 endpoint cleanup：把 Phase 1 的 defensive parser 拿掉，回歸 drizzle 原生 mapper）

### [mid] Phase 3 Design Review（兩條 change 的 §10 合跑）

**member-and-permission-management** + **responsive-and-a11y-foundation** 都卡在 §10 Design Review：

- `.impeccable.md` check / create（`/impeccable teach` 若無）
- `/design improve` 針對：
  - `app/pages/admin/members/**`
  - `app/pages/admin/settings/guest-policy.vue`
  - `app/pages/account-pending.vue`
  - `app/components/admin/members/**`
  - `app/components/chat/GuestAccessGate.vue`
  - `app/layouts/default.vue` / `chat.vue`
  - `app/pages/index.vue` signed-in 分支
- Design Fidelity Report 修到 0 DRIFT
- `/audit` Critical = 0
- `review-screenshot` agent 三斷點截圖（xs 360 / md 768 / xl 1280）
- responsive-and-a11y §5.6 + §9.4 三斷點截圖存 `screenshots/responsive-baseline/{xs,md,xl}/`
- responsive-and-a11y §8.3 dummy propose 驗證（Design Review template 兩新 checkbox inherit 是否正確）

**檔案要點**：兩條 change 共享 `default.vue` / `chat.vue`，Phase 2 已合併改過，Design Review 可一次跑完不必分開。

### [mid] 人工檢查（staging 驗證）

**member-and-permission-management §11**（10 項）— Admin UI 操作、guest policy 切換、OAuth 降級、MCP role gate 等。
**responsive-and-a11y §11**（10 項）— iPhone SE / iPad Mini / 桌機實測、鍵盤 walkthrough、色弱模擬。

**staging** `4.1 / 4.2 / 4.3 的回填\*\* — deployment-manual archive 時已標 deferred，真正部署後回填到 archive 副本（archive 後修 ok）。

### [low] 其他 tail

- `tc-acceptance-followups §7.3-7.5 + §8.3`：archive 時已 DEFERRED / SKIP，staging 部署流程演練時順手回填
- Phase 1 endpoint `toIsoOrNull` 移除（§3.3）— 等 migration 0007 apply 完再做

## Known gotchas

1. **本機 sqlite3 CLI ≠ D1 runtime**：預設 FK 行為不同（CLI 預設 OFF、D1 預設 ON）；PRAGMA 支援集合也不同。Schema migration 的 dry-run **必須**用 `wrangler d1 execute --local`（miniflare D1），不能只靠 sqlite3
2. **`legacy_alter_table` pragma 不可靠**：sqlite 3.51 實測與 docs 不符，不要依賴這個 workaround
3. **`defer_foreign_keys` 不能救 DROP**：它只 defer row-level FK 到 COMMIT，對 DDL-time DROP parent 無效
4. **Phase 1 endpoint `toIsoOrNull` 是臨時止血**：靠 `sql<>` raw read 繞開 drizzle timestamp_ms mapper；migration 0007 apply 後應回歸原生 drizzle behavior
5. **Production 版號**：`v0.18.2`（包含 Phase 1 endpoint fix、CSRF 路徑修正、members list hotfix）。`v0.18.3` tag local 已建但**未 wrangler deploy** — 下個 session 確認內容 OK 後需 `pnpm build && pnpm exec wrangler --cwd .output deploy`

## References

- `openspec/changes/fix-better-auth-timestamp-affinity/proposal.md` — root cause + 3-phase 計畫
- `openspec/changes/fix-better-auth-timestamp-affinity/design.md` — D1 限制與 SQLite recipe 考量
- `openspec/changes/fix-better-auth-timestamp-affinity/tasks.md` — §2.6 第二輪 Critical 註記
- `openspec/ROADMAP.md` — 4 條 active changes 現況
- `server/api/admin/members/index.get.ts` — Phase 1 止血實作
- Production D1 backup：`tmp/prod-backup-pre-affinity-fix.sql`（gitignored，但本機還在）

## Next Steps 建議順序

1. [high] D1 PRAGMA 實測 → 確定 migration 0007 策略
2. [high] 重寫 migration 0007 + verify script → §2.6 重走 code-review
3. [mid] Phase 3 Design Review（兩條 change 合跑）
4. [mid] staging 人工檢查
5. [mid] `v0.18.3` deploy（若 Phase 3 Design Review 發現問題需補，bump 到 v0.18.4）
6. [low] migration 0007 production apply + endpoint cleanup
