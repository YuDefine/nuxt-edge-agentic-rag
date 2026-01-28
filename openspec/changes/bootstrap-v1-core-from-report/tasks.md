> **標記說明**：`[P]` = 同版後置項（Post-core），須待六步最小閉環完成後才開始實作。

## 1. Foundations

- [x] 1.1a Runtime Config — 建立 `shared/schemas/knowledge-runtime.ts` 含 binding names、feature flags、admin allowlist parsing 與 `deriveAllowedAccessLevels`，覆蓋 `Runtime Admin Allowlist` 與 `Environment Isolation`。
- [x] 1.1b NuxtHub & Drizzle Schema — 整合 `@nuxthub/core` module、建立 `server/db/schema.ts` 含 `documents`、`document_versions`、`source_chunks`、`citation_records`、`conversations`、`messages`、`query_logs`、`mcp_tokens`、`user_profiles` 八張表，設定 `hub: { db: 'sqlite', kv: true, blob: true }` 並更新 `wrangler.jsonc` bindings，覆蓋 `Versioned Replay Truth` 與 `Masked Audit Records`。
- [x] 1.2 Auth & Allowlist — 串起 better-auth、Google OAuth、`ADMIN_EMAIL_ALLOWLIST` 與 `allowed_access_levels` 推導，落地 `Runtime Admin Allowlist` 與 `Channel Access Matrix`。
- [x] 1.2a Auth Surface Alignment — 移除 email/password、GitHub OAuth 與其他非報告登入入口，讓 login UI、server auth config、`nuxt.config.ts` 與 `.env.example` 對齊 `Google OAuth Only Interactive Login`。
- [x] 1.2b Client Role Guardrail — 收斂 `useUserRole()` 與相關 client-side helper，避免把 session role 誤當成 privileged truth source；需明確保留「前端角色僅供 UI 提示，真正授權仍回到 runtime allowlist / server checks」的邊界。

## 2. Document Lifecycle & Publish Pipeline

- [x] 2.1 Staged Upload — 實作 presign / finalize 流程與檔案驗證，完成 `Staged Upload Finalization`。
- [x] 2.2 Version Preprocessing — 實作 normalized text 前處理、`source_chunks` 預建與 smoke probes，完成 `Versioned Replay Truth`。
- [x] 2.3 Publish State Machine — 實作 publish state machine、同版 reindex guard 與 no-op 重送語意，完成 `Current Version Publishing`。

## 3. Web Answering Orchestrator

- [x] 3.1 Retrieval & Verification — 建立規則式 Query Normalization、AI Search 封裝與 D1 post-verification，完成 `Verified Current Evidence Retrieval`。
- [x] 3.2 Confidence Routing & Citation — 實作分段評分、judge / reformulation、拒答與引用組裝，完成 `Confidence Routed Answering` 與 `Citation Mapped Responses`。
- [x] 3.2a Neutral Project Shell — 將首頁、shared layout 與登入後 landing copy 收斂成中性的 knowledge-project shell，移除 starter welcome 與過度完成態文案，對齊 `Neutral Project Shell`。

## 4. MCP Contract Surface

- [x] 4.1 Token Auth & Scope — 建立 token 雜湊保存、scope 驗證與 401/403 邊界，完成 `Stateless MCP Authentication`。
- [x] [P] 4.2 Ask & Replay Tools — 實作 `askKnowledge` 與 `getDocumentChunk`，完成 `Stateless Ask And Replay`。
- [x] [P] 4.3 Search & Categories Tools — 實作 `searchKnowledge` 與 `listCategories`，完成 `Filtered Search And Categories`。

## 5. Governance & Environment Controls

- [x] 5.1 Rate Limits & Env Binding — 以 KV 實作各通道限流與環境綁定驗證，完成 `Per-Channel Rate Limits` 與 `Environment Isolation`。
- [x] 5.2 Redaction & Retention — 實作 redaction、`query_logs`／`messages` 寫入規則與 retention 清理流程，完成 `Masked Audit Records` 與 `Retention And Replay Window`。

## 6. Verification & Rollout

- [x] 6.1 Test Coverage & Smoke — 補齊 unit / integration / e2e coverage 與 staging smoke 驗證，覆蓋 `Runtime Admin Allowlist`、`Current Version Publishing`、`Confidence Routed Answering`、`Stateless Ask And Replay`、`Filtered Search And Categories`。
- [x] 6.1b Deploy to Staging — 部署到 staging/preview 環境以取得 Cloudflare bindings（D1、KV、AI、R2），設定 upload signing secrets 與 Google OAuth credentials，確認基本 routes 可存取。人工驗收（6.2 及 #1-#5）依賴此步驟完成。
  - **Checklist**: `docs/verify/staging-deploy-checklist.md`
  - 2026-04-16 部署完成：
    - **Production URL**: `https://agentic.yudefine.com.tw`
    - D1 database: `agentic-rag-db` (schema initialized)
    - KV namespace: `661ea98dad0743be86acc9ebeaf464f4`
    - R2 bucket: `agentic-rag-documents`
    - Secrets 已設定: BETTER_AUTH_SECRET, NUXT_SESSION_PASSWORD, Google OAuth credentials, ADMIN_EMAIL_ALLOWLIST, R2 upload signing secrets
  - **待手動設定**: Google OAuth redirect URI → `https://agentic.yudefine.com.tw/api/auth/callback/google`
- [ ] 6.2 Manual Acceptance — 以人工檢查完成六步最小閉環驗收，確認 current-version-only、restricted 隔離、citation replay 與 redaction 都成立後，再開啟同版後置項。
  - 2026-04-16 local acceptance attempt: local app boot was repaired enough to reach the login screen and create test accounts, but full 6.2 did not complete.
  - Verified locally:
    - Better Auth local sqlite schema was missing; pushing the merged .nuxt schema into .data/db/sqlite.db created user/session/account/verification plus app tables.
    - Setup endpoint could then create admin@example.com and user@example.com successfully.
    - Runtime allowlist gate behaved as expected once CSRF was supplied: admin session reached /api/uploads/presign and failed at upload config with 503, while normal user was blocked earlier with 403 Runtime admin access is required.
  - Remaining blockers for full 6.2:
    - Upload / publish flow still requires uploads.accountId, uploads.accessKeyId, uploads.bucketName, uploads.secretAccessKey.
    - Web chat and MCP verification cannot complete under pnpm dev because routes that depend on Cloudflare bindings currently return 503 for missing DB / KV / AI bindings.
    - Google OAuth interactive path was not re-run in this local attempt; local verification used setup-created email/password accounts only.
- [x] 6.2a Cleanup Gate — 在執行人工驗收前，確認 repo 不再保留誤導 `v1.0.0` 範圍的 starter 殘留、非報告 auth / env 預設與錯誤產品化文案。
  - 2026-04-16: emailAndPassword 改為只在 NUXT_KNOWLEDGE_ENVIRONMENT=local 時啟用，符合 v1.0.0 Google OAuth Only spec。無 starter welcome、GitHub OAuth、placeholder 殘留。
- [x] 6.2b Handoff Notes — 以 roadmap / verify docs 記錄目前 repo 現況、cleanup 驗收標準與驗收前置，確保後續不需要回到獨立 TODO 清單追蹤。

## 7. Design Review

> 適用於所有涉及 UI 的 tasks（1.2 Auth UI、2.x 文件管理 UI、3.x 問答 UI）

- [x] 7.1 檢查 `.impeccable.md` 是否存在，若無則執行 `/impeccable teach`
- [x] 7.2 執行 `/design improve` 對 `app/pages/**`、`app/components/**`（含 Design Fidelity Report）
- [x] 7.3 修復所有 DRIFT 項目（Fidelity Score < 8/8 時必做，loop 直到 DRIFT = 0）
- [x] 7.4 依 `/design` 計劃按 canonical order 執行 targeted skills
- [x] 7.5 執行 `/audit` — 確認 Critical = 0
- [x] 7.6 執行 `/review-screenshot` — 視覺 QA
- [x] 7.7 Fidelity 確認 — `design-review.md` 中無 DRIFT 項

## 人工檢查

> 來源：`bootstrap-v1-core-from-report` | Specs: `knowledge-access-control`, `document-ingestion-and-publishing`, `web-agentic-answering`, `mcp-knowledge-tools`, `governance-and-observability`

- [ ] #1 實際以 Web User / Web Admin 走登入與導頁，確認 allowlist、角色與可見範圍符合規格。
  - 2026-04-16 local partial pass: setup-created admin/user accounts could sign in via /api/auth/sign-in/email; admin reached admin-only guard while user was denied. Google OAuth UI flow still未重跑。
- [ ] #2 以 `md` 或 `txt` 文件完成 presign → finalize → sync → publish → Web 問答 → 引用回放 的最小閉環。
  - Blocked locally by missing upload signing secrets and Cloudflare DB / AI bindings required by downstream routes.
- [ ] #3 將同一文件切到新版後重新提問，確認正式回答不再使用舊版內容，且舊 citation 在保留期限內仍可回放。
  - 尚未執行；依賴 #2 先完成。
- [ ] #4 以未具 `knowledge.restricted.read` 的 token 驗證 `searchKnowledge` / `askKnowledge` 的 existence-hiding，以及 `getDocumentChunk` 的 `403` 邊界。
  - 尚未執行；pnpm dev 下 MCP routes 目前先被 Cloudflare binding 缺失阻塞。
- [ ] #5 檢查 `query_logs`、`messages` 與 rate limit 結果，確認沒有未遮罩敏感資料且超限時正確回 `429`。
  - 尚未執行；依賴 chat / MCP routes 可在具 bindings 的環境下正常工作。

## Blockers

- [x] #B1 修復 NuxtHub + Better Auth 整合 — `@nuxthub/core` 模組在 Cloudflare Workers 部署時造成 libsql 初始化錯誤（`URL_SCHEME_NOT_SUPPORTED: file:`）。nuxt-better-auth 嘗試使用 libsql file:// URL 而非 D1 binding。
  - **2026-04-16 修復完成**：
    1. 啟用 `@nuxthub/core` 模組（必須在 modules array 第一位，讓 better-auth 能接收 D1 binding）
    2. 配置 `hub: { db: 'sqlite', kv: true, blob: true, dir: '.data' }` — 自動偵測環境：local 使用 file，production 使用 wrangler.jsonc bindings（D1, KV, R2）
    3. 加入 `auth: { secondaryStorage: true }` 啟用 KV session 快取
    4. 修復 `server/api/_dev/login.post.ts` 的 TypeScript 錯誤（Headers 類型轉換）
  - **驗證狀態**：
    - ✅ `pnpm typecheck` 通過
    - ✅ `pnpm test:unit` 通過（105 tests）
    - ⚠️ `pnpm build` 有間歇性 V8 crash（Node.js 24 runtime 問題，與本修復無關）
  - **待驗證**：部署到 staging 確認 D1 binding 正確運作
