# Handoff

## In Progress

- [ ] **rag-query-rewriting** (16/34 tasks, 47% — 6.1 standing as **partial pass**)
  - Code 已隨 v0.53.0 ship 到 production；staging `features.queryRewriting=true` 已生效
  - **6.1 partial pass**（commit `b5eca44`）：flag wiring + audit 寫入機制 + fallback safety 三層 ✅；
    `rewriter_status='success'` path 與 `rewritten_query` 內容受 local Workers AI binding 限制 → 待 6.4 staging 驗
    - Evidence: `local/reports/notes/rag-query-rewriting-6.1-local-smoke-20260426.md`（gitignored）
  - 剩餘 task：3.3 prompt validation / 6.3 staging deploy / 6.4-6.6 staging acceptance / 7.1-7.5 follow-ups
  - 無 active claim — 接手前 `pnpm spectra:claim -- rag-query-rewriting`

## Blocked / Waiting

- **TD-056 / TD-061 / TD-057 behavior 驗收**：v0.52.1 fix code 已 ship 且 root cause 完美對應
  （3/3 ship 前 pipeline_error 都是 judge `completionTokens=200` 截斷），但 production 24h
  只 1 筆 traffic 沒走 judge / SSE chat path → 需要主動發 chat 才能驗證 fix 生效
- **rag-query-rewriting 6.4 staging acceptance**：依賴 staging RAG retrieve 有真實 results
  （staging R2 已 seed 5 份 fixture，但需確認 AutoRAG indexing 完成）

## Next Steps

1. **v0.55.0 production verify**（剛 ship，run 25254588577 in_progress）
   - 確認 production deploy + smoke-test 通過後再進 acceptance 動作
   - 順帶確認 production worker `features.queryRewriting=false` 仍生效（不啟用 rewriter）
2. 主動發 1-2 條 production chat 觸發 judge path 驗 TD-056 / TD-057 behavior
   （登入 `agentic.yudefine.com.tw` 或拿 admin token）
3. **rag-query-rewriting 6.3**：`gh workflow run deploy.yml -f target=staging` 觸發 staging 部署
4. **rag-query-rewriting 6.4 / 6.5**：對 staging 跑 35 筆 acceptance fixture，記證據到
   `local/reports/notes/main-v0.0.54-acceptance-rewriter-staging-{date}.md`；6.1 的 success path
   會在 staging 驗到，可順帶確認
5. **rag-query-rewriting 3.3**：5 條 fixture prompt validation（建議在 staging 跑，因為 local Workers AI
   會 fallback_error 看不到改寫結果）
6. TD-027 MCP connector first-time auth 實測（DO archive 已完成，可隨時實測 Claude.ai OAuth flow）

## Notes / Pitfalls

- v0.55.0 commit `8b8b3ce` 帶兩條 polish：(a) Clade rules / spectra-\* skill 全套同步、commit-lock race fix、
  oxc 工具鏈整合（package.json `format` 加 negation pattern 排除 chmod 444 治理目錄）；
  (b) 新增 dev-only `/api/_dev/chat-smoke.post`（雙重守護：env=local + admin session）
- ROADMAP MANUAL 行 19 已修 16/29 → 16/34（隨本次 commit 修正）；其餘 MANUAL 區塊（Current State 寫
  「v0.52.0」、Next Moves 中 v0.53.0 verify 條目）仍偏舊，但不阻擋下一個 session
- `local/mock-documents/` 已有 4 份 seed 檔（採購流程辦法、員工請假辦法、差旅費用報銷規範、新人入職指南）
- TD-050 staging seed 部分已落地（5 份 fixture 在 R2）但 TD entry 仍 open；缺 AutoRAG indexing
  完成驗證 + 4 個 tool call 重跑 acceptance
- **csrf-token wiring**（curl 對 `/api/chat` 用）：`GET /` parse `<meta name="csrf-token" content="...">`
  → POST 帶 `csrf-token: <token>` header + cookie jar（含 `csrf=...` + `better-auth.session_token=...`）
- Local Workers AI binding 跑 rewriter judge model 會 fallback_error；fallback safety 機制工作正常，
  不影響 staging / production 真實環境
- vue-tsc stack trace `vue-router/volar/sfc-route-blocks Cannot find module` 是 vue-tsc@3.2.7 對舊
  vue-router optional plugin 的解析錯誤，**typecheck exit 0**，不影響 commit / deploy
