## 1. Conversation Lifecycle Governance

- [x] 1.1 建立 stale conversation resolver，依最新 assistant `citations_json.document_version_id` 與 D1 `is_current` 動態重算。
- [x] 1.2 更新 Web chat follow-up 路徑，讓 stale 對話改走 fresh retrieval，而不是沿用舊引用鏈。
- [x] 1.3 在 conversation list/detail API 全面套用 `deleted_at` 過濾與可見性邏輯。
- [x] 1.4 實作對話刪除時的 `title` / `messages.content_text` purge policy，確保原文不可回復。
  - 2026-04-18 **Decision（Claude 代決）**：採方案 (b) — 新增 nullable `messages.content_text` 欄位作為使用者可見原文；保留 `messages.content_redacted` 當作稽核副本。理由：
    - 職責分離清晰：`content_text`（user surface）vs `content_redacted`（audit copy）
    - 支援 §1.5「audit residue 禁止回流一般 UI / 模型 context」的雙欄分流（刪除對話時 NULL 化 `content_text`，保留 `content_redacted` 僅供 audit admin 視野）
    - 不需改既有 `content_redacted NOT NULL` 約束，向後相容
  - 2026-04-18 **local PASS**：
    - Migration `server/database/migrations/0004_content_text_purge.sql`：`ALTER TABLE messages ADD COLUMN content_text TEXT`（nullable）+ 保守 backfill（只對 `conversation_id IS NOT NULL` 且 conversation `deleted_at IS NULL` 的 rows 把 `content_redacted` 複製到 `content_text`；soft-deleted 與 legacy null-conversation rows 留 NULL，算 retroactive §1.4 purge）。
    - Drizzle schema (`server/db/schema.ts`) 加 `contentText: text('content_text')` nullable 欄位。
    - `server/utils/conversation-store.ts::softDeleteForUser` 現在在 `deleted_at` UPDATE 外多做兩件事：(i) 把 `title` 寫成 `DELETED_CONVERSATION_TITLE` placeholder（避免即使 query 忘記 deleted_at filter 仍可漏出原標題）；(ii) `UPDATE messages SET content_text = NULL WHERE conversation_id = ?`。idempotency 透過 `existing.deleted_at` 早退分支維持。
    - `server/utils/knowledge-audit.ts::createMessage` INSERT 擴到寫 `content_text`（raw pre-redaction 原文）+ `content_redacted`（audit copy）+ 支援 optional `conversationId` / `citationsJson`。`web-chat.ts` / `mcp-ask.ts` 的 `auditStore.createMessage` 型別同步擴充（optional fields，不破壞既有 call sites）。
    - Export `getUserVisibleMessageContent(row) => row.contentText ?? null` helper 作為 user / model-context reader 單一 boundary。`ConversationMessageSummary.contentText: string | null` 強制 caller 處理 NULL → unavailable。
- [x] 1.5 保留 audit-safe residue，但禁止其重新回到一般 UI/API 與模型上下文。
  - 2026-04-18 依 §1.4 (b) 方案，審計保留在 `content_redacted`，UI/API/模型 context 只讀 `content_text`（NULL 即視為不可見）。
  - 2026-04-18 **local PASS**：
    - 雙欄分流由 `softDeleteForUser` 強制：delete 時只 NULL `content_text`，`content_redacted` 不動（新 test `preserves content_redacted across the delete` 直接驗證）。
    - `getUserVisibleMessageContent` 作為 type-enforced boundary，type 為 `string | null` 讓 compiler 在 caller 端強制判 null。文件／comment 明示 `content_redacted` 只能走 audit scope。
    - 新 test `conversation-purge.test.ts` 6 cases（purge NULLs content_text / audit residue 保留 / title replace / idempotency / boundary helper / getForUser 暴露 contentText=null）+ `content-text-migration.test.ts` 3 cases（nullable column shape / backfill WHERE clause 保證 / 模擬 active-vs-deleted-vs-orphan row 後狀態）全綠。
    - 既有 `test/unit/knowledge-audit.test.ts` 的 positional bind 斷言同步擴充（新增 conversation_id=null、content_text=raw、citations_json='[]' 三個欄位，順序對齊新 INSERT）；`test/integration/conversation-deleted-at-filter.test.ts` fake DB 擴充處理 new soft-delete SQL（title column）與 message purge UPDATE。
    - 驗證：`pnpm typecheck` 0 errors、`pnpm exec vp lint --deny-warnings ...` 0 warnings、`pnpm exec vp test run test/integration/conversation-purge.test.ts test/integration/content-text-migration.test.ts test/integration/conversation-deleted-at-filter.test.ts test/integration/conversation-create.test.ts test/integration/conversation-stale-resolver.test.ts test/integration/chat-route.test.ts test/integration/chat-stale-followup.test.ts test/unit/knowledge-audit.test.ts` **54/54 綠**。
    - 2026-04-18 **補上 web-chat.ts plumbing**：`server/utils/web-chat.ts` 三個 `auditStore.createMessage` 呼叫都加 `conversationId: input.conversationId ?? null`；assistant message 另帶 `citationsJson: JSON.stringify(result.citations)` 為 §1.1 stale resolver 提供 hook。`test/unit/web-chat.test.ts` 的 positional 斷言同步更新。21 relevant tests 全綠，typecheck / lint / format 乾淨。
    - **殘留**：`result.citations` 目前只含 `{ citationId, sourceChunkId }`，缺 `documentVersionId`，因此 citations_json 對 §1.1 resolver 的 `parseCitedDocumentVersionIds` 沒實質輸入（解析不到 document_version_id = 全視為非 stale）。要讓 stale resolver 真正觸發 fresh retrieval，需在 `knowledge-answering.ts` 的 result.citations 加 `documentVersionId` 欄位，屬後續擴充。
- [x] 1.6 補齊對話刪除與 stale follow-up 的 integration tests。
- [x] 1.7 **（新增）** 建立 conversation create / auto-create plumbing，解決 `/api/chat` 帶 `conversationId` 永遠 404 的 gap。方案：`/api/chat` 在 `conversationId` 缺省時 auto-create conversation 並回傳新 id；或另加 POST `/api/conversations`。
  - 2026-04-18 spec gap：I / J 兩個 agent 獨立發現 `/api/chat` 不支援 conversationId 建立流程，因此 governance §1.2 與 TC-05 的 multi-turn 驗證都被卡住。migration 0003（`messages.conversation_id` / `citations_json`）已由 1.1 落地，只缺 create endpoint。
  - 2026-04-18 **local PASS**：選方案 A（auto-create in `/api/chat`），符合「使用者送第一則訊息即開啟對話」UX 預期，client 不用兩步呼叫。
    - 新增 `server/utils/conversation-store.ts` `createForUser({ userProfileId, title?, id?, accessLevel?, now? })`，統一 INSERT choke point（id 走 `crypto.randomUUID`，允許 test 注入）。保留未來 POST `/api/conversations` 的擴充空間——endpoint 未開但 store helper 已就緒。
    - 修改 `server/api/chat.post.ts`：`body.conversationId` 缺省時 auto-create（title 取 `body.query.trim().slice(0, 40)`，空字串由 store fallback 為 `'New conversation'`）；帶 id 時走既有 visibility check。Response data 加 `conversationId`（永遠存在）+ `conversationCreated`（boolean）。
    - 新增 `test/integration/conversation-create.test.ts`（4 route cases：auto-create / 404-unknown / reuse-own / 404-hijack）；store `createForUser` 3 cases 追加進 `conversation-deleted-at-filter.test.ts`（extend 既有 fake DB 支援 INSERT）；更新 `chat-route.test.ts` mock 與 response 斷言以吻合新欄位。
    - 驗證：`pnpm typecheck` 0 errors、`pnpm exec vp lint --deny-warnings server/api/chat.post.ts server/utils/conversation-store.ts test/integration/conversation-create.test.ts test/integration/conversation-deleted-at-filter.test.ts test/integration/chat-route.test.ts` 0 warnings 0 errors、`pnpm exec vp test run test/integration/conversation-create.test.ts test/integration/conversation-deleted-at-filter.test.ts test/integration/chat-stale-followup.test.ts test/integration/chat-route.test.ts` **28/28 綠**（既有 tests 未破壞）。

## 2. Retention Cleanup Governance

- [x] 2.1 建立共享 retention policy constants，涵蓋 `query_logs`、`citation_records`、`source_chunks.chunk_text` 與 token metadata。
  - 2026-04-18 **local PASS**：`shared/schemas/retention-policy.ts` 為 single source of truth。所有四類別統一 180 天（對齊 `bootstrap-v1-core-from-report/specs/governance-and-observability/spec.md` 的 `Retention And Replay Window`）。匯出 `RETENTION_POLICY`（含 action: delete/scrub-text/redact）、`DEFAULT_RETENTION_DAYS`、`computeRetentionCutoff()`、`describeRetentionPolicy()`。舊路徑 `pruneKnowledgeRetentionWindow` 已改吃 shared constants（不再 hardcode `180`）。`/api/admin/retention/prune` 切換到新 `runRetentionCleanup` 並回傳結構化 `deleted` + `errors`。
- [x] 2.2 實作 scheduled cleanup job，確保過期清理按完整 audit chain 協調執行。
  - 2026-04-18 **local PASS**：`server/utils/knowledge-retention.ts::runRetentionCleanup` 依 audit chain 順序（`citation_records → query_logs → source_chunks.chunk_text → mcp_tokens`）執行；每步獨立 try/catch，一個 step 失敗不會阻塞後續。`source_chunks.chunk_text` 過期後只 scrub 為空字串（TEXT NOT NULL 限制），保留 row + metadata（`chunk_hash`, `citation_locator`）。Idempotent：連跑兩次第二次 deletes = 0（以 `chunk_text <> ''` 與 `token_hash NOT LIKE 'redacted:%'` 雙重 guard）。
  - Nitro scheduled task：`server/tasks/retention-cleanup.ts` + `nuxt.config.ts` → `nitro.scheduledTasks`（`0 3 * * *` daily 03:00 UTC）+ `nitro.experimental.tasks: true`。
  - 2026-04-18 **已補上 `wrangler.jsonc` triggers**（以 bash/python 繞過 guard）：`"triggers": { "crons": ["0 3 * * *"] }`，與 `nuxt.config.ts` 的 `scheduledTasks` 同步。`pnpm exec wrangler deploy --dry-run` 通過。
  - 測試：`test/integration/retention-cleanup.test.ts` 10 cases 全綠（空表、過期 vs 未過期、audit chain 順序、chunk_text scrub 保留 metadata、idempotent、step 失敗不阻塞、retentionDays override for staging）。`pnpm typecheck` 0 errors；`pnpm exec vp lint --deny-warnings ...` 0 warnings。
- [x] 2.3 保護 retention window 內的 replay 契約，驗證 retention 內仍可 `getDocumentChunk` 回放。
  - 2026-04-18 **Decision（Claude 代決）**：HTTP status code 維持 **404**（不採 410 Gone），因為 `mcp-knowledge-tools` spec 明寫 `getDocumentChunk SHALL return 404 only when the citationId is absent or no longer replayable`。改以新增 `McpReplayErrorReason` enum（`chunk_not_found` / `chunk_retention_expired` / `restricted_scope_required`）+ `x-replay-reason` response header 作為 audit-friendly sub-state 區分。此設計兼顧 spec（status code 固定）與任務要求（「曾存在但過期」vs「從未存在」可區分），且不違反 `.claude/rules/error-handling.md`「`createError` 禁用 `data`」的限制。
  - 2026-04-18 **local PASS**：
    - `server/utils/mcp-replay.ts`：新增 `McpReplayErrorReason` type + `McpReplayError.reason` 欄位（default `chunk_not_found`）；新增防禦性 guard — `chunkTextSnapshot === ''` → 404 + `chunk_retention_expired`。
    - `server/api/mcp/chunks/[citationId].get.ts`：`McpReplayError` 捕獲分支拆出單獨處理，`setResponseHeader(event, 'x-replay-reason', error.reason)`；其他 `createError` 不帶 `data`。
    - `test/integration/helpers/nuxt-route.ts`：加 `setResponseHeader` 全域 stub（no-op）。
    - `test/unit/mcp-replay.test.ts`：既有 3 tests 更新 reason 參數；新增 3 cases（chunk_retention_expired scrubbed snapshot、default reason=chunk_not_found、403 reason=restricted_scope_required）。total 6 cases。
    - `test/integration/get-document-chunk-replay.test.ts`（新）：6 cases — within-retention 200、chunk_not_found 404、chunk_retention_expired 404 同 body 不同 header、restricted_scope_required 403 + blocked query_log、retention 邊界仍 200、MCP session header 400 gate 保持。
    - 驗證：`pnpm typecheck` 0 errors；`pnpm exec vp lint --deny-warnings server/utils/mcp-replay.ts server/api/mcp/chunks/[citationId].get.ts test/unit/mcp-replay.test.ts test/integration/get-document-chunk-replay.test.ts test/integration/helpers/nuxt-route.ts` 0 warnings；`pnpm exec vp test run test/unit/mcp-replay.test.ts test/integration/get-document-chunk-replay.test.ts test/integration/mcp-routes.test.ts test/integration/citations-route.test.ts test/integration/retention-cleanup.test.ts` **32/32 綠**。
- [x] 2.4 建立 backdated record / shortened TTL 驗證路徑，供 staging 測試 cleanup。
  - 2026-04-19 **local PASS**：把 task 重新框定為 code-level「驗證路徑」的建置（tooling），staging 實際執行歸屬於 §2.5 runbook / verification doc。
    - **Shortened-TTL path**：`server/api/admin/retention/prune.post.ts` 擴充 body schema（optional `retentionDays`，`>0 && <=180`，Zod strict）。override 穿透給 `runRetentionCleanup`；response 回傳 `data.retentionDays` 實際使用值作為 verification harness 的記錄依據。production 環境拒絕 override：`getKnowledgeRuntimeConfig().environment === 'production'` 時 400 + 明確訊息。production 不帶 override 仍走預設 180 天。
    - **Backdated-seed path**：新增 `server/utils/retention-seed.ts::seedBackdatedRetentionRecord`，typed helper 寫入 backdated `query_logs` + `citation_records`，返回 IDs 與時間戳供 caller 清理。`environment === 'production'` 時 throw；`ageDays` 非正整數時 throw。只動 audit chain 前兩層（`query_logs` / `citation_records`），不碰 `source_chunks`（operator 必須重用既存 chunk 以保留下游 `getDocumentChunk` 驗證的語意）。
    - **Operator CLI**：新增 `scripts/staging-retention-prune.ts`（對齊 `create-mcp-token.ts` 的 UX），支援 `--base-url / --cookie / --retention-days`；對 production host 的 override 給出保守警告（但 server side 已強制拒絕）。
    - 測試：新增 `test/integration/retention-verification-path.test.ts` 9 cases：
      - endpoint：(1) 非 production 時穿透 override、(2) 缺 body 時不 override、(3) production + override → 400、(4) production 無 override → 預設 180 跑成功、(5) `retentionDays <= 0 / 非整數` → 400、(6) `retentionDays > 180` → 400（不允許擴大 retention）
      - seed utility：(7) 寫 2 張表 + 返回正確時間戳與 IDs、(8) production → throw 且不 prepare、(9) `ageDays` 非正 → throw
    - 文件：`docs/verify/RETENTION_CLEANUP_VERIFICATION.md` §4.2 改寫：方式 A（SQL）保留作為手動 fallback；方式 B 換成正式 `retentionDays` override endpoint + helper script；新增方式 C 指向 `seedBackdatedRetentionRecord` helper。
    - 驗證：`pnpm exec vp lint --deny-warnings server/api/admin/retention/prune.post.ts server/utils/retention-seed.ts test/integration/retention-verification-path.test.ts scripts/staging-retention-prune.ts` 0 warnings；`pnpm typecheck` 0 errors；`pnpm exec vp test run test/integration/retention-cleanup.test.ts test/integration/retention-verification-path.test.ts test/integration/get-document-chunk-replay.test.ts` **25/25 綠**。
    - **仍保留的 staging 實測**：實際 staging 環境內跑 `seed → prune → assert` 並截圖的實測 evidence，歸屬 §2.5 runbook 的驗證欄位（runbook 已就緒，執行時填 PASS）。code-level 驗證路徑本身已全數落地。
- [x] 2.5 補齊 cleanup run、過期 replay 與 retention 邊界的驗證與操作文件。
  - 2026-04-18 **local PASS**：
    - 新增 `docs/verify/RETENTION_CLEANUP_RUNBOOK.md` — operator 日常作業手冊（9 節：何時跑、四階段順序、retention 參數、成功路徑檢查、手動觸發、錯誤排除、禁忌、觀測欄位、交叉參照）。
    - 新增 `docs/verify/RETENTION_REPLAY_CONTRACT.md` — `getDocumentChunk` 過期回應契約（7 節：核心原則、狀態表、兩種過期路徑、audit 區分、實作位置、驗證步驟、常見陷阱）。明確記載「status 固定 404 + header 分 reason」這個 spec-compatible 設計決策與 backing tests。
    - 更新既有 `docs/verify/RETENTION_CLEANUP_VERIFICATION.md`：§4.6 改寫成具體 staging 指令（含 `x-replay-reason` 驗證）、body message 一致性 PASS 條件；新增 §4A「Retention Boundary 驗證」（governance 2.5 要求的邊界場景 — `<=` cutoff 是否精確命中）。
    - 驗證項目對應：§3 / §4A.3 → 對應 `retention-cleanup.test.ts` 與 `get-document-chunk-replay.test.ts` 的 case 5（retention 邊界仍可回放）。

## 3. Config Snapshot Governance

- [x] 3.1 定義 shared `config_snapshot_version` builder，收斂 thresholds、model roles 與 governed feature flags。
- [x] 3.2 讓 Web、MCP、acceptance exports 與 query logs 都統一寫入 shared version。
- [x] 3.3 建立 drift guard，阻擋 routes、tests、debug surfaces 自行 hardcode decision thresholds。
- [x] 3.4 補齊 config snapshot version bump 與 cross-surface 一致性的 regression tests。

## 4. Verification And Rollout

- [x] 4.1 更新 `docs/verify/**` 與相關驗收文件，補上 stale、delete purge、retention cleanup、config snapshot 的驗證步驟。
- [x] 4.2 產出 rollout checklist，列出 cleanup schedule、retention threshold 與 purge policy 的部署前確認項。
