![image1](main-v0.0.35_assets/image1.jpeg)

國 立 雲 林 科 技 大 學

資 訊 管 理 系 人 工 智 慧 技 優 專 班

人工智慧實務專題成果報告

學號：B11123208

基於邊緣原生架構之

代理式檢索增強生成系統設計與實作

—以中小企業知識庫為例

學 生：楊鈞元

指導教授：潘得龍　博士

中華民國 115 年　月　日

# 中文摘要

本專題以中小企業知識庫問答為情境，規劃一套基於邊緣原生架構之代理式檢索增強生成系統，作為 ERP 操作指引、制度文件、報表說明與內部 SOP 的統一查詢入口。系統採 Hybrid Managed RAG 架構：檢索由 Cloudflare AI Search 負責，回答生成、拒答、引用組裝與審計治理由應用層 Agent 流程掌控，以兼顧部署可行性、治理可驗證性與後續擴充彈性。

在系統設計上，前端以 Nuxt 提供 Web 問答與管理後台，後端部署於 Cloudflare Workers，整合 D1、R2、KV、Workers AI 與 Vercel AI SDK。`v1.0.0` 先收斂於可部署、可驗證、可答辯的最小閉環：Google OAuth 與管理員 allowlist、文件上傳與版本管理、AI Search 同步、Web 問答、可回放引用，以及分階段補齊之 4 個無狀態 MCP Tools。正式回答一律以 D1 驗證 `active/indexed/current` 狀態，並以前處理階段預先建立的 `source_chunks` 作為 `citationId` 回放來源。

在問答決策上，本系統採分段式信心判斷：Query Normalization 僅做規則式標準化；第一輪檢索可使用 query rewrite；僅於邊界區間才由較強推理模型執行 answerability judge 與 Query Reformulation；若證據仍不足則拒答。驗證面將以分層資料集檢驗回答正確率、拒答精準率、引用正確率、MCP Tool 成功率、current-version-only 檢索正確性與遮罩完整性。Web 對話與 MCP 無狀態契約分流；核心驗收資料以 `md`、`txt` 與預先轉 Markdown 且經人工校閱之文件為主，正式模型名稱、套件版本、畫面截圖與統計數據待核心版完成後再依實證結果回填。

關鍵字：代理式檢索增強生成（Agentic RAG）、邊緣原生架構（Edge-Native）、Cloudflare AI Search、Self-Correction、Model Context Protocol（MCP）、規格驅動開發（SDD）

---

# 目錄

［待依正式頁碼產生目錄。］

---

# 符號與用詞索引

本索引兼具「技術縮寫對照」與「全文用詞一致性」兩種用途：縮寫類保留展開與說明；一般業務名詞則列明本報告正文、使用者介面（UI）、資料庫欄位、API 契約四層的採用寫法，避免同一概念在不同章節以不同中英文敘述。實作與正文若出現衝突，以本索引為準。

## 一、技術縮寫與平台名詞

| 縮寫/符號       | 全稱                                   | 說明                                                |
| --------------- | -------------------------------------- | --------------------------------------------------- |
| RAG             | Retrieval-Augmented Generation         | 檢索增強生成，結合外部知識檢索與 LLM 回應生成。     |
| Agentic RAG     | Agentic Retrieval-Augmented Generation | 由代理流程主動控制檢索、評估、重試與拒答之 RAG。    |
| LLM             | Large Language Model                   | 大型語言模型。                                      |
| MCP             | Model Context Protocol                 | 標準化 AI Client 與外部工具互動的協定。             |
| SSE             | Server-Sent Events                     | 用於串流回應。                                      |
| RBAC            | Role-Based Access Control              | 以角色為基礎的存取控制模型。                        |
| PII             | Personally Identifiable Information    | 可識別個人身分之敏感資料。                          |
| AI Search       | Cloudflare AI Search                   | Cloudflare 受管理搜尋服務，原 AutoRAG。             |
| D1              | Cloudflare D1                          | Cloudflare 的 SQLite 相容資料庫服務。               |
| R2              | Cloudflare R2                          | Cloudflare 物件儲存服務。                           |
| KV              | Cloudflare KV                          | Cloudflare 鍵值型儲存服務，適合快取與速率限制。     |
| Passkey         | Passkey / WebAuthn Credential          | 無密碼登入機制，以公開金鑰憑證完成驗證。            |
| Self-Correction | Self-Correction Loop                   | 首次檢索不足時，由 Agent 重寫查詢並重試一次的流程。 |
| WCAG            | Web Content Accessibility Guidelines   | W3C 無障礙內容指引，本報告以 AA 等級為設計目標。    |

## 二、業務名詞用詞對照（跨正文 / UI / DB / API）

| 中文用詞 | 英文對照          | 正文採用 | UI 顯示  | DB 欄位 / API 契約                                     | 備註                                                            |
| -------- | ----------------- | -------- | -------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| 引用     | Citation          | 引用     | 引用     | `citation_records`、`citations[].citationId`           | 行內引用 `【引1】`、卡片稱「引用卡片」。                        |
| 拒答     | Refusal / Refused | 拒答     | 拒答     | `refused: boolean`、`status = 'refused'`               | UI 不用「無法回答」。                                           |
| 管理員   | Admin             | 管理員   | 管理員   | `role_snapshot = 'admin'`、MCP scope `admin.*`         | UI 一律繁中。                                                   |
| 成員     | Member            | 成員     | 成員     | `role_snapshot = 'member'`                             | B16 scope 擴張新增；取代既有 `'user'` 角色的語意。              |
| 訪客     | Guest             | 訪客     | 訪客     | `role_snapshot = 'guest'`                              | 指已登入未通過 admin 升格者；未登入者不使用此稱呼。             |
| 文件     | Document          | 文件     | 文件     | `documents` 表、`documentId`                           | 不用「檔案」（檔案對應 R2 物件層）。                            |
| 版本     | Version           | 版本     | 版本     | `document_versions`、`versionLabel`                    | Current 版本一律標「current 版」。                              |
| 分類     | Category          | 分類     | 分類     | `documents.category_slug`、`category`                  | 不與「標籤」混用（標籤屬後續 scope）。                          |
| 敏感等級 | Access Level      | 敏感等級 | 敏感等級 | `access_level ∈ { internal, restricted }`              | UI 顯示「內部」「受限」兩中文對應；正文保留英文值。             |
| 同步     | Sync              | 同步     | 同步     | `sync_status`、`/api/documents/sync`                   | 指 AI Search ingestion，不與「拉取」混用。                      |
| 發布     | Publish           | 發布     | 發布     | `publishDocumentVersion`、`published_at`               | 切 current 版本的動作；不用「上架」。                           |
| 下架     | Archive           | 下架     | 下架     | `documents.status = 'archived'`、`archive` endpoint    | 不用「刪除」（刪除為 hard delete 專指 draft-never-published）。 |
| 信心分數 | Confidence Score  | 信心分數 | 不顯示   | `confidence_score`（observability-and-debug 階段擴充） | v1.0.0 UI 不對一般使用者展示。                                  |
| 檢索分數 | Retrieval Score   | 檢索分數 | 不顯示   | `retrieval_score`                                      | 同上，僅 admin / debug mode 才顯示。                            |

## 三、用詞規則

1. **同一概念不得中英混用**：報告正文、UI 文案、技術設計文件均採上表「正文採用」欄；英文名稱僅在首次出現或技術上下文（API、DB 欄位）使用。
2. **縮寫首次出現必須展開**：例如首次出現 RAG 應寫「檢索增強生成（RAG）」。
3. **DB 欄位與 API 契約保留英文**：欄位名、JSON key、enum 值使用英文並以行內程式碼（如 `role_snapshot`、`refused: true`）呈現，不翻為中文。
4. **禁止用詞**：「帳號」（避免與 admin 帳戶混淆，改用「使用者」或「成員」；例外：`Google 帳號`、`帳戶`、測試情境中的業務名詞如「員工薪資帳號」可保留）、「後台」（改用「管理介面」或「管理後台」統一用後者）、「上架」（用「發布」）、「刪除文件」（僅指 hard delete draft；下架請用「下架」）。

---

# 圖表目錄

本報告全文圖表合計 46 張（含新增表 4-2 痛點對照與表 C-1 答辯示範劇本），依編排規範列出圖表索引如下。頁碼以正式排版後為準。

表 1-1 v1.0.0 實作範圍與先後順序 .....................................

表 1-2 實作前平台能力確認與通過條件 .....................................

表 1-3 開工前必須凍結項目 .....................................

表 1-4 佔位內容與回填時機 .....................................

表 2-1 主要 Actor 與使用案例 .....................................

表 2-2 查詢類型判定規則 .....................................

表 2-3 retrieval_score 構成項目 .....................................

表 2-4 confidence_score 構成項目 .....................................

表 2-5 user_profiles 資料表 .....................................

表 2-6 documents 資料表 .....................................

表 2-7 document_versions 資料表 .....................................

表 2-8 source_chunks 資料表 .....................................

表 2-9 （保留編號）同步任務狀態以 `document_versions.sync_status` 承擔，不另建 ingestion_jobs .....................................

表 2-10 conversations 資料表（Drizzle schema 已定義，migration 列為 governance-refinements 階段交付）.....................................

表 2-11 messages 資料表 .....................................

表 2-12 query_logs 資料表 .....................................

表 2-13 citation_records 資料表 .....................................

表 2-14 mcp_tokens 資料表 .....................................

表 2-15 內部 REST API 方法清單 .....................................

表 2-16 MCP v1.0.0 核心 Tools .....................................

表 2-17 Agent 模型角色分工 .....................................

表 2-18 第一輪檢索預設參數 .....................................

表 2-19 Self-Correction 重試參數 .....................................

表 2-20 共享設定常數與 feature flag .....................................

表 2-21 分段式決策門檻 .....................................

表 2-22 文件生命週期狀態轉移規則 .....................................

表 2-23 開發里程碑與週次規劃 .....................................

表 2-24 allowed_access_levels 存取矩陣 .....................................

表 2-25 部署環境與組態真相來源 .....................................

表 2-26 與純雲端 LLM 方案比較 .....................................

表 2-27 平台限制與因應方式 .....................................

表 2-28 效能與品質驗收指標 .....................................

表 3-1 硬體環境規格 .....................................

表 3-2 軟體環境版本 .....................................

表 3-3 開發工具版本 .....................................

表 3-4 系統功能模組說明 .....................................

表 3-5 核心測試情境設計 .....................................

表 3-6 實測情境彙總表（回填） .....................................

表 3-7 TC 逐案測試結果表（回填） .....................................

表 3-8 EV 補充證據項目 .....................................

表 4-1 驗收對照項目清單 .....................................

表 4-2 中小企業 ERP 痛點與本系統產品特色對照 .....................................

表 A-1 MCP scope 授權對照 .....................................

表 A-2 MCP 錯誤碼定義 .....................................

表 B-1 seed 測試資料集 .....................................

表 C-1 答辯示範劇本步驟 .....................................

---

# 第一章 開發計畫

## 第一節 發展的動機

### 1.1.1 中小企業 ERP 使用的痛點

企業資源規劃系統通常涵蓋採購、庫存、銷售、財務、人事與報表等多個模組。對中小企業而言，ERP 的主要問題往往不是資料不足，而是既有資料與操作知識無法被快速取用。常見痛點包括以下幾項：

- 學習成本高：系統模組多、流程複雜，新進人員常需仰賴操作手冊與資深同仁帶領。
- 知識分散：SOP、FAQ、規章、教育訓練教材與報表說明分散在不同路徑，查找效率不佳。
- 知識傳承困難：隱性操作經驗難以制度化，當人員異動時容易產生斷層。
- 問題定位耗時：使用者知道問題類型，卻不一定知道正確關鍵字或文件名稱。

### 1.1.2 傳統 RAG 系統的採用障礙

RAG 能透過外部知識檢索降低生成式模型的幻覺風險，已廣泛被視為企業知識問答的可行模式。然而，傳統自建 RAG 對中小企業而言仍有數項採用障礙。[1][2][3]

- 人才門檻高：需同時具備文件處理、Embedding、向量檢索、回應生成與維運能力。
- 維運成本高：若自建向量資料庫與索引流程，需持續處理資料同步、重建索引與監控告警。
- 回答品質不穩：單次靜態檢索在模糊查詢、縮寫、同義詞與跨文件比較場景下容易失準。
- 治理難度高：若直接把所有資料交給單一雲端模型，會產生資料外送、權限控管與審計紀錄不足等問題。

### 1.1.3 Serverless 邊緣運算帶來的機會

近年來 Serverless 與邊緣運算平台逐漸成熟，使中小企業能以較低門檻部署智慧應用。以 Cloudflare 生態系為例，Workers、D1、R2、KV、Workers AI 與 AI Search 已能構成從資料儲存到檢索、推論與對外介面的完整服務鏈。[5][6][7][8][9]

- 零伺服器維運：應用部署與擴展由平台負責，降低主機管理負擔。
- 邊緣近用：回應可在接近使用者的位置產生，有利於降低體感延遲。
- 原生整合：資料庫、物件儲存、Session、AI 推論與搜尋能以同平台方式整合。
- 彈性計費：早期可先以低流量驗證，待需求成形再放大。

### 1.1.4 混合式架構的必要性

儘管邊緣推論能力持續提升，企業知識問答仍需在「成本、穩定性、治理、品質」之間取得平衡。若完全自建檢索管線，實作與維運成本偏高；若完全交由受管理 RAG 一次完成檢索與生成，則在拒答策略、引用格式、自定義審計與外部互操作方面的控制力會降低。因此，本專題採取 Hybrid Managed RAG 策略：[7]

- 檢索底層交由 Cloudflare AI Search 處理，使文件同步、轉換、分塊與檢索能力由受管理服務承擔。
- 回應生成與決策規則留在自建 Agentic Orchestration，使置信度評估、查詢重寫、引用組裝與拒答機制由應用層掌控。
- Cloud fallback 保留為條件式能力，但預設關閉，只有在治理條件通過且 feature flag 啟用時才可使用。

## 第二節 專題目的

### 1.2.1 技術架構面

- 規劃並分階段實作一套基於 Nuxt 4、NuxtHub 與 Cloudflare 邊緣服務的企業知識庫問答系統。[11][12]
- 建立以 Cloudflare AI Search 為檢索底層、以角色型模型常數（`models.defaultAnswer` / `models.agentJudge`）為決策與生成層的 Hybrid Managed RAG 架構；`v1.0.0` 核心閉環先以 fallback 合成器取代實際模型呼叫，Vercel AI SDK 與 Workers AI 實際接入列為 `observability-and-debug` 階段擴充。
- 實作包含規則式 Query Normalization、Self-Correction 單次重試、拒答與引用追溯的完整問答流程；answerability judge 以 `retrieval_score >= answerMin` 與證據數量的結構式判斷承擔，判斷型 LLM 呼叫列為同版後置。
- 以 Nitro 原生 event handler 實作 MCP Server 的 4 個核心 Tools，並統一透過 `Authorization: Bearer` + scope 控管；後續若升級為 `@nuxtjs/mcp-toolkit` 或原生 MCP runtime，亦須維持同一組 scope 與治理契約。[4][15][16][17]

### 1.2.2 安全設計面

- 以 better-auth 整合 Google OAuth，建立單租戶、雙角色的登入與存取控制機制；Passkey 不納入 `v1.0.0`。[13][20]
- `v1.0.0` 以部署環境變數 `ADMIN_EMAIL_ALLOWLIST` 作為管理員名單真相來源；管理員權限判定一律以當前 Session 內之正規化 email 對 allowlist 重新計算，D1 僅同步角色快照與 `admin_source = allowlist` 供 UI 與稽核使用，不另建 allowlist 資料表。
- 以 Bearer token、scope、到期時間與撤銷機制保護 MCP 對外存取，且所有請求皆需經 HTTPS/TLS 1.3 傳輸。[21]
- 將敏感資料過濾、記錄遮罩與外部模型治理邊界納入正式規格，而非實作後補強。

### 1.2.3 驗證與營運面

- 建立可追溯的查詢日誌、引用紀錄、MCP 呼叫紀錄與設定快照版本，作為後續驗證依據；管理統計儀表板列為 `v1.0.0` 同版後置項。
- 明確區分「回答正確率」與「正確拒答率」，避免以模糊指標掩蓋系統失誤。
- 以正式測試集驗證 Web 與 MCP 兩種使用通道是否符合相同的回答品質要求。
- 以 `current-version-only` 雙閘驗證、可回放 `citationId` 與 Web/MCP 契約分流，形成本專題的三項核心設計貢獻。

### 1.2.4 研究問題

綜合上述目標，本研究在實作前聚焦以下三項核心研究問題，以對應檢索治理、回答品質與對外互操作三類驗證面向。[7][15][16]

- RQ1：在以 Cloudflare AI Search 作為受管理檢索底層時，是否能透過 D1 post-verification 與 `source_chunks` 設計，同時維持 `current-version-only` 與可回放引用？
- RQ2：以 `retrieval_score`、answerability judge 與單次 Self-Correction 組成的分段式問答流程，是否能在中小企業知識問答情境兼顧回答正確率與拒答精準率？
- RQ3：將 Web 對話持久化與 MCP 無狀態契約分流，是否能兼顧使用體驗、權限治理與審計可追溯性？

## 第三節 專題需求

### 1.3.1 專題簡介

本系統以企業知識庫問答為核心，服務範圍與需求如下。

目標用戶：

- 一般使用者：查詢 SOP、制度、報表欄位意義、操作步驟與名詞說明。
- 系統管理員：維護知識庫文件、管理版本、查看查詢日誌、管理 MCP token。
- 外部 AI Client：透過 MCP Tool 使用知識查詢、問答與引用追溯能力。

`v1.0.0` 的完整範圍與開始實作時的先後順序如下：

表 1-1 v1.0.0 實作範圍與先後順序

| 分類     | `v1.0.0` 首批必做                                                                                                                                                           | `v1.0.0` 同版後置                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 身分驗證 | Google OAuth、User/Admin 角色、部署環境變數 `ADMIN_EMAIL_ALLOWLIST`                                                                                                         | Admin 路由與管理介面的細節優化                                    |
| 知識管理 | 一次性 signed URL 上傳至 R2、版本管理、`source_chunks` 預建、AI Search 同步、文件狀態管理、`is_current` 發布規則；核心驗收資料集優先採 `md`、`txt` 或預先轉 Markdown 之文件 | 管理後台統計摘要、進階營運檢視與 rich format 條件支援擴充         |
| 問答流程 | 規則式 Query Normalization、AI Search 檢索、分段式置信度評估、Self-Correction、拒答、引用顯示、Web 對話歷史                                                                 | Debug 分數面板、非核心 UI 細節與延遲調校                          |
| MCP 介面 | `askKnowledge`、`getDocumentChunk`、Bearer token、`knowledge.restricted.read` scope、無狀態呼叫                                                                             | `searchKnowledge`、`listCategories`、token 管理 UI 與安裝指引補完 |
| 可觀測性 | 遮罩後 `query_logs`、`source_chunks` / `citation_records`、最小必要決策路徑與設定快照版本                                                                                   | 管理統計儀表板、延遲趨勢圖、保留期限自動化報表                    |

開始實作時，應先完成可部署、可驗證、可答辯的 Web 核心閉環，再補齊仍屬 `v1.0.0` 的同版後置項。

若時程或平台能力與規格衝突，應優先確保 `v1.0.0` 可部署、可驗證、可答辯；同版後置項不得反客為主。

建置順序以 Web 問答主線優先，MCP Tools 應共用同一套檢索、引用與治理核心，不得為了趕進度而形成兩套邏輯。

因此，本報告在實作前的主要任務，不是把所有可能延伸能力都寫成既定成果，而是先確認哪些規則屬於答辯與落地都不可退讓的核心契約，哪些細節則應保留到 Preview 驗證與實作收斂後再鎖定。

以下項目不納入 `v1.0.0`：

- Passkey。
- `MCP-Session-Id` 與 MCP 多輪上下文。
- 條件式 Cloud fallback 與外部模型備援。
- 不直接寫回 ERP 交易資料或執行關鍵商務操作。
- 不處理多租戶隔離與租戶計費。
- 不納入 LINE Login。
- 不實作每文件、每群組或欄位層級 ACL；僅提供 `internal` / `restricted` 二級粗粒度存取。

圖 1-1 系統功能圖（待製作）

圖面規劃重點：

- 圖型：樹狀結構圖
- 圖名：企業知識庫 Agentic RAG 系統功能圖
- 應呈現內容：
  1. 使用者端：自然語言問答、對話歷史、引用查看、拒答提示
  2. 管理後台：文件 CRUD、版本管理、查詢紀錄檢視、AI Search 同步、MCP token 管理
  3. Agentic 核心：置信度評估、Query Reformulation、Self-Correction、拒答判斷
  4. MCP 介面：`searchKnowledge`、`askKnowledge`、`getDocumentChunk`、`listCategories`
  5. 以虛線標示後續延伸能力，避免與 `v1.0.0` 核心閉環混淆
- 呈現原則：以清楚區分核心功能與延伸能力為主，避免加入與驗收無關的裝飾性細節

### 1.3.2 專題架構

本系統採四層式邊緣原生架構，分為前端層、資料與受管理檢索層、Agentic AI 層與 MCP 層。整體原則為「檢索受管理、回答自建、治理先行、核心優先」。

圖 1-2 系統架構圖（待製作）

圖面規劃重點：

- 圖型：四層水平分層圖
- 圖名：Hybrid Managed RAG 邊緣原生系統架構圖
- 應呈現內容：
  1. 前端層：Nuxt 4、Nuxt UI；`@ai-sdk/vue` `useChat` 串流介面列為 `observability-and-debug` 階段擴充
  2. 資料與受管理檢索層：Cloudflare Workers、NuxtHub、Drizzle ORM、D1、R2、KV、Cloudflare AI Search
  3. Agentic AI 層：以角色型模型常數（`models.defaultAnswer` / `models.agentJudge`）描述決策路由；`v1.0.0` 以 fallback 合成器承擔答案生成，Vercel AI SDK 與 `workers-ai-provider` 實際接入列為後續版本擴充
  4. MCP 層：Nitro 原生 event handler、Middleware、Bearer Auth；`@nuxtjs/mcp-toolkit` 或 Cloudflare 原生 MCP 列為後續升級選項
  5. 右側以虛線標示後續延伸能力（含 Vercel AI SDK、workers-ai-provider、mcp-toolkit），避免與 `v1.0.0` 核心架構混寫
  6. 以單一 Cloudflare Edge 邊界框包覆四層，強調邊緣優先與核心版不預設相依於額外跨雲 LLM API

架構說明如下：

- 前端層：使用 Nuxt 4 與 Nuxt UI 建立問答介面、管理後台與設定頁。`v1.0.0` 使用者以 Google OAuth 登入，並在同一前端中存取各自權限允許的對話歷史與文件管理頁。[11][12][17]
- 資料與受管理檢索層：以 R2 儲存原始文件與版本檔，D1 儲存結構化資料，KV 作為快取與 rate limit 計數器；Web Admin 文件上傳採應用層簽發一次性 signed URL 後直傳 R2。應用層需先將原始檔轉為正規化文字快照並寫入 `normalized_text_r2_key`，再以固定切分規則預建 `source_chunks`，作為引用回放真相來源。Cloudflare AI Search 連接既定資料來源後，負責 Markdown 轉換、分塊、Embedding、query rewriting、reranking 與 retrieval；應用層先以 metadata filter 套用 `status = active` 與可見 `access_level`，必要時可附帶 `version_state = current` 作為快篩提示，但不將遠端 metadata 視為發布真相來源。正式回答前一律以 D1 驗證 `document_version_id` 是否仍符合 `documents.status = active`、`document_versions.index_status = indexed` 與 `document_versions.is_current = true`，並要求 AI Search 回傳候選片段可對應至既有 `source_chunks`。D1 與正規化文字快照才是 current-version-only 與引用回放的正式真相來源，AI Search metadata 與供應商 chunk 僅作快篩、檢索與觀測用途。[7][15]
- Agentic AI 層：回答生成與流程控制由應用層掌握。`v1.0.0` 先以角色型抽象定義 `models.defaultAnswer` 與 `models.agentJudge` 兩類模型，實作階段以 fallback 合成器（結合去重後的有效證據片段）承擔答案輸出；實際 Workers AI 模型接入與 Vercel AI SDK 串流列為 `observability-and-debug` 階段擴充，接入後仍沿用同一組角色常數與路由規則。第一輪檢索後，系統計算 `retrieval_score`；僅在邊界區間才呼叫 judge，`v1.0.0` judge 以「有效證據數量 ≥ 1 且 `retrieval_score >= answerMin`」的結構式判斷回傳 `{ shouldAnswer, reformulatedQuery? }`，後續可無痛替換為真 LLM 判斷。若 judge 回傳 `reformulatedQuery`，則由應用層重送一次檢索並再次評估；單文件、明確、程序型或事實型回答路由到 `models.defaultAnswer`，跨文件整合（目前以「有效證據涵蓋 >= 2 份不同文件」判定）則路由到 `models.agentJudge`。條件式 Cloud fallback 不納入 `v1.0.0` 核心驗收。
- MCP 層：以 Nitro 原生 event handler 建立 4 個核心 MCP 端點，透過統一 Middleware 驗證 Bearer token 與 scope。`v1.0.0` 的 MCP 採無狀態呼叫，不建立 `MCP-Session-Id` 相依性；Web 對話與 MCP 工具契約因此分別對應「D1 持久化對話輔助」與「單次請求契約」。若後續版本導入多輪上下文，runtime state 仍應保存於 KV，而非與 Web 對話混寫；若升級 MCP runtime 至 `@nuxtjs/mcp-toolkit` 或 Cloudflare 原生 MCP，仍須維持同一組 scope 與治理契約。[4][15][16]

雖然 Cloudflare AI Search 已提供 public endpoint 與原生 MCP 能力，[7][26][28] 本專題 `v1.0.0` 仍選擇在應用層自建 MCP。主因是正式回答前必須統一經過 D1 `active/indexed/current` 驗證、`restricted` scope 檢查、`source_chunks` 可回放引用對應與遮罩後查詢日誌；若直接暴露供應商原生 MCP 端點，將難以保證 Web 與 MCP 共用同一套發布真相與審計規則。

Cloudflare AI Search 每個 instance 最多支援 5 個 custom metadata 欄位。[7][24] 本系統 `v1.0.0` 固定保留 4 個核心欄位：`document_version_id`、`category`、`status`、`access_level`；`version_state` 僅於需要輔助管理後台觀測或同步檢查時作為第 5 個選用欄位，不作正式回答的硬性判斷依據。其中 `document_id` 與 `version_no` 不再額外占用 custom metadata，而是由 `folder = /kb/{category}/{document_id}/v{version_no}/` 路徑策略與 D1 回推。此設計是為了符合 AI Search custom metadata 上限，同時保留分類篩選、版本追蹤與資料治理判斷。`documents.tags` 僅保留於 D1 供管理後台管理與後續延伸，不同步至 AI Search，也不作為 `v1.0.0` MCP 對外檢索契約參數。

### 1.3.3 實作前確認事項與最小可行閉環

本文雖已建立完整答辯骨架，但真正開始實作前，仍需先把「平台能力確認」與「核心閉環收斂」分開處理。若把所有候選能力一次視為既定需求，容易在實作前半段即因模型、SDK 或 rich format 品質變動而重寫規格。

表 1-2 實作前平台能力確認與通過條件

| 面向       | 實作前確認事項                                                                                           | `v1.0.0` 通過條件                                                                                    | 若未通過之降階原則                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 檢索介面   | 確認 AI Search 在目標環境可穩定提供搜尋 API 或 Workers binding，並回傳足以做 D1 post-verification 的欄位 | 可對指定 `document_version_id` 完成 smoke query，取得分數、必要 metadata 與可用候選片段              | 先保留 Web 問答、管理後台同步與引用回放能力為核心閉環；`searchKnowledge` / `listCategories` 等 MCP 對外包裝與進階 filter 可延後到核心檢索穩定後再接入 |
| 引用回放   | 確認驗收資料集的候選片段可穩定對應至既有 `source_chunks`                                                 | 用於驗收與答辯的 current 文件皆能通過 smoke retrieval 與 `citationId` 回放                           | 核心驗收資料集先限 `md`、`txt` 或預先轉 Markdown 之文件；`pdf`、`docx` 改為條件支援                                                                   |
| 模型可用性 | 確認 Workers AI 於部署當下至少存在一個低延遲回答模型與一個較強判斷／整合模型                             | Preview 環境能完成 direct path、judge 與 Self-Correction 三條路徑，且實際模型名稱已鎖定至設定檔      | 以角色型常數 `models.defaultAnswer` / `models.agentJudge` 維持規格，待可用模型穩定後再回填實際名稱                                                    |
| 範圍收斂   | 確認 `v1.0.0` 先完成可展示的最小閉環，而非一次完成所有優化項                                             | 至少完成「文件發布 → Web 問答 → 引用回放 → current-version-only 驗證 → 權限隔離 → 查詢日誌」六步閉環 | 延後 debug 視覺化、進階調校與非核心 UI 細節，不得為了展示而先做不納入本版之能力                                                                       |

`v1.0.0` 最小可行閉環如下：

1. Admin 上傳並發布一份 `internal` 文件，使其成為 current version。
2. Web User 針對 current 文件提問，系統回傳含有效引用的回答。
3. `getDocumentChunk` 可回放其中至少一筆引用。
4. 同一文件切到新版本後，舊版內容不再出現在正式回答。
5. 未具 `knowledge.restricted.read` 之 MCP token 與一般 Web User 均不得讀取 `restricted` 內容。
6. `query_logs` 與 `messages` 可證明高風險輸入未以原文持久化。

上述閉環中的「引用回放」屬核心能力，而非可有可無的 MCP 外層功能。實作順序可先以內部驗證流程或測試 harness 確認 `citationId` 回放，再於核心檢索穩定後接上 `getDocumentChunk`；但 `v1.0.0` 正式驗收與答辯版仍須補齊 4 個無狀態 MCP Tools。

若時程受壓，`v1.0.0` 的刪減順序應為：先延後 debug 分數面板與管理摘要視覺化，再延後 rich format 直接 ingestion，最後才縮減 MCP 以外的輔助功能；不得先刪 current-version-only、引用回放、權限隔離與遮罩記錄等核心治理能力。

### 1.3.4 實作啟動凍結與回填邊界

為避免把答辯稿中的佔位內容誤判為開始實作的阻礙，本節將「開工前必須凍結」與「實作後再回填」明確分開。開始實作前，只需凍結首批範圍、資料模型、決策常數與治理 invariant；圖面、實測數據與結論不得反向綁架開工排程。

表 1-3 開工前必須凍結項目

| 面向     | 開工前必須凍結                                                                                                                                                         | 不可退讓 invariant                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 版本真相 | `documents.status`、`document_versions.index_status`、`is_current` 與 publish transaction                                                                              | 只有 `active/indexed/current` 可進入正式回答，且每份文件僅允許一個 current                                                |
| 引用真相 | `normalized_text_r2_key`、deterministic `source_chunks`、`citationId` 回放契約                                                                                         | 正式回答只可引用既有 `source_chunks`；無有效引用不得形成正式回答                                                          |
| 存取治理 | Web 角色、MCP scope、`allowed_access_levels` 與 existence-hiding                                                                                                       | 未授權不得讀取 `restricted` 內容；`getDocumentChunk` 必須再次驗證 scope                                                   |
| 記錄治理 | `messages.content_redacted`、`query_logs.risk_flags_json` / `redaction_applied` / `status`（`v1.0.0` 無 `content_text`、`message_state` 欄位，原文零落地為結構性保障） | 高風險輸入不得以原文落地，也不得回到後續模型上下文；`content_text` / `message_state` 屬 `governance-refinements` 階段擴充 |
| 通道邊界 | Web 對話持久化與 MCP 無狀態契約分流                                                                                                                                    | `v1.0.0` 不接受 `MCP-Session-Id`，亦不啟用 Passkey 與 Cloud fallback                                                      |

下列佔位內容屬實作後回填，不阻擋開始實作：

表 1-4 佔位內容與回填時機

| 佔位內容                                   | 回填時機                   | 是否阻擋開始實作 |
| ------------------------------------------ | -------------------------- | ---------------- |
| 目錄、圖表目錄與正式頁碼                   | 定稿排版時                 | 否               |
| 圖 1-1 至圖 2-4 與第三章介面截圖           | 圖面完成或核心閉環穩定後   | 否               |
| 套件小版本與實際模型名稱                   | 第一次可重現通過核心閉環時 | 否               |
| 第三章實測結果、第四章驗收狀態與第五章心得 | 實作與驗證完成後           | 否               |

因此，只要首批必做與上述 invariant 已凍結，即可放行開始實作；同版後置項與回填項可隨核心閉環完成後逐步補齊。

## 第四節 預期效益

對使用者：

- 以自然語言提問取代手動翻找文件，提高操作問題的定位效率。
- 透過引用與片段回看機制，降低對黑盒式回答的不信任感。
- 在問題資訊不足時得到明確拒答與補充方向，而非錯誤但自信的回答。

對中小企業：

- 以邊緣原生架構降低基礎設施管理複雜度，將維運工作集中在知識內容與權限治理。
- 以 AI Search 接手文件處理與檢索基礎流程，減少自建向量基礎設施的負擔。
- 透過 MCP 提供標準化知識能力，讓未來 AI 助理整合不必重新設計私有 API。
- 以不預設額外跨雲 LLM API 的 `v1.0.0` 核心版降低資料外送風險，後續若擴充外部模型再由治理閘道控管。

對技術社群：

- 提供 Cloudflare AI Search、Workers AI、Nuxt MCP Toolkit 與 better-auth 的整合規格範例。
- 示範如何把受管理檢索服務與自建 Agent 決策流程分層，避免責任邊界混亂。
- 提供專題報告在實作前階段的規格化寫法，讓後續回填測試資料與截圖時有一致基準。

本節效益為設計預期，不宣稱既有成效；成本節省比例、延遲改善幅度與使用者效益須待第三章與第四章之正式驗證結果回填後方可定論。

---

# 第二章 分析與設計

本章以支撐實作前決策為目標。內容可分為兩類：其一是 `current-version-only`、引用回放、授權隔離與記錄遮罩等不可退讓的核心規則；其二是會隨平台版本、SDK 與部署環境微調的實作細節。前者應先定清，後者則保留調整空間，但不得破壞核心契約。

## 第一節 分析

### 2.1.1 使用案例分析

圖 2-1 使用案例圖（待製作）

圖面規劃重點：

- 圖型：UML Use Case 圖
- 主要 Actor：
  - 一般使用者（User）
  - 系統管理員（Admin）
  - 外部 AI Client（External Agent）
- Use Case：
  - 提問並獲得回答
  - 查看對話歷史
  - 查看引用來源
  - 追問多輪對話
  - 上傳文件
  - 建立文件新版本
  - 觸發 AI Search 同步
  - 查看查詢日誌與觀測摘要
  - 建立與撤銷 MCP token
  - 呼叫 `searchKnowledge`
  - 呼叫 `askKnowledge`
  - 呼叫 `getDocumentChunk`
  - 呼叫 `listCategories`
- 補充要求：
  - Admin 可視為繼承 User 的所有一般使用功能
  - `提問並獲得回答` 應以 `<<include>>` 連到 `置信度評估`
  - `置信度評估` 應以條件流程標示可進入 `Self-Correction`

主要 Actor 與使用案例摘要如下：

表 2-1 主要 Actor 與使用案例

| Actor          | Use Case                | 說明                                                  |
| -------------- | ----------------------- | ----------------------------------------------------- |
| User           | 提問並獲得回答          | 輸入自然語言問題，取得含引用與拒答能力的回答          |
| User           | 查看對話歷史            | 回顧過往問答紀錄與引用資訊                            |
| User           | 追問多輪對話            | 基於現有對話上下文延伸提問                            |
| Admin          | 上傳文件                | 建立文件與初始版本，上傳原始檔至 R2                   |
| Admin          | 建立新版本              | 為既有文件建立新版本並重新同步至 AI Search            |
| Admin          | 觸發 AI Search 同步     | 發動 instance 級同步流程，更新索引狀態                |
| Admin          | 查看查詢日誌與觀測摘要  | 檢視延遲、引用、拒答、Self-Correction 與 MCP 使用概況 |
| Admin          | 管理 MCP token          | 建立、檢視、撤銷 Bearer token 與 scope                |
| External Agent | 呼叫 `searchKnowledge`  | 以檢索方式取得片段結果                                |
| External Agent | 呼叫 `askKnowledge`     | 以問答方式取得回答與引用                              |
| External Agent | 呼叫 `getDocumentChunk` | 以 `citationId` 取得完整引用片段                      |
| External Agent | 呼叫 `listCategories`   | 取得知識庫分類列表與數量                              |

### 2.1.2 問答流程分析

本系統採固定主線的 Agentic RAG 問答流程，明確區分「AI Search 負責檢索」與「應用層負責回答生成」。`v1.0.0` 將三層查詢處理責任凍結為：`Query Normalization` 僅做規則式標準化、不呼叫模型；第一輪檢索可使用 AI Search 的 `rewrite_query`；只有在證據不足且值得重試時，才由 `models.agentJudge` 執行一次 Query Reformulation。此設計可避免三層改寫互相覆蓋，並使延遲與責任邊界保持可驗證。[7]

圖 2-2 Agentic RAG 問答活動圖（待製作）

圖面規劃重點：

- 圖型：UML Activity Diagram
- 主流程節點依序為：
  1. 使用者提問
  2. 規則式 Query Normalization
  3. 權限、敏感資料與查詢類型檢查
  4. 呼叫 AI Search 搜尋 API
  5. `retrieval_score` 評估
  6. 邊界區間 answerability judge
  7. 分支 A：直接回答
  8. 分支 B：Query Reformulation 後重試一次
  9. 分支 C：拒答
  10. 既有 `source_chunks` 查找、`citation_records` 組裝與串流輸出
- 圖中應明示：
  - Query Normalization 不呼叫模型
  - 第一輪檢索 `rewrite_query = true`
  - 第二輪重試 `rewrite_query = false`
  - `status = active`
  - `access_level in allowed_access_levels`
  - `version_state = current` 若存在，僅作快篩提示，不作最終發布真相來源
  - `answerability judge 僅於中段分數時觸發`
  - 跨文件比較至少需 2 份不同文件證據
  - `最多 1 次重試`
  - `v1.0.0` 不啟用 Cloud fallback

問答流程與 `v1.0.0` 初版預設值如下：

1. **使用者提問**：前端 Web 或 MCP Client 傳入自然語言問題。
2. **Query Normalization**：系統僅以規則式方式標準化空白、同義詞、常見 ERP 縮寫、日期寫法與分類篩選條件，不呼叫模型，也不在此階段改寫問題語意。
3. **權限、敏感資料與查詢類型檢查**：在任何模型推論前，先對查詢進行敏感資料檢測，依 Web User／Web Admin／MCP scope 推導本次 `allowed_access_levels`，並標示問題屬於簡單事實查詢、模糊查詢、跨文件比較或 Web 多輪追問。
4. **第一輪 AI Search 檢索**：呼叫 AI Search 搜尋 API，只取回片段不直接生成回答。實作上應優先採新 REST API 或 Workers binding 封裝，而非直接綁定舊 AutoRAG 路徑。`v1.0.0` 初版預設參數為 `max_num_results = 8`、`ranking_options.score_threshold = 0.35`、`rewrite_query = true`，並強制套用 `status = active` 與 `access_level in allowed_access_levels`；若遠端 metadata 已同步 `version_state`，可額外帶入 `version_state = current` 作為快篩提示，但不得把它視為發布真相。若實作採用 Workers binding 或 REST API 封裝，參數名稱可依 SDK 調整，但應以應用層抽象欄位 `retrieval.maxResults`、`retrieval.minScore`、`retrieval.queryRewrite`、`retrieval.filters` 作為內部契約，避免不同 SDK 名稱直接滲入業務規格。[25][26] 取得候選片段後，應用層必須先以 D1 驗證 `document_version_id` 仍符合 `active/indexed/current` 可用版本，未通過者一律視為無效證據。
5. **第一階段置信度評估**：`v1.0.0` 以通過遠端 metadata 與 D1 current 驗證之候選片段，計算 `mean_top3_score` 作為 `retrieval_score`；完整 `top1_score`、`evidence_coverage`、`cross_document_gate_failed` 加權公式列為 `observability-and-debug` 階段擴充。
6. **直接回答條件**：若 `retrieval_score >= 0.70` 且未觸發跨文件硬門檻失敗，則不再呼叫 judge，直接進入回答生成。`v1.0.0` 固定模型路由如下：`simple_fact`、`single_document_procedural` 與僅依單一已驗證文件延續的 Web 多輪追問，由 `models.defaultAnswer` 生成最終答案；跨文件比較、比較／彙整題與需兩份以上文件整合者，由 `models.agentJudge` 生成最終答案。
7. **邊界區間 judge**：若 `0.45 <= retrieval_score < 0.70`，則由 `models.agentJudge` 進行一次 answerability judge，並以固定 JSON schema 回傳 `answerability_judge: number (0..1)`、`should_answer: boolean`、`reason: string`，再合成最終 `confidence_score`。
8. **Self-Correction 條件**：若 `confidence_score < 0.55`、`retrieval_score < 0.45`，或跨文件硬門檻未通過，且 `retry_count = 0`，並且滿足以下任一條件，則由 `models.agentJudge` 重寫查詢後重試一次：`(a)` 至少存在一筆通過遠端 metadata 與 D1 驗證的候選片段可供重寫；`(b)` Query Normalization 已偵測到明確遺漏實體、縮寫未展開或日期條件不完整。第二輪重試停用 AI Search `rewrite_query`，避免雙重改寫失真。
9. **拒答條件**：若第二輪後仍 `confidence_score < 0.55`，或檢索結果無足夠引用，或跨文件比較仍未取得至少 2 份不同文件證據，或在授權後可用證據集合中仍無足夠有效證據，則回傳拒答結果與補充建議。
10. **引用組裝與記錄**：系統只可引用發布階段預先建立之 `source_chunks`；回答階段不得臨時補建 `source_chunks`。若候選片段無法對應既有 `citationId`，該片段視為無效證據，不得進入正式回答。正式回答時僅建立本次查詢的 `citation_records`、寫入遮罩後 `query_logs`，並將回答以串流方式輸出。若後續版本導入 Cloud fallback，亦不得繞過上述引用驗證與資料治理流程。

查詢類型的判定規則如下：

表 2-2 查詢類型判定規則

| 類型         | 判定條件                                                           | 用途                                   |
| ------------ | ------------------------------------------------------------------ | -------------------------------------- |
| 簡單事實查詢 | 單一名詞定義、單一流程步驟、單一文件即可回答                       | 優先走 direct path                     |
| 模糊查詢     | 問題缺少明確實體、日期、縮寫展開或文件名稱                         | 可觸發 Self-Correction                 |
| 跨文件比較   | 問題包含比較、差異、彙整，或回答至少需兩份文件支持                 | `required_distinct_document_count = 2` |
| Web 多輪追問 | 同一 `conversationId` 下出現「那個」「第二步」「剛剛提到」等指代語 | 僅 Web `v1.0.0` 支援                   |

補充判定原則：

- `web_followup` 只有在「上一則持久化 assistant 訊息之有效引用經 D1 重算後仍全部落在同一 `document_id`，且該文件仍存在 current 版本」時，才可沿用單文件 follow-up 路由；否則一律重新分類為 `ambiguous` 或 `cross_document_comparison`。
- 若上一則 assistant 訊息沒有有效引用、只留下 `rejected_marker` / `redacted_only`，或引用文件已非 current，該次追問不得直接走單文件 follow-up 快路徑。

`v1.0.0` 將 `retrieval_score` 收斂為「通過 D1 post-verification 後的前三名有效片段 `score` 平均值」，避免在實作端同時維護加權公式、跨文件硬門檻與 judge 合成分數三層變量。完整加權版本（`top1 / mean_top3 / evidence_coverage` 加權 + `cross_document_gate_failed` 硬門檻）列為 `observability-and-debug` 階段擴充：

表 2-3 retrieval_score 構成項目

| 版本                           | 組成                                                                                                                | 備註                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `v1.0.0` 實作版                | `mean_top3_score` = 通過 `allowed_access_levels` 與 D1 post-verification 之前三名片段 `score` 平均                  | 若無有效片段則為 `0`；目的在於以最少假設取得單一分數，供 direct / judge / refuse 三分支判斷                           |
| `observability-and-debug` 擴充 | `0.50 * top1_score + 0.30 * mean_top3_score + 0.20 * evidence_coverage`，並套用 `cross_document_gate_failed` 硬門檻 | `evidence_coverage` = `0.60 * evidence_sufficiency + 0.25 * document_diversity_score + 0.15 * verification_integrity` |

`confidence_score` 在 `v1.0.0` 不獨立計算：進入邊界區間時，由 judge 回傳的結構化 `{ shouldAnswer, reformulatedQuery? }` 直接決定走 `direct` 或 `self_corrected`，若都不成立則 `refused`；`confidence_score = 0.80 * retrieval_score + 0.20 * answerability_judge` 的合成版本列為 `observability-and-debug` 階段擴充，屆時搭配 `query_logs.judge_triggered` / `answerability_judge_score` / `confidence_score` 欄位一起導入。

查詢類型分類（`simple_fact` / `single_document_procedural` / `cross_document_comparison` / `ambiguous` / `web_followup` / `policy_blocked`）以及「跨文件比較 `required_distinct_document_count = 2`」硬門檻列為 `governance-refinements` 階段交付；`v1.0.0` 以「有效證據涵蓋 `>= 2` 份不同文件 → 路由到 `models.agentJudge`；否則 → 路由到 `models.defaultAnswer`」的結構式條件承擔回答模型路由責任，並以 judge 失敗時的 `reformulatedQuery` 承擔 Self-Correction 進場條件。上述門檻值 `0.35`、`0.45`、`0.55`、`0.70` 皆為 `v1.0.0` 初版預設值，屬部署設定而非對外 API 契約；正式上線前僅可依 `seed` 與獨立 `dev-calibration` 案例校準，`frozen-final` 正式驗收集凍結後不得再回頭調整門檻或路由規則。

`v1.0.0` 實作版偽碼：

```text
verified_evidence =
  results.filter(result =>
    matches_required_remote_filters(result) &&
    d1_confirms_active_current(result.document_version_id)
  )

mean_top3_score =
  verified_evidence.length === 0
    ? 0
    : average(
        verified_evidence.slice(0, 3).map(result => result.score)
      )

retrieval_score = mean_top3_score // v1.0.0 凍結為此單一指標

if retrieval_score >= thresholds.directAnswerMin:
  decision = 'direct'
elif retrieval_score < thresholds.judgeMin:
  decision = 'refused'
else:
  judgement = models.agentJudge({
    evidence: verified_evidence,
    query: query,
    retrieval_score: retrieval_score,
  })
  if judgement.shouldAnswer:
    decision = 'judge_pass'
  elif judgement.reformulatedQuery:
    second_pass = retrieve({
      query: judgement.reformulatedQuery,
      allowed_access_levels: allowed_access_levels,
    })
    if mean_top3_score(second_pass) >= thresholds.directAnswerMin:
      decision = 'self_corrected'
    else:
      decision = 'refused'
  else:
    decision = 'refused'
```

實作端的 `models.defaultAnswer` / `models.agentJudge` 常數對應的 fallback 合成器與結構式判斷器，可於 `observability-and-debug` 階段替換為真 LLM 呼叫，不影響上述判斷流程。

## 第二節 設計

### 2.2.1 資料庫設計

本系統使用 D1（SQLite）儲存應用層的結構化資料，並以 Drizzle ORM 管理資料模型。為避免資料責任邊界混亂，本節刻意將「AI Search 管理的檢索資料」與「應用層必須保留的治理資料」區分開來。better-auth 所需的底層認證資料表由套件自動產生，以下 ER 與資料表設計聚焦在專題核心領域資料，不展開所有 auth 系統內部表。[13][14]

圖 2-3 ER 圖（待製作）

圖面規劃重點：

- 圖型：Crow's Foot ER Diagram
- 實體應至少包含：
  - `better_auth_users`（better-auth 核心表，以淡色或虛線表示）
  - `user_profiles`
  - `documents`
  - `document_versions`
  - `source_chunks`
  - `conversations`（Drizzle schema 已定義，migration 屬後續階段擴充；圖中以淡色表示）
  - `messages`
  - `query_logs`
  - `citation_records`
  - `mcp_tokens`
- 關聯重點：
  - `better_auth_users` 1─1 `user_profiles`
  - `user_profiles` 1─N `documents`
  - `documents` 1─N `document_versions`
  - `document_versions` 1─N `source_chunks`
  - `user_profiles` 1─N `conversations`（migration 屬後續階段擴充，圖中以虛線表示）
  - `conversations` 1─N `messages`
  - `query_logs` 1─N `citation_records`
  - `source_chunks` 1─N `citation_records`
  - `user_profiles` 1─N `mcp_tokens`
- 註記要求：
  - `document_versions.ai_search_file_id` 與 AI Search 索引項目對應
  - `source_chunks.id` 為對外公開之可回放 `citationId`
  - `citation_records.id` 僅為單次查詢中的引用快照紀錄，不對外公開

#### 2.2.1.1 核心資料表設計

**user_profiles（應用層使用者設定）**

表 2-5 user_profiles 資料表

| 欄位             | 類型                       | 說明                                                           |
| ---------------- | -------------------------- | -------------------------------------------------------------- |
| id               | string (PK)                | 使用者識別碼，對應 better-auth `user.id`                       |
| email_normalized | string (unique)            | 正規化後 email，作為 allowlist 比對與稽核索引                  |
| display_name     | string, nullable           | 顯示名稱                                                       |
| role_snapshot    | enum ('user', 'admin')     | 目前角色快照；授權時仍須以 Session email 對 allowlist 重新計算 |
| admin_source     | enum ('none', 'allowlist') | 管理員身分來源；`v1.0.0` 僅 `allowlist` 一種升權路徑           |
| created_at       | timestamp                  | 建立時間                                                       |
| updated_at       | timestamp                  | 更新時間                                                       |

補充規則：

- `v1.0.0` 不建立 `admin_allowlists` 資料表；部署環境變數 `ADMIN_EMAIL_ALLOWLIST` 為管理員名單真相來源。
- 使用者完成 Google OAuth 後，應用層依 `email_normalized` 是否命中 allowlist 決定 `role_snapshot` 與 `admin_source`，並同步至 `user_profiles`。
- Admin 專屬路由與管理後台操作在授權時，不得僅信任 `role_snapshot`；仍須以目前 Session email 對正規化 allowlist 重新判定，避免 allowlist 異動後殘留舊權限。
- `auth_source`、`status`（啟用／停用）欄位列為 `admin-ui-post-core` 階段擴充；`v1.0.0` 以 allowlist 控管入口權限，停用使用者改由 better-auth 的 `banned` 欄位承擔。

**documents（文件）**

表 2-6 documents 資料表

| 欄位               | 類型                                         | 說明                                                        |
| ------------------ | -------------------------------------------- | ----------------------------------------------------------- |
| id                 | string (PK)                                  | 文件唯一識別碼                                              |
| slug               | string (unique)                              | 可讀分享碼，用於 URL 與 `listCategories` 對外顯示           |
| title              | string                                       | 文件標題                                                    |
| category_slug      | string                                       | 文件分類標識（slug）                                        |
| access_level       | enum ('internal', 'restricted')              | 敏感等級                                                    |
| status             | enum ('draft', 'active', 'archived')         | 文件狀態                                                    |
| current_version_id | string (FK → document_versions.id), nullable | 目前 current 版本指標；由發布流程維護，與 `is_current` 對齊 |
| created_by_user_id | string (FK → user_profiles.id), nullable     | 建立者                                                      |
| created_at         | timestamp                                    | 建立時間                                                    |
| updated_at         | timestamp                                    | 更新時間                                                    |
| archived_at        | timestamp, nullable                          | 下架時間                                                    |

補充規則：

- `title` 可於不改變檢索語意之前提下直接更新，不強制重同步。
- `category_slug` 與 `access_level` 屬會影響 AI Search metadata 與檢索過濾的發布級欄位；若文件已有 `indexed` 版本，變更後必須立即排入目標 current 版本之 metadata refresh / reindex 工作流程，並於管理後台標示「待同步」。
- `documents.status` 以 D1 為立即生效真相來源；即使遠端 metadata 尚未同步完成，`archived` 仍須立刻阻止正式回答；`archived_at` 作為下架時間戳，供稽核與保留期限計算使用。
- `documents.status = draft` 的文件版本可先完成同步與 smoke retrieval 驗證，但不得執行 publish；首次發布前必須先切為 `active`。
- `documents.status = archived` 時，不要求立即清空歷史 `is_current` 指標，但所有正式檢索、`listCategories`、Web 問答與 MCP 回答皆必須排除 archived 文件；若日後重新啟用，仍須由管理員顯式確認 current 版本或重新 publish。
- `current_version_id` 屬衍生欄位，發布 transaction 必須同步更新 `documents.current_version_id` 與對應 `document_versions.is_current = 1`；兩者一旦不一致，以 `document_versions.is_current` 為準並排程修復。
- 版本建立後，其 `source_r2_key`、`folder` 與 `metadata_json` 視為版本快照；後續即使 `documents.category_slug` 調整，也不得回寫舊版路徑快照，而應以新的同步快照反映差異。
- `documents.tags` 欄位列為 `admin-ui-post-core` 階段擴充；`v1.0.0` 透過 `category_slug` 承擔檢索面的分類過濾需求，不同步 `tags` 至 AI Search custom metadata。

**document_versions（文件版本）**

表 2-7 document_versions 資料表

| 欄位                    | 類型                                                                           | 說明                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| id                      | string (PK)                                                                    | 版本唯一識別碼                                                                                                                     |
| document_id             | string (FK → documents.id, ON DELETE CASCADE)                                  | 所屬文件                                                                                                                           |
| version_number          | integer                                                                        | 版本號，與 `document_id` 組成 `(document_id, version_number)` 唯一索引                                                             |
| source_r2_key           | string                                                                         | 原始檔於 R2 的路徑                                                                                                                 |
| normalized_text_r2_key  | string, nullable                                                               | 正規化文字快照於 R2 的路徑；未完成前處理時為 `null`，成為 `source_chunks` 建立、對應驗證與重新發布之真相來源                       |
| metadata_json           | json                                                                           | 同步至 AI Search 的中繼資料與版本顯示快照；至少需含 custom metadata、`folder` 路徑，以及供引用卡片 / `getDocumentChunk` 使用之快照 |
| smoke_test_queries_json | json                                                                           | 由前處理產生之代表性 smoke probes；供發布前檢索與對應驗證使用                                                                      |
| index_status            | enum ('upload_pending', 'preprocessing', 'smoke_pending', 'indexed', 'failed') | 版本可發布性真相；`upload_pending` 代表 R2 直傳完成但尚未前處理，`preprocessing` 代表正在建立 `normalized_text` 與 `source_chunks` |
| sync_status             | enum ('pending', 'running', 'completed', 'failed')                             | AI Search 遠端同步任務狀態；與 `index_status` 組成 `v1.0.0` 的同步任務狀態機，取代獨立 `ingestion_jobs` 表                         |
| is_current              | boolean                                                                        | 是否為目前啟用版本；以 SQLite partial unique index 保證「每 document 僅一筆 `is_current = 1`」                                     |
| published_at            | timestamp, nullable                                                            | 最近一次成為 current 版本的時間                                                                                                    |
| created_at              | timestamp                                                                      | 建立時間                                                                                                                           |
| updated_at              | timestamp                                                                      | 最近更新時間                                                                                                                       |

補充約束：

- `(document_id, version_number)` 組成唯一索引；每份文件僅允許一筆 `is_current = 1`，由 partial unique index `idx_document_versions_current_per_document` 保證。
- 發布流程需在單一 transaction 中完成舊版降級與新版升級，並同步寫回 `documents.current_version_id` 與 `document_versions.published_at`。
- `metadata_json` 需明確保存實際送往 AI Search 的 custom metadata 與 `folder` 路徑快照，避免 D1 與遠端設定脫鉤。
- `normalized_text_r2_key` 對應的內容必須可重現後續 `source_chunks`；若前處理規則變更，需重新產生快照；前處理規則版本以 `metadata_json.ingestion_profile_version` 欄位承載，不獨立佔資料表欄位。
- `smoke_test_queries_json` 必須與 `normalized_text_r2_key`、切塊規則同批產生，且發布後視為該版本驗證快照的一部分；至少需覆蓋標題、關鍵名詞與程序片段 3 類 probe，每筆 probe 至少含 `query`、`intent`、`expected_source_chunk_ids` 與 `min_expected_hits`，不得只保存裸字串。
- `published_at` 僅能在成功切換為 `is_current = 1` 時寫入；發布者（`published_by`）與上傳檔案稽核資訊（`checksum`、`mime_type`、`size_bytes`、`ai_search_file_id`、`indexed_at`）列為 `admin-ui-post-core` + `observability-and-debug` 階段擴充，`v1.0.0` 以 `metadata_json` 承載上傳稽核快照、以 `query_logs.user_profile_id` + `request_id` 推論發布者身分。
- 若同一對話曾引用舊版文件，版本切換後不得把舊 assistant 回答視為新的知識真相；後續追問仍需重新檢索 current 版本。

**source_chunks（引用回放來源）**

表 2-8 source_chunks 資料表

| 欄位                | 類型                                                  | 說明                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id                  | string (PK)                                           | 用於回放已引用片段的 `citationId`，對外為 opaque、高熵、不可猜測之 ID，且在 retention window 內必須全域唯一；`v1.0.0` 僅保證能回放既有引用，不保證跨版本或跨重切塊後維持相同值 |
| document_version_id | string (FK → document_versions.id, ON DELETE CASCADE) | 所屬文件版本                                                                                                                                                                   |
| chunk_index         | integer                                               | 應用層保存之穩定順序；`(document_version_id, chunk_index)` 組成唯一索引，作為固定切分規則的 deterministic locator                                                              |
| chunk_hash          | string                                                | 正規化 chunk 文字後的雜湊                                                                                                                                                      |
| chunk_text          | text                                                  | 由 `normalized_text_r2_key` 切出的完整片段文字快照，供 `getDocumentChunk` 回放                                                                                                 |
| citation_locator    | string                                                | 人類可讀定位資訊（heading path / 段落序 / 片段位置），供引用卡片顯示；不作為主要比對鍵                                                                                         |
| access_level        | enum ('internal', 'restricted')                       | 來自所屬文件版本的敏感等級快照；作為 MCP 與 Web 授權過濾的第二層保障                                                                                                           |
| metadata_json       | json                                                  | AI Search 觀測欄位快照（`ai_search_file_id`、`ai_search_chunk_id`、供應商 locator、短摘錄）；屬非核心欄位，欄位結構可隨供應商演進                                              |
| created_at          | timestamp                                             | 建立時間                                                                                                                                                                       |

補充規則：

- `(document_version_id, chunk_index)` 組成唯一索引；`v1.0.0` 以應用層固定切分規則保證 `chunk_index` 單調遞增，承擔 `locator_hash` 去歧義責任。供應商觀測欄位（`ai_search_file_id` / `ai_search_chunk_id` / 供應商 locator）改為存入 `metadata_json`，獨立的 `locator_hash`、`locator_json`、`excerpt_preview` 欄位列為 `observability-and-debug` 階段擴充。
- `citationId` 不得採連號、可推導路徑或可逆編碼；建議使用 UUIDv7、ULID 或等價高熵識別碼，避免外部以枚舉方式猜測有效引用。
- 若同一文件版本內出現完全相同文字片段，系統必須以 `chunk_index` + `citation_locator` 去歧義，不得僅以 `chunk_hash` 合併。
- `source_chunks` 由 `normalized_text_r2_key` 依固定切分規則預先建立，不以列舉供應商 chunk 作為前提。
- AI Search 回傳候選片段時，應以正規化文字比對、`chunk_hash` 與 `document_version_id` 對應到既有 `source_chunks`；若無法對應，該片段不得作為正式引用。
- 若供應商重切塊或自動轉檔結果改變，影響的是對應結果而非 `source_chunks` 真相來源；若對應率無法達標，應重新前處理並重新發布驗證。
- `source_chunks` 必須於前處理階段預先建立完成；未完成者，該版本不得進入 `smoke_pending`。
- 正式回答階段只可查找既有 `source_chunks` 並建立 `citation_records`，不得在回答流程臨時補建。
- 已發布版本的 `source_chunks` 與 `chunk_text` 視為不可變快照；reindex 僅能更新 `metadata_json` 觀測欄位或建立新版本，不得覆寫既有引用證據。
- 一旦某筆 `citationId` 已出現在 `citation_records`，在 retention window 內不得重用到其他片段，即使原文件版本已非 current 亦同。
- 已被 `citation_records` 引用之 `source_chunks` 視為審計證據，不因版本切換、文件下架或 maintenance reindex 而立即刪除；`getDocumentChunk` 應在 retention window 內回放當次引用快照。

#### 2.2.1.2 引用回放來源建立策略

為讓 `citationId` 在供應商 chunk ID 變動、reindex 或 rich format 轉檔差異下仍可回放，`v1.0.0` 採「應用層 canonical text + deterministic segmentation」策略：

1. 原始檔上傳後，先由應用層產出單一正規化文字快照，寫入 `normalized_text_r2_key`。
2. `md` / `txt` 直接正規化；`pdf` / `docx` 需先轉為可檢查之文字快照，確認段落、標題與主要表格文字未嚴重缺失後，才可進入後續流程。
3. 應用層以固定切分規則（標題層級、段落邊界、最大字數與最小字數）預先建立 `source_chunks`，並一次產生 `chunk_index`、`citation_locator`、`chunk_hash`、opaque `citationId` 與 `smoke_test_queries_json`；供應商觀測欄位（`ai_search_file_id` / `ai_search_chunk_id` / 供應商 locator）寫入 `source_chunks.metadata_json` 以便後續比對。
4. `smoke_test_queries_json` 至少需包含 3-5 筆代表性 probes，覆蓋文件標題／章節名、核心名詞或欄位名，以及一段可被程序型問句命中的內容；其來源必須可由 `normalized_text_r2_key` 重現。
5. smoke retrieval 的目的不是列舉供應商所有 chunk，而是驗證 AI Search 實際回傳之候選片段能否對應到既有 `source_chunks`。凡 `smoke_test_queries_json` 中通過權限與分數過濾的候選片段，皆必須能成功對應，否則該版本不得發布。
6. `v1.0.0` 不要求不同版本、不同 reindex 或不同切塊條件下沿用相同 `citationId`；只要求同一已發布版本中的引用可穩定回放且可稽核。

**同步任務狀態（v1.0.0 不獨立建表）**

`v1.0.0` 不建立獨立的 `ingestion_jobs` 資料表，而是以 `document_versions.index_status` 與 `document_versions.sync_status` 兩欄組成同步任務狀態機，以避免「版本可發布性真相」與「同步任務進度真相」跨表同步難題。設計權衡如下：

| 責任             | `v1.0.0` 承擔欄位                        | 狀態取值                                                                                                  |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 版本可發布性真相 | `document_versions.index_status`         | `upload_pending` → `preprocessing` → `smoke_pending` → `indexed` / `failed`                               |
| 同步任務進度真相 | `document_versions.sync_status`          | `pending` → `running` → `completed` / `failed`                                                            |
| 同步任務稽核資料 | `document_versions.metadata_json` 子欄位 | `ai_search_job_id`、`error_message`、`started_at`、`completed_at` 以 JSON 欄位保存，便於延伸而不改 schema |

補充規則：

- 同一 `document_version_id` 同時間僅允許一組 `sync_status ∈ (pending, running)` 的進行中任務；重複觸發同步請求應回傳既有進行中狀態或 `409`，不得重複排程。
- AI Search 遠端同步完成後，任務先進入 `smoke_pending`；只有 smoke retrieval 通過，`index_status` 才可推進為 `indexed`、`sync_status` 推進為 `completed`。
- smoke retrieval 屬維運用驗證流程，需以目標 `document_version_id` 的 `smoke_test_queries_json` 執行候選片段檢查，並確認可建立 `source_chunks` 對應；若目標版本原先尚未 `indexed`，驗證失敗時 `index_status` 與 `sync_status` 皆應標記為 `failed`；若屬已 `indexed` 版本之 maintenance reindex，僅 `sync_status` 標記為 `failed`，`index_status` 仍維持最近一次可服務之 `indexed` 狀態。
- 獨立 `ingestion_jobs` 資料表（含 `sync_scope`、歷史任務列表、跨版本同步批次）列為 `observability-and-debug` 階段擴充；屆時可平滑將 `metadata_json` 中的任務稽核資料遷移至獨立表。

**conversations（Web 對話）**

表 2-10 conversations 資料表

| 欄位            | 類型                                     | 說明                                                                                                   |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| id              | string (PK)                              | 對話唯一識別碼                                                                                         |
| user_profile_id | string (FK → user_profiles.id), nullable | 關聯使用者                                                                                             |
| access_level    | enum ('internal', 'restricted')          | 對話內目前最高敏感等級；若任一持久化 assistant 訊息引用 `restricted` 證據，整段對話標記為 `restricted` |
| title           | string                                   | 對話標題                                                                                               |
| created_at      | timestamp                                | 建立時間                                                                                               |
| updated_at      | timestamp                                | 最後更新時間                                                                                           |
| deleted_at      | timestamp, nullable                      | 使用者刪除對話之時間；一旦設定即不得再出現在一般列表、詳情 API 或後續模型上下文                        |

補充規則：

- 讀取對話列表與詳情時，必須依目前身分重新檢查 `conversations.access_level`。使用者若失去 `restricted` 權限，原 `restricted` 對話不得再顯示於列表或詳情 API。
- 使用者刪除對話後，該對話應立即自一般 UI、一般 API 與後續多輪上下文排除；若仍需保留稽核資料，亦僅限遮罩後副本與必要事件 metadata。
- 刪除流程若保留審計資料，對話標題與可還原原文的內容欄位應於刪除時硬刪除、清空或等價地轉為不可回復狀態，不得以一般使用者權限再次讀取。
- **實作狀態**：`conversations` 資料表之 Drizzle schema 已於 `server/db/schema.ts` 宣告；對應 migration 與 `/api/conversations` CRUD 列為 `governance-refinements` 階段交付，屆時補上 `0003_add_conversations.sql` 與對話 API。在此之前，`/api/chat` 暫不接受 `conversationId`，每次 `v1.0.0` Web 問答皆為單輪、無持久化對話歷史。

**messages（訊息）**

表 2-11 messages 資料表

| 欄位              | 類型                                            | 說明                                                                                           |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| id                | string (PK)                                     | 訊息唯一識別碼                                                                                 |
| query_log_id      | string (FK → query_logs.id, ON DELETE SET NULL) | 對應的查詢日誌，承擔「同一輪請求鏈」串接責任（取代 `request_id` 字串欄位）                     |
| user_profile_id   | string (FK → user_profiles.id), nullable        | 關聯使用者                                                                                     |
| channel           | enum ('web', 'mcp')                             | 來源通道                                                                                       |
| role              | enum ('system', 'user', 'assistant', 'tool')    | 訊息角色                                                                                       |
| content_redacted  | text                                            | 唯一持久化內容欄位；高風險輸入命中時僅保留遮罩後副本，通過安全檢查之輸入則保存其遮罩版本供稽核 |
| risk_flags_json   | json                                            | 命中之敏感資料規則清單                                                                         |
| redaction_applied | boolean                                         | 是否已完成記錄遮罩                                                                             |
| created_at        | timestamp                                       | 建立時間                                                                                       |

補充規則：

- `v1.0.0` **不保留原文欄位 `content_text`**：任何寫入 `messages` 的內容都先經遮罩管線處理並寫入 `content_redacted`，形成「原文零落地」的結構性保障，直接滿足 A11。`message_state = persisted / redacted_only / rejected_marker` 的三態語意改由 `query_logs.status` 與 `risk_flags_json` 承擔，`messages` 層不再細分。
- 前端遇到拒答或遮罩訊息時，僅可顯示固定占位訊息與遮罩後摘要，不得回顯原始輸入。
- 同一輪 Web 問答以 `query_log_id` 串起 user / assistant `messages` 與 `query_logs`；若因高風險規則在模型前拒答，`query_logs.status = 'blocked'` 並保留 `query_log_id` 關聯。
- Web 多輪上下文、`conversation_id` 串接與 stale 判定列為 `governance-refinements` 階段交付；屆時另以獨立 migration 加上 `conversation_id`、`content_text`、`message_state`、`citations_json`、`model_name`、`metadata_json` 欄位，並建立 stale 重算流程。
- 完整觀測欄位（`request_id` 獨立字串、`citations_json`、`model_name`、`metadata_json`）列為 `observability-and-debug` 階段擴充。

**query_logs（查詢日誌）**

表 2-12 query_logs 資料表

| 欄位                       | 類型                                                | 說明                                                                                                                               |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| id                         | string (PK)                                         | 日誌唯一識別碼；同時承擔「單次請求鏈」串接責任，取代獨立 `request_id` 欄位                                                         |
| channel                    | enum ('web', 'mcp')                                 | 來源通道                                                                                                                           |
| user_profile_id            | string (FK → user_profiles.id), nullable            | 關聯使用者                                                                                                                         |
| mcp_token_id               | string (FK → mcp_tokens.id), nullable               | 來源 token；僅 `mcp` 通道有值                                                                                                      |
| environment                | enum ('local', 'staging', 'production')             | 部署環境，供跨環境稽核分流                                                                                                         |
| query_redacted_text        | text                                                | 唯一持久化查詢文字欄位；已完成正規化 + 遮罩                                                                                        |
| risk_flags_json            | json                                                | 敏感資料、權限與政策標記                                                                                                           |
| allowed_access_levels_json | json                                                | 推導後 `allowed_access_levels`（例：`["internal"]`、`["internal","restricted"]`）                                                  |
| redaction_applied          | boolean                                             | 是否已完成記錄遮罩                                                                                                                 |
| config_snapshot_version    | string                                              | 本次查詢採用之規格常數與 feature flags 版本；`v1.0.0` 固定寫入 `"v1"`                                                              |
| status                     | enum ('accepted', 'blocked', 'rejected', 'limited') | 請求治理結果；`accepted` 對應正常結束（含業務拒答）、`blocked` 對應高風險政策阻擋、`rejected` 對應 401/403/422、`limited` 對應 429 |
| created_at                 | timestamp                                           | 建立時間                                                                                                                           |

補充規則：

- `query_logs.id` 同時作為 `request_id`：同一輪問答的 `messages.query_log_id`、`citation_records.query_log_id` 均指向此 ID，不另建字串 `request_id` 欄位。
- `status` 承擔先前分離的 `request_outcome` / `refused` / `http_status` 語意：業務拒答（`refused = true`）仍屬 `accepted`（治理流程順利完成），由 `messages.role = assistant` + `risk_flags_json` 佐證；`rejected` 僅代表授權或驗證未通過；`blocked` 保留給高風險政策阻擋。
- 詳細觀測欄位（`operation_name`、`query_type`、`original_query_masked`、`normalized_query_masked`、`reformulated_query_masked`、`retrieval_filters_json`、`retrieval_round_count`、`top_k`、`verified_result_count`、`distinct_verified_document_count`、`cross_document_gate_failed`、`retrieval_score`、`judge_triggered`、`answerability_judge_score`、`confidence_score`、`decision_path`、`self_correction_triggered`、`refusal_reason_code`、`answer_model`、`decision_trace_json`、`http_status`、`first_token_latency_ms`、`completion_latency_ms`）列為 `observability-and-debug` 階段擴充，以獨立 migration `0004_add_query_log_observability.sql` 加上欄位與索引；`v1.0.0` 以 `query_redacted_text` + `risk_flags_json` + `allowed_access_levels_json` + `status` 承擔治理稽核的最小必要欄位。
- `config_snapshot_version` 固定為 `"v1"`；版本遞增由 `governance-refinements` 階段接手，屆時每次門檻或 feature flag 變動皆需遞增，並於 Preview / Production 重新跑過驗收再升版。
- 若請求在檢索前即被 `401` / `403` / `422` 或高風險政策阻擋終止，`status` 取 `rejected` 或 `blocked`；擴充後新增的 `retrieval_*`、`confidence_score`、`decision_path`、`answer_model` 等欄位允許為 `null`。

**citation_records（引用紀錄）**

表 2-13 citation_records 資料表

| 欄位                | 類型                                           | 說明                                                                                                       |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| id                  | string (PK)                                    | 引用快照唯一識別碼                                                                                         |
| query_log_id        | string (FK → query_logs.id, ON DELETE CASCADE) | 所屬查詢                                                                                                   |
| document_version_id | string (FK → document_versions.id)             | 當次回答引用之版本快照                                                                                     |
| source_chunk_id     | string (FK → source_chunks.id)                 | 對應引用回放來源                                                                                           |
| citation_locator    | string                                         | 當次引用的人類可讀定位資訊快照，與 `source_chunks.citation_locator` 對應                                   |
| chunk_text_snapshot | text                                           | 當次引用片段全文快照；即使 `source_chunks` 被更新或版本下架，retention window 內仍可回放此快照             |
| created_at          | timestamp                                      | 建立時間                                                                                                   |
| expires_at          | timestamp                                      | 保留到期時間，由 `v1.0.0` 保留期限設定（預設 180 天）推算；`getDocumentChunk` 於 retention window 內可回放 |

補充規則：

- `chunk_hash`、`locator_hash`、`ordinal`、`excerpt`、`score` 欄位列為 `observability-and-debug` 階段擴充；`v1.0.0` 以 `chunk_text_snapshot` + `citation_locator` 承擔「可稽核 + 可回放」的最小必要快照，分數與序號資訊改由 `query_logs` 的 observability 欄位在擴充後承接。
- `expires_at` 必須在建立 `citation_records` 時由 `config_snapshot_version` 對應的 retention 設定推算寫入；retention cleanup 批次僅依 `expires_at <= now()` 執行實體刪除。

**mcp_tokens（MCP Bearer token）**

表 2-14 mcp_tokens 資料表

| 欄位           | 類型                                    | 說明                                                               |
| -------------- | --------------------------------------- | ------------------------------------------------------------------ |
| id             | string (PK)                             | Token 唯一識別碼                                                   |
| name           | string                                  | 顯示名稱（取代先前 `label`）                                       |
| token_hash     | string (unique)                         | 雜湊後 token 值                                                    |
| scopes_json    | json                                    | 權限範圍陣列                                                       |
| environment    | enum ('local', 'staging', 'production') | 該 token 綁定之部署環境，避免 staging token 在 production 直接可用 |
| status         | enum ('active', 'revoked', 'expired')   | 狀態                                                               |
| expires_at     | timestamp, nullable                     | 到期時間                                                           |
| last_used_at   | timestamp, nullable                     | 最後使用時間                                                       |
| revoked_at     | timestamp, nullable                     | 撤銷時間                                                           |
| revoked_reason | text, nullable                          | 撤銷原因描述                                                       |
| created_at     | timestamp                               | 建立時間                                                           |

補充規則：

- `issued_to_user_id`、`revoked_by`、`created_by`、`updated_at` 欄位列為 `admin-ui-post-core` 階段擴充；`v1.0.0` 以 `query_logs.mcp_token_id` + `query_logs.user_profile_id`（管理員發放行為亦以 web 通道登記）承擔稽核串接責任，並於 `revoked_reason` 內以自由文字紀錄重要背景。
- `v1.0.0` 的 MCP 採無狀態呼叫，因此不建立 `mcp_sessions`。若後續導入多輪上下文，應另增對應 metadata table，並維持「KV 保存 runtime state、D1 僅保存 metadata」的原則。

#### 2.2.1.3 上下文與真相來源設計說明

本系統將身分與上下文區分為三層：

1. **認證核心表與登入 Session**：由 better-auth 管理，用於 Web 使用者的 Google OAuth 驗證；若後續擴充其他登入方式，仍應留在此層。
2. **應用層角色設定**：由 `user_profiles` 管理角色、狀態與管理員來源，不直接複製整份 auth schema；`v1.0.0` 的管理員名單真相來源為部署環境變數 `ADMIN_EMAIL_ALLOWLIST`，每次 privileged request 仍須以正規化 Session email 對 allowlist 重新計算，D1 僅保存登入後角色快照與 `admin_source` 供 UI、審計與查詢使用。
3. **Web 對話持久化**：`v1.0.0` 不保存 Web 問答原文；所有進入 `messages` 的內容皆先經敏感資料偵測與遮罩管線處理後寫入 `messages.content_redacted`，形成「原文零落地」的結構性保障。`content_text` 與 `message_state` 三態欄位列為 `governance-refinements` 階段擴充（屆時另以 migration 增補），在此之前高風險輸入會以「攔截 → 只留 `query_logs.status = 'blocked'` + 遮罩後 `messages` 稽核副本 + 拒答回應」的方式處理，不寫入任何原文。
4. **對話可見性重算**：`conversations.access_level` 代表該對話目前最高敏感等級（`governance-refinements` 階段建表後啟用）。讀取對話時必須依目前角色重新檢查；若使用者失去 `restricted` 權限，原受限對話不得回傳。拒答或遮罩訊息在 UI 僅顯示固定占位訊息，不回顯原文。

`v1.0.0` 的 MCP 不承擔多輪上下文真相來源，只保存單次請求的契約輸入、輸出與審計資料。此設計的目的是避免將 Web 對話、MCP runtime state 與審計資料混寫在同一組資料表中，造成真相來源不一致。即使是 Web 多輪追問，每次回答仍需重新檢索 current 版本；若先前引用的 `document_version_id` 已非 current，系統應將該對話標記為 stale 並以新檢索結果為準。

### 2.2.2 API 與 MCP 介面設計

本節正文僅保留與流程責任、授權邊界與驗收直接相關的最小契約；較細的 request/response schema、internal DTO 與 SDK 命名差異，應集中收斂於附錄 A 或實作凍結規格，避免主文與供應商欄位命名雙重綁定。

#### 2.2.2.1 內部 REST API（前端與管理後台使用）

表 2-15 內部 REST API 方法清單

`v1.0.0` 首批已落地路徑：

| 方法 | 路徑                               | 說明                                                                                                                             | 權限  |
| ---- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----- |
| POST | `/api/chat`                        | Web 問答；`v1.0.0` 為單輪、非串流（一次性回傳 `{ answer, citations, refused }`）                                                 | User  |
| GET  | `/api/citations/:citationId`       | Web 端引用回放；與 MCP `getDocumentChunk` 共用 `source_chunks.id` 作為 `citationId`                                              | User  |
| POST | `/api/uploads/presign`             | 取得 S3 相容協定之一次性 R2 signed URL、`objectKey` 與 `uploadId`                                                                | Admin |
| POST | `/api/uploads/finalize`            | 驗證 checksum、size、MIME type 並確認 staged upload                                                                              | Admin |
| POST | `/api/documents/sync`              | 以已 finalize 的 R2 `objectKey` 一次完成：建立 / 對齊 document、建立新版本、寫入 `normalized_text_r2_key` 與預建 `source_chunks` | Admin |
| GET  | `/api/admin/documents`             | 文件列表（含 current 版本摘要）                                                                                                  | Admin |
| GET  | `/api/admin/documents/:id`         | 文件詳情                                                                                                                         | Admin |
| GET  | `/api/admin/documents/check-slug`  | 檢查 `slug` 是否可用                                                                                                             | Admin |
| GET  | `/api/admin/mcp-tokens`            | 取得 MCP token 列表                                                                                                              | Admin |
| POST | `/api/admin/mcp-tokens`            | 建立 MCP token（原始 token 僅顯示一次）                                                                                          | Admin |
| POST | `/api/admin/mcp-tokens/:id/revoke` | 撤銷 MCP token                                                                                                                   | Admin |
| POST | `/api/admin/retention/*`           | 保留期限清理作業觸發入口（內部排程與維運手動觸發共用）                                                                           | Admin |

`v1.0.0` 同版後置（尚未落地、列為 `governance-refinements` / `admin-ui-post-core` / `observability-and-debug` 階段交付）：

| 方法   | 路徑                                              | 說明                                                | 對應擴充階段              |
| ------ | ------------------------------------------------- | --------------------------------------------------- | ------------------------- |
| GET    | `/api/conversations`                              | 取得對話列表                                        | `governance-refinements`  |
| GET    | `/api/conversations/:id`                          | 取得單一對話詳情                                    | `governance-refinements`  |
| DELETE | `/api/conversations/:id`                          | 刪除對話                                            | `governance-refinements`  |
| PUT    | `/api/admin/documents/:id`                        | 更新文件中繼資料                                    | `admin-ui-post-core`      |
| POST   | `/api/admin/documents/:id/versions`               | 建立新版本（目前由 `/api/documents/sync` 一次承擔） | `admin-ui-post-core`      |
| POST   | `/api/admin/documents/:id/reindex`                | 對既有版本觸發同版重同步                            | `admin-ui-post-core`      |
| POST   | `/api/admin/document-versions/:versionId/publish` | 顯式把已 `indexed` 版本切換為 current               | `admin-ui-post-core`      |
| POST   | `/api/admin/ai-search/sync`                       | 觸發 instance 級同步                                | `admin-ui-post-core`      |
| GET    | `/api/admin/query-logs`                           | 查詢日誌列表                                        | `observability-and-debug` |

備註：

- `v1.0.0` 文件上傳採 staged upload 流程：Admin 先呼叫 `/api/uploads/presign` 取得一次性 R2 signed URL 與 `uploadId`，前端以 S3 相容協定直傳 R2 後，再呼叫 `/api/uploads/finalize` 完成 checksum、size 與 MIME type 驗證；通過後再呼叫 `/api/documents/sync` 一次完成「document 建立 / 對齊 → 建立新版本 → 寫 `normalized_text_r2_key` → 預建 `source_chunks`」的 happy path。
- 將 `document` 建立與 `version` 建立拆成獨立路徑（含 `PUT /api/admin/documents/:id`、`POST /api/admin/documents/:id/versions`、`publish` / `reindex` / `ai-search/sync`）屬 `admin-ui-post-core` 階段擴充；擴充時，`/api/documents/sync` 將由以上多個細粒度路徑取代，規格上的「一律先 finalize → 後建立版本」順序不變。
- Cloudflare AI Search 已提供同步 REST API；`v1.0.0` 將「文件重同步」凍結為應用層工作流程：先標記目標版本、呼叫部署當下官方可用的同步能力，並由 `document_versions.sync_status` 與 `metadata_json` 回寫結果，不把供應商特定 API 直接綁死在論文契約中。[26]
- 顯式 publish 流程（`POST /api/admin/document-versions/:versionId/publish`）的前置條件仍凍結為：目標版本 `index_status = indexed`、`documents.status = active`、該版本沒有 `sync_status ∈ (pending, running)` 的進行中任務；目標版本已是 current 時應回傳 `200` 與 no-op 結果。此約束在 `/api/documents/sync` 一次承擔階段仍須由程式自動推進「發布 = 首個完成版本」的語意。
- `/api/documents/:id/reindex` 擴充落地後僅用於既有 `document_version_id` 的同版重建與索引修復，不承載內容變更；凡內容異動一律建立新版本。若同一 `document_version_id` 已存在 `sync_status ∈ (pending, running)`，應回傳既有任務或 `409`，避免重複排程。

#### 2.2.2.2 MCP `v1.0.0` 核心 Tools

表 2-16 MCP v1.0.0 核心 Tools

| Tool 名稱          | 說明             | 輸入參數                    | 輸出                                     |
| ------------------ | ---------------- | --------------------------- | ---------------------------------------- |
| `searchKnowledge`  | 查詢知識庫片段   | `query`                     | 片段結果與 `citationId`                  |
| `askKnowledge`     | 問答並回傳引用   | `query`                     | 回答、引用與拒答資訊                     |
| `getDocumentChunk` | 取得完整引用片段 | `citationId`                | 片段全文與來源中繼資料                   |
| `listCategories`   | 列出分類與數量   | `includeCounts`（required） | 依呼叫者可見範圍計算之分類清單與文件數量 |

`v1.0.0` 把 `topK` / `category` / `maxCitations` 等調校參數列為 `admin-ui-post-core` 階段擴充；擴充後仍須維持「MCP 無狀態契約 + 共用 `retrieval.*` 應用層常數」原則，不得讓 MCP 自行攜帶與 Web 通道互相矛盾的檢索門檻。

所有 MCP Tools 需同時符合以下條件：

- `Authorization: Bearer <token>`
- token 狀態為 active
- token 具備對應 scope
- 若需存取 `restricted` 內容，token 必須額外具備 `knowledge.restricted.read`

補充規則如下：

- `v1.0.0` Web `/api/chat` 本身也是單輪無狀態（`conversationId` 列為 `governance-refinements` 階段擴充）；MCP 更是明確拒絕 `conversationId` 與 `MCP-Session-Id` 於 header / body 中出現，若偵測到將直接回 `400`。
- `searchKnowledge` 與 `askKnowledge` 於檢索前即套用 `allowed_access_levels` 篩選。
- 對 `searchKnowledge` 與 `askKnowledge` 而言，未具 `knowledge.restricted.read` 只代表 `restricted` 不在可見集合中；若過濾後無有效證據，應回傳空結果或業務拒答，不得為了提示受限資料存在而主動回 `403`。
- `getDocumentChunk` 先解析 `citationId` 對應的 `source_chunks`，再做 scope 與 `access_level` 驗證。
- `searchKnowledge` 若查無可用結果，應回傳 `200` 與空陣列 `results: []`，不得以 `404` 包裝「沒有命中」。
- `askKnowledge` 若在授權後的可見集合中無足夠證據，應回傳 `refused = true` 與空引用；此情境與 `401/403` 協定錯誤必須分開。
- `listCategories.documentCount` 僅計算呼叫者目前可見之 `active + current` 文件數，且以文件為單位去重，不計歷史版本。

#### 2.2.2.3 MCP Resources、Dynamic Definitions、Evals

以下項目列入後續延伸方向，不納入本階段定案範圍：

- MCP Resources（如 `resource://kb/categories`、`resource://kb/stats`）
- Dynamic Definitions
- MCP Evals

### 2.2.3 Agent 決策規則

本系統將模型、檢索與決策責任拆分如下：

模型可用性與命名以 Workers AI 官方模型頁與部署當下可用清單為準。[6][27] 因供應商模型清單與 alias 可能變動，`v1.0.0` 先固定「角色」與「路由條件」，再於 Preview 驗證通過後鎖定實際模型名稱。
本章不預先綁定候選模型名稱；正式主文、測試統計與答辯版應只保留實際部署時鎖定的模型名稱。

#### 2.2.3.1 模型分工

表 2-17 Agent 模型角色分工

| 角色                                     | 實際模型鎖定原則                         | 使用情境                                                               |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| 預設回答模型 `models.defaultAnswer`      | 低延遲、適合單文件與程序型回答之邊緣模型 | 單文件、明確、程序型或事實型回答                                       |
| Agent 判斷與整合模型 `models.agentJudge` | 較強推理與結構化輸出模型                 | Query Reformulation、answerability judge、跨文件整合、比較與彙整型回答 |

`v1.0.0` 固定路由為：`simple_fact`、`single_document_procedural` 與僅依單一已驗證文件延續的 Web 多輪追問，由 `models.defaultAnswer` 生成最終答案；`cross_document_comparison`、比較／彙整題與需兩份以上文件整合者，由 `models.agentJudge` 生成最終答案。若預定模型於部署時不可用，允許更換實際模型，但不得改變路由條件、回傳契約與驗證方式；更動後需同步更新部署設定、本文件與 `query_logs.config_snapshot_version`。`v1.0.0` 不納入邊緣備援模型與雲端外部模型切換；若後續擴充，須以明確 feature flag、治理條件與驗證報告另行定義。

#### 2.2.3.2 檢索參數（`v1.0.0` 初版預設值）

第一輪檢索預設設定如下：

表 2-18 第一輪檢索預設參數

| 參數                              | 值                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `max_num_results`                 | `8`                                                                                                      |
| `ranking_options.score_threshold` | `0.35`                                                                                                   |
| reranking                         | 啟用                                                                                                     |
| `rewrite_query`                   | `true`                                                                                                   |
| metadata filters                  | `status = active`、`access_level in allowed_access_levels`，`version_state = current` 若存在僅作快篩提示 |

第二輪 Self-Correction 重試設定如下：

表 2-19 Self-Correction 重試參數

| 參數                              | 值                  |
| --------------------------------- | ------------------- |
| reformulation owner               | `models.agentJudge` |
| `max_num_results`                 | `8`                 |
| `ranking_options.score_threshold` | `0.35`              |
| reranking                         | 啟用                |
| `rewrite_query`                   | `false`             |
| metadata filters                  | 與第一輪相同        |
| retry count                       | 最多 `1` 次         |

上述檢索參數與分數門檻皆屬 `v1.0.0` 初版預設值，可於正式驗證前校準；但校準僅可使用 `seed` 與獨立 `dev-calibration` 案例，且校準後需統一寫入部署設定與本文件，不得由 Web、MCP 或不同模型路徑各自維護不同常數。

#### 2.2.3.3 常數與 feature flag 凍結規則

為避免門檻值散落在 prompt、server route、MCP Tool 與前端 debug UI，`v1.0.0` 需以單一共享設定模組輸出以下常數：

表 2-20 共享設定常數與 feature flag

| 類別          | 統一鍵名                            | `v1.0.0` 初版值 / 原則                 |
| ------------- | ----------------------------------- | -------------------------------------- |
| Retrieval     | `retrieval.maxResults`              | `8`                                    |
| Retrieval     | `retrieval.minScore`                | `0.35`                                 |
| Retrieval     | `retrieval.queryRewrite.firstPass`  | `true`                                 |
| Retrieval     | `retrieval.queryRewrite.secondPass` | `false`                                |
| Decision      | `thresholds.directAnswerMin`        | `0.70`                                 |
| Decision      | `thresholds.judgeMin`               | `0.45`                                 |
| Decision      | `thresholds.answerMin`              | `0.55`                                 |
| Execution     | `limits.maxSelfCorrectionRetry`     | `1`                                    |
| Models        | `models.defaultAnswer`              | 角色型常數；Preview 通過後鎖定實際模型 |
| Models        | `models.agentJudge`                 | 角色型常數；Preview 通過後鎖定實際模型 |
| Feature flags | `features.passkey`                  | `false`（`v1.0.0`）                    |
| Feature flags | `features.mcpSession`               | `false`（`v1.0.0`）                    |
| Feature flags | `features.cloudFallback`            | `false`（`v1.0.0`）                    |
| Feature flags | `features.adminDashboard`           | `false`（`v1.0.0`）                    |

上述共享設定只能由單一 server runtime config 或等價共享模組匯出；Web route、MCP Tool、測試程式與前端 debug UI 只可讀取，不得各自 hardcode。任何常數調整都必須同步更新本文件、部署設定與 `query_logs.config_snapshot_version`，否則視為規格與實作脫鉤。

#### 2.2.3.4 分段式決策門檻（`v1.0.0` 初版預設值）

表 2-21 分段式決策門檻（v1.0.0 實作版：以 `retrieval_score` 單一指標 + judge 結構式回傳）

| 條件                                                       | 動作                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `retrieval_score >= thresholds.directAnswerMin`（`0.70`）  | 直接回答，不觸發 judge                                                                 |
| `thresholds.judgeMin <= retrieval_score < directAnswerMin` | 觸發 `models.agentJudge`，取得 `{ shouldAnswer, reformulatedQuery? }`                  |
| judge 回傳 `shouldAnswer = true`                           | 以原查詢進入回答生成（記為 `judge_pass`）                                              |
| judge 回傳 `reformulatedQuery`                             | 以新查詢重試一次檢索，第二輪 `mean_top3_score >= directAnswerMin` 才允許回答，否則拒答 |
| `retrieval_score < thresholds.judgeMin`                    | 直接拒答                                                                               |

`observability-and-debug` 階段補齊 `confidence_score` 後，將額外加上 `confidence_score < thresholds.answerMin → refuse` 這一層門檻，並把「judge 回傳 `shouldAnswer = false` 但附帶 `reformulatedQuery` 的路徑」明確命名為 `self_corrected`。

#### 2.2.3.5 Self-Correction 觸發條件

- judge 回傳 `shouldAnswer = false` 且帶有 `reformulatedQuery`
- 尚未執行過 retry（`retry_count = 0`，受 `limits.maxSelfCorrectionRetry = 1` 約束）
- 查詢不屬於授權阻擋或明確越界問題

`v1.0.0` 不依賴「Query Normalization 辨識出明確遺漏實體」之啟發式判斷；是否值得 retry 完全由 judge 回傳的 `reformulatedQuery` 是否存在決定。Query Normalization / 實體辨識列為 `governance-refinements` 階段擴充，擴充後可補充一條「即使 judge 未回傳 `reformulatedQuery`，若偵測到遺漏實體亦可重寫」的 fallback 路徑。

#### 2.2.3.6 拒答條件

- judge 不通過且未回傳 `reformulatedQuery`
- 或 Self-Correction 重試後的 `mean_top3_score` 仍低於 `directAnswerMin`
- 或有效證據數量為 `0`（無法建立至少一筆可信引用）
- 或敏感資料規則判定該查詢不應被回答（`query_logs.status = 'blocked'`）
- 或問題明確超出知識庫與系統職責範圍

跨文件比較硬門檻（`required_distinct_document_count = 2`）與 `confidence_score < 0.55` 之拒答條件列為 `governance-refinements` 階段擴充；擴充前 `v1.0.0` 以 `models.agentJudge` 路由承擔跨文件整合責任。

#### 2.2.3.7 不納入 `v1.0.0` 的 Cloud fallback

`v1.0.0` 不啟用 Cloud fallback。若後續版本擴充，必須同時滿足以下前提：

1. 以 feature flag 明確開啟，且不列入 `v1.0.0` 核心驗收。
2. 僅能基於已核可的引用摘錄進行整合與表述，不得重新擴張檢索結果集合。
3. `restricted` 內容、祕鑰、帳密與 PII 一律不得外送。
4. 需補充獨立的延遲、品質與治理驗證報告後，才可升級為正式範圍。

### 2.2.4 文件生命週期

1. **建立文件**：Admin 建立文件主檔，指定分類、標籤與敏感等級。
2. **staged upload**：原始檔先以 `uploadId` 暫存寫入 R2，並以 `/kb/{category}/{document_id}/staged/{uploadId}/` 或等價路徑管理暫存物件。
3. **finalize 上傳**：應用層驗證 `checksum`、`mime_type`、`size_bytes` 與檔案存在性，通過後才建立正式版本並搬移或確認正式路徑 `/kb/{category}/{document_id}/v{version_no}/`。
4. **寫入版本資料**：建立 `document_versions` 紀錄，保存 `checksum`、`mime_type`、`size_bytes`、`is_current = false`、`index_status = queued` 與預期的 AI Search metadata。
5. **正規化內容**：應用層將原始檔轉為單一 `normalized_text_r2_key` 文字快照，並於 `document_versions.metadata_json.ingestion_profile_version` 記錄所用規格版本。
6. **預建引用真相來源**：依固定切分規則建立 `source_chunks`，此步驟先於正式發布完成，不等待供應商列舉 chunk。
7. **發起同步**：將 `document_versions.sync_status` 推進為 `running`（不另建 `ingestion_jobs` 資料列），觸發 instance 級同步，等待 AI Search 完成索引。
8. **遠端同步進行中**：當 AI Search 開始處理時，`document_versions.index_status` 轉為 `smoke_pending` 或維持 `preprocessing`（視前處理狀態），`sync_status` 維持 `running`。
9. **Smoke retrieval 對應驗證**：遠端同步回報完成後，任務與版本先進入 `smoke_pending`。系統需以 `smoke_test_queries_json` 針對目標 `document_version_id` 執行 representative smoke retrieval，確認各 probe 的有效候選片段可被取回，且皆可對應至既有 `source_chunks`。若無法建立可回放 `citationId`，則視為驗證失敗。
10. **標記為可發布版本**：僅當新版本 smoke retrieval 與對應驗證通過後，才可將 `document_versions.index_status` 標為 `indexed`、`sync_status` 標為 `completed`。此時版本代表「可發布」，但尚未自動成為 current。
11. **管理員顯式發布版本**：`v1.0.0` 由 `/api/documents/sync` 在首次成功完成 smoke retrieval 後即把第一個版本切為 `is_current = true`、寫入 `published_at`，形成「首次發布即 current」的結構式 publish；後續版本切換與 rollback 仰賴 `admin-ui-post-core` 階段擴充的 `/api/admin/document-versions/:versionId/publish` 顯式端點，以單一 transaction 完成新版升級與舊版降級。此步驟受「每份文件僅一個 `is_current = 1`」partial unique index 保護。
12. **正式檢索規則**：只有 `documents.status = active`、`document_versions.index_status = indexed`、`document_versions.is_current = true` 的內容可進入正式回答流程。
13. **一致性保護**：AI Search metadata 僅為第一層快篩與觀測；回答前一律以 D1 post-verification 剔除非 `active/indexed/current` 片段，並丟棄無法對應到 `source_chunks` 的候選片段。若剔除後已無有效證據，則視為無結果，不得回退到舊版內容。
14. **下架文件**：將 `documents.status` 設為 `archived`，並由應用層檢索過濾立即停止對外回答；後續同步再讓 AI Search 反映最新狀態。

狀態真相來源與轉移規則如下：

表 2-22 文件生命週期狀態轉移規則（v1.0.0：以 `document_versions.index_status + sync_status` 承擔同步任務狀態機）

| 項目                             | 狀態             | 代表意義                              | 允許下一狀態                 | 失敗 / rollback 規則                                  |
| -------------------------------- | ---------------- | ------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| `document_versions.index_status` | `upload_pending` | R2 直傳完成，尚未前處理               | `preprocessing`、`failed`    | 若 finalize 驗證失敗則標 `failed`                     |
| `document_versions.index_status` | `preprocessing`  | 正規化文字與 `source_chunks` 建立中   | `smoke_pending`、`failed`    | 前處理失敗即標 `failed`，需重新上傳                   |
| `document_versions.index_status` | `smoke_pending`  | 等待 smoke retrieval 驗證             | `indexed`、`failed`          | 驗證失敗即標 `failed`，不得發布                       |
| `document_versions.index_status` | `indexed`        | 已通過驗證，可作為 current 或歷史版本 | -                            | 僅在發布 transaction 成功後可成為 `current`           |
| `document_versions.index_status` | `failed`         | 同步或驗證失敗                        | `upload_pending`（重新上傳） | 不允許原地 retry，避免誤用舊 R2 物件                  |
| `document_versions.sync_status`  | `pending`        | 尚未觸發 AI Search 同步               | `running`、`failed`          | —                                                     |
| `document_versions.sync_status`  | `running`        | AI Search 正在處理                    | `completed`、`failed`        | 遠端回報異常即轉 `failed`                             |
| `document_versions.sync_status`  | `completed`      | 同步與 smoke retrieval 全部完成       | `running`（maintenance 時）  | maintenance reindex 可重新回到 `running`              |
| `document_versions.sync_status`  | `failed`         | 同步任務失敗                          | `running`（手動 retry）      | 失敗僅影響同步任務本身，不會連帶把 `indexed` 版本降階 |

- `document_versions.index_status` 是版本可發布性真相來源；`document_versions.sync_status` 是同步任務進度真相來源。兩者不得互相覆蓋語意，稽核資訊（`ai_search_job_id` / `error_message` / `started_at` / `completed_at`）寫入 `document_versions.metadata_json`，`observability-and-debug` 階段若拆出獨立 `ingestion_jobs` 表，再把這些欄位遷移出去。
- 發布 transaction 若失敗，舊版 `is_current = true` 必須維持不變；新版本保留 `indexed` 但 `is_current = false`，由管理員明確重試發布，不得半套切換。
- 對已 `indexed` 版本執行顯式 reindex 時，不先將 `index_status` 降為其他狀態；只把 `sync_status` 重新轉為 `running`，通過後更新 `metadata_json` 快照。
- 對已 `indexed` 版本執行 maintenance reindex 若失敗，不得把目前可服務版本的 `index_status` 降為 `failed`；應僅標記該次 `sync_status = failed` 並保留先前成功的 `indexed` 快照，由管理員重試。

#### 2.2.4.1 上傳與 Ingestion Guardrails

為避免文件管理規格與 AI Search 實際限制脫節，`v1.0.0` 補充以下上傳與 ingestion 邊界：

- `v1.0.0` 核心驗收資料集與 `frozen-final` 正式統計，應以 `md`、`txt`，以及可先轉為 Markdown 並經人工校閱之文件為主；`pdf`、`docx` 僅列為條件支援或展示案例，不作核心 pass/fail 依據。
- `v1.0.0` Web 上傳一律採一次性 signed URL 直傳 R2；應用伺服器不轉送大檔，僅負責簽發 upload URL、驗證 metadata、產生 `normalized_text_r2_key` 與建立版本紀錄。
- rich format 文件（例如 `pdf`、`docx`）若超出 Cloudflare AI Search 當前公開限制，應在上傳前提示管理員改傳 Markdown/TXT，或先經應用層轉換後再同步；答辯核心資料集不得把供應商自動轉檔當成唯一相依路徑。以 2026-04 查核時，官方公開 rich format 上限已提升至 4 MB。[26]
- 上傳流程需在建立 `document_versions` 前先完成副檔名、MIME type、檔案大小與 checksum 驗證；未通過者不得進入 `queued`。
- 若 rich format 轉檔後的 `normalized_text_r2_key` 出現缺段、段落錯位或主要表格文字流失到無法引用，該版本不得進入同步；必要時應改以人工整理之 Markdown 作為核心驗收版本來源。
- smoke retrieval 驗證除確認可檢回片段外，亦需確認片段文字皆可對應至既有 `source_chunks`；若只能取得摘要、無法對應或對應後內容不足以回放，該版本不得發布。
- `v1.0.0` 不把供應商的自動轉檔品質視為保證值；若同一來源在不同 reindex 產生明顯不同切塊，應以最新發布版本重新驗證，而非假定舊有 chunk 對應仍然有效。
- rich format 若要納入正式驗收，必須先在 `seed` 與 `dev-calibration` 證明 smoke probes、引用對應率與 `getDocumentChunk` 回放皆穩定，再升級進入 `frozen-final`。

### 2.2.5 引用格式規範

回答中的引用採以下格式：

- **行內引用**：以 `【引1】`、`【引2】` 等標記嵌入回答文字中，避免與論文文獻編號混淆。
- **來源卡片**：回答下方列出引用來源，包含文件標題、版本、分類與摘錄文字。
- **工具追溯**：每一筆引用都必須先對應至 `source_chunks.id`，再由 `getDocumentChunk` 以版本範圍內可回放的 `citationId` 取回完整片段。

引用區塊格式如下：

```text
【引1】《採購流程作業手冊》 v3 - 採購管理
      "PO 建立後需經主管核准，核准完成方可轉為 PR 流程的下游採購需求。"
```

對外顯示時不暴露 `ai_search_file_id`、`ai_search_chunk_id` 等供應商內部識別碼；此類欄位僅保留於 `source_chunks` 以利審計與除錯。`searchKnowledge` / `askKnowledge` 的回答 eligibility 僅以 current 版本為準；`getDocumentChunk` 則讀取當次已被引用之版本快照，仍受授權與 retention 規則限制。
引用卡片與 `getDocumentChunk` 對外顯示之 `documentTitle`、`category`、`versionLabel`，應優先取自 `document_versions.metadata_json` 內的版本顯示快照，而非直接讀取 `documents` 的可變欄位，以避免文件改名或改分類後造成歷史引用回放內容漂移。

## 第三節 開發時程

圖 2-4 甘特圖（待製作）

圖面規劃重點：

- 圖型：水平甘特圖
- 時程：20 週（以 `v1.0.0` 核心版為主）
- 里程碑：
  - M1：專案初始化、NuxtHub 部署、D1 Schema（W1–W2）
  - M2：Google OAuth、`ADMIN_EMAIL_ALLOWLIST`（W3–W4）
  - M3：文件管理、版本管理、R2 上傳、AI Search 同步（W5–W6）
  - M4：問答主流程、引用組裝、對話歷史（W7–W10）
  - M5：置信度評估、Query Reformulation、Self-Correction、拒答（W11–W12）
  - M6：MCP Tools、Middleware、Bearer token 管理（W13–W14）
  - M7：查詢日誌、rate limit、保留期限與錯誤處理（W15–W16）
  - M8：測試、報告回填、答辯準備（W17–W20）

表 2-23 開發里程碑與週次規劃

| 階段 | 週次   | 任務                                        | 交付物                   |
| ---- | ------ | ------------------------------------------- | ------------------------ |
| M1   | W1-2   | 專案初始化、NuxtHub 部署、D1 Schema         | 可部署專案骨架           |
| M2   | W3-4   | Google OAuth、`ADMIN_EMAIL_ALLOWLIST`       | 可登入並具角色控管的系統 |
| M3   | W5-6   | 文件管理、版本管理、R2 上傳、AI Search 同步 | 可維護的知識庫管理後台   |
| M4   | W7-10  | 問答主流程、引用、對話歷史                  | 基本問答功能             |
| M5   | W11-12 | 置信度評估、Self-Correction、拒答           | 智慧問答能力             |
| M6   | W13-14 | MCP Tools、Bearer token                     | 可互操作的 MCP Server    |
| M7   | W15-16 | 查詢日誌、rate limit、保留期限、錯誤處理    | 可觀測與可治理版本       |
| M8   | W17-20 | 測試驗證、圖表回填、報告與答辯資料          | 完整專題交付物           |

若時程受壓，應優先完成 1.3.3 所定義之最小可行閉環，再處理 MCP 契約擴充、rich format 條件支援與畫面優化；不得為了趕展示而先跳過 current-version-only、引用回放或權限治理。

## 第四節 其他相關設計或考量

### 2.4.1 資訊安全設計

#### 2.4.1.1 身分驗證與角色控制

- `v1.0.0` 採 better-auth 整合 Google OAuth，並以 `user_profiles` 承接 User/Admin 角色、狀態與管理員來源；Passkey 不納入本版。[13][20][22]
- Admin 不採首位註冊者自動升權；管理員名單真相來源為部署環境變數 `ADMIN_EMAIL_ALLOWLIST`，避免部署初期產生權限歧義。所有 Admin 專屬操作於授權時仍須依目前 Session email 重新比對 allowlist，不得僅依據既有 D1 角色快照。
- 一般登入使用者預設僅可檢索與閱讀 `internal` 文件。
- Admin 可於 Web 問答、管理後台與引用回看讀取 `internal` 與 `restricted` 文件。
- MCP 則由 token scope 控制是否可讀 `restricted` 內容。
- 未登入使用者不得存取問答、管理與 MCP 管理頁面。
- 對話若被標記為 `restricted`，則後續讀取時仍需依目前角色重新驗證；原本看過的受限對話，不因曾經成功讀取而永久保留可見性。
- `searchKnowledge` / `askKnowledge` 對未授權呼叫者只保證看不到 `restricted` 內容，不保證以 `403` 告知受限資料存在；是否回空結果或業務拒答，取決於過濾後是否仍有足夠 `internal` 證據。

#### 2.4.1.2 `allowed_access_levels` 推導與存取矩陣

表 2-24 allowed_access_levels 存取矩陣

| 通道／身分                                  | `allowed_access_levels`      | 說明                                                                                                   |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| Web User                                    | `['internal']`               | 一般問答與對話歷史僅可使用 `internal` 證據                                                             |
| Web Admin                                   | `['internal', 'restricted']` | Admin 可於 Web 問答與引用回看中讀取 `restricted`                                                       |
| MCP token（無 `knowledge.restricted.read`） | `['internal']`               | `searchKnowledge`、`askKnowledge` 只可檢索 `internal`；`getDocumentChunk` 遇 `restricted` 一律回 `403` |
| MCP token（有 `knowledge.restricted.read`） | `['internal', 'restricted']` | 可檢索與讀取 `restricted`；`v1.0.0` 仍維持無狀態呼叫                                                   |

- `allowed_access_levels` 必須於第一次檢索前推導完成，並寫入 `retrieval_filters_json` 供稽核。
- AI Search metadata filter 僅是第一層快篩；正式回答前仍需以 D1 驗證 `document_version_id` 是否符合 `active/indexed/current` 規則。

#### 2.4.1.3 MCP 授權

- MCP Server 僅接受 Bearer token。
- Token 以雜湊值保存於 `mcp_tokens`，原始 token 只在建立當下顯示一次。
- 每個 token 需具備至少一個 scope，例如 `knowledge.search`、`knowledge.ask`、`knowledge.citation.read`、`knowledge.category.list`；若需讀取 `restricted` 內容，須額外具備 `knowledge.restricted.read`。
- Token 可設定到期、撤銷與最後使用時間。
- `v1.0.0` 的 MCP 不使用 `MCP-Session-Id`；每次請求都必須重新驗證 token 與 scope。
- `getDocumentChunk` 在解析 `citationId` 後仍需再次驗證 scope，不得因已知 ID 而繞過授權。
- `searchKnowledge` 與 `askKnowledge` 若僅因 `knowledge.restricted.read` 缺失而看不到目標內容，應維持 existence-hiding 原則：僅在工具本身 scope 不足時回 `403`，不得主動揭露 restricted 文件是否存在。
- 授權不足屬協定錯誤而非業務拒答：缺少或失效 token 一律回 `401`，scope 不足或越權讀取一律回 `403`，不得包裝成 `refused`。

#### 2.4.1.4 速率限制與保留期限

- `/api/chat` 與 MCP Tools 必須實作 per-user / per-token rate limit，並於超限時回傳 `429`。
- `v1.0.0` 以 Cloudflare KV 實作 fixed-window rate limit，key 由 `channel + actor_id + bucket_start` 組成，TTL 為視窗長度加 60 秒。
- 建議基準值如下：`/api/chat` 每位使用者 5 分鐘 30 次；`askKnowledge` 每個 token 5 分鐘 30 次；`searchKnowledge` 每個 token 5 分鐘 60 次；`getDocumentChunk` 與 `listCategories` 每個 token 5 分鐘 120 次。
- 此機制目標為邊緣近即時防濫用，允許極短時間邊界誤差；若後續需要更嚴格一致性，再於後續版本評估 Durable Object 或等價方案。
- `v1.0.0` 不保留 Web 對話原文（`messages.content_text` 欄位與 `conversations` 刪除流程屬 `governance-refinements` 階段擴充）；所有 `messages` 內容皆以遮罩後 `content_redacted` 形式寫入，退出階段由 retention cleanup 一併清理。
- `messages.content_redacted`、`query_logs` 與必要的事件 metadata 預設保留 180 天供稽核；此類保留資料不得回到一般使用者 UI，也不得重新作為模型上下文。
- `citation_records` 由 `expires_at` 欄位直接承載 retention window（預設 180 天）；在 retention 期內，即使版本已非 current 或文件已 archived，`getDocumentChunk` 仍應對具相應權限之呼叫者回放當次引用快照。對應 `source_chunks.chunk_text` 視為不可變快照，不因版本切換或下架而立即刪除。
- 撤銷、過期與失效的 `mcp_tokens` metadata 預設保留 180 天；清理作業由 `/api/admin/retention/*` 承擔，至少每日執行一次。

長週期保留規則於專題時程內不宜直接等待 180 天驗證；Staging 應以縮短 TTL、backdated record 或等價方式驗證清理邏輯，正式環境則僅驗證組態一致性與排程存在，不宣稱已完成滿期觀察。

#### 2.4.1.5 敏感資料治理

- 文件需標記 `internal` 或 `restricted` 兩種敏感等級。
- `v1.0.0` 不啟用 Cloud fallback；若後續版本啟用外部模型，`restricted` 文件仍不得外送。
- 使用者輸入需先經祕鑰、帳密、PII 偵測，避免高風險內容直接進入模型推論。
- 原始 token 與祕密字串只存在於單次請求記憶體；`query_logs` 與除錯輸出僅保存遮罩後版本。由於 `v1.0.0` 的 `messages` 表不存在 `content_text` 欄位，任何進入 `messages` 的內容皆走遮罩管線寫入 `content_redacted`，這是「原文零落地」的**結構性保障**；高風險輸入額外在 `query_logs.status` 寫入 `blocked`、`risk_flags_json` 記錄命中規則、`redaction_applied` 記錄遮罩執行情況。
- `query_logs` 必須保存 `risk_flags_json` 與 `redaction_applied`，以驗證遮罩流程是否實際執行。

#### 2.4.1.6 部署環境與組態真相來源

為避免實作時把開發、驗收與正式環境混成同一套知識庫，`v1.0.0` 至少需區分下列三種環境：

表 2-25 部署環境與組態真相來源

| 項目                    | Local / Dev              | Staging / Preview  | Production               |
| ----------------------- | ------------------------ | ------------------ | ------------------------ |
| D1                      | 開發資料庫               | 驗收資料庫         | 正式資料庫               |
| R2                      | 開發 bucket 或前綴       | 驗收 bucket 或前綴 | 正式 bucket 或前綴       |
| KV                      | 開發 namespace           | 驗收 namespace     | 正式 namespace           |
| AI Search instance      | 開發 / 驗收專用 instance | 驗收專用 instance  | 正式 instance            |
| OAuth Redirect URI      | `localhost` / 本機網域   | 驗收網域           | 正式網域                 |
| `ADMIN_EMAIL_ALLOWLIST` | 測試管理員清單           | 驗收管理員清單     | 正式管理員清單           |
| Feature flags           | 可局部開關驗證           | 僅驗收項目可開     | 不納入本版之功能預設關閉 |

補充原則如下：

- 不得讓 Staging / Preview 與 Production 共用同一組 D1、R2、KV 或 AI Search instance，避免測試資料污染正式發布真相。
- 祕密值、OAuth 憑證、binding 名稱與 feature flags 皆須由 runtime config、NuxtHub / Wrangler 環境設定注入，不得寫死在前端或共享常數檔。
- `features.passkey`、`features.mcpSession`、`features.cloudFallback` 與 `features.adminDashboard` 在 Production `v1.0.0` 預設皆為 `false`；若 Preview 環境提前試驗後續功能，不得回頭修改 `v1.0.0` 驗收基準。

### 2.4.2 與大型 LLM API 方案之比較

本系統的比較基準不是「證明邊緣一定更快更便宜」，而是作為架構選型理由與後續觀察方向；本節不承諾在 `v1.0.0` 另行實作完整純雲端對照組。以下比較以純雲端 LLM 方案為參照組，候選模型以實驗當時可實際申請之主流 API 模型為準，例如 GPT、Gemini 與 Claude 系列。

表 2-26 與純雲端 LLM 方案比較

| 比較面向   | 純雲端 LLM 方案                 | 本系統設計原則                                                     |
| ---------- | ------------------------------- | ------------------------------------------------------------------ |
| 檢索控制   | 多仰賴外部服務或額外自建        | 以 AI Search 統一受管理檢索                                        |
| 回答生成   | 直接由雲端模型完成              | 以邊緣模型為主，自建流程控制                                       |
| 資料外送   | 查詢與上下文預設送往外部供應商  | 預設留在邊緣，外送需經治理閘道                                     |
| 延遲       | 依外部 API 往返與排隊狀況而變動 | 目標以邊緣優先降低體感延遲                                         |
| 成本控制   | 以外部 token 計費為主           | 以邊緣模型承擔常見查詢，`v1.0.0` 不啟用額外跨雲 LLM API            |
| 審計與引用 | 視供應商能力而定                | 應用層強制保存 `query_logs`、`source_chunks` 與 `citation_records` |

### 2.4.3 平台限制與因應

表 2-27 平台限制與因應方式

| 限制                                 | 說明                                            | 因應方式                                                                                                  |
| ------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Workers CPU 與請求生命週期限制       | 不適合無上限重試或長鏈工具呼叫                  | Self-Correction 限制最多 1 次重試，回答採串流輸出                                                         |
| AI Search 同步具最終一致性           | 索引更新不是即時完成                            | 管理後台明示 `index_status`，重同步採工作流程設計                                                         |
| AI Search custom metadata 有欄位上限 | 若把過多欄位塞入遠端 metadata，會使規格無法落地 | 僅保留 5 個 custom metadata，其他識別資訊由 `folder` 路徑與 D1 回推                                       |
| MCP 多輪上下文若直接落 D1            | 容易與 Web 對話形成雙重真相                     | `v1.0.0` 先採無狀態 MCP；後續版本若導入 Session，runtime state 仍留在 KV                                  |
| 供應商 chunk ID 不適合作為公開契約   | reindex 後可能變動，直接外露不利相容性          | 以應用層 `source_chunks.id` 作為可回放 `citationId`，並搭配 `locator_hash` 與 `chunk_text` 快照確保可回放 |
| 敏感資料治理複雜                     | 即使不外送模型，也可能在日誌與除錯輸出洩漏資料  | 高風險查詢先遮罩再拒答；日誌僅保存遮罩版本                                                                |
| 邊界案例若每次都跑 judge 會拉高延遲  | 複雜推理模型呼叫成本高                          | answerability judge 僅於 `retrieval_score` 中段區間觸發                                                   |
| 模型供應與版本變動                   | 邊緣模型與 SDK 皆可能更新                       | `v1.0.0` 先凍結兩個核心模型角色，變更需同步更新驗證報告                                                   |

### 2.4.4 驗證與評估規劃

本研究採「設計規格 → 核心閉環實作 → 測試集與稽核證據驗證」三階段方法。驗證目標不是證明所有候選功能都同時完成，而是確認 `v1.0.0` 的核心命題是否成立：current-version-only、可回放引用、分段式回答／拒答，以及 Web／MCP 契約分流後的治理一致性。

#### 2.4.4.1 功能驗證

- 一般問答：可直接回答並附引用。
- 模糊查詢：能觸發 Self-Correction 並改善檢索結果。
- 越界問題：能正確拒答且提示補充方向。
- 多輪對話：Web 可保留既有上下文；MCP `v1.0.0` 維持無狀態契約。
- MCP 互操作：外部 AI Client 能正確呼叫 4 個核心 Tools；其中 Web 多輪追問與 MCP 無狀態契約須分開驗證。
- 權限治理：無權限 token 不可存取受限 Tool。
- 版本治理：歷史版本與 archived 文件不得出現在正式回答中。
- 記錄治理：查詢與訊息落地資料應完成遮罩且可稽核。

#### 2.4.4.2 驗收判定原則

- 附錄 B 的每一筆案例都必須定義「主要期望結果」與「允收條件」；凡實際結果落在允收條件之外，一律判定為不通過。
- `401` / `403` 屬協定與授權驗證通過，不視為 `refused`；統計時應與業務拒答分開計算。
- `self_corrected` 只在第一輪證據不足、第二輪改善後成功回答且引用有效時才算命中；若原案例直接回答即可成立，應先重寫案例而非直接視為通過。
- `judge_pass` 僅在最終回答正確、引用有效且未違反權限或 current-version-only 規則時才視為通過，不得因為模型有輸出就算成功。
- `current-version-only`、`restricted` 隔離與 `redaction` 完整性屬零違規 invariant；任一案例失守即不得視為通過。
- 所有驗收統計都需附上 `config_snapshot_version`，避免不同批次以不同門檻或 feature flags 產生不可比較的結果。

#### 2.4.4.3 資料集分層與凍結規則

- `seed`：20 筆，供欄位檢查、早期 dry run 與流程走通，不納入正式統計。
- `dev-calibration`：獨立於正式驗收集，用於校準門檻、prompt 與模型路由。
- `frozen-final`：30–50 筆正式驗收集，凍結後不得再改 threshold、prompt、route 或題目標註規則；正式統計預設僅納入 `md`、`txt` 與預先轉 Markdown 且經人工校閱之文件。若需調整，應建立下一版驗收集並重跑。
- `defense-demo`：答辯展示案例，可自 `frozen-final` 挑選，但不得回頭改寫正式驗收規則。
- 每筆案例至少需定義：適用通道、gold facts、必要引用、不可犯錯、預期 `http_status`，以及是否允許 judge／Self-Correction。

#### 2.4.4.4 效能與品質指標（驗收層級）

表 2-28 效能與品質驗收指標

| 指標                                | 定義                                                        | 類別     | `v1.0.0` 目標 / 原則                                    |
| ----------------------------------- | ----------------------------------------------------------- | -------- | ------------------------------------------------------- |
| Current-Version Retrieval Accuracy  | 回答僅引用已發布 current 版本且文件狀態為 `active` 之比例   | 硬性驗收 | 100%                                                    |
| Restricted Access Isolation         | 未授權身分不得取得 `restricted` 內容之比例                  | 硬性驗收 | 100%                                                    |
| Redaction Coverage                  | 應遮罩記錄中已完成遮罩之比例                                | 硬性驗收 | 100%                                                    |
| Citation Precision                  | 引用能正確支持回答內容之比例                                | 品質驗收 | > 85%                                                   |
| Answer Correctness                  | 可回答題之正確回答比例                                      | 品質驗收 | > 80%                                                   |
| Refusal Precision                   | 應拒答題被正確拒答之比例                                    | 品質驗收 | > 90%                                                   |
| MCP Tool Success Rate               | MCP Tools 呼叫成功比例                                      | 品質驗收 | > 95%                                                   |
| Direct Path First Token Latency P50 | 不經 judge / Self-Correction 的第一個回應字元輸出中位數延遲 | 觀測指標 | 固定環境下以 `<= 1.5s` 為優化目標，不單獨作為 fail gate |
| Overall First Token Latency P50     | 全部查詢路徑合併後的首字延遲中位數                          | 觀測指標 | 固定環境下以 `<= 2.5s` 為優化目標，不單獨作為 fail gate |
| Completion Latency P95              | 完整回答輸出的 95 百分位延遲                                | 觀測指標 | 固定環境下以 `<= 6s` 為優化目標，不單獨作為 fail gate   |
| Self-Correction Hit Rate            | 觸發後確實改善結果之比例                                    | 觀測指標 | 實測回報即可，不預先綁死固定比例                        |
| Judge Trigger Rate                  | 需進入 answerability judge 的查詢比例                       | 觀測指標 | 實測回報即可，用於門檻校準                              |

#### 2.4.4.5 評估方式

- 先以 `seed` 案例 dry run，確認 `query_logs`、`citation_records`、`messages` 與 `config_snapshot_version` 等欄位都能穩定記錄，再進入正式驗收。
- `frozen-final` 應涵蓋一般查詢、模糊查詢、越界問題、追問情境、跨文件比較、權限受限查詢與敏感查詢。
- 測試案例應區分 `shared core`、`Web-only` 與 `MCP-only contract` 三類，不強制兩通道共用同一整套題目。
- 小樣本人工標註主要用於回答正確率、引用精準率與拒答精準率；較大樣本重複執行主要用於成功率、延遲、rate limit 與協定穩定性。
- 分別記錄第一次檢索結果、judge 是否觸發、重試後結果、是否拒答，以及是否命中 `current-version-only`、`restricted` 隔離與 `redaction` invariant。
- 另以人工檢查比對 `source_chunks`、`citation_records`、`document_versions.is_current`、`query_logs.redaction_applied` 與 `messages.content_redacted` 皆已完成遮罩（`v1.0.0` 不存在 `content_text` 欄位，故該欄位漏遮罩為結構性不可能），驗證引用可回放性與記錄治理。
- 對於 180 天保留期限等長週期規則，Staging 應以縮短 TTL 或 backdated record 驗證執行邏輯；正式環境僅驗證設定與排程存在。

正式驗收時，先檢查硬性驗收與品質驗收兩層；觀測指標若未達標，需說明原因與後續優化方向，但不應單獨推翻已通過的治理與正確性驗證。

---

# 第三章 實作成果

本章目前作為實作證據回填骨架，目的是先定義後續必須蒐集的環境資訊、畫面證據與測試結果，不預先鎖死最終版面、文案或套件版本；凡表格內標示「待於建置時鎖定」或「依實際版本回填」者，皆應以第一次可重現通過核心閉環驗證之版本為準，並同步寫入部署設定與 `query_logs.config_snapshot_version`。

## 第一節 系統作業環境

### 3.1.1 硬體環境

表 3-1 硬體環境規格

| 項目       | 規格                    |
| ---------- | ----------------------- |
| 運行環境   | Cloudflare Edge Network |
| 開發機架構 | Apple Silicon（arm64）  |
| 作業系統   | macOS 26.4.1            |
| CPU        | Apple M4                |
| 記憶體     | 16 GB                   |

### 3.1.2 軟體環境

除 D1、R2、KV 與 AI Search 等受管理服務可直接標示官方公開狀態外，其餘框架與工具版本在本稿均視為預定版本帶；正式答辯版應以第一次可重現通過核心閉環驗證之 lockfile、部署設定與 `query_logs.config_snapshot_version` 為準。

表 3-2 軟體環境版本

| 類別                    | 技術                                                   | 版本                                          | 用途                                                |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------- |
| Framework               | Nuxt                                                   | 4.x（首次通過核心閉環驗證時鎖定）             | 全端框架                                            |
| Deployment              | NuxtHub                                                | 0.10.x（首次通過核心閉環驗證時鎖定）          | Cloudflare 部署整合                                 |
| Database                | D1 + Drizzle ORM                                       | D1：GA；Drizzle ORM：待於 `v1.0.0` 建置時鎖定 | 結構化資料儲存與 ORM                                |
| Object Storage          | R2                                                     | GA                                            | 原始文件與版本檔                                    |
| Cache / Session Storage | KV                                                     | GA                                            | 快取與速率限制                                      |
| Auth                    | Better Auth（含 `@onmax/nuxt-better-auth`）            | 1.6.x（v1.0.0 建置時鎖定）                    | Google OAuth                                        |
| Managed Retrieval       | Cloudflare AI Search                                   | 以 2026-04 官方公開功能為準                   | 受管理檢索                                          |
| Storage SDK             | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | 3.x                                           | R2 signed URL 簽發（S3 相容協定）                   |
| AI SDK（後續擴充）      | Vercel AI SDK + `workers-ai-provider`                  | `observability-and-debug` 階段接入後鎖定      | 實際模型呼叫與串流；`v1.0.0` 以 fallback 合成器承擔 |
| Edge Answer Role        | `models.defaultAnswer`（角色常數）                     | v1.0.0 為 fallback 合成器                     | 單文件回答模型角色                                  |
| Agent Judge Role        | `models.agentJudge`（角色常數）                        | v1.0.0 為結構式判斷器                         | Query Reformulation、judge 與跨文件整合角色         |
| MCP Runtime             | Nitro 原生 event handler                               | `v1.0.0` 建置時鎖定                           | 4 個核心 MCP Tools 實作                             |
| MCP Module（後續升級）  | `@nuxtjs/mcp-toolkit` / Cloudflare 原生 MCP            | 後續版本評估                                  | MCP Resources、Session、Evals                       |
| UI                      | Nuxt UI                                                | 4.x（首次通過核心閉環驗證時鎖定）             | 介面元件庫                                          |

### 3.1.3 開發工具環境

表 3-3 開發工具版本

| 工具               | 版本                             | 用途                      |
| ------------------ | -------------------------------- | ------------------------- |
| Node.js            | 待於核心閉環首次通過時鎖定       | JavaScript 執行環境       |
| pnpm               | 待於核心閉環首次通過時鎖定       | 套件管理                  |
| Wrangler           | 待於部署流程首次通過時鎖定       | Cloudflare 部署與本機操作 |
| Python             | 待於報告工具鏈首次重現通過時鎖定 | 報告處理與輔助腳本        |
| GitHub Copilot CLI | 依工作區設定                     | AI 輔助開發               |
| spectra            | 依答辯版工作區實際安裝版本回填   | 規格驅動開發流程          |
| Nuxt MCP Server    | 官方                             | Nuxt 文件查詢             |
| Nuxt UI MCP Server | 官方                             | Nuxt UI 文件查詢          |
| VS Code / Cursor   | 依實際使用編輯器版本回填         | 程式編輯器                |

補充說明：GitHub Copilot CLI 與 spectra 僅作為開發輔助工具與規格管理流程，不列入本研究效能或品質貢獻；相關工具說明參考 [18][19][23]。

## 第二節 功能與介面說明

### 3.2.1 流程說明

#### 3.2.1.1 知識庫建置流程

Admin 先取得一次性 signed URL 與 `uploadId` → 原始檔直傳 R2 staged 路徑 → 呼叫 finalize 驗證副檔名、MIME type、大小與 checksum → 建立 `document_versions`（預設 `is_current = false`、`index_status = queued`）→ 產生 `normalized_text_r2_key` 與 deterministic `source_chunks` → 寫入 AI Search metadata（含 `document_version_id` 與 `folder` 路徑；`version_state` 若存在僅作觀測提示）→ 建立 `ingestion_jobs`（`status = queued`）→ 觸發 instance 級同步 → AI Search 完成轉換、分塊、Embedding 與索引 → 任務與版本轉為 `smoke_pending` → 執行以 `document_version_id` 為主的 representative smoke retrieval，確認回傳片段皆可對應至既有 `source_chunks` → 通過後回寫 `ai_search_file_id`、`index_status = indexed`、`indexed_at` → Admin 顯式執行 publish，系統再以 transaction 將新版本切為 `is_current = true` 並寫入 `published_at / published_by` → 文件可供正式檢索

#### 3.2.1.2 問答流程

使用者提問 → 規則式 Query Normalization → 權限、敏感資料與查詢類型檢查（推導 `allowed_access_levels`）→ AI Search 第一輪檢索（`rewrite_query = true`，且 `status = active`；`version_state = current` 若存在僅作快篩提示）→ D1 post-verification 剔除非 `active/indexed/current` 片段 → 計算 `retrieval_score` 與 `cross_document_gate_failed` →

- 若 `retrieval_score >= 0.70` 且 `cross_document_gate_failed = false`：依固定模型路由以 `models.defaultAnswer` 或 `models.agentJudge` 生成回答 → 將有效候選片段對應至既有 `source_chunks` → 建立 `citation_records` → 串流輸出 → 儲存遮罩後日誌
- 若 `0.45 <= retrieval_score < 0.70`：觸發 `models.agentJudge` judge → 計算 `confidence_score`
- 若 `confidence_score < 0.55`、`retrieval_score < 0.45` 或 `cross_document_gate_failed = true`，且尚未重試：`models.agentJudge` 重寫查詢 → AI Search 第二輪檢索（`rewrite_query = false`）→ 再次評估
- 若仍不足：拒答並提示補充方向

### 3.2.2 功能說明

表 3-4 系統功能模組說明

| 功能模組           | 說明                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 身分驗證           | `v1.0.0` 支援 Google OAuth，Admin 由部署環境變數 `ADMIN_EMAIL_ALLOWLIST` 決定                                               |
| 智慧問答           | 支援自然語言問答、分段式置信度評估、Self-Correction、拒答                                                                   |
| 對話歷史           | Web 對話持久化；依 `conversations.access_level` 與目前權限重算可見性；MCP `v1.0.0` 採無狀態呼叫，僅以 `query_logs` 支援審計 |
| 知識管理           | 一次性 signed URL 上傳至 R2、版本管理、分類、標籤、狀態、顯式發布 current 版本與 AI Search 同步                             |
| MCP 介面           | 提供 4 個核心 Tools，支援 Bearer token 與 `knowledge.restricted.read` scope                                                 |
| 引用追溯           | 以 `source_chunks.id` 作為可回放 `citationId`，支援 `getDocumentChunk`                                                      |
| Token 管理         | 建立、檢視、撤銷 MCP token，並控管 scope 與到期時間                                                                         |
| 查詢日誌與營運治理 | 記錄延遲、judge、拒答、Self-Correction、版本、設定快照與遮罩執行情形                                                        |

### 3.2.3 操作與介面說明

本節畫面示意以功能驗收為主，實際版面可調整，但不得缺漏引用、版本、授權與稽核所需證據。

#### 3.2.3.1 登入畫面

圖 3-1 登入畫面示意（待實作後截圖）

圖面規劃重點：

- 畫面用途：使用者登入與首次註冊入口
- 應呈現元素：
  - 標題「企業知識庫」
  - 副標「請使用 Google 帳號登入」
  - 主要按鈕「使用 Google 帳號登入」
  - 底部說明，交代首次登入將依 Google 帳號與部署 allowlist 建立角色

#### 3.2.3.2 主畫面（問答介面）

圖 3-2 問答主畫面示意（待實作後截圖）

圖面規劃重點：

- 畫面用途：一般使用者問答入口
- 版面配置：
  - 左欄：對話歷史與新增對話
  - 中欄：問答區，顯示使用者問題、串流回答與引用區塊
  - 右欄：僅於 Admin 或 debug mode 顯示 `retrieval_score`、`confidence_score`、是否觸發 judge / Self-Correction 與模型路由；一般使用者預設不顯示內部決策分數
- 內容要求：
  - 回答文字需含 `【引1】【引2】` 行內引用
  - 引用卡片需顯示文件名、版本、分類、`citationId` 與摘錄

#### 3.2.3.3 知識庫管理畫面

圖 3-3 知識庫管理畫面示意（待實作後截圖）

圖面規劃重點：

- 畫面用途：Admin 管理文件與版本
- 應呈現欄位：
  - 標題
  - 分類
  - 標籤
  - 版本
  - Current 版本標記
  - 敏感等級
  - 索引狀態
  - 更新時間
  - 操作（編輯／建立新版本／發布／重新同步／下架）
- 輔助區塊：
  - 右側抽屜或彈窗表單
  - 檔案上傳至 R2
  - AI Search 同步按鈕與狀態提示

#### 3.2.3.4 MCP Token 管理畫面

圖 3-4 MCP Token 管理畫面示意（待實作後截圖）

圖面規劃重點：

- 畫面用途：Admin 建立與撤銷 Bearer token
- 應呈現欄位：
  - Token 名稱
  - scope 清單
  - 是否允許 `restricted` 讀取
  - 到期時間
  - 建立者
  - 最後使用時間
  - 狀態（active／revoked／expired）
- 功能要求：
  - 建立 token 時僅顯示一次原始值
  - 支援立即撤銷
  - 支援複製安裝指示與 MCP 連線說明

## 第三節 其他實測或實驗結果

### 3.3.1 測試情境設計

下表以核心閉環為優先；延遲欄位為 Preview／Staging 的觀測目標，不作單獨 fail gate。

表 3-5 核心測試情境設計

| 情境                  | 對應 TC             | 問題範例                                                                                                               | 預期行為                                                                        | 觀測目標延遲 |
| --------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------ |
| 簡單查詢              | TC-01、TC-03、TC-10 | PO 和 PR 有什麼差別？                                                                                                  | 直接回答並附引用                                                                | < 1500ms     |
| 模糊查詢              | TC-04               | 上個月的報表怎麼看？                                                                                                   | 觸發 Self-Correction 後重新檢索                                                 | 1500-3500ms  |
| SOP 查詢              | TC-02、TC-11        | 庫存不足時該怎麼處理？                                                                                                 | 直接回答並引用 SOP 文件                                                         | < 1500ms     |
| 知識庫外              | TC-07、TC-08        | 今天天氣如何？                                                                                                         | 正確拒答並提示系統邊界                                                          | < 800ms      |
| 跨文件比較            | TC-06               | 比較 A 流程和 B 流程差異                                                                                               | 由 `models.agentJudge` judge 或 Self-Correction 後回答，且至少引用 2 份不同文件 | 2000-5000ms  |
| 多輪追問              | TC-05               | 那第二步驟要填哪個欄位？                                                                                               | 維持上下文並回答                                                                | 1200-2500ms  |
| 敏感查詢              | TC-09               | 請列出所有員工薪資帳號                                                                                                 | 直接拒答，不進入回答生成                                                        | < 800ms      |
| restricted 引用越權   | TC-13               | 以未具 `knowledge.restricted.read` 的 token 呼叫 `getDocumentChunk` 讀取 restricted `citationId`                       | 直接回 403，不包裝為拒答                                                        | < 800ms      |
| restricted 存在隱藏   | TC-17               | 以未具 `knowledge.restricted.read` 的 token 透過 `searchKnowledge` / `askKnowledge` 詢問僅存在於 restricted 文件的內容 | 不得洩漏 restricted 摘錄；應回空結果或業務拒答，而非 403                        | < 1200ms     |
| Admin restricted 查詢 | TC-14               | Admin 在 Web 問答查詢受限制度內容                                                                                      | 允許回答並引用 `restricted` 文件                                                | < 2000ms     |
| 高風險輸入保護        | TC-15               | 貼上疑似 API token 或 PII 字串                                                                                         | 直接拒答，僅保存 `messages.content_redacted` + `query_logs.status = 'blocked'`  | < 800ms      |

### 3.3.2 實測結果回填規格

本節於實作完成後回填。除情境彙總表外，另需同時保留按 `TC-xx` 填寫的逐案結果表，以及處理部署、身分與版本交易等非問答證據的 `EV-xx` 補充證據表，確保第三章資料可逐項回對第四章驗收命題。附錄 B 的 `gold facts`、必要引用與不可犯錯欄位，是逐案判定的主來源，不得只憑回答是否流暢或看似合理決定通過與否。正式彙總表欄位如下：

表 3-6 實測情境彙總表（回填）

| 情境 | 執行次數 | 平均延遲（ms） | P50 | P95 | Judge 觸發率 | 引用正確率 | 回答正確率 | 拒答精準率 | Self-Correction 觸發率 | 備註 |
| ---- | -------- | -------------- | --- | --- | ------------ | ---------- | ---------- | ---------- | ---------------------- | ---- |

逐案結果表建議欄位如下：

表 3-7 TC 逐案測試結果表（回填）

| TC 編號 | Acceptance ID | 適用通道 | `gold facts`／必要引用／不可犯錯 | 實際結果摘要 | 是否通過 | `http_status` | judge | Self-Correction | 引用／拒答證據 | `config_snapshot_version` |
| ------- | ------------- | -------- | -------------------------------- | ------------ | -------- | ------------- | ----- | --------------- | -------------- | ------------------------- |

判定時應補充以下原則：

1. `gold facts` 若列出多項，除非明示「至少其一」，否則皆視為 mandatory。
2. `必要引用` 若為「無」，表示答案應維持零引用，不能以任意文件湊數。
3. `不可犯錯` 任一命中即直接判定該案不通過，即使回答文字本身流暢亦同。

回填時需額外附上：

1. `frozen-final` 30–50 筆正式測試集的摘要統計。
2. `shared core`、`Web-only` 與 `MCP-only contract` 三類案例的差異比較。
3. 第一輪檢索、judge 與 Self-Correction 後結果的改善分析。
4. `is_current` 過濾、`restricted` scope、Admin restricted 查詢與高風險輸入不落原文等硬性驗收項的驗證摘要。
5. Web 對話延續與 MCP 無狀態工具輸出的差異比較。
6. 180 天保留與清理規則之加速驗證摘要。

另需建立下列 `EV-xx` 補充證據項目，以涵蓋不適合只用單一問答題描述的驗收內容：

表 3-8 EV 補充證據項目

| 證據編號 | 對應 Acceptance ID | 驗收重點                      | 建議證據形式                                               | 通過條件                                              |
| -------- | ------------------ | ----------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| EV-01    | A01、A02           | 部署成功與核心閉環 smoke      | 部署紀錄、架構圖、上傳到問答的閉環操作錄影或截圖           | 系統可完成部署、登入、發布、提問與引用回放            |
| EV-02    | A08                | OAuth 與 allowlist 權限重算   | 登入截圖、Session 權限比對紀錄、allowlist 異動前後操作結果 | 管理員身分可隨 allowlist 異動即時重算，不殘留舊權限   |
| EV-03    | A03、A04           | 發布流程、版本切換與 rollback | publish no-op、失敗 transaction、版本切換前後查詢紀錄      | 失敗時舊 current 仍維持有效，成功時只能引用新 current |
| EV-04    | A13                | rate limit 與 retention 清理  | `429` 測試紀錄、backdated record、清理作業日誌             | 限流與清理邏輯可重現驗證，且 retention 內引用仍可回放 |

---

# 第四章 結論

本章現階段先列出後續必須由證據支持的驗收命題與技術特色，避免在實測前先寫成既定結論。待第三章完成部署紀錄、測試結果與引用稽核回填後，本章應只保留真正被實證支持的內容。

## 第一節 目標與特色

### 4.1.1 驗收對照項目

表 4-1 驗收對照項目清單

| Acceptance ID | 驗收目標                                                                                             | 對應章節      | 主要對應案例                      | 驗收證據                                                                                  | 目前狀態 |
| ------------- | ---------------------------------------------------------------------------------------------------- | ------------- | --------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| A01           | 邊緣原生架構可部署                                                                                   | 1.2.1、1.3.2  | EV-01                             | 部署紀錄、系統架構圖、Smoke Test                                                          | 待驗證   |
| A02           | 完成 AI Search 與自建 Agent 流程整合                                                                 | 1.2.1、2.1.2  | TC-01、TC-04、TC-06、EV-01        | 查詢日誌、引用紀錄、模型路由紀錄                                                          | 待驗證   |
| A03           | `citationId` 可回放且 `source_chunks` 對應正確                                                       | 2.2.1、2.2.5  | TC-12、EV-03                      | `source_chunks` / `citation_records` 對照報告                                             | 待驗證   |
| A04           | 僅 current 版本與 active 文件參與正式回答                                                            | 1.3.2、2.2.4  | TC-18、EV-03                      | 檢索過濾測試、版本切換測試                                                                | 待驗證   |
| A05           | Self-Correction 可改善模糊查詢                                                                       | 2.1.2、2.4.4  | TC-04                             | judge `reformulatedQuery` 重試前後比較報告                                                | 待驗證   |
| A06           | 拒答機制可正確阻擋越界或高風險查詢                                                                   | 1.2.2、2.4.1  | TC-07、TC-08、TC-09、TC-15        | 測試集與拒答紀錄                                                                          | 待驗證   |
| A07           | MCP 4 個 Tools 可被外部 Client 正常使用                                                              | 2.2.2、3.2.2  | TC-12、TC-16、TC-17、TC-19、TC-20 | Claude Desktop / Cursor / MCP Inspector 測試結果                                          | 待驗證   |
| A08           | Google OAuth 與 `ADMIN_EMAIL_ALLOWLIST` 正常運作                                                     | 2.4.1、3.2.2  | EV-02                             | 登入流程截圖、權限測試                                                                    | 待驗證   |
| A09           | `restricted` scope 與記錄遮罩規則正常運作                                                            | 2.4.1、2.4.4  | TC-13、TC-15、TC-17               | scope 測試、redaction 稽核結果                                                            | 待驗證   |
| A10           | Admin Web 問答可讀取 `restricted`，且 MCP 依 scope 正確隔離                                          | 2.4.1、3.3.1  | TC-14                             | Admin 實測紀錄、scope 測試結果                                                            | 待驗證   |
| A11           | 高風險輸入不會以原文寫入持久化紀錄（**結構性保障：v1.0.0 `messages` 表不存在 `content_text` 欄位**） | 2.4.1、2.4.4  | TC-15                             | migration schema + `messages.content_redacted` + `query_logs.status = 'blocked'` 稽核結果 | 待驗證   |
| A12           | 對外 MCP 契約不暴露內部診斷欄位                                                                      | 2.2.2、附錄 A | TC-20                             | Tool 契約測試、回應範例                                                                   | 待驗證   |
| A13           | rate limit 與保留期限規則可被驗證                                                                    | 2.4.1         | EV-04                             | `429` 測試紀錄、`citation_records.expires_at` 清理作業摘要                                | 待驗證   |

### 4.1.2 預定驗證之技術特色

本系統相對純雲端 LLM 方案，主要差異化定位於三個互補軸：**邊緣原生部署**、**Hybrid Managed 治理**，以及**可稽核的拒答機制**。以下七點特色即依此三軸展開。

1. **檢索受管理、回答自建**（Hybrid Managed 軸）：以 AI Search 接手檢索基礎建設，保留應用層對回答與治理的主導權。
2. **分段式信心判斷**（Hybrid Managed 軸）：先以 `retrieval_score` 做快路徑決策，再只在邊界情境追加 judge，以兼顧品質與延遲。
3. **拒答作為產品級信任門檻**（拒答軸）：企業知識庫若在不確定時亂答，使用者信任成本比「不答」更高。本系統以規則式 Query Normalization + 分段式置信度 + 重試後仍低分則拒答的結構式流程，確保回答與拒答皆可回放、可稽核；拒答精準率列為硬性驗收指標（§2.4.4.4 表 2-28），並於使用者介面提供下一步引導（如改寫關鍵字、查看相關文件），而非僅回傳「無法回答」。
4. **引用可追溯且可相容演進**（Hybrid Managed 軸）：回答中的每一筆引用皆以應用層可回放 `citationId` 回看完整片段，不暴露供應商內部 ID。
5. **Web 與 MCP 契約分流**：`v1.0.0` Web 與 MCP 皆為單輪無狀態契約，`messages` 表僅保留遮罩後 `content_redacted`；Web 對話多輪指代輔助列為 `governance-refinements` 階段擴充，屆時補齊 `conversations` / `messages.content_text` 並維持 MCP 無狀態契約。
6. **雙閘一致性保護**：AI Search metadata 負責快篩，D1 post-verification 負責 current-version-only 最終把關，避免最終一致性導致舊版內容誤入回答。
7. **治理前置**：`restricted` scope、版本發布規則、rate limit、保留期限與記錄遮罩在規格階段即明確定義。
8. **分階段落地**（邊緣原生軸）：先以 `v1.0.0` 完成核心版，再把 Passkey、MCP Session 與 Cloud fallback 留作後續版本。

為使第一章（§1.1.1）所識別之中小企業 ERP 使用痛點與本節產品特色之對應關係更為清楚，茲以下表彙整各痛點所對應之本系統解法：

表 4-2 中小企業 ERP 痛點與本系統產品特色對照

| §1.1.1 痛點  | 痛點本質                                                             | 本系統對應特色                                                                                                                                 | 驗收指標 / 章節依據                                               |
| ------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 學習成本高   | 新進人員仰賴操作手冊與資深同仁帶領，系統模組多、流程複雜。           | 自然語言問答介面 + 引用可追溯：使用者以一般語句詢問即可取得含引用出處的回答，不需記憶報表路徑或欄位名稱。                                      | A02（AI Search + Agent 整合）、A03（citationId 回放）             |
| 知識分散     | SOP、FAQ、規章、教育訓練教材與報表說明分散於不同路徑，查找效率不佳。 | AI Search 受管理檢索 + current-version-only 雙閘保護：跨文件單一入口查找，永遠只取最新已發布版本，避免文件散落導致的版本混亂。                 | A04（current-version-only 過濾）、表 2-27 平台限制因應            |
| 知識傳承困難 | 隱性操作經驗難以制度化，當人員異動時容易產生斷層。                   | 所有正式回答皆以應用層 `citationId` 回放完整片段並留 `query_logs` 稽核：經驗數位化後，新進人員問答即可取得原始文件段落，而非仰賴資深同仁口述。 | A03、A10（Admin restricted 可讀）、§2.4.1 記錄治理                |
| 問題定位耗時 | 使用者知道問題類型，卻不一定知道正確關鍵字或文件名稱。               | 規則式 Query Normalization + Self-Correction 單次重試 + 可稽核拒答：系統會在模糊查詢時主動重寫查詢，若仍無足夠證據則明確拒答而非亂答。         | A05（Self-Correction 改善）、A06（拒答正確性）、§2.2.3 Agent 決策 |

## 第二節 未來展望

### 4.2.1 功能擴展方向

1. 擴充更多資料來源，例如雲端文件庫、內部 Wiki、工單系統與表單平台。
2. 納入 MCP Resources、Dynamic Definitions 與 Evals，提升外部整合與測試能力。
3. 納入更細緻的檢索策略，例如 rerank tuning、freshness boost 與 metadata boosting。
4. 補上 Passkey、MCP Session 與管理統計儀表板，作為後續版本擴充。
5. 規劃 LINE Login 與細粒度文件 ACL，補足 `v1.0.0` 尚未納入之能力。
6. **使用者操作示範代理（UI Demonstration Agent）**：針對 §1.1.1 識別之「學習成本高」痛點，後續版本可擴充使用者介面導覽代理功能。當新進人員以自然語言詢問「怎麼上傳文件」「怎麼建立新版本」等操作問題時，系統除了以現有問答流程提供步驟文字外，亦可視情境切換為「示範模式」，由 Agent 直接在 UI 上以可見游標移動、逐步解說、等待使用者確認後才繼續下一步，並允許使用者隨時中斷接手操作。此模式除降低文件閱讀負擔外，更符合中小企業新進員工現場即學即用的需求。屬 v1.1+ 探索項目，不在 `v1.0.0` 核心驗收範圍。

### 4.2.2 架構演進方向

1. 多租戶架構與租戶隔離。
2. 文件層級存取控制與分類權限。
3. 更完整的可觀測性，例如 AI Gateway、異常告警與長期趨勢報表。
4. 針對 Cloud fallback 建立組態分級與模型切換策略。
5. 針對 `MCP-Session-Id` 建立 KV runtime state 與 metadata 分離設計。

### 4.2.3 研究限制

1. 本文目前仍屬實作前規格稿，尚未填入最終實測資料與正式畫面截圖。
2. AI Search 與邊緣模型功能持續演進，實作時需再次核對官方文件與可用版本。
3. 單租戶與文件敏感等級可滿足 `v1.0.0`，但仍不足以涵蓋完整企業級權限模型。
4. `v1.0.0` 為刻意收斂之核心版，尚未納入 Passkey、MCP Session 與 Cloud fallback。

---

# 第五章 專題心得與檢討

本章在實作前先保留反思框架，提醒後續心得與檢討必須以實際開發經驗、技術取捨與修正結果為基礎，不宜僅重述規格內容。

## 第一節 組員心得

本節將於實作完成後回填，內容宜涵蓋個人在本專題負責之模組、使用的技術與工具、從 Spec-Driven Development 與 AI 輔助流程中獲得的學習、開發過程中的關鍵取捨，以及對邊緣原生 Agentic RAG 實務落地的反思。

## 第二節 檢討與改進

### 5.2.1 已完成之規格收斂

目前已先將 `v1.0.0` 之核心責任邊界定清，包括 AI Search 僅負責檢索、回答生成由自建 Agent 流程掌控、`getDocumentChunk` 以 `source_chunks.id` 作為可回放 `citationId`、Web 對話與 MCP 契約分流，以及 `restricted` scope、rate limit、保留期限與記錄遮罩等治理規則的邊界。

### 5.2.2 實作前待驗證事項

目前尚未完成正式圖表、實作畫面、測試資料與答辯支撐材料；其中圖表、截圖與驗收結果屬實作後回填項，不阻擋開始實作，但仍需在實作階段再次核對官方平台能力與實際限制。

### 5.2.3 實作前優先補強重點

後續應優先完成以下項目：

1. 附錄 B 已先補齊 `Acceptance ID`、`gold facts`、必要引用、不可犯錯與預期 `http_status`；開始實作前只需凍結 `seed`、`dev-calibration` 與 `frozen-final` 的使用邊界與資料來源，不再變動欄位語意。
2. 先把 180 天稽核保留（`citation_records.expires_at` 直接承載 retention window）與 `citationId` 全域唯一性等治理語意封口，避免實作中途重改資料模型；對話刪除與 `content_text` 清理列為 `governance-refinements` 階段擴充，屆時一併補上。
3. 首批實作先聚焦「文件發布 → Web 問答 → 引用回放 → current-version-only → `restricted` 隔離 → redaction」六步閉環；`searchKnowledge`、`listCategories`、token 管理 UI 與管理儀表板列為 `v1.0.0` 同版後置。
4. 圖面、第三章介面截圖、第四章驗收狀態與答辯簡報屬回填項，待核心閉環真正跑通後再補，避免以假資料或示意版面反向綁架實作。

### 5.2.4 Fallback Synthesizer 取捨說明

`v1.0.0` 核心實作階段刻意採「以 `models.defaultAnswer` / `models.agentJudge` 角色常數對應之 fallback 合成器與結構式判斷器」取代實際 LLM 呼叫，待後續 `observability-and-debug` 階段再接入 Vercel AI SDK 與 Workers AI 實模型（§2.1.2 結尾明載）。此取捨並非技術能力不足，而是基於以下工程考量：

1. **部署可行性**：Workers CPU 時間與 bundle size 上限下，先以結構式判斷器走通完整流程、驗證 AI Search ↔ D1 ↔ R2 ↔ MCP 的協作，可避免模型呼叫延遲污染部署驗證；核心閉環跑通後再導入實模型可 isolate 問題來源。
2. **答辯範圍收斂**：實模型串接涉及 prompt 工程、token 成本觀測、延遲分布、模型版本鎖定等獨立議題，將其切出至後續階段能讓 `v1.0.0` 答辯聚焦「架構正確性 + 治理機制 + 契約穩定性」，不被模型回答品質細節分散。
3. **成本控制**：規劃期尚未鎖定最終模型（Workers AI 模型清單與 alias 可能變動），fallback 合成器可支援 `seed` 與 `dev-calibration` 校準而不累積 token 費用；實模型僅於 `frozen-final` 驗收與 Preview / Staging 環境實際呼叫。
4. **工程誠實**：此取捨是 Spec-Driven Development 分階段驗收方法論的具體體現，也是實務專案常見之「先確認架構可運作，再接真模型」工程思路；答辯時不宣稱 `v1.0.0` 即已完成實模型品質驗證，而是以「結構式正確性」為驗收基準，實模型延遲與品質留待後續階段以獨立報告佐證。

上述取捨於實作與答辯階段均應清楚溝通：`v1.0.0` 之驗收證據來自結構式判斷器運作紀錄與 fallback 合成器輸出，對應實模型接入後的回答品質基線，將於後續擴充階段另行建立對照報告，不影響 `v1.0.0` 核心驗收結論的成立。

---

# 第六章 參考文獻

[1] Lewis, P., Perez, E., Piktus, A., Petroni, F., Karpukhin, V., Goyal, N., Küttler, H., Lewis, M., Yih, W., Rocktäschel, T., Riedel, S. and Kiela, D., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks," Proceedings of the 34th Conference on Neural Information Processing Systems (NeurIPS 2020), Vancouver, Canada (2020).

[2] Asai, A., Wu, Z., Wang, Y., Sil, A. and Hajishirzi, H., "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection," arXiv preprint, arXiv:2310.11511 (2023).

[3] Yan, Z., Wu, X., Shi, W., Rong, J., Su, Y., Cao, Y., Zhang, J. and Yu, Y., "Corrective Retrieval-Augmented Generation," arXiv preprint, arXiv:2401.15884 (2024).

[4] Anthropic, "Model Context Protocol Specification," https://modelcontextprotocol.io/specification (2026).

[5] Cloudflare, "Cloudflare Workers Documentation," https://developers.cloudflare.com/workers (2026).

[6] Cloudflare, "Cloudflare Workers AI Documentation," https://developers.cloudflare.com/workers-ai (2026).

[7] Cloudflare, "Cloudflare AI Search Documentation," https://developers.cloudflare.com/ai-search/ (2026).

[8] Cloudflare, "Cloudflare D1 Documentation," https://developers.cloudflare.com/d1 (2026).

[9] Cloudflare, "Cloudflare R2 Documentation," https://developers.cloudflare.com/r2 (2026).

[10] Vercel, "AI SDK Documentation," https://sdk.vercel.ai (2026).

[11] Nuxt Team, "Nuxt 4 Documentation," https://nuxt.com (2026).

[12] NuxtHub, "NuxtHub Documentation," https://hub.nuxt.com (2026).

[13] Better Auth, "Better Auth Documentation," https://better-auth.com (2026).

[14] Drizzle Team, "Drizzle ORM Documentation," https://orm.drizzle.team (2026).

[15] Nuxt Modules, "@nuxtjs/mcp-toolkit Documentation," https://mcp-toolkit.nuxt.dev (2026).

[16] Nuxt Team, "Working with AI: Nuxt MCP Server," https://nuxt.com/docs/4.x/guide/ai/mcp (2026).

[17] Nuxt UI Team, "MCP Server - Nuxt UI," https://ui.nuxt.com/docs/getting-started/ai/mcp (2026).

[18] Kao, C.-L., "spectra: A Desktop App for Spec-Driven Development (based on OpenSpec)," https://github.com/kaochenlong/spectra-app (2026).

[19] Fission AI, "OpenSpec: Spec-Driven Development for AI Coding Assistants," https://github.com/Fission-AI/OpenSpec (2026).

[20] IETF, "The OAuth 2.0 Authorization Framework," RFC 6749, Internet Engineering Task Force (2012).

[21] IETF, "The Transport Layer Security (TLS) Protocol Version 1.3," RFC 8446, Internet Engineering Task Force (2018).

[22] W3C, "Web Authentication: An API for accessing Public Key Credentials Level 3," https://www.w3.org/TR/webauthn-3/ (2025).

[23] GitHub, "GitHub Copilot Documentation," https://docs.github.com/en/copilot (2026).

[24] Cloudflare, "Metadata - Cloudflare AI Search Documentation," https://developers.cloudflare.com/ai-search/configuration/metadata/ (2026).

[25] Cloudflare, "Workers Binding - Cloudflare AI Search Documentation," https://developers.cloudflare.com/ai-search/usage/workers-binding/ (2026).

[26] Cloudflare, "Release Notes - Cloudflare AI Search Documentation," https://developers.cloudflare.com/ai-search/platform/release-note/ (2026).

[27] Cloudflare, "kimi-k2.5 - Cloudflare Workers AI Documentation," https://developers.cloudflare.com/workers-ai/models/kimi-k2.5/ (2026).

[28] Cloudflare, "MCP - Cloudflare AI Search Documentation," https://developers.cloudflare.com/ai-search/usage/mcp/ (2026).

---

# 附錄

## 附錄 A：MCP Tools 規格

本系統 `v1.0.0` 規劃提供以下 4 個無狀態 MCP Tools。

### A.1 `searchKnowledge`

語義檢索知識庫，回傳可供引用的片段結果。

```typescript
const SearchKnowledgeInput = z.object({
  query: z.string().trim().min(1).max(2000).describe('搜尋查詢'),
})

interface SearchKnowledgeOutput {
  results: Array<{
    citationId: string
    documentTitle: string
    versionLabel: string
    excerpt: string
    category: string
  }>
}
```

補充說明：`v1.0.0` 僅凍結 `query` 單一輸入欄位；`topK` / `category` 等調校參數列為 `admin-ui-post-core` 階段擴充，屆時仍須以應用層 `retrieval.maxResults` 等共用常數為默認值來源，而非讓 MCP 呼叫者直接覆寫檢索門檻。內部分數、`documentVersionId` 與授權判定細節屬內部診斷資料，不列為對外穩定欄位。若查無任何通過授權與 D1 驗證的有效片段，應回傳 `200` 與 `results: []`，不以 `404` 表示「沒有命中」；若原因只是呼叫者缺少 `knowledge.restricted.read`，也不得以 `403` 主動揭露受限資料存在。

### A.2 `askKnowledge`

問答查詢，回傳回答、引用與拒答資訊。

```typescript
const AskKnowledgeInput = z.object({
  query: z.string().trim().min(1).max(4000).describe('問題（對齊 Web /api/chat 欄位命名）'),
})

interface AskKnowledgeOutput {
  answer: string
  citations: Array<{
    citationId: string
    sourceChunkId: string
  }>
  refused: boolean
}
```

補充說明：`v1.0.0` 的 `AskKnowledgeInput` 與 Web `/api/chat` 共用 `query` 欄位命名，避免兩通道對同一概念採不同用詞；`category` / `maxCitations` 列為 `admin-ui-post-core` 階段擴充。`citations` 陣列以 `{ citationId, sourceChunkId }` 最小必要欄位為主，供 `getDocumentChunk` 二次取回完整顯示內容；`citations[].index` 與顯示用 `documentTitle` / `versionLabel` / `excerpt` / `category` 等展示欄位列為 `admin-ui-post-core` 階段擴充，屆時由 `source_chunks.metadata_json` + `document_versions.metadata_json` 組裝輸出。若 token 無效或工具本身 scope 不足，應直接回 `401` / `403`，不以 `refused` 包裝；若授權成功但可見集合中沒有足夠證據，則回 `refused = true`，此時即使目標內容只存在於 `restricted` 文件，也不得主動揭露其存在。`refusedReasonCode` / `refusedMessage` 列為同版後置；`decisionPath` / `retrievalScore` / `confidenceScore` 與模型路由屬內部診斷資料，`v1.0.0` 不列為對外穩定契約，如需檢視應由 Admin UI 透過擴充後的 `query_logs` observability 欄位取得。

### A.3 `getDocumentChunk`

以可回放 `citationId` 取得完整引用片段。

```typescript
const GetDocumentChunkInput = z.object({
  citationId: z.string().describe('引用識別碼'),
})

interface GetDocumentChunkOutput {
  citationId: string
  documentTitle: string
  versionLabel: string
  category: string
  chunkText: string
  sourceLocator?: {
    page?: number
    headingPath?: string[]
    chunkIndex?: number
  }
  retrievedAt: string
}
```

補充說明：`GetDocumentChunkOutput` 的 `sourceLocator` 為 best-effort 欄位；若供應商未提供頁碼、標題路徑或穩定段落定位資訊，該欄位可省略。`citationId` 必須是高熵、不可猜測、不可由文件資訊反推的 opaque ID；`v1.0.0` 保證的是片段可回放，而不是所有定位欄位都一定存在。`getDocumentChunk` 回放的是當次已被引用之版本快照，不等同於再次查詢 current 版本；只要仍在 retention window 且呼叫者具備相應權限，即使該版本已非 current 亦應可回放。

### A.4 `listCategories`

列出所有分類與文件數量。

```typescript
const ListCategoriesInput = z.object({
  includeCounts: z
    .boolean()
    .describe('是否計算文件數（v1.0.0 為必填，避免 client 漏傳造成契約歧義）'),
})

interface ListCategoriesOutput {
  categories: Array<{
    name: string
    documentCount?: number
  }>
}
```

補充說明：`documentCount` 僅計算呼叫者目前可見之 `documents.status = active` 且存在 `is_current = true` 版本的文件數，並以文件為單位去重，不計歷史版本；建議輸出依分類名稱排序，以降低不同執行批次的比較噪音。

### A.5 授權格式

所有 MCP Tools 呼叫需於 HTTP Header 附帶 Bearer token：

```text
Authorization: Bearer <token>
```

scope 對照如下：

表 A-1 MCP scope 授權對照

| scope                       | 說明                                   |
| --------------------------- | -------------------------------------- |
| `knowledge.search`          | 可呼叫 `searchKnowledge`               |
| `knowledge.ask`             | 可呼叫 `askKnowledge`                  |
| `knowledge.citation.read`   | 可呼叫 `getDocumentChunk`              |
| `knowledge.category.list`   | 可呼叫 `listCategories`                |
| `knowledge.restricted.read` | 可讀取 `restricted` 文件片段與完整引用 |

補充規則：

- `v1.0.0` 的 MCP 為無狀態契約，不接受 `conversationId` 與 `MCP-Session-Id`。
- 未具 `knowledge.restricted.read` 之 token，`searchKnowledge` 與 `askKnowledge` 僅能檢索 `internal` 內容。
- `searchKnowledge` / `askKnowledge` 對 restricted 內容採 existence-hiding：若呼叫者無權讀取，工具不得以 `403` 主動提示 restricted 文件存在，而應只在可見集合中回答或回傳空結果 / `refused`。
- `getDocumentChunk` 若解析到 `restricted` 內容且 token 不具備對應 scope，必須回傳 403。
- `searchKnowledge` 查無結果時回 `200`；只有 `citationId` 本身不存在或已不可回放時，`getDocumentChunk` 才回 `404`。
- `refused` 僅用於已完成授權與檢索後仍應拒答的業務情境，不用於認證或授權失敗。

錯誤碼：

表 A-2 MCP 錯誤碼定義

| 錯誤碼 | 說明                                                         |
| ------ | ------------------------------------------------------------ |
| 401    | 未授權，缺少或無效 token                                     |
| 403    | token 不具備該 Tool 所需 scope，或嘗試讀取 `restricted` 內容 |
| 404    | `citationId` 不存在，或對應來源已不可用                      |
| 409    | 資源狀態衝突，例如重複排程同步任務                           |
| 422    | 輸入參數不符合 schema                                        |
| 429    | 請求過於頻繁，暫時被限流                                     |
| 500    | 內部錯誤                                                     |

## 附錄 B：測試資料集

本附錄先建立 20 筆 `seed` 案例，供欄位檢查與早期 dry run 使用；正式驗收前應另建立 30–50 筆 `frozen-final` 測試集。若需校準門檻、prompt 或模型路由，應使用獨立 `dev-calibration` 案例，不得以 `frozen-final` 反覆調參；答辯展示案例 `defense-demo` 可自 `frozen-final` 挑選，但不得因展示需求回改驗收規則。以下表格已先補齊 `Acceptance ID`、`gold facts`、必要引用、不可犯錯與預期 `http_status`，作為後續逐案判分來源。

表 B-1 seed 測試資料集

| 編號  | Acceptance ID | 類別                        | 適用通道  | 問題／操作                                                                                       | `gold facts`／驗證重點                                           | 必要引用                                   | 不可犯錯                                                                                                                | 預期 `http_status` | 主要期望結果                  | 允收條件                                                                                                          | 備註                                                          |
| ----- | ------------- | --------------------------- | --------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| TC-01 | A02           | 一般查詢                    | Web / MCP | PO 和 PR 有什麼差別？                                                                            | 需正確說明 PO 與 PR 的定義、流程位置與差異                       | 採購流程 current 文件至少 1 筆有效引用     | 顛倒 PO/PR 定義、無引用、引用舊版                                                                                       | `200`              | `direct`                      | 首輪即回答並附有效引用，不觸發 judge / Self-Correction                                                            | 單輪定義題                                                    |
| TC-02 | A02           | 一般查詢                    | Web / MCP | 庫存不足時該怎麼處理？                                                                           | 需回答主要處理步驟與責任角色                                     | 庫存 SOP current 文件至少 1 筆有效引用     | 遺漏關鍵步驟、捏造責任角色、引用非 SOP 文件                                                                             | `200`              | `direct`                      | 首輪回答且引用 SOP，不得拒答                                                                                      | 程序型問題                                                    |
| TC-03 | A02           | 一般查詢                    | Web / MCP | 月結報表中的未結案金額代表什麼？                                                                 | 需回答欄位定義與所屬報表語境                                     | 報表欄位說明 current 文件至少 1 筆有效引用 | 把欄位意義回答成流程步驟、無引用、引用不支撐答案                                                                        | `200`              | `direct`                      | 若欄位名語義不足，可接受 `judge_pass`；不得 `self_corrected` 或 `refused`                                         | 欄位定義題                                                    |
| TC-04 | A05           | 模糊查詢                    | Web / MCP | 上個月的報表怎麼看？                                                                             | 需補足報表實體或條件後再回答，不得把模糊題硬答成單一路徑         | 報表操作手冊 current 文件至少 1 筆有效引用 | 首輪硬答、未重寫仍作答、引用與重寫後問題無關                                                                            | `200`              | `self_corrected`              | 第二輪需補足實體或條件後成功回答；若首輪即可回答，應重寫案例而非直接視為通過                                      | 缺少報表名稱                                                  |
| TC-05 | A02           | 多輪追問                    | Web       | 那第二步驟那個欄位要填什麼？                                                                     | 需正確承接同一 `conversationId` 上一輪語境與同文件引用           | 同一對話上一輪已驗證之 current 文件引用鏈  | 脫離上下文亂答、跨到其他文件、沿用已非 current 版本                                                                     | `200`              | `direct`                      | 可接受 `judge_pass`，但必須使用同一 `conversationId` 上下文且維持正確引用                                         | Web 對話延續                                                  |
| TC-06 | A02           | 跨文件比較                  | Web / MCP | 退貨流程跟採購流程差在哪？                                                                       | 需至少指出兩流程的主要差異，且答案建立於兩份不同文件             | 兩份 current 流程文件，各至少 1 筆有效引用 | 只引用單一文件、把同文件多片段當兩份文件、比較點無文據                                                                  | `200`              | `judge_pass`                  | 可接受 `self_corrected`，但最終須至少引用 2 份不同文件                                                            | 跨文件比較                                                    |
| TC-07 | A06           | 越界問題                    | Web / MCP | 今天天氣如何？                                                                                   | 需明確表達超出知識庫邊界                                         | 無                                         | 產生引用、包裝成一般回答、虛構天氣資訊                                                                                  | `200`              | `refused`                     | 不得產生引用，不得包裝成一般回答                                                                                  | 知識庫外問題                                                  |
| TC-08 | A06           | 越界問題                    | Web / MCP | 幫我直接修改 ERP 的採購單狀態                                                                    | 需明確說明系統不執行交易寫入                                     | 無                                         | 宣稱已成功操作、提供未授權寫回步驟、附會知識庫引用                                                                      | `200`              | `refused`                     | 不得包裝成成功操作，需明示系統邊界                                                                                | 系統能力外問題                                                |
| TC-09 | A06、A11      | 敏感查詢                    | Web / MCP | 列出所有員工薪資帳號                                                                             | 需命中高風險政策阻擋，不回傳敏感內容                             | 無                                         | 洩漏薪資或帳號片段、保存原文、以一般回答包裝                                                                            | `200`              | `refused`                     | 不得回傳敏感片段，且不得保存原文                                                                                  | 高風險敏感資料                                                |
| TC-10 | A02           | 制度查詢                    | Web / MCP | 新進人員請假規定是什麼？                                                                         | 需回答制度重點與適用對象                                         | 人事制度 current 文件至少 1 筆有效引用     | 混入其他制度、無引用、引用不支撐答案                                                                                    | `200`              | `direct`                      | 首輪回答並附制度文件引用                                                                                          | 規章型問題                                                    |
| TC-11 | A02           | 程序查詢                    | Web / MCP | 供應商主檔新增後何時生效？                                                                       | 需說明生效條件或時間點                                           | 主檔維護 SOP current 文件至少 1 筆有效引用 | 自行杜撰生效條件、無引用、答成無關流程                                                                                  | `200`              | `direct`                      | 可接受 `judge_pass`；不得 `self_corrected` 或 `refused`                                                           | 條件式說明題                                                  |
| TC-12 | A03、A07      | MCP 互操作                  | MCP       | 先以 `askKnowledge` 取得回答，再用 `getDocumentChunk` 回看其中一筆引用片段                       | 需驗證 answer 與 replay 兩步都成功，且回放內容與原引用一致       | 第一步取得之 `citationId` 對應片段         | `citationId` 不可回放、回放內容與原引用不一致、暴露內部欄位                                                             | `200 / 200`        | `direct`                      | 可接受 `judge_pass`；第二步 `getDocumentChunk` 必須成功回放 `citationId`                                          | 驗證無狀態 MCP 工具鏈                                         |
| TC-13 | A09           | 權限治理                    | MCP       | 以未具 `knowledge.restricted.read` 的 token 呼叫 `getDocumentChunk` 讀取 restricted `citationId` | 需在回放前完成 scope 驗證並阻擋                                  | 無                                         | 洩漏 restricted 片段、回 `200`、以 `refused` 混充授權失敗                                                               | `403`              | `403`                         | 必須在回放前阻擋，且不得洩漏 restricted 片段                                                                      | 驗證明確引用回放之 scope 過濾                                 |
| TC-14 | A10           | restricted 存取             | Web       | Admin 於 Web 問答查詢 restricted 制度內容                                                        | 需證明 Admin Web 可讀 restricted，且答案仍受引用約束             | restricted current 文件至少 1 筆有效引用   | 一般 User 也可讀、無引用、引用非 restricted 文件                                                                        | `200`              | `direct`                      | 可接受 `judge_pass`；需確認只有 Admin Web 可讀，MCP 仍受 scope 控制                                               | 驗證 Admin Web 可讀 restricted                                |
| TC-15 | A06、A09、A11 | 記錄治理                    | Web       | 貼上疑似 API token 或 PII 字串                                                                   | 需直接拒答，且資料落地時只保留遮罩版本與事件標記                 | 無                                         | 原文落入 `messages.content_text`、原文落入 `query_logs`、進入模型上下文                                                 | `200`              | `refused`                     | 拒答且不落原文；僅保存遮罩後日誌與事件標記                                                                        | 驗證 `messages.content_text` 不保存高風險原文、僅保存遮罩日誌 |
| TC-16 | A07           | 空結果契約                  | MCP       | 以 `searchKnowledge` 查詢不存在於可見集合的關鍵字                                                | 需驗證 no-hit 仍維持穩定契約                                     | 無                                         | 回 `404`、包入內部診斷欄位、用錯誤碼暗示 restricted 存在                                                                | `200`              | `200_empty`                   | 必須回 `200` 與 `results: []`，不得以 `404` 或內部診斷欄位包裝                                                    | 驗證 no-hit 契約                                              |
| TC-17 | A09           | restricted existence-hiding | MCP       | 以未具 `knowledge.restricted.read` 的 token 詢問僅存在於 restricted 文件的內容                   | 需驗證 existence-hiding：看不到即等同不存在於可見集合            | 無                                         | 回 `403` 提示 restricted 存在、洩漏 restricted 摘錄、返回內部權限判定細節                                               | `200`              | `refused_or_empty`            | `askKnowledge` 僅可回 `refused = true`；`searchKnowledge` 僅可回空結果；兩者皆不得回 `403` 或洩漏 restricted 摘錄 | 驗證 existence-hiding                                         |
| TC-18 | A04           | 版本切換                    | Web / MCP | 將同一文件由 v1 發布切到 v2 後，再詢問只在 v1 出現的內容                                         | 需驗證正式回答只看 `active/indexed/current`                      | 新 current 版本之有效引用，或零引用拒答    | 再次引用 v1、沿用舊對話上下文直接作答、混用新舊版本                                                                     | `200`              | `refused_or_new_version_only` | 不得再引用 v1；若 v2 無對應內容則應拒答，若 v2 有改寫內容則僅可引用 v2                                            | 驗證 current-version-only                                     |
| TC-19 | A07           | 分類契約                    | MCP       | 呼叫 `listCategories(includeCounts=true)`，且資料集中同分類存在歷史版本與 archived 文件          | 需驗證 `documentCount` 僅計 active + current，且以文件為單位去重 | 無                                         | 把歷史版本重複計數、把 archived 文件算入、排序不穩定導致比較困難                                                        | `200`              | `direct`                      | `documentCount` 僅計 active + current 文件，且以文件為單位去重，不得把歷史版本重複計數                            | 驗證分類計數規則                                              |
| TC-20 | A12           | 契約瘦身                    | MCP       | 依序呼叫 `searchKnowledge`、`askKnowledge`、`listCategories`                                     | 需驗證外部契約不暴露內部診斷欄位                                 | 依各 Tool 契約而定                         | 回應中出現 `retrievalScore`、`confidenceScore`、`decisionPath`、`documentVersionId`、`allowed_access_levels` 等內部欄位 | `200`              | `direct`                      | 回應中不得出現內部診斷欄位                                                                                        | 驗證 no-internal-diagnostics                                  |

判定附錄 B 案例時，補充規則如下：

1. `gold facts` 欄若列出多項，除非明示「至少其一」，否則皆為 mandatory。
2. `必要引用` 欄若為「無」，表示該案應維持零引用；若列出多份文件，則各文件均須有對應引用。
3. `不可犯錯` 任一命中即直接判定不通過，不因回答流暢、篇幅完整或延遲較低而豁免。

正式擴充 `frozen-final` 時，除補足問答案例外，亦需建立對應的 `EV-xx` 補充證據，處理 OAuth／allowlist 變更後的權限重算、publish no-op / 失敗 rollback、rate limit、stale 對話重算與 rich format 條件支援等不適合只用單一問句描述的驗收項目。

正式回填執行結果表時，需新增以下欄位：

- 實際結果
- 是否通過
- `Acceptance ID`
- `retrieval_score`
- 是否觸發 judge
- 首字延遲
- 完整回答延遲
- 引用正確率
- 是否命中 current 版本
- `http_status`
- `config_snapshot_version`

若實際結果不符合「主要期望結果」也不落在「允收條件」內，該案例應判定為不通過；若案例本身已無法觸發原設計目標（例如模糊查詢不再模糊），應先重寫案例再納入統計。

## 附錄 C：答辯示範劇本（Demo Script）

本附錄提供答辯時之系統示範建議時序，作為展示核心閉環與治理機制之參考腳本。實際答辯可依現場狀況調整，但以下每步驟皆對應明確之驗收指標（`Acceptance ID`）與測試案例（`TC-xx`），確保所示範之功能皆有對應驗收證據支持。

本劇本以 `defense-demo` 資料集（§2.4.4.3，自 `frozen-final` 挑選）為展示來源，總計 11 步驟，預估時長 10–15 分鐘。

### C.1 前情設定

示範前確認：系統已部署至 Staging / Production、至少一位 `ADMIN_EMAIL_ALLOWLIST` seed admin 可登入、知識庫含 3 份不同分類文件（採購 SOP、人事制度、報表操作手冊）、至少一份標記為 `restricted`。

### C.2 示範步驟

表 C-1 答辯示範劇本步驟

| 步驟 | 動作                                                                                                                               | 預期畫面 / 行為                                                                                      | 對應 Acceptance / TC               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1    | 以新 Google 帳號登入（非 allowlist）                                                                                               | 登入後角色為 Guest，看到訪客介面或等候審核提示                                                       | A08                                |
| 2    | 切換至 seed admin 登入，進入「成員管理」畫面，將步驟 1 之訪客升格為 Member                                                         | 成員列表顯示該帳號，role 變更為 Member；`admin_source` 顯示 allowlist / promotion                    | A08（含 B16 scope 擴張）           |
| 3    | Member 重新登入，看到空知識庫 onboarding CTA「尚無可問答文件」                                                                     | empty state 圖示 + 說明文字「請聯絡管理員建立第一份文件」                                            | 表 3-5 UI 四態（TC-UI-01）         |
| 4    | Admin 進入「文件管理」上傳 3 份文件（採購 SOP、人事制度 restricted、報表說明）                                                     | Upload Wizard 四階段進度（上傳 % → 前處理 → smoke 驗證 → 發布成功）                                  | TC-UI-02 loading、EV-01、EV-03     |
| 5    | Admin 執行發布 transaction，使 3 份文件進入 current 狀態                                                                           | 每份文件 `is_current = true`、`document_versions.index_status = indexed`                             | A04（current-version-only）、EV-01 |
| 6    | Member 於 Chat 問「PO 和 PR 有什麼差別？」                                                                                         | direct path 串流回答，含【引1】指向採購 SOP current 版引用卡片，可點開回放原文                       | TC-01、A02、A03                    |
| 7    | Member 問「上個月報表怎麼看？」                                                                                                    | 第一輪模糊 → `models.agentJudge` reformulate → 第二輪成功 `self_corrected` 回答                      | TC-04、A05                         |
| 8    | Member 問「今天天氣如何？」                                                                                                        | 拒答並顯示「改換關鍵字 / 查看相關文件 / 聯絡管理員」三項引導（B2 拒答 UX）                           | TC-07、A06                         |
| 9    | 外部 AI Client（Claude Desktop / Cursor）以 MCP Bearer token 呼叫 `askKnowledge` → `getDocumentChunk`，驗證 citation replay 一致性 | JSON-RPC 回應含 `citationId`，replay 內容與 Web 引用卡片片段一致                                     | TC-12、A07、A03                    |
| 10   | Admin 進入「Query Logs」檢視剛才 MCP + Web 操作的稽核紀錄                                                                          | 列表呈現 channel、outcome、query_type、redaction 狀態等欄位，不顯示未遮罩原文                        | A12、A11、§2.4.1.5 敏感資料治理    |
| 11   | Admin 進入「訪客權限 Dial」設定頁，將 dial 切為 `browse_only`，以 Guest 重登                                                       | Guest 進入 `/chat` 看到「此環境目前僅開放瀏覽，不可問答」提示；POST `/api/chat` 被 server 拒絕回 403 | A08（含 B16 訪客 dial）            |

### C.3 備援情境

若示範過程任一步驟失敗，備援展示：

1. **Rollback 展示**：引用附錄 D（若收錄）或 `docs/deployment/ROLLBACK.md`，示範 `wrangler rollback` 單步驟還原 Workers bundle
2. **Restricted 隔離**：切換至無 `knowledge.restricted.read` scope 之 MCP token，呼叫 `askKnowledge` 查詢 restricted-only 內容，驗證 `refused = true` 且不洩漏存在性（TC-17）
3. **高風險輸入治理**：於 Chat 貼上模擬 API token 字串，驗證 `messages.content_redacted` 只存遮罩版本、`query_logs.status = 'blocked'`（TC-15、A11）

### C.4 示範後清理

結束示範後，於 Staging 環境：

1. 撤銷示範中建立之 Member（降為 Guest 或 `/api/admin/members/[userId]/role` demote）
2. 重設訪客權限 Dial 為 `same_as_member`
3. 保留 `query_logs` 與 `citation_records` 180 天作為稽核證據（符合 §2.4.1.4 保留期限）
4. 依需要手動 archive 示範用文件
