![image1](main-v0.0.11_assets/image1.jpeg)

國 立 雲 林 科 技 大 學

資 訊 管 理 系 人 工 智 慧 技 優 專 班

人工智慧實務專題成果報告

學號：B11123208

基於邊緣原生架構之

代理式檢索增強生成系統設計與實作

—以中小企業知識庫為例

學 生：楊鈞元

指導教授：潘得龍　博士

中華民國 115 年 X 月 X 日

# 中文摘要

本專題旨在設計與實作一套基於邊緣原生架構之代理式檢索增強生成（Agentic RAG）系統，並以中小企業知識庫為應用場景，驗證其技術可行性與實務可操作性。系統核心能力包含自然語言問答、引用追溯、置信度評估、查詢重寫（Self-Correction）以及證據不足時的拒答機制，並以 Model Context Protocol（MCP）作為對外標準介面，使外部 AI Client 能以一致協定安全存取知識內容。

傳統 RAG 雖能結合檢索與生成以降低幻覺，但多採單次靜態檢索流程，當使用者查詢模糊、描述不完整或首次檢索命中不佳時，容易產生低品質回答。此外，若系統需自建文件切片、Embedding、索引與檢索基礎設施，對中小企業而言存在人才門檻高、維運成本高與建置週期長等問題。為兼顧系統可控性與導入成本，本研究採用 Hybrid Managed RAG 設計：以 Cloudflare AutoRAG（AI Search）作為受管理的檢索基礎層，負責文件同步、分塊、Embedding 與基礎檢索；上層再自建 Agentic Orchestration，處理置信度評估、查詢重寫、拒答判斷、回應生成與引用組裝。

技術實作上，本專題採用 Nuxt 4 全端框架與 NuxtHub v0.10 多雲抽象層，整合 Drizzle ORM + D1、R2 物件儲存、KV、Cloudflare AutoRAG、Workers AI 與 Vercel AI SDK。Agentic 決策層以 AI SDK 搭配 workers-ai-provider 在邊緣執行查詢規範化、置信度評估與 Query Reformulation，並於特定條件下保留回退雲端 LLM 的彈性。MCP 層則以 Nuxt MCP Toolkit 於 Nuxt 應用內建立 MCP Server，將 searchKnowledge、askKnowledge、getDocumentChunk、listCategories 等能力封裝為標準化 MCP Tools，並以 Middleware 處理 Bearer token 授權、以 Sessions 維持跨 tool call 的多輪對話狀態。v1 版本採單租戶架構，以 Google OAuth 作為主要登入方式，並以 User/Admin 角色為基礎進行存取控管。

開發方法論上，本專題採用 Spec-Driven Development（規格驅動開發），搭配 Claude Code、spectra、Nuxt MCP Server 等 AI 輔助工具鏈，降低中小企業導入 AI 系統時對專職 AI 工程師的依賴。成果驗證以功能展示與情境測試為主，涵蓋一般問答、模糊查詢觸發 Self-Correction、拒答情境、管理後台與外部 AI Client 透過 MCP 互操作等展示場景。

關鍵字：代理式檢索增強生成（Agentic RAG）、邊緣原生架構（Edge-Native）、Hybrid Managed RAG、Self-Correction、Model Context Protocol（MCP）、規格驅動開發（SDD）

---

# 目錄

---

# 符號索引

| 縮寫/符號       | 全稱                                   | 說明                                                                                       |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| RAG             | Retrieval-Augmented Generation         | 檢索增強生成，結合向量檢索與 LLM 生成的技術。                                              |
| Agentic RAG     | Agentic Retrieval-Augmented Generation | 代理式 RAG，由 LLM 代理主動決定檢索策略、重試與置信度評估。                                |
| LLM             | Large Language Model                   | 大型語言模型，如 GPT、Llama、Qwen 等。                                                     |
| MCP             | Model Context Protocol                 | Anthropic 提出的模型上下文協定，標準化 AI Client 與外部工具的互動。                        |
| WebMCP          | Web Model Context Protocol             | 以 HTTP/SSE 傳輸的 MCP 變體，適用於 Edge / Serverless 部署。                               |
| ERP             | Enterprise Resource Planning           | 企業資源規劃系統，涵蓋會計、庫存、人資等模組。                                             |
| ReAct           | Reasoning + Acting                     | 結合推理與行動的 LLM 代理式提示策略。                                                      |
| AI SDK          | Vercel AI SDK                          | Vercel 推出的 TypeScript AI 開發套件，提供工具呼叫、串流、Agent 編排能力。                 |
| AutoRAG         | Cloudflare AutoRAG (AI Search)         | Cloudflare 提供的 Managed RAG 服務，內建 Ingestion Pipeline 與向量檢索。                   |
| NuxtHub         | NuxtHub                                | Nuxt 官方推出的整合平台，將 Nuxt 4 應用部署到 Cloudflare Workers 並一站式管理 D1、R2、KV。 |
| Self-Correction | Self-Correction Loop                   | 當首次檢索置信度不足時，由系統重寫查詢並重新檢索的機制，本專題限制最多 1 次重試。          |
| Cloud fallback  | Cloud Fallback                         | 當邊緣模型無法提供足夠品質回答時，有條件回退至雲端 LLM 的機制。                            |

---

# 圖表目錄

［依章節編號列出所有圖表］

---

# 第一章 開發計畫

## 第一節 發展的動機

### 1.1.1 中小企業 ERP 使用的痛點

企業資源規劃（ERP）系統通常涵蓋採購、庫存、銷售、財務、人事與報表等多個模組。對中小企業而言，ERP 的問題不在於「沒有資料」，而在於「資料與知識難以快速被取用」。在日常操作中，常見痛點如下：

- 學習成本高：系統功能模組眾多、操作流程複雜，使用者需仰賴操作手冊或資深同仁協助。

- 知識分散：SOP、FAQ、制度文件與教育訓練資料分散於不同檔案與資料夾，難以快速定位。

- 知識傳承困難：當人員異動時，隱性操作經驗不易保留，企業知識難以累積成可重用資產。

### 1.1.2 傳統 RAG 系統的導入障礙

檢索增強生成（RAG）能將知識庫內容與大型語言模型結合，為企業建立智慧問答系統。然而對中小企業而言，傳統自建 RAG 仍有數項實務障礙：

- 人才門檻高：從文件切片、Embedding、向量索引到問答流程設計，需具備 AI、後端與維運能力。

- 維運成本高：若需自建索引服務與基礎設施，系統維護、擴充與監控成本均高。

- 開發週期長：從零設計檢索流程、權限設計、管理介面與問答體驗，建置周期通常偏長。

- 回答品質不穩：單次靜態檢索在面對模糊查詢或條件不足時，容易產生命中不佳或幻覺。

### 1.1.3 Serverless 邊緣運算帶來的機會

近年 Serverless 與邊緣運算平台逐漸成熟，使中小企業能以較低門檻部署智慧應用。以 Cloudflare Workers 為例，其優勢包括：

- 零伺服器維運：無需自行管理作業系統、更新、安全修補與容量規劃。

- 按量計費：能依實際使用量計費，降低早期導入成本。

- 低延遲：透過全球邊緣節點提供更接近使用者的互動體驗。

- 原生整合：搭配 D1、R2、KV、Workers AI 等服務，可快速組成完整應用架構。

### 1.1.4 混合式架構的必要性

雖然邊緣推論能力逐漸提升，但在企業知識庫問答場景中，系統仍需兼顧穩定性、成本與回答品質。若完全自建檢索流程，實作與維運負擔偏高；若完全交由 Managed RAG 處理，則在置信度評估、查詢重寫與拒答策略上的控制力有限。因此，本專題採用 Hybrid Managed RAG 架構：

- 下層以 Cloudflare AutoRAG 負責文件同步、分塊、Embedding 與基礎檢索。

- 上層以自建 Agentic Orchestration 控制檢索評估、查詢重寫、拒答與回答生成。

- 問答優先於邊緣執行，以兼顧回應速度；當特定條件滿足時，保留回退雲端 LLM 的彈性。

此設計能在「Managed Service 降低維運」與「自建代理流程保留決策控制」之間取得平衡。

## 第二節 專題目的

### 1.2.1 技術架構面

- 設計並實作一套基於 Serverless 邊緣原生架構的企業知識庫問答系統。

- 採用 Hybrid Managed RAG 架構，驗證 AutoRAG 與自建 Agentic Orchestration 整合之可行性。

- 實作具備 Self-Correction 與拒答機制的問答流程，提升模糊查詢情境下的回答品質。

- 建立符合 Model Context Protocol 的 MCP Server，使外部 AI 工具可透過標準協定存取知識內容。

### 1.2.2 安全設計面

- 建立以角色權限為基礎的應用存取控制（單租戶架構，User/Admin 兩種角色）。

- 以 Bearer token、Middleware 與 Session 機制保護 MCP 對外存取。

- 確保敏感資料不直接進入 LLM 問答流程或 MCP 對外輸出。

## 第三節 專題需求

### 1.3.1 專題簡介

本系統以企業知識庫問答為核心，服務範圍與需求如下。

目標用戶：

- ERP 一般使用者：查詢操作指引、報表解讀、規章制度。

- 系統管理員：知識庫維護、文件管理、查詢統計。

應用場景：

- 操作指引查詢：SOP、流程步驟、表單填寫說明。

- 報表解讀：欄位意義、計算邏輯說明。

- 規章制度查詢：作業規範、制度條文。

不在範圍：

- 不直接修改 ERP 交易資料或執行關鍵交易。

- 不將敏感資料（帳號密碼、個資明文）送入 LLM。

- 具備拒答機制，不承諾所有問題都能回答。

［待補：插入系統功能圖。繪圖 Prompt：以樹狀結構繪製系統功能圖，根節點為「企業知識庫 Agentic RAG 系統」，主分支包含（1）使用者端：自然語言問答、對話歷史、引用查看、拒答提示；（2）管理後台：文件 CRUD、分類標籤、查詢紀錄檢視、Ingestion 觸發；（3）Agentic 核心：置信度評估、Query Reformulation、Self-Correction Loop、拒答判斷；（4）MCP 介面：searchKnowledge、askKnowledge、getDocumentChunk、listCategories。風格：扁平化、方框與圓角、繁體中文。］

### 1.3.2 專題架構

本系統採用四層式 Serverless 邊緣原生架構，分為前端層、資料與受管理檢索層、Agentic AI 層、MCP 層。

［待補：插入系統架構圖。繪圖 Prompt：以四層水平分層圖呈現 Hybrid Managed RAG + 條件式 Cloud fallback 架構：第 1 層「前端層」（Nuxt 4 + Nuxt UI + @ai-sdk/vue useChat streaming）；第 2 層「資料與受管理檢索層」（Cloudflare Workers + NuxtHub v0.10 + Drizzle ORM + D1 + R2 + KV + Cloudflare AutoRAG）；第 3 層「Agentic AI 層」（Vercel AI SDK + workers-ai-provider，內含 Workers AI 多模型分層：Kimi K2.5（Agent / Tool Calling，256K ctx）、Llama 4 Scout 17B MoE（簡單問答快速回應）、gpt-oss-120b（備援），處理置信度評估、Query Reformulation、Self-Correction、拒答）；第 4 層「MCP 層」（Nuxt MCP Toolkit + Middleware + Sessions + Bearer Auth）。右側以虛線箭頭標示「條件式 Cloud fallback（confidence 仍低 + 複雜推理 + 資料可外送 + feature flag on）」連到外部 proprietary LLM。整張圖請以單一 Cloudflare Edge 邊界框包覆全部四層，明確呈現「以邊緣為主」之特性。］

架構說明：

- 前端層：使用 Nuxt 4 框架搭配 Nuxt UI v4 元件庫，整合 Vercel AI SDK 的 Vue 套件實現串流對話介面。

- 資料與受管理檢索層（Serverless）：透過 NuxtHub v0.10 一鍵部署至 Cloudflare Workers 邊緣網路。整合 Drizzle ORM + D1 儲存文件中繼資料、對話歷史與查詢日誌、R2 儲存原始文件、KV 作為快取；並以 Cloudflare AutoRAG（AI Search）作為受管理的檢索基礎層，負責文件同步、分塊、Embedding 與基礎語義檢索。此層完全無需管理伺服器，按量計費、自動擴展。

- Agentic AI 層（自主決策）：以 Vercel AI SDK 搭配 workers-ai-provider 於邊緣執行問答流程。Agent 模型（如 Kimi K2.5）負責查詢規範化、置信度評估、Self-Correction 觸發判斷與回答生成。Self-Correction 最多允許 1 次重試，避免過度消耗延遲與成本。

- MCP 層：以 Nuxt MCP Toolkit 建立 MCP Server，暴露 v1 核心 Tools（searchKnowledge、askKnowledge、getDocumentChunk、listCategories），以 Middleware 處理 Bearer token 授權，以 Sessions 維持多輪對話狀態。

條件式 Cloud fallback 設計：當以下條件同時滿足時，系統可選擇回退至雲端 LLM：(1) 經 Self-Correction 重試後置信度仍低於閾值；(2) 查詢屬複雜推理類型；(3) 查詢內容不含敏感資料且資料治理政策允許外送；(4) feature flag 設定為啟用。此設計保留彈性，同時確保預設情境下資料不離開邊緣網路。

## 第四節 預期效益

對使用者：

- 降低 ERP 學習門檻，縮短查找文件與理解流程的時間。

- 以自然語言查詢取代關鍵字式搜尋，提升問題解決效率。

- 回答附帶引用來源與片段，提高可追溯性與可信度。

對中小企業：

- 預期降低維運成本：Serverless 架構無需管理伺服器，免費額度內有望實現低成本運行（待實測驗證）。

- 預期降低 API 成本：以 Workers AI 邊緣模型承擔大多數查詢、僅必要時 Cloud fallback，相較純 proprietary LLM 方案預期可節省顯著費用（具體比例待實測驗證）。

- 預期降低開發門檻：現有 Vue/JS 工程師預計可在較短時間內上手，無需專門 AI 工程師。

- 標準化對外互操作：以 MCP 協定暴露知識庫能力，未來可無縫銜接更多 AI Client（Claude Desktop、Cursor 等），降低未來系統整合成本。

- 累積知識資產：企業知識得以系統化保存並複用，減少 IT 支援人力負擔。

對技術社群：

- 提供 Serverless Edge + Hybrid Managed RAG（AutoRAG + Agentic Orchestration）+ Nuxt MCP Toolkit 整合的完整實作範例。

- 驗證混合式邊緣雲端運算策略在企業應用中的可行性。

---

# 第二章 分析與設計

## 第一節 分析

### 2.1.1 使用案例分析

［待補：插入 Use Case Diagram。繪圖 Prompt：以 UML Use Case 圖格式繪製，三個 Actor：一般使用者（User）、系統管理員（Admin）、外部 AI Client（External Agent）。Use Case 包含：提問並獲得回答、查看對話歷史、查看引用來源、追問（多輪對話）、上傳文件、設定分類/標籤、觸發 Ingestion、檢視查詢日誌、呼叫 MCP searchKnowledge、呼叫 MCP askKnowledge、取得 getDocumentChunk、取得 listCategories。請以實線連接 Actor 與 Use Case，以 <<include>> 標示「提問」含「Self-Correction」與「置信度評估」子流程。］

主要 Actor：

- 一般使用者（User）：具備問答與對話歷史查看權限。

- 系統管理員（Admin）：具備文件管理、Ingestion 觸發、查詢日誌檢視權限。

- 外部 AI Client（External Agent）：透過 MCP Tools 存取知識庫，需 Bearer token 授權。

| Actor          | Use Case         | 說明                                                                               |
| -------------- | ---------------- | ---------------------------------------------------------------------------------- |
| User           | 提問並獲得回答   | 輸入自然語言問題，取得含引用的回答                                                 |
| User           | 查看對話歷史     | 回顧過往的問答紀錄                                                                 |
| User           | 追問（多輪對話） | 基於前一輪回答延伸提問                                                             |
| Admin          | 上傳文件         | 上傳 PDF、Markdown 等文件至知識庫                                                  |
| Admin          | 管理文件         | 編輯、分類、下架文件                                                               |
| Admin          | 觸發 Ingestion   | 手動觸發 AutoRAG 重新索引                                                          |
| Admin          | 查看統計         | 檢視查詢成功率、延遲等統計數據                                                     |
| External Agent | 呼叫 MCP Tools   | 透過 searchKnowledge / askKnowledge / getDocumentChunk / listCategories 查詢知識庫 |

### 2.1.2 問答流程分析

本系統採用固定主線的 Agentic RAG 問答流程，以 AutoRAG 作為唯一檢索來源，搭配 Self-Correction 機制提升回答品質。

［待補：插入 Activity Diagram - Agentic RAG 問答流程。繪圖 Prompt：以 UML Activity Diagram 呈現 Self-Correction Loop。流程節點依序為：(1) 使用者提問 →(2) 查詢規範化（Query Normalization）→(3) 呼叫 AutoRAG 基礎檢索 →(4) 置信度評估（決策菱形）。分支 A（置信度足夠）：→ 組裝引用 → 以 AI SDK streamText 生成回答 → 輸出串流 → 結束。分支 B（置信度不足且未重試）：→ Query Reformulation（Agentic Orchestrator 重寫查詢）→ 回到 (3)。分支 C（置信度不足且已重試 1 次）：→ 拒答並提示使用者補充條件 → 結束。請於決策菱形旁標註「最多 1 次重試」以控制延遲與成本。］

問答流程定案說明：

1. **使用者提問**：使用者於前端介面輸入自然語言問題。

2. **Query Normalization**：系統對原始查詢進行規範化處理，包含去除冗餘詞彙、同義詞轉換、格式標準化等。

3. **AutoRAG 檢索**：呼叫 Cloudflare AutoRAG 進行語義檢索，取得 top-k 相關文件片段。

4. **置信度評估**：Agent 根據檢索結果的相似度分數與內容相關性，評估是否足以回答問題。

5. **分支處理**：
   - 若置信度足夠（score ≥ 閾值）：組裝引用並生成回答。
   - 若置信度不足且尚未重試：觸發 Query Reformulation，重寫查詢後再次檢索（最多 1 次）。
   - 若置信度不足且已重試 1 次：執行拒答，向使用者提示需補充更明確的查詢條件。

6. **回答生成**：以 Vercel AI SDK 的 streamText 功能串流輸出回答，回答中嵌入引用標記（如 [1]、[2]）。

7. **引用組裝**：回答下方附上引用來源清單，包含文件標題、片段內容與來源連結。

此流程確保「正確拒答」被視為成功行為——當知識庫確實無法回答時，系統應明確告知使用者，而非產生幻覺回答。

## 第二節 設計

### 2.2.1 資料庫設計

本系統使用 D1（SQLite）儲存結構化資料，並搭配 Drizzle ORM 進行型別安全的資料存取。資料模型設計需支撐以下正式需求：使用者管理、文件管理、文件版本追蹤、Ingestion 狀態追蹤、對話歷史、查詢日誌、MCP Session 管理。

［待補：插入 ER Diagram。繪圖 Prompt：以實體關聯圖（Crow's Foot notation）繪製，實體包含：users、documents、document_versions、ingestion_jobs、conversations、messages、query_logs、mcp_sessions。關係：users 1─N documents、documents 1─N document_versions、documents 1─N ingestion_jobs、users 1─N conversations、conversations 1─N messages、users 1─N query_logs、users 1─N mcp_sessions。請註記主鍵（PK）與外鍵（FK）。］

#### 核心資料表設計

**users（使用者）**

| 欄位           | 類型                   | 說明                      |
| -------------- | ---------------------- | ------------------------- |
| id             | string (PK)            | 使用者唯一識別碼          |
| email          | string (UNIQUE)        | 電子郵件（登入識別）      |
| name           | string                 | 顯示名稱                  |
| role           | enum ('user', 'admin') | 角色（User 或 Admin）     |
| oauth_provider | string                 | OAuth 提供者（如 google） |
| oauth_id       | string                 | OAuth 提供者的使用者 ID   |
| created_at     | timestamp              | 建立時間                  |
| updated_at     | timestamp              | 更新時間                  |

**documents（文件）**

| 欄位             | 類型                        | 說明                        |
| ---------------- | --------------------------- | --------------------------- |
| id               | string (PK)                 | 文件唯一識別碼              |
| title            | string                      | 文件標題                    |
| category         | string                      | 文件分類                    |
| tags             | json                        | 標籤陣列                    |
| status           | enum ('active', 'archived') | 文件狀態                    |
| r2_key           | string                      | R2 儲存路徑                 |
| autorag_index_id | string                      | AutoRAG 索引 ID（外部關聯） |
| uploaded_by      | string (FK → users.id)      | 上傳者                      |
| created_at       | timestamp                   | 建立時間                    |
| updated_at       | timestamp                   | 更新時間                    |

**document_versions（文件版本）**

| 欄位        | 類型                       | 說明                 |
| ----------- | -------------------------- | -------------------- |
| id          | string (PK)                | 版本唯一識別碼       |
| document_id | string (FK → documents.id) | 所屬文件             |
| version     | integer                    | 版本號               |
| r2_key      | string                     | 該版本的 R2 儲存路徑 |
| changelog   | text                       | 變更說明             |
| created_at  | timestamp                  | 建立時間             |

**ingestion_jobs（Ingestion 任務）**

| 欄位           | 類型                                                  | 說明                  |
| -------------- | ----------------------------------------------------- | --------------------- |
| id             | string (PK)                                           | 任務唯一識別碼        |
| document_id    | string (FK → documents.id)                            | 關聯文件              |
| status         | enum ('pending', 'processing', 'completed', 'failed') | 任務狀態              |
| autorag_job_id | string                                                | AutoRAG 回傳的 Job ID |
| error_message  | text                                                  | 錯誤訊息（若失敗）    |
| started_at     | timestamp                                             | 開始時間              |
| completed_at   | timestamp                                             | 完成時間              |
| created_at     | timestamp                                             | 建立時間              |

**conversations（對話）**

| 欄位       | 類型                   | 說明                             |
| ---------- | ---------------------- | -------------------------------- |
| id         | string (PK)            | 對話唯一識別碼                   |
| user_id    | string (FK → users.id) | 所屬使用者                       |
| title      | string                 | 對話標題（可由首次問題自動產生） |
| created_at | timestamp              | 建立時間                         |
| updated_at | timestamp              | 最後更新時間                     |

**messages（訊息）**

| 欄位            | 類型                           | 說明                       |
| --------------- | ------------------------------ | -------------------------- |
| id              | string (PK)                    | 訊息唯一識別碼             |
| conversation_id | string (FK → conversations.id) | 所屬對話                   |
| role            | enum ('user', 'assistant')     | 角色                       |
| content         | text                           | 訊息內容                   |
| citations       | json                           | 引用資料（assistant 訊息） |
| metadata        | json                           | 額外中繼資料               |
| created_at      | timestamp                      | 建立時間                   |

**query_logs（查詢日誌）**

| 欄位                      | 類型                           | 說明                     |
| ------------------------- | ------------------------------ | ------------------------ |
| id                        | string (PK)                    | 日誌唯一識別碼           |
| user_id                   | string (FK → users.id)         | 查詢使用者               |
| conversation_id           | string (FK → conversations.id) | 關聯對話                 |
| original_query            | text                           | 原始查詢                 |
| normalized_query          | text                           | 規範化後查詢             |
| reformulated_query        | text                           | 重寫後查詢（若有）       |
| confidence_score          | float                          | 置信度分數               |
| self_correction_triggered | boolean                        | 是否觸發 Self-Correction |
| refused                   | boolean                        | 是否拒答                 |
| latency_ms                | integer                        | 回應延遲（毫秒）         |
| created_at                | timestamp                      | 建立時間                 |

**mcp_sessions（MCP Session）**

| 欄位         | 類型                   | 說明                                  |
| ------------ | ---------------------- | ------------------------------------- |
| id           | string (PK)            | Session 唯一識別碼                    |
| user_id      | string (FK → users.id) | 關聯使用者（可為空，代表匿名 Client） |
| client_id    | string                 | MCP Client 識別碼                     |
| context_json | json                   | Session 狀態（對話上下文）            |
| expires_at   | timestamp              | 過期時間                              |
| created_at   | timestamp              | 建立時間                              |
| updated_at   | timestamp              | 更新時間                              |

#### Session 設計說明

本系統區分兩種 Session：

1. **應用登入 Session**：由 better-auth 管理，用於 Web 應用的使用者身分驗證與角色控管。

2. **MCP Session**：由 Nuxt MCP Toolkit 的 useMcpSession 管理，用於維持外部 AI Client 的多輪對話狀態。MCP Session 透過 mcp_sessions 資料表持久化，支援跨請求的上下文維護。

### 2.2.2 API 與 MCP 介面設計

#### 內部 REST API（前端與管理後台使用）

| 方法   | 路徑                      | 說明             | 權限  |
| ------ | ------------------------- | ---------------- | ----- |
| POST   | /api/chat                 | 問答（串流回應） | User  |
| GET    | /api/conversations        | 取得對話列表     | User  |
| GET    | /api/conversations/:id    | 取得對話詳情     | User  |
| DELETE | /api/conversations/:id    | 刪除對話         | User  |
| GET    | /api/documents            | 取得文件列表     | Admin |
| POST   | /api/documents            | 上傳文件         | Admin |
| PUT    | /api/documents/:id        | 更新文件         | Admin |
| DELETE | /api/documents/:id        | 刪除文件         | Admin |
| POST   | /api/documents/:id/ingest | 觸發 Ingestion   | Admin |
| GET    | /api/stats                | 查詢統計         | Admin |

#### MCP v1 核心 Tools

本系統 v1 版本僅實作以下 4 個核心 MCP Tools，作為對外正式介面：

| Tool 名稱        | 說明             | 輸入參數                                        | 輸出               |
| ---------------- | ---------------- | ----------------------------------------------- | ------------------ |
| searchKnowledge  | 語義檢索知識庫   | query: string, topK?: number, category?: string | 相關文件片段列表   |
| askKnowledge     | 問答並取得回答   | question: string, conversationId?: string       | 回答內容與引用     |
| getDocumentChunk | 取得特定文件片段 | documentId: string, chunkIndex: number          | 片段內容           |
| listCategories   | 列出所有分類     | （無）                                          | 分類清單與文件數量 |

所有 MCP Tools 呼叫需附帶 Bearer token，由 Middleware 驗證授權範圍。

#### MCP Resources、Dynamic Definitions、MCP Evals（延伸方向）

以下能力不列入 v1 主線，作為未來延伸強化方向：

- MCP Resources（resource://kb/categories、resource://kb/stats）
- Dynamic Definitions（動態工具描述與參數定義）
- MCP Evals（工具呼叫評測集）

### 2.2.3 Agent 決策規則

Agentic Orchestrator 依據以下規則自主決策：

1. **置信度閾值**：confidence_score ≥ 0.5 視為足夠。

2. **Self-Correction 觸發條件**：
   - confidence_score < 0.5
   - 尚未執行過 Query Reformulation（retry_count = 0）

3. **拒答條件**：
   - confidence_score < 0.5
   - 已執行過 1 次 Query Reformulation（retry_count = 1）

4. **Cloud fallback 條件**（條件式，非預設）：
   - confidence_score < 0.5 且已重試
   - 查詢屬複雜推理類型（由 Agent 判斷）
   - 查詢內容不含敏感資料（敏感資料過濾器通過）
   - 資料治理政策允許外送（由設定檔控制）
   - feature flag `CLOUD_FALLBACK_ENABLED` 設為 true

### 2.2.4 文件生命週期

1. **上傳**：Admin 上傳文件，原始檔案存入 R2，中繼資料寫入 documents 表，建立初始 document_versions 記錄。

2. **Ingestion**：系統建立 ingestion_jobs 記錄並呼叫 AutoRAG Ingestion API，AutoRAG 自動執行分塊、Embedding 與索引。

3. **索引完成**：ingestion_jobs 狀態更新為 completed，文件可被檢索。

4. **更新**：Admin 上傳新版本，建立新的 document_versions 記錄，觸發重新 Ingestion。

5. **下架**：Admin 將 documents.status 設為 archived，系統通知 AutoRAG 移除索引。

### 2.2.5 引用格式規範

回答中的引用採用以下格式：

- **行內引用**：以 [1]、[2] 等數字標記嵌入回答文字中。

- **引用來源區塊**：回答下方列出引用清單，格式為：

  ```
  [1] 《文件標題》- 分類標籤
      "相關片段內容摘錄..."
  ```

- **可追溯性**：每個引用標記對應 getDocumentChunk 可取得的完整片段。

## 第三節 開發時程

［待補：插入甘特圖。繪圖 Prompt：以水平甘特圖繪製 20 週開發時程，X 軸為 W1–W20，Y 軸為里程碑。里程碑條目：M1 專案初始化、NuxtHub 部署、D1 Schema（W1–W2）；M2 Google OAuth 整合與角色（W3–W4）；M3 文件 CRUD、R2 上傳、AutoRAG Ingestion 串接（W5–W6）；M4 Agentic 問答主流程（AI SDK + workers-ai-provider + 串流輸出）（W7–W10）；M5 置信度評估、Query Reformulation、Self-Correction Loop（W11–W12）；M6 Nuxt MCP Toolkit（4 Tools、Middleware、Sessions、Bearer Auth）（W13–W14）；M7 效能測試、錯誤處理、UI 優化（W15–W16）；M8 報告撰寫與系統文件（W17–W20）。請以不同顏色區分 Phase 1/Phase 2/Phase 3，並在每個里程碑末標註「交付物」。］

| 階段 | 週次   | 任務                                                           | 交付物           |
| ---- | ------ | -------------------------------------------------------------- | ---------------- |
| M1   | W1-2   | 專案初始化、NuxtHub 部署、D1 Schema                            | 可部署的專案骨架 |
| M2   | W3-4   | Google OAuth 整合、登入介面、角色設定                          | 可登入的系統     |
| M3   | W5-6   | 文件 CRUD、R2 上傳、AutoRAG Ingestion 串接                     | 知識庫管理功能   |
| M4   | W7-10  | Agentic 問答主流程（AI SDK + 串流輸出）、對話歷史              | 基本問答功能     |
| M5   | W11-12 | 置信度評估、Query Reformulation、Self-Correction Loop          | 智慧問答功能     |
| M6   | W13-14 | Nuxt MCP Toolkit（4 Tools、Middleware、Sessions、Bearer Auth） | MCP Server       |
| M7   | W15-16 | 效能測試、錯誤處理、UI 優化                                    | 穩定版本         |
| M8   | W17-20 | 報告撰寫、系統文件                                             | 完整專題報告     |

## 第四節 其他相關設計或考量

### 2.4.1 資訊安全設計

#### 身分驗證與角色控制

- **主要登入方式**：v1 版本以 Google OAuth 作為主要登入方式，透過 better-auth 整合實作。

- **延伸登入方式**（非 v1 核心）：Passkey（無密碼登入）、LINE Login 等作為未來強化方向。

- **角色模型**：採單租戶架構，角色分為 User 與 Admin，API 端點依角色進行權限檢查。

#### MCP 授權

- MCP Server 以 Bearer token 驗證外部 AI Client。

- 透過 Nuxt MCP Toolkit 的 Middleware 攔截每次 tool call 並檢查授權範圍。

- Token 可設定過期時間與存取範圍（如僅允許 searchKnowledge）。

#### 敏感資料治理

- 使用者密碼不落地（OAuth 登入）。

- 所有資料傳輸採 HTTPS。

- 敏感資料（帳號、金鑰、個資明文）不送入 LLM 與 MCP Tools 回傳內容。

- Cloud fallback 前需通過敏感資料過濾器。

### 2.4.2 與大型 LLM API 服務之比較

本系統採用 Hybrid Managed RAG + 條件式 Cloud fallback 架構，以下比較本系統與純 proprietary 雲端 LLM 方案之差異：

| 比較面向   | 純雲端 LLM（GPT/Gemini/Claude） | 本系統                                               |
| ---------- | ------------------------------- | ---------------------------------------------------- |
| 延遲       | 500-2000ms（需往返雲端）        | 目標 <500ms（邊緣執行，待實測驗證）                  |
| 成本       | 依 token 計費（價格較高）       | Workers AI Neurons 計費（預期較低，待實測驗證）      |
| 資料隱私   | 資料傳送至第三方                | 預設於邊緣處理，條件式 fallback 時需符合資料治理政策 |
| 供應商依賴 | 單一供應商風險                  | Workers AI 多模型 + 可替換 fallback                  |

成本效益預估說明：具體節省比例需待系統實測後以實際數據驗證，目前為設計預期。

### 2.4.3 平台限制與因應

| 限制                 | 說明                  | 因應方式                                     |
| -------------------- | --------------------- | -------------------------------------------- |
| Workers CPU 時間限制 | 單次請求 CPU 時間有限 | Self-Correction 限制為最多 1 次重試          |
| D1 容量限制          | 單一資料庫容量上限    | ERP 知識庫規模通常足夠；大規模可評估遷移方案 |

### 2.4.4 驗證與評估規劃

#### 功能驗證

- 一般問答：直接回答並附引用
- 模糊查詢：觸發 Self-Correction 後改善結果
- 越界問題：正確拒答並提示補充條件
- 多輪對話：維持對話上下文

#### 效能指標（目標值，待實測驗證）

| 指標                 | 定義                             | 目標值   |
| -------------------- | -------------------------------- | -------- |
| Latency P50          | 回應延遲中位數                   | < 500ms  |
| Latency P95          | 回應延遲 95 百分位               | < 1200ms |
| Self-Correction Rate | 觸發重試的查詢比例               | 15-25%   |
| Success Rate         | 成功回答的查詢比例（含正確拒答） | > 85%    |

#### 評估方式

- 建立 30-50 筆代表性查詢的測試集
- 分類測試：一般查詢、模糊查詢、越界問題、追問情境
- 記錄實際延遲、Self-Correction 觸發率、拒答率、成功率
- MCP Tools 呼叫成功率與回應時間

---

# 第三章 實作成果

## 第一節 系統作業環境

### 3.1.1 硬體環境

| 項目     | 規格                                                                                          |
| -------- | --------------------------------------------------------------------------------------------- |
| 運行環境 | Cloudflare Edge Network（全球 300+ 節點）                                                     |
| 開發機   | ［待填入實際規格。建議欄位：CPU、記憶體、作業系統、Node.js 版本、pnpm 版本、Wrangler 版本。］ |

### 3.1.2 軟體環境

| 類別        | 技術                               | 版本   | 用途                                                |
| ----------- | ---------------------------------- | ------ | --------------------------------------------------- |
| Framework   | Nuxt                               | 4.x    | 全端框架                                            |
| Deployment  | NuxtHub                            | 0.10.x | Cloudflare 部署整合                                 |
| Database    | D1 + Drizzle                       | GA     | 邊緣資料庫 + ORM                                    |
| Auth        | Better Auth                        | 1.4.x  | OAuth 認證框架                                      |
| AI SDK      | Vercel AI SDK                      | 6.x    | Workers AI 模型統一抽象 + Agentic Tool Calling 介面 |
| UI          | Nuxt UI                            | 4.x    | UI 元件庫                                           |
| Managed RAG | Cloudflare AutoRAG                 | GA     | 受管理的文件索引與檢索                              |
| Edge LLM    | Workers AI (Llama 4 Scout 17B MoE) | -      | 簡單問答                                            |
| Agent LLM   | Workers AI (Kimi K2.5, 256K ctx)   | -      | 複雜推理 + Agent Tool Calling                       |

### 3.1.3 開發工具環境

| 工具               | 版本     | 用途                                 |
| ------------------ | -------- | ------------------------------------ |
| Claude Code        | Latest   | AI 輔助程式開發（主要 Coding Agent） |
| spectra            | Latest   | 規格驅動開發框架（SDD 流程管理）     |
| Nuxt MCP Server    | Official | Nuxt 4 文件即時查詢                  |
| Nuxt UI MCP Server | Official | UI 元件規格查詢                      |
| VS Code / Cursor   | Latest   | 程式編輯器                           |
| pnpm               | 9.x      | 套件管理                             |

## 第二節 系統功能與介面說明

### 3.2.1 流程說明

#### 知識庫建置流程

管理員上傳文件 → 原始檔案儲存至 R2 → 文件中繼資料寫入 D1 → 建立 ingestion_job → 呼叫 AutoRAG Ingestion API → AutoRAG 自動完成分塊、Embedding 與索引 → 更新 ingestion_job 狀態 → 建庫完成

#### 問答流程

使用者提問 → Query Normalization → AutoRAG 檢索 → 置信度評估 →
[若不足且未重試] Query Reformulation → 再次 AutoRAG 檢索 →
[若仍不足] 拒答並提示補充條件 →
[若足夠] 以 AI SDK streamText 組裝引用並生成回答 → 串流輸出 → 儲存對話紀錄

### 3.2.2 功能說明

| 功能模組 | 說明                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| 智慧問答 | 支援自然語言查詢，具 Self-Correction 能力（最多 1 次重試），回答附引用來源             |
| 對話歷史 | 使用者可查看過往對話紀錄，支援多輪追問                                                 |
| 知識管理 | 文件上傳、分類、編輯、下架，支援 PDF、Markdown、純文字                                 |
| 身分認證 | Google OAuth 登入，角色分為 User/Admin                                                 |
| 外部 API | 以 Nuxt MCP Toolkit 實作 MCP Server，提供 4 個核心 Tools，支援 Bearer token 與 Session |
| 查詢日誌 | 記錄查詢內容、延遲、是否觸發 Self-Correction、是否拒答                                 |

### 3.2.3 操作與介面說明

#### 登入畫面

［待補：插入登入畫面截圖。截圖 Prompt：Nuxt UI 深色主題，中央白色卡片，標題「企業知識庫」，副標「請選擇登入方式」。主要按鈕「使用 Google 帳號登入」（含 Google icon）。卡片底部小字「首次登入？系統將自動引導您註冊」。］

說明：系統以 better-auth 提供 Google OAuth 登入。首次使用時，系統會依 Google 帳號自動建立使用者並完成註冊。

#### 主畫面（問答介面）

［待補：插入主畫面截圖。截圖 Prompt：三欄式對話式 UI。左欄（窄）為對話歷史列表，含多個歷史標題與新增對話按鈕；中欄（寬）為對話區，上方顯示使用者提問泡泡「PO 和 PR 有什麼差別？」、下方為 AI 回答泡泡（已完成串流），回答文字中夾帶[1][2]引用標記，回答下方顯示「引用來源」區塊列出兩個文件片段卡片（含文件名、分類標籤、擷取段落）；右欄為目前問答的置信度指標（confidence score）與是否觸發 Self-Correction 的小徽章。最下方為輸入框與送出按鈕。整體使用 Nuxt UI 明亮主題。］

說明：左側為對話歷史列表，中間為對話區域，使用者可輸入問題並即時看到串流輸出的回答。回答下方顯示引用來源。

#### 知識庫管理畫面

［待補：插入知識庫管理畫面截圖。截圖 Prompt：後台頁面，頂部為搜尋列與「上傳文件」主按鈕。中央為資料表格，欄位依序為：標題、分類、標籤、狀態（已索引 / 索引中 / 下架）、AutoRAG 同步狀態、更新時間、操作（編輯 / 下架 / 刪除）。右側抽屜為新增/編輯文件表單，包含：檔案上傳（拖曳至 R2）、分類下拉選單、多標籤輸入、送出按鈕。頁面底部為分頁控制。整體使用 Nuxt UI Admin Dashboard 風格。］

說明：管理員可查看所有文件、上傳新文件、編輯分類與標籤、下架過期文件、查看 Ingestion 狀態。

## 第三節 其他實測或實驗結果

### 3.3.1 測試情境設計

| 情境     | 問題範例                 | 預期行為              | 目標延遲   |
| -------- | ------------------------ | --------------------- | ---------- |
| 簡單查詢 | PO 和 PR 有什麼差別？    | 直接回答並附引用      | < 300ms    |
| 模糊查詢 | 上個月的報表怎麼看？     | 觸發 Self-Correction  | 400-600ms  |
| SOP 查詢 | 庫存不足時該怎麼處理？   | 直接回答，附 SOP 引用 | 250-400ms  |
| 知識庫外 | 今天天氣如何？           | 正確拒答並引導        | < 100ms    |
| 複雜推理 | 比較 A 和 B 流程的優缺點 | Agent 處理            | 600-1000ms |
| 多輪追問 | 那第二步驟呢？           | 維持上下文並回答      | < 400ms    |

### 3.3.2 實測結果

［待補：填入實際測試數據。建議表格欄位：情境、執行次數、平均延遲（ms）、P50、P95、Self-Correction 觸發率、拒答率、成功率、備註。另附：(a) 以 30–50 筆代表性查詢進行情境測試的摘要；(b) AutoRAG 檢索的 top-k 覆蓋率與平均置信度分布；(c) MCP Tools 被外部 Client 呼叫的成功率與回應時間。］

---

# 第四章 結論

## 第一節 目標與特色

### 4.1.1 目標達成情況

對照第一章所列專題目的，本專題達成情況如下：

技術架構面：

1. 設計並實作一套基於 Serverless 邊緣原生架構的 RAG 系統，成功部署於 Cloudflare Workers 平台，驗證了企業知識庫於邊緣運行的技術可行性。（待實測數據補充效能驗證）

2. 建立 Hybrid Managed RAG 架構，以 Cloudflare AutoRAG 作為受管理檢索基礎、Workers AI 於邊緣執行 Agentic 問答流程；條件式 Cloud fallback 設計保留複雜情境的處理彈性。

3. 實作具備 Self-Correction 能力的 RAG 流程（最多 1 次重試），當首次檢索置信度不足時自動重寫查詢並二次檢索；若仍不足則執行拒答。（待實測數據驗證改善幅度）

4. 以 Nuxt MCP Toolkit 建立 MCP Server，將知識庫能力封裝為 4 個標準化 MCP Tools（searchKnowledge、askKnowledge、getDocumentChunk、listCategories），並以 Middleware 處理授權與 Sessions 支援多輪對話。

安全設計面：

5. 建立以 Google OAuth 為主的登入機制，採單租戶架構與 User/Admin 角色控管。

6. MCP 以 Bearer token Middleware 控管外部 AI Client 的存取範圍，以 useMcpSession 維持多輪追問的對話狀態。

開發方法論面：

7. 驗證 Spec-Driven Development + AI 輔助工具鏈（Claude Code + spectra + Nuxt MCP）的開發流程，為中小企業導入 AI 系統提供參考範例。

### 4.1.2 主要技術特色

1. **邊緣原生 Serverless 架構**：無需管理伺服器，按量計費，適合中小企業導入。

2. **Hybrid Managed RAG**：AutoRAG 降低檢索基礎設施維運負擔，自建 Agentic 層保留決策控制力。

3. **Self-Correction 與拒答機制**：提升模糊查詢的回答品質，正確拒答視為成功行為。

4. **MCP 標準化介面**：符合 Model Context Protocol 規範，可與外部 AI Client 互操作。

5. **全 TypeScript 開發**：前後端統一語言，類型安全，維護成本低。

6. **中小企業友善**：現有 Vue/JS 工程師可上手，無需專門 AI 工程師。

## 第二節 未來展望

### 4.2.1 功能擴展方向

1. 導入更多資料來源，如雲端文件庫、工單系統與內部知識平台。

2. 加入 rerank、metadata filtering 與更細緻的檢索策略。

3. 擴充 MCP 能力：MCP Resources、Dynamic Definitions、MCP Evals。

4. 擴展登入方式：Passkey（無密碼登入）、LINE Login 等。

### 4.2.2 架構演進方向

1. 多租戶架構：支援多企業場景，實作租戶隔離與計費。

2. 文件級 ACL：更細粒度的文件存取控制。

3. 更完整的可觀測性：追蹤日誌、效能監控、異常告警。

### 4.2.3 研究限制

1. 本專題以知識庫問答與系統整合為核心，尚未處理更完整的企業級資料治理與稽核需求。

2. 實測數據仍需補充，部分效益目前屬設計預期層級，待實機驗證後更新。

3. 當查詢高度模糊或需較長鏈推理時，邊緣模型表現可能不足，因此保留條件式 Cloud fallback。

4. Hybrid 架構在觀測與除錯上較單層系統複雜。

---

# 第五章 專題心得與檢討

## 第一節 組員心得

［待各組員分別撰寫。建議每人 300–500 字，涵蓋：(1) 在本專題扮演的角色與負責模組；(2) 學到的技術或工具（如 Spec-Driven Development、Cloudflare AutoRAG、Nuxt MCP Toolkit、AI SDK streaming、Agentic Orchestration 設計）；(3) 遇到的困難與解決方式；(4) 對團隊合作與 AI 輔助開發流程的觀察。］

## 第二節 檢討與改進

### 做得較好的部分

本專題在系統架構設計上，以四層式邊緣原生架構整合文件管理、受管理檢索、代理式問答流程與 MCP 互操作能力，具備明確的系統邊界與擴充方向。採用 AutoRAG 作為唯一檢索來源的設計簡化了系統複雜度，Self-Correction 最多 1 次重試的限制在延遲與品質間取得平衡。

### 仍可改進的部分

目前部分章節仍以設計規劃與預期效益為主，尚未完全補足量化測試數據、實際部署觀測結果與長時間運行紀錄。第四章結論中的達成情況需待實測數據支撐後更新為更具體的驗證結果。

### 後續可強化方向

後續應持續補強實測資料、系統截圖、MCP 工具互操作示例與組員個別反思，使報告內容更完整並更貼近正式專題成果報告格式。

---

# 第六章 參考文獻

[1] Lewis, P. et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks," NeurIPS, 2020.

[2] Asai, A. et al., "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection," arXiv, 2023.

[3] Yan, Z. et al., "Corrective Retrieval-Augmented Generation," arXiv, 2024.

[4] Anthropic, "Model Context Protocol Specification," 2024-2026. URL: https://modelcontextprotocol.io/specification

[5] Cloudflare, "Workers Documentation," 2024-2026. URL: https://developers.cloudflare.com/workers

[6] Cloudflare, "Workers AI Documentation," 2024-2026. URL: https://developers.cloudflare.com/workers-ai

[7] Cloudflare, "AutoRAG / AI Search Documentation," 2025-2026. URL: https://developers.cloudflare.com/autorag/

[8] Cloudflare, "D1 Documentation," 2024-2026. URL: https://developers.cloudflare.com/d1

[9] Cloudflare, "R2 Documentation," 2024-2026. URL: https://developers.cloudflare.com/r2

[10] Vercel, "AI SDK Documentation," 2025-2026. URL: https://sdk.vercel.ai

[11] Nuxt Team, "Nuxt 4 Documentation," 2025-2026. URL: https://nuxt.com

[12] NuxtHub, "NuxtHub Documentation," 2024-2026. URL: https://hub.nuxt.com

[13] Better Auth, "Better Auth Documentation," 2024-2026. URL: https://better-auth.com

[14] Drizzle Team, "Drizzle ORM Documentation," 2024-2026. URL: https://orm.drizzle.team

[15] Kao, C.-L., "spectra: A Desktop App for Spec-Driven Development (based on OpenSpec)," 2025-2026. URL: https://github.com/kaochenlong/spectra-app

[16] Fission AI, "OpenSpec: Spec-Driven Development for AI Coding Assistants," 2025-2026. URL: https://github.com/Fission-AI/OpenSpec

[17] Yang, F. et al., "Agentic AI-Driven Technical Troubleshooting," arXiv:2412.12006, 2024.

[18] Weaviate, "Implementing Agentic RAG," 2024. URL: https://weaviate.io/blog/agentic-rag

[19] IETF, "OAuth 2.0 Authorization Framework," RFC 6749, 2012.

[20] IETF, "Transport Layer Security (TLS) 1.3," RFC 8446, 2018.

[21] Nuxt Team, "Working with AI: Nuxt MCP Server," Nuxt Documentation, 2025. URL: https://nuxt.com/docs/4.x/guide/ai/mcp

[22] Nuxt UI Team, "MCP Server - Nuxt UI," 2025. URL: https://ui.nuxt.com/docs/getting-started/ai/mcp

[23] Anthropic, "Claude Code Documentation," 2025. URL: https://docs.anthropic.com/en/docs/claude-code

---

# 附錄

## 附錄 A：MCP Tools 規格

本系統 v1 版本提供以下 4 個核心 MCP Tools：

### A.1 searchKnowledge

語義檢索知識庫，回傳相關文件片段。

```typescript
// Input Schema (Zod)
const SearchKnowledgeInput = z.object({
  query: z.string().describe('搜尋查詢'),
  topK: z.number().optional().default(5).describe('回傳結果數量'),
  category: z.string().optional().describe('篩選分類'),
})

// Output Schema
interface SearchKnowledgeOutput {
  results: Array<{
    documentId: string
    documentTitle: string
    chunkIndex: number
    content: string
    score: number
    category: string
  }>
}
```

### A.2 askKnowledge

問答查詢，回傳回答與引用。

```typescript
// Input Schema (Zod)
const AskKnowledgeInput = z.object({
  question: z.string().describe('問題'),
  conversationId: z.string().optional().describe('對話 ID（用於多輪對話）'),
})

// Output Schema
interface AskKnowledgeOutput {
  answer: string
  citations: Array<{
    index: number
    documentId: string
    documentTitle: string
    content: string
  }>
  refused: boolean
  refusedReason?: string
  selfCorrectionTriggered: boolean
  confidenceScore: number
}
```

### A.3 getDocumentChunk

取得特定文件片段的完整內容。

```typescript
// Input Schema (Zod)
const GetDocumentChunkInput = z.object({
  documentId: z.string().describe('文件 ID'),
  chunkIndex: z.number().describe('片段索引'),
})

// Output Schema
interface GetDocumentChunkOutput {
  documentId: string
  documentTitle: string
  chunkIndex: number
  content: string
  category: string
  tags: string[]
}
```

### A.4 listCategories

列出所有分類與文件數量。

```typescript
// Input Schema (Zod)
const ListCategoriesInput = z.object({})

// Output Schema
interface ListCategoriesOutput {
  categories: Array<{
    name: string
    documentCount: number
  }>
}
```

### A.5 授權格式

所有 MCP Tools 呼叫需於 HTTP Header 附帶 Bearer token：

```
Authorization: Bearer <token>
```

錯誤碼：

| 錯誤碼 | 說明                                       |
| ------ | ------------------------------------------ |
| 401    | 未授權（缺少或無效的 token）               |
| 403    | 權限不足（token 不具備該 Tool 的存取權限） |
| 404    | 資源不存在                                 |
| 500    | 內部錯誤                                   |

## 附錄 B：測試資料集

［待補：測試用的問題與預期答案。建議 30–50 筆，分為四類：(1) 一般查詢（操作步驟、制度說明），期望直接回答並附引用；(2) 模糊查詢（缺少條件、術語不一致），期望觸發 Self-Correction 後改善結果；(3) 越界問題（知識庫未涵蓋的內容），期望拒答並提示補充；(4) 追問情境（基於前一輪回答延伸提問），期望利用 MCP Session 維持上下文。欄位建議：編號、類別、問題、期望答案類型（正常回答 / 拒答 / Self-Correction 觸發）、期望引用文件、實際結果、是否通過。］
