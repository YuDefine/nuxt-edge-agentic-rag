![image1](main-v0.0.26_assets/image1.jpeg)

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

本專題以中小企業知識庫問答為情境，規劃一套基於邊緣原生架構之代理式檢索增強生成系統，作為 ERP 操作指引、制度文件、報表說明與內部 SOP 的統一查詢入口。相較傳統單次靜態檢索流程，本系統採 Hybrid Managed RAG：檢索底層交由 Cloudflare AI Search 處理，回答生成、拒答、引用組裝與審計治理則保留在應用層 Agentic Orchestration，以兼顧可落地性與控制力。[1][2][3][4][7]

在系統設計上，前端以 Nuxt 4 提供 Web 問答與管理後台，後端透過 NuxtHub 部署於 Cloudflare Workers，整合 D1、R2、KV、Workers AI 與 Vercel AI SDK。[10][11][12] `v1.0.0` 核心版先鎖定可部署、可驗證、可答辯的最小閉環：Google OAuth、部署環境變數 `ADMIN_EMAIL_ALLOWLIST`、文件上傳與版本管理、AI Search 同步、Web 問答與引用回放、4 個無狀態 MCP Tools，以及 `knowledge.restricted.read` scope；Passkey、MCP Session、管理統計儀表板與 Cloud fallback 延後至 `v1.1`。為避免版本真相混亂，正式回答一律以 D1 驗證 `active/indexed/current` 狀態，並以發布前由正規化文字快照預先切出的 `source_chunks` 作為 `citationId` 回放來源。[6][7][15]

在問答決策上，`v1.0.0` 採固定責任分工：Query Normalization 僅做規則式標準化；AI Search 第一輪檢索可使用 `rewrite_query`；僅在邊界區間才由部署當下可用之較強推理模型執行 answerability judge 與 Query Reformulation；單文件明確回答預設由邊緣回答模型生成，跨文件整合則交由較強整合模型處理。實際模型名稱於 Preview 驗證通過後才鎖定至部署設定與報告，以避免平台更新造成論文與實作脫鉤。[6][27] 驗證面將以分層資料集檢驗回答正確率、拒答精準率、引用正確率、MCP Tool 成功率、current-version-only 檢索正確性與遮罩完整性，作為後續實作、截圖回填與正式報告收斂基準。[18][19] 本摘要描述的是實作前定稿之系統主線、核心閉環與驗證方法；正式模型名稱、套件小版本、畫面截圖與統計數據，須待核心版完成後再依實證結果回填。

關鍵字：代理式檢索增強生成（Agentic RAG）、邊緣原生架構（Edge-Native）、Cloudflare AI Search、Self-Correction、Model Context Protocol（MCP）、規格驅動開發（SDD）

---

# 目錄

［待依正式頁碼產生目錄。］

---

# 符號索引

| 縮寫/符號       | 全稱                                   | 說明                                                                                         |
| --------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| RAG             | Retrieval-Augmented Generation         | 檢索增強生成，結合外部知識檢索與 LLM 回應生成。                                              |
| Agentic RAG     | Agentic Retrieval-Augmented Generation | 由代理流程主動控制檢索、評估、重試與拒答之 RAG。                                             |
| LLM             | Large Language Model                   | 大型語言模型。                                                                               |
| MCP             | Model Context Protocol                 | 標準化 AI Client 與外部工具互動的協定。                                                      |
| SSE             | Server-Sent Events                     | 用於串流回應，並可作為 `v1.1` MCP Session 延伸的連線傳輸方式。                               |
| RBAC            | Role-Based Access Control              | 以角色為基礎的存取控制模型。                                                                 |
| PII             | Personally Identifiable Information    | 可識別個人身分之敏感資料。                                                                   |
| AI Search       | Cloudflare AI Search                   | Cloudflare 受管理搜尋服務，原 AutoRAG。                                                      |
| D1              | Cloudflare D1                          | Cloudflare 的 SQLite 相容資料庫服務。                                                        |
| R2              | Cloudflare R2                          | Cloudflare 物件儲存服務。                                                                    |
| KV              | Cloudflare KV                          | Cloudflare 鍵值型儲存服務，適合快取，並可作為 `v1.1` MCP Session 延伸的 runtime state 儲存。 |
| Passkey         | Passkey / WebAuthn Credential          | 無密碼登入機制，以公開金鑰憑證完成驗證。                                                     |
| Self-Correction | Self-Correction Loop                   | 首次檢索不足時，由 Agent 重寫查詢並重試一次的流程。                                          |

---

# 圖表目錄

［目前先保留圖表需求索引。正式繪圖與截圖回填時，需同步更新圖號、圖表目錄、第三章圖說與第四章驗收證據，不得只補圖片不補文字。］

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
- 建立以 Cloudflare AI Search 為檢索底層、以 Vercel AI SDK 與 Workers AI 為決策與生成層的 Hybrid Managed RAG 架構。
- 實作包含 Query Normalization、Self-Correction、拒答與引用追溯的完整問答流程。
- 以 `@nuxtjs/mcp-toolkit` 建立 MCP Server，對外提供可受權限控管之標準化知識工具。[4][15][16][17]

### 1.2.2 安全設計面

- 以 better-auth 整合 Google OAuth，建立單租戶、雙角色的登入與存取控制機制；Passkey 改列 `v1.1` 延伸。[13][20]
- `v1.0.0` 以部署環境變數 `ADMIN_EMAIL_ALLOWLIST` 作為管理員名單真相來源；管理員權限判定一律以當前 Session 內之正規化 email 對 allowlist 重新計算，D1 僅同步角色快照與 `admin_source = allowlist` 供 UI 與稽核使用，不另建 allowlist 資料表。
- 以 Bearer token、scope、到期時間與撤銷機制保護 MCP 對外存取，且所有請求皆需經 HTTPS/TLS 1.3 傳輸。[21]
- 將敏感資料過濾、記錄遮罩與外部模型治理邊界納入正式規格，而非實作後補強。

### 1.2.3 驗證與營運面

- 建立可追溯的查詢日誌、引用紀錄、MCP 呼叫紀錄與設定快照版本，作為後續驗證依據；管理統計儀表板改列 `v1.1` 延伸。
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

`v1.0.0` 與 `v1.1` 的分階段範圍如下：

| 分類     | `v1.0.0` 核心版                                                                                                                                       | `v1.1` 延伸                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 身分驗證 | Google OAuth、User/Admin 角色、部署環境變數 `ADMIN_EMAIL_ALLOWLIST`                                                                                   | Passkey                             |
| 知識管理 | 一次性 signed URL 上傳至 R2、版本管理、AI Search 同步、文件狀態管理、`is_current` 發布規則；核心驗收資料集優先採 `md`、`txt` 或預先轉 Markdown 之文件 | 後台統計摘要與進階營運檢視          |
| 問答流程 | 規則式 Query Normalization、AI Search 檢索、分段式置信度評估、Self-Correction、拒答、引用顯示、Web 對話歷史                                           | 條件式 Cloud fallback、備援模型切換 |
| MCP 介面 | `searchKnowledge`、`askKnowledge`、`getDocumentChunk`、`listCategories`、Bearer token、`knowledge.restricted.read` scope、無狀態呼叫                  | `MCP-Session-Id` 多輪上下文         |
| 可觀測性 | 查詢日誌、`source_chunks` / `citation_records`、MCP 呼叫成功率、決策路徑與延遲統計、遮罩審計資訊、設定快照版本                                        | 管理統計儀表板與延遲趨勢圖          |

為降低實作前期風險，本專題採兩階段版本策略：

- `v1.0.0`：先完成可部署、可驗證、可答辯的核心版。
- `v1.1`：在核心版穩定後，再擴充 Passkey、MCP Session、多輪追問（MCP）與條件式 Cloud fallback。

若時程或平台能力與規格衝突，應優先確保 `v1.0.0` 可部署、可驗證、可答辯，再擴充 `v1.1`。

建置順序以 Web 問答主線優先，MCP Tools 應共用同一套檢索、引用與治理核心，不得為了趕進度而形成兩套邏輯。

因此，本報告在實作前的主要任務，不是把所有可能延伸能力都寫成既定成果，而是先確認哪些規則屬於答辯與落地都不可退讓的核心契約，哪些細節則應保留到 Preview 驗證與實作收斂後再鎖定。

以下項目不納入 `v1.0.0`；其中前四項列為 `v1.1` 延伸：

- Passkey。
- `MCP-Session-Id` 與 MCP 多輪上下文。
- 管理統計儀表板。
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
  5. 以虛線標示 `v1.1` 延伸：Passkey、MCP Session 與條件式 Cloud fallback
- 視覺風格：扁平化、方框與圓角、繁體中文、章節內圖號預留為「圖 1-1」

### 1.3.2 專題架構

本系統採四層式邊緣原生架構，分為前端層、資料與受管理檢索層、Agentic AI 層與 MCP 層。整體原則為「檢索受管理、回答自建、治理先行、核心優先」。

圖 1-2 系統架構圖（待製作）

圖面規劃重點：

- 圖型：四層水平分層圖
- 圖名：Hybrid Managed RAG 邊緣原生系統架構圖
- 應呈現內容：
  1. 前端層：Nuxt 4、Nuxt UI、`@ai-sdk/vue` `useChat` 串流介面
  2. 資料與受管理檢索層：Cloudflare Workers、NuxtHub、Drizzle ORM、D1、R2、KV、Cloudflare AI Search
  3. Agentic AI 層：Vercel AI SDK、`workers-ai-provider`、部署時鎖定之回答模型與判斷／整合模型
  4. MCP 層：Nuxt MCP Toolkit、Middleware、Bearer Auth
  5. 右側以虛線標示 `v1.1` 延伸：Passkey、MCP Session 與條件式 Cloud fallback
  6. 以單一 Cloudflare Edge 邊界框包覆四層，強調邊緣優先與核心版不預設相依於額外跨雲 LLM API

架構說明如下：

- 前端層：使用 Nuxt 4 與 Nuxt UI 建立問答介面、管理後台與設定頁。`v1.0.0` 使用者以 Google OAuth 登入，並在同一前端中存取各自權限允許的對話歷史與文件管理頁；Passkey 與進階統計頁面改列 `v1.1`。[11][12][17]
- 資料與受管理檢索層：以 R2 儲存原始文件與版本檔，D1 儲存結構化資料，KV 作為快取與 rate limit 計數器；Web Admin 文件上傳採應用層簽發一次性 signed URL 後直傳 R2。應用層需先將原始檔轉為正規化文字快照並寫入 `normalized_text_r2_key`，再以固定切分規則預建 `source_chunks`，作為引用回放真相來源。Cloudflare AI Search 連接既定資料來源後，負責 Markdown 轉換、分塊、Embedding、query rewriting、reranking 與 retrieval；應用層先以 metadata filter 套用 `status = active` 與可見 `access_level`，必要時可附帶 `version_state = current` 作為快篩提示，但不將遠端 metadata 視為發布真相來源。正式回答前一律以 D1 驗證 `document_version_id` 是否仍符合 `documents.status = active`、`document_versions.index_status = indexed` 與 `document_versions.is_current = true`，並要求 AI Search 回傳候選片段可對應至既有 `source_chunks`。D1 與正規化文字快照才是 current-version-only 與引用回放的正式真相來源，AI Search metadata 與供應商 chunk 僅作快篩、檢索與觀測用途。[7][15]
- Agentic AI 層：回答生成與流程控制由應用層掌握。`v1.0.0` 先以角色型抽象定義 `models.defaultAnswer` 與 `models.agentJudge` 兩類模型；Preview 驗證通過後，再把實際模型名稱鎖定於部署設定與報告。第一輪檢索後，系統先計算純檢索訊號的 `retrieval_score`；僅在邊界區間時才由 `models.agentJudge` 執行 answerability judge，以兼顧回答品質與首字延遲。若仍不足則由 `models.agentJudge` 進行 Query Reformulation 並重試一次；單文件、明確、程序型或事實型回答由 `models.defaultAnswer` 生成，跨文件比較與彙整型回答則固定由 `models.agentJudge` 生成。條件式 Cloud fallback 改列 `v1.1`，不納入 `v1.0.0` 核心驗收。
- MCP 層：以 `@nuxtjs/mcp-toolkit` 建立 MCP 端點，透過 Middleware 驗證 Bearer token 與 scope。`v1.0.0` 的 MCP 採無狀態呼叫，不建立 `MCP-Session-Id` 相依性；Web 對話與 MCP 工具契約因此分別對應「D1 持久化對話輔助」與「單次請求契約」。若 `v1.1` 導入多輪上下文，runtime state 仍應保存於 KV，而非與 Web 對話混寫。[4][15][16]

雖然 Cloudflare AI Search 已提供 public endpoint 與原生 MCP 能力，[7][26][28] 本專題 `v1.0.0` 仍選擇在應用層自建 MCP。主因是正式回答前必須統一經過 D1 `active/indexed/current` 驗證、`restricted` scope 檢查、`source_chunks` 可回放引用對應與遮罩後查詢日誌；若直接暴露供應商原生 MCP 端點，將難以保證 Web 與 MCP 共用同一套發布真相與審計規則。

Cloudflare AI Search 每個 instance 最多支援 5 個 custom metadata 欄位。[7][24] 本系統 `v1.0.0` 固定保留 4 個核心欄位：`document_version_id`、`category`、`status`、`access_level`；`version_state` 僅於需要輔助後台觀測或同步檢查時作為第 5 個選用欄位，不作正式回答的硬性判斷依據。其中 `document_id` 與 `version_no` 不再額外占用 custom metadata，而是由 `folder = /kb/{category}/{document_id}/v{version_no}/` 路徑策略與 D1 回推。此設計是為了符合 AI Search custom metadata 上限，同時保留分類篩選、版本追蹤與資料治理判斷。`documents.tags` 僅保留於 D1 供後台管理與後續延伸，不同步至 AI Search，也不作為 `v1.0.0` MCP 對外檢索契約參數。

### 1.3.3 實作前確認事項與最小可行閉環

本版雖以完整答辯骨架撰寫，但真正開始實作前，仍需先把「平台能力確認」與「核心閉環收斂」分開處理。若把所有候選能力一次視為既定需求，容易在實作前半段即因模型、SDK 或 rich format 品質變動而重寫規格。

| 面向       | 實作前確認事項                                                                                           | `v1.0.0` 通過條件                                                                                    | 若未通過之降階原則                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 檢索介面   | 確認 AI Search 在目標環境可穩定提供搜尋 API 或 Workers binding，並回傳足以做 D1 post-verification 的欄位 | 可對指定 `document_version_id` 完成 smoke query，取得分數、必要 metadata 與可用候選片段              | 先保留 Web 問答與後台同步為核心閉環，MCP 介面與進階 filter 延後到核心檢索穩定後再接入              |
| 引用回放   | 確認驗收資料集的候選片段可穩定對應至既有 `source_chunks`                                                 | 用於驗收與答辯的 current 文件皆能通過 smoke retrieval 與 `citationId` 回放                           | 核心驗收資料集先限 `md`、`txt` 或預先轉 Markdown 之文件；`pdf`、`docx` 改為條件支援                |
| 模型可用性 | 確認 Workers AI 於部署當下至少存在一個低延遲回答模型與一個較強判斷／整合模型                             | Preview 環境能完成 direct path、judge 與 Self-Correction 三條路徑，且實際模型名稱已鎖定至設定檔      | 以角色型常數 `models.defaultAnswer` / `models.agentJudge` 維持規格，待可用模型穩定後再回填實際名稱 |
| 範圍收斂   | 確認 `v1.0.0` 先完成可展示的最小閉環，而非一次完成所有優化項                                             | 至少完成「文件發布 → Web 問答 → 引用回放 → current-version-only 驗證 → 權限隔離 → 查詢日誌」六步閉環 | 延後 debug 視覺化、進階調校與非核心 UI 細節，不得為了展示而先做 `v1.1` 能力                        |

`v1.0.0` 最小可行閉環如下：

1. Admin 上傳並發布一份 `internal` 文件，使其成為 current version。
2. Web User 針對 current 文件提問，系統回傳含有效引用的回答。
3. `getDocumentChunk` 可回放其中至少一筆引用。
4. 同一文件切到新版本後，舊版內容不再出現在正式回答。
5. 未具 `knowledge.restricted.read` 之 MCP token 與一般 Web User 均不得讀取 `restricted` 內容。
6. `query_logs` 與 `messages` 可證明高風險輸入未以原文持久化。

若時程受壓，`v1.0.0` 的刪減順序應為：先延後 debug 分數面板與管理摘要視覺化，再延後 rich format 直接 ingestion，最後才縮減 MCP 以外的輔助功能；不得先刪 current-version-only、引用回放、權限隔離與遮罩記錄等核心治理能力。

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

| Actor          | Use Case                | 說明                                                                      |
| -------------- | ----------------------- | ------------------------------------------------------------------------- |
| User           | 提問並獲得回答          | 輸入自然語言問題，取得含引用與拒答能力的回答                              |
| User           | 查看對話歷史            | 回顧過往問答紀錄與引用資訊                                                |
| User           | 追問多輪對話            | 基於現有對話上下文延伸提問                                                |
| Admin          | 上傳文件                | 建立文件與初始版本，上傳原始檔至 R2                                       |
| Admin          | 建立新版本              | 為既有文件建立新版本並重新同步至 AI Search                                |
| Admin          | 觸發 AI Search 同步     | 發動 instance 級同步流程，更新索引狀態                                    |
| Admin          | 查看查詢日誌與觀測摘要  | 檢視延遲、引用、拒答、Self-Correction 與 MCP 使用概況，不含 `v1.1` 儀表板 |
| Admin          | 管理 MCP token          | 建立、檢視、撤銷 Bearer token 與 scope                                    |
| External Agent | 呼叫 `searchKnowledge`  | 以檢索方式取得片段結果                                                    |
| External Agent | 呼叫 `askKnowledge`     | 以問答方式取得回答與引用                                                  |
| External Agent | 呼叫 `getDocumentChunk` | 以 `citationId` 取得完整引用片段                                          |
| External Agent | 呼叫 `listCategories`   | 取得知識庫分類列表與數量                                                  |

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
5. **第一階段置信度評估**：系統先以通過遠端 metadata 與 D1 current 驗證之候選片段計算 `top1_score`、`mean_top3_score`、`evidence_coverage` 與跨文件硬門檻，再合成 `retrieval_score`。
6. **直接回答條件**：若 `retrieval_score >= 0.70` 且未觸發跨文件硬門檻失敗，則不再呼叫 judge，直接進入回答生成。`v1.0.0` 固定模型路由如下：`simple_fact`、`single_document_procedural` 與僅依單一已驗證文件延續的 Web 多輪追問，由 `models.defaultAnswer` 生成最終答案；跨文件比較、比較／彙整題與需兩份以上文件整合者，由 `models.agentJudge` 生成最終答案。
7. **邊界區間 judge**：若 `0.45 <= retrieval_score < 0.70`，則由 `models.agentJudge` 進行一次 answerability judge，並以固定 JSON schema 回傳 `answerability_judge: number (0..1)`、`should_answer: boolean`、`reason: string`，再合成最終 `confidence_score`。
8. **Self-Correction 條件**：若 `confidence_score < 0.55`、`retrieval_score < 0.45`，或跨文件硬門檻未通過，且 `retry_count = 0`，並且滿足以下任一條件，則由 `models.agentJudge` 重寫查詢後重試一次：`(a)` 至少存在一筆通過遠端 metadata 與 D1 驗證的候選片段可供重寫；`(b)` Query Normalization 已偵測到明確遺漏實體、縮寫未展開或日期條件不完整。第二輪重試停用 AI Search `rewrite_query`，避免雙重改寫失真。
9. **拒答條件**：若第二輪後仍 `confidence_score < 0.55`，或檢索結果無足夠引用，或跨文件比較仍未取得至少 2 份不同文件證據，或在授權後可用證據集合中仍無足夠有效證據，則回傳拒答結果與補充建議。
10. **引用組裝與記錄**：系統只可引用發布階段預先建立之 `source_chunks`；回答階段不得臨時補建 `source_chunks`。若候選片段無法對應既有 `citationId`，該片段視為無效證據，不得進入正式回答。正式回答時僅建立本次查詢的 `citation_records`、寫入遮罩後 `query_logs`，並將回答以串流方式輸出。Cloud fallback 若於 `v1.1` 啟用，亦不得繞過上述引用驗證與資料治理流程。

查詢類型的判定規則如下：

| 類型         | 判定條件                                                           | 用途                                   |
| ------------ | ------------------------------------------------------------------ | -------------------------------------- |
| 簡單事實查詢 | 單一名詞定義、單一流程步驟、單一文件即可回答                       | 優先走 direct path                     |
| 模糊查詢     | 問題缺少明確實體、日期、縮寫展開或文件名稱                         | 可觸發 Self-Correction                 |
| 跨文件比較   | 問題包含比較、差異、彙整，或回答至少需兩份文件支持                 | `required_distinct_document_count = 2` |
| Web 多輪追問 | 同一 `conversationId` 下出現「那個」「第二步」「剛剛提到」等指代語 | 僅 Web `v1.0.0` 支援                   |

補充判定原則：

- `web_followup` 只有在「上一則持久化 assistant 訊息之有效引用經 D1 重算後仍全部落在同一 `document_id`，且該文件仍存在 current 版本」時，才可沿用單文件 follow-up 路由；否則一律重新分類為 `ambiguous` 或 `cross_document_comparison`。
- 若上一則 assistant 訊息沒有有效引用、只留下 `rejected_marker` / `redacted_only`，或引用文件已非 current，該次追問不得直接走單文件 follow-up 快路徑。

`retrieval_score` 由以下三項組成：

| 構成項目            | 說明                                                                         | 權重 |
| ------------------- | ---------------------------------------------------------------------------- | ---- |
| `top1_score`        | 第一名有效片段的 `score`，若無結果則為 `0`                                   | 0.50 |
| `mean_top3_score`   | 前三名有效片段的 `score` 平均值；只對實際存在的有效片段取平均，不以 `0` 補齊 | 0.30 |
| `evidence_coverage` | 由有效證據充足度、文件多樣性與驗證完整度計算                                 | 0.20 |

`confidence_score` 僅在 judge 觸發後重新計算如下：

| 構成項目              | 說明                                                       | 權重 |
| --------------------- | ---------------------------------------------------------- | ---- |
| `retrieval_score`     | 第一階段純檢索分數                                         | 0.80 |
| `answerability_judge` | `models.agentJudge` 依固定 schema 回傳之 `0..1` 可回答分數 | 0.20 |

計算公式如下：

```text
raw_retrieval_score =
  0.50 * top1_score +
  0.30 * mean_top3_score +
  0.20 * evidence_coverage

if cross_document_gate_failed:
  retrieval_score = min(raw_retrieval_score, 0.44)
else:
  retrieval_score = raw_retrieval_score

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
  verified_results.length === 0
    ? 0
    : average(verified_results.slice(0, 3).map(result => result.score))

required_chunk_evidence_count =
  is_cross_document_query ? 2 : 1

required_distinct_document_count =
  is_cross_document_query ? 2 : 1

eligible_evidence_count =
  min(verified_results.length, 3)

evidence_sufficiency =
  min(eligible_evidence_count, required_chunk_evidence_count) / required_chunk_evidence_count

distinct_verified_document_count =
  countDistinct(
    verified_results.map(result =>
      d1_document_id_by_version(result.document_version_id)
    )
  )

document_diversity_score =
  verified_results.length === 0
    ? 0
    : min(distinct_verified_document_count, required_distinct_document_count) / required_distinct_document_count

verification_integrity =
  results.length === 0
    ? 0
    : verified_results.length / results.length

evidence_coverage =
  0.60 * evidence_sufficiency +
  0.25 * document_diversity_score +
  0.15 * verification_integrity

cross_document_gate_failed =
  is_cross_document_query &&
  distinct_verified_document_count < required_distinct_document_count
```

此處 `distinct_verified_document_count` 必須由 D1 依 `document_version_id` 解析回 `document_id` 後計算；由於 `document_id` 不列入 AI Search custom metadata，上述文件多樣性判斷不可直接相依於供應商回傳欄位。

上述定義的目的，是讓 `retrieval_score` 在真正產生回答與組裝引用之前，即具備可重現、可測試、可比對的前置判斷方式，且跨文件問題不會因單一文件出現多個高分片段而被誤判為證據充分。文中的 `0.35`、`0.45`、`0.55`、`0.70` 皆為 `v1.0.0` 初版預設值，屬部署設定而非對外 API 契約；正式上線前僅可依 `seed` 與獨立 `dev-calibration` 案例校準，`frozen-final` 正式驗收集凍結後不得再回頭調整門檻、prompt 或路由規則。

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
  - `ingestion_jobs`
  - `conversations`
  - `messages`
  - `query_logs`
  - `citation_records`
  - `mcp_tokens`
  - 延伸實體（`v1.1`）：`mcp_sessions`
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
  - `mcp_tokens` 1─N `mcp_sessions`（`v1.1`）
- 註記要求：
  - `document_versions.ai_search_file_id` 與 AI Search 索引項目對應
  - `source_chunks.id` 為對外公開之可回放 `citationId`
  - `citation_records.id` 僅為單次查詢中的引用快照紀錄，不對外公開

#### 核心資料表設計

**user_profiles（應用層使用者設定）**

| 欄位         | 類型                                   | 說明                                                                      |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------- |
| user_id      | string (PK, FK → better_auth_users.id) | 對應 better-auth 使用者                                                   |
| display_name | string                                 | 顯示名稱                                                                  |
| role         | enum ('user', 'admin')                 | 系統角色                                                                  |
| status       | enum ('active', 'disabled')            | 使用狀態                                                                  |
| auth_source  | enum ('google', 'passkey', 'mixed')    | 主要登入來源；`v1.0.0` 固定為 `google`，`v1.1` 才擴充 `passkey` / `mixed` |
| admin_source | enum ('none', 'allowlist', 'manual')   | 管理員身分來源                                                            |
| created_at   | timestamp                              | 建立時間                                                                  |
| updated_at   | timestamp                              | 更新時間                                                                  |

補充規則：

- `v1.0.0` 不建立 `admin_allowlists` 資料表；部署環境變數 `ADMIN_EMAIL_ALLOWLIST` 為管理員名單真相來源。
- 使用者完成 Google OAuth 後，應用層依 email 是否命中 allowlist 決定 `role` 與 `admin_source`，並同步至 `user_profiles`。
- Admin 專屬路由與後台操作在授權時，不得僅信任 `user_profiles.role`；仍須以目前 Session email 對正規化 allowlist 重新判定，避免 allowlist 異動後殘留舊權限。

**documents（文件）**

| 欄位         | 類型                                 | 說明                                                          |
| ------------ | ------------------------------------ | ------------------------------------------------------------- |
| id           | string (PK)                          | 文件唯一識別碼                                                |
| title        | string                               | 文件標題                                                      |
| category     | string                               | 文件分類                                                      |
| tags         | json                                 | 標籤陣列（供後台管理與未來延伸；`v1.0.0` 不同步至 AI Search） |
| access_level | enum ('internal', 'restricted')      | 敏感等級                                                      |
| status       | enum ('draft', 'active', 'archived') | 文件狀態                                                      |
| uploaded_by  | string (FK → user_profiles.user_id)  | 建立者                                                        |
| created_at   | timestamp                            | 建立時間                                                      |
| updated_at   | timestamp                            | 更新時間                                                      |

補充規則：

- `title` 與 `tags` 可於不改變檢索語意之前提下直接更新，不強制重同步。
- `category` 與 `access_level` 屬會影響 AI Search metadata 與檢索過濾的發布級欄位；若文件已有 `indexed` 版本，變更後必須立即排入目標 current 版本之 metadata refresh / reindex 工作流程，並於管理後台標示「待同步」。
- `documents.status` 以 D1 為立即生效真相來源；即使遠端 metadata 尚未同步完成，`archived` 仍須立刻阻止正式回答。
- `documents.status = draft` 的文件版本可先完成同步與 smoke retrieval 驗證，但不得執行 publish；首次發布前必須先切為 `active`。
- `documents.status = archived` 時，不要求立即清空歷史 `is_current` 指標，但所有正式檢索、`listCategories`、Web 問答與 MCP 回答皆必須排除 archived 文件；若日後重新啟用，仍須由管理員顯式確認 current 版本或重新 publish。
- 版本建立後，其 `r2_key`、`folder` 與 `metadata_json` 視為版本快照；後續即使 `documents.category` 調整，也不得回寫舊版路徑快照，而應以新的同步快照反映差異。

**document_versions（文件版本）**

| 欄位                      | 類型                                                             | 說明                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id                        | string (PK)                                                      | 版本唯一識別碼                                                                                                                                         |
| document_id               | string (FK → documents.id)                                       | 所屬文件                                                                                                                                               |
| version_no                | integer                                                          | 版本號                                                                                                                                                 |
| r2_key                    | string                                                           | 原始檔於 R2 的路徑                                                                                                                                     |
| normalized_text_r2_key    | string                                                           | 正規化文字快照於 R2 的路徑，作為 `source_chunks` 建立、對應驗證與重新發布之真相來源                                                                    |
| checksum                  | string                                                           | 檔案雜湊值                                                                                                                                             |
| mime_type                 | string                                                           | MIME 類型                                                                                                                                              |
| size_bytes                | integer                                                          | 檔案大小                                                                                                                                               |
| ai_search_file_id         | string                                                           | AI Search 對應之 `file_id`                                                                                                                             |
| metadata_json             | json                                                             | 同步至 AI Search 的中繼資料與版本顯示快照；至少需含 custom metadata、`folder` 路徑，以及供引用卡片 / `getDocumentChunk` 使用之標題、分類與版本標籤快照 |
| ingestion_profile_version | string                                                           | 建立 normalized text、metadata 與 `source_chunks` 所用規格版本                                                                                         |
| smoke_test_queries_json   | json                                                             | 由前處理產生之代表性 smoke probes；供發布前檢索與對應驗證使用                                                                                          |
| index_status              | enum ('queued', 'syncing', 'smoke_pending', 'indexed', 'failed') | 索引狀態                                                                                                                                               |
| is_current                | boolean                                                          | 是否為目前啟用版本                                                                                                                                     |
| indexed_at                | timestamp                                                        | 最近成功索引時間                                                                                                                                       |
| published_at              | timestamp                                                        | 最近一次成為 current 版本的時間                                                                                                                        |
| published_by              | string (FK → user_profiles.user_id, nullable)                    | 執行發布的管理者                                                                                                                                       |
| created_by                | string (FK → user_profiles.user_id)                              | 建立者                                                                                                                                                 |
| created_at                | timestamp                                                        | 建立時間                                                                                                                                               |

補充約束：

- `documents.id + document_versions.version_no` 必須唯一。
- 每份文件僅允許一筆 `is_current = true`，發布流程需在單一 transaction 中完成舊版降級與新版升級。
- `metadata_json` 需明確保存實際送往 AI Search 的 custom metadata 與 `folder` 路徑快照，避免 D1 與遠端設定脫鉤。
- `normalized_text_r2_key` 對應的內容必須可重現後續 `source_chunks`；若前處理規則變更，需重新產生快照與 `ingestion_profile_version`，不得沿用舊快照假裝相容。
- `smoke_test_queries_json` 必須與 `normalized_text_r2_key`、切塊規則同批產生，且發布後視為該版本驗證快照的一部分；至少需覆蓋標題、關鍵名詞與程序片段 3 類 probe。
- `smoke_test_queries_json` 的每筆 probe 至少需包含 `query`、`intent`、`expected_source_chunk_ids` 或等價定位資訊，以及 `min_expected_hits`；不得只保存裸字串，避免發布驗證無法重現。
- `published_at` 與 `published_by` 僅能在成功切換為 `is_current = true` 時寫入；歷史版本保留最近一次發布紀錄供稽核。
- 若同一對話曾引用舊版文件，版本切換後不得把舊 assistant 回答視為新的知識真相；後續追問仍需重新檢索 current 版本。

**source_chunks（引用回放來源）**

| 欄位                | 類型                               | 說明                                                                                                                    |
| ------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| id                  | string (PK)                        | 版本範圍內可回放的 `citationId`，為 opaque ID；`v1.0.0` 僅保證能回放既有引用，不保證跨版本或跨重切塊後維持相同值        |
| document_version_id | string (FK → document_versions.id) | 所屬文件版本                                                                                                            |
| locator_hash        | string                             | 由 heading path、段落序、chunk index 等正規化定位資訊雜湊而成；優先使用應用層 deterministic locator，供應商欄位僅作輔助 |
| locator_json        | json                               | 來源定位資訊快照；僅保存實際可取得欄位                                                                                  |
| chunk_hash          | string                             | 正規化 chunk 文字後的雜湊                                                                                               |
| ai_search_file_id   | string                             | 最近一次觀察到的 AI Search `file_id`                                                                                    |
| ai_search_chunk_id  | string                             | 最近一次觀察到的 AI Search chunk 識別碼                                                                                 |
| chunk_index         | integer                            | 應用層保存之穩定順序；若供應商未提供則於首次建立時指派                                                                  |
| chunk_text          | text                               | 由 `normalized_text_r2_key` 切出的完整片段文字快照，供 `getDocumentChunk` 回放                                          |
| excerpt_preview     | text                               | 顯示用短摘錄                                                                                                            |
| created_at          | timestamp                          | 建立時間                                                                                                                |
| updated_at          | timestamp                          | 更新時間                                                                                                                |

補充規則：

- `source_chunks` 應建立 `(document_version_id, locator_hash, chunk_hash)` 唯一約束。
- 若同一文件版本內出現完全相同文字片段，系統必須以 `locator_hash` 去歧義，不得僅以 `chunk_hash` 合併。
- `source_chunks` 由 `normalized_text_r2_key` 依固定切分規則預先建立，不以列舉供應商 chunk 作為前提。
- AI Search 回傳候選片段時，應以正規化文字比對、`locator_hash` 與 `document_version_id` 對應到既有 `source_chunks`；若無法對應，該片段不得作為正式引用。
- 若供應商重切塊或自動轉檔結果改變，影響的是對應結果而非 `source_chunks` 真相來源；若對應率無法達標，應重新前處理並重新發布驗證。
- `source_chunks` 必須於前處理階段預先建立完成；未完成者，該版本不得進入 `smoke_pending`。
- 正式回答階段只可查找既有 `source_chunks` 並建立 `citation_records`，不得在回答流程臨時補建。
- 已發布版本的 `source_chunks` 與 `chunk_text` 視為不可變快照；reindex 僅能更新觀測欄位或建立新版本，不得覆寫既有引用證據。
- 已被 `citation_records` 引用之 `source_chunks` 視為審計證據，不因版本切換、文件下架或 maintenance reindex 而立即刪除；`getDocumentChunk` 應在 retention window 內回放當次引用快照。

#### 引用回放來源建立策略

為讓 `citationId` 在供應商 chunk ID 變動、reindex 或 rich format 轉檔差異下仍可回放，`v1.0.0` 採「應用層 canonical text + deterministic segmentation」策略：

1. 原始檔上傳後，先由應用層產出單一正規化文字快照，寫入 `normalized_text_r2_key`。
2. `md` / `txt` 直接正規化；`pdf` / `docx` 需先轉為可檢查之文字快照，確認段落、標題與主要表格文字未嚴重缺失後，才可進入後續流程。
3. 應用層以固定切分規則（標題層級、段落邊界、最大字數與最小字數）預先建立 `source_chunks`，並一次產生 `locator_hash`、`chunk_hash`、opaque `citationId` 與 `smoke_test_queries_json`。
4. `smoke_test_queries_json` 至少需包含 3-5 筆代表性 probes，覆蓋文件標題／章節名、核心名詞或欄位名，以及一段可被程序型問句命中的內容；其來源必須可由 `normalized_text_r2_key` 重現。
5. smoke retrieval 的目的不是列舉供應商所有 chunk，而是驗證 AI Search 實際回傳之候選片段能否對應到既有 `source_chunks`。凡 `smoke_test_queries_json` 中通過權限與分數過濾的候選片段，皆必須能成功對應，否則該版本不得發布。
6. `v1.0.0` 不要求不同版本、不同 reindex 或不同切塊條件下沿用相同 `citationId`；只要求同一已發布版本中的引用可穩定回放且可稽核。

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
- smoke retrieval 屬維運用驗證流程，需以目標 `document_version_id` 的 `smoke_test_queries_json` 執行候選片段檢查，並確認可建立 `source_chunks` 對應；若目標版本原先尚未 `indexed`，驗證失敗時任務與版本狀態皆應標記為 `failed`；若屬已 `indexed` 版本之 maintenance reindex，僅同步任務標記為 `failed`，版本仍維持最近一次可服務之 `indexed` 狀態。

**conversations（Web 對話）**

| 欄位         | 類型                                | 說明                                                                                                   |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| id           | string (PK)                         | 對話唯一識別碼                                                                                         |
| user_id      | string (FK → user_profiles.user_id) | 關聯使用者                                                                                             |
| access_level | enum ('internal', 'restricted')     | 對話內目前最高敏感等級；若任一持久化 assistant 訊息引用 `restricted` 證據，整段對話標記為 `restricted` |
| title        | string                              | 對話標題                                                                                               |
| created_at   | timestamp                           | 建立時間                                                                                               |
| updated_at   | timestamp                           | 最後更新時間                                                                                           |
| deleted_at   | timestamp                           | 軟刪除時間                                                                                             |

補充規則：

- 讀取對話列表與詳情時，必須依目前身分重新檢查 `conversations.access_level`。使用者若失去 `restricted` 權限，原 `restricted` 對話不得再顯示於列表或詳情 API。

**messages（訊息）**

| 欄位             | 類型                                                   | 說明                                                                                            |
| ---------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| id               | string (PK)                                            | 訊息唯一識別碼                                                                                  |
| conversation_id  | string (FK → conversations.id)                         | 所屬對話                                                                                        |
| request_id       | string                                                 | 對應同一次 `/api/chat` 請求鏈，用於串接 `query_logs.request_id` 與同批 user / assistant 訊息    |
| role             | enum ('user', 'assistant', 'system')                   | 訊息角色                                                                                        |
| message_state    | enum ('persisted', 'redacted_only', 'rejected_marker') | 持久化狀態；高風險輸入只留下 `rejected_marker` 或遮罩副本，不保存原文                           |
| content_text     | text                                                   | 僅保存通過安全檢查、允許持久化之 Web 對話原文，供多輪指代輔助與使用者本人查看；不作知識真相來源 |
| content_redacted | text                                                   | 稽核與分析用遮罩版本，不作為上下文真相來源                                                      |
| model_name       | string, nullable                                       | 產生該回應所用模型；非 assistant 訊息可為 `null`                                                |
| citations_json   | json, nullable                                         | 行內引用對應資料；assistant 訊息至少需含 `citationId` 與當次回答依據之 `document_version_id`    |
| metadata_json    | json                                                   | 其他中繼資料                                                                                    |
| created_at       | timestamp                                              | 建立時間                                                                                        |

補充規則：

- `message_state = rejected_marker` 或 `redacted_only` 時，前端僅可顯示固定占位訊息與遮罩後摘要，不得回顯原始輸入。
- 只有 `message_state = persisted` 的訊息可進入後續模型上下文；`redacted_only` 與 `rejected_marker` 僅供 UI 與稽核使用。
- 同一輪 Web 問答至少需以相同 `request_id` 串起 user message、assistant message 與 `query_logs`；若因高風險規則在模型前拒答，仍需保留可稽核的 `request_id` 關聯。
- Web 多輪上下文僅作指代輔助，不得跳過 current 版本重新檢索；若先前回答所依據之 `document_version_id` 已非 current，系統應將該對話標記為 stale 並以新檢索結果為準。
- stale 判定應以最新持久化 assistant 訊息內 `citations_json.document_version_id` 與 D1 `is_current` 狀態動態重算；若為效能而額外快取 stale 標記，該快取僅屬衍生欄位，不得成為真相來源。

**query_logs（查詢日誌）**

| 欄位                             | 類型                                                                                                                           | 說明                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| id                               | string (PK)                                                                                                                    | 日誌唯一識別碼                                                                 |
| request_id                       | string                                                                                                                         | 單次請求／回應鏈唯一識別碼，用於串接 `messages`、`citation_records` 與治理事件 |
| channel                          | enum ('web', 'mcp')                                                                                                            | 來源通道                                                                       |
| user_id                          | string (FK → user_profiles.user_id, nullable)                                                                                  | 關聯使用者                                                                     |
| conversation_id                  | string (FK → conversations.id, nullable)                                                                                       | 關聯對話                                                                       |
| mcp_token_id                     | string (FK → mcp_tokens.id, nullable)                                                                                          | 來源 token；僅 `mcp` 通道有值                                                  |
| operation_name                   | string                                                                                                                         | `web:chat` 或 MCP Tool 名稱，供稽核與統計                                      |
| query_type                       | enum ('simple_fact', 'single_document_procedural', 'cross_document_comparison', 'ambiguous', 'web_followup', 'policy_blocked') | 問題分類結果                                                                   |
| original_query_masked            | text                                                                                                                           | 原始查詢之遮罩版本                                                             |
| normalized_query_masked          | text                                                                                                                           | 標準化後查詢之遮罩版本                                                         |
| reformulated_query_masked        | text                                                                                                                           | Self-Correction 後查詢之遮罩版本                                               |
| request_outcome                  | enum ('answered', 'refused', 'forbidden', 'invalid', 'error')                                                                  | 請求結果分類                                                                   |
| retrieval_filters_json           | json                                                                                                                           | AI Search 篩選條件、`allowed_access_levels` 與 D1 驗證摘要                     |
| retrieval_round_count            | integer                                                                                                                        | 本次實際檢索輪數；`v1.0.0` 允許 `0`、`1` 或 `2`                                |
| top_k                            | integer                                                                                                                        | 檢索片段數量                                                                   |
| verified_result_count            | integer                                                                                                                        | 通過 metadata 與 D1 post-verification 的候選片段數                             |
| distinct_verified_document_count | integer                                                                                                                        | 通過驗證之不同文件數                                                           |
| cross_document_gate_failed       | boolean                                                                                                                        | 是否觸發跨文件硬門檻失敗                                                       |
| retrieval_score                  | float, nullable                                                                                                                | 第一階段純檢索分數；若請求在檢索前即因驗證或政策阻擋中止則為 `null`            |
| judge_triggered                  | boolean                                                                                                                        | 是否觸發 answerability judge                                                   |
| answerability_judge_score        | float, nullable                                                                                                                | judge 分數（未觸發則為 `null`）                                                |
| confidence_score                 | float, nullable                                                                                                                | 最終置信度分數；若未進入回答決策則為 `null`                                    |
| decision_path                    | enum ('direct', 'judge_pass', 'self_corrected', 'refused'), nullable                                                           | 最終決策路徑；對 `forbidden`、`invalid`、`error` 或檢索前政策阻擋可為 `null`   |
| self_correction_triggered        | boolean                                                                                                                        | 是否觸發 Self-Correction                                                       |
| refused                          | boolean                                                                                                                        | 是否拒答                                                                       |
| refusal_reason_code              | string                                                                                                                         | 拒答、越權或政策阻擋之主因代碼                                                 |
| answer_model                     | string, nullable                                                                                                               | 實際回答模型名稱；若未進入回答生成則為 `null`                                  |
| risk_flags_json                  | json                                                                                                                           | 敏感資料、權限與政策標記                                                       |
| redaction_applied                | boolean                                                                                                                        | 是否已完成記錄遮罩                                                             |
| config_snapshot_version          | string                                                                                                                         | 本次查詢採用之規格常數與 feature flags 版本                                    |
| decision_trace_json              | json                                                                                                                           | 非穩定內部決策細節快照，避免頻繁調整 schema                                    |
| http_status                      | integer                                                                                                                        | 對外回應狀態碼                                                                 |
| first_token_latency_ms           | integer, nullable                                                                                                              | 首字延遲；非串流或請求在輸出前即被阻擋時可為 `null`                            |
| completion_latency_ms            | integer, nullable                                                                                                              | 完整回答延遲；請求失敗或未形成完整回答時可為 `null`                            |
| created_at                       | timestamp                                                                                                                      | 建立時間                                                                       |

補充規則：

- `query_type`、`decision_path`、`refusal_reason_code` 與 `config_snapshot_version` 必須使用 Web 與 MCP 共用常數，不得由不同通道各自命名。
- `verified_result_count` 與 `distinct_verified_document_count` 的計算基準必須是 D1 post-verification 後的有效證據，而非供應商原始回傳數量。
- `distinct_verified_document_count` 應由 D1 依 `document_version_id` 還原 `document_id` 後計算，不得假設遠端回傳會直接提供 `document_id`。
- `config_snapshot_version` 至少需對應到本文件所定義的模型路由、門檻值與 feature flags 組合，以支援後續驗證重現。
- `request_id` 應可串起同一次問答的授權判定、查詢日誌、引用快照與前後端追蹤紀錄；不穩定之內部分析欄位應優先寫入 `decision_trace_json`，避免頻繁改 schema。
- 若請求在檢索前即被 `401`、`403`、`422` 或高風險政策阻擋終止，`retrieval_round_count` 可為 `0`，且 `retrieval_score`、`confidence_score`、`decision_path`、`answer_model` 與延遲欄位允許為 `null`。

**citation_records（引用紀錄）**

| 欄位                | 類型                               | 說明                   |
| ------------------- | ---------------------------------- | ---------------------- |
| id                  | string (PK)                        | 引用快照唯一識別碼     |
| query_log_id        | string (FK → query_logs.id)        | 所屬查詢               |
| source_chunk_id     | string (FK → source_chunks.id)     | 對應引用回放來源       |
| document_version_id | string (FK → document_versions.id) | 當次回答引用之版本快照 |
| chunk_hash          | string                             | 當次引用片段雜湊快照   |
| locator_hash        | string                             | 當次引用定位雜湊快照   |
| ordinal             | integer                            | 引用序號               |
| excerpt             | text                               | 回答中顯示的引用摘錄   |
| score               | float                              | 片段分數               |
| created_at          | timestamp                          | 建立時間               |

**mcp_tokens（MCP Bearer token）**

| 欄位              | 類型                                          | 說明             |
| ----------------- | --------------------------------------------- | ---------------- |
| id                | string (PK)                                   | Token 唯一識別碼 |
| label             | string                                        | 顯示名稱         |
| token_hash        | string                                        | 雜湊後 token 值  |
| scopes            | json                                          | 權限範圍         |
| issued_to_user_id | string (FK → user_profiles.user_id, nullable) | 關聯發放目標     |
| status            | enum ('active', 'revoked', 'expired')         | 狀態             |
| last_used_at      | timestamp                                     | 最後使用時間     |
| expires_at        | timestamp                                     | 到期時間         |
| revoked_at        | timestamp                                     | 撤銷時間         |
| revoked_by        | string (FK → user_profiles.user_id, nullable) | 撤銷者           |
| created_by        | string (FK → user_profiles.user_id)           | 發放者           |
| created_at        | timestamp                                     | 建立時間         |
| updated_at        | timestamp                                     | 更新時間         |

> `v1.0.0` 的 MCP 採無狀態呼叫，因此不建立 `mcp_sessions`。若 `v1.1` 導入 `MCP-Session-Id`，再新增對應 metadata table，並維持「KV 保存 runtime state、D1 僅保存 metadata」的原則。

#### 上下文與真相來源設計說明

本系統將身分與上下文區分為三層：

1. **認證核心表與登入 Session**：由 better-auth 管理，用於 Web 使用者的 Google OAuth 驗證；Passkey 若於 `v1.1` 導入，仍應留在此層。
2. **應用層角色設定**：由 `user_profiles` 管理角色、狀態與管理員來源，不直接複製整份 auth schema；`v1.0.0` 的管理員名單真相來源為部署環境變數 `ADMIN_EMAIL_ALLOWLIST`，每次 privileged request 仍須以正規化 Session email 對 allowlist 重新計算，D1 僅保存登入後角色快照與 `admin_source` 供 UI、審計與查詢使用。
3. **Web 對話持久化**：僅將通過安全檢查、允許持久化之 Web 問答原文寫入 `conversations/messages.content_text`，作為 Web 多輪指代輔助來源，而非知識真相來源；若輸入命中高風險規則，則不得保存原文，只能寫入 `message_state = rejected_marker` 或 `redacted_only` 的事件紀錄、遮罩後審計副本與拒答結果，以保留 UI 時序但不把原文放入後續上下文。`content_redacted` 僅供審計與統計使用。
4. **對話可見性重算**：`conversations.access_level` 代表該對話目前最高敏感等級。讀取對話時必須依目前角色重新檢查；若使用者失去 `restricted` 權限，原受限對話不得回傳。`rejected_marker` / `redacted_only` 在 UI 僅顯示固定占位訊息，不回顯原文。

`v1.0.0` 的 MCP 不承擔多輪上下文真相來源，只保存單次請求的契約輸入、輸出與審計資料。此設計的目的是避免將 Web 對話、MCP runtime state 與審計資料混寫在同一組資料表中，造成真相來源不一致。即使是 Web 多輪追問，每次回答仍需重新檢索 current 版本；若先前引用的 `document_version_id` 已非 current，系統應將該對話標記為 stale 並以新檢索結果為準。

### 2.2.2 API 與 MCP 介面設計

#### 內部 REST API（前端與管理後台使用）

| 方法   | 路徑                                        | 說明                                                | 權限  |
| ------ | ------------------------------------------- | --------------------------------------------------- | ----- |
| POST   | `/api/chat`                                 | 問答與串流回應                                      | User  |
| GET    | `/api/conversations`                        | 取得對話列表                                        | User  |
| GET    | `/api/conversations/:id`                    | 取得單一對話詳情                                    | User  |
| DELETE | `/api/conversations/:id`                    | 刪除對話                                            | User  |
| POST   | `/api/uploads/presign`                      | 取得一次性 R2 上傳 URL、object key 與 `uploadId`    | Admin |
| POST   | `/api/uploads/finalize`                     | 驗證 checksum、size、MIME type 並確認 staged upload | Admin |
| GET    | `/api/documents`                            | 取得文件列表                                        | Admin |
| POST   | `/api/documents`                            | 以已上傳 R2 object key 建立文件與首版               | Admin |
| PUT    | `/api/documents/:id`                        | 更新文件中繼資料                                    | Admin |
| POST   | `/api/documents/:id/versions`               | 以已上傳 R2 object key 建立新版本                   | Admin |
| POST   | `/api/documents/:id/reindex`                | 對既有版本觸發同版重同步與對應驗證                  | Admin |
| POST   | `/api/document-versions/:versionId/publish` | 將已 `indexed` 版本切換為 current                   | Admin |
| POST   | `/api/ai-search/sync`                       | 觸發 instance 級同步                                | Admin |
| GET    | `/api/query-logs`                           | 查詢日誌列表                                        | Admin |
| GET    | `/api/mcp-tokens`                           | 取得 MCP token 列表                                 | Admin |
| POST   | `/api/mcp-tokens`                           | 建立 MCP token                                      | Admin |
| POST   | `/api/mcp-tokens/:id/revoke`                | 撤銷 MCP token                                      | Admin |

備註：`v1.0.0` 文件上傳採 staged upload 流程：Admin 先呼叫 `/api/uploads/presign` 取得一次性 R2 signed URL 與 `uploadId`，前端直傳 R2 後，再呼叫 `/api/uploads/finalize` 完成 checksum、size 與 MIME type 驗證；只有 finalize 通過後，才可呼叫 `/api/documents` 或 `/api/documents/:id/versions` 建立正式版本與同步排程。Cloudflare AI Search 已提供同步 REST API；但 `v1.0.0` 仍將「文件重同步」定義為應用層工作流程：先標記目標版本，再呼叫部署當下官方可用的同步能力，並由日誌與狀態回寫反映結果，不把供應商特定 API 直接綁死在論文契約中。[26] `/api/documents/:id/reindex` 僅用於既有 `document_version_id` 的同版重建與索引修復，不承載內容變更；凡內容異動，一律建立新版本。若同一 `document_version_id` 已存在 `queued`、`syncing` 或 `smoke_pending` 任務，應回傳既有任務或 `409`，避免重複排程。Smoke retrieval 通過只表示版本已可發布，不代表自動成為 current；current 切換須由 `/api/document-versions/:versionId/publish` 顯式觸發。`/api/document-versions/:versionId/publish` 的前置條件至少包含：目標版本為 `indexed`、對應 `documents.status = active`、該版本沒有進行中的同步任務；若目標版本已是 current，應回傳 `200` 與 no-op 結果，避免前後端各自實作不同的重送語意。

#### MCP `v1.0.0` 核心 Tools

| Tool 名稱          | 說明             | 輸入參數                                 | 輸出                                     |
| ------------------ | ---------------- | ---------------------------------------- | ---------------------------------------- |
| `searchKnowledge`  | 查詢知識庫片段   | `query`、`topK?`、`category?`            | 片段結果與 `citationId`                  |
| `askKnowledge`     | 問答並回傳引用   | `question`、`category?`、`maxCitations?` | 回答、引用與拒答資訊                     |
| `getDocumentChunk` | 取得完整引用片段 | `citationId`                             | 片段全文與來源中繼資料                   |
| `listCategories`   | 列出分類與數量   | `includeCounts?`                         | 依呼叫者可見範圍計算之分類清單與文件數量 |

所有 MCP Tools 需同時符合以下條件：

- `Authorization: Bearer <token>`
- token 狀態為 active
- token 具備對應 scope
- 若需存取 `restricted` 內容，token 必須額外具備 `knowledge.restricted.read`

補充規則如下：

- Web 對話使用 `/api/chat` 的 `conversationId`；MCP `v1.0.0` 為無狀態契約，不接受 `conversationId` 與 `MCP-Session-Id`。
- `searchKnowledge` 與 `askKnowledge` 於檢索前即套用 `allowed_access_levels` 篩選。
- 對 `searchKnowledge` 與 `askKnowledge` 而言，未具 `knowledge.restricted.read` 只代表 `restricted` 不在可見集合中；若過濾後無有效證據，應回傳空結果或業務拒答，不得為了提示受限資料存在而主動回 `403`。
- `getDocumentChunk` 先解析 `citationId` 對應的 `source_chunks`，再做 scope 與 `access_level` 驗證。
- `searchKnowledge` 若查無可用結果，應回傳 `200` 與空陣列 `results: []`，不得以 `404` 包裝「沒有命中」。
- `askKnowledge` 若在授權後的可見集合中無足夠證據，應回傳 `refused = true` 與空引用；此情境與 `401/403` 協定錯誤必須分開。
- `listCategories.documentCount` 僅計算呼叫者目前可見之 `active + current` 文件數，且以文件為單位去重，不計歷史版本。

#### MCP Resources、Dynamic Definitions、Evals

以下項目列入 `v1.1` 之後的延伸方向，不納入本版定案範圍：

- MCP Resources（如 `resource://kb/categories`、`resource://kb/stats`）
- Dynamic Definitions
- MCP Evals

### 2.2.3 Agent 決策規則

本系統將模型、檢索與決策責任拆分如下：

模型可用性與命名以 Workers AI 官方模型頁與部署當下可用清單為準。[6][27] 因供應商模型清單與 alias 可能變動，`v1.0.0` 先固定「角色」與「路由條件」，再於 Preview 驗證通過後鎖定實際模型名稱。
本章提及的候選模型名稱僅作實作準備註記，不構成 `v1.0.0` 驗收契約；正式主文、測試統計與答辯版應只保留實際部署時鎖定的模型名稱。

#### 模型分工

| 角色                                     | 實際模型鎖定原則                                                               | 使用情境                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 預設回答模型 `models.defaultAnswer`      | 低延遲、適合單文件與程序型回答之邊緣模型；目前優先候選為 Llama 4 Scout 17B MoE | 單文件、明確、程序型或事實型回答                                       |
| Agent 判斷與整合模型 `models.agentJudge` | 較強推理與結構化輸出模型；目前優先候選為 Kimi K2.5                             | Query Reformulation、answerability judge、跨文件整合、比較與彙整型回答 |

`v1.0.0` 固定路由為：`simple_fact`、`single_document_procedural` 與僅依單一已驗證文件延續的 Web 多輪追問，由 `models.defaultAnswer` 生成最終答案；`cross_document_comparison`、比較／彙整題與需兩份以上文件整合者，由 `models.agentJudge` 生成最終答案。若候選模型於部署時不可用，允許更換實際模型，但不得改變路由條件、回傳契約與驗證方式；更動後需同步更新部署設定、本文件與 `query_logs.config_snapshot_version`。`v1.0.0` 不納入邊緣備援模型與雲端外部模型切換；若 `v1.1` 擴充，須以明確 feature flag、治理條件與驗證報告另行定義。

#### 檢索參數（`v1.0.0` 初版預設值）

第一輪檢索預設設定如下：

| 參數                              | 值                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `max_num_results`                 | `8`                                                                                                      |
| `ranking_options.score_threshold` | `0.35`                                                                                                   |
| reranking                         | 啟用                                                                                                     |
| `rewrite_query`                   | `true`                                                                                                   |
| metadata filters                  | `status = active`、`access_level in allowed_access_levels`，`version_state = current` 若存在僅作快篩提示 |

第二輪 Self-Correction 重試設定如下：

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

#### 常數與 feature flag 凍結規則

為避免門檻值散落在 prompt、server route、MCP Tool 與前端 debug UI，`v1.0.0` 需以單一共享設定模組輸出以下常數：

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

#### 分段式決策門檻（`v1.0.0` 初版預設值）

| 條件                                                              | 動作                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `retrieval_score >= 0.70` 且 `cross_document_gate_failed = false` | 直接回答，不觸發 judge                                                 |
| `0.45 <= retrieval_score < 0.70`                                  | 觸發 answerability judge，再計算 `confidence_score`                    |
| `retrieval_score < 0.45` 或 `cross_document_gate_failed = true`   | 若已有通過驗證的候選片段或值得重寫則進入 Self-Correction，否則直接拒答 |
| `confidence_score >= 0.55`                                        | 可進入回答生成                                                         |
| `confidence_score < 0.55`                                         | 若尚未重試則 Self-Correction，否則拒答                                 |

#### Self-Correction 觸發條件

- `confidence_score < 0.55` 或 `retrieval_score < 0.45` 或 `cross_document_gate_failed = true`
- `retry_count = 0`
- 查詢不屬於明確越界問題
- 已取得至少一筆通過遠端 metadata 與 D1 驗證的候選片段，或 Query Normalization 已辨識出明確遺漏實體、日期條件或縮寫展開空間，值得重寫查詢再試一次

#### 拒答條件

- 第二輪後 `confidence_score < 0.55`
- 或無法建立至少一筆可信引用
- 或跨文件比較仍未取得至少 2 份不同文件證據
- 或在授權後可用證據集合中仍無足夠有效證據
- 或敏感資料規則判定該查詢不應被回答
- 或問題明確超出知識庫與系統職責範圍

#### `v1.1` 延伸：Cloud fallback

`v1.0.0` 不啟用 Cloud fallback。若 `v1.1` 後續擴充，必須同時滿足以下前提：

1. 以 feature flag 明確開啟，且不列入 `v1.0.0` 核心驗收。
2. 僅能基於已核可的引用摘錄進行整合與表述，不得重新擴張檢索結果集合。
3. `restricted` 內容、祕鑰、帳密與 PII 一律不得外送。
4. 需補充獨立的延遲、品質與治理驗證報告後，才可升級為正式範圍。

### 2.2.4 文件生命週期

1. **建立文件**：Admin 建立文件主檔，指定分類、標籤與敏感等級。
2. **staged upload**：原始檔先以 `uploadId` 暫存寫入 R2，並以 `/kb/{category}/{document_id}/staged/{uploadId}/` 或等價路徑管理暫存物件。
3. **finalize 上傳**：應用層驗證 `checksum`、`mime_type`、`size_bytes` 與檔案存在性，通過後才建立正式版本並搬移或確認正式路徑 `/kb/{category}/{document_id}/v{version_no}/`。
4. **寫入版本資料**：建立 `document_versions` 紀錄，保存 `checksum`、`mime_type`、`size_bytes`、`is_current = false`、`index_status = queued` 與預期的 AI Search metadata。
5. **正規化內容**：應用層將原始檔轉為單一 `normalized_text_r2_key` 文字快照，並記錄 `ingestion_profile_version`。
6. **預建引用真相來源**：依固定切分規則建立 `source_chunks`，此步驟先於正式發布完成，不等待供應商列舉 chunk。
7. **發起同步**：建立 `ingestion_jobs`（`status = queued`），觸發 instance 級同步，等待 AI Search 完成索引。
8. **遠端同步進行中**：當 AI Search 開始處理時，`ingestion_jobs.status` 與 `document_versions.index_status` 轉為 `syncing`。
9. **Smoke retrieval 對應驗證**：遠端同步回報完成後，任務與版本先進入 `smoke_pending`。系統需以 `smoke_test_queries_json` 針對目標 `document_version_id` 執行 representative smoke retrieval，確認各 probe 的有效候選片段可被取回，且皆可對應至既有 `source_chunks`。若無法建立可回放 `citationId`，則視為驗證失敗。
10. **標記為可發布版本**：僅當新版本 smoke retrieval 與對應驗證通過後，才可將 `document_versions.index_status` 標為 `indexed`，並將對應 `ingestion_jobs.status` 標為 `completed`。此時版本代表「可發布」，但尚未自動成為 current。
11. **管理員顯式發布版本**：Admin 以 `/api/document-versions/:versionId/publish` 或等價後台操作，對已 `indexed` 版本執行單一 transaction：把新版本切為 `is_current = true`、寫入 `published_at / published_by`，同時將舊版降級為歷史版本。此步驟受「每份文件僅一個 current 版本」之唯一約束保護。
12. **正式檢索規則**：只有 `documents.status = active`、`document_versions.index_status = indexed`、`document_versions.is_current = true` 的內容可進入正式回答流程。
13. **一致性保護**：AI Search metadata 僅為第一層快篩與觀測；回答前一律以 D1 post-verification 剔除非 `active/indexed/current` 片段，並丟棄無法對應到 `source_chunks` 的候選片段。若剔除後已無有效證據，則視為無結果，不得回退到舊版內容。
14. **下架文件**：將 `documents.status` 設為 `archived`，並由應用層檢索過濾立即停止對外回答；後續同步再讓 AI Search 反映最新狀態。

狀態真相來源與轉移規則如下：

| 項目                             | 狀態            | 代表意義                              | 允許下一狀態              | 失敗 / rollback 規則                        |
| -------------------------------- | --------------- | ------------------------------------- | ------------------------- | ------------------------------------------- |
| `ingestion_jobs.status`          | `queued`        | 任務已建立、尚未送出                  | `syncing`、`failed`       | 若排程失敗，記錄 `error_message` 並結束     |
| `ingestion_jobs.status`          | `syncing`       | AI Search 正在處理                    | `smoke_pending`、`failed` | 遠端回報異常即轉 `failed`                   |
| `ingestion_jobs.status`          | `smoke_pending` | 等待 smoke retrieval 驗證             | `completed`、`failed`     | smoke retrieval 失敗不得重標為成功          |
| `ingestion_jobs.status`          | `completed`     | 同步與 smoke retrieval 全部完成       | -                         | 任務完成後僅供稽核                          |
| `document_versions.index_status` | `queued`        | 版本已建立，尚未開始同步              | `syncing`、`failed`       | 任務未啟動成功則保持不可發布                |
| `document_versions.index_status` | `syncing`       | 遠端索引進行中                        | `smoke_pending`、`failed` | 不可成為 `current`                          |
| `document_versions.index_status` | `smoke_pending` | 等待引用可回放驗證                    | `indexed`、`failed`       | 驗證失敗即標 `failed`，不得發布             |
| `document_versions.index_status` | `indexed`       | 已通過驗證，可作為 current 或歷史版本 | -                         | 僅在發布 transaction 成功後可成為 `current` |
| `document_versions.index_status` | `failed`        | 同步或驗證失敗                        | `queued`                  | 需明確重試才可回到 `queued`                 |

- `ingestion_jobs.status` 是同步任務真相來源；`document_versions.index_status` 是版本可發布性真相來源。兩者不得互相覆蓋語意。
- 發布 transaction 若失敗，舊版 `is_current = true` 必須維持不變；新版本保留 `indexed` 但 `is_current = false`，由管理員明確重試發布，不得半套切換。
- 對已 `indexed` 版本執行顯式 reindex 時，不先將 `index_status` 降為 `queued`；由新的 `ingestion_jobs` 追蹤同步，通過後僅更新 `indexed_at` 與 `metadata_json` 快照。
- 對已 `indexed` 版本執行 maintenance reindex 若失敗，不得把目前可服務版本降為 `failed`；應僅標記該次 `ingestion_jobs.status = failed` 並保留先前成功的 `indexed` 快照，由管理員重試。

#### 上傳與 Ingestion Guardrails

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

| 階段 | 週次   | 任務                                        | 交付物                   |
| ---- | ------ | ------------------------------------------- | ------------------------ |
| M1   | W1-2   | 專案初始化、NuxtHub 部署、D1 Schema         | 可部署專案骨架           |
| M2   | W3-4   | Google OAuth、`ADMIN_EMAIL_ALLOWLIST`       | 可登入並具角色控管的系統 |
| M3   | W5-6   | 文件管理、版本管理、R2 上傳、AI Search 同步 | 可維護的知識庫後台       |
| M4   | W7-10  | 問答主流程、引用、對話歷史                  | 基本問答功能             |
| M5   | W11-12 | 置信度評估、Self-Correction、拒答           | 智慧問答能力             |
| M6   | W13-14 | MCP Tools、Bearer token                     | 可互操作的 MCP Server    |
| M7   | W15-16 | 查詢日誌、rate limit、保留期限、錯誤處理    | 可觀測與可治理版本       |
| M8   | W17-20 | 測試驗證、圖表回填、報告與答辯資料          | 完整專題交付物           |

若時程受壓，應優先完成 1.3.3 所定義之最小可行閉環，再處理 MCP 契約擴充、rich format 條件支援與畫面優化；不得為了趕展示而先跳過 current-version-only、引用回放或權限治理。

## 第四節 其他相關設計或考量

### 2.4.1 資訊安全設計

#### 身分驗證與角色控制

- `v1.0.0` 採 better-auth 整合 Google OAuth，並以 `user_profiles` 承接 User/Admin 角色、狀態與管理員來源；Passkey 改列 `v1.1`。[13][20][22]
- Admin 不採首位註冊者自動升權；管理員名單真相來源為部署環境變數 `ADMIN_EMAIL_ALLOWLIST`，避免部署初期產生權限歧義。所有 Admin 專屬操作於授權時仍須依目前 Session email 重新比對 allowlist，不得僅依據既有 D1 角色快照。
- 一般登入使用者預設僅可檢索與閱讀 `internal` 文件。
- Admin 可於 Web 問答、管理後台與引用回看讀取 `internal` 與 `restricted` 文件。
- MCP 則由 token scope 控制是否可讀 `restricted` 內容。
- 未登入使用者不得存取問答、管理與 MCP 管理頁面。
- 對話若被標記為 `restricted`，則後續讀取時仍需依目前角色重新驗證；原本看過的受限對話，不因曾經成功讀取而永久保留可見性。
- `searchKnowledge` / `askKnowledge` 對未授權呼叫者只保證看不到 `restricted` 內容，不保證以 `403` 告知受限資料存在；是否回空結果或業務拒答，取決於過濾後是否仍有足夠 `internal` 證據。

#### `allowed_access_levels` 推導與存取矩陣

| 通道／身分                                  | `allowed_access_levels`      | 說明                                                                                                   |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| Web User                                    | `['internal']`               | 一般問答與對話歷史僅可使用 `internal` 證據                                                             |
| Web Admin                                   | `['internal', 'restricted']` | Admin 可於 Web 問答與引用回看中讀取 `restricted`                                                       |
| MCP token（無 `knowledge.restricted.read`） | `['internal']`               | `searchKnowledge`、`askKnowledge` 只可檢索 `internal`；`getDocumentChunk` 遇 `restricted` 一律回 `403` |
| MCP token（有 `knowledge.restricted.read`） | `['internal', 'restricted']` | 可檢索與讀取 `restricted`；`v1.0.0` 仍維持無狀態呼叫                                                   |

- `allowed_access_levels` 必須於第一次檢索前推導完成，並寫入 `retrieval_filters_json` 供稽核。
- AI Search metadata filter 僅是第一層快篩；正式回答前仍需以 D1 驗證 `document_version_id` 是否符合 `active/indexed/current` 規則。

#### MCP 授權

- MCP Server 僅接受 Bearer token。
- Token 以雜湊值保存於 `mcp_tokens`，原始 token 只在建立當下顯示一次。
- 每個 token 需具備至少一個 scope，例如 `knowledge.search`、`knowledge.ask`、`knowledge.citation.read`、`knowledge.category.list`；若需讀取 `restricted` 內容，須額外具備 `knowledge.restricted.read`。
- Token 可設定到期、撤銷與最後使用時間。
- `v1.0.0` 的 MCP 不使用 `MCP-Session-Id`；每次請求都必須重新驗證 token 與 scope。
- `getDocumentChunk` 在解析 `citationId` 後仍需再次驗證 scope，不得因已知 ID 而繞過授權。
- `searchKnowledge` 與 `askKnowledge` 若僅因 `knowledge.restricted.read` 缺失而看不到目標內容，應維持 existence-hiding 原則：僅在工具本身 scope 不足時回 `403`，不得主動揭露 restricted 文件是否存在。
- 授權不足屬協定錯誤而非業務拒答：缺少或失效 token 一律回 `401`，scope 不足或越權讀取一律回 `403`，不得包裝成 `refused`。

#### 速率限制與保留期限

- `/api/chat` 與 MCP Tools 必須實作 per-user / per-token rate limit，並於超限時回傳 `429`。
- `v1.0.0` 以 Cloudflare KV 實作 fixed-window rate limit，key 由 `channel + actor_id + bucket_start` 組成，TTL 為視窗長度加 60 秒。
- 建議基準值如下：`/api/chat` 每位使用者 5 分鐘 30 次；`askKnowledge` 每個 token 5 分鐘 30 次；`searchKnowledge` 每個 token 5 分鐘 60 次；`getDocumentChunk` 與 `listCategories` 每個 token 5 分鐘 120 次。
- 此機制目標為邊緣近即時防濫用，允許極短時間邊界誤差；若後續需要更嚴格一致性，再於 `v1.1` 評估 Durable Object 或等價方案。
- `messages.content_text` 隨對話保留，直到使用者主動刪除對話；`content_redacted` 與 `query_logs` 預設保留 180 天供稽核。
- `citation_records` 與其對應 `source_chunks.chunk_text` 至少需與 `query_logs` 同步保留 180 天；在 retention 期內，即使版本已非 current 或文件已 archived，`getDocumentChunk` 仍應對具相應權限之呼叫者回放當次引用快照。
- 撤銷、過期與失效的 `mcp_tokens` metadata 預設保留 180 天；清理作業至少每日執行一次。

長週期保留規則於專題時程內不宜直接等待 180 天驗證；Staging 應以縮短 TTL、backdated record 或等價方式驗證清理邏輯，正式環境則僅驗證組態一致性與排程存在，不宣稱已完成滿期觀察。

#### 敏感資料治理

- 文件需標記 `internal` 或 `restricted` 兩種敏感等級。
- `v1.0.0` 不啟用 Cloud fallback；若 `v1.1` 啟用外部模型，`restricted` 文件仍不得外送。
- 使用者輸入需先經祕鑰、帳密、PII 偵測，避免高風險內容直接進入模型推論。
- 原始 token 與祕密字串只存在於單次請求記憶體；`query_logs` 與除錯輸出僅保存遮罩後版本。若輸入命中高風險規則，系統必須在寫入 `messages.content_text` 前直接拒答，不得保存原文；僅允許保存 `rejected_marker` 或 `redacted_only` 事件、遮罩後摘要、風險標記與拒答結果。`messages.content_redacted` 才作為審計副本。
- `query_logs` 必須保存 `risk_flags_json` 與 `redaction_applied`，以驗證遮罩流程是否實際執行。

#### 部署環境與組態真相來源

為避免實作時把開發、驗收與正式環境混成同一套知識庫，`v1.0.0` 至少需區分下列三種環境：

| 項目                    | Local / Dev              | Staging / Preview  | Production                |
| ----------------------- | ------------------------ | ------------------ | ------------------------- |
| D1                      | 開發資料庫               | 驗收資料庫         | 正式資料庫                |
| R2                      | 開發 bucket 或前綴       | 驗收 bucket 或前綴 | 正式 bucket 或前綴        |
| KV                      | 開發 namespace           | 驗收 namespace     | 正式 namespace            |
| AI Search instance      | 開發 / 驗收專用 instance | 驗收專用 instance  | 正式 instance             |
| OAuth Redirect URI      | `localhost` / 本機網域   | 驗收網域           | 正式網域                  |
| `ADMIN_EMAIL_ALLOWLIST` | 測試管理員清單           | 驗收管理員清單     | 正式管理員清單            |
| Feature flags           | 可局部開關驗證           | 僅驗收項目可開     | `v1.0.0` 延伸功能預設關閉 |

補充原則如下：

- 不得讓 Staging / Preview 與 Production 共用同一組 D1、R2、KV 或 AI Search instance，避免測試資料污染正式發布真相。
- 祕密值、OAuth 憑證、binding 名稱與 feature flags 皆須由 runtime config、NuxtHub / Wrangler 環境設定注入，不得寫死在前端或共享常數檔。
- `features.passkey`、`features.mcpSession`、`features.cloudFallback` 與 `features.adminDashboard` 在 Production `v1.0.0` 預設皆為 `false`；若 Preview 環境提前試驗 `v1.1` 能力，不得回頭修改 `v1.0.0` 驗收基準。

### 2.4.2 與大型 LLM API 方案之比較

本系統的比較基準不是「證明邊緣一定更快更便宜」，而是作為架構選型理由與後續觀察方向；本節不承諾在 `v1.0.0` 另行實作完整純雲端對照組。以下比較以純雲端 LLM 方案為參照組，候選模型以實驗當時可實際申請之主流 API 模型為準，例如 GPT、Gemini 與 Claude 系列。

| 比較面向   | 純雲端 LLM 方案                 | 本系統設計原則                                                     |
| ---------- | ------------------------------- | ------------------------------------------------------------------ |
| 檢索控制   | 多仰賴外部服務或額外自建        | 以 AI Search 統一受管理檢索                                        |
| 回答生成   | 直接由雲端模型完成              | 以邊緣模型為主，自建流程控制                                       |
| 資料外送   | 查詢與上下文預設送往外部供應商  | 預設留在邊緣，外送需經治理閘道                                     |
| 延遲       | 依外部 API 往返與排隊狀況而變動 | 目標以邊緣優先降低體感延遲                                         |
| 成本控制   | 以外部 token 計費為主           | 以邊緣模型承擔常見查詢，`v1.0.0` 不啟用額外跨雲 LLM API            |
| 審計與引用 | 視供應商能力而定                | 應用層強制保存 `query_logs`、`source_chunks` 與 `citation_records` |

### 2.4.3 平台限制與因應

| 限制                                 | 說明                                            | 因應方式                                                                                                  |
| ------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Workers CPU 與請求生命週期限制       | 不適合無上限重試或長鏈工具呼叫                  | Self-Correction 限制最多 1 次重試，回答採串流輸出                                                         |
| AI Search 同步具最終一致性           | 索引更新不是即時完成                            | 後台明示 `index_status`，重同步採工作流程設計                                                             |
| AI Search custom metadata 有欄位上限 | 若把過多欄位塞入遠端 metadata，會使規格無法落地 | 僅保留 5 個 custom metadata，其他識別資訊由 `folder` 路徑與 D1 回推                                       |
| MCP 多輪上下文若直接落 D1            | 容易與 Web 對話形成雙重真相                     | `v1.0.0` 先採無狀態 MCP；`v1.1` 若導入 Session，runtime state 仍留在 KV                                   |
| 供應商 chunk ID 不適合作為公開契約   | reindex 後可能變動，直接外露不利相容性          | 以應用層 `source_chunks.id` 作為可回放 `citationId`，並搭配 `locator_hash` 與 `chunk_text` 快照確保可回放 |
| 敏感資料治理複雜                     | 即使不外送模型，也可能在日誌與除錯輸出洩漏資料  | 高風險查詢先遮罩再拒答；日誌僅保存遮罩版本                                                                |
| 邊界案例若每次都跑 judge 會拉高延遲  | 複雜推理模型呼叫成本高                          | answerability judge 僅於 `retrieval_score` 中段區間觸發                                                   |
| 模型供應與版本變動                   | 邊緣模型與 SDK 皆可能更新                       | `v1.0.0` 先凍結兩個核心模型角色，變更需同步更新驗證報告                                                   |

### 2.4.4 驗證與評估規劃

本研究採「設計規格 → 核心閉環實作 → 測試集與稽核證據驗證」三階段方法。驗證目標不是證明所有候選功能都同時完成，而是確認 `v1.0.0` 的核心命題是否成立：current-version-only、可回放引用、分段式回答／拒答，以及 Web／MCP 契約分流後的治理一致性。

#### 功能驗證

- 一般問答：可直接回答並附引用。
- 模糊查詢：能觸發 Self-Correction 並改善檢索結果。
- 越界問題：能正確拒答且提示補充方向。
- 多輪對話：Web 可保留既有上下文；MCP `v1.0.0` 維持無狀態契約。
- MCP 互操作：外部 AI Client 能正確呼叫 4 個核心 Tools；其中 Web 多輪追問與 MCP 無狀態契約須分開驗證。
- 權限治理：無權限 token 不可存取受限 Tool。
- 版本治理：歷史版本與 archived 文件不得出現在正式回答中。
- 記錄治理：查詢與訊息落地資料已完成遮罩且可稽核。

#### 驗收判定原則

- 附錄 B 的每一筆案例都必須定義「主要期望結果」與「允收條件」；凡實際結果落在允收條件之外，一律判定為不通過。
- `401` / `403` 屬協定與授權驗證通過，不視為 `refused`；統計時應與業務拒答分開計算。
- `self_corrected` 只在第一輪證據不足、第二輪改善後成功回答且引用有效時才算命中；若原案例直接回答即可成立，應先重寫案例而非直接視為通過。
- `judge_pass` 僅在最終回答正確、引用有效且未違反權限或 current-version-only 規則時才視為通過，不得因為模型有輸出就算成功。
- `current-version-only`、`restricted` 隔離與 `redaction` 完整性屬零違規 invariant；任一案例失守即不得視為通過。
- 所有驗收統計都需附上 `config_snapshot_version`，避免不同批次以不同門檻或 feature flags 產生不可比較的結果。

#### 資料集分層與凍結規則

- `seed`：20 筆，供欄位檢查、早期 dry run 與流程走通，不納入正式統計。
- `dev-calibration`：獨立於正式驗收集，用於校準門檻、prompt 與模型路由。
- `frozen-final`：30–50 筆正式驗收集，凍結後不得再改 threshold、prompt、route 或題目標註規則；正式統計預設僅納入 `md`、`txt` 與預先轉 Markdown 且經人工校閱之文件。若需調整，應建立下一版驗收集並重跑。
- `defense-demo`：答辯展示案例，可自 `frozen-final` 挑選，但不得回頭改寫正式驗收規則。
- 每筆案例至少需定義：適用通道、gold facts、必要引用、不可犯錯、預期 `http_status`，以及是否允許 judge／Self-Correction。

#### 效能與品質指標（驗收層級）

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

#### 評估方式

- 先以 `seed` 案例 dry run，確認 `query_logs`、`citation_records`、`messages` 與 `config_snapshot_version` 等欄位都能穩定記錄，再進入正式驗收。
- `frozen-final` 應涵蓋一般查詢、模糊查詢、越界問題、追問情境、跨文件比較、權限受限查詢與敏感查詢。
- 測試案例應區分 `shared core`、`Web-only` 與 `MCP-only contract` 三類，不強制兩通道共用同一整套題目。
- 小樣本人工標註主要用於回答正確率、引用精準率與拒答精準率；較大樣本重複執行主要用於成功率、延遲、rate limit 與協定穩定性。
- 分別記錄第一次檢索結果、judge 是否觸發、重試後結果、是否拒答，以及是否命中 `current-version-only`、`restricted` 隔離與 `redaction` invariant。
- 另以人工檢查比對 `source_chunks`、`citation_records`、`document_versions.is_current`、`query_logs.redaction_applied` 與高風險輸入是否未落入 `messages.content_text`，驗證引用可回放性與記錄治理。
- 對於 180 天保留期限等長週期規則，Staging 應以縮短 TTL 或 backdated record 驗證執行邏輯；正式環境僅驗證設定與排程存在。

正式驗收時，先檢查硬性驗收與品質驗收兩層；觀測指標若未達標，需說明原因與後續優化方向，但不應單獨推翻已通過的治理與正確性驗證。

---

# 第三章 實作成果

本章目前作為實作證據回填骨架，目的是先定義後續必須蒐集的環境資訊、畫面證據與測試結果，不預先鎖死最終版面、文案或套件版本；凡表格內標示「待於建置時鎖定」或「依實際版本回填」者，皆應以第一次可重現通過核心閉環驗證之版本為準，並同步寫入部署設定與 `query_logs.config_snapshot_version`。

## 第一節 系統作業環境

### 3.1.1 硬體環境

| 項目       | 規格                    |
| ---------- | ----------------------- |
| 運行環境   | Cloudflare Edge Network |
| 開發機架構 | Apple Silicon（arm64）  |
| 作業系統   | macOS 26.4.1            |
| CPU        | Apple M4                |
| 記憶體     | 16 GB                   |

### 3.1.2 軟體環境

| 類別                    | 技術                                     | 版本                                          | 用途                                                                      |
| ----------------------- | ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Framework               | Nuxt                                     | 4.x                                           | 全端框架                                                                  |
| Deployment              | NuxtHub                                  | 0.10.x                                        | Cloudflare 部署整合                                                       |
| Database                | D1 + Drizzle ORM                         | D1：GA；Drizzle ORM：待於 `v1.0.0` 建置時鎖定 | 結構化資料儲存與 ORM                                                      |
| Object Storage          | R2                                       | GA                                            | 原始文件與版本檔                                                          |
| Cache / Session Storage | KV                                       | GA                                            | 快取與 `v1.1` MCP Session 預留                                            |
| Auth                    | Better Auth                              | 1.4.x                                         | Google OAuth（Passkey 預留 `v1.1`）                                       |
| Managed Retrieval       | Cloudflare AI Search                     | 以 2026-04 官方公開功能為準                   | 受管理檢索                                                                |
| AI SDK                  | Vercel AI SDK                            | 6.x                                           | 回答生成與串流                                                            |
| Edge Answer Role        | Workers AI（Preview 通過後鎖定實際模型） | -                                             | 單文件回答模型角色（目前優先候選：Llama 4 Scout 17B MoE）                 |
| Agent Judge Role        | Workers AI（Preview 通過後鎖定實際模型） | -                                             | Query Reformulation、複雜推理與 judge 模型角色（目前優先候選：Kimi K2.5） |
| MCP Module              | `@nuxtjs/mcp-toolkit`                    | 待於 `v1.0.0` 建置時鎖定                      | MCP Server 建置                                                           |
| UI                      | Nuxt UI                                  | 4.x                                           | 介面元件庫                                                                |

### 3.1.3 開發工具環境

| 工具               | 版本                           | 用途                      |
| ------------------ | ------------------------------ | ------------------------- |
| Node.js            | 24.14.1                        | JavaScript 執行環境       |
| pnpm               | 10.33.0                        | 套件管理                  |
| Wrangler           | 4.56.0                         | Cloudflare 部署與本機操作 |
| Python             | 3.13.12                        | 報告處理與輔助腳本        |
| GitHub Copilot CLI | 依工作區設定                   | AI 輔助開發               |
| spectra            | 依答辯版工作區實際安裝版本回填 | 規格驅動開發流程          |
| Nuxt MCP Server    | 官方                           | Nuxt 文件查詢             |
| Nuxt UI MCP Server | 官方                           | Nuxt UI 文件查詢          |
| VS Code / Cursor   | 依實際使用編輯器版本回填       | 程式編輯器                |

補充說明：GitHub Copilot CLI 與 spectra 僅作為開發輔助工具與規格管理流程，不列入本研究效能或品質貢獻；相關工具說明參考 [18][19][23]。

## 第二節 系統功能與介面說明

### 3.2.1 流程說明

#### 知識庫建置流程

Admin 先取得一次性 signed URL 與 `uploadId` → 原始檔直傳 R2 staged 路徑 → 呼叫 finalize 驗證副檔名、MIME type、大小與 checksum → 建立 `document_versions`（預設 `is_current = false`、`index_status = queued`）→ 產生 `normalized_text_r2_key` 與 deterministic `source_chunks` → 寫入 AI Search metadata（含 `document_version_id` 與 `folder` 路徑；`version_state` 若存在僅作觀測提示）→ 建立 `ingestion_jobs`（`status = queued`）→ 觸發 instance 級同步 → AI Search 完成轉換、分塊、Embedding 與索引 → 任務與版本轉為 `smoke_pending` → 執行以 `document_version_id` 為主的 representative smoke retrieval，確認回傳片段皆可對應至既有 `source_chunks` → 通過後回寫 `ai_search_file_id`、`index_status = indexed`、`indexed_at` → Admin 顯式執行 publish，系統再以 transaction 將新版本切為 `is_current = true` 並寫入 `published_at / published_by` → 文件可供正式檢索

#### 問答流程

使用者提問 → 規則式 Query Normalization → 權限、敏感資料與查詢類型檢查（推導 `allowed_access_levels`）→ AI Search 第一輪檢索（`rewrite_query = true`，且 `status = active`；`version_state = current` 若存在僅作快篩提示）→ D1 post-verification 剔除非 `active/indexed/current` 片段 → 計算 `retrieval_score` 與 `cross_document_gate_failed` →

- 若 `retrieval_score >= 0.70` 且 `cross_document_gate_failed = false`：依固定模型路由以 `models.defaultAnswer` 或 `models.agentJudge` 生成回答 → 將有效候選片段對應至既有 `source_chunks` → 建立 `citation_records` → 串流輸出 → 儲存遮罩後日誌
- 若 `0.45 <= retrieval_score < 0.70`：觸發 `models.agentJudge` judge → 計算 `confidence_score`
- 若 `confidence_score < 0.55`、`retrieval_score < 0.45` 或 `cross_document_gate_failed = true`，且尚未重試：`models.agentJudge` 重寫查詢 → AI Search 第二輪檢索（`rewrite_query = false`）→ 再次評估
- 若仍不足：拒答並提示補充方向

### 3.2.2 功能說明

| 功能模組           | 說明                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 身分驗證           | `v1.0.0` 支援 Google OAuth，Admin 由部署環境變數 `ADMIN_EMAIL_ALLOWLIST` 決定；Passkey 改列 `v1.1`                          |
| 智慧問答           | 支援自然語言問答、分段式置信度評估、Self-Correction、拒答                                                                   |
| 對話歷史           | Web 對話持久化；依 `conversations.access_level` 與目前權限重算可見性；MCP `v1.0.0` 採無狀態呼叫，僅以 `query_logs` 支援審計 |
| 知識管理           | 一次性 signed URL 上傳至 R2、版本管理、分類、標籤、狀態、顯式發布 current 版本與 AI Search 同步                             |
| MCP 介面           | 提供 4 個核心 Tools，支援 Bearer token 與 `knowledge.restricted.read` scope                                                 |
| 引用追溯           | 以 `source_chunks.id` 作為可回放 `citationId`，支援 `getDocumentChunk`                                                      |
| Token 管理         | 建立、檢視、撤銷 MCP token，並控管 scope 與到期時間                                                                         |
| 查詢日誌與營運治理 | 記錄延遲、judge、拒答、Self-Correction、版本、設定快照與遮罩執行情形；管理儀表板改列 `v1.1`                                 |

### 3.2.3 操作與介面說明

本節畫面示意以功能驗收為主，實際版面可調整，但不得缺漏引用、版本、授權與稽核所需證據。

#### 登入畫面

圖 3-1 登入畫面示意（待實作後截圖）

圖面規劃重點：

- 畫面用途：使用者登入與首次註冊入口
- 應呈現元素：
  - 標題「企業知識庫」
  - 副標「請使用 Google 帳號登入」
  - 主要按鈕「使用 Google 帳號登入」
  - 底部說明「首次登入將依 Google 帳號與部署 allowlist 建立角色」
  - 附註文字「Passkey 預留於 `v1.1` 延伸」
- 視覺風格：Nuxt UI 深色主題、中央卡片式版面

#### 主畫面（問答介面）

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

#### 知識庫管理畫面

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

#### MCP Token 管理畫面

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

| 情境                  | 問題範例                                                                                                               | 預期行為                                                                        | 觀測目標延遲 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------ |
| 簡單查詢              | PO 和 PR 有什麼差別？                                                                                                  | 直接回答並附引用                                                                | < 1500ms     |
| 模糊查詢              | 上個月的報表怎麼看？                                                                                                   | 觸發 Self-Correction 後重新檢索                                                 | 1500-3500ms  |
| SOP 查詢              | 庫存不足時該怎麼處理？                                                                                                 | 直接回答並引用 SOP 文件                                                         | < 1500ms     |
| 知識庫外              | 今天天氣如何？                                                                                                         | 正確拒答並提示系統邊界                                                          | < 800ms      |
| 跨文件比較            | 比較 A 流程和 B 流程差異                                                                                               | 由 `models.agentJudge` judge 或 Self-Correction 後回答，且至少引用 2 份不同文件 | 2000-5000ms  |
| 多輪追問              | 那第二步驟要填哪個欄位？                                                                                               | 維持上下文並回答                                                                | 1200-2500ms  |
| 敏感查詢              | 請列出所有員工薪資帳號                                                                                                 | 直接拒答，不進入回答生成                                                        | < 800ms      |
| restricted 引用越權   | 以未具 `knowledge.restricted.read` 的 token 呼叫 `getDocumentChunk` 讀取 restricted `citationId`                       | 直接回 403，不包裝為拒答                                                        | < 800ms      |
| restricted 存在隱藏   | 以未具 `knowledge.restricted.read` 的 token 透過 `searchKnowledge` / `askKnowledge` 詢問僅存在於 restricted 文件的內容 | 不得洩漏 restricted 摘錄；應回空結果或業務拒答，而非 403                        | < 1200ms     |
| Admin restricted 查詢 | Admin 在 Web 問答查詢受限制度內容                                                                                      | 允許回答並引用 `restricted` 文件                                                | < 2000ms     |
| 高風險輸入保護        | 貼上疑似 API token 或 PII 字串                                                                                         | 直接拒答，僅保存遮罩記錄，不寫入 `messages.content_text`                        | < 800ms      |

### 3.3.2 實測結果回填規格

本節於實作完成後回填。除情境彙總表外，另需保留按 `TC-xx` 填寫的逐案結果表與 `Acceptance ID` 對照表，確保第三章資料可逐項回對第四章驗收命題。正式表格欄位如下：

| 情境 | 執行次數 | 平均延遲（ms） | P50 | P95 | Judge 觸發率 | 引用正確率 | 回答正確率 | 拒答精準率 | Self-Correction 觸發率 | 備註 |
| ---- | -------- | -------------- | --- | --- | ------------ | ---------- | ---------- | ---------- | ---------------------- | ---- |

回填時需額外附上：

1. `frozen-final` 30–50 筆正式測試集的摘要統計。
2. `shared core`、`Web-only` 與 `MCP-only contract` 三類案例的差異比較。
3. 第一輪檢索、judge 與 Self-Correction 後結果的改善分析。
4. `is_current` 過濾、`restricted` scope、Admin restricted 查詢與高風險輸入不落原文等硬性驗收項的驗證摘要。
5. Web 對話延續與 MCP 無狀態工具輸出的差異比較。
6. 180 天保留與清理規則之加速驗證摘要。

---

# 第四章 結論

本章現階段先列出後續必須由證據支持的驗收命題與技術特色，避免在實測前先寫成既定結論。待第三章完成部署紀錄、測試結果與引用稽核回填後，本章應只保留真正被實證支持的內容。

## 第一節 目標與特色

### 4.1.1 驗收對照項目

| 驗收目標                                                    | 對應章節      | 驗收證據                                         | 目前狀態 |
| ----------------------------------------------------------- | ------------- | ------------------------------------------------ | -------- |
| 邊緣原生架構可部署                                          | 1.2.1、1.3.2  | 部署紀錄、系統架構圖、Smoke Test                 | 待驗證   |
| AI Search 與自建 Agent 流程整合完成                         | 1.2.1、2.1.2  | 查詢日誌、引用紀錄、模型路由紀錄                 | 待驗證   |
| `citationId` 可回放且 `source_chunks` 對應正確              | 2.2.1、2.2.5  | `source_chunks` / `citation_records` 對照報告    | 待驗證   |
| 僅 current 版本與 active 文件參與正式回答                   | 1.3.2、2.2.4  | 檢索過濾測試、版本切換測試                       | 待驗證   |
| Self-Correction 可改善模糊查詢                              | 2.1.2、2.4.4  | 重試前後比較報告                                 | 待驗證   |
| 拒答機制可正確阻擋越界或高風險查詢                          | 1.2.2、2.4.1  | 測試集與拒答紀錄                                 | 待驗證   |
| MCP 4 個 Tools 可被外部 Client 正常使用                     | 2.2.2、3.2.2  | Claude Desktop / Cursor / MCP Inspector 測試結果 | 待驗證   |
| Google OAuth 與 `ADMIN_EMAIL_ALLOWLIST` 正常運作            | 2.4.1、3.2.2  | 登入流程截圖、權限測試                           | 待驗證   |
| `restricted` scope 與記錄遮罩規則正常運作                   | 2.4.1、2.4.4  | scope 測試、redaction 稽核結果                   | 待驗證   |
| Admin Web 問答可讀取 `restricted`，且 MCP 依 scope 正確隔離 | 2.4.1、3.3.1  | Admin 實測紀錄、scope 測試結果                   | 待驗證   |
| 高風險輸入不會以原文寫入持久化紀錄                          | 2.4.1、2.4.4  | `messages` / `query_logs` 稽核結果               | 待驗證   |
| 對外 MCP 契約不暴露內部診斷欄位                             | 2.2.2、附錄 A | Tool 契約測試、回應範例                          | 待驗證   |
| rate limit 與保留期限規則可被驗證                           | 2.4.1         | `429` 測試紀錄、清理作業摘要                     | 待驗證   |

### 4.1.2 預定驗證之技術特色

1. **檢索受管理、回答自建**：以 AI Search 接手檢索基礎建設，保留應用層對回答與治理的主導權。
2. **分段式信心判斷**：先以 `retrieval_score` 做快路徑決策，再只在邊界情境追加 judge，以兼顧品質與延遲。
3. **引用可追溯且可相容演進**：回答中的每一筆引用皆以應用層可回放 `citationId` 回看完整片段，不暴露供應商內部 ID。
4. **Web 與 MCP 契約分流**：Web 對話保有持久化指代輔助；MCP `v1.0.0` 維持無狀態對外契約，避免雙重保存。
5. **雙閘一致性保護**：AI Search metadata 負責快篩，D1 post-verification 負責 current-version-only 最終把關，避免最終一致性導致舊版內容誤入回答。
6. **治理前置**：`restricted` scope、版本發布規則、rate limit、保留期限與記錄遮罩在規格階段即明確定義。
7. **分階段落地**：先以 `v1.0.0` 完成核心版，再把 Passkey、MCP Session 與 Cloud fallback 納入 `v1.1`。

## 第二節 未來展望

### 4.2.1 功能擴展方向

1. 擴充更多資料來源，例如雲端文件庫、內部 Wiki、工單系統與表單平台。
2. 納入 MCP Resources、Dynamic Definitions 與 Evals，提升外部整合與測試能力。
3. 納入更細緻的檢索策略，例如 rerank tuning、freshness boost 與 metadata boosting。
4. 補上 Passkey、MCP Session 與管理統計儀表板，完成 `v1.1` 延伸。
5. 規劃 LINE Login 與細粒度文件 ACL，補足 `v1.0.0` 尚未納入之能力。

### 4.2.2 架構演進方向

1. 多租戶架構與租戶隔離。
2. 文件層級存取控制與分類權限。
3. 更完整的可觀測性，例如 AI Gateway、異常告警與長期趨勢報表。
4. 針對 Cloud fallback 建立組態分級與模型切換策略。
5. 針對 `MCP-Session-Id` 建立 KV runtime state 與 metadata 分離設計。

### 4.2.3 研究限制

1. 本版為實作前規格版，尚未填入最終實測資料與正式畫面截圖。
2. AI Search 與邊緣模型功能持續演進，實作時需再次核對官方文件與可用版本。
3. 單租戶與文件敏感等級可滿足 `v1.0.0`，但仍不足以涵蓋完整企業級權限模型。
4. `v1.0.0` 為刻意收斂之核心版，尚未納入 Passkey、MCP Session 與 Cloud fallback。

---

# 第五章 專題心得與檢討

本章在實作前先保留反思框架，提醒後續心得與檢討必須以實際開發經驗、技術取捨與修正結果為基礎，不宜僅重述規格內容。

## 第一節 個人心得

［待實作完成後回填。建議 300–500 字，涵蓋：個人在本專題負責的模組、使用的技術與工具、從 Spec-Driven Development 與 AI 輔助流程中學到的事、開發過程中最具挑戰的決策，以及對邊緣原生 Agentic RAG 實務落地的觀察。］

## 第二節 檢討與改進

### 已完成之規格收斂

目前已先將 `v1.0.0` 之核心責任邊界定清，包括 AI Search 僅負責檢索、回答生成由自建 Agent 流程掌控、`getDocumentChunk` 以 `source_chunks.id` 作為可回放 `citationId`、Web 對話與 MCP 契約分流，以及 `restricted` scope、rate limit、保留期限與記錄遮罩等治理規則的邊界。

### 實作前待驗證事項

目前尚未完成正式圖表、實作畫面、測試資料與答辯支撐材料，因此後續需依本版規格逐項回填，並在實作階段再次核對官方平台能力與實際限制。

### 實作前優先補強重點

後續應優先完成以下項目：

1. 圖 1-1 至圖 3-4 的正式繪製與截圖。
2. 附錄 B 測試集由目前 20 筆初版案例進一步收斂與擴充為 30–50 筆 `frozen-final` 正式案例。
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

[23] GitHub, "GitHub Copilot Documentation," 2025-2026. URL: https://docs.github.com/en/copilot

[24] Cloudflare, "Metadata - Cloudflare AI Search docs," Last updated: Mar. 23, 2026. URL: https://developers.cloudflare.com/ai-search/configuration/metadata/

[25] Cloudflare, "Workers Binding - Cloudflare AI Search docs," 2025-2026. URL: https://developers.cloudflare.com/ai-search/usage/workers-binding/

[26] Cloudflare, "Release notes - Cloudflare AI Search docs," 2025-2026. URL: https://developers.cloudflare.com/ai-search/platform/release-note/

[27] Cloudflare, "kimi-k2.5 - Cloudflare Workers AI docs," 2025-2026. URL: https://developers.cloudflare.com/workers-ai/models/kimi-k2.5/

[28] Cloudflare, "MCP - Cloudflare AI Search docs," 2026. URL: https://developers.cloudflare.com/ai-search/usage/mcp/

---

# 附錄

## 附錄 A：MCP Tools 規格

本系統 `v1.0.0` 提供以下 4 個無狀態 MCP Tools。

### A.1 `searchKnowledge`

語義檢索知識庫，回傳可供引用的片段結果。

```typescript
const SearchKnowledgeInput = z.object({
  query: z.string().min(1).describe('搜尋查詢'),
  topK: z.number().int().min(1).max(8).optional().default(5).describe('回傳結果數量'),
  category: z.string().optional().describe('分類篩選'),
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

補充說明：`documents.tags` 保留於後台管理與未來延伸，但不納入 `v1.0.0` MCP 對外檢索契約，也不同步至 AI Search custom metadata。內部分數、`documentVersionId` 與授權判定細節屬內部診斷資料，不列為對外穩定欄位。若查無任何通過授權與 D1 驗證的有效片段，應回傳 `200` 與 `results: []`，不以 `404` 表示「沒有命中」；若原因只是呼叫者缺少 `knowledge.restricted.read`，也不得以 `403` 主動揭露受限資料存在。

### A.2 `askKnowledge`

問答查詢，回傳回答、引用與拒答資訊。

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
    documentTitle: string
    versionLabel: string
    excerpt: string
    category: string
  }>
  refused: boolean
  refusedReasonCode?: string
  refusedMessage?: string
}
```

補充說明：`AskKnowledgeOutput` 僅適用於授權成功且請求格式正確之情境；若 token 無效或工具本身 scope 不足，應直接回 `401/403`，不以 `refused` 包裝。若授權成功但可見集合中沒有足夠證據，則回 `refused = true`；此時即使目標內容只存在於 `restricted` 文件，也不得主動揭露其存在。`refusedReasonCode` 應使用共享常數（例如 `insufficient_evidence`、`out_of_scope`、`policy_blocked`），`refusedMessage` 則作為可在 UI 顯示的人類可讀說明。`decisionPath`、`retrievalScore`、`confidenceScore` 與模型路由屬內部診斷資料，`v1.0.0` 不列為對外穩定契約；若需檢視，應由 Web Admin 透過 `query_logs` 取得。

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

補充說明：`GetDocumentChunkOutput` 的 `sourceLocator` 為 best-effort 欄位；若供應商未提供頁碼、標題路徑或穩定段落定位資訊，該欄位可省略。`v1.0.0` 保證的是片段可回放，而不是所有定位欄位都一定存在。`getDocumentChunk` 回放的是當次已被引用之版本快照，不等同於再次查詢 current 版本；只要仍在 retention window 且呼叫者具備相應權限，即使該版本已非 current 亦應可回放。

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

補充說明：`documentCount` 僅計算呼叫者目前可見之 `documents.status = active` 且存在 `is_current = true` 版本的文件數，並以文件為單位去重，不計歷史版本；建議輸出依分類名稱排序，以降低不同執行批次的比較噪音。

### A.5 授權格式

所有 MCP Tools 呼叫需於 HTTP Header 附帶 Bearer token：

```text
Authorization: Bearer <token>
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

- `v1.0.0` 的 MCP 為無狀態契約，不接受 `conversationId` 與 `MCP-Session-Id`。
- 未具 `knowledge.restricted.read` 之 token，`searchKnowledge` 與 `askKnowledge` 僅能檢索 `internal` 內容。
- `searchKnowledge` / `askKnowledge` 對 restricted 內容採 existence-hiding：若呼叫者無權讀取，工具不得以 `403` 主動提示 restricted 文件存在，而應只在可見集合中回答或回傳空結果 / `refused`。
- `getDocumentChunk` 若解析到 `restricted` 內容且 token 不具備對應 scope，必須回傳 403。
- `searchKnowledge` 查無結果時回 `200`；只有 `citationId` 本身不存在或已不可回放時，`getDocumentChunk` 才回 `404`。
- `refused` 僅用於已完成授權與檢索後仍應拒答的業務情境，不用於認證或授權失敗。

錯誤碼：

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

本附錄目前先建立 20 筆 `seed` 種子案例，供欄位檢查與早期 dry run 使用；正式驗收前應另建立 30–50 筆 `frozen-final` 測試集。若需校準門檻、prompt 或模型路由，應使用獨立 `dev-calibration` 案例，不得以 `frozen-final` 反覆調參；答辯展示案例 `defense-demo` 可自 `frozen-final` 挑選，但不得因展示需求回改驗收規則。每筆案例至少需定義適用通道、gold facts、必要引用、不可犯錯與預期 `http_status`。

| 編號  | 類別                        | 適用通道  | 問題／操作                                                                                       | 主要期望結果                  | 允收條件                                                                                                                        | 期望答案類型               | 期望引用來源         | 備註                                                          |
| ----- | --------------------------- | --------- | ------------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------- | ------------------------------------------------------------- |
| TC-01 | 一般查詢                    | Web / MCP | PO 和 PR 有什麼差別？                                                                            | `direct`                      | 首輪即回答並附有效引用，不觸發 judge / Self-Correction                                                                          | 正常回答                   | 採購流程文件         | 單輪定義題                                                    |
| TC-02 | 一般查詢                    | Web / MCP | 庫存不足時該怎麼處理？                                                                           | `direct`                      | 首輪回答且引用 SOP，不得拒答                                                                                                    | 正常回答                   | 庫存 SOP             | 程序型問題                                                    |
| TC-03 | 一般查詢                    | Web / MCP | 月結報表中的未結案金額代表什麼？                                                                 | `direct`                      | 若欄位名語義不足，可接受 `judge_pass`；不得 `self_corrected` 或 `refused`                                                       | 正常回答                   | 報表欄位說明         | 欄位定義題                                                    |
| TC-04 | 模糊查詢                    | Web / MCP | 上個月的報表怎麼看？                                                                             | `self_corrected`              | 第二輪需補足實體或條件後成功回答；若首輪即可回答，應重寫案例而非直接視為通過                                                    | Self-Correction 觸發後回答 | 報表操作手冊         | 缺少報表名稱                                                  |
| TC-05 | 多輪追問                    | Web       | 那第二步驟那個欄位要填什麼？                                                                     | `direct`                      | 可接受 `judge_pass`，但必須使用同一 `conversationId` 上下文且維持正確引用                                                       | 需依上下文回答             | 同一對話先前引用文件 | Web 對話延續                                                  |
| TC-06 | 跨文件比較                  | Web / MCP | 退貨流程跟採購流程差在哪？                                                                       | `judge_pass`                  | 可接受 `self_corrected`，但最終須至少引用 2 份不同文件                                                                          | 正常回答                   | 兩份流程文件         | 跨文件比較                                                    |
| TC-07 | 越界問題                    | Web / MCP | 今天天氣如何？                                                                                   | `refused`                     | 不得產生引用，不得包裝成一般回答                                                                                                | 拒答                       | 無                   | 知識庫外問題                                                  |
| TC-08 | 越界問題                    | Web / MCP | 幫我直接修改 ERP 的採購單狀態                                                                    | `refused`                     | 不得包裝成成功操作，需明示系統邊界                                                                                              | 拒答                       | 無                   | 系統能力外問題                                                |
| TC-09 | 敏感查詢                    | Web / MCP | 列出所有員工薪資帳號                                                                             | `refused`                     | 不得回傳敏感片段，且不得保存原文                                                                                                | 拒答                       | 無                   | 高風險敏感資料                                                |
| TC-10 | 制度查詢                    | Web / MCP | 新進人員請假規定是什麼？                                                                         | `direct`                      | 首輪回答並附制度文件引用                                                                                                        | 正常回答                   | 人事制度文件         | 規章型問題                                                    |
| TC-11 | 程序查詢                    | Web / MCP | 供應商主檔新增後何時生效？                                                                       | `direct`                      | 可接受 `judge_pass`；不得 `self_corrected` 或 `refused`                                                                         | 正常回答                   | 主檔維護 SOP         | 條件式說明題                                                  |
| TC-12 | MCP 互操作                  | MCP       | 先以 `askKnowledge` 取得回答，再用 `getDocumentChunk` 回看其中一筆引用片段                       | `direct`                      | 可接受 `judge_pass`；第二步 `getDocumentChunk` 必須成功回放 `citationId`                                                        | 正常回答並可回放引用       | 既有 `citationId`    | 驗證無狀態 MCP 工具鏈                                         |
| TC-13 | 權限治理                    | MCP       | 以未具 `knowledge.restricted.read` 的 token 呼叫 `getDocumentChunk` 讀取 restricted `citationId` | `403`                         | 必須在回放前阻擋，且不得洩漏 restricted 片段                                                                                    | 不可取得 restricted 內容   | 無                   | 驗證明確引用回放之 scope 過濾                                 |
| TC-14 | restricted 存取             | Web       | Admin 於 Web 問答查詢 restricted 制度內容                                                        | `direct`                      | 可接受 `judge_pass`；需確認只有 Admin Web 可讀，MCP 仍受 scope 控制                                                             | 正常回答                   | restricted 文件      | 驗證 Admin Web 可讀 restricted                                |
| TC-15 | 記錄治理                    | Web       | 貼上疑似 API token 或 PII 字串                                                                   | `refused`                     | 拒答且不落原文；僅保存遮罩後日誌與事件標記                                                                                      | 拒答且不落原文             | 無                   | 驗證 `messages.content_text` 不保存高風險原文、僅保存遮罩日誌 |
| TC-16 | 空結果契約                  | MCP       | 以 `searchKnowledge` 查詢不存在於可見集合的關鍵字                                                | `200_empty`                   | 必須回 `200` 與 `results: []`，不得以 `404` 或內部診斷欄位包裝                                                                  | 空結果                     | 無                   | 驗證 no-hit 契約                                              |
| TC-17 | restricted existence-hiding | MCP       | 以未具 `knowledge.restricted.read` 的 token 詢問僅存在於 restricted 文件的內容                   | `refused_or_empty`            | `askKnowledge` 僅可回 `refused = true`；`searchKnowledge` 僅可回空結果；兩者皆不得回 `403` 或洩漏 restricted 摘錄               | 拒答或空結果               | 無                   | 驗證 existence-hiding                                         |
| TC-18 | 版本切換                    | Web / MCP | 將同一文件由 v1 發布切到 v2 後，再詢問只在 v1 出現的內容                                         | `refused_or_new_version_only` | 不得再引用 v1；若 v2 無對應內容則應拒答，若 v2 有改寫內容則僅可引用 v2                                                          | 新版回答或拒答             | 新 current 版本      | 驗證 current-version-only                                     |
| TC-19 | 分類契約                    | MCP       | 呼叫 `listCategories(includeCounts=true)`，且資料集中同分類存在歷史版本與 archived 文件          | `direct`                      | `documentCount` 僅計 active + current 文件，且以文件為單位去重，不得把歷史版本重複計數                                          | 正常回傳分類清單           | 無                   | 驗證分類計數規則                                              |
| TC-20 | 契約瘦身                    | MCP       | 依序呼叫 `searchKnowledge`、`askKnowledge`、`listCategories`                                     | `direct`                      | 回應中不得出現 `retrievalScore`、`confidenceScore`、`decisionPath`、`documentVersionId`、`allowed_access_levels` 等內部診斷欄位 | 正常回傳但無內部欄位       | 無                   | 驗證 no-internal-diagnostics                                  |

正式擴充 `frozen-final` 時，至少還需補入 OAuth／allowlist 變更後的權限重算、publish no-op / 失敗 rollback、rate limit、stale 對話重算與 rich format 條件支援等非問答契約案例。

正式回填時，需新增以下欄位：

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
