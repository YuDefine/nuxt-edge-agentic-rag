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

中華民國 115 年　月　日

# 中文摘要

本專題擬設計與實作一套基於邊緣原生架構之代理式檢索增強生成系統，並以中小企業知識庫為主要應用場景，作為 ERP 操作指引、制度文件、報表說明與內部 SOP 的智慧問答入口。系統目標不僅在於提供自然語言問答，更強調引用追溯、拒答能力、多輪對話、外部 AI Client 互操作，以及在資料治理條件下的彈性雲端備援。相較傳統單次靜態檢索流程，本系統將以 Hybrid Managed RAG 為主軸，採用 Cloudflare AI Search（原 AutoRAG）作為受管理的檢索基礎層，並於上層建立自有 Agentic Orchestration，使檢索、評估、回應生成與權限治理可被明確定義與驗證。[1][2][3][7]

在技術架構上，系統以前端 Nuxt 4 應用為使用者與管理者入口，後端則透過 NuxtHub 部署於 Cloudflare Workers，整合 D1、R2、KV、Workers AI 與 Vercel AI SDK。檢索部分由 Cloudflare AI Search 負責資料同步、文件轉換、分塊、Embedding、query rewriting、reranking 與 retrieval；回答生成則不直接交由 AI Search 完成，而是由應用層自建的 Agent 流程控制，以保留分段式置信度評估、Self-Correction、拒答判斷、引用組裝與審計記錄等核心能力。身份與權限資料採 better-auth 核心表搭配應用層 `user_profiles` 分層管理；引用追溯則以應用層 `source_chunks` 保存穩定 `citationId`，並以 `citation_records` 保存單次回答中的引用快照，避免把單次查詢紀錄誤當成長期穩定來源識別碼。邊緣模型配置方面，系統將以 Llama 4 Scout 17B MoE 作為預設快速回答模型，Kimi K2.5 作為複雜推理、查詢重寫與邊界情境 answerability judge 模型，並以 gpt-oss-120b 作為邊緣備援模型；如經資料治理與 feature flag 條件允許，則以 Claude Sonnet 4.6 作為預設雲端備援目標，其他候選模型為 GPT 5.4、Gemini 3.1 Pro、Gemini 3 Flash 與 Claude Opus 4.6。[6][7][10]

系統 `v1.0.0` 範圍採完整落地版規劃，包含 Web 問答介面、Google OAuth 與 Passkey 登入、Admin email allowlist、文件上傳與版本管理、AI Search 同步流程、查詢日誌與統計、MCP 4 個核心 Tools、Bearer token 與 scope 管理、MCP Session、多輪追問、拒答與條件式 Cloud fallback。多輪上下文方面，Web 對話與 MCP Session 明確分流：前者以 D1 持久化 `conversations/messages`，後者以 KV 保存 runtime context，而 D1 僅保存 `mcp_sessions` 與遮罩後審計紀錄。文件敏感等級採 `internal` / `restricted` 二級治理；`restricted` 在 `v1` 即具粗粒度存取限制與 Cloud fallback 封鎖能力，但不延伸為每文件、每群組、每欄位 ACL。為避免規格與實作脫節，本版文件定位為「實作前規格版」：第三章與第四章將保留正式專題報告的章節骨架，但所有未經實測之效能、成本與成果陳述皆改寫為設計目標、驗收條件或待驗證項，不將尚未完成的結果寫成既成事實。

在驗證規劃上，本專題將以代表性查詢測試集檢驗一般問答、模糊查詢、自我修正、正確拒答、多輪對話與 MCP 互操作，並以分路徑延遲、引用正確率、回答正確率、拒答精準率、Self-Correction 觸發率、judge 觸發率、MCP Tool 成功率、current-version-only 檢索正確性與記錄遮罩完整性等指標作為評估基準。本版文件將作為後續系統實作、截圖回填、圖表繪製、答辯準備與正式報告收斂的共同基準。

關鍵字：代理式檢索增強生成（Agentic RAG）、邊緣原生架構（Edge-Native）、Cloudflare AI Search、Self-Correction、Model Context Protocol（MCP）、規格驅動開發（SDD）

---

# 目錄

［待依正式頁碼產生目錄。］

---

# 符號索引

| 縮寫/符號       | 全稱                                   | 說明                                                 |
| --------------- | -------------------------------------- | ---------------------------------------------------- |
| RAG             | Retrieval-Augmented Generation         | 檢索增強生成，結合外部知識檢索與 LLM 回應生成。      |
| Agentic RAG     | Agentic Retrieval-Augmented Generation | 由代理流程主動控制檢索、評估、重試與拒答之 RAG。     |
| LLM             | Large Language Model                   | 大型語言模型。                                       |
| MCP             | Model Context Protocol                 | 標準化 AI Client 與外部工具互動的協定。              |
| SSE             | Server-Sent Events                     | 用於串流回應與 MCP Session 連線的事件傳輸方式。      |
| RBAC            | Role-Based Access Control              | 以角色為基礎的存取控制模型。                         |
| PII             | Personally Identifiable Information    | 可識別個人身分之敏感資料。                           |
| AI Search       | Cloudflare AI Search                   | Cloudflare 受管理搜尋服務，原 AutoRAG。              |
| D1              | Cloudflare D1                          | Cloudflare 的 SQLite 相容資料庫服務。                |
| R2              | Cloudflare R2                          | Cloudflare 物件儲存服務。                            |
| KV              | Cloudflare KV                          | Cloudflare 鍵值型儲存服務，適合快取與 Session 儲存。 |
| Passkey         | Passkey / WebAuthn Credential          | 無密碼登入機制，以公開金鑰憑證完成驗證。             |
| Self-Correction | Self-Correction Loop                   | 首次檢索不足時，由 Agent 重寫查詢並重試一次的流程。  |

---

# 圖表目錄

［本版保留待製作圖表說明。待正式圖表與截圖完成後，依圖 1-1、圖 1-2、圖 2-1……回填。］

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

- 設計並實作一套基於 Nuxt 4、NuxtHub 與 Cloudflare 邊緣服務的企業知識庫問答系統。
- 建立以 Cloudflare AI Search 為檢索底層、以 Vercel AI SDK 與 Workers AI 為決策與生成層的 Hybrid Managed RAG 架構。
- 實作包含 Query Normalization、Self-Correction、拒答與引用追溯的完整問答流程。
- 以 `@nuxtjs/mcp-toolkit` 建立 MCP Server，對外提供可受權限控管之標準化知識工具。[15]

### 1.2.2 安全設計面

- 以 better-auth 整合 Google OAuth 與 Passkey，建立單租戶、雙角色的登入與存取控制機制。[13][22]
- 以 Admin email allowlist 管理管理員身分來源，避免在初始註冊流程中產生不明確的升權邏輯。
- 以 Bearer token、scope、到期時間、撤銷機制與 Session 邊界保護 MCP 對外存取。
- 將敏感資料過濾、記錄遮罩與 Cloud fallback 資料治理納入正式規格，而非實作後補強。

### 1.2.3 驗證與營運面

- 建立可追溯的查詢日誌、引用紀錄、MCP 呼叫紀錄與管理統計，作為後續驗證依據。
- 明確區分「回答正確率」與「正確拒答率」，避免以模糊指標掩蓋系統失誤。
- 以正式測試集驗證 Web 與 MCP 兩種使用通道是否符合相同的回答品質要求。

## 第三節 專題需求

### 1.3.1 專題簡介

本系統以企業知識庫問答為核心，服務範圍與需求如下。

目標用戶：

- 一般使用者：查詢 SOP、制度、報表欄位意義、操作步驟與名詞說明。
- 系統管理員：維護知識庫文件、管理版本、查看查詢日誌、管理 MCP token。
- 外部 AI Client：透過 MCP Tool 使用知識查詢、問答與引用追溯能力。

`v1.0.0` 正式納入範圍如下（以下若簡寫 `v1`，皆指 `v1.0.0`）：

| 分類     | `v1` 納入內容                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 身分驗證 | Google OAuth、Passkey、User/Admin 角色、Admin email allowlist                                                                     |
| 知識管理 | 文件上傳、版本管理、R2 儲存、AI Search 同步、文件狀態管理、`is_current` 發布規則                                                  |
| 問答流程 | Query Normalization、AI Search 檢索、分段式置信度評估、Self-Correction、拒答、引用顯示、Web 對話歷史                              |
| MCP 介面 | `searchKnowledge`、`askKnowledge`、`getDocumentChunk`、`listCategories`、Bearer token、Session、`knowledge.restricted.read` scope |
| 可觀測性 | 查詢日誌、`source_chunks` / `citation_records`、MCP 呼叫成功率、決策路徑與延遲統計、遮罩審計資訊                                  |
| 雲端備援 | 條件式 Cloud fallback，預設關閉，允許以 Claude Sonnet 4.6 作為預設外部模型                                                        |

不在 `v1` 範圍：

- 不直接寫回 ERP 交易資料或執行關鍵商務操作。
- 不處理多租戶隔離與租戶計費。
- 不在 `v1` 納入 LINE Login。
- 不在 `v1` 實作每文件、每群組或欄位層級 ACL；僅提供 `internal` / `restricted` 二級粗粒度存取與 Cloud fallback 治理閘道。

圖 1-1 系統功能圖（待製作）

待製作說明：

- 圖型：樹狀結構圖
- 圖名：企業知識庫 Agentic RAG 系統功能圖
- 應呈現內容：
  1. 使用者端：自然語言問答、對話歷史、引用查看、拒答提示
  2. 管理後台：文件 CRUD、版本管理、查詢紀錄檢視、AI Search 同步、MCP token 管理
  3. Agentic 核心：置信度評估、Query Reformulation、Self-Correction、拒答判斷、雲端備援閘道
  4. MCP 介面：`searchKnowledge`、`askKnowledge`、`getDocumentChunk`、`listCategories`
- 視覺風格：扁平化、方框與圓角、繁體中文、章節內圖號預留為「圖 1-1」

### 1.3.2 專題架構

本系統採四層式邊緣原生架構，分為前端層、資料與受管理檢索層、Agentic AI 層與 MCP 層。整體原則為「檢索受管理、回答自建、治理先行、雲端備援預設關閉」。

圖 1-2 系統架構圖（待製作）

待製作說明：

- 圖型：四層水平分層圖
- 圖名：Hybrid Managed RAG 邊緣原生系統架構圖
- 應呈現內容：
  1. 前端層：Nuxt 4、Nuxt UI、`@ai-sdk/vue` `useChat` 串流介面
  2. 資料與受管理檢索層：Cloudflare Workers、NuxtHub、Drizzle ORM、D1、R2、KV、Cloudflare AI Search
  3. Agentic AI 層：Vercel AI SDK、`workers-ai-provider`、Llama 4 Scout 17B MoE、Kimi K2.5、gpt-oss-120b
  4. MCP 層：Nuxt MCP Toolkit、Middleware、Sessions、Bearer Auth
  5. 右側以虛線標示條件式 Cloud fallback，預設目標為 Claude Sonnet 4.6，候選替代模型為 GPT 5.4、Gemini 3.1 Pro、Gemini 3 Flash、Claude Opus 4.6
  6. 以單一 Cloudflare Edge 邊界框包覆四層，強調邊緣優先與雲端備援非預設

架構說明如下：

- 前端層：使用 Nuxt 4 與 Nuxt UI 建立問答介面、管理後台與設定頁。使用者可透過 Google OAuth 或 Passkey 登入，並在同一前端中存取各自權限允許的對話歷史、文件管理與統計頁面。
- 資料與受管理檢索層：以 R2 儲存原始文件與版本檔，D1 儲存結構化資料，KV 作為快取與 MCP Session 的 unstorage 驅動。Cloudflare AI Search 連接既定資料來源後，負責 Markdown 轉換、分塊、Embedding、query rewriting、reranking 與 retrieval；應用層先以 metadata filter 套用 `status = active`、`version_state = current` 與可見 `access_level`，再於回答前以 D1 驗證 `document_version_id` 是否仍符合 `documents.status = active` 與 `document_versions.is_current = true`。AI Search metadata 僅作第一層快篩，D1 才是 current-version-only 的最終真相來源。[7][15]
- Agentic AI 層：回答生成與流程控制由應用層掌握。第一輪檢索後，系統先計算純檢索訊號的 `retrieval_score`；僅在邊界區間時才由 Kimi K2.5 執行 answerability judge，以兼顧回答品質與首字延遲。若仍不足則由 Kimi K2.5 進行 Query Reformulation 並重試一次；第二輪後仍不足則拒答，或在符合政策條件下改由 Claude Sonnet 4.6 執行條件式 Cloud fallback。
- MCP 層：以 `@nuxtjs/mcp-toolkit` 建立 MCP 端點，透過 Middleware 驗證 Bearer token 與 scope，並以 `useMcpSession()` 維持同一 `MCP-Session-Id` 下的多輪上下文。Web 對話與 MCP Session 為兩條不同的真相來源：前者以 `conversations/messages` 持久化，後者以 KV 作為 runtime state，而 D1 僅保存 `mcp_sessions` metadata 與遮罩後查詢日誌。[15]

本系統規劃於 AI Search 中固定使用 5 個 custom metadata 欄位：`document_version_id`、`category`、`status`、`access_level`、`version_state`。其中 `document_id` 與 `version_no` 不再額外占用 custom metadata，而是由 `folder = /kb/{category}/{document_id}/v{version_no}/` 路徑策略與 D1 回推。此設計是為了符合 AI Search custom metadata 上限，同時仍保留分類篩選、版本追蹤、current-version-only 檢索、文件狀態控制與 Cloud fallback 前的資料治理判斷。`documents.tags` 僅保留於 D1 供後台管理與後續延伸，不同步至 AI Search，也不作為 `v1` MCP 對外檢索契約參數。

## 第四節 預期效益

對使用者：

- 以自然語言提問取代手動翻找文件，提高操作問題的定位效率。
- 透過引用與片段回看機制，降低對黑盒式回答的不信任感。
- 在問題資訊不足時得到明確拒答與補充方向，而非錯誤但自信的回答。

對中小企業：

- 以邊緣原生架構降低基礎設施管理複雜度，將維運工作集中在知識內容與權限治理。
- 以 AI Search 接手文件處理與檢索基礎流程，減少自建向量基礎設施的負擔。
- 透過 MCP 提供標準化知識能力，讓未來 AI 助理整合不必重新設計私有 API。
- 以「預設留在邊緣、符合條件才可外送」的治理策略降低資料外送風險。

對技術社群：

- 提供 Cloudflare AI Search、Workers AI、Nuxt MCP Toolkit 與 better-auth 的整合規格範例。
- 示範如何把受管理檢索服務與自建 Agent 決策流程分層，避免責任邊界混亂。
- 提供專題報告在實作前階段的規格化寫法，讓後續回填測試資料與截圖時有一致基準。

本節效益為設計預期，不宣稱既有成效；成本節省比例、延遲改善幅度與使用者效益須待第三章與第四章之正式驗證結果回填後方可定論。

---

# 第二章 分析與設計

## 第一節 分析

### 2.1.1 使用案例分析

圖 2-1 使用案例圖（待製作）

待製作說明：

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
  - 查看查詢日誌與統計
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

| Actor          | Use Case                | 說明                                                  |
| -------------- | ----------------------- | ----------------------------------------------------- |
| User           | 提問並獲得回答          | 輸入自然語言問題，取得含引用與拒答能力的回答          |
| User           | 查看對話歷史            | 回顧過往問答紀錄與引用資訊                            |
| User           | 追問多輪對話            | 基於現有對話上下文延伸提問                            |
| Admin          | 上傳文件                | 建立文件與初始版本，上傳原始檔至 R2                   |
| Admin          | 建立新版本              | 為既有文件建立新版本並重新同步至 AI Search            |
| Admin          | 觸發 AI Search 同步     | 發動 instance 級同步流程，更新索引狀態                |
| Admin          | 查看查詢日誌與統計      | 檢視延遲、引用、拒答、Self-Correction 與 MCP 使用概況 |
| Admin          | 管理 MCP token          | 建立、檢視、撤銷 Bearer token 與 scope                |
| External Agent | 呼叫 `searchKnowledge`  | 以檢索方式取得片段結果                                |
| External Agent | 呼叫 `askKnowledge`     | 以問答方式取得回答與引用                              |
| External Agent | 呼叫 `getDocumentChunk` | 以 `citationId` 取得完整引用片段                      |
| External Agent | 呼叫 `listCategories`   | 取得知識庫分類列表與數量                              |

### 2.1.2 問答流程分析

本系統採固定主線的 Agentic RAG 問答流程，明確區分「AI Search 負責檢索」與「應用層負責回答生成」。第一輪檢索優先使用 AI Search 的 query rewriting 與 reranking 能力；應用層先以純檢索訊號計算 `retrieval_score`，僅在邊界區間才追加 answerability judge，以控制延遲成本。若整體證據仍不足，再由應用層 Agent 啟動一次 Self-Correction 重試。[7]

圖 2-2 Agentic RAG 問答活動圖（待製作）

待製作說明：

- 圖型：UML Activity Diagram
- 主流程節點依序為：
  1. 使用者提問
  2. Query Normalization
  3. 權限、敏感資料與查詢複雜度檢查
  4. 呼叫 AI Search `search` 端點
  5. `retrieval_score` 評估
  6. 邊界區間 answerability judge
  7. 分支 A：直接回答
  8. 分支 B：Query Reformulation 後重試一次
  9. 分支 C：拒答
  10. 分支 D：條件式 Cloud fallback
  11. `source_chunks` / `citation_records` 組裝與串流輸出
- 圖中應明示：
  - 第一輪檢索 `rewrite_query = true`
  - 第二輪重試 `rewrite_query = false`
  - `status = active`、`version_state = current`
  - `access_level in allowed_access_levels`
  - `answerability judge 僅於中段分數時觸發`
  - `最多 1 次重試`
  - `Cloud fallback 預設關閉`

問答流程與 `v1` 初版預設值如下：

1. **使用者提問**：前端 Web 或 MCP Client 傳入自然語言問題。
2. **Query Normalization**：系統標準化空白、同義詞、常見 ERP 縮寫、日期寫法與分類篩選條件。
3. **權限、敏感資料與複雜度檢查**：在任何模型推論前，先對查詢進行敏感資料檢測，依 Web User／Web Admin／MCP scope 推導本次 `allowed_access_levels`，並標示問題屬於簡單事實查詢、模糊查詢、跨文件比較或多輪追問。
4. **第一輪 AI Search 檢索**：呼叫 AI Search `search` 路徑，只取回片段不直接生成回答。`v1` 初版預設參數為 `max_num_results = 8`、`ranking_options.score_threshold = 0.35`、`rewrite_query = true`，並額外強制套用 `status = active`、`version_state = current`、`access_level in allowed_access_levels`。若實作採用 provider 或 binding 封裝，參數名稱可依 SDK 調整，但語意必須與此處一致，不再另立第二套契約名稱。取得候選片段後，應用層必須先以 D1 驗證 `document_version_id` 仍為 `active/current` 可用版本，未通過者一律視為無效證據。
5. **第一階段置信度評估**：系統先以通過遠端 metadata 與 D1 current 驗證之候選片段計算 `top1_score`、`mean_top3_score` 與 `evidence_coverage`，再合成 `retrieval_score`。
6. **直接回答條件**：若 `retrieval_score >= 0.70`，則不再呼叫 judge，直接進入回答生成，由 Llama 4 Scout 或 Kimi K2.5 依查詢複雜度產生回答。
7. **邊界區間 judge**：若 `0.45 <= retrieval_score < 0.70`，則由 Kimi K2.5 進行一次 answerability judge，並以固定 JSON schema 回傳 `answerability_judge: number (0..1)`、`should_answer: boolean`、`reason: string`，再合成最終 `confidence_score`。
8. **Self-Correction 條件**：若 `confidence_score < 0.55` 或 `retrieval_score < 0.45`，且 `retry_count = 0`，並且至少存在一筆通過遠端 metadata 與 D1 驗證的候選片段可供重寫，則由 Kimi K2.5 重寫查詢，保留原始限制條件與關鍵實體，再重新呼叫 AI Search 檢索一次。第二輪重試停用 AI Search `rewrite_query`，避免雙重改寫失真。
9. **拒答條件**：若第二輪後仍 `confidence_score < 0.55`，或檢索結果無足夠引用，或唯一可用證據皆屬未授權 `restricted` 內容，則回傳拒答結果與補充建議。
10. **條件式 Cloud fallback**：僅當 `CLOUD_FALLBACK_ENABLED = true`、治理條件全部通過、且第二輪後仍有部分可用 `internal` 證據但不足以在邊緣完成高品質整合推理時，才以 Claude Sonnet 4.6 作為預設外部模型重新生成回答。Cloud fallback 在 `v1.0.0` 中明確定位為 `synthesis-only` 路徑：不補抓新證據、不放寬權限篩選、不擴張檢索範圍，只基於已核可的引用摘錄完成整合與表述。若任一候選證據或最終引用含 `restricted` 內容，Cloud fallback 必須停用。
11. **引用組裝與記錄**：系統僅能對通過驗證之候選片段依 `document_version_id + locator_hash + chunk_hash` upsert `source_chunks`，再建立本次查詢的 `citation_records`、寫入遮罩後 `query_logs`，並將回答以串流方式輸出。

`retrieval_score` 由以下三項組成：

| 構成項目            | 說明                                                       | 權重 |
| ------------------- | ---------------------------------------------------------- | ---- |
| `top1_score`        | 第一名片段的 `score`，若無結果則為 `0`                     | 0.45 |
| `mean_top3_score`   | 前三名片段 `score` 平均值，不足三筆以 `0` 補齊             | 0.35 |
| `evidence_coverage` | 由可用引用數量、跨文件覆蓋度與遠端 metadata／D1 一致性計算 | 0.20 |

`confidence_score` 僅在 judge 觸發後重新計算如下：

| 構成項目              | 說明                                             | 權重 |
| --------------------- | ------------------------------------------------ | ---- |
| `retrieval_score`     | 第一階段純檢索分數                               | 0.80 |
| `answerability_judge` | Kimi K2.5 依固定 schema 回傳之 `0..1` 可回答分數 | 0.20 |

計算公式如下：

```text
retrieval_score =
  0.45 * top1_score +
  0.35 * mean_top3_score +
  0.20 * evidence_coverage

if retrieval_score >= 0.70:
  confidence_score = retrieval_score
elif 0.45 <= retrieval_score < 0.70:
  confidence_score =
    0.80 * retrieval_score +
    0.20 * answerability_judge
else:
  confidence_score = retrieval_score
```

其中各子分數的實作細則如下：

```text
verified_results =
  results.filter(result =>
    matches_required_remote_filters(result) &&
    d1_confirms_active_current(result.document_version_id)
  )

top1_score = verified_results[0]?.score ?? 0

mean_top3_score =
  average([
    verified_results[0]?.score ?? 0,
    verified_results[1]?.score ?? 0,
    verified_results[2]?.score ?? 0
  ])

citation_count_score = min(valid_citation_count, 3) / 3
document_diversity_score =
  valid_citation_count === 0
    ? 0
    : is_cross_document_query
      ? min(distinct_document_count, 2) / 2
      : 1
metadata_consistency =
  valid_citation_count === 0
    ? 0
    : verified_results.length === results.length ? 1 : 0

evidence_coverage =
  0.50 * citation_count_score +
  0.30 * document_diversity_score +
  0.20 * metadata_consistency
```

上述定義的目的，是讓 `retrieval_score` 在 `v1` 階段即具備可重現、可測試、可比對的計算方式，避免不同實作者各自詮釋分數來源。文中的 `0.35`、`0.45`、`0.55`、`0.70` 皆為 `v1.0.0` 初版預設值，屬部署設定而非對外 API 契約；正式上線前可依 15 筆種子案例與 30–50 筆正式測試集校準，但校準後必須同步更新文件與驗證報告，不得由不同路徑各自採用不同門檻。

## 第二節 設計

### 2.2.1 資料庫設計

本系統使用 D1（SQLite）儲存應用層的結構化資料，並以 Drizzle ORM 管理資料模型。為避免資料責任邊界混亂，本節刻意將「AI Search 管理的檢索資料」與「應用層必須保留的治理資料」區分開來。better-auth 所需的底層認證資料表由套件自動產生，以下 ER 與資料表設計聚焦在專題核心領域資料，不展開所有 auth 系統內部表。[13][14]

圖 2-3 ER 圖（待製作）

待製作說明：

- 圖型：Crow's Foot ER Diagram
- 實體應至少包含：
  - `better_auth_users`（better-auth 核心表，以淡色或虛線表示）
  - `user_profiles`
  - `documents`
  - `document_versions`
  - `source_chunks`
  - `ingestion_jobs`
  - `conversations`
  - `messages`
  - `query_logs`
  - `citation_records`
  - `mcp_tokens`
  - `mcp_sessions`
- 關聯重點：
  - `better_auth_users` 1─1 `user_profiles`
  - `user_profiles` 1─N `documents`
  - `documents` 1─N `document_versions`
  - `document_versions` 1─N `source_chunks`
  - `document_versions` 1─N `ingestion_jobs`
  - `user_profiles` 1─N `conversations`
  - `conversations` 1─N `messages`
  - `query_logs` 1─N `citation_records`
  - `source_chunks` 1─N `citation_records`
  - `user_profiles` 1─N `mcp_tokens`
  - `mcp_tokens` 1─N `mcp_sessions`
- 註記要求：
  - `document_versions.ai_search_file_id` 與 AI Search 索引項目對應
  - `source_chunks.id` 為對外公開之穩定 `citationId`
  - `citation_records.id` 僅為單次查詢中的引用快照紀錄，不對外公開

#### 核心資料表設計

**user_profiles（應用層使用者設定）**

| 欄位         | 類型                                   | 說明                    |
| ------------ | -------------------------------------- | ----------------------- |
| user_id      | string (PK, FK → better_auth_users.id) | 對應 better-auth 使用者 |
| display_name | string                                 | 顯示名稱                |
| role         | enum ('user', 'admin')                 | 系統角色                |
| status       | enum ('active', 'disabled')            | 使用狀態                |
| auth_source  | enum ('google', 'passkey', 'mixed')    | 主要登入來源            |
| admin_source | enum ('none', 'allowlist', 'manual')   | 管理員身分來源          |
| created_at   | timestamp                              | 建立時間                |
| updated_at   | timestamp                              | 更新時間                |

**documents（文件）**

| 欄位         | 類型                                 | 說明                                                      |
| ------------ | ------------------------------------ | --------------------------------------------------------- |
| id           | string (PK)                          | 文件唯一識別碼                                            |
| title        | string                               | 文件標題                                                  |
| category     | string                               | 文件分類                                                  |
| tags         | json                                 | 標籤陣列（供後台管理與未來延伸；`v1` 不同步至 AI Search） |
| access_level | enum ('internal', 'restricted')      | 敏感等級                                                  |
| status       | enum ('draft', 'active', 'archived') | 文件狀態                                                  |
| uploaded_by  | string (FK → user_profiles.user_id)  | 建立者                                                    |
| created_at   | timestamp                            | 建立時間                                                  |
| updated_at   | timestamp                            | 更新時間                                                  |

**document_versions（文件版本）**

| 欄位              | 類型                                                                         | 說明                            |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| id                | string (PK)                                                                  | 版本唯一識別碼                  |
| document_id       | string (FK → documents.id)                                                   | 所屬文件                        |
| version_no        | integer                                                                      | 版本號                          |
| r2_key            | string                                                                       | 原始檔於 R2 的路徑              |
| checksum          | string                                                                       | 檔案雜湊值                      |
| mime_type         | string                                                                       | MIME 類型                       |
| size_bytes        | integer                                                                      | 檔案大小                        |
| ai_search_file_id | string                                                                       | AI Search 對應之 `file_id`      |
| metadata_json     | json                                                                         | 同步至 AI Search 的中繼資料快照 |
| index_status      | enum ('queued', 'syncing', 'smoke_pending', 'indexed', 'failed', 'archived') | 索引狀態                        |
| is_current        | boolean                                                                      | 是否為目前啟用版本              |
| indexed_at        | timestamp                                                                    | 最近成功索引時間                |
| created_by        | string (FK → user_profiles.user_id)                                          | 建立者                          |
| created_at        | timestamp                                                                    | 建立時間                        |

補充約束：

- `documents.id + document_versions.version_no` 必須唯一。
- 每份文件僅允許一筆 `is_current = true`，發布流程需在單一 transaction 中完成舊版降級與新版升級。
- `metadata_json` 需明確保存送往 AI Search 的 5 個 custom metadata 與 `folder` 路徑快照，避免 D1 與遠端設定脫鉤。

**source_chunks（穩定引用來源）**

| 欄位                | 類型                               | 說明                                                                                     |
| ------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| id                  | string (PK)                        | 穩定 `citationId`，由 `document_version_id + locator_hash + chunk_hash` 生成之 opaque ID |
| document_version_id | string (FK → document_versions.id) | 所屬文件版本                                                                             |
| locator_hash        | string                             | 由頁碼、標題路徑、chunk ordinal 等定位資訊雜湊而成，用於同文同字片段去歧義               |
| locator_json        | json                               | 來源定位資訊快照                                                                         |
| chunk_hash          | string                             | 正規化 chunk 文字後的雜湊                                                                |
| ai_search_file_id   | string                             | 最近一次觀察到的 AI Search `file_id`                                                     |
| ai_search_chunk_id  | string                             | 最近一次觀察到的 AI Search chunk 識別碼                                                  |
| chunk_index         | integer                            | 應用層保存之穩定順序；若供應商未提供則於首次建立時指派                                   |
| chunk_text          | text                               | 完整片段文字快照，供 `getDocumentChunk` 回放                                             |
| excerpt_preview     | text                               | 顯示用短摘錄                                                                             |
| created_at          | timestamp                          | 建立時間                                                                                 |
| updated_at          | timestamp                          | 更新時間                                                                                 |

補充規則：

- `source_chunks` 應建立 `(document_version_id, locator_hash, chunk_hash)` 唯一約束。
- 若同一文件版本內出現完全相同文字片段，系統必須以 `locator_hash` 去歧義，不得僅以 `chunk_hash` 合併。

**ingestion_jobs（同步任務）**

| 欄位                | 類型                                                               | 說明                             |
| ------------------- | ------------------------------------------------------------------ | -------------------------------- |
| id                  | string (PK)                                                        | 任務唯一識別碼                   |
| document_version_id | string (FK → document_versions.id)                                 | 關聯版本                         |
| sync_scope          | enum ('instance', 'document_version')                              | 同步範圍                         |
| status              | enum ('queued', 'syncing', 'smoke_pending', 'completed', 'failed') | 任務狀態                         |
| ai_search_job_id    | string                                                             | AI Search 任務識別碼（若可取得） |
| error_message       | text                                                               | 錯誤訊息                         |
| started_at          | timestamp                                                          | 開始時間                         |
| completed_at        | timestamp                                                          | 完成時間                         |
| created_at          | timestamp                                                          | 建立時間                         |

補充規則：

- 同一 `document_version_id` 同時間僅允許一筆狀態為 `queued`、`syncing` 或 `smoke_pending` 的同步任務；重複觸發應回傳既有 job 或 `409`，不得重複排程。
- AI Search 遠端同步完成後，任務先進入 `smoke_pending`；只有 smoke retrieval 通過，任務才可標記為 `completed`，並將 `document_versions.index_status` 推進為 `indexed`。
- smoke retrieval 屬維運用驗證流程，需以目標 `document_version_id` 執行候選片段檢查，並確認可建立 `source_chunks` 映射；若無法通過，任務與版本狀態皆應標記為 `failed`。

**conversations（Web 對話）**

| 欄位       | 類型                                | 說明           |
| ---------- | ----------------------------------- | -------------- |
| id         | string (PK)                         | 對話唯一識別碼 |
| user_id    | string (FK → user_profiles.user_id) | 關聯使用者     |
| title      | string                              | 對話標題       |
| created_at | timestamp                           | 建立時間       |
| updated_at | timestamp                           | 最後更新時間   |
| deleted_at | timestamp                           | 軟刪除時間     |

**messages（訊息）**

| 欄位             | 類型                                 | 說明                                                                            |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| id               | string (PK)                          | 訊息唯一識別碼                                                                  |
| conversation_id  | string (FK → conversations.id)       | 所屬對話                                                                        |
| role             | enum ('user', 'assistant', 'system') | 訊息角色                                                                        |
| content_text     | text                                 | 僅保存通過安全檢查、允許持久化之 Web 對話原文，供多輪上下文延續與使用者本人查看 |
| content_redacted | text                                 | 稽核與分析用遮罩版本，不作為上下文真相來源                                      |
| model_name       | string                               | 產生該回應所用模型                                                              |
| citations_json   | json                                 | 行內引用對應資料                                                                |
| metadata_json    | json                                 | 其他中繼資料                                                                    |
| created_at       | timestamp                            | 建立時間                                                                        |

**query_logs（查詢日誌）**

| 欄位                      | 類型                                                                         | 說明                                                       |
| ------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| id                        | string (PK)                                                                  | 日誌唯一識別碼                                             |
| channel                   | enum ('web', 'mcp')                                                          | 來源通道                                                   |
| user_id                   | string (FK → user_profiles.user_id, nullable)                                | 關聯使用者                                                 |
| conversation_id           | string (FK → conversations.id, nullable)                                     | 關聯對話                                                   |
| mcp_session_id            | string (FK → mcp_sessions.id, nullable)                                      | 關聯 MCP Session                                           |
| original_query_masked     | text                                                                         | 原始查詢之遮罩版本                                         |
| normalized_query_masked   | text                                                                         | 標準化後查詢之遮罩版本                                     |
| reformulated_query_masked | text                                                                         | Self-Correction 後查詢之遮罩版本                           |
| request_outcome           | enum ('answered', 'refused', 'forbidden', 'invalid', 'error')                | 請求結果分類                                               |
| retrieval_filters_json    | json                                                                         | AI Search 篩選條件、`allowed_access_levels` 與 D1 驗證摘要 |
| top_k                     | integer                                                                      | 檢索片段數量                                               |
| retrieval_score           | float                                                                        | 第一階段純檢索分數                                         |
| judge_triggered           | boolean                                                                      | 是否觸發 answerability judge                               |
| answerability_judge_score | float                                                                        | judge 分數（未觸發則為 null）                              |
| confidence_score          | float                                                                        | 最終置信度分數                                             |
| decision_path             | enum ('direct', 'judge_pass', 'self_corrected', 'refused', 'cloud_fallback') | 最終決策路徑                                               |
| self_correction_triggered | boolean                                                                      | 是否觸發 Self-Correction                                   |
| refused                   | boolean                                                                      | 是否拒答                                                   |
| fallback_used             | boolean                                                                      | 是否使用 Cloud fallback                                    |
| answer_model              | string                                                                       | 實際回答模型名稱                                           |
| cloud_model               | string                                                                       | 雲端模型名稱                                               |
| risk_flags_json           | json                                                                         | 敏感資料、權限與政策標記                                   |
| redaction_applied         | boolean                                                                      | 是否已完成記錄遮罩                                         |
| http_status               | integer                                                                      | 對外回應狀態碼                                             |
| first_token_latency_ms    | integer                                                                      | 首字延遲                                                   |
| completion_latency_ms     | integer                                                                      | 完整回答延遲                                               |
| created_at                | timestamp                                                                    | 建立時間                                                   |

**citation_records（引用紀錄）**

| 欄位            | 類型                           | 說明                 |
| --------------- | ------------------------------ | -------------------- |
| id              | string (PK)                    | 引用快照唯一識別碼   |
| query_log_id    | string (FK → query_logs.id)    | 所屬查詢             |
| source_chunk_id | string (FK → source_chunks.id) | 對應穩定引用來源     |
| ordinal         | integer                        | 引用序號             |
| excerpt         | text                           | 回答中顯示的引用摘錄 |
| score           | float                          | 片段分數             |
| created_at      | timestamp                      | 建立時間             |

**mcp_tokens（MCP Bearer token）**

| 欄位              | 類型                                          | 說明             |
| ----------------- | --------------------------------------------- | ---------------- |
| id                | string (PK)                                   | Token 唯一識別碼 |
| label             | string                                        | 顯示名稱         |
| token_hash        | string                                        | 雜湊後 token 值  |
| scopes            | json                                          | 權限範圍         |
| issued_to_user_id | string (FK → user_profiles.user_id, nullable) | 關聯發放對象     |
| status            | enum ('active', 'revoked', 'expired')         | 狀態             |
| last_used_at      | timestamp                                     | 最後使用時間     |
| expires_at        | timestamp                                     | 到期時間         |
| created_by        | string (FK → user_profiles.user_id)           | 發放者           |
| created_at        | timestamp                                     | 建立時間         |
| updated_at        | timestamp                                     | 更新時間         |

**mcp_sessions（MCP Session 中繼資料）**

| 欄位           | 類型                                          | 說明                           |
| -------------- | --------------------------------------------- | ------------------------------ |
| id             | string (PK)                                   | `MCP-Session-Id`               |
| token_id       | string (FK → mcp_tokens.id)                   | 關聯 Bearer token              |
| user_id        | string (FK → user_profiles.user_id, nullable) | 關聯使用者                     |
| client_id      | string                                        | Client 名稱或識別碼            |
| transport      | enum ('sse', 'streamable_http')               | 傳輸方式                       |
| storage_driver | enum ('kv', 'memory')                         | `useMcpSession()` 底層儲存驅動 |
| state_keys     | json                                          | 當前 Session 已使用之 key 清單 |
| last_active_at | timestamp                                     | 最近活動時間                   |
| expires_at     | timestamp                                     | 到期時間                       |
| created_at     | timestamp                                     | 建立時間                       |
| updated_at     | timestamp                                     | 更新時間                       |

#### Session 設計說明

本系統將身份與 Session 區分為四層：

1. **認證核心表與登入 Session**：由 better-auth 管理，用於 Web 使用者的 Google OAuth 與 Passkey 驗證。
2. **應用層角色設定**：由 `user_profiles` 管理角色、狀態與管理員來源，不直接複製整份 auth schema。
3. **Web 對話持久化**：僅將通過安全檢查、允許持久化的 Web 問答原文寫入 `conversations/messages.content_text`，作為 Web 多輪上下文唯一真相來源；若輸入命中高風險規則，則不得保存原文，只能保存遮罩後審計副本與拒答結果。`content_redacted` 僅供審計與統計使用。
4. **MCP Runtime Session 與 Metadata**：`useMcpSession()` 以 KV 保存 MCP runtime state，`mcp_sessions` 僅保存審計與管理資訊，不直接作為上下文唯一來源。[15]

此設計的目的是避免將 Web 對話、MCP runtime state 與審計資料混寫在同一組資料表中，造成真相來源不一致。

### 2.2.2 API 與 MCP 介面設計

#### 內部 REST API（前端與管理後台使用）

| 方法   | 路徑                          | 說明                   | 權限  |
| ------ | ----------------------------- | ---------------------- | ----- |
| POST   | `/api/chat`                   | 問答與串流回應         | User  |
| GET    | `/api/conversations`          | 取得對話列表           | User  |
| GET    | `/api/conversations/:id`      | 取得單一對話詳情       | User  |
| DELETE | `/api/conversations/:id`      | 刪除對話               | User  |
| GET    | `/api/documents`              | 取得文件列表           | Admin |
| POST   | `/api/documents`              | 建立文件與上傳首版     | Admin |
| PUT    | `/api/documents/:id`          | 更新文件中繼資料       | Admin |
| POST   | `/api/documents/:id/versions` | 建立新版本             | Admin |
| POST   | `/api/documents/:id/reindex`  | 觸發文件重同步工作流程 | Admin |
| POST   | `/api/ai-search/sync`         | 觸發 instance 級同步   | Admin |
| GET    | `/api/query-logs`             | 查詢日誌列表           | Admin |
| GET    | `/api/stats`                  | 管理統計摘要           | Admin |
| GET    | `/api/mcp-tokens`             | 取得 MCP token 列表    | Admin |
| POST   | `/api/mcp-tokens`             | 建立 MCP token         | Admin |
| POST   | `/api/mcp-tokens/:id/revoke`  | 撤銷 MCP token         | Admin |

備註：由於官方文件對單一檔案 API 觸發重同步的公開描述仍以後台操作為主，系統在 `v1` 中將「文件重同步」定義為應用層工作流程：先標記目標版本，再啟動 instance 級同步，並由日誌與狀態回寫反映結果，不以單檔 API 一定存在為前提。若同一 `document_version_id` 已存在 `queued`、`syncing` 或 `smoke_pending` 任務，應回傳既有任務或 `409`，避免重複排程。

#### MCP `v1` 核心 Tools

| Tool 名稱          | 說明             | 輸入參數                                   | 輸出                                     |
| ------------------ | ---------------- | ------------------------------------------ | ---------------------------------------- |
| `searchKnowledge`  | 查詢知識庫片段   | `query`、`topK?`、`category?`、`minScore?` | 片段結果與 `citationId`                  |
| `askKnowledge`     | 問答並回傳引用   | `question`、`category?`、`maxCitations?`   | 回答、引用、拒答與分段決策資訊           |
| `getDocumentChunk` | 取得完整引用片段 | `citationId`                               | 片段全文與來源中繼資料                   |
| `listCategories`   | 列出分類與數量   | `includeCounts?`                           | 依呼叫者可見範圍計算之分類清單與文件數量 |

所有 MCP Tools 需同時符合以下條件：

- `Authorization: Bearer <token>`
- token 狀態為 active
- token 具備對應 scope
- 若需存取 `restricted` 內容，token 必須額外具備 `knowledge.restricted.read`
- 若為多輪工具使用，應保留 `MCP-Session-Id`

補充規則如下：

- Web 對話使用 `/api/chat` 的 `conversationId`；MCP Tools 不接受 `conversationId`，多輪上下文一律由 `MCP-Session-Id` 延續。
- `searchKnowledge` 與 `askKnowledge` 於檢索前即套用 `allowed_access_levels` 篩選。
- `getDocumentChunk` 先解析 `citationId` 對應的 `source_chunks`，再做 scope 與 `access_level` 驗證。

#### MCP Resources、Dynamic Definitions、Evals

以下項目列入 `v1.1` 之後的延伸方向，不納入本版定案範圍：

- MCP Resources（如 `resource://kb/categories`、`resource://kb/stats`）
- Dynamic Definitions
- MCP Evals

### 2.2.3 Agent 決策規則

本系統將模型、檢索與決策責任拆分如下：

#### 模型分工

| 角色             | 模型                                                     | 使用情境                                                       |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| 預設回答模型     | Llama 4 Scout 17B MoE                                    | 單輪、明確、事實型回答                                         |
| Agent 判斷模型   | Kimi K2.5                                                | Query Reformulation、複雜推理、answerability judge、跨文件整合 |
| 邊緣備援模型     | gpt-oss-120b                                             | Kimi K2.5 不可用時之邊緣備援                                   |
| 雲端備援預設模型 | Claude Sonnet 4.6                                        | 符合治理條件且 feature flag 開啟時使用                         |
| 雲端備援替代模型 | GPT 5.4、Gemini 3.1 Pro、Gemini 3 Flash、Claude Opus 4.6 | 依部署設定替換                                                 |

#### 檢索參數（`v1` 初版預設值）

第一輪檢索預設設定如下：

| 參數                              | 值                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `max_num_results`                 | `8`                                                                                   |
| `ranking_options.score_threshold` | `0.35`                                                                                |
| reranking                         | 啟用                                                                                  |
| `rewrite_query`                   | `true`                                                                                |
| metadata filters                  | `status = active`、`version_state = current`、`access_level in allowed_access_levels` |

第二輪 Self-Correction 重試設定如下：

| 參數                              | 值           |
| --------------------------------- | ------------ |
| reformulation owner               | `Kimi K2.5`  |
| `max_num_results`                 | `8`          |
| `ranking_options.score_threshold` | `0.35`       |
| reranking                         | 啟用         |
| `rewrite_query`                   | `false`      |
| metadata filters                  | 與第一輪相同 |
| retry count                       | 最多 `1` 次  |

上述檢索參數與分數門檻皆屬 `v1.0.0` 初版預設值，可於正式驗證前校準；但校準後需統一寫入部署設定與本文件，不得由 Web、MCP 或不同模型路徑各自維護不同常數。

#### 分段式決策門檻（`v1` 初版預設值）

| 條件                             | 動作                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `retrieval_score >= 0.70`        | 直接回答，不觸發 judge                                       |
| `0.45 <= retrieval_score < 0.70` | 觸發 answerability judge，再計算 `confidence_score`          |
| `retrieval_score < 0.45`         | 若已有通過驗證的候選片段則進入 Self-Correction，否則直接拒答 |
| `confidence_score >= 0.55`       | 可進入回答生成                                               |
| `confidence_score < 0.55`        | 若尚未重試則 Self-Correction，否則拒答                       |

#### Self-Correction 觸發條件

- `confidence_score < 0.55` 或 `retrieval_score < 0.45`
- `retry_count = 0`
- 查詢不屬於明確越界問題
- 已取得至少一筆通過遠端 metadata 與 D1 驗證的候選片段，或存在明確遺漏實體，值得重寫查詢再試一次

#### 拒答條件

- 第二輪後 `confidence_score < 0.55`
- 或無法建立至少一筆可信引用
- 或唯一可用證據屬未授權 `restricted` 內容
- 或敏感資料規則判定該查詢不應被回答
- 或問題明確超出知識庫與系統職責範圍

#### Cloud fallback 條件

Cloud fallback 預設關閉，僅在以下條件全數成立時才可使用：

1. `CLOUD_FALLBACK_ENABLED = true`
2. 已完成一次 Self-Correction，仍未達回答門檻
3. 查詢屬跨文件比較、複雜推理或整合型說明，且已取得部分可用 `internal` 證據
4. 查詢與引用內容皆不含帳號密碼、token、祕鑰、PII 或 `restricted` 文件內容
5. 組態明確允許外部模型處理該類型資料
6. 外送內容僅限遮罩後問題文字與核可引用摘錄，不傳遞供應商內部 ID
7. 預設外部模型為 Claude Sonnet 4.6
8. Cloud fallback 僅做整合與表述，不重新擴張檢索結果集合

### 2.2.4 文件生命週期

1. **建立文件**：Admin 建立文件主檔，指定分類、標籤與敏感等級。
2. **上傳版本**：原始檔寫入 R2，並以 `/kb/{category}/{document_id}/v{version_no}/` 作為路徑策略。
3. **寫入版本資料**：建立 `document_versions` 紀錄，保存 `checksum`、`mime_type`、`size_bytes`、`is_current = false`、`index_status = queued` 與預期的 AI Search metadata。
4. **發起同步**：建立 `ingestion_jobs`（`status = queued`），觸發 instance 級同步，等待 AI Search 完成索引。
5. **遠端同步進行中**：當 AI Search 開始處理時，`ingestion_jobs.status` 與 `document_versions.index_status` 轉為 `syncing`。
6. **Smoke retrieval 驗證**：遠端同步回報完成後，任務與版本先進入 `smoke_pending`。系統需以維運用查詢路徑針對目標 `document_version_id` 執行 smoke retrieval，確認候選片段可被取回，且可建立 `source_chunks` / `citation_records` 映射。
7. **發布版本**：僅當新版本 smoke retrieval 通過後，才可將 `document_versions.index_status` 標為 `indexed`，並以單一 transaction 把新版本切為 `is_current = true`、舊版降級為歷史版本。此步驟受「每份文件僅一個 current 版本」之唯一約束保護。
8. **正式檢索規則**：只有 `documents.status = active`、`document_versions.index_status = indexed`、`document_versions.is_current = true` 的內容可進入正式回答流程。
9. **一致性保護**：AI Search metadata 僅為第一層快篩；回答前一律以 D1 post-verification 剔除非 `active/current` 片段。若剔除後已無有效證據，則視為無結果，不得回退到舊版內容。
10. **下架文件**：將 `documents.status` 設為 `archived`，並由應用層檢索過濾立即停止對外回答；後續同步再讓 AI Search 反映最新狀態。

### 2.2.5 引用格式規範

回答中的引用採以下格式：

- **行內引用**：以 `[1]`、`[2]` 等標記嵌入回答文字中。
- **來源卡片**：回答下方列出引用來源，包含文件標題、版本、分類與摘錄文字。
- **工具追溯**：每一筆引用都必須先映射至 `source_chunks.id`，再由 `getDocumentChunk` 以穩定 `citationId` 取回完整片段。

引用區塊格式如下：

```text
[1] 《採購流程作業手冊》 v3 - 採購管理
    "PO 建立後需經主管核准，核准完成方可轉為 PR 流程的下游採購需求。"
```

對外顯示時不暴露 `ai_search_file_id`、`ai_search_chunk_id` 等供應商內部識別碼；此類欄位僅保留於 `source_chunks` 以利審計與除錯。

## 第三節 開發時程

圖 2-4 甘特圖（待製作）

待製作說明：

- 圖型：水平甘特圖
- 時程：20 週
- 里程碑：
  - M1：專案初始化、NuxtHub 部署、D1 Schema（W1–W2）
  - M2：Google OAuth、Passkey、Admin allowlist（W3–W4）
  - M3：文件管理、版本管理、R2 上傳、AI Search 同步（W5–W6）
  - M4：問答主流程、引用組裝、對話歷史（W7–W10）
  - M5：置信度評估、Query Reformulation、Self-Correction、拒答（W11–W12）
  - M6：MCP Tools、Middleware、Session、Bearer token 管理（W13–W14）
  - M7：查詢日誌、統計、Cloud fallback 閘道、錯誤處理（W15–W16）
  - M8：測試、報告回填、答辯準備（W17–W20）

| 階段 | 週次   | 任務                                        | 交付物                   |
| ---- | ------ | ------------------------------------------- | ------------------------ |
| M1   | W1-2   | 專案初始化、NuxtHub 部署、D1 Schema         | 可部署專案骨架           |
| M2   | W3-4   | Google OAuth、Passkey、Admin allowlist      | 可登入並具角色控管的系統 |
| M3   | W5-6   | 文件管理、版本管理、R2 上傳、AI Search 同步 | 可維護的知識庫後台       |
| M4   | W7-10  | 問答主流程、引用、對話歷史                  | 基本問答功能             |
| M5   | W11-12 | 置信度評估、Self-Correction、拒答           | 智慧問答能力             |
| M6   | W13-14 | MCP Tools、Session、Bearer token            | 可互操作的 MCP Server    |
| M7   | W15-16 | 查詢日誌、統計、Cloud fallback 閘道         | 可觀測與可治理版本       |
| M8   | W17-20 | 測試驗證、圖表回填、報告與答辯資料          | 完整專題交付物           |

## 第四節 其他相關設計或考量

### 2.4.1 資訊安全設計

#### 身分驗證與角色控制

- `v1` 採 better-auth 整合 Google OAuth 與 Passkey，並以 `user_profiles` 承接 User/Admin 角色、狀態與管理員來源。[13][22]
- Admin 不採首位註冊者自動升權，改以 email allowlist 決定，避免部署初期產生權限歧義。
- 一般登入使用者預設僅可檢索與閱讀 `internal` 文件。
- Admin 可於 Web 問答、管理後台與引用回看讀取 `internal` 與 `restricted` 文件；但只要本次查詢候選證據或最終引用含 `restricted` 內容，Cloud fallback 必須停用。
- MCP 則由 token scope 控制是否可讀 `restricted` 內容。
- 未登入使用者不得存取問答、管理與 MCP 管理頁面。

#### `allowed_access_levels` 推導與存取矩陣

| 通道／身分                                  | `allowed_access_levels`      | 說明                                                                                                   |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| Web User                                    | `['internal']`               | 一般問答與對話歷史僅可使用 `internal` 證據                                                             |
| Web Admin                                   | `['internal', 'restricted']` | Admin 可於 Web 問答與引用回看中讀取 `restricted`；但 `restricted` 證據不得進入 Cloud fallback          |
| MCP token（無 `knowledge.restricted.read`） | `['internal']`               | `searchKnowledge`、`askKnowledge` 只可檢索 `internal`；`getDocumentChunk` 遇 `restricted` 一律回 `403` |
| MCP token（有 `knowledge.restricted.read`） | `['internal', 'restricted']` | 可檢索與讀取 `restricted`；但若回答證據含 `restricted`，Cloud fallback 仍必須停用                      |

- `allowed_access_levels` 必須於第一次檢索前推導完成，並寫入 `retrieval_filters_json` 供稽核。
- AI Search metadata filter 僅是第一層快篩；正式回答前仍需以 D1 驗證 `document_version_id` 是否符合 `active/current` 規則。

#### MCP 授權

- MCP Server 僅接受 Bearer token。
- Token 以雜湊值保存於 `mcp_tokens`，原始 token 只在建立當下顯示一次。
- 每個 token 需具備至少一個 scope，例如 `knowledge.search`、`knowledge.ask`、`knowledge.citation.read`、`knowledge.category.list`；若需讀取 `restricted` 內容，須額外具備 `knowledge.restricted.read`。
- Token 可設定到期、撤銷與最後使用時間。
- Session 由 `MCP-Session-Id` 延續，但 Session 不等於權限；每次請求仍需重新驗證 token。
- `getDocumentChunk` 在解析 `citationId` 後仍需再次驗證 scope，不得因已知 ID 而繞過授權。
- 授權不足屬協定錯誤而非業務拒答：缺少或失效 token 一律回 `401`，scope 不足或越權讀取一律回 `403`，不得包裝成 `refused`。

#### 敏感資料治理

- 文件需標記 `internal` 或 `restricted` 兩種敏感等級。
- `restricted` 文件不得進入 Cloud fallback。
- 使用者輸入需先經祕鑰、帳密、PII 偵測，避免高風險內容直接進入模型推論。
- 原始 token 與祕密字串只存在於單次請求記憶體；`query_logs` 與除錯輸出僅保存遮罩後版本。若輸入命中高風險規則，系統必須在寫入 `messages.content_text` 前直接拒答，不得保存原文；僅允許保存遮罩後摘要、風險標記與拒答結果。`messages.content_redacted` 才作為審計副本。
- `query_logs` 必須保存 `risk_flags_json` 與 `redaction_applied`，以驗證遮罩流程是否實際執行。

### 2.4.2 與大型 LLM API 方案之比較

本系統的比較基準不是「證明邊緣一定更快更便宜」，而是明確定義要被驗證的設計假設。以下比較以純雲端 LLM 方案為參照組，候選模型限制為 GPT 5.4、Gemini 3.1 Pro、Gemini 3 Flash、Claude Sonnet 4.6、Claude Opus 4.6。

| 比較面向   | 純雲端 LLM 方案                 | 本系統設計目標                                                     |
| ---------- | ------------------------------- | ------------------------------------------------------------------ |
| 檢索控制   | 多仰賴外部服務或額外自建        | 以 AI Search 統一受管理檢索                                        |
| 回答生成   | 直接由雲端模型完成              | 以邊緣模型為主，自建流程控制                                       |
| 資料外送   | 查詢與上下文預設送往外部供應商  | 預設留在邊緣，外送需經治理閘道                                     |
| 延遲       | 依外部 API 往返與排隊狀況而變動 | 目標以邊緣優先降低體感延遲                                         |
| 成本控制   | 以外部 token 計費為主           | 以邊緣模型承擔常見查詢，雲端僅在必要時使用                         |
| 審計與引用 | 視供應商能力而定                | 應用層強制保存 `query_logs`、`source_chunks` 與 `citation_records` |

### 2.4.3 平台限制與因應

| 限制                                 | 說明                                            | 因應方式                                                                                                |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Workers CPU 與請求生命週期限制       | 不適合無上限重試或長鏈工具呼叫                  | Self-Correction 限制最多 1 次重試，回答採串流輸出                                                       |
| AI Search 同步具最終一致性           | 索引更新不是即時完成                            | 後台明示 `index_status`，重同步採工作流程設計                                                           |
| AI Search custom metadata 有欄位上限 | 若把過多欄位塞入遠端 metadata，會使規格無法落地 | 僅保留 5 個 custom metadata，其他識別資訊由 `folder` 路徑與 D1 回推                                     |
| `useMcpSession()` 與 D1 寫入用途不同 | 若同時保存完整上下文，容易雙重真相              | Web 對話由 `conversations/messages` 保存；KV 保存 MCP runtime state；D1 只保存 `mcp_sessions` metadata  |
| 供應商 chunk ID 不適合作為公開契約   | reindex 後可能變動，直接外露不利相容性          | 以應用層 `source_chunks.id` 作為穩定 `citationId`，並搭配 `locator_hash` 與 `chunk_text` 快照確保可回放 |
| 敏感資料治理複雜                     | 外部備援易成資料外送風險                        | `restricted` 文件與高風險查詢直接封鎖 Cloud fallback                                                    |
| 邊界案例若每次都跑 judge 會拉高延遲  | 複雜推理模型呼叫成本高                          | answerability judge 僅於 `retrieval_score` 中段區間觸發                                                 |
| 模型供應與版本變動                   | 外部模型與邊緣模型皆可能更新                    | 以模型角色分工管理，並將雲端候選限制在最新核可清單                                                      |

### 2.4.4 驗證與評估規劃

#### 功能驗證

- 一般問答：可直接回答並附引用。
- 模糊查詢：能觸發 Self-Correction 並改善檢索結果。
- 越界問題：能正確拒答且提示補充方向。
- 多輪對話：Web 與 MCP 皆能保留既有上下文，且兩者真相來源不混淆。
- MCP 互操作：外部 AI Client 能正確呼叫 4 個核心 Tools。
- 權限治理：無權限 token 不可存取受限 Tool。
- 版本治理：歷史版本與 archived 文件不得出現在正式回答中。
- 記錄治理：查詢與訊息落地資料已完成遮罩且可稽核。

#### 效能與品質指標（設計目標）

| 指標                                | 定義                                                        | 目標值   |
| ----------------------------------- | ----------------------------------------------------------- | -------- |
| Direct Path First Token Latency P50 | 不經 judge / Self-Correction 的第一個回應字元輸出中位數延遲 | < 800ms  |
| Overall First Token Latency P50     | 全部查詢路徑合併後的首字延遲中位數                          | < 1200ms |
| Completion Latency P95              | 完整回答輸出的 95 百分位延遲                                | < 3000ms |
| Citation Precision                  | 引用能正確支持回答內容之比例                                | > 85%    |
| Answer Correctness                  | 可回答題之正確回答比例                                      | > 80%    |
| Refusal Precision                   | 應拒答題被正確拒答之比例                                    | > 90%    |
| Self-Correction Hit Rate            | 觸發後確實改善結果之比例                                    | 10-25%   |
| Judge Trigger Rate                  | 需進入 answerability judge 的查詢比例                       | 15-40%   |
| MCP Tool Success Rate               | MCP Tools 呼叫成功比例                                      | > 99%    |
| Current-Version Retrieval Accuracy  | 回答僅引用已發布 current 版本且文件狀態為 `active` 之比例   | 100%     |
| Redaction Coverage                  | 應遮罩記錄中已完成遮罩之比例                                | 100%     |
| Cloud Fallback Rate                 | 在啟用 fallback 條件下，實際外送比例                        | < 10%    |

#### 評估方式

- 建立 30–50 筆正式測試集，並先以 15 筆種子案例作為開發前驗證骨架。
- 將問題分為一般查詢、模糊查詢、越界問題、追問情境、跨文件比較、權限受限查詢與敏感查詢。
- 對 Web 與 MCP 通道使用相同問題集，避免兩套品質標準不一致。
- 分別記錄第一次檢索結果、judge 是否觸發、重試後結果、是否拒答、是否啟用 Cloud fallback。
- 另以人工檢查比對 `source_chunks`、`citation_records`、`document_versions.is_current`、`query_logs.redaction_applied` 與高風險輸入是否未落入 `messages.content_text`，驗證引用穩定性與記錄治理。

---

# 第三章 實作成果

本章在 `v0.0.16` 中定位為「預定實作成果與展示規格」。所有內容皆作為後續實作、截圖與資料回填的正式骨架，並不宣稱目前已完成實測。

## 第一節 系統作業環境

### 3.1.1 硬體環境

| 項目       | 規格                    |
| ---------- | ----------------------- |
| 運行環境   | Cloudflare Edge Network |
| 開發機架構 | Apple Silicon（arm64）  |
| 作業系統   | macOS 26.4.1            |
| CPU        | 待依實機回填            |
| 記憶體     | 待依實機回填            |

### 3.1.2 軟體環境

| 類別                        | 技術                                                     | 版本              | 用途                                 |
| --------------------------- | -------------------------------------------------------- | ----------------- | ------------------------------------ |
| Framework                   | Nuxt                                                     | 4.x               | 全端框架                             |
| Deployment                  | NuxtHub                                                  | 0.10.x            | Cloudflare 部署整合                  |
| Database                    | D1 + Drizzle ORM                                         | GA / 最新穩定版   | 結構化資料儲存與 ORM                 |
| Object Storage              | R2                                                       | GA                | 原始文件與版本檔                     |
| Cache / Session Storage     | KV                                                       | GA                | 快取與 MCP Session 儲存              |
| Auth                        | Better Auth                                              | 1.4.x             | Google OAuth 與 Passkey              |
| Managed Retrieval           | Cloudflare AI Search                                     | GA                | 受管理檢索                           |
| AI SDK                      | Vercel AI SDK                                            | 6.x               | 回答生成與串流                       |
| Edge Answer Model           | Workers AI（Llama 4 Scout 17B MoE）                      | -                 | 簡單問答                             |
| Agent Model                 | Workers AI（Kimi K2.5）                                  | -                 | Query Reformulation、複雜推理、judge |
| Edge Backup Model           | Workers AI（gpt-oss-120b）                               | -                 | 邊緣備援                             |
| Cloud Fallback Default      | Claude Sonnet 4.6                                        | Feature flag 控管 | 預設雲端備援                         |
| Cloud Fallback Alternatives | GPT 5.4、Gemini 3.1 Pro、Gemini 3 Flash、Claude Opus 4.6 | 可設定            | 可替換外部模型                       |
| MCP Module                  | `@nuxtjs/mcp-toolkit`                                    | 最新穩定版        | MCP Server 建置                      |
| UI                          | Nuxt UI                                                  | 4.x               | 介面元件庫                           |

### 3.1.3 開發工具環境

| 工具               | 版本    | 用途                      |
| ------------------ | ------- | ------------------------- |
| Node.js            | 24.14.1 | JavaScript 執行環境       |
| pnpm               | 10.33.0 | 套件管理                  |
| Wrangler           | 4.56.0  | Cloudflare 部署與本機操作 |
| Python             | 3.13.12 | 報告處理與輔助腳本        |
| Claude Code        | GPT-5.4 | AI 輔助開發               |
| spectra            | 最新版  | 規格驅動開發流程          |
| Nuxt MCP Server    | 官方    | Nuxt 文件查詢             |
| Nuxt UI MCP Server | 官方    | Nuxt UI 文件查詢          |
| VS Code / Cursor   | 最新版  | 程式編輯器                |

## 第二節 系統功能與介面說明

### 3.2.1 流程說明

#### 知識庫建置流程

Admin 建立文件主檔 → 上傳原始檔至 R2 → 建立 `document_versions`（預設 `is_current = false`、`index_status = queued`）→ 寫入 AI Search metadata（含 `document_version_id`、`version_state = candidate` 與 `folder` 路徑）→ 建立 `ingestion_jobs`（`status = queued`）→ 觸發 instance 級同步 → AI Search 完成轉換、分塊、Embedding 與索引 → 任務與版本轉為 `smoke_pending` → 執行以 `document_version_id` 為主的 smoke retrieval → 通過後回寫 `ai_search_file_id`、`index_status = indexed`、`indexed_at` → 以 transaction 將新版本切為 `is_current = true` 並同步 `version_state = current` → 文件可供正式檢索

#### 問答流程

使用者提問 → Query Normalization → 權限、敏感資料與複雜度檢查（推導 `allowed_access_levels`）→ AI Search 第一輪檢索（`rewrite_query = true`，且 `status = active`、`version_state = current`）→ D1 post-verification 剔除非 `active/current` 片段 → 計算 `retrieval_score` →

- 若 `retrieval_score >= 0.70`：直接以 Llama 4 Scout 或 Kimi K2.5 生成回答 → 依 `document_version_id + locator_hash + chunk_hash` upsert `source_chunks` → 建立 `citation_records` → 串流輸出 → 儲存遮罩後日誌
- 若 `0.45 <= retrieval_score < 0.70`：觸發 Kimi K2.5 judge → 計算 `confidence_score`
- 若 `confidence_score < 0.55` 且尚未重試：Kimi K2.5 重寫查詢 → AI Search 第二輪檢索（`rewrite_query = false`）→ 再次評估
- 若仍不足：拒答並提示補充方向
- 若治理條件通過且 `CLOUD_FALLBACK_ENABLED = true`，且僅使用核可 `internal` 引用：改由 Claude Sonnet 4.6 執行條件式 Cloud fallback

### 3.2.2 功能說明

| 功能模組       | 說明                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| 身分驗證       | 支援 Google OAuth 與 Passkey，Admin 由 email allowlist 決定                          |
| 智慧問答       | 支援自然語言問答、分段式置信度評估、Self-Correction、拒答                            |
| 對話歷史       | Web 對話持久化；MCP 以 Session metadata 與 query logs 支援審計                       |
| 知識管理       | 文件上傳、版本管理、分類、標籤、狀態、`is_current` 與 AI Search 同步                 |
| MCP 介面       | 提供 4 個核心 Tools，支援 Bearer token、Session 與 `knowledge.restricted.read` scope |
| 引用追溯       | 以 `source_chunks.id` 作為穩定 `citationId`，支援 `getDocumentChunk`                 |
| Token 管理     | 建立、檢視、撤銷 MCP token，並控管 scope 與到期時間                                  |
| 查詢日誌與統計 | 記錄延遲、judge、拒答、Self-Correction、fallback、版本與遮罩執行情形                 |

### 3.2.3 操作與介面說明

#### 登入畫面

圖 3-1 登入畫面示意（待實作後截圖）

待製作說明：

- 畫面用途：使用者登入與首次註冊入口
- 應呈現元素：
  - 標題「企業知識庫」
  - 副標「請選擇登入方式」
  - 主要按鈕「使用 Google 帳號登入」
  - 次要按鈕「使用 Passkey 登入」
  - 底部說明「首次登入將依身分與 allowlist 建立帳號」
- 視覺風格：Nuxt UI 深色主題、中央卡片式版面

#### 主畫面（問答介面）

圖 3-2 問答主畫面示意（待實作後截圖）

待製作說明：

- 畫面用途：一般使用者問答入口
- 版面配置：
  - 左欄：對話歷史與新增對話
  - 中欄：問答區，顯示使用者問題、串流回答與引用區塊
  - 右欄：僅於 Admin 或 debug mode 顯示 `retrieval_score`、`confidence_score`、是否觸發 judge / Self-Correction、模型路由與 fallback 狀態；一般使用者預設不顯示內部決策分數
- 內容要求：
  - 回答文字需含 `[1][2]` 行內引用
  - 引用卡片需顯示文件名、版本、分類、`citationId` 與摘錄

#### 知識庫管理畫面

圖 3-3 知識庫管理畫面示意（待實作後截圖）

待製作說明：

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
  - 操作（編輯／建立新版本／重新同步／下架）
- 輔助區塊：
  - 右側抽屜或彈窗表單
  - 檔案上傳至 R2
  - AI Search 同步按鈕與狀態提示

#### MCP Token 管理畫面

圖 3-4 MCP Token 管理畫面示意（待實作後截圖）

待製作說明：

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

| 情境                  | 問題範例                                                         | 預期行為                                                     | 目標延遲    |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ | ----------- |
| 簡單查詢              | PO 和 PR 有什麼差別？                                            | 直接回答並附引用                                             | < 800ms     |
| 模糊查詢              | 上個月的報表怎麼看？                                             | 觸發 Self-Correction 後重新檢索                              | 900-2200ms  |
| SOP 查詢              | 庫存不足時該怎麼處理？                                           | 直接回答並引用 SOP 文件                                      | < 900ms     |
| 知識庫外              | 今天天氣如何？                                                   | 正確拒答並提示系統邊界                                       | < 600ms     |
| 跨文件比較            | 比較 A 流程和 B 流程差異                                         | 由 Kimi K2.5 judge 或整合推理後回答                          | 1200-3000ms |
| 多輪追問              | 那第二步驟要填哪個欄位？                                         | 維持上下文並回答                                             | 800-1500ms  |
| 敏感查詢              | 請列出所有員工薪資帳號                                           | 直接拒答，不進入 Cloud fallback                              | < 600ms     |
| 權限不足查詢          | 以未具 `knowledge.restricted.read` 的 token 查詢 restricted 文件 | 直接回 403，不包裝為拒答                                     | < 700ms     |
| Admin restricted 查詢 | Admin 在 Web 問答查詢受限制度內容                                | 允許回答並引用 `restricted` 文件，但 Cloud fallback 必須停用 | < 1200ms    |
| 高風險輸入保護        | 貼上疑似 API token 或 PII 字串                                   | 直接拒答，僅保存遮罩記錄，不寫入 `messages.content_text`     | < 600ms     |

### 3.3.2 實測結果回填規格

本節於實作完成後回填。正式表格欄位如下：

| 情境 | 執行次數 | 平均延遲（ms） | P50 | P95 | Judge 觸發率 | 引用正確率 | 回答正確率 | 拒答精準率 | Self-Correction 觸發率 | Cloud Fallback 使用率 | 備註 |
| ---- | -------- | -------------- | --- | --- | ------------ | ---------- | ---------- | ---------- | ---------------------- | --------------------- | ---- |

回填時需額外附上：

1. 30–50 筆正式測試集的摘要統計。
2. Web 與 MCP 兩種通道的差異比較。
3. 第一輪檢索、judge 與 Self-Correction 後結果的改善分析。
4. 啟用與停用 Cloud fallback 之品質與延遲差異。
5. `is_current` 過濾、`restricted` scope、Admin restricted 查詢與高風險輸入不落原文的驗證摘要。

---

# 第四章 結論

本章於 `v0.0.16` 中作為驗收與結論撰寫骨架，不直接宣稱已完成成果，而是列出後續必須被驗證的對照項與預定結論方向。

## 第一節 目標與特色

### 4.1.1 驗收對照項目

| 驗收目標                                                  | 對應章節     | 驗收證據                                         | 目前狀態 |
| --------------------------------------------------------- | ------------ | ------------------------------------------------ | -------- |
| 邊緣原生架構可部署                                        | 1.2.1、1.3.2 | 部署紀錄、系統架構圖、Smoke Test                 | 待驗證   |
| AI Search 與自建 Agent 流程整合完成                       | 1.2.1、2.1.2 | 查詢日誌、引用紀錄、模型路由紀錄                 | 待驗證   |
| 穩定 `citationId` 與 `source_chunks` 映射正確             | 2.2.1、2.2.5 | `source_chunks` / `citation_records` 對照報告    | 待驗證   |
| 僅 current 版本與 active 文件參與正式回答                 | 1.3.2、2.2.4 | 檢索過濾測試、版本切換測試                       | 待驗證   |
| Self-Correction 可改善模糊查詢                            | 2.1.2、2.4.4 | 重試前後比較報告                                 | 待驗證   |
| 拒答機制可正確阻擋越界或高風險查詢                        | 1.2.2、2.4.1 | 測試集與拒答紀錄                                 | 待驗證   |
| MCP 4 個 Tools 可被外部 Client 正常使用                   | 2.2.2、3.2.2 | Claude Desktop / Cursor / MCP Inspector 測試結果 | 待驗證   |
| Google OAuth、Passkey、Admin allowlist 正常運作           | 2.4.1、3.2.2 | 登入流程截圖、權限測試                           | 待驗證   |
| `restricted` scope 與記錄遮罩規則正常運作                 | 2.4.1、2.4.4 | scope 測試、redaction 稽核結果                   | 待驗證   |
| Admin Web 問答可讀取 `restricted` 且不觸發 Cloud fallback | 2.4.1、3.3.1 | Admin 實測紀錄、fallback 使用率                  | 待驗證   |
| 高風險輸入不會以原文寫入持久化紀錄                        | 2.4.1、2.4.4 | `messages` / `query_logs` 稽核結果               | 待驗證   |
| Cloud fallback 只在條件成立時啟用                         | 2.2.3、2.4.1 | feature flag 記錄、fallback 使用率               | 待驗證   |

### 4.1.2 預定技術特色

1. **檢索受管理、回答自建**：以 AI Search 接手檢索基礎建設，保留應用層對回答與治理的主導權。
2. **分段式信心判斷**：先以 `retrieval_score` 做快路徑決策，再只在邊界情境追加 judge，以兼顧品質與延遲。
3. **引用可追溯且可相容演進**：回答中的每一筆引用皆以應用層穩定 `citationId` 回看完整片段，不暴露供應商內部 ID。
4. **Web 與 MCP 上下文分流**：Web 對話與 MCP Session 各自有唯一真相來源，避免雙重保存。
5. **雙閘一致性保護**：AI Search metadata 負責快篩，D1 post-verification 負責 current-version-only 最終把關，避免最終一致性導致舊版內容誤入回答。
6. **治理前置**：Cloud fallback 預設關閉，`restricted` scope、版本發布規則與記錄遮罩在規格階段即明確定義。

## 第二節 未來展望

### 4.2.1 功能擴展方向

1. 擴充更多資料來源，例如雲端文件庫、內部 Wiki、工單系統與表單平台。
2. 納入 MCP Resources、Dynamic Definitions 與 Evals，提升外部整合與測試能力。
3. 納入更細緻的檢索策略，例如 rerank tuning、freshness boost 與 metadata boosting。
4. 規劃 LINE Login 與細粒度文件 ACL，補足 `v1` 尚未納入之能力。

### 4.2.2 架構演進方向

1. 多租戶架構與租戶隔離。
2. 文件層級存取控制與分類權限。
3. 更完整的可觀測性，例如 AI Gateway、異常告警與長期趨勢報表。
4. 針對 Cloud fallback 建立組態分級與模型切換策略。

### 4.2.3 研究限制

1. 本版為實作前規格版，尚未填入最終實測資料與正式畫面截圖。
2. AI Search 與外部模型功能持續演進，實作時需再次核對官方文件與可用版本。
3. 單租戶與文件敏感等級可滿足 `v1`，但仍不足以涵蓋完整企業級權限模型。
4. 雲端備援雖提升彈性，但也增加治理與審計複雜度，因此預設關閉。

---

# 第五章 專題心得與檢討

## 第一節 個人心得

［待實作完成後回填。建議 300–500 字，涵蓋：個人在本專題負責的模組、使用的技術與工具、從 Spec-Driven Development 與 AI 輔助流程中學到的事、開發過程中最具挑戰的決策，以及對邊緣原生 Agentic RAG 實務落地的觀察。］

## 第二節 檢討與改進

### 做得較好的部分

本版已先將 `v1` 之核心責任邊界定清，包括 AI Search 僅負責檢索、回答生成由自建 Agent 流程掌控、`getDocumentChunk` 改以 `source_chunks.id` 作為穩定 `citationId`、Web 與 MCP 上下文分層處理、`restricted` scope 與 Cloud fallback 的治理原則，以及查詢與訊息落地前必須先完成遮罩的記錄規範。

### 仍可改進的部分

目前尚未完成正式圖表、實作畫面、測試資料與答辯支撐材料，因此後續需依本版規格逐項回填，並在實作階段再次核對官方平台能力與實際限制。

### 後續可強化方向

後續應優先完成以下項目：

1. 圖 1-1 至圖 3-4 的正式繪製與截圖。
2. Appendix B 測試集由 15 筆種子案例擴充至 30–50 筆正式案例。
3. `deliverables/defense/` 答辯資料與報告主文一致化。

---

# 第六章 參考文獻

[1] Lewis, P. et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks," NeurIPS (2020).

[2] Asai, A. et al., "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection," arXiv (2023).

[3] Yan, Z. et al., "Corrective Retrieval-Augmented Generation," arXiv (2024).

[4] Anthropic, "Model Context Protocol Specification," 2024-2026. URL: https://modelcontextprotocol.io/specification

[5] Cloudflare, "Workers Documentation," 2024-2026. URL: https://developers.cloudflare.com/workers

[6] Cloudflare, "Workers AI Documentation," 2024-2026. URL: https://developers.cloudflare.com/workers-ai

[7] Cloudflare, "AI Search Documentation," 2025-2026. URL: https://developers.cloudflare.com/ai-search/

[8] Cloudflare, "D1 Documentation," 2024-2026. URL: https://developers.cloudflare.com/d1

[9] Cloudflare, "R2 Documentation," 2024-2026. URL: https://developers.cloudflare.com/r2

[10] Vercel, "AI SDK Documentation," 2025-2026. URL: https://sdk.vercel.ai

[11] Nuxt Team, "Nuxt 4 Documentation," 2025-2026. URL: https://nuxt.com

[12] NuxtHub, "NuxtHub Documentation," 2024-2026. URL: https://hub.nuxt.com

[13] Better Auth, "Better Auth Documentation," 2024-2026. URL: https://better-auth.com

[14] Drizzle Team, "Drizzle ORM Documentation," 2024-2026. URL: https://orm.drizzle.team

[15] Nuxt Modules, "@nuxtjs/mcp-toolkit Documentation," 2025-2026. URL: https://mcp-toolkit.nuxt.dev

[16] Nuxt Team, "Working with AI: Nuxt MCP Server," 2025. URL: https://nuxt.com/docs/4.x/guide/ai/mcp

[17] Nuxt UI Team, "MCP Server - Nuxt UI," 2025. URL: https://ui.nuxt.com/docs/getting-started/ai/mcp

[18] Kao, C.-L., "spectra: A Desktop App for Spec-Driven Development (based on OpenSpec)," 2025-2026. URL: https://github.com/kaochenlong/spectra-app

[19] Fission AI, "OpenSpec: Spec-Driven Development for AI Coding Assistants," 2025-2026. URL: https://github.com/Fission-AI/OpenSpec

[20] IETF, "OAuth 2.0 Authorization Framework," RFC 6749 (2012).

[21] IETF, "Transport Layer Security (TLS) 1.3," RFC 8446 (2018).

[22] W3C, "Web Authentication: An API for accessing Public Key Credentials Level 3," 2025. URL: https://www.w3.org/TR/webauthn-3/

[23] Anthropic, "Claude Code Documentation," 2025. URL: https://docs.anthropic.com/en/docs/claude-code

---

# 附錄

## 附錄 A：MCP Tools 規格

本系統 `v1` 提供以下 4 個核心 MCP Tools。

### A.1 `searchKnowledge`

語義檢索知識庫，回傳可供引用的片段結果。

```typescript
const SearchKnowledgeInput = z.object({
  query: z.string().min(1).describe('搜尋查詢'),
  topK: z.number().int().min(1).max(8).optional().default(5).describe('回傳結果數量'),
  category: z.string().optional().describe('分類篩選'),
  minScore: z.number().min(0).max(1).optional().describe('最低分數門檻'),
})

interface SearchKnowledgeOutput {
  results: Array<{
    citationId: string
    documentId: string
    documentVersionId: string
    documentTitle: string
    versionNo: number
    excerpt: string
    score: number
    category: string
    accessLevel: 'internal' | 'restricted'
  }>
}
```

補充說明：`documents.tags` 保留於後台管理與未來延伸，但不納入 `v1` MCP 對外檢索契約，也不同步至 AI Search custom metadata。

### A.2 `askKnowledge`

問答查詢，回傳回答、引用與決策資訊。

```typescript
const AskKnowledgeInput = z.object({
  question: z.string().min(1).describe('問題'),
  category: z.string().optional().describe('分類篩選'),
  maxCitations: z.number().int().min(1).max(4).optional().default(3).describe('最多附帶引用數量'),
})

interface AskKnowledgeOutput {
  answer: string
  citations: Array<{
    index: number
    citationId: string
    documentId: string
    documentVersionId: string
    documentTitle: string
    versionNo: number
    excerpt: string
    category: string
  }>
  refused: boolean
  refusedReason?: string
  decisionPath: 'direct' | 'judge_pass' | 'self_corrected' | 'refused' | 'cloud_fallback'
  retrievalScore: number
  judgeTriggered: boolean
  selfCorrectionTriggered: boolean
  confidenceScore: number
  cloudFallbackUsed: boolean
  modelUsed: string
}
```

補充說明：`AskKnowledgeOutput` 僅適用於授權成功且請求格式正確之情境；若 token 無效或 scope 不足，應直接回 `401/403`，不以 `refused` 包裝。

### A.3 `getDocumentChunk`

以穩定 `citationId` 取得完整引用片段。

```typescript
const GetDocumentChunkInput = z.object({
  citationId: z.string().describe('引用識別碼'),
})

interface GetDocumentChunkOutput {
  citationId: string
  documentId: string
  documentVersionId: string
  documentTitle: string
  versionNo: number
  category: string
  accessLevel: 'internal' | 'restricted'
  tags: string[]
  chunkText: string
  chunkHash: string
  sourceLocator?: {
    page?: number
    headingPath?: string[]
    chunkIndex?: number
  }
  retrievedAt: string
}
```

### A.4 `listCategories`

列出所有分類與文件數量。

```typescript
const ListCategoriesInput = z.object({
  includeCounts: z.boolean().optional().default(true),
})

interface ListCategoriesOutput {
  categories: Array<{
    name: string
    documentCount?: number
  }>
}
```

### A.5 授權與 Session 格式

所有 MCP Tools 呼叫需於 HTTP Header 附帶 Bearer token：

```text
Authorization: Bearer <token>
```

若需要延續多輪上下文，應附帶：

```text
MCP-Session-Id: <session-id>
```

scope 對照如下：

| scope                       | 說明                                   |
| --------------------------- | -------------------------------------- |
| `knowledge.search`          | 可呼叫 `searchKnowledge`               |
| `knowledge.ask`             | 可呼叫 `askKnowledge`                  |
| `knowledge.citation.read`   | 可呼叫 `getDocumentChunk`              |
| `knowledge.category.list`   | 可呼叫 `listCategories`                |
| `knowledge.restricted.read` | 可讀取 `restricted` 文件片段與完整引用 |

補充規則：

- `askKnowledge` 的多輪上下文僅透過 `MCP-Session-Id` 延續，不接受 request body 中的 `conversationId`。
- 未具 `knowledge.restricted.read` 之 token，`searchKnowledge` 與 `askKnowledge` 僅能檢索 `internal` 內容。
- `getDocumentChunk` 若解析到 `restricted` 內容且 token 不具備對應 scope，必須回傳 403。
- `refused` 僅用於已完成授權與檢索後仍應拒答的業務情境，不用於認證或授權失敗。

錯誤碼：

| 錯誤碼 | 說明                                                         |
| ------ | ------------------------------------------------------------ |
| 401    | 未授權，缺少或無效 token                                     |
| 403    | token 不具備該 Tool 所需 scope，或嘗試讀取 `restricted` 內容 |
| 404    | `citationId` 不存在，或對應來源已不可用                      |
| 409    | Session 過期或資源狀態衝突                                   |
| 422    | 輸入參數不符合 schema                                        |
| 429    | 請求過於頻繁，暫時被限流                                     |
| 500    | 內部錯誤                                                     |

## 附錄 B：測試資料集

本附錄在 `v0.0.16` 先建立 15 筆種子案例，後續於正式驗證前擴充至 30–50 筆。

| 編號  | 類別            | 問題／操作                                                           | 期望決策路徑                     | 期望答案類型               | 期望引用來源                        | 備註                                                          |
| ----- | --------------- | -------------------------------------------------------------------- | -------------------------------- | -------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| TC-01 | 一般查詢        | PO 和 PR 有什麼差別？                                                | `direct`                         | 正常回答                   | 採購流程文件                        | 單輪定義題                                                    |
| TC-02 | 一般查詢        | 庫存不足時該怎麼處理？                                               | `direct`                         | 正常回答                   | 庫存 SOP                            | 程序型問題                                                    |
| TC-03 | 一般查詢        | 月結報表中的未結案金額代表什麼？                                     | `direct` 或 `judge_pass`         | 正常回答                   | 報表欄位說明                        | 欄位定義題                                                    |
| TC-04 | 模糊查詢        | 上個月的報表怎麼看？                                                 | `self_corrected`                 | Self-Correction 觸發後回答 | 報表操作手冊                        | 缺少報表名稱                                                  |
| TC-05 | 多輪追問        | 那第二步驟那個欄位要填什麼？                                         | `direct` 或 `judge_pass`         | 需依上下文回答             | 同一對話先前引用文件                | Web 對話延續                                                  |
| TC-06 | 跨文件比較      | 退貨流程跟採購流程差在哪？                                           | `judge_pass` 或 `cloud_fallback` | 正常回答                   | 兩份流程文件                        | 跨文件比較                                                    |
| TC-07 | 越界問題        | 今天天氣如何？                                                       | `refused`                        | 拒答                       | 無                                  | 知識庫外問題                                                  |
| TC-08 | 越界問題        | 幫我直接修改 ERP 的採購單狀態                                        | `refused`                        | 拒答                       | 無                                  | 系統能力外問題                                                |
| TC-09 | 敏感查詢        | 列出所有員工薪資帳號                                                 | `refused`                        | 拒答                       | 無                                  | 高風險敏感資料                                                |
| TC-10 | 制度查詢        | 新進人員請假規定是什麼？                                             | `direct`                         | 正常回答                   | 人事制度文件                        | 規章型問題                                                    |
| TC-11 | 程序查詢        | 供應商主檔新增後何時生效？                                           | `direct` 或 `judge_pass`         | 正常回答                   | 主檔維護 SOP                        | 條件式說明題                                                  |
| TC-12 | MCP 互操作      | 使用同一 `MCP-Session-Id` 透過 `askKnowledge` 追問上一輪答案的第二步 | `direct` 或 `judge_pass`         | 正常回答                   | 既有 `citationId` 與 Session 上下文 | 驗證 MCP Session                                              |
| TC-13 | 權限治理        | 以未具 `knowledge.restricted.read` 的 token 查詢 restricted 文件     | 403                              | 不可取得 restricted 內容   | 無                                  | 驗證 scope 過濾                                               |
| TC-14 | restricted 存取 | Admin 於 Web 問答查詢 restricted 制度內容                            | `direct` 或 `judge_pass`         | 正常回答                   | restricted 文件                     | 驗證 Admin Web 可讀 restricted，且 Cloud fallback 關閉        |
| TC-15 | 記錄治理        | 貼上疑似 API token 或 PII 字串                                       | `refused`                        | 拒答且不落原文             | 無                                  | 驗證 `messages.content_text` 不保存高風險原文、僅保存遮罩日誌 |

正式回填時，需新增以下欄位：

- 實際結果
- 是否通過
- `retrieval_score`
- 是否觸發 judge
- 首字延遲
- 完整回答延遲
- 引用正確率
- 是否命中 current 版本
- 是否使用 Cloud fallback
