# Handoff

## In Progress

- [ ] **rag-query-rewriting** (16/34 tasks, 47% — 6.1 standing as **partial pass**)
  - claim 已 release（charles@charlesdeMac-mini.local 接續做完 partial 驗證後 released）
  - Code 已隨 v0.53.0 ship 到 production；staging `features.queryRewriting=true` 已生效
  - **6.1 partial pass**：flag wiring + audit 寫入機制 + fallback safety 三層 ✅；
    `rewriter_status='success'` path 與 `rewritten_query` 內容受 local Workers AI binding 限制 → 待 6.4 staging 驗
    - Evidence: `local/reports/notes/rag-query-rewriting-6.1-local-smoke-20260426.md`（gitignored）
  - 剩餘 task：3.3 prompt validation / 6.3 staging deploy / 6.4-6.6 staging acceptance / 7.1-7.5 follow-ups

## Pending Working Tree Changes

```
 M openspec/ROADMAP.md                              ← claim re-claim sync
 M openspec/changes/rag-query-rewriting/tasks.md    ← 6.1 partial pass 標註 + evidence link
?? HANDOFF.md                                       ← 本次更新
?? server/api/_dev/chat-smoke.post.ts               ← untracked dev tool（待處置）

# Gitignored（不入 git，僅 session 紀錄）：
.env                                                ← 加 NUXT_KNOWLEDGE_FEATURE_QUERY_REWRITING=true
local/reports/notes/rag-query-rewriting-6.1-local-smoke-20260426.md
```

下個 session 開頭可 `/commit` 把前 3 個帶上；`chat-smoke.post.ts` 處置決策見「Untracked Dev Tools」。

## Untracked Dev Tools（待你決定處置）

- `server/api/_dev/chat-smoke.post.ts`（untracked）— 用 LIKE pattern 撈 source_chunks 直接打 Workers AI，
  bypass 完整 retrieve pipeline + audit log，**不適合 6.1 chat smoke**（未走 query rewriter / autoRag /
  audit log，看不到 rewriter_status 寫入）。
  - 仍可作為「測 LLM answer adapter，不走 retrieval」的 dev fixture
  - 處置：(a) commit 進來作 utility；(b) 直接刪除；(c) 沿用 seed pattern 後 commit
  - 本 session 確認：之前報告的 typecheck error 已不存在（檔案 modelByRole 已被移除），TD-067 entry 已撤回

## Blocked / Waiting

- **TD-056 / TD-061 / TD-057 behavior 驗收**：v0.52.1 fix code 已 ship 且 root cause 完美對應
  （3/3 ship 前 pipeline_error 都是 judge `completionTokens=200` 截斷），但 production 24h
  只 1 筆 traffic 沒走 judge / SSE chat path → 需要主動發 chat 才能驗證 fix 生效
- **rag-query-rewriting 6.4 staging acceptance**：依賴 staging RAG retrieve 有真實 results
  （staging R2 已 seed 5 份 fixture，但需確認 AutoRAG indexing 完成）

## Next Steps

1. 主動發 1-2 條 production chat 觸發 judge path 驗 TD-056 / TD-057 behavior
   （登入 `agentic.yudefine.com.tw` 或拿 admin token）
2. **rag-query-rewriting 6.3**：`gh workflow run deploy.yml -f target=staging` 觸發 staging 部署
3. **rag-query-rewriting 6.4 / 6.5**：對 staging 跑 35 筆 acceptance fixture，記證據到
   `local/reports/notes/main-v0.0.54-acceptance-rewriter-staging-{date}.md`；同時 6.1 的 success path
   會在 staging 驗到，可順帶確認
4. **rag-query-rewriting 3.3**：5 條 fixture prompt validation（建議在 staging 跑，因為 local Workers AI
   會 fallback_error 看不到改寫結果）
5. TD-027 MCP connector first-time auth 實測（DO archive 已完成，可隨時實測 Claude.ai OAuth flow）
6. v0.53.0 production verify checklist（cosmetic，可獨立進）

## Notes / Pitfalls

- ROADMAP MANUAL block 仍寫 "rag-query-rewriting 16/29"，AUTO 已更新為 16/34（多 5 條 staging 驗收
  task）— 下一個 session 可順手修正 MANUAL drift
- `local/mock-documents/` 已有 4 份 seed 檔（採購流程辦法、員工請假辦法、差旅費用報銷規範、新人入職指南）
- TD-050 staging seed 部分已落地（5 份 fixture 在 R2）但 TD entry 仍 open；缺 AutoRAG indexing
  完成驗證 + 4 個 tool call 重跑 acceptance
- 本 session 已驗 v0.54.0 production deploy 綠，`/api/_dev/seed-mock-documents` 在 local 端到端工作
- **csrf-token wiring**（curl 對 `/api/chat` 用）：`GET /` parse `<meta name="csrf-token" content="...">`
  → POST 帶 `csrf-token: <token>` header + cookie jar（含 `csrf=...` + `better-auth.session_token=...`）
- Local Workers AI binding 跑 rewriter judge model 會 fallback_error；fallback safety 機制工作正常，
  不影響 staging / production 真實環境
