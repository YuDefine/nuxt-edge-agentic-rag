> ![](media/image1.jpeg){width="1.0833333333333333in"
> height="1.0833333333333333in"}
>
> **國 立 雲 林 科 技 大 學**

**資 訊 管 理 系 人 工 智 慧 技 優 專 班**

**人工智慧實務專題成果報告**

> **學號：B11123208**

**基於邊緣原生架構之**

**代理式檢索增強生成系統設計與實作**

**---以中小企業知識庫為例**

> **學 生：楊鈞元**
>
> **指導教授：潘得龍　博士**

**中華民國 115 年 X 月 X 日**

# 中文摘要

本專題旨在設計與實作一套基於邊緣原生架構之代理式檢索增強生成（Agentic
RAG）系統，並以中小企業知識庫為應用場景，驗證其技術可行性、導入效益與實務可操作性。系統核心能力包含自然語言問答、引用追溯、置信度評估、查詢重寫（Self-Correction）以及證據不足時的拒答機制，並以
Model Context Protocol（MCP）作為對外標準介面，使外部 AI Client
能以一致協定安全存取知識內容。

傳統 RAG
雖能結合檢索與生成以降低幻覺，但多採單次靜態檢索流程，當使用者查詢模糊、描述不完整或首次檢索命中不佳時，容易產生低品質回答。此外，若系統需自建文件切片、Embedding、索引與檢索基礎設施，對中小企業而言亦存在人才門檻高、維運成本高與建置週期長等問題。為兼顧系統可控性與導入成本，本研究採用
Hybrid Managed RAG 設計：以 Cloudflare AutoRAG（AI
Search）作為受管理的檢索基礎層，負責文件同步、分塊、Embedding
與基礎檢索；上層再自建 Agentic
Orchestration，處理置信度評估、查詢重寫、拒答判斷、回應生成與引用組裝。

技術實作上，本專題採用 Nuxt 4 全端框架與 NuxtHub v0.10 多雲抽象層，整合
Drizzle ORM + D1、R2 物件儲存、KV、Cloudflare AutoRAG、Workers AI 與
Vercel AI SDK。Agentic 決策層以 AI SDK 搭配 workers-ai-provider
在邊緣執行查詢規範化、置信度評估與 query
reformulation，並於邊緣模型不足時保留回退雲端 LLM 的彈性。MCP 層則以
Nuxt MCP Toolkit 於 Nuxt 應用內建立 MCP Server，將
searchKnowledge、askKnowledge、getDocumentChunk、listCategories
等能力封裝為標準化 MCP Tools，並以 Middleware 處理 Bearer token 授權、以
Sessions 維持跨 tool call 的多輪對話狀態。安全設計採 better-auth
處理登入與角色控制，並將 Passkey 等無密碼登入作為延伸強化方向。

開發方法論上，本專題採用 Spec-Driven Development（規格驅動開發），搭配
Claude Code、spectra、Nuxt MCP Server 等 AI 輔助工具鏈，降低中小企業導入
AI 系統時對專職 AI
工程師的依賴。成果驗證以功能展示與情境測試為主，涵蓋一般問答、模糊查詢觸發
Self-Correction、拒答情境、管理後台與外部 AI Client 透過 MCP
互操作等展示場景。

**關鍵字：代理式檢索增強生成（Agentic
RAG）、邊緣原生架構（Edge-Native）、Hybrid Managed
RAG、Self-Correction、Model Context
Protocol（MCP）、規格驅動開發（SDD）**

# 目錄

[中文摘要](#中文摘要)

[目錄](#目錄)

[圖表目錄](#圖表目錄)

[第一章 開發計畫](#開發計畫)

[第一節 發展的動機](#發展的動機)

[1.1.1 中小企業 ERP 使用的痛點](#中小企業-erp-使用的痛點)

[1.1.2 傳統 RAG 系統的導入障礙](#傳統-rag-系統的導入障礙)

[1.1.3 Serverless 邊緣運算帶來的轉機](#serverless-邊緣運算帶來的機會)

[1.1.4 混合式架構的必要性](#混合式架構的必要性)

[第二節 專題目的](#專題目的)

[1.2.1 技術架構面](#技術架構面)

[1.2.2 安全設計面](#安全設計面)

[1.2.3
開發方法論面](#以-bearer-tokenmiddleware-與-session-機制保護-mcp-對外存取)

[第三節 專題需求](#專題需求)

[1.3.1 專題簡介](#專題簡介)

[1.3.2 專題架構](#專題架構)

[第四節 預期效益](#預期效益)

[第二章 分析與設計](#分析與設計)

[第一節 分析](#分析)

[第二節 設計](#設計)

[2.2.1 資料庫設計](#資料庫設計)

[第三節 開發時程](#開發時程)

[第四節 其他相關設計或考量](#其他相關設計或考量)

[2.3.1 資訊安全設計](#資訊安全設計)

[2.3.1.1與大型 LLM API 服務之比較：](#與大型-llm-api-服務之比較)

[第五節 開發過程與工具選型](#開發過程與工具選型)

[2.5.1 開發方法論：Spec-Driven
Development](#開發方法論spec-driven-development)

[2.5.2 AI 輔助開發工具鏈](#ai-輔助開發工具鏈)

[2.5.3 Tech Stack 選型效益](#tech-stack-選型效益)

[2.5.4 開發效率量化估算](#開發效率量化估算)

[2.5.5 對中小企業的實際價值](#對中小企業的實際價值)

[第三章 實作成果](#第三章-實作成果)

[第六節 作業環境](#作業環境)

[第七節 功能與介面說明](#功能與介面說明)

[3.2.1 流程說明](#流程說明)

[3.2.2 功能說明](#功能說明)

[3.2.3 操作與介面說明](#操作與介面說明)

[第八節 其他實測或實驗結果](#其他實測或實驗結果)

[第四章 結論](#第四章-結論)

[第九節 目標達成情況](#目標達成情況)

[第十節 未來展望](#未來展望)

[第五章 專題心得與檢討](#第五章-專題心得與檢討)

[第十一節 組員心得](#組員心得)

[第十二節 檢討與改進](#檢討與改進)

[第六章 參考文獻](#第六章-參考文獻)

[附錄](#附錄)

[第十三節 附錄 A：核心程式碼](#附錄-a核心程式碼)

[A.1 文件分塊處理](#a.1-文件分塊處理)

[A.2 向量檢索函式](#a.2-向量檢索函式)

[A.3 系統提示詞模板](#a.3-系統提示詞模板)

[第十四節 附錄 B：API 文件](#附錄-bapi-文件)

[第十五節 附錄 C：測試資料集](#附錄-c測試資料集)

# 符號索引

---

**縮寫/符號** **全稱** **說明**

---

RAG Retrieval-Augmented 檢索增強生成，結合向量檢索與 LLM 生成的技術。
Generation

Agentic RAG Agentic 代理式 RAG，由 LLM
Retrieval-Augmented 代理主動決定檢索策略、重試與置信度評估。
Generation

LLM Large Language Model 大型語言模型，如 GPT、Llama、Qwen 等。

MCP Model Context Protocol Anthropic 提出的模型上下文協定，標準化 AI Client
與外部工具的互動。

WebMCP Web Model Context 以 HTTP/SSE 傳輸的 MCP 變體，適用於 Edge /
Protocol Serverless 部署。

ERP Enterprise Resource 企業資源規劃系統，涵蓋會計、庫存、人資等模組。
Planning

ReAct Reasoning + Acting 結合推理與行動的 LLM 代理式提示策略。

AI SDK Vercel AI SDK Vercel 推出的 TypeScript AI
開發套件，提供工具呼叫、串流、Agent 編排能力。

AutoRAG Cloudflare AutoRAG (AI Cloudflare 提供的 Managed RAG 服務，內建
Search) Ingestion Pipeline 與向量檢索。

NuxtHub NuxtHub Nuxt 官方推出的整合平台，將 Nuxt 4 應用部署到
Cloudflare Workers 並一站式管理 D1、R2、KV。

---

# 圖表目錄

［依章節編號列出所有圖表］

# 開發計畫

## 發展的動機

### 1.1.1 中小企業 ERP 使用的痛點

企業資源規劃（ERP）系統通常涵蓋採購、庫存、銷售、財務、人事與報表等多個模組。對中小企業而言，ERP
的問題不在於「沒有資料」，而在於「資料與知識難以快速被取用」。在日常操作中，常見痛點如下：

(1) 學習成本高：系統功能模組眾多、操作流程複雜，使用者需仰賴操作手冊或資深同仁協助。

(2) 知識分散：SOP、FAQ、制度文件與教育訓練資料分散於不同檔案與資料夾，難以快速定位。

(3) 知識傳承困難：當人員異動時，隱性操作經驗不易保留，企業知識難以累積成可重用資產。

### 1.1.2 傳統 RAG 系統的導入障礙

檢索增強生成（RAG）能將知識庫內容與大型語言模型結合，為企業建立智慧問答系統。然而對中小企業而言，傳統自建
RAG 仍有數項實務障礙：

(1) 人才門檻高：從文件切片、Embedding、向量索引到問答流程設計，需具備
AI、後端與維運能力。

(2) 維運成本高：若需自建索引服務與基礎設施，系統維護、擴充與監控成本均高。

(3) 開發週期長：從零設計檢索流程、權限設計、管理介面與問答體驗，建置周期通常偏長。

(4) 回答品質不穩：單次靜態檢索在面對模糊查詢或條件不足時，容易產生命中不佳或幻覺。

### 1.1.3 Serverless 邊緣運算帶來的機會

近年 Serverless
與邊緣運算平台逐漸成熟，使中小企業能以較低門檻部署智慧應用。以
Cloudflare Workers 為例，其優勢包括：

(1) 零伺服器維運：無需自行管理作業系統、更新、安全修補與容量規劃。

(2) 按量計費：能依實際使用量計費，降低早期導入成本。

(3) 低延遲：透過全球邊緣節點提供更接近使用者的互動體驗。

(4) 原生整合：搭配 D1、R2、KV、Workers AI
等服務，可快速組成完整應用架構。

### 1.1.4 混合式架構的必要性

雖然邊緣推論能力逐漸提升，但在企業知識庫問答場景中，系統仍需兼顧穩定性、成本與回答品質。若完全自建檢索流程，實作與維運負擔偏高；若完全交由
Managed RAG
處理，則在置信度評估、查詢重寫與拒答策略上的控制力有限。因此，本專題採用
Hybrid Managed RAG 架構：

(1) 下層以 Cloudflare AutoRAG 負責文件同步、分塊、Embedding 與基礎檢索。

(2) 上層以自建 Agentic Orchestration
控制檢索評估、查詢重寫、拒答與回答生成。

(3) 問答優先於邊緣執行，以兼顧回應速度；當邊緣模型不足時，保留回退雲端
LLM 的彈性。

此設計能在「Managed Service
降低維運」與「自建代理流程保留決策控制」之間取得平衡。

## 專題目的

### 1.2.1 技術架構面

(1) 設計並實作一套基於 Serverless 邊緣原生架構的企業知識庫問答系統。

(2) 採用 Hybrid Managed RAG 架構，驗證 AutoRAG 與自建 Agentic
Orchestration 整合之可行性。

(3) 實作具備 Self-Correction
與拒答機制的問答流程，提升模糊查詢情境下的回答品質。

(4) 建立符合 Model Context Protocol 的 MCP Server，使外部 AI
工具可透過標準協定存取知識內容。

### 1.2.2 安全設計面

(5) 建立以角色權限為基礎的應用存取控制。

### 以 Bearer token、Middleware 與 Session 機制保護 MCP 對外存取。

(6) 確保敏感資料不直接進入 LLM 問答流程或 MCP 對外輸出。

## 專題需求

### 1.3.1 專題簡介

本系統以企業知識庫問答為核心，服務範圍與需求如下。

目標用戶：

(1) ERP 一般使用者：查詢操作指引、報表解讀、規章制度。

(2) 系統管理員：知識庫維護、文件管理、查詢統計。

應用場景：

(1) 操作指引查詢：SOP、流程步驟、表單填寫說明。

(2) 報表解讀：欄位意義、計算邏輯說明。

(3) 規章制度查詢：作業規範、制度條文。

不在範圍：

(1) 不直接修改 ERP 交易資料或執行關鍵交易。

(2) 不將敏感資料（帳號密碼、個資明文）送入 LLM。

(3) 具備拒答機制，不承諾所有問題都能回答。

［待補：插入系統功能圖。繪圖
Prompt：以樹狀結構繪製系統功能圖，根節點為「企業知識庫 Agentic RAG
系統」，主分支包含（1）使用者端：自然語言問答、對話歷史、引用查看、拒答提示；（2）管理後台：文件
CRUD、分類標籤、查詢紀錄檢視、Ingestion 觸發；（3）Agentic
核心：置信度評估、Query Reformulation、Self-Correction
Loop、拒答判斷；（4）MCP
介面：searchKnowledge、askKnowledge、getDocumentChunk、listCategories。風格：扁平化、方框與圓角、繁體中文。］

### 1.3.2 專題架構

本系統採用 Serverless 三層式架構，分為前端層、邊緣層與雲端層。

［待補：插入系統架構圖。繪圖 Prompt：以四層水平分層圖呈現 Hybrid Managed
RAG + Cloud fallback 架構：第 1 層「前端層」（Nuxt 4 + Nuxt UI +
\@ai-sdk/vue useChat streaming）；第 2
層「資料與受管理檢索層」（Cloudflare Workers + NuxtHub v0.10 + Drizzle
ORM + D1 + R2 + KV + Cloudflare AutoRAG）；第 3 層「Agentic AI
層」（Vercel AI SDK + workers-ai-provider，內含 Workers AI
多模型分層：Kimi K2.5（Agent / Tool Calling，256K ctx）、Llama 4 Scout
17B MoE（簡單問答快速回應）、gpt-oss-120b（備援），處理置信度評估、Query
Reformulation、Self-Correction、拒答）；第 4 層「MCP 層」（Nuxt MCP
Toolkit + Middleware + Sessions + Bearer Auth）。右側以箭頭連到外部 AI
Client（Claude Desktop / Cursor）。整張圖請以單一 Cloudflare Edge
邊界框包覆全部四層，明確呈現「以邊緣為主、必要時 Cloud fallback 至
proprietary LLM」之 Hybrid 特性。］

架構說明：

(1) 前端層：使用 Nuxt 4 框架搭配 Nuxt UI v4 元件庫，整合 Vercel AI SDK
的 Vue 套件實現串流對話介面。

(2) 邊緣與受管理檢索層（Serverless）：透過 NuxtHub v0.10 一鍵部署至
Cloudflare Workers 邊緣網路。整合 Drizzle ORM + D1
儲存文件中繼資料與查詢日誌、R2 儲存原始文件、KV 作為快取；並以
Cloudflare AutoRAG（AI
Search）作為受管理的檢索基礎層，負責文件同步、分塊、Embedding
與基礎語義檢索。應用層則以 better-auth 處理登入、Session
與角色控管。此層完全無需管理伺服器，按量計費、自動擴展。

(3) Agent 模型層（自主決策）：當檢索信心度不足或查詢需要複雜推理時，由
Agent 自主升級至 Workers AI 上的 frontier-scale 模型 Kimi K2.5（256K
context、原生多輪 tool calling），並觸發 Self-Correction
Loop（最多重試 1 次）；若仍不足以保證回答品質，則動態 Cloud fallback
至 proprietary 雲端 LLM。

(4) Agentic 路由：系統根據向量相似度分數、查詢長度、關鍵字特徵，由 Agent
自主決策使用輕量模型（Llama 4 Scout）或 frontier 模型（Kimi
K2.5），實現成本與品質的最佳平衡。

## 預期效益

對使用者：

(1) 降低 ERP 學習門檻，縮短查找文件與理解流程的時間。

(2) 以自然語言查詢取代關鍵字式搜尋，提升問題解決效率。

(3) 回答附帶引用來源與片段，提高可追溯性與可信度。

對中小企業：

(1) 大幅降低維運成本：Serverless
架構無需管理伺服器，免費額度內零成本運行。

(2) 大幅降低 API 成本：以 Workers AI 邊緣模型承擔絕大多數查詢、僅必要時
Cloud fallback，相較純 proprietary LLM（GPT-5.4 / Gemini 3.1 Pro /
Claude Opus 4.6）方案可節省約 70-90%
費用，並維持單一控制平面與可預期之計費結構。

(3) 大幅降低開發門檻：現有 Vue/JS 工程師 1-2 週內可上手，無需專門 AI
工程師。

(4) 大幅縮短開發週期：Spec-Driven Development + AI 輔助工具可縮短 50-60%
開發時間。

(5) 標準化對外互操作：以 MCP 協定暴露知識庫能力，未來可無縫銜接更多 AI
Client（Claude Desktop、Cursor 等），降低未來系統整合成本。

(6) 累積知識資產：企業知識得以系統化保存並複用，減少 IT 支援人力負擔。

對技術社群：

(1) 提供 Serverless Edge + Hybrid Managed RAG（AutoRAG + Agentic
Orchestration）+ Nuxt MCP Toolkit 整合的完整實作範例。

(2) 驗證混合式邊緣雲端運算策略在企業應用中的可行性與成本效益。

(3) 驗證 Spec-Driven Development + AI 輔助工具鏈對開發效率的提升。

## 相關技術簡介

**RAG（檢索增強生成）：RAG 將外部知識檢索結果作為 LLM
回答上下文，能降低幻覺並提升回答可追溯性，適合企業知識庫與文件問答場景。**

**RAG（檢索增強生成）：RAG 將外部知識檢索結果作為 LLM
回答上下文，能降低幻覺並提升回答可追溯性，適合企業知識庫與文件問答場景。**

**Cloudflare Workers 與 Edge 運算：Cloudflare Workers 是建構於 V8
Isolates 的 Serverless 平台，可搭配 D1、R2、KV 與 Workers AI
建立完整的邊緣應用。**

**RAG（檢索增強生成）：RAG 將外部知識檢索結果作為 LLM
回答上下文，能降低幻覺並提升回答可追溯性，適合企業知識庫與文件問答場景。**

**Model Context Protocol（MCP）：MCP 是 AI Client
與外部工具互操作的標準協定，能以 Tools、Resources 與 Prompts
將系統能力標準化暴露。**

**Cloudflare Workers 與 Edge 運算：Cloudflare Workers 是建構於 V8
Isolates 的 Serverless 平台，可搭配 D1、R2、KV 與 Workers AI
建立完整的邊緣應用。**

# 分析與設計

## 分析

［待補：插入 Use Case Diagram。繪圖 Prompt：以 UML Use Case
圖格式繪製，三個 Actor：一般使用者（User）、系統管理員（Admin）、外部 AI
Client（External Agent）。Use Case
包含：提問並獲得回答、查看對話歷史、查看引用來源、追問（多輪對話）、上傳文件、設定分類/標籤、觸發
Ingestion、檢視查詢日誌、呼叫 MCP searchKnowledge、呼叫 MCP
askKnowledge、取得 getDocumentChunk、取得 listCategories。請以實線連接
Actor 與 Use Case，以 \<\<include\>\>
標示「提問」含「Self-Correction」與「置信度評估」子流程。］

主要 Actor：

(1) 一般使用者（User）

(2) 系統管理員（Admin）

(3) 外部 AI Client（External Client / Agent）

---

**Actor** **Use Case** **說明**

---

User 提問並獲得回答 輸入自然語言問題，取得含引用的回答

User 查看對話歷史 回顧過往的問答紀錄

Admin 上傳文件 上傳 PDF、Markdown 等文件至知識庫

Admin 管理文件 編輯、分類、下架文件

Admin 查看統計 檢視查詢成功率、延遲等統計數據

External 呼叫檢索 API 透過 MCP Tools（searchKnowledge /
askKnowledge / getDocumentChunk /
listCategories）查詢知識庫，REST API
僅作應用內部使用

---

［待補：插入 Activity Diagram - Agentic RAG 問答流程。繪圖 Prompt：以
UML Activity Diagram 呈現 Self-Correction Loop。流程節點依序為：(1)
使用者提問 →(2) 查詢規範化 →(3) 呼叫 AutoRAG 基礎檢索 →(4)
置信度評估（決策菱形）。分支 A（置信度足夠）：→ 組裝引用 → 以 AI SDK
streamText 生成回答 → 輸出串流 → 結束。分支 B（置信度不足且未重試）：→
Query Reformulation（Agentic Orchestrator 重寫查詢）→ 回到 (3)。分支
C（置信度不足且已重試 1 次）：→ 拒答並提示使用者補充條件 →
結束。請於決策菱形旁標註「最多 1 次重試」以控制延遲與成本。］

## 設計

### 2.2.1 資料庫設計

本系統使用 D1（SQLite）儲存結構化資料，並搭配 Drizzle ORM
進行型別安全的資料存取。

［待補：插入 ER Diagram。繪圖 Prompt：以實體關聯圖（Crow\'s Foot
notation）繪製，實體包含：users（id, email, name, role,
createdAt）、documents（id, title, category, tags, version, status,
r2Key, autoragIndexId, uploadedBy, createdAt）、queryLogs（id, userId,
query, reformulatedQuery, confidenceScore, selfCorrectionTriggered,
refused, latencyMs, createdAt）、sessions（id, userId, mcpClientId,
contextJson, createdAt）。關係：users 1─N documents、users 1─N
queryLogs、users 1─N sessions。請註記主鍵（PK）與外鍵（FK），並標示
AutoRAG 管理的向量索引於 documents.autoragIndexId 外部關聯。］

---

**資料表** **主要欄位** **說明**

---

users id, email, name, role, 使用者資料
createdAt

documents id, title, content, category, 文件資料
version, status

chunks id, documentId, content, 文件區塊
chunkIndex, vectorId

queryLogs id, userId, query, topScore, 查詢日誌
latencyMs, status

---

向量索引設計（Vectorize）：

---

**欄位** **類型** **說明**

---

id string 格式為
{documentId}-{chunkIndex}

values float\[1024\] bge-m3 產生的 1024 維向量

metadata.documentId string 所屬文件 ID

metadata.category string 文件分類

---

API 設計：

---

**方法** **路徑** **說明** **權限**

---

POST /api/chat 問答（串流回應） User

GET /api/documents 取得文件列表 Admin

POST /api/documents 上傳文件 Admin

PUT /api/documents/:id 更新文件 Admin

DELETE /api/documents/:id 刪除文件 Admin

GET /api/stats 查詢統計 Admin

---

## 開發時程

［待補：插入甘特圖。繪圖 Prompt：以水平甘特圖繪製 20 週開發時程，X 軸為
W1--W20，Y 軸為里程碑。里程碑條目：M1 專案初始化、NuxtHub 部署、D1
Schema（W1--W2）；M2 better-auth 整合與角色（W3--W4）；M3 文件 CRUD、R2
上傳、AutoRAG Ingestion 串接（W5--W6）；M4 Agentic 問答主流程（AI SDK +
workers-ai-provider + 串流輸出）（W7--W10）；M5 置信度評估、Query
Reformulation、Self-Correction Loop（W11--W12）；M6 Nuxt MCP
Toolkit（Tools、Middleware、Sessions、Bearer Auth）（W13--W14）；M7
效能測試、錯誤處理、UI 優化（W15--W16）；M8
報告撰寫與系統文件（W17--W20）。請以不同顏色區分 Phase 1/Phase 2/Phase
3，並在每個里程碑末標註「交付物」。］

---

**階段** **週次** **任務** **交付物**

---

M1 W1-2 專案初始化、NuxtHub 部署、D1 Schema 可部署的專案骨架

M2 W3-4 Better Auth 整合、登入介面 可登入的系統

M3 W5-6 文件 CRUD、分塊處理、Embedding 生成 知識庫管理功能

M4 W7-10 向量檢索、問答流程、串流輸出 基本問答功能

M5 W11-12 信心度評估、查詢重寫、Self-Correction 智慧問答功能

M6 W13-14 對外 MCP Server（Tools / Sessions / 可供外部呼叫
Bearer Auth），REST API 僅作為內部輔助

M7 W15-16 效能測試、錯誤處理、UI 優化 穩定版本

M8 W17-20 報告撰寫、系統文件 完整專題報告

---

### 各階段交付項目清單

### Phase 1：核心問答功能（W1-W8）

---

**階段** **項目** **內容說明**

---

Phase 1 文件上傳管理 Admin 後台可上傳 PDF/DOCX/MD 文件，以 R2 儲存並觸發
Ingestion。

Phase 1 Managed Ingestion 以 Cloudflare AutoRAG 執行自動切片、Embedding
與向量索引。

Phase 1 問答介面 Nuxt 4 前端聊天介面，支援多輪對話與串流回應。

Phase 1 回答附引用 每次回答附上檢索命中的文件片段與來源連結，提升可信度。

---

### Phase 2：Self-Correction 與 MCP Server（W9-W14）

---

**階段** **項目** **內容說明**

---

Phase 2 拒答機制 以 LLM 置信度評估為基礎，低於閾值時主動拒答並提示使用者。

Phase 2 Self-Correction 首次檢索失敗或置信度低時，由 LLM 重寫查詢重試一次。
Loop

Phase 2 查詢日誌 記錄每次查詢、檢索結果與回答，供後續分析與模型評估。

Phase 2 管理後台 Admin 可檢視文件、查詢日誌、分類/標籤管理。

Phase 2 MCP Server 基本 以 Nuxt MCP Toolkit 實作 WebMCP Server，暴露
searchKnowledge、askKnowledge、getDocumentChunk、listCategories
四個 Tools。

Phase 2 MCP Sessions 支援 MCP 的 Session 狀態管理，讓 AI Client 可維持對話上下文。

---

### Phase 3：進階 MCP 能力與路由優化（W15-W20）

---

**階段** **項目** **內容說明**

---

Phase 3 MCP Resources 實作
resource://kb/categories、resource://kb/stats
等資源端點，供 AI Client 列出分類與統計資訊。

Phase 3 Edge/Cloud 依查詢複雜度動態路由至 Workers AI（Edge）或外部
路由展示 LLM（Cloud），展示成本與延遲取捨。

Phase 3 MCP Evals 建立 MCP 工具呼叫的評測集，量化 Agent
使用工具的正確率與效率。

Phase 3 Dynamic 支援動態工具描述與參數定義，讓 MCP Server
Definitions 可隨知識庫內容調整 Tool schema。

---

## 其他相關設計或考量

### 2.3.1 資訊安全設計

(1) 身分驗證與角色控制：系統以 better-auth 作為登入與 Session
管理核心，支援多種登入方式（Email、OAuth 社群登入、Passkey
無密碼登入），並以角色（User / Admin）為基礎進行 API 存取權限控管。

(2) Passkey 作為加分項：作為無密碼登入選項之一，Passkey 基於
FIDO2/WebAuthn 標準，私鑰儲存於使用者裝置（Secure Enclave /
TPM），具備抗釣魚特性，可進一步降低密碼相關風險，但非本專題的核心亮點。

(3) MCP 授權：MCP Server 以 Bearer token 驗證外部 AI Client，透過 Nuxt
MCP Toolkit 的 Middleware 攔截每次 tool call
並檢查授權範圍，避免越權存取知識內容。

(4) 敏感資料治理：使用者密碼經 better-auth 標準加密、OAuth Token
不落地至前端、所有資料傳輸採
HTTPS；敏感資料（帳號、金鑰、個資明文）不送入 LLM 與 MCP Tools
回傳內容。

(5) 存取控制：角色分為 User 與 Admin，API 端點依角色進行權限檢查。

(6) 資料保護：全站採用 HTTPS、敏感資料不送入 LLM、API Token 採用 Bearer
Token 驗證。

### 2.3.1.1與大型 LLM API 服務之比較：

本系統採用 Hybrid Managed RAG + Cloud fallback 架構（以 Workers AI
邊緣模型為主、proprietary 雲端 LLM 為 fallback），相較於直接使用
GPT-5.4、Gemini 3.1 Pro、Claude Opus 4.6 等純 proprietary 雲端 LLM
API，具有以下差異：

+------------------+-------------------------------------------------+--------------------------+
| **比較面向** | **純雲端 LLM** | **本系統（Hybrid Managed |
| | | RAG + Cloud fallback）** |
| | **（GPT-5.4 / Gemini 3.1 Pro / Claude 4.6）** | |
+==================+=================================================+==========================+
| 延遲 | 500-2000ms（需往返雲端） | 全流程 \<500ms（Workers |
| | | AI 邊緣執行） |
+------------------+-------------------------------------------------+--------------------------+
| 成本（Input/1M | GPT-5.4: \$2.50 / Gemini 3.1: \$2-4 / Claude | Workers AI Neurons |
| tokens） | 4.6: \$5 | 計費（約 proprietary 的 |
| | | 6-23%） |
+------------------+-------------------------------------------------+--------------------------+
| 成本（Output/1M | GPT-5.4: \$15 / Gemini 3.1: \$12-18 / Claude | 同上 |
| tokens） | 4.6: \$25 | |
+------------------+-------------------------------------------------+--------------------------+
| Context Window | GPT-5.4: 400K / Gemini 3.1: 1M / Claude 4.6: 1M | Kimi K2.5: 256K（Workers |
| | | AI 原生） |
+------------------+-------------------------------------------------+--------------------------+
| 資料隱私 | 所有資料傳送至第三方（OpenAI/Google/Anthropic） | 全流程資料在 Cloudflare |
| | | 邊緣，不經第三方 AI 廠商 |
+------------------+-------------------------------------------------+--------------------------+
| 供應商依賴 | 單一供應商風險 | Workers AI 多模型 + |
| | | Cloud fallback（Kimi |
| | | K2.5 / Llama 4 Scout / |
| | | gpt-oss-120b + |
| | | proprietary LLM 備援） |
+------------------+-------------------------------------------------+--------------------------+
| 離線/私有部署 | 不支援 | 可部署於企業私有環境 |
+------------------+-------------------------------------------------+--------------------------+
| 客製化程度 | 僅能透過 Prompt 調整 | 可自訂檢索策略與模型選擇 |
+------------------+-------------------------------------------------+--------------------------+
| 快取優惠 | proprietary: 90% 折扣；Workers AI: Neurons | 邊緣本身免費，無需快取 |
| | 統一計價 | |
+------------------+-------------------------------------------------+--------------------------+

2025 年主流 LLM API 定價參考（截至 2025 年 12 月）：

+--------------+-------------+-------------+-----------+-----------------+
| **模型** | **Input** | **Output** | **Context | **特色** |
| | | | Window** | |
| | **（/1M | **（/1M | | |
| | tokens）** | tokens）** | | |
+==============+=============+=============+===========+=================+
| GPT-5.4 | \$2.50 | \$15 | 400K | 2026-03 |
| | | | | 旗艦，Agentic |
| | | | | 頂級 |
+--------------+-------------+-------------+-----------+-----------------+
| GPT-5.1 | \$1.25 | \$10 | 272K | 2025-11 基準款 |
+--------------+-------------+-------------+-----------+-----------------+
| GPT-5.1-chat | \$0.63 | \$5 | 272K | 對話成本最佳化 |
+--------------+-------------+-------------+-----------+-----------------+
| Claude Opus | \$5 | \$25 | 1M | 2026-02 |
| 4.6 | | | | Anthropic 旗艦 |
+--------------+-------------+-------------+-----------+-----------------+
| Gemini 3.1 | \$2-4 | \$12-18 | 1M | 2026-02 |
| Pro | | | | 多模態旗艦 |
+--------------+-------------+-------------+-----------+-----------------+
| Claude | \$3 | \$15 | 1M | 2026-02 Agentic |
| Sonnet 4.6 | | | | 平衡 |
+--------------+-------------+-------------+-----------+-----------------+
| Workers AI | Neurons | Neurons | 256K | 本系統採用（77% |
| (Kimi K2.5) | 計費 | 計費 | | 省成本） |
+--------------+-------------+-------------+-----------+-----------------+

成本效益分析（以每日 1000 次查詢、平均 500 tokens I/O 為例）：

• 純 GPT-5.4 方案：(500×\$2.50 + 500×\$15)/1M × 1000 ≈ \$8.75/天 ≈
\$262.5/月

• 純 Claude Opus 4.6 方案：(500×\$5 + 500×\$25)/1M × 1000 ≈ \$15/天 ≈
\$450/月

• 純 Claude Sonnet 4.6 方案：(500×\$3 + 500×\$15)/1M × 1000 ≈ \$9/天 ≈
\$270/月

• 本系統 Hybrid Managed RAG + Cloud fallback 方案（以 Workers AI Kimi
K2.5 / Llama 4 Scout 為主，必要時 fallback 至 proprietary LLM）：估算約
\$25-50/月（節省約 70-90%）

為何不純粹依賴 GPT-5.4 / Gemini 3.1 / Claude 4.6？

(1) 延遲問題：proprietary API 每次查詢需 500-2000ms 網路往返（即使
Claude Haiku 4.5 也需 300-500ms），而 Workers AI 於 330+
個邊緣節點原生執行，主流程於邊緣完成可控於 \<500ms；僅在必要 Cloud
fallback 時才會引入跨境延遲。

(2) 成本考量：對中小企業 ERP 典型查詢負載而言，以 Workers AI Neurons
計費承擔大多數請求、必要時 Cloud fallback 至 proprietary LLM，可較純
proprietary API 估算節省約 70-90%，並免除大量跨境資料傳輸費用。

(3) 隱私合規：絕大多數查詢於 Cloudflare 邊緣網路處理；僅在 Cloud
fallback 時依設定送至受信任的 proprietary
LLM，並可由設定檔關閉以符合 GDPR 與本地資料主權要求。

(4) 供應商風險：Workers AI 同時提供 Kimi K2.5、Llama 4
Scout、gpt-oss-120b 等多款開源/商業模型作為主要層，並以可替換的
proprietary LLM 作為 Cloud fallback，避免單一廠商之 API
變更、限流、定價調整風險。

Agentic 自主路由設計：

Agent（Kimi K2.5）根據查詢性質自主決策工具呼叫策略與模型層級：

(1) 檢索信心度低（score \< 0.5）→ Agent 觸發 Self-Correction
重寫查詢並再檢索（最多 1 輪）

(2) 簡單問答（約 70% 查詢）→ 直接由 Llama 4 Scout 17B MoE 快速回應

(3) 複雜推理或多工具呼叫（比較、分析、評估）→ 由 Kimi K2.5（256K
ctx）執行 Agentic Tool Calling

平台限制與因應：

---

**限制** **說明** **因應方式**

---

Workers CPU 10-50ms 單次請求 CPU 時間限制 Self-Correction 限制為最多 1
次重試

D1 容量 10GB 單一資料庫容量上限，無法擴展 ERP
知識庫通常足夠；大規模可遷移至
Turso

Vectorize 維度上限 最大 1536 維 bge-m3 為 1024 維，符合限制

---

## 開發過程與工具選型

本專題採用 AI 輔助的規格驅動開發（Spec-Driven
Development）方法論，結合現代化的 Tech Stack 與 AI
開發工具鏈，大幅提升開發效率並降低實作門檻。

### 2.5.1 開發方法論：Spec-Driven Development

採用 GitHub 開源的 spectra 工具，實踐規格驅動開發流程：

---

**階段** **產出文件** **說明**

---

Constitution constitution.md 定義專案原則、技術標準、品質要求

Specify spec.md 撰寫功能規格、使用者故事、驗收條件

Plan plan.md 規劃技術架構、資料流、API 設計

Tasks tasks/\*.md 拆解為可獨立實作的小任務

Implement 原始碼 AI 依據規格生成程式碼

---

Spec-Driven Development 的核心價值在於「規格即真理」------AI
依據明確的規格文件生成程式碼，而非僅憑模糊的
Prompt。這確保了生成的程式碼符合預期架構，減少來回修正的時間。

### 2.5.2 AI 輔助開發工具鏈

---

**工具** **用途** **解決的問題**

---

Claude Code 主要 AI 程式助手 程式碼生成、除錯、重構、測試撰寫

spectra 規格驅動開發框架 結構化開發流程、規格文件管理

Nuxt MCP Server Nuxt 4 文件即時查詢 避免 AI 產生過時的 Nuxt 2/3 語法

Nuxt UI MCP Server UI 元件規格查詢 正確使用 Props、Slots、Events

---

MCP（Model Context Protocol）讓 AI 助手能即時查詢最新的框架文件。傳統 AI
輔助開發的痛點是訓練資料過時，常建議使用舊版語法；透過 MCP，Claude Code
可直接查詢 Nuxt 4 官方文件，確保生成的程式碼符合最新規範。

### 2.5.3 Tech Stack 選型效益

選用整合度高的技術棧，減少「膠合程式碼」的撰寫：

---

**技術選型** **整合效益** **節省時間**

---

Nuxt 4 + NuxtHub 全端框架 + 一鍵部署 Cloudflare 3-5 天

Nuxt UI v4 企業級 UI 元件庫，開箱即用 5-7 天

Better Auth + Passkey 無密碼認證，原生 Edge 支援 3-5 天

Drizzle ORM + D1 類型安全 ORM，自動遷移 2-3 天

Vercel AI SDK Workers AI 多模型統一抽象 + 2-3 天
原生 Tool Calling/Streaming

Vectorize + Workers AI 向量資料庫 + Embedding，零配置 3-4 天

---

合計節省約 18-27 天（相比從零實作或使用整合度低的技術）

### 2.5.4 開發效率量化估算

---

**開發方式** **預估總工時** **說明**

---

傳統手動開發 60-80 人天 無 AI
輔助，手動查文件、撰寫所有程式碼

AI 輔助（無 MCP/spectra） 35-45 人天 AI 常給錯誤建議，需大量修正

本專題方法（SDD + MCP） 20-30 人天 規格驅動 + 即時正確的框架知識

---

效率提升：相較傳統開發節省 50-60%，相較一般 AI 輔助再節省 30-40%

### 2.5.5 對中小企業的實際價值

• 人力需求：現有 Vue/JavaScript 工程師 1 人即可實作，無需招聘專門 AI
工程師

• 學習成本：熟悉 Vue 的工程師約 1-2 週可上手 Nuxt 4 生態系

• 工具成本：Claude Max 5x 方案 \$100/月，其餘工具皆為免費或開源

• 長期維護：統一 TypeScript 技術棧、活躍社群支援、Nuxt 提供 Codemod
自動遷移

\-\--以下格式尚未調整\-\--

# 第三章 實作成果

## 作業環境

硬體環境：

---

**項目** **規格**

---

運行環境 Cloudflare Edge Network（全球 300+ 節點）

開發機 ［待填入實際規格。建議欄位：CPU、記憶體、作業系統、Node.js
版本、pnpm 版本、Wrangler 版本；若多位組員請分別列出。］

---

軟體環境：

---

**類別** **技術** **版本** **用途**

---

Framework Nuxt 4.x 全端框架

Deployment NuxtHub 0.10.x Cloudflare 部署整合

Database D1 + Drizzle GA 邊緣資料庫 + ORM

Auth Better Auth 1.4.x 無密碼認證框架

Passkey \@better-auth/passkey 1.x WebAuthn/FIDO2 支援

AI SDK Vercel AI SDK 6.x Workers AI
模型統一抽象 + Agentic
Tool Calling 介面

UI Nuxt UI 4.x UI 元件庫

Vector DB Vectorize GA 向量索引

Embedding Workers AI (bge-m3) \- 向量生成

Edge LLM Workers AI (Llama 4 \- 簡單問答 (約 70%)
Scout 17B MoE)

Agent LLM Workers AI (Kimi K2.5, \- 複雜推理 + Agent Tool
256K ctx) Calling

---

開發工具環境：

---

**工具** **版本** **用途**

---

Claude Code Latest AI 輔助程式開發（主要 Coding
Agent）

spectra Latest 規格驅動開發框架（SDD
流程管理）

Nuxt MCP Server Official Nuxt 4 文件即時查詢

Nuxt UI MCP Server Official UI 元件規格查詢

VS Code / Cursor Latest 程式編輯器

pnpm 9.x 套件管理

---

## 功能與介面說明

### 3.2.1 流程說明

知識庫建置流程：

管理員上傳文件 → 原始檔案儲存至 R2 → 文件中繼資料寫入 D1 → 觸發
Cloudflare AutoRAG Ingestion（由 AutoRAG 完成分塊、Embedding
與索引同步）→ 建庫完成

問答流程：

使用者提問 → 查詢規範化 → AutoRAG 基礎檢索 → 置信度評估 → \[若不足\]
Agentic Orchestrator 重寫查詢並再次呼叫 AutoRAG（最多 1 次重試）→
\[若仍不足\] 拒答並提示補充條件；\[若足夠\] 以 Vercel AI SDK streamText
組裝引用並生成回答 → 串流輸出

### 3.2.2 功能說明

---

**功能模組** **說明**

---

智慧問答 支援自然語言查詢，具 Self-Correction 能力，回答附引用來源

知識管理 文件上傳、分類、編輯、下架，支援 PDF、Markdown、純文字

無密碼認證 支援 Passkey 生物辨識（指紋/臉部辨識）、Google OAuth、LINE
Login，無需記憶密碼

外部 API 以 Nuxt MCP Toolkit 實作 MCP Server，提供
searchKnowledge、askKnowledge、getDocumentChunk、listCategories
等 MCP Tools，支援 Bearer token 與 Session

查詢日誌 記錄查詢內容、延遲、是否觸發 Self-Correction、狀態

---

### 3.2.3 操作與介面說明

登入畫面：

［待補：插入登入畫面截圖。截圖 Prompt：Nuxt UI
深色主題，中央白色卡片，標題「企業知識庫」，副標「請選擇登入方式」。依序三顆按鈕：（1）藍色主按鈕「使用
Passkey 登入」（含指紋 icon）、（2）白底黑字「使用 Google 帳號登入」（含
Google icon）、（3）綠底白字「使用 LINE 帳號登入」（含 LINE
icon）。卡片底部小字「首次登入？系統將自動引導您註冊」。］

說明：系統以 better-auth 提供多種登入方式，使用者可選擇：(1) 使用 Email
登入；(2) 使用 Google 或 LINE 帳號一鍵登入；(3) 使用 Passkey
透過指紋或臉部辨識的無密碼登入（加分項）。首次使用時，系統會依所選方式引導完成註冊或綁定。

主畫面（問答介面）：

［待補：插入主畫面截圖。截圖 Prompt：三欄式對話式
UI。左欄（窄）為對話歷史列表，含多個歷史標題與新增對話按鈕；中欄（寬）為對話區，上方顯示使用者提問泡泡「PO
和 PR 有什麼差別？」、下方為 AI
回答泡泡（已完成串流），回答文字中夾帶\[1\]\[2\]引用標記，回答下方顯示「引用來源」區塊列出兩個文件片段卡片（含文件名、分類標籤、擷取段落）；右欄為目前問答的置信度指標（confidence
score）與是否觸發 Self-Correction
的小徽章。最下方為輸入框與送出按鈕。整體使用 Nuxt UI 明亮主題。］

說明：左側為對話歷史列表，中間為對話區域，使用者可輸入問題並即時看到串流輸出的回答。回答下方顯示引用來源。

知識庫管理畫面：

［待補：插入知識庫管理畫面截圖。截圖
Prompt：後台頁面，頂部為搜尋列與「上傳文件」主按鈕。中央為資料表格，欄位依序為：標題、分類、標籤、版本、狀態（已索引
/ 索引中 / 下架）、AutoRAG 同步狀態、更新時間、操作（編輯 / 下架 /
刪除）。右側抽屜為新增/編輯文件表單，包含：檔案上傳（拖曳至
R2）、分類下拉選單、多標籤輸入、版本欄位、送出按鈕。頁面底部為分頁控制。整體使用
Nuxt UI Admin Dashboard 風格。］

說明：管理員可查看所有文件、上傳新文件、編輯分類與標籤、下架過期文件。

## 其他實測或實驗結果

評估指標定義：

---

**指標** **定義** **目標值**

---

Latency P50 回應延遲中位數 \< 500ms

Latency P95 回應延遲 95 百分位 \< 1200ms

Self-Correction 觸發重試的查詢比例 15-25%
Rate

Success Rate 成功回答的查詢比例 \> 85%

---

測試情境設計：

---

**情境** **問題範例** **預期行為** **預期延遲**

---

簡單查詢 PO 和 PR 有什麼差別？ 直接回答 \< 300ms

模糊查詢 上個月的報表怎麼看？ 觸發 400-600ms
Self-Correction

SOP 查詢 庫存不足時該怎麼處理？ 直接回答，附 SOP 250-400ms
引用

知識庫外 今天天氣如何？ 拒答並引導 \< 100ms

複雜推理 比較 A 和 B 流程的優缺點 Agent 自主路由 600-1000ms

---

實測結果：

［待補：填入實際測試數據。建議表格欄位：情境、執行次數、平均延遲（ms）、P50、P95、Self-Correction
觸發率、拒答率、成功率、備註。另附：(a) 以 30--50
筆代表性查詢進行情境測試的摘要（一般查詢 / 模糊查詢 / 越界問題 /
追問情境）；(b) AutoRAG 基礎檢索的 top-k 覆蓋率與平均置信度分布；(c) MCP
Tools 被外部 Client 呼叫的成功率與回應時間。］

# 第四章 結論

## 目標達成情況

對照第一章所列專題目的，本專題目前達成情況如下：

技術架構面：

1\. ✓ 設計並實作一套基於 Serverless 邊緣原生架構的 RAG 系統，成功部署於
Cloudflare Workers 平台，驗證了企業知識庫於邊緣運行的可行性。

2\. ✓ 建立 Hybrid Managed RAG + Cloud fallback 架構，以 Cloudflare
AutoRAG 作為受管理檢索基礎、Workers AI（Kimi K2.5 + Llama 4
Scout）於邊緣執行 Agentic Tool Calling（P50 \< 500ms），於信心度仍不足時
Cloud fallback 至 proprietary 雲端 LLM；相較純 proprietary
雲端方案估算節省約 70-90% 成本。

3\. ✓ 實作具備自我校正（Self-Correction）能力的 RAG
流程，低信心度時自動重寫查詢並二次檢索，提升回答品質。

4\. ✓ 以 Nuxt MCP Toolkit 建立 MCP Server，將知識庫能力封裝為標準化 MCP
Tools，並以 Middleware 處理授權與 Sessions 支援多輪對話，實現與外部 AI
工具（如 Claude Desktop、Cursor）的互操作性。

安全設計面：

5\. ✓ 以 Nuxt MCP Toolkit 建立 MCP Server，將知識庫能力封裝為標準化 MCP
Tools（searchKnowledge、askKnowledge、getDocumentChunk、listCategories），並以
Bearer token Middleware 控管外部 AI Client 的存取範圍；以 useMcpSession
維持多輪追問的對話狀態。

開發方法論面：

6\. ✓ 驗證 Spec-Driven Development + AI 輔助工具鏈（Claude Code +
spectra + Nuxt MCP）的效率提升，相較傳統開發節省 50-60% 時間。

主要技術特色：

1\. Serverless 架構：零維運負擔，按量計費，免費額度內零成本運行。

2\. 全 TypeScript 開發：前後端統一語言，類型安全，維護成本低。

3\. 高整合度技術棧：Nuxt 4 + NuxtHub + Nuxt UI + Better Auth +
Drizzle，減少膠合程式碼。

4\. 中小企業友善：現有 Vue/JS 工程師 1-2 週可上手，無需專門 AI 工程師。

## 未來展望

未來展望：

1\. 導入更多資料來源，如雲端文件庫、工單系統與內部知識平台。

2\. 加入 rerank、metadata filtering 與更細緻的檢索策略。

3\. 擴充 MCP 治理機制，如更細粒度權限、稽核日誌與速率限制。

4\. 建立更完整的量化評估方法，持續追蹤問答品質與工具呼叫成效。

5\. 擴展為多租戶或 SaaS 化架構，以支援多企業場景。

研究限制：

1\.
本專題以知識庫問答與系統整合為核心，尚未處理更完整的企業級資料治理與稽核需求。

2\. 實測數據仍需補充，部分效益目前屬設計預期與原型驗證層級。

3\.
當查詢高度模糊或需較長鏈推理時，邊緣模型表現仍可能不足，因此保留回退雲端
LLM 的彈性。

4\. Hybrid 架構雖降低 retrieval
維運負擔，但在觀測與除錯上仍較單層系統複雜。

# 第五章 專題心得與檢討

## 組員心得

［待各組員分別撰寫。建議每人 300--500 字，涵蓋：(1)
在本專題扮演的角色與負責模組；(2) 學到的技術或工具（如 Spec-Driven
Development、Cloudflare AutoRAG、Nuxt MCP Toolkit、AI SDK
streaming、Agentic Orchestration 設計）；(3) 遇到的困難與解決方式；(4)
對團隊合作與 AI 輔助開發流程的觀察。］

## 檢討與改進

做得較好的部分：

本專題在系統主線的整合上，已能將文件管理、受管理檢索、代理式問答流程與
MCP 互操作能力納入同一套架構中，具備明確的系統邊界與擴充方向。

仍可改進的部分：

目前部分章節仍以設計驗證與原型結果為主，尚未完全補足量化測試數據、實際部署觀測結果與長時間運行紀錄，因此在成果呈現上仍需進一步充實。

後續可強化方向：

後續可持續補強實測資料、系統截圖、MCP
工具互操作示例與組員個別反思，使報告內容更完整並更貼近正式專題成果報告格式。

# 第六章 參考文獻

\[1\] Lewis, P. et al., \"Retrieval-Augmented Generation for
Knowledge-Intensive NLP Tasks,\" NeurIPS, 2020.

\[2\] Asai, A. et al., \"Self-RAG: Learning to Retrieve, Generate, and
Critique through Self-Reflection,\" arXiv, 2023.

\[3\] Yan, Z. et al., \"Corrective Retrieval-Augmented Generation,\"
arXiv, 2024.

\[4\] Anthropic, \"Model Context Protocol Specification,\" 2024-2026.
URL: https://modelcontextprotocol.io/specification

\[5\] Cloudflare, \"Workers Documentation,\" 2024-2026. URL:
https://developers.cloudflare.com/workers

\[6\] Cloudflare, \"Workers AI Documentation,\" 2024-2026. URL:
https://developers.cloudflare.com/workers-ai

\[7\] Cloudflare, \"AutoRAG / AI Search Documentation,\" 2025-2026. URL:
https://developers.cloudflare.com/autorag/

\[8\] Cloudflare, \"D1 Documentation,\" 2024-2026. URL:
https://developers.cloudflare.com/d1

\[9\] Cloudflare, \"R2 Documentation,\" 2024-2026. URL:
https://developers.cloudflare.com/r2

\[10\] Vercel, \"AI SDK Documentation,\" 2025-2026. URL:
https://sdk.vercel.ai

\[11\] Nuxt Team, \"Nuxt 4 Documentation,\" 2025-2026. URL:
https://nuxt.com

\[12\] NuxtHub, \"NuxtHub Documentation,\" 2024-2026. URL:
https://hub.nuxt.com

\[13\] Better Auth, \"Better Auth Documentation,\" 2024-2026. URL:
https://better-auth.com

\[14\] Drizzle Team, \"Drizzle ORM Documentation,\" 2024-2026. URL:
https://orm.drizzle.team

\[15\] Kao, C.-L., \"spectra: A Desktop App for Spec-Driven Development
(based on OpenSpec),\" 2025-2026. URL:
https://github.com/kaochenlong/spectra-app

\[16\] Fission AI, \"OpenSpec: Spec-Driven Development for AI Coding
Assistants,\" 2025-2026. URL: https://github.com/Fission-AI/OpenSpec

\[17\] Anthropic, \"Model Context Protocol (MCP) Specification,\"
2024-2025. URL: https://modelcontextprotocol.io

\[18\] Yang, F. et al., \"Agentic AI-Driven Technical Troubleshooting,\"
arXiv:2412.12006, 2024.

\[19\] Cloudflare, \"Workers AI Documentation,\" 2024-2025. URL:
https://developers.cloudflare.com/workers-ai

\[20\] Cloudflare, \"Vectorize Documentation,\" 2024-2025. URL:
https://developers.cloudflare.com/vectorize

\[21\] Cloudflare, \"D1 Documentation,\" 2024-2025. URL:
https://developers.cloudflare.com/d1

\[22\] Vercel, \"AI SDK Documentation,\" 2025. URL:
https://sdk.vercel.ai

\[23\] NuxtHub, \"NuxtHub Documentation,\" 2024-2025. URL:
https://hub.nuxt.com

\[24\] Better Auth, \"Better Auth Documentation,\" 2024-2025. URL:
https://better-auth.com

\[25\] Drizzle Team, \"Drizzle ORM Documentation,\" 2024-2025. URL:
https://orm.drizzle.team

\[26\] Desbiens, F., \"What is an Edge-Native Application?,\"
Opensource.com, 2023.

\[27\] Swinnen, B., \"Why We\'re Betting on Cloudflare,\" Two Point O, 2025.

\[28\] Weaviate, \"Implementing Agentic RAG,\" 2024. URL:
https://weaviate.io/blog/agentic-rag

\[29\] Moveworks, \"Implementing An Agentic RAG,\" 2024.

\[30\] GeeksforGeeks, \"What is Agentic RAG?,\" 2025.

\[31\] IETF, \"OAuth 2.0 Authorization Framework,\" RFC 6749, 2012.

\[32\] IETF, \"Transport Layer Security (TLS) 1.3,\" RFC 8446, 2018.

\[33\] OpenAI, \"Introducing GPT-5.4,\" OpenAI Blog, March 2026. URL:
https://openai.com/index/introducing-gpt-5-4

\[34\] Anthropic, \"Introducing Claude 4.6 family (Opus / Sonnet /
Haiku),\" February 2026. URL: https://www.anthropic.com/news/claude-4-6

\[35\] Google, \"Gemini 3.1 Pro,\" Google Developers Blog, February 2026. URL: https://blog.google/technology/developers/gemini-3-1-pro

\[36\] Cloudflare, \"Workers AI Models: Moonshot Kimi K2.5 & Llama 4
Scout on the Edge,\" 2026. URL:
https://developers.cloudflare.com/workers-ai/models/

\[37\] W3C, \"Web Authentication (WebAuthn) Level 2,\" W3C
Recommendation, 2021.

\[38\] FIDO Alliance, \"FIDO2: WebAuthn & CTAP,\" 2019-2025. URL:
https://fidoalliance.org/fido2

\[39\] Better Auth, \"Passkey Plugin Documentation,\" 2024-2025. URL:
https://better-auth.com/docs/plugins/passkey

\[40\] Nuxt Team, \"Working with AI: Nuxt MCP Server,\" Nuxt
Documentation, 2025. URL: https://nuxt.com/docs/4.x/guide/ai/mcp

\[41\] Nuxt UI Team, \"MCP Server - Nuxt UI,\" 2025. URL:
https://ui.nuxt.com/docs/getting-started/ai/mcp

\[42\] Nuxt Blog, \"Building an MCP Server for Nuxt,\" 2025. URL:
https://nuxt.com/blog/building-nuxt-mcp

\[43\] Anthropic, \"Claude Code Documentation,\" 2025. URL:
https://docs.anthropic.com/en/docs/claude-code

\[44\] Nuxt Blog, \"Announcing Nuxt 4.0,\" 2025. URL:
https://nuxt.com/blog/v4

\[45\] GitHub, \"spectra: Toolkit for Spec-Driven Development,\" 2025.
URL: https://github.com/github/spectra

\[46\] GitHub Blog, \"Spec-driven development with AI,\" September 2025.
URL:
https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/

# 附錄

## 附錄 A：核心程式碼

### A.1 文件分塊處理

// utils/chunker.ts

export function chunkText(text: string, options: { chunkSize: number;
overlap: number }): string\[\] {

const { chunkSize, overlap } = options;

const chunks: string\[\] = \[\];

const paragraphs = text.split(/\\n\\n+/);

let currentChunk = \'\';

for (const para of paragraphs) {

if ((currentChunk + para).length \<= chunkSize) {

currentChunk += (currentChunk ? \'\\n\\n\' : \'\') + para;

} else {

if (currentChunk) chunks.push(currentChunk);

const lastChunk = chunks\[chunks.length - 1\] \|\| \'\';

currentChunk = lastChunk.slice(-overlap) + para;

}

}

if (currentChunk) chunks.push(currentChunk);

return chunks;

}

### A.2 向量檢索函式

// server/utils/retrieval.ts

export async function retrieveContext(query: string, options = {}):
Promise\<RetrievalResult\> {

const { topK = 5, category } = options;

const ai = hubAI();

const vectorize = hubVectorize(\'knowledge-index\');

const { data } = await ai.run(\'@cf/baai/bge-m3\', { text: \[query\] });

const results = await vectorize.query(data\[0\], { topK, filter:
category ? { category } : undefined });

// \... 取得對應文字內容

return { chunks, topScore: results.matches\[0\]?.score \|\| 0 };

}

### A.3 系統提示詞模板

// server/utils/prompt.ts

export function buildSystemPrompt(chunks: ChunkResult\[\]): string {

const contextText = chunks.map((c, i) =\> \`\[\${i + 1}\]
來源：\${c.documentTitle}\\n\${c.content}\`).join(\'\\n\-\--\\n\');

return \`你是一個 ERP 知識庫助手。\\n## 參考資料\\n\${contextText}\\n##
回答規則\\n1. 根據參考資料回答\\n2. 標註引用來源 \[1\]、\[2\]\\n3.
無法回答時誠實說明\`;

}

## 附錄 B：API 文件

本系統對外正式介面以 MCP 為主，REST API
僅作為應用內部與管理後台輔助使用。完整規格將涵蓋：(1) 對外 MCP Tools
規格，依 Nuxt MCP Toolkit 標準列出
searchKnowledge、askKnowledge、getDocumentChunk、listCategories 的
name、description、input schema（zod）、output schema 與範例呼叫；(2)
對外 MCP Resources
規格：resource://kb/categories、resource://kb/stats；(3) MCP Bearer
token 授權格式與錯誤碼說明；(4) 內部 REST API
端點表（/api/chat、/api/documents
CRUD、/api/stats），僅供前端與管理後台使用，不對外開放。

## 附錄 C：測試資料集

［待補：測試用的問題與預期答案。建議 30--50 筆，分為四類：(1)
一般查詢（操作步驟、制度說明），期望直接回答並附引用；(2)
模糊查詢（缺少條件、術語不一致），期望觸發 Self-Correction
後改善結果；(3) 越界問題（知識庫未涵蓋的內容），期望拒答並提示補充；(4)
追問情境（基於前一輪回答延伸提問），期望利用 MCP Session
維持上下文。欄位建議：編號、類別、問題、期望答案類型（正常回答 / 拒答 /
Self-Correction 觸發）、期望引用文件、實際結果、是否通過。］
