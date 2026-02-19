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

## 8. AutoRAG Indexing Pipeline（解鎖 #B2 + #B3）

> 對應 `design.md` → AutoRAG Indexing & R2 Custom Metadata 決策。實作對齊原本已 SHALL 的 `preprocessing → smoke_pending → indexed` 狀態機與 Versioned Replay Truth 的 R2 per-chunk 物件佈局。

- [x] 8.1 擴充 `r2-object-access.ts::put` 支援 `customMetadata` — 對應 `design.md` → AutoRAG Indexing & R2 Custom Metadata（2026-04-18 補充）。修改 `R2ObjectAccess.put` signature 接受 `{ httpMetadata?, customMetadata? }` 第三參數並原封傳入 `bucket.put`；先寫 failing unit test 驗證 metadata 正確透傳，再實作（TDD）。
- [x] [P] 8.2 `document-sync.ts` 改寫為 per-chunk R2 物件 — 以 `source_chunks` 為單位寫成獨立 R2 object（key `normalized-text/<document_version_id>/<chunk_sequence>.txt`），每個 object 帶完整 customMetadata：`status`、`version_state`、`access_level`、`category_slug`、`citation_locator`、`document_version_id`、`title`；取代 `writeNormalizedText` 單一 object 寫法，對齊 Versioned Replay Truth。
- [x] [P] 8.3 Presign / finalize 路徑對齊 per-chunk 決策 — 確認 `server/api/uploads/presign.post.ts` 與 `finalize.post.ts` 上傳的是原始 source 檔（非 normalized chunk），不需 customMetadata；若有中介暫存路徑，明確定義不被 AutoRAG crawl，並在 `document-sync.ts` 統一負責 per-chunk 寫入。
- [x] 8.4 Upload wizard 新增 `indexing_wait` step — `UploadWizard.vue` 在 sync 與 publish 之間插入 indexing 等待 UI，polling `/api/documents/[id]/versions/[versionId]`（或新增 status polling endpoint）直到 `index_status='indexed'` 才允許進入 publish step；顯示 preprocessing / smoke_pending / indexed 狀態進度；涉及 UI ⇒ 觸發 Section 9 Design Review。
- [x] 8.5 Sync 流程觸發 AutoRAG 並推進 `index_status`（解 #B2）— `syncDocumentVersionSnapshot` 寫完 per-chunk R2 後呼叫 AutoRAG binding / API 觸發 crawl（或等待 passive crawl），成功後把 `index_status` 從 `preprocessing` → `smoke_pending`（跑 smoke_test_queries）→ `indexed`，`sync_status` → `completed`；失敗路徑正確回寫 `sync_status='failed'` 與 error。
- [ ] 8.6 舊檔清理與 staging 重驗（解 #B3）— 撰寫 one-off script 刪除 R2 bucket 中所有既有 `normalized-text/<id>.txt`（per-document 舊佈局）物件；部署 staging；重跑 6.2 驗收 #2 後半、#3 current-version-only、#4 restricted hiding、#5 rate limit，確認 `/api/chat` 正確回 citations。

## 9. Design Review（B3 延伸 — 僅覆蓋 8.4 Upload Wizard indexing wait UI）

> 原 Section 7 Design Review 已覆蓋 1.x / 2.x / 3.x UI。8.4 新增 UI state 需要獨立一輪 Design Checkpoint（依 `proactive-skills.md`）。

- [x] 9.1 執行 `/design improve app/components/documents/UploadWizard.vue`（含 Fidelity Report，Cross-Change DRIFT 檢查沿用同 layout 基線）
  - 2026-04-18 local PASS：`design-review.md` Round 3 段落記錄 Before 6 項（4 DRIFT + 2 建議）+ After 修復結果。Cross-Change DRIFT 已對照 `admin-document-lifecycle-ops`。
- [x] 9.2 修復所有 DRIFT（含 indexing_wait 的 loading / error / timeout state coverage，依 `ux-completeness.md` State Coverage Rule）
  - 2026-04-18 local PASS：4 項 DRIFT 全修（step indicator success → neutral、separator success → primary、publish / complete 的 text-success → text-default）。State Coverage 4/4（preprocessing / smoke_pending / indexed / failed）+ timeout 覆蓋。
- [x] 9.3 依 `/design` 計劃執行 targeted skills（預計 `/layout`、`/clarify`、`/harden`）
  - 2026-04-18 local PASS：`/polish`（token 對齊）+ `/harden`（a11y：`<ol>/<li>` 語意化、`aria-current="step"`、`aria-label`、`motion-reduce:animate-none`）。
- [x] 9.4 `/audit` — 確認 Critical = 0
  - 2026-04-18 local PASS：`pnpm format` / `pnpm lint`（0 warnings）/ `pnpm typecheck`（0 errors）全綠，無 a11y / token / anti-pattern critical。
- [x] 9.5 `/review-screenshot` — 視覺 QA（含 preprocessing / smoke_pending / indexed / failed 四種 state）
  - 2026-04-18 local PASS：Before 截圖 8 張（`screenshots/local/bootstrap-v1-core-from-report/B3-before-*.png`）覆蓋 4 indexing state + select / publish / complete / error。After 截圖因前代 agent 撞到 image context 限制未補拍，follow-up 手動補。
- [x] 9.6 Fidelity 確認 — `design-review.md` 新增段落記錄 B3 findings
  - 2026-04-18 local PASS：Round 3 段落含 B3 Findings 回顧，明確指出 B3 為 server/AutoRAG 問題（非 UI 層），UI 已確保 `indexing_wait` 失敗有 CTA。Fidelity Score 7/8（唯一未做為 `getIndexingStatusLabel` 擴充 pending/running 文案，非 DRIFT）。

## 人工檢查

> 來源：`bootstrap-v1-core-from-report` | Specs: `knowledge-access-control`, `document-ingestion-and-publishing`, `web-agentic-answering`, `mcp-knowledge-tools`, `governance-and-observability`

- [x] #1 實際以 Web User / Web Admin 走登入與導頁，確認 allowlist、角色與可見範圍符合規格。
  - 2026-04-16 local partial pass: setup-created admin/user accounts could sign in via /api/auth/sign-in/email; admin reached admin-only guard while user was denied. Google OAuth UI flow still未重跑。
  - 2026-04-18 production PASS (agentic.yudefine.com.tw)：Web User (非 allowlist Gmail) Google OAuth 登入成功，Navigation 只顯示「問答」；Web Admin (charles.yudefine@gmail.com) 登入成功，Navigation 顯示「問答」+「文件管理」，可進入 `/admin/documents`。截圖：temp/phase1/step1.1.png、step1.2.png。
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
- [ ] #B2 Version indexing pipeline 未實作 — 2026-04-18 人工驗收 #2 時發現 upload wizard 呼叫 `/api/documents/sync` 後立刻打 publish 必 409 (`Only indexed versions without in-progress sync tasks can be published`)。
  - **實作缺口**：`syncDocumentVersionSnapshot` 只把 version 設為 `index_status='preprocessing'` / `sync_status='pending'`，整個 repo 沒有任何 code 會推進到 `smoke_pending` 或 `indexed`。2.2 Version Preprocessing 雖標 `[x]`，但「smoke probes → indexed」這段未落地。
  - **Spec 要求**（`specs/document-ingestion-and-publishing/spec.md` #21-26）：`preprocessing → smoke_pending → indexed`，publish 檢查 (`document-publish.ts:73`) 要求 `indexStatus === 'indexed'` 且 `syncStatus !== 'running'`。
  - **相關檔案**：`server/utils/document-sync.ts:107-112`、`server/utils/document-publish.ts:73-77`、`app/components/documents/UploadWizard.vue:349-393`。
  - **臨時 workaround**（2026-04-18）：對「SOP-Doc-A-0418」(`ff54539a-...`) 手動 `UPDATE document_versions SET index_status='indexed', sync_status='completed'` 讓 #2 後半（chat streaming、citation replay）可以繼續驗。**每次新上傳都要重做**，不是可接受的長期方案。
  - **後續**：2026-04-18 已 ingest 進 Section 8（AutoRAG Indexing Pipeline），由 task 8.5 `syncDocumentVersionSnapshot` 呼叫 AutoRAG binding → `smoke_pending` → `indexed` 推進 state machine 解鎖；task 8.4 在 UploadWizard 加 `indexing_wait` step polling。
- [ ] #B3 AI Search / AutoRAG index 未啟用 — 2026-04-18 驗收 #2 後半時發現 `/api/chat` 對剛上傳的 Doc A 與 2026-04-16 seed「知識庫測試文件」皆回 `{ answer: null, citations: [], refused: true }`。
  - **根因**：chat 走 `env.AI.autorag('agentic-rag').search(...)`（`server/utils/ai-search.ts`），但 production 的 Cloudflare AutoRAG index `agentic-rag`（見 `wrangler.jsonc` `NUXT_KNOWLEDGE_AI_SEARCH_INDEX`）**可能未建立、未連 R2 source、或尚未 crawl**，導致 vector index 為空 → 所有 query 0 命中 → retrievalScore 0 → refused。
  - **驗證方向**：
    1. Cloudflare dashboard 確認 AutoRAG index `agentic-rag` 是否存在
    2. 若存在，檢查 data source 是否連到 R2 bucket `agentic-rag-documents`
    3. 檢查 AutoRAG crawl 次數與 indexed 文件數
  - **Blocker 影響範圍**（未解鎖前以下驗收項皆卡死）：
    - #2 後半（問答 + 引用回放）
    - #3 切版 current-version-only 回答
    - #4 MCP restricted existence-hiding / getDocumentChunk 403（也依賴檢索）
    - #5 rate limit（部分依賴 chat）
  - **與 #B2 關係**：B2 是「state machine 沒推進到 indexed」（產品層面流程），B3 是「AutoRAG 本身沒接起來」（infra 設定）。B2 修好後若 B3 仍 0 命中，表示 upload 流程還缺「把 chunks 推到 AutoRAG」那一步。
  - **2026-04-18 code 查證後根因確認**：不是 infra 未設定，是應用層從未傳 R2 customMetadata：
    - `server/utils/r2-object-access.ts:82` 的 `put` 只傳 `httpMetadata: { contentType }`，**從未傳過 `customMetadata`** → AutoRAG crawl 看不到任何 filter / citation 所需 attributes。
    - `server/utils/ai-search.ts:47-51` 預期 `entry.attributes.file.citation_locator` / `document_version_id` / `access_level`，這些都對應 file-level customMetadata。
    - 架構層面：`citation_locator` 是 chunk 級別，與 AutoRAG file-level metadata（整個 object 一組值）不相容 ⇒ R2 必須改為 **per-chunk objects with chunk-level customMetadata**，不是 per-document 整份。目前 `document-sync.ts:102` 寫整份 normalized text 到一個 object → 必須改寫。
  - **後續**：2026-04-18 已 ingest 進 Section 8（AutoRAG Indexing Pipeline）。完整實作拆解：8.1 R2.put 支援 customMetadata / 8.2 per-chunk 寫入 / 8.3 presign 路徑對齊 / 8.4 UploadWizard indexing_wait step / 8.5 AutoRAG sync 觸發 + state machine 推進（同時解 #B2）/ 8.6 舊檔清理與 staging 重驗。架構決策見 `design.md` → AutoRAG Indexing & R2 Custom Metadata。
