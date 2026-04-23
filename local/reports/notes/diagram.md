# 待補圖片與佔位 Prompt 清單

> 從 main-v0.0.6.docx 抽取，方便另外繪圖／截圖／補資料後回填。
> 章節編號為文件中對應位置；繁體中文 / 嚴格按照文件原文 prompt。

---

## A. 系統圖（繪圖類）

### A1. 系統功能圖（樹狀結構）

**章節**：2.x 系統功能說明
**類型**：樹狀結構圖
**繪圖 Prompt**：

> 以樹狀結構繪製系統功能圖，根節點為「企業知識庫 Agentic RAG 系統」，主分支包含：
>
> 1. **使用者端**：自然語言問答、對話歷史、引用查看、拒答提示
> 2. **管理後台**：文件 CRUD、分類標籤、查詢紀錄檢視、Ingestion 觸發
> 3. **Agentic 核心**：置信度評估、Query Reformulation、Self-Correction Loop、拒答判斷
> 4. **MCP 介面**：searchKnowledge、askKnowledge、getDocumentChunk、listCategories
>
> 風格：扁平化、方框與圓角、繁體中文。

---

### A2. 系統架構圖（四層水平分層）

**章節**：2.x 系統架構
**類型**：分層架構圖
**繪圖 Prompt**：

> 以四層水平分層圖呈現 Pure Edge Agentic 架構：
>
> - **第 1 層 前端層**：Nuxt 4 + Nuxt UI + @ai-sdk/vue useChat streaming
> - **第 2 層 資料與受管理檢索層**：Cloudflare Workers + NuxtHub v0.10 + Drizzle ORM + D1 + R2 + KV + Cloudflare AutoRAG
> - **第 3 層 Agentic AI 層**：Vercel AI SDK + workers-ai-provider，內含 Workers AI 多模型分層：
>   - Kimi K2.5（Agent / Tool Calling，256K ctx）
>   - Llama 4 Scout 17B MoE（簡單問答快速回應）
>   - gpt-oss-120b（備援）
>
>   處理置信度評估、Query Reformulation、Self-Correction、拒答
>
> - **第 4 層 MCP 層**：Nuxt MCP Toolkit + Middleware + Sessions + Bearer Auth
>
> 右側以箭頭連到外部 AI Client（Claude Desktop / Cursor）。
> 整張圖請以單一 Cloudflare Edge 邊界框包覆全部四層，明確呈現「全程於邊緣執行、無雲端 LLM 依賴」之特性。

---

### A3. Use Case Diagram

**章節**：2.x 系統分析與設計
**類型**：UML Use Case 圖
**繪圖 Prompt**：

> 以 UML Use Case 圖格式繪製，三個 Actor：
>
> - 一般使用者（User）
> - 系統管理員（Admin）
> - 外部 AI Client（External Agent）
>
> Use Case 包含：提問並獲得回答、查看對話歷史、查看引用來源、追問（多輪對話）、上傳文件、設定分類/標籤、觸發 Ingestion、檢視查詢日誌、呼叫 MCP searchKnowledge、呼叫 MCP askKnowledge、取得 getDocumentChunk、取得 listCategories。
>
> 請以實線連接 Actor 與 Use Case，以 `<<include>>` 標示「提問」含「Self-Correction」與「置信度評估」子流程。

---

### A4. Activity Diagram — Agentic RAG 問答流程

**章節**：2.x 核心流程設計
**類型**：UML Activity Diagram（含 Self-Correction Loop）
**繪圖 Prompt**：

> 以 UML Activity Diagram 呈現 Self-Correction Loop。流程節點依序為：
>
> 1. 使用者提問
> 2. 查詢規範化
> 3. 呼叫 AutoRAG 基礎檢索
> 4. 置信度評估（決策菱形）
>
> **分支 A（置信度足夠）**：→ 組裝引用 → 以 AI SDK streamText 生成回答 → 輸出串流 → 結束
> **分支 B（置信度不足且未重試）**：→ Query Reformulation（Agentic Orchestrator 重寫查詢）→ 回到步驟 (3)
> **分支 C（置信度不足且已重試 1 次）**：→ 拒答並提示使用者補充條件 → 結束
>
> 請於決策菱形旁標註「最多 1 次重試」以控制延遲與成本。

---

### A5. ER Diagram

**章節**：2.x 資料庫設計
**類型**：實體關聯圖（Crow's Foot notation）
**繪圖 Prompt**：

> 以實體關聯圖繪製，實體包含：
>
> - **users**(id, email, name, role, createdAt)
> - **documents**(id, title, category, tags, version, status, r2Key, autoragIndexId, uploadedBy, createdAt)
> - **queryLogs**(id, userId, query, reformulatedQuery, confidenceScore, selfCorrectionTriggered, refused, latencyMs, createdAt)
> - **sessions**(id, userId, mcpClientId, contextJson, createdAt)
>
> **關係**：
>
> - users 1─N documents
> - users 1─N queryLogs
> - users 1─N sessions
>
> 請註記主鍵（PK）與外鍵（FK），並標示 AutoRAG 管理的向量索引於 `documents.autoragIndexId` 外部關聯。

---

### A6. 甘特圖 — 20 週開發時程

**章節**：2.x 開發時程規劃
**類型**：水平甘特圖
**繪圖 Prompt**：

> 以水平甘特圖繪製 20 週開發時程，X 軸為 W1–W20，Y 軸為里程碑：
>
> | 里程碑 | 內容                                                          | 時程    |
> | ------ | ------------------------------------------------------------- | ------- |
> | M1     | 專案初始化、NuxtHub 部署、D1 Schema                           | W1–W2   |
> | M2     | better-auth 整合與角色                                        | W3–W4   |
> | M3     | 文件 CRUD、R2 上傳、AutoRAG Ingestion 串接                    | W5–W6   |
> | M4     | Agentic 問答主流程（AI SDK + workers-ai-provider + 串流輸出） | W7–W10  |
> | M5     | 置信度評估、Query Reformulation、Self-Correction Loop         | W11–W12 |
> | M6     | Nuxt MCP Toolkit（Tools、Middleware、Sessions、Bearer Auth）  | W13–W14 |
> | M7     | 效能測試、錯誤處理、UI 優化                                   | W15–W16 |
> | M8     | 報告撰寫與系統文件                                            | W17–W20 |
>
> 請以不同顏色區分 Phase 1/Phase 2/Phase 3，並在每個里程碑末標註「交付物」。

---

## B. UI 截圖類

### B1. 登入畫面

**章節**：3.x 系統實作展示
**類型**：截圖（Nuxt UI 深色主題）
**截圖 Prompt**：

> Nuxt UI 深色主題，中央白色卡片，標題「企業知識庫」，副標「請選擇登入方式」。依序三顆按鈕：
>
> 1. 藍色主按鈕「使用 Passkey 登入」（含指紋 icon）
> 2. 白底黑字「使用 Google 帳號登入」（含 Google icon）
> 3. 綠底白字「使用 LINE 帳號登入」（含 LINE icon）
>
> 卡片底部小字「首次登入？系統將自動引導您註冊」。

---

### B2. 主畫面（對話式 UI）

**章節**：3.x 系統實作展示
**類型**：截圖（Nuxt UI 明亮主題）
**截圖 Prompt**：

> 三欄式對話式 UI：
>
> - **左欄（窄）**：對話歷史列表，含多個歷史標題與「新增對話」按鈕
> - **中欄（寬）**：對話區，上方使用者提問泡泡「PO 和 PR 有什麼差別？」、下方 AI 回答泡泡（已完成串流），回答文字中夾帶 [1][2] 引用標記，回答下方顯示「引用來源」區塊列出兩個文件片段卡片（含文件名、分類標籤、擷取段落）
> - **右欄**：目前問答的置信度指標（confidence score）與是否觸發 Self-Correction 的小徽章
>
> 最下方為輸入框與送出按鈕。整體使用 Nuxt UI 明亮主題。

---

### B3. 知識庫管理畫面

**章節**：3.x 系統實作展示
**類型**：截圖（Nuxt UI Admin Dashboard 風格）
**截圖 Prompt**：

> 後台頁面，頂部為搜尋列與「上傳文件」主按鈕。
>
> **中央資料表格欄位**：標題、分類、標籤、版本、狀態（已索引 / 索引中 / 下架）、AutoRAG 同步狀態、更新時間、操作（編輯 / 下架 / 刪除）。
>
> **右側抽屜（新增/編輯文件表單）**：檔案上傳（拖曳至 R2）、分類下拉選單、多標籤輸入、版本欄位、送出按鈕。
>
> 頁面底部為分頁控制。整體使用 Nuxt UI Admin Dashboard 風格。

---

## C. 其他待補資料（非圖片，順手列出）

### C1. 測試結果數據表

**章節**：4.x 測試與評估
**待補內容**：

> 建議表格欄位：情境、執行次數、平均延遲（ms）、P50、P95、Self-Correction 觸發率、拒答率、成功率、備註。
>
> 另附：
>
> - (a) 以 30–50 筆代表性查詢進行情境測試的摘要（一般查詢 / 模糊查詢 / 越界問題 / 追問情境）
> - (b) AutoRAG 基礎檢索的 top-k 覆蓋率與平均置信度分布
> - (c) MCP Tools 被外部 Client 呼叫的成功率與回應時間

---

### C2. 完整 API 規格文件

**章節**：附錄 A
**待補內容**：

> 1. **REST API 端點詳細表**（Method / Path / 權限 / Request Schema / Response Schema / Error codes），涵蓋 `/api/chat`、`/api/documents` CRUD、`/api/stats`
> 2. **MCP Tools 規格**：依 Nuxt MCP Toolkit 標準列出 `searchKnowledge`、`askKnowledge`、`getDocumentChunk`、`listCategories` 的 name、description、input schema（zod）、output schema 與範例呼叫
> 3. **MCP Resources 規格**：`resource://kb/categories`、`resource://kb/stats`
> 4. **Bearer token 授權格式**與錯誤碼說明

---

### C3. 測試問題與預期答案集

**章節**：附錄 B
**待補內容**：

> 30–50 筆，分為四類：
>
> 1. **一般查詢**（操作步驟、制度說明）→ 期望直接回答並附引用
> 2. **模糊查詢**（缺少條件、術語不一致）→ 期望觸發 Self-Correction 後改善結果
> 3. **越界問題**（知識庫未涵蓋的內容）→ 期望拒答並提示補充
> 4. **追問情境**（基於前一輪回答延伸提問）→ 期望利用 MCP Session 維持上下文
>
> **欄位建議**：編號、類別、問題、期望答案類型（正常回答 / 拒答 / Self-Correction 觸發）、期望引用文件、實際結果、是否通過。

---

## 回填工作流程建議

1. **A1–A6 圖片**：建議用 Mermaid / draw.io / Excalidraw 依 prompt 繪製，匯出 PNG（建議 300 DPI、寬度 ≥ 1200px），插入對應章節
2. **B1–B3 截圖**：實作完成後實機截圖；若僅作示意可用 Figma / v0.dev 依 prompt 生成
3. **C1–C3 資料**：實機測試後填入；建議先建立 Excel / Markdown 紀錄
4. 回填後請更新 docx：另存新版本，不要覆寫現有版本
