# Handoff

## In Progress

**Active change**: `code-quality-review-followups`（in-progress，10/43 tasks）

批 1（server / util / test，無 UI）已完成並入庫：

- ✅ TD-017 AI binding 共用 helper（含 simplify 擴展涵蓋 mcp/tools/ask + search）
- ✅ TD-018 chat error classification util + lookup table
- ✅ TD-020 ChatGPT connector OAuth path regex 收緊

批 2、3 尚未開始，等新 session 接手。

### 批次計劃

| 批   | Groups     | 內容                                                                           | 狀態             |
| ---- | ---------- | ------------------------------------------------------------------------------ | ---------------- |
| 批 1 | 1, 2, 3    | TD-017 / 018 / 020（server + util + test，無 UI）                              | ✅ 完成並 commit |
| 批 2 | 4, 5, 6, 9 | TD-021 / 022 / 023（都碰 ConversationHistory.vue + index.vue） + Design Review | 待新 session     |
| 批 3 | 7, 8, 10   | TD-024 test 改寫 + tech-debt docs + 人工檢查（7 項你親測）                     | 待新 session     |

### 接手方式（新 session）

1. 確認 claim 未過期：`pnpm spectra:claim code-quality-review-followups`（若 stale）
2. 進入批 2：`/spectra-apply code-quality-review-followups` 會自動載入進度，從 tasks.md 最後一個未勾項（4.1）續跑
3. 批 2 必須做 Design Review（spectra.yaml design_review: true），請跑 `/design improve app/components/chat/ConversationHistory.vue app/pages/index.vue` 起頭
4. 批 3 的 group 10 有 7 項人工檢查，必須使用者本人瀏覽器實測（跨午夜、aria-expanded AT、OAuth reject 三種 payload、classifyError 五類錯誤、AI binding 503、fetch dedup Network tab）

### 本次 commit 的 scope 微調（告知接手者）

- **TD-017**：helper 放新檔 `server/utils/ai-binding.ts`（非原 task 寫的 chat.post.ts 內 local）。
  原因：`server/utils/cloudflare-bindings.ts` 被 15+ integration test 透過 `vi.mock` 攔截。
- **TD-018**：抽到 `app/utils/chat-error-classification.ts`（非原 task 寫的 Container.vue 內）。
  原因：`.spectra.yaml` 開 tdd: true，SFC 內部 function 無法直接 unit test。

## Next Steps

1. **批 2（TD-021 / 022 / 023 + Design Review）**：最優先，新 session 接手；需要瀏覽器
   端驗證跨午夜重分組、aria-expanded 切換。
2. **批 3（TD-024 + tech-debt docs + 人工檢查）**：在批 2 完成後做；人工檢查必須使用者
   本人。
3. **Deploy 後 smoke `/admin/usage`**：上一輪 `fix(admin-usage)` 改為從 Cloudflare
   Workers env 讀 secret；production / staging 第一次請求前確認 `wrangler secret put`
   已寫入 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN_ANALYTICS` /
   `NUXT_KNOWLEDGE_AI_GATEWAY_ID`，admin 進 `/admin/usage` 不再回 503「尚未設定完成」。
4. **驗證日期格式變化**：上上輪 refactor 把 6 個頁面的日期顯示從 `YYYY/MM/DD HH:mm` 改成
   `YYYY/M/D HH:mm:ss`。deploy 後到 `/account/settings`、`/admin/documents/:id`、
   `/admin/members`、`/admin/query-logs`（list + detail）、`/admin/tokens` 目視確認
   新格式符合預期，若不滿意可調整 `app/utils/format-datetime.ts`。
5. **本 change archive 後**：
   - TD-009（user_profiles.email_normalized 全面改 nullable）仍 open，sentinel
     workaround 仍在；另開 Tier 3 migration change 處理。
   - TD-015（SSE heartbeat）+ TD-019（SSE reader pattern 抽共用）+ TD-016
     （isAbortError 抽共用）：SSE 相關技術債，下一條 change（B2 線）合併處理。

## 使用者並行 WIP（不屬於本 change）

以下檔案是使用者自己在做的、與本 change 無關（已確認不碰）：

- `scripts/check-staging-gate.mjs`
- `test/unit/staging-gate.test.ts`

GitHub Actions staging-gate 檢查腳本 + 其測試；由使用者自行決定 commit 時機。
