## Why

`../../workspace/report/versions/main-v0.0.36.md` 已經定義 `v1.0.0` 的系統邊界、驗收閉環與治理原則，但目前 repo 只有 Spectra 骨架與 Nuxt 初始頁面，還沒有可直接拿來規劃與實作的 change artifacts。若不先把報告整理成 proposal、design、specs 與 tasks，後續開發很容易在資料真相來源、權限規則與核心範圍上各自解讀。

## What Changes

- 建立第一個以報告為基準的 Spectra change，將 `v1.0.0` 核心閉環整理成可實作的能力切片與規格檔。
- 定義五個新能力：存取控制、文件匯入與發布、Web Agentic 問答、MCP 知識工具，以及治理與可觀測性。
- 記錄跨能力設計決策，包括 D1 + `normalized_text_r2_key` + `source_chunks` 的正式真相來源、staged upload / publish 流程、模型角色抽象、環境隔離與 Production feature flag 預設值。
- 產出依里程碑排序的 tasks，優先完成「文件發布 → Web 問答 → 引用回放 → current-version-only 驗證 → restricted 隔離 → redaction」六步最小閉環，再處理同版後置項。

## Non-Goals

- 本 change 不直接實作應用程式功能，只建立之後要用 `/spectra-apply` 落地的 artifacts。
- 本 change 不在此時鎖定實際 Workers AI 模型名稱，只保留 `models.defaultAnswer` 與 `models.agentJudge` 角色抽象。
- Passkey、`MCP-Session-Id`、Cloud fallback、管理儀表板、rich format 優先驗收與其他 `v1.0.0` 以外擴充項不納入核心閉環。

## Capabilities

### New Capabilities

- `knowledge-access-control`: Web Session、runtime allowlist、`allowed_access_levels` 與 Web/MCP 權限矩陣。
- `document-ingestion-and-publishing`: staged upload、版本快照、`source_chunks` 預建、同步 smoke 驗證與 atomic current publish。
- `web-agentic-answering`: 規則式 Query Normalization、驗證後檢索、信心分流、拒答與引用回放對應。
- `mcp-knowledge-tools`: 無狀態 Bearer token 工具面、scope 驗證、existence-hiding 與引用回放。
- `governance-and-observability`: 遮罩後日誌、`citation_records`、rate limit、保留期限與環境隔離。

### Modified Capabilities

(none)

## Impact

- Affected specs: `knowledge-access-control`, `document-ingestion-and-publishing`, `web-agentic-answering`, `mcp-knowledge-tools`, `governance-and-observability`
- Affected code: `openspec/config.yaml`, `nuxt.config.ts`, `wrangler.jsonc`, `server/db/schema.ts`, `.env.example`, `app/pages/**`, `app/middleware/**`, `server/**`, future `server/api/**`, `test/**`, `docs/manual-review-checklist.md`, `docs/manual-review-archive.md`
- Affected systems: Google OAuth, D1, R2, KV, Cloudflare AI Search, Workers AI, Nuxt MCP Toolkit, runtime config / Wrangler environment bindings

## 2026-04-16 補充：NuxtHub 整合

報告規格明確要求使用 NuxtHub 整合 D1/R2/KV，但目前 `nuxt.config.ts` 沒有安裝 `@nuxthub/core`，也沒有 `server/db/schema.ts`。原 1.1 任務只完成了 runtime config，DB schema 尚未建立。已將 1.1 拆分為：

- 1.1a Runtime Config（已完成）
- 1.1b NuxtHub & Drizzle Schema（新增，blocker 級任務）

## 2026-04-18 補充：AutoRAG Indexing Pipeline（解鎖 #B2 + #B3）

2026-04-18 驗收 #2 後半發現兩層實作缺口，使 publish 後的文件無法被 `/api/chat` 檢索到：

1. **#B2** — `syncDocumentVersionSnapshot` 後版本卡在 `index_status='preprocessing'`，沒有 code path 推進到 `indexed`，publish 必 409。
2. **#B3** — R2 物件從未帶 customMetadata，AutoRAG crawl 時看不到 filter / citation 所需 attributes；且 spec 設計上需要的 per-chunk R2 物件佈局目前是 per-document 寫法，架構不相容。

新增 Section 8 task group 處理 AutoRAG indexing pipeline 的實作，包含 R2 put customMetadata 支援、per-chunk 寫入改寫、AutoRAG sync 觸發、upload wizard indexing wait 與舊檔清理。此補充**不改 `specs/**/\*.md` 的 SHALL 語句\*\*，只是把實作對齊原本已 SHALL 的狀態機。

- Affected code（新增）：`server/utils/r2-object-access.ts`、`server/utils/document-sync.ts`、`server/api/uploads/presign.post.ts`、`server/api/uploads/finalize.post.ts`、`server/api/documents/sync.post.ts`、`app/components/documents/UploadWizard.vue`、新增 polling endpoint（若採 polling 方案）
- 詳細架構決策見 `design.md` → AutoRAG Indexing & R2 Custom Metadata 章節
