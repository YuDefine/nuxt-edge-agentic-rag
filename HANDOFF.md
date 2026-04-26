# Handoff

## In Progress

- 無 active spectra change（TD-040 implementation 已 ship 於 v0.51.0；
  TD-009 implementation 已 revert，code 退回 working tree 暫不 active）
- TD-040 / TD-009 兩個 spectra change 仍在 `openspec/changes/` 下，
  **人工檢查 task 9.x / 7.x 未跑**（TD-040 雖已 production deploy 但
  人工檢查需使用者親自跑，不能 agent 代勾）
- **`main-v0.0.54-acceptance` 第一輪已完成**（2026-04-26）：production 35
  筆 seed acceptance fixture 跑出延遲與治理路徑統計，已回填 `local/reports/
archive/main-v0.0.54-working.md` 與 `main-v0.0.54-draft.md` 表 47-A，
  evidence 在 `local/reports/notes/main-v0.0.54-acceptance-latency-run-20260426.md`。
  第二輪重測待 TD-060 解（retrieval 索引提升）後由人重跑。

## Blocked

無

## Next Steps

優先序由高至低：

1. **TD-040 production verification（高）** — v0.51.0 production deploy
   已成功，請跑人工檢查 task 9.1-9.4：
   - 9.1 local `pnpm dev` 跑 admin 流程：建 token → 用 token 對 `/mcp` 跑
     `tools/list`（建 DO session）→ admin revoke token → wrangler tail /
     evlog 觀察 cascade cleanup log
   - 9.2 local 後續驗證：對該 sessionId 直接 fetch DO → storage 應為空
   - 9.3 production deploy 後對測試 token 跑同流程，wrangler tail 觀察
     cascade cleanup 成功日誌
   - 9.4 production 觀察 7 天，確認 (a) 既有 token revoke flow 不受影響、
     (b) 無 HMAC verify failure 噪音（evlog `mcp.invalidate.verify_failed`
     計數 = 0）、(c) 無 DO error spike

2. **TD-060 production AutoRAG retrieval_score 不足（高）** — `main-v0.0.54-
acceptance` 35 筆 production 樣本顯示 `retrieval_score` 平均 0.32–0.44，
   全低於 `directAnswerMin=0.7`，治理層 100% 走 `no_citation_refuse` 路徑。
   先排查方向：(a) 索引文件主題與 seed prompts 對應度、(b) thresholds 校正
   到實際分布、(c) chunking 重切。完整 fix approach 與 acceptance 見
   `docs/tech-debt.md` TD-060。**這條解了才有第二輪 main-v0.0.54-acceptance
   重測的意義**

3. **TD-061 production query_logs 重測 pipeline_error 28.6%（高）** — `main-
v0.0.54-acceptance` r2 重測批次 10 筆連續觸發 `decision_path=
pipeline_error`。先抓對應 query_log id 的 evlog wide events 找 stack；
   再 local 重現連 5 次同 prompt 看是否 stateful failure。完整 acceptance
   見 `docs/tech-debt.md` TD-061。**真實使用者短時間 retry 約每 4 個就 1
   個拿到 pipeline_error，影響 production UX**

4. **修 docs production deploy（中）** — 本次 v0.51.0 production deploy
   workflow 整體標 failure 是因為 `deploy-docs-production` job fail：

   ```
   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vue' imported from
   docs/.vitepress/.temp/verify_RETENTION_REPLAY_CONTRACT.md.js
   ```

   App 部分（`deploy-production` + `smoke-test`）已綠，App v0.51.0 已上
   production。Docs build 失敗是 dep bump（@nuxt/ui 4.6.1→4.7.0 / vitepress
   等）副作用，需獨立修：
   - 看 `docs/.vitepress/config.ts` / `package.json` 是否需顯式宣告 `vue`
     dependency
   - 或評估升 vitepress 版本看是否有相容 fix
   - 修好後重 deploy（可 `gh workflow run deploy.yml --ref v0.51.0`
     重觸發，或下次 push 順便修）

5. **TD-009 重做（中-高）** — 已 revert 於 commits `ab6a86b` + `8278d38`，
   code 已不在 main。需要重新評估 D1 wrangler migration 行為：
   - **Root cause 待確認**：D1 staging 報 `no such table: main.source_chunks`，
     但 D1 wrangler 沒給足夠 trace
   - **可能解法 A**：把 0016 的 FK 改回 `_v16 → _v16` pattern（仿 0010 的
     `_new → _new`），依靠 D1 RENAME 自動 rewrite。但 libsql `legacy_alter_table=1`
     預設不 rewrite，需驗 `PRAGMA legacy_alter_table = OFF` 是否在 libsql work
   - **可能解法 B**：先用 wrangler 本機 D1 emulator 驗證 0016（`pnpm wrangler
d1 migrations apply <db> --local`），確認 D1 行為再 ship staging
   - **可能解法 C**：把 0016 拆成更小的 atomic migration（不 cascade 8 表，
     用 `ALTER TABLE ADD COLUMN` + 多階段 backfill），但這對 schema 改動
     會更慢、需多個 migration file
   - design / tasks 仍在 `openspec/changes/passkey-user-profiles-nullable-email/`
     下完整保留，可重新 unpark + apply

6. **TD-040 archive（低）** — 人工檢查 9.x 通過後跑 `/spectra-archive`，
   spec delta 合併進 `openspec/specs/oauth-remote-mcp-auth/spec.md` +
   `docs/tech-debt.md` 把 TD-040 改 done

7. **TD-057 evlog wide event lifecycle 警告**（mid）— production wrangler
   tail 已重現，影響 SSE 真實錯誤可觀察性，獨立 change

8. **TD-056 judge 模型 max_completion_tokens 200 截斷**（low）— 特定
   query 觸發 pipeline_error，persist-refusal 已 cover UX

9. **TD-058 user_profiles 6 條 orphaned rows**（low）— TD-053 立即驗收
   附帶發現，可考慮加掛 `user_profiles.id REFERENCES user(id) ON DELETE
CASCADE`，但 better-auth 自刪 user 順序敏感需 spike

10. **第二輪 main-v0.0.54-acceptance 重測（高，依賴 TD-060 / TD-061）** —
    TD-060 retrieval 提升到 ≥ 0.7 後，重跑 33-50 筆 fixture 對 production
    （或新建 staging 索引），補入 Judge 觸發率、引用正確率、回答正確率、
    policy classifier precision。**結果寫進 `local/reports/notes/main-
v0.0.54-acceptance-latency-run-{date}.md` 第二輪 evidence note**，並
    更新表 47-A 第二輪欄位，不覆蓋第一輪

## 注意事項

- **TD-040 已 production live**：`MCPSessionDurableObject.fetch()` 開頭
  加了 `X-Mcp-Internal-Invalidate` HMAC bypass；admin
  `/api/admin/mcp-tokens/[id].delete` 加了 best-effort cascade cleanup。
  HMAC trust anchor 是 `NUXT_MCP_AUTH_SIGNING_KEY`（既有），無新 secret
- **TD-009 失敗教訓**：local libsql `:memory:` 跑 0016 全綠，但 D1 wrangler
  migration apply 失敗。**本機 libsql test 不是 D1 production 行為的可信
  proxy**，特別是 schema migration / FK / PRAGMA 行為。下次 schema
  migration 必須加上 wrangler local D1 emulator 驗證
- **dep bump 副作用**：本次升了 `@nuxt/ui ^4.6.1→^4.7.0`、`vitepress` 連帶
  升級可能造成 docs build vue 解析問題。**留意 prior session 已 commit
  的 dep bump 不一定可信任**，建議下次 `/commit` 看到 pre-existing dep
  bump 時先單獨跑 `pnpm build`（app + docs）確認 no regression
- **`local/excalidraw-diagram-workbench` dirty submodule 已不影響 commit**
  — 9e40005 把 `local/` 整個目錄加入 .gitignore，gitlink pointer 仍在 tree
  但 git status 不再顯示 dirty
- **commit lock 已釋放**（Step 7 即將跑），下個 session 可正常進入 `/commit`
- **`main-v0.0.54-acceptance` token 已 revoke**：
  - Staging `84f108e9-baec-4f7d-b6d4-877d21ee4f4c`（2026-04-26T01:05Z）
  - Production `b73f0d8c-85b3-4bbf-ba68-74780f2189b2`（2026-04-26T01:05Z）
  - `.env` `EVAL_MCP_BEARER_TOKEN` 已清空（加註 revoke 日期）
  - 下次需要 eval token 時用 `pnpm mint:dev-mcp-token`（local）或 `/admin/
tokens` UI mint 新 token；**不要復用已 revoked token**
  - **Notion Secret 頁面同步 pending**：本次 Notion MCP 不可用，需手動同步
    staging / production 「Application-layer MCP bearer tokens」表格，
    在這兩筆 entry 標 revoked
- **production 35 筆 query_logs 保留作 TD-061 incident 證據**：不 DELETE，
  下次調查 pipeline_error 時 query `created_at >= '2026-04-26T00:49:30'`
  即可拉到全部 35 筆原始紀錄
