國 立 雲 林 科 技 大 學

資 訊 管 理 系 人 工 智 慧 技 優 專 班

人工智慧實務專題成果報告

學號：B11123208

基於邊緣原生架構之

代理式檢索增強生成系統設計與實作

—以中小企業知識庫為例

學 生：楊鈞元

指導教授：潘得龍　博士

中華民國 115 年 4 月 21 日

# 標題頁

國立雲林科技大學資訊管理系人工智慧技優專班

人工智慧實務專題成果報告

題目：基於邊緣原生架構之代理式檢索增強生成系統設計與實作：以中小企業知識庫為例

學生：楊鈞元

學號：B11123208

指導教授：潘得龍　博士

中華民國 115 年 4 月 21 日

---

# 中文摘要

本專題以中小企業知識庫問答為情境，建置一套基於邊緣原生架構之代理式檢索增強生成系統，作為 ERP 操作指引、制度文件、報表說明與內部 SOP 的統一查詢入口。系統採混合式受管理 RAG 架構，由雲端邊緣服務負責知識檢索，應用層代理流程負責回答生成、拒答判斷、引用組裝與審計治理，以兼顧部署可行性、治理可驗證性與後續擴充彈性。

在系統設計上，前端提供 Web 問答與管理介面，後端部署於邊緣運算環境，整合資料庫、物件儲存、快取、受管理搜尋與模型閘道等服務。系統已完成可部署、可驗證、可答辯的最小閉環，包含第三方登入、三級角色權限控管、文件上傳與版本管理、知識同步、Web 問答、引用回放，以及可供外部 AI Client 呼叫的無狀態工具介面。權限治理以統一角色模型管理不同入口，確保一般使用者、管理員與訪客在 Web 與工具呼叫情境下皆遵循相同存取規則；回答產生前亦會檢查文件發布狀態、索引狀態與目前版本，避免引用過期或未公開內容。

在問答決策上，本系統採分段式信心判斷流程：先進行規則式查詢標準化與初步檢索，僅在證據處於邊界區間時啟動可回答性判斷與查詢改寫；若檢索結果仍不足，系統即產生拒答，以降低幻覺風險。驗證面以分層資料集、整合測試、引用回放與權限稽核為主，聚焦回答正確性、拒答精準性、引用可追溯性、工具契約穩定性、版本一致性與敏感資訊遮罩完整性。文件處理流程支援常見文字、文件與簡報格式進入可引用同步路徑；對於舊式格式、掃描影像或媒體內容，則以轉檔或排除策略維持引用來源的可驗證性。本專題並以自動化驗證結果與部署治理設計，作為系統完成度與答辯可行性的佐證。

關鍵字：代理式檢索增強生成（Agentic RAG）、邊緣原生架構（Edge-Native）、Cloudflare AI Search、Self-Correction、Model Context Protocol（MCP）、規格驅動開發（SDD）

---

# 目錄

本報告以 Markdown 作為定稿來源；轉為 Word / PDF 後由文書軟體依校方規範產生虛線連接與正式頁碼。以下先列正式章節層級。

中文摘要 ..................................... 頁碼由文書軟體產生

符號與用詞索引 ..................................... 頁碼由文書軟體產生

圖表索引 ..................................... 頁碼由文書軟體產生

第一章 開發計畫 ..................................... 頁碼由文書軟體產生
　第一節 發展的動機 ..................................... 頁碼由文書軟體產生
　　1.1.1 中小企業 ERP 使用的痛點 ..................................... 頁碼由文書軟體產生
　　1.1.2 傳統 RAG 系統的採用障礙 ..................................... 頁碼由文書軟體產生
　　1.1.3 Serverless 邊緣運算帶來的機會 ..................................... 頁碼由文書軟體產生
　　1.1.4 混合式架構的必要性 ..................................... 頁碼由文書軟體產生
　第二節 專題目的 ..................................... 頁碼由文書軟體產生
　　1.2.1 技術架構面 ..................................... 頁碼由文書軟體產生
　　1.2.2 安全設計面 ..................................... 頁碼由文書軟體產生
　　1.2.3 驗證與營運面 ..................................... 頁碼由文書軟體產生
　　1.2.4 核心問題 ..................................... 頁碼由文書軟體產生
　第三節 專題需求 ..................................... 頁碼由文書軟體產生
　　1.3.1 專題簡介 ..................................... 頁碼由文書軟體產生
　　1.3.2 專題架構 ..................................... 頁碼由文書軟體產生
　　1.3.3 平台能力與最小可行閉環 ..................................... 頁碼由文書軟體產生
　　1.3.4 交付版邊界 ..................................... 頁碼由文書軟體產生
　第四節 預期效益 ..................................... 頁碼由文書軟體產生

第二章 分析與設計 ..................................... 頁碼由文書軟體產生
　第一節 分析 ..................................... 頁碼由文書軟體產生
　　2.1.1 使用案例分析 ..................................... 頁碼由文書軟體產生
　　2.1.2 問答流程分析 ..................................... 頁碼由文書軟體產生
　第二節 設計 ..................................... 頁碼由文書軟體產生
　　2.2.1 資料庫設計 ..................................... 頁碼由文書軟體產生
　　2.2.2 API 與 MCP 介面設計 ..................................... 頁碼由文書軟體產生
　　2.2.3 Agent 決策規則 ..................................... 頁碼由文書軟體產生
　　2.2.4 文件生命週期 ..................................... 頁碼由文書軟體產生
　　2.2.5 引用格式規範 ..................................... 頁碼由文書軟體產生
　第三節 開發時程 ..................................... 頁碼由文書軟體產生
　第四節 其他相關設計或考量 ..................................... 頁碼由文書軟體產生
　　2.4.1 資訊安全設計 ..................................... 頁碼由文書軟體產生
　　2.4.2 與大型 LLM API 方案之比較 ..................................... 頁碼由文書軟體產生
　　2.4.3 平台限制與因應 ..................................... 頁碼由文書軟體產生
　　2.4.4 驗證與評估規劃 ..................................... 頁碼由文書軟體產生
　　2.4.5 部署成本與容量規劃 ..................................... 頁碼由文書軟體產生

第三章 實作成果 ..................................... 頁碼由文書軟體產生
　第一節 系統作業環境 ..................................... 頁碼由文書軟體產生
　　3.1.1 硬體環境 ..................................... 頁碼由文書軟體產生
　　3.1.2 軟體環境 ..................................... 頁碼由文書軟體產生
　　3.1.3 開發工具環境 ..................................... 頁碼由文書軟體產生
　第二節 功能與介面說明 ..................................... 頁碼由文書軟體產生
　　3.2.1 流程說明 ..................................... 頁碼由文書軟體產生
　　3.2.2 功能說明 ..................................... 頁碼由文書軟體產生
　　3.2.3 操作與介面說明 ..................................... 頁碼由文書軟體產生
　第三節 其他實測或實驗結果 ..................................... 頁碼由文書軟體產生
　　3.3.1 測試情境設計 ..................................... 頁碼由文書軟體產生
　　3.3.2 實測結果與正式驗收對照 ..................................... 頁碼由文書軟體產生
　　3.3.3 MCP Tool-Selection 品質量化 Eval ..................................... 頁碼由文書軟體產生

第四章 結論 ..................................... 頁碼由文書軟體產生
　第一節 目標與特色 ..................................... 頁碼由文書軟體產生
　　4.1.1 驗收對照項目 ..................................... 頁碼由文書軟體產生
　　4.1.2 技術特色與驗證層級 ..................................... 頁碼由文書軟體產生
　第二節 未來展望 ..................................... 頁碼由文書軟體產生
　　4.2.1 功能擴展方向 ..................................... 頁碼由文書軟體產生
　　4.2.2 架構演進方向 ..................................... 頁碼由文書軟體產生
　　4.2.3 研究限制 ..................................... 頁碼由文書軟體產生

第五章 專題心得與檢討 ..................................... 頁碼由文書軟體產生
　第一節 組員心得 ..................................... 頁碼由文書軟體產生
　第二節 檢討與改進 ..................................... 頁碼由文書軟體產生
　　5.2.1 已完成之規格收斂 ..................................... 頁碼由文書軟體產生
　　5.2.2 交付版限制 ..................................... 頁碼由文書軟體產生
　　5.2.3 後續補強重點 ..................................... 頁碼由文書軟體產生
　　5.2.4 Workers AI Answer Adapter 與測試 Synthesizer 取捨說明 ..................................... 頁碼由文書軟體產生

第六章 參考文獻 ..................................... 頁碼由文書軟體產生

附錄 ..................................... 頁碼由文書軟體產生
　附錄 A：MCP Tools 規格 ..................................... 頁碼由文書軟體產生
　附錄 B：測試資料集 ..................................... 頁碼由文書軟體產生
　附錄 C：答辯示範劇本（Demo Script）..................................... 頁碼由文書軟體產生
　附錄 D：部署與災難復原 ..................................... 頁碼由文書軟體產生
　附錄 E：實模型選型參考 ..................................... 頁碼由文書軟體產生

---

# 符號與用詞索引

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

| 中文用詞 | 英文對照          | 正文採用 | UI 顯示  | DB 欄位 / API 契約                              | 備註                                                            |
| -------- | ----------------- | -------- | -------- | ----------------------------------------------- | --------------------------------------------------------------- |
| 引用     | Citation          | 引用     | 引用     | citation_records、citations[].citationId        | 行內引用 【引1】、卡片稱「引用卡片」。                          |
| 拒答     | Refusal / Refused | 拒答     | 拒答     | refused: boolean、status = 'refused'            | UI 採「拒答」語彙。                                             |
| 管理員   | Admin             | 管理員   | 管理員   | role_snapshot = 'admin'、MCP scope admin.\*     | UI 一律繁中。                                                   |
| 成員     | Member            | 成員     | 成員     | role_snapshot = 'member'                        | 三級角色治理完成後新增；取代既有 'user' 角色的語意。            |
| 訪客     | Guest             | 訪客     | 訪客     | role_snapshot = 'guest'                         | 指已登入未通過 admin 升格者；未登入者不使用此稱呼。             |
| 文件     | Document          | 文件     | 文件     | documents 表、documentId                        | 不用「檔案」（檔案對應 R2 物件層）。                            |
| 版本     | Version           | 版本     | 版本     | document_versions、versionLabel                 | Current 版本一律標「current 版」。                              |
| 分類     | Category          | 分類     | 分類     | documents.category_slug、category               | 不與「標籤」混用（標籤屬後續 scope）。                          |
| 敏感等級 | Access Level      | 敏感等級 | 敏感等級 | access_level ∈ { internal, restricted }         | UI 顯示「內部」「受限」兩中文對應；正文保留英文值。             |
| 同步     | Sync              | 同步     | 同步     | sync_status、/api/documents/sync                | 指 AI Search ingestion，不與「拉取」混用。                      |
| 發布     | Publish           | 發布     | 發布     | publishDocumentVersion、published_at            | 切 current 版本的動作；不用「上架」。                           |
| 下架     | Archive           | 下架     | 下架     | documents.status = 'archived'、archive endpoint | 不用「刪除」（刪除為 hard delete 專指 draft-never-published）。 |
| 信心分數 | Confidence Score  | 信心分數 | 不顯示   | confidence_score（後續營運觀測欄位）            | 現階段 UI 不對一般使用者展示。                                  |
| 檢索分數 | Retrieval Score   | 檢索分數 | 不顯示   | retrieval_score                                 | 同上，僅 admin / debug mode 才顯示。                            |

---

# 圖表索引

本報告全文圖表合計 69 張。頁碼以正式排版後為準。

## 圖目錄

圖 1 企業知識庫 Agentic RAG 系統功能圖 ..................................... 頁碼由文書軟體產生

圖 2 Hybrid Managed RAG 邊緣原生系統架構圖 ..................................... 頁碼由文書軟體產生

圖 3 使用案例圖 ..................................... 頁碼由文書軟體產生

圖 4 Agentic RAG 問答活動圖 ..................................... 頁碼由文書軟體產生

圖 5 核心資料表 ER 圖 ..................................... 頁碼由文書軟體產生

圖 6 開發時程甘特圖 ..................................... 頁碼由文書軟體產生

圖 7 登入畫面實機畫面（2026-04-21，local dev 環境） ..................................... 頁碼由文書軟體產生

圖 8 問答主畫面實機畫面（2026-04-21，local dev 環境） ..................................... 頁碼由文書軟體產生

圖 9 知識庫管理畫面實機畫面（2026-04-21，local dev 環境） ..................................... 頁碼由文書軟體產生

圖 10 MCP Token 管理畫面實機畫面（2026-04-21，local dev 環境） ..................................... 頁碼由文書軟體產生

圖 11 成員管理畫面實機畫面（2026-04-21，local dev 環境） ..................................... 頁碼由文書軟體產生

圖 12 訪客政策設定畫面實機畫面（2026-04-21，local dev 環境） ..................................... 頁碼由文書軟體產生

圖 13 AI Gateway 用量儀表板實機畫面（2026-04-21，local dev 環境） ..................................... 頁碼由文書軟體產生

## 表目錄

表 1 現階段實作範圍與先後順序 ..................................... 頁碼由文書軟體產生

表 2 平台能力與核心閉環確認項 ..................................... 頁碼由文書軟體產生

表 3 核心驗收契約與設計原則 ..................................... 頁碼由文書軟體產生

表 4 交付版邊界與營運期觀測項 ..................................... 頁碼由文書軟體產生

表 5 主要 Actor 與使用案例 ..................................... 頁碼由文書軟體產生

表 6 查詢類型判定規則 ..................................... 頁碼由文書軟體產生

表 7 retrieval_score 構成項目 ..................................... 頁碼由文書軟體產生

表 8 user_profiles 資料表 ..................................... 頁碼由文書軟體產生

表 9 documents 資料表 ..................................... 頁碼由文書軟體產生

表 10 document_versions 資料表 ..................................... 頁碼由文書軟體產生

表 11 source_chunks 資料表 ..................................... 頁碼由文書軟體產生

表 12 conversations 資料表 ..................................... 頁碼由文書軟體產生

表 13 messages 資料表 ..................................... 頁碼由文書軟體產生

表 14 query_logs 資料表 ..................................... 頁碼由文書軟體產生

表 15 citation_records 資料表 ..................................... 頁碼由文書軟體產生

表 16 mcp_tokens 資料表 ..................................... 頁碼由文書軟體產生

表 17 內部 REST API 方法清單 ..................................... 頁碼由文書軟體產生

表 18 MCP 現階段核心工具 ..................................... 頁碼由文書軟體產生

表 19 Agent 模型角色分工 ..................................... 頁碼由文書軟體產生

表 20 第一輪檢索預設參數 ..................................... 頁碼由文書軟體產生

表 21 Self-Correction 重試參數 ..................................... 頁碼由文書軟體產生

表 22 共享設定常數與 feature flag ..................................... 頁碼由文書軟體產生

表 23 分段式決策門檻（現行做法：以 retrieval_score 單一指標 + judge 結構式回傳） ..................................... 頁碼由文書軟體產生

表 24 文件生命週期狀態轉移規則（現階段：以 document_versions.index_status + sync_status 承擔同步任務狀態機） ..................................... 頁碼由文書軟體產生

表 25 開發里程碑與週次規劃 ..................................... 頁碼由文書軟體產生

表 26 allowed_access_levels 存取矩陣 ..................................... 頁碼由文書軟體產生

表 27 部署環境與組態真相來源 ..................................... 頁碼由文書軟體產生

表 28 與純雲端 LLM 方案比較 ..................................... 頁碼由文書軟體產生

表 29 平台限制與因應方式 ..................................... 頁碼由文書軟體產生

表 30 效能與品質驗收指標 ..................................... 頁碼由文書軟體產生

表 31 現階段情境化月度運營成本估算 ..................................... 頁碼由文書軟體產生

表 32 現階段 Scale Envelope 與擴展觸發點 ..................................... 頁碼由文書軟體產生

表 33 硬體環境規格 ..................................... 頁碼由文書軟體產生

表 34 軟體環境版本 ..................................... 頁碼由文書軟體產生

表 35 開發工具版本 ..................................... 頁碼由文書軟體產生

表 36 系統功能模組說明 ..................................... 頁碼由文書軟體產生

表 37 知識庫管理操作按鈕確認策略 ..................................... 頁碼由文書軟體產生

表 38 核心測試情境設計 ..................................... 頁碼由文書軟體產生

表 39 自動化測試覆蓋 ..................................... 頁碼由文書軟體產生

表 40 TC / UI-state 測試檔對照 ..................................... 頁碼由文書軟體產生

表 41 實測情境彙總表（欄位定義；現階段以表 39 / 40 結構式自動化測試承擔） ..................................... 頁碼由文書軟體產生

表 42 TC 逐案測試結果表（欄位定義；現階段以表 40 結構式驗證代替；正式驗收後填入） ..................................... 頁碼由文書軟體產生

表 43 EV 補充證據項目 ..................................... 頁碼由文書軟體產生

表 44 交付版驗收證據整理 ..................................... 頁碼由文書軟體產生

表 45 MCP tool-selection eval 資料集覆蓋 ..................................... 頁碼由文書軟體產生

表 46 v2 baseline 結果 ..................................... 頁碼由文書軟體產生

表 47 驗收對照項目清單 ..................................... 頁碼由文書軟體產生

表 48 中小企業 ERP 痛點與本系統產品特色對照 ..................................... 頁碼由文書軟體產生

表 49 MCP scope 授權對照 ..................................... 頁碼由文書軟體產生

表 50 MCP 錯誤碼定義 ..................................... 頁碼由文書軟體產生

表 51 初始驗證測試資料集 ..................................... 頁碼由文書軟體產生

表 52 答辯示範劇本步驟 ..................................... 頁碼由文書軟體產生

表 53 部署環境變數清單 ..................................... 頁碼由文書軟體產生

表 54 現階段必要 Cloudflare 資源清單 ..................................... 頁碼由文書軟體產生

表 55 災難情境與對應復原路徑 ..................................... 頁碼由文書軟體產生

表 56 Workers AI 候選模型對照 ..................................... 頁碼由文書軟體產生

---

# 第一章 開發計畫

## 第一節 發展的動機

### 1.1.1 中小企業 ERP 使用的痛點

企業資源規劃系統通常涵蓋採購、庫存、銷售、財務、人事與報表等多個模組。對中小企業而言，ERP 的主要問題往往不是資料不足，而是既有資料與操作知識無法被快速取用。常見痛點包括以下幾項：

- 學習成本高：系統模組多、流程複雜，新進人員常需仰賴操作手冊與資深同仁帶領。
- 知識分散：SOP、FAQ、規章、教育訓練教材與報表說明分散在不同路徑，查找效率不佳。
- 知識傳承困難：隱性操作經驗難以制度化，當人員異動時容易產生斷層。
- 問題定位耗時：使用者知道問題類型，卻不一定知道正確關鍵字或文件名稱。

### 1.1.2 傳統 RAG 系統的導入與採用障礙

RAG 能透過外部知識檢索降低生成式模型的幻覺風險，已廣泛被視為企業知識問答的可行模式。然而，傳統自建 RAG 對中小企業而言仍有數項採用障礙[1][2][3]。

- 人才門檻高：需同時具備文件處理、Embedding、向量檢索、回應生成與維運能力。
- 維運成本高：若自建向量資料庫與索引流程，需持續處理資料同步、重建索引與監控告警。
- 回答品質不穩：單次靜態檢索在模糊查詢、縮寫、同義詞與跨文件比較場景下容易失準。
- 治理難度高：若直接把所有資料交給單一雲端模型，會產生資料外送、權限控管與審計紀錄不足等問題。

### 1.1.3 Serverless 邊緣運算帶來的機會

近年來 Serverless 與邊緣運算平台逐漸成熟，使中小企業能以較低門檻部署智慧應用。以 Cloudflare 生態系為例，Workers、D1、R2、KV、Workers AI 與 AI Search 已能構成從資料儲存到檢索、推論與對外介面的完整服務鏈[4][5][6][7][8]。

- 零伺服器維運：應用部署與擴展由平台負責，降低主機管理負擔。
- 邊緣近用：回應可在接近使用者的位置產生，有利於降低體感延遲。
- 原生整合：資料庫、物件儲存、Session、AI 推論與搜尋能以同平台方式整合。
- 彈性計費：早期可先以低流量驗證，待需求成形再擴展。

### 1.1.4 混合式架構的必要性

儘管邊緣推論能力持續提升，企業知識問答仍需在「成本、穩定性、治理、品質」之間取得平衡。若完全自建檢索管線，實作與維運成本偏高；若完全交由受管理 RAG 一次完成檢索與生成，則在拒答策略、引用格式、自定義審計與外部互操作方面的控制力會降低。因此，本專題採取 Hybrid Managed RAG 策略[6]：

- 檢索底層交由 Cloudflare AI Search 處理，使文件同步、轉換、分塊與檢索能力由受管理服務承擔。
- 回應生成與決策規則留在自建 Agentic Orchestration，使信心分數評估、查詢重寫、引用組裝與拒答機制由應用層掌控。
- 外部模型備援保留為條件式能力，但 Production 預設關閉，只有在治理條件通過且 feature flag 啟用時才可使用。

## 第二節 專題目的

### 1.2.1 技術架構面

- 規劃並分階段實作一套基於 Nuxt 4、NuxtHub 與 Cloudflare 邊緣服務的企業知識庫問答系統[9][10]。
- 建立以 Cloudflare AI Search 為檢索底層、以角色型模型常數（models.defaultAnswer / models.agentJudge）為決策與生成層的 Hybrid Managed RAG 架構；現行程式已具備 Workers AI answer adapter，測試環境則以 deterministic synthesizer 固定結構式驗收輸出。
- 實作包含規則式 Query Normalization、Self-Correction 單次重試、拒答與引用追溯的完整問答流程；answerability judge 以 retrieval_score >= answerMin 與證據數量的結構式判斷承擔，判斷型 LLM 呼叫列為後續規劃。
- 以 @nuxtjs/mcp-toolkit（defineMcpTool + defineMcpHandler middleware）實作 MCP Server 的 4 個核心 Tools，並保留單一 /mcp 與 knowledge.\* scope 作為對外互操作契約；現階段以 Claude remote connector 作為第一個正式 consumer，授權模型以本地使用者身分為主的 OAuth-compatible remote MCP 為主，legacy Bearer token 則限於 migration、內部驗證與非使用者型 automation[11][12][13][14]。

### 1.2.2 安全設計面

- 以 better-auth 整合 Google OAuth 與 Passkey，建立單租戶、三級角色的登入與存取控制機制；Admin / Member / Guest 的最終權限真相仍以本地使用者資料與 guest_policy 為準[15][16]。
- 現階段以部署環境變數 ADMIN_EMAIL_ALLOWLIST 作為管理員名單真相來源；管理員權限判定一律以當前 Session 內之正規化 email 對 allowlist 重新計算，D1 僅同步角色快照與 admin_source = allowlist 供 UI 與稽核使用，不另建 allowlist 資料表。
- 現階段 MCP 對外存取採雙軌設計：正式主路線為使用者授權之 OAuth-compatible remote MCP；legacy Bearer token 則保留於 migration、內部驗證與非使用者型 automation。兩者共用同一組 knowledge.\* scope、Guest policy 與 HTTPS/TLS 1.3 傳輸要求[17]。
- 系統規格涵蓋敏感資料過濾、記錄遮罩與外部模型治理邊界，確保問答流程符合企業資料治理需求。

### 1.2.3 驗證與營運面

- 建立可追溯的查詢日誌、引用紀錄、MCP 呼叫紀錄與設定快照版本，作為後續驗證依據；管理統計儀表板列為後續規劃。
- 明確區分「回答正確率」與「正確拒答率」，避免以模糊指標掩蓋系統失誤。
- 以正式測試集驗證 Web 與 MCP 兩種使用通道是否符合相同的回答品質要求。
- 以 current-version-only 雙閘驗證、可回放 citationId 與 Web/MCP 契約分流，形成本專題的三項核心設計貢獻。

### 1.2.4 核心問題

綜合上述目標，本專題在規劃與實作過程中聚焦以下三項核心問題，以對應檢索治理、回答品質與對外互操作三類驗證面向[6][12][13]。

- RQ1：在以 Cloudflare AI Search 作為受管理檢索底層時，是否能透過 D1 post-verification 與 source_chunks 設計，同時維持 current-version-only 與可回放引用？
- RQ2：以 retrieval_score、answerability judge 與單次 Self-Correction 組成的分段式問答流程，是否能在中小企業知識問答情境兼顧回答正確率與拒答精準率？
- RQ3：將 Web 對話持久化與 MCP 無狀態契約分流，是否能兼顧使用體驗、權限治理與審計可追溯性？

## 第三節 專題需求

### 1.3.1 專題簡介

本系統以企業知識庫問答為核心，將「員工查得到、管理員管得住、外部 AI Client 用得上」作為現階段範圍。目標使用者分為三類：

1. 一般使用者：查詢 SOP、制度、報表欄位意義、操作步驟與名詞說明，並可回看對話歷史與引用來源。
2. 系統管理員：維護知識庫文件、管理版本、同步 AI Search、檢視查詢紀錄、管理成員角色、設定訪客政策，並維護 legacy MCP token 與 connector 授權治理。
3. 外部 AI Client：透過 Model Context Protocol（MCP）呼叫知識查詢、問答、引用回放與分類列表能力；現階段以 Claude remote connector 與標準 MCP 工具契約作為主要整合目標。

表 1 現階段實作範圍與先後順序

| 分類     | 現階段已納入                                                                                              | 後續規劃與限制                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 身分驗證 | Google OAuth、Passkey、Admin / Member / Guest 三級角色、ADMIN_EMAIL_ALLOWLIST、guest_policy dial          | 多租戶、LINE Login 與更細權限模型另列後續，不列入成果結論                                 |
| 知識管理 | signed URL 直傳 R2、文件版本、source_chunks 預建、AI Search 同步、is_current 發布規則                     | .doc、.xls、.ppt、掃描 PDF、媒體 transcript 需先轉成可校閱文字再納入                      |
| 問答流程 | Query Normalization、AI Search 檢索、D1 post-verification、Workers AI 回答 adapter、Self-Correction、拒答 | 長期品質統計、模型替換與門檻校準需以正式驗收資料集另行鎖定                                |
| Web 介面 | 問答、新對話入口、對話歷史、引用卡片、登入與設定頁、文件管理、成員管理、訪客政策、AI Gateway 用量頁       | 核心操作流程已納入驗收證據，長期使用數據列為營運觀測                                      |
| MCP 介面 | searchKnowledge、askKnowledge、getDocumentChunk、listCategories，共用 knowledge.\* scope 與授權閘         | Production 維持無狀態；stateful MCP session / Durable Objects 尚待 SSE 與外部 Client 驗收 |
| 可觀測性 | query_logs、messages、citation_records、遮罩紀錄、決策路徑、AI Gateway usage 統計                         | 長期趨勢、保留期限自動化報表與 staging R2 seed 資料仍列為營運補強                         |

本專題定位為企業知識庫問答與治理系統，交付重點集中於文件版本、檢索回答、引用回放、權限隔離、遮罩記錄與 MCP 工具契約。ERP 交易寫回、多租戶計費、文件層級細緻 ACL、跨雲模型備援與 stateful MCP session 則歸入後續架構演進方向；此界定可使本次成果聚焦於可部署、可驗證且可答辯的核心閉環。

圖 1 企業知識庫 Agentic RAG 系統功能圖

flowchart TD
Root[企業知識庫 Agentic RAG 系統]
Root --> User[使用者端]
Root --> Admin[管理介面]
Root --> Agentic[Agentic 核心]
Root --> MCP[MCP 介面]

User --> U1[自然語言問答]
User --> U2[對話歷史]
User --> U3[引用查看]
User --> U4[拒答提示]

Admin --> A1[文件與版本管理]
Admin --> A2[AI Search 同步]
Admin --> A3[成員與訪客政策]
Admin --> A4[查詢紀錄與用量觀測]
Admin --> A5[MCP token 管理]

Agentic --> G1[Query Normalization]
Agentic --> G2[D1 post-verification]
Agentic --> G3[Workers AI 回答]
Agentic --> G4[Self-Correction]
Agentic --> G5[拒答與遮罩]

MCP --> M1[searchKnowledge]
MCP --> M2[askKnowledge]
MCP --> M3[getDocumentChunk]
MCP --> M4[listCategories]

Root -.後續.-> Future[Durable Objects MCP session / OCR / 多租戶 / 細緻 ACL]

### 1.3.2 專題架構

本系統採四層式邊緣原生架構，分為前端層、資料與受管理檢索層、Agentic AI 層與 MCP 層。整體原則為「檢索受管理、回答自建、治理先行、核心優先」。

圖 2 Hybrid Managed RAG 邊緣原生系統架構圖

flowchart LR
subgraph Client[使用入口]
Web[Nuxt Web 問答與管理介面]
External[外部 AI Client / MCP Connector]
end

subgraph Edge[Cloudflare Edge / NuxtHub]
Worker[Nuxt Nitro on Workers]
Auth[Better Auth：Google OAuth / Passkey]
RBAC[Admin / Member / Guest 權限閘]
Agent[Agentic Orchestration]
MCPServer[應用層 MCP Server]
end

subgraph Data[資料與檢索層]
D1[(D1：users / documents / logs)]
R2[(R2：原始檔與 normalized snapshot)]
KV[(KV：快取 / rate limit)]
AISearch[Cloudflare AI Search]
WorkersAI[Workers AI]
Gateway[AI Gateway]
end

Web --> Worker
External --> MCPServer
Worker --> Auth --> RBAC
Worker --> Agent
MCPServer --> RBAC
MCPServer --> Agent
Agent --> AISearch
Agent --> D1
Agent --> R2
Agent --> WorkersAI
WorkersAI --> Gateway
RBAC --> D1
Worker --> KV

Agent -.後續受控啟用.-> CloudFallback[外部模型備援]
MCPServer -.Staging 驗證中.-> DO[Durable Objects MCP session]

架構說明如下：

- 前端層：使用 Nuxt 4 與 Nuxt UI 建立問答介面、管理後台、設定頁與 connector authorization / consent 狀態頁。現階段使用者以 Google OAuth 或 Passkey 登入，並在同一前端中存取各自權限允許的對話歷史、文件管理頁與 remote MCP 授權流程[9][10][14]。
- 資料與受管理檢索層：以 R2 儲存原始文件與版本檔，D1 儲存結構化資料，KV 作為快取與 rate limit 計數器；Web Admin 文件上傳採應用層簽發一次性 signed URL 後直傳 R2。應用層需先將原始檔轉為正規化文字快照並寫入 normalized_text_r2_key，再以固定切分規則預建 source_chunks，作為引用回放真相來源。Cloudflare AI Search 連接既定資料來源後，負責 Markdown 轉換、分塊、Embedding、query rewriting、reranking 與 retrieval；應用層先以 metadata filter 套用 status = active 與可見 access_level，必要時可附帶 version_state = current 作為快篩提示，但不將遠端 metadata 視為發布真相來源。正式回答前一律以 D1 驗證 document_version_id 是否仍符合 documents.status = active、document_versions.index_status = indexed 與 document_versions.is_current = true，並要求 AI Search 回傳候選片段可對應至既有 source_chunks。D1 與正規化文字快照才是 current-version-only 與引用回放的正式真相來源，AI Search metadata 與供應商 chunk 僅作快篩、檢索與觀測用途[6][12]。
- Agentic AI 層：回答生成與流程控制由應用層掌握。現行程式已具備 Workers AI answer adapter，依 models.defaultAnswer / models.agentJudge 角色常數選擇模型，並以「只能根據證據回答」作為系統提示。檢索後先計算 retrieval_score；僅在邊界區間才觸發 judge 與查詢改寫。若 judge 回傳 reformulatedQuery，應用層重送一次檢索並再次評估；單文件、明確、程序型或事實型回答路由到 models.defaultAnswer，跨文件整合則路由到 models.agentJudge。測試環境仍保留 deterministic synthesizer 以固定驗收輸出，但正式架構不再把其視為主要回答層。
- MCP 層：以 @nuxtjs/mcp-toolkit 的 defineMcpTool 建立 4 個核心 MCP tools，對應單一 /mcp JSON-RPC endpoint；透過統一 middleware 驗證 Bearer token、OAuth-compatible remote auth context 與 scope。Production 目前採無狀態呼叫，不建立 MCP-Session-Id 相依性；Web 對話與 MCP 工具契約因此分別對應「D1 持久化對話輔助」與「單次請求契約」。Staging 保留 Durable Objects / SSE 版本用於相容性測試，通過真實 Client 驗收前不得視為 Production 成果[11][12][13]。

雖然 Cloudflare AI Search 已提供 public endpoint 與原生 MCP 能力[6][18][19]，本專題現階段仍選擇在應用層自建 MCP。主因是正式回答前必須統一經過 D1 active/indexed/current 驗證、restricted scope 檢查、source_chunks 可回放引用對應與遮罩後查詢日誌；若直接暴露供應商原生 MCP 端點，將難以保證 Web 與 MCP 共用同一套發布真相與審計規則。

Cloudflare AI Search 每個 instance 最多支援 5 個 custom metadata 欄位[6][20]。本系統現階段固定保留 4 個核心欄位：document_version_id、category、status、access_level；version_state 僅於需要輔助管理後台觀測或同步檢查時作為第 5 個選用欄位，不作正式回答的硬性判斷依據。其中 document_id 與 version_no 不再額外占用 custom metadata，而是由 folder = /kb/{category}/{document_id}/v{version_no}/ 路徑策略與 D1 回推。此設計是為了符合 AI Search custom metadata 上限，同時保留分類篩選、版本追蹤與資料治理判斷。documents.tags 僅保留於 D1 供管理後台管理與後續延伸，不同步至 AI Search，也不作為現階段 MCP 對外檢索契約參數。

### 1.3.3 平台能力與最小可行閉環

本專題的驗收重點不是功能數量，而是核心閉環是否可被重現。現階段將平台能力確認、功能驗證與降階原則整理如下。

表 2 平台能力與核心閉環確認項

| 面向       | 確認事項                                                                                       | 通過條件                                                                                   | 若未通過之降階原則                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 檢索介面   | AI Search 在目標環境可透過 Workers binding 或 API 回傳可驗證 metadata 與候選片段               | 可用 document_version_id 對應 D1 版本資料，並完成 active/indexed/current post-verification | 保留 Web 問答、文件同步與引用回放；進階 MCP filter 與外部 Client 相容性列為營運期觀測                                    |
| 引用回放   | 候選片段可穩定對應到應用層預建之 source_chunks                                                 | 任何正式回答至少一筆引用可透過 citationId 回放完整片段                                     | 若 rich format snapshot 不穩定，先使用 md、txt 或人工校閱文字版；舊式 Office、掃描 PDF 與媒體檔不作核心 pass / fail 依據 |
| 模型可用性 | Workers AI 於部署環境可完成回答生成；測試環境可用 deterministic synthesizer 固定結構式驗收輸出 | models.defaultAnswer 與 models.agentJudge 角色常數存在，回答 adapter 不改變對外契約        | 保留角色常數與治理流程，臨時以測試 adapter 驗證流程；正式成果不得把測試 adapter 說成模型品質驗收                         |
| 權限治理   | Web role、MCP scope 與 guest_policy 皆由同一套 allowed_access_levels 推導                      | Admin / Member / Guest 與 knowledge.restricted.read 能在 Web 與 MCP 入口得到一致結果       | 若某入口未通過，該入口不得視為正式成果；但不得放寬 restricted 與 existence-hiding 規則                                   |
| 通道邊界   | Web 可持久化對話，MCP Production 維持無狀態契約                                                | Web conversationId 可重整恢復；MCP Production 不要求 MCP-Session-Id                        | Durable Objects / SSE 版本僅留在 Staging 測試線，通過真實 Client 驗收前不開啟 Production flag                            |

現階段最小可行閉環如下：

1. Admin 上傳並發布一份 internal 文件，使其成為 current version。
2. 使用者針對 current 文件提問，系統回傳含有效引用的回答。
3. getDocumentChunk 可回放其中至少一筆引用。
4. 同一文件切到新版本後，舊版內容不再出現在正式回答。
5. 未具 knowledge.restricted.read 之 MCP token 與一般 Web 使用者均不得讀取 restricted 內容。
6. query_logs 與 messages 可證明高風險輸入未以原文持久化。
7. Web 對話歷史可建立、重整恢復、續問與刪除。

本系統的交付重點集中於 current-version-only、引用回放、權限隔離與遮罩記錄等治理能力；debug 視覺化、管理摘要、legacy Office、媒體與 OCR 類功能則列為後續資料來源與營運介面擴充。

### 1.3.4 交付版邊界

本節將「核心驗收契約」與「交付版邊界」分開說明。前者整理系統實作與驗收的主要依據，後者說明本報告已納入的交付證據，以及研究限制與營運期觀測項目。

表 3 核心驗收契約與設計原則

| 面向     | 核心設計項目                                                                                              | 核心驗收原則                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 版本真相 | documents.status、document_versions.index_status、is_current 與 publish transaction                       | 只有 active/indexed/current 可進入正式回答，且每份文件僅允許一個 current                                     |
| 引用真相 | normalized_text_r2_key、deterministic source_chunks、citationId 回放契約                                  | 正式回答只可引用既有 source_chunks；無有效引用不得形成正式回答                                               |
| 存取治理 | Web 角色、MCP scope、allowed_access_levels 與 existence-hiding                                            | 未授權不得讀取 restricted 內容；getDocumentChunk 必須再次驗證 scope                                          |
| 記錄治理 | messages.content_redacted、messages.content_text、query_logs.risk_flags_json / redaction_applied / status | 高風險輸入不得以原文落地；一般可見訊息以 content_text 供 UI 顯示，刪除對話時必須清空且不得回到後續模型上下文 |
| 通道邊界 | Web 對話持久化與 MCP Production 無狀態契約分流                                                            | Production 採無狀態 MCP 請求；Passkey 已納入身分驗證主線；外部模型備援作為後續架構演進項目                   |

表 4 交付版邊界與營運期觀測項

| 項目                         | 本報告處理方式                                   | 成果結論定位                                   |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| 目錄、圖表索引與正式頁碼     | Markdown 保留章節與圖表順序，Word / PDF 產生頁碼 | 排版層資訊，不影響架構與驗收結論               |
| 圖 1 至圖 6                  | 以 Mermaid 圖納入正文                            | 已作為架構、流程與資料模型說明                 |
| 表 41、表 42                 | 以 TC / EV 證據整理核心驗收結果                  | 支撐交付版驗收；更大樣本統計列為營運觀測       |
| 圖 8 與圖 13                 | 呈現目前環境下的問答主畫面與用量頁代表狀態       | 補充使用者介面證據；長期用量曲線不列為本次成果 |
| Stateful MCP / DO / SSE 驗收 | 保留於 Staging 測試線                            | 不列入 Production 成果結論                     |

因此，本報告可以明確宣稱已完成核心治理閉環、結構式驗證與交付版證據整理；長期營運統計、stateful MCP session 與大樣本實模型品質則列為研究限制與未來展望，不列入成果結論。

## 第四節 預期效益

對使用者：

- 以自然語言提問取代手動翻找文件，提高操作問題的定位效率。
- 透過引用與片段回看機制，降低對黑盒式回答的不信任感。
- 在問題資訊不足時得到明確拒答與補充方向，而非錯誤但自信的回答。

對中小企業：

- 以邊緣原生架構降低基礎設施管理複雜度，將維運工作集中在知識內容與權限治理。
- 以 AI Search 接手文件處理與檢索基礎流程，減少自建向量基礎設施的負擔。
- 透過 MCP 提供標準化知識能力，讓未來 AI 助理整合不必重新設計私有 API。
- 以不預設額外跨雲 LLM API 的 現階段降低資料外送風險，後續若擴充外部模型再由治理閘道控管。

對技術社群：

- 提供 Cloudflare AI Search、Workers AI、Nuxt MCP Toolkit 與 better-auth 的整合規格範例。
- 示範如何把受管理檢索服務與自建 Agent 決策流程分層，避免責任邊界混亂。
- 提供專題報告在規劃階段的規格化寫法，讓後續填入測試資料與截圖時有一致基準。

本節效益為設計預期，不宣稱既有成效；成本節省比例、延遲改善幅度與使用者效益須待第三章與第四章之正式驗證結果填入後方可定論。

---

# 第二章 分析與設計

本章以說明系統分析、設計與驗證依據為目標。內容可分為兩類：其一是 current-version-only、引用回放、授權隔離與記錄遮罩等核心驗收規則；其二是會隨平台版本、SDK 與部署環境微調的實作細節。前者已固定為驗收契約，後者保留調整空間，但需維持核心治理邊界一致。

## 第一節 分析

### 2.1.1 使用案例分析

圖 3 使用案例圖

flowchart LR
User([一般使用者])
Admin([系統管理員])
Agent([外部 AI Client])

Q[提問並獲得回答]
History[查看對話歷史]
Cite[查看引用來源]
Follow[追問多輪對話]
Upload[上傳文件]
Version[建立文件新版本]
Sync[觸發 AI Search 同步]
Logs[查看查詢日誌與觀測摘要]
Token[建立與撤銷 MCP token]
Search[searchKnowledge]
Ask[askKnowledge]
Chunk[getDocumentChunk]
Categories[listCategories]
Confidence[信心判斷]
Correction[Self-Correction]

User --> Q
User --> History
User --> Cite
User --> Follow
Admin --> User
Admin --> Upload
Admin --> Version
Admin --> Sync
Admin --> Logs
Admin --> Token
Agent --> Search
Agent --> Ask
Agent --> Chunk
Agent --> Categories
Q --> Confidence
Confidence -.邊界證據.-> Correction

主要 Actor 與使用案例摘要如下：

表 5 主要 Actor 與使用案例

| Actor          | Use Case               | 說明                                                  |
| -------------- | ---------------------- | ----------------------------------------------------- |
| User           | 提問並獲得回答         | 輸入自然語言問題，取得含引用與拒答能力的回答          |
| User           | 查看對話歷史           | 回顧過往問答紀錄與引用資訊                            |
| User           | 追問多輪對話           | 基於現有對話上下文延伸提問                            |
| Admin          | 上傳文件               | 建立文件與初始版本，上傳原始檔至 R2                   |
| Admin          | 建立新版本             | 為既有文件建立新版本並重新同步至 AI Search            |
| Admin          | 觸發 AI Search 同步    | 發動 instance 級同步流程，更新索引狀態                |
| Admin          | 查看查詢日誌與觀測摘要 | 檢視延遲、引用、拒答、Self-Correction 與 MCP 使用概況 |
| Admin          | 管理 MCP token         | 建立、檢視、撤銷 Bearer token 與 scope                |
| External Agent | 呼叫 searchKnowledge   | 以檢索方式取得片段結果                                |
| External Agent | 呼叫 askKnowledge      | 以問答方式取得回答與引用                              |
| External Agent | 呼叫 getDocumentChunk  | 以 citationId 取得完整引用片段                        |
| External Agent | 呼叫 listCategories    | 取得知識庫分類列表與數量                              |

### 2.1.2 問答流程分析

本系統採固定主線的 Agentic RAG 問答流程，明確區分「AI Search 負責檢索」與「應用層負責回答生成」。現階段將三層查詢處理責任凍結為：Query Normalization 僅做規則式標準化、不呼叫模型；第一輪檢索可使用 AI Search 的 rewrite_query；只有在證據不足且值得重試時，才由 models.agentJudge 執行一次 Query Reformulation。此設計可避免三層改寫互相覆蓋，並使延遲與責任邊界保持可驗證[6]。

圖 4 Agentic RAG 問答活動圖

flowchart TD
Start([使用者提問])
Normalize[規則式 Query Normalization]
Guard[權限、敏感資料與查詢類型檢查]
Block{高風險或未授權？}
Search1[AI Search 第一輪檢索<br/>rewrite_query = true]
Verify1[D1 post-verification<br/>active / indexed / current]
Score[計算 retrieval_score]
Direct{retrieval_score >= directAnswerMin？}
Low{retrieval_score < judgeMin？}
Judge[answerability judge / Query Reformulation]
Retry{需要且可重試？}
Search2[第二輪檢索<br/>rewrite_query = false]
Verify2[D1 post-verification]
Enough{證據足夠且引用可回放？}
Answer[Workers AI 回答生成]
Persist[寫入 citation_records / query_logs / messages]
Refuse[拒答並提示補充方向]
End([輸出串流或 MCP 結果])

Start --> Normalize --> Guard --> Block
Block -- 是 --> Refuse --> End
Block -- 否 --> Search1 --> Verify1 --> Score --> Direct
Direct -- 是 --> Enough
Direct -- 否 --> Low
Low -- 是 --> Refuse
Low -- 否 --> Judge --> Retry
Retry -- 是 --> Search2 --> Verify2 --> Enough
Retry -- 否 --> Enough
Enough -- 是 --> Answer --> Persist --> End
Enough -- 否 --> Refuse

問答流程與現階段預設值如下：

1. **使用者提問**：前端 Web 或 MCP Client 傳入自然語言問題。
2. **Query Normalization**：系統僅以規則式方式標準化空白、同義詞、常見 ERP 縮寫、日期寫法與分類篩選條件，不呼叫模型，也不在此階段改寫問題語意。
3. **權限、敏感資料與查詢類型檢查**：在任何模型推論前，先對查詢進行敏感資料檢測，依 Web User／Web Admin／MCP scope 推導本次 allowed_access_levels，並標示問題屬於簡單事實查詢、模糊查詢、跨文件比較或 Web 多輪追問。
4. **第一輪 AI Search 檢索**：呼叫 AI Search 搜尋 API，只取回片段不直接生成回答。實作上應優先採新 REST API 或 Workers binding 封裝，而非直接綁定舊 AutoRAG 路徑。現階段預設參數為 max_num_results = 8、ranking_options.score_threshold = 0.35、rewrite_query = true，並強制套用 status = active 與 access_level in allowed_access_levels；若遠端 metadata 已同步 version_state，可額外帶入 version_state = current 作為快篩提示，但不得把它視為發布真相。若實作採用 Workers binding 或 REST API 封裝，參數名稱可依 SDK 調整，但應以應用層抽象欄位 retrieval.maxResults、retrieval.minScore、retrieval.queryRewrite、retrieval.filters 作為內部契約，避免不同 SDK 名稱直接滲入業務規格[18][21]。取得候選片段後，應用層必須先以 D1 驗證 document_version_id 仍符合 active/indexed/current 可用版本，未通過者一律視為無效證據。
5. **第一階段信心分數評估**：現階段以通過遠端 metadata 與 D1 current 驗證之候選片段，計算 mean_top3_score 作為 retrieval_score；完整 top1_score、evidence_coverage、cross_document_gate_failed 加權公式列為後續實模型與營運觀測階段擴充。
6. **直接回答條件**：若 retrieval_score >= 0.70 且未觸發跨文件硬門檻失敗，則不再呼叫 judge，直接進入回答生成。現階段固定模型路由如下：simple_fact、single_document_procedural 與僅依單一已驗證文件延續的 Web 多輪追問，由 models.defaultAnswer 生成最終答案；跨文件比較、比較／彙整題與需兩份以上文件整合者，由 models.agentJudge 生成最終答案。
7. **邊界區間 judge**：若 0.45 <= retrieval_score < 0.70，則由 models.agentJudge 進行一次 answerability judge，並以固定 JSON schema 回傳 answerability_judge: number (0..1)、should_answer: boolean、reason: string，再合成最終 confidence_score。
8. **Self-Correction 條件**：若 confidence_score < 0.55、retrieval_score < 0.45，或跨文件硬門檻未通過，且 retry_count = 0，並且滿足以下任一條件，則由 models.agentJudge 重寫查詢後重試一次：(a) 至少存在一筆通過遠端 metadata 與 D1 驗證的候選片段可供重寫；(b) Query Normalization 已偵測到明確遺漏實體、縮寫未展開或日期條件不完整。第二輪重試停用 AI Search rewrite_query，避免雙重改寫失真。
9. **拒答條件**：若第二輪後仍 confidence_score < 0.55，或檢索結果無足夠引用，或跨文件比較仍未取得至少 2 份不同文件證據，或在授權後可用證據集合中仍無足夠有效證據，則回傳拒答結果與補充建議。
10. **引用組裝與記錄**：系統只可引用發布階段預先建立之 source_chunks；回答階段不得臨時補建 source_chunks。若候選片段無法對應既有 citationId，該片段視為無效證據，不得進入正式回答。正式回答時僅建立本次查詢的 citation_records、寫入遮罩後 query_logs，並將回答以串流方式輸出。若後續版本導入外部模型備援（Cloud fallback），亦不得繞過上述引用驗證與資料治理流程。

查詢類型的判定規則如下：

表 6 查詢類型判定規則

| 類型         | 判定條件                                                         | 用途                                 |
| ------------ | ---------------------------------------------------------------- | ------------------------------------ |
| 簡單事實查詢 | 單一名詞定義、單一流程步驟、單一文件即可回答                     | 優先走 direct path                   |
| 模糊查詢     | 問題缺少明確實體、日期、縮寫展開或文件名稱                       | 可觸發 Self-Correction               |
| 跨文件比較   | 問題包含比較、差異、彙整，或回答至少需兩份文件支持               | required_distinct_document_count = 2 |
| Web 多輪追問 | 同一 conversationId 下出現「那個」「第二步」「剛剛提到」等指代語 | 僅 Web 現階段支援                    |

補充判定原則：

- web_followup 只有在「上一則持久化 assistant 訊息之有效引用經 D1 重算後仍全部落在同一 document_id，且該文件仍存在 current 版本」時，才可沿用單文件 follow-up 路由；否則一律重新分類為 ambiguous 或 cross_document_comparison。
- 若上一則 assistant 訊息沒有有效引用、只留下 rejected_marker / redacted_only，或引用文件已非 current，該次追問不得直接走單文件 follow-up 快路徑。

現階段將 retrieval_score 收斂為「通過 D1 post-verification 後的前三名有效片段 score 平均值」，避免在實作端同時維護加權公式、跨文件硬門檻與 judge 合成分數三層變量。完整加權版本（top1 / mean_top3 / evidence_coverage 加權 + cross_document_gate_failed 硬門檻）列為後續實模型與營運觀測階段擴充：

表 7 retrieval_score 構成項目

| 版本                         | 組成                                                                                                             | 備註                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 現行做法                     | mean_top3_score = 通過 allowed_access_levels 與 D1 post-verification 之前三名片段 score 平均                     | 若無有效片段則為 0；目的在於以最少假設取得單一分數，供 direct / judge / refuse 三分支判斷                          |
| 後續實模型與營運觀測階段擴充 | 0.50 _ top1_score + 0.30 _ mean_top3_score + 0.20 \* evidence_coverage，並套用 cross_document_gate_failed 硬門檻 | evidence*coverage = 0.60 * evidence*sufficiency + 0.25 * document_diversity_score + 0.15 \* verification_integrity |

confidence*score 在 現階段不獨立計算：進入邊界區間時，由 judge 回傳的結構化 { shouldAnswer, reformulatedQuery? } 直接決定走 direct 或 self_corrected，若都不成立則 refused；confidence_score = 0.80 * retrieval*score + 0.20 * answerability_judge 的合成版本列為後續實模型與營運觀測階段擴充，屆時搭配 query_logs.judge_triggered / answerability_judge_score / confidence_score 欄位一起導入。

查詢類型分類（simple_fact / single_document_procedural / cross_document_comparison / ambiguous / web_followup / policy_blocked）以及「跨文件比較 required_distinct_document_count = 2」硬門檻列為後續治理深化階段交付；現階段以「有效證據涵蓋 >= 2 份不同文件 → 路由到 models.agentJudge；否則 → 路由到 models.defaultAnswer」的結構式條件承擔回答模型路由責任，並以 judge 失敗時的 reformulatedQuery 承擔 Self-Correction 進場條件。上述門檻值 0.35、0.45、0.55、0.70 皆為現階段預設值，屬部署設定而非對外 API 契約；正式上線前僅可依初始驗證資料集與獨立校準資料集案例校準，正式驗收資料集凍結後不得再回頭調整門檻或路由規則。

現行做法偽碼：

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

retrieval_score = mean_top3_score // 現階段凍結為此單一指標

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

實作端以 models.defaultAnswer / models.agentJudge 常數承接 Workers AI answer adapter；測試端可用 deterministic synthesizer 固定輸出，以便驗證流程、引用與拒答契約。兩者必須共用同一組 answerKnowledgeQuery 決策流程，不得因執行環境不同而改變對外行為。

## 第二節 設計

### 2.2.1 資料庫設計

本系統使用 D1（SQLite）儲存應用層的結構化資料，並以 Drizzle ORM 管理資料模型。為避免資料責任邊界混亂，本節刻意將「AI Search 管理的檢索資料」與「應用層必須保留的治理資料」區分開來。better-auth 所需的底層認證資料表由套件自動產生，以下 ER 與資料表設計聚焦在專題核心領域資料，不展開所有 auth 系統內部表[15][22]。

圖 5 核心資料表 ER 圖

erDiagram
BETTER_AUTH_USERS ||--|| USER_PROFILES : maps_to
USER_PROFILES ||--o{ DOCUMENTS : creates
USER_PROFILES ||--o{ CONVERSATIONS : owns
USER_PROFILES ||--o{ MCP_TOKENS : owns
DOCUMENTS ||--o{ DOCUMENT_VERSIONS : has
DOCUMENT_VERSIONS ||--o{ SOURCE_CHUNKS : splits_into
DOCUMENT_VERSIONS ||--o{ CITATION_RECORDS : cited_by
SOURCE_CHUNKS ||--o{ CITATION_RECORDS : replay_source
CONVERSATIONS ||--o{ MESSAGES : contains
QUERY_LOGS ||--o{ CITATION_RECORDS : records
QUERY_LOGS ||--o{ MESSAGES : audits

USER_PROFILES {
string id PK
string email_normalized
string role_snapshot
string admin_source
}
DOCUMENTS {
string id PK
string category_slug
string access_level
string status
string current_version_id FK
}
DOCUMENT_VERSIONS {
string id PK
string document_id FK
string index_status
boolean is_current
string normalized_text_r2_key
}
SOURCE_CHUNKS {
string id PK
string document_version_id FK
string citation_locator
}
QUERY_LOGS {
string id PK
string channel
string status
string decision_path
}
CITATION_RECORDS {
string id PK
string query_log_id FK
string source_chunk_id FK
string citation_id
}

source_chunks.id 是對外可回放的引用真相來源；citation_records 則是單次查詢的引用快照，用於審計與重播。document_versions.ai_search_file_id 與 AI Search 索引項目對應，但正式回答仍以 D1 版本狀態與 source_chunks 對應結果為準。

#### 2.2.1.1 核心資料表設計

**user_profiles（應用層使用者設定）**

表 8 user_profiles 資料表

| 欄位             | 類型                                    | 說明                                                                                             |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| id               | string (PK)                             | 使用者識別碼，對應 better-auth user.id                                                           |
| email_normalized | string (unique)                         | 正規化後 email，作為 allowlist 比對與稽核索引                                                    |
| display_name     | string, nullable                        | 顯示名稱                                                                                         |
| role_snapshot    | enum ('admin', 'member', 'guest')       | 三級角色快照；擴充前舊值 'user' 於資料整理時一次性升格為 'member'                                |
| admin_source     | enum ('none', 'allowlist', 'promotion') | 管理員／成員身分來源；allowlist 由 ADMIN_EMAIL_ALLOWLIST seed，promotion 代表 Admin 透過 UI 升格 |
| created_at       | timestamp                               | 建立時間                                                                                         |
| updated_at       | timestamp                               | 更新時間                                                                                         |

補充規則：

- 現階段不建立 admin_allowlists 資料表；部署環境變數 ADMIN_EMAIL_ALLOWLIST 已收斂為 **Admin seed 來源**，每次 Admin 登入由應用層比對後 upsert role = 'admin'，非 allowlist 成員則於 OAuth callback 建立為 role = 'guest'。
- 使用者完成 Google OAuth 後，應用層依 email_normalized 是否命中 allowlist 決定 role_snapshot 與 admin_source，並同步至 user_profiles；未命中者預設 role_snapshot = 'guest'、admin_source = 'none'，實際可存取範圍再由 system_settings.guest_policy dial 決定。
- Admin 專屬路由與管理後台操作在授權時，不得僅信任 role_snapshot；仍須以目前 Session email 對正規化 allowlist 重新判定，避免 allowlist 異動後殘留舊權限。
- Admin 可於 /admin/members 將 Guest 升格為 Member、或把 Member 降回 Guest；不得透過 UI 將他人設為 Admin（Admin 身分唯一真相來源為 ADMIN_EMAIL_ALLOWLIST）。升降事件一律寫入 member_role_changes 留下稽核軌跡。
- auth_source、status（啟用／停用）欄位列為後續管理介面擴充階段處理；現階段以 allowlist 與 role 控管入口權限，停用使用者改由 better-auth 的 banned 欄位承擔。

**documents（文件）**

表 9 documents 資料表

| 欄位               | 類型                                         | 說明                                                      |
| ------------------ | -------------------------------------------- | --------------------------------------------------------- |
| id                 | string (PK)                                  | 文件唯一識別碼                                            |
| slug               | string (unique)                              | 可讀分享碼，用於 URL 與 listCategories 對外顯示           |
| title              | string                                       | 文件標題                                                  |
| category_slug      | string                                       | 文件分類標識（slug）                                      |
| access_level       | enum ('internal', 'restricted')              | 敏感等級                                                  |
| status             | enum ('draft', 'active', 'archived')         | 文件狀態                                                  |
| current_version_id | string (FK → document_versions.id), nullable | 目前 current 版本指標；由發布流程維護，與 is_current 對齊 |
| created_by_user_id | string (FK → user_profiles.id), nullable     | 建立者                                                    |
| created_at         | timestamp                                    | 建立時間                                                  |
| updated_at         | timestamp                                    | 更新時間                                                  |
| archived_at        | timestamp, nullable                          | 下架時間                                                  |

補充規則：

- title 可於不改變檢索語意之前提下直接更新，不強制重同步。
- category_slug 與 access_level 屬會影響 AI Search metadata 與檢索過濾的發布級欄位；若文件已有 indexed 版本，變更後必須立即排入目標 current 版本之 metadata refresh / reindex 工作流程，並於管理後台標示「待同步」。
- documents.status 以 D1 為立即生效真相來源；即使遠端 metadata 同步仍在進行，archived 仍須立刻阻止正式回答；archived_at 作為下架時間戳，供稽核與保留期限計算使用。
- documents.status = draft 的文件版本可先完成同步與 smoke retrieval 驗證；首次 publish 時若 status 仍為 draft 且 previousCurrentVersionId 為 NULL，publish 端點將於同一原子交易內透過 DocumentPublishStore.publishVersionAtomic 的 promoteToActive 旗標自動升格為 active，不需管理員另行手動切換，以避免 draft 文件卡在無法發布的死結。若 status = archived，publish 一律回 409 Conflict 並於錯誤訊息區分 archived 情境，防止歷史歸檔文件被重啟。
- documents.status = archived 時，不要求立即清空歷史 is_current 指標，但所有正式檢索、listCategories、Web 問答與 MCP 回答皆必須排除 archived 文件；若日後重新啟用，仍須由管理員顯式確認 current 版本或重新 publish。
- current_version_id 屬衍生欄位，發布 transaction 必須同步更新 documents.current_version_id 與對應 document_versions.is_current = 1；兩者一旦不一致，以 document_versions.is_current 為準並排程修復。
- 版本建立後，其 source_r2_key、folder 與 metadata_json 視為版本快照；後續即使 documents.category_slug 調整，也不得回寫舊版路徑快照，而應以新的同步快照反映差異。
- documents.tags 欄位列為後續管理介面擴充階段處理；現階段透過 category_slug 承擔檢索面的分類過濾需求，不同步 tags 至 AI Search custom metadata。

**document_versions（文件版本）**

表 10 document_versions 資料表

| 欄位                    | 類型                                                                           | 說明                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| id                      | string (PK)                                                                    | 版本唯一識別碼                                                                                                                 |
| document_id             | string (FK → documents.id, ON DELETE CASCADE)                                  | 所屬文件                                                                                                                       |
| version_number          | integer                                                                        | 版本號，與 document_id 組成 (document_id, version_number) 唯一索引                                                             |
| source_r2_key           | string                                                                         | 原始檔於 R2 的路徑                                                                                                             |
| normalized_text_r2_key  | string, nullable                                                               | 正規化文字快照於 R2 的路徑；前處理完成前為 null，成為 source_chunks 建立、對應驗證與重新發布之真相來源                         |
| metadata_json           | json                                                                           | 同步至 AI Search 的中繼資料與版本顯示快照；至少需含 custom metadata、folder 路徑，以及供引用卡片 / getDocumentChunk 使用之快照 |
| smoke_test_queries_json | json                                                                           | 由前處理產生之代表性 smoke probes；供發布前檢索與對應驗證使用                                                                  |
| index_status            | enum ('upload_pending', 'preprocessing', 'smoke_pending', 'indexed', 'failed') | 版本可發布性真相；upload_pending 代表 R2 直傳完成並等待前處理，preprocessing 代表正在建立 normalized_text 與 source_chunks     |
| sync_status             | enum ('pending', 'running', 'completed', 'failed')                             | AI Search 遠端同步任務狀態；與 index_status 組成 現階段的同步任務狀態機，取代獨立 ingestion_jobs 表                            |
| is_current              | boolean                                                                        | 是否為目前啟用版本；以 SQLite partial unique index 保證「每 document 僅一筆 is_current = 1」                                   |
| published_at            | timestamp, nullable                                                            | 最近一次成為 current 版本的時間                                                                                                |
| created_at              | timestamp                                                                      | 建立時間                                                                                                                       |
| updated_at              | timestamp                                                                      | 最近更新時間                                                                                                                   |

補充約束：

- (document_id, version_number) 組成唯一索引；每份文件僅允許一筆 is_current = 1，由 partial unique index idx_document_versions_current_per_document 保證。
- 發布流程需在單一 transaction 中完成舊版降級與新版升級，並同步寫回 documents.current_version_id 與 document_versions.published_at。
- metadata_json 需明確保存實際送往 AI Search 的 custom metadata 與 folder 路徑快照，避免 D1 與遠端設定脫鉤。
- normalized_text_r2_key 對應的內容必須可重現後續 source_chunks；若前處理規則變更，需重新產生快照；前處理規則版本以 metadata_json.ingestion_profile_version 欄位承載，不獨立佔資料表欄位。
- smoke_test_queries_json 必須與 normalized_text_r2_key、切塊規則同批產生，且發布後視為該版本驗證快照的一部分；至少需覆蓋標題、關鍵名詞與程序片段 3 類 probe，每筆 probe 至少含 query、intent、expected_source_chunk_ids 與 min_expected_hits，不得只保存裸字串。
- published_at 僅能在成功切換為 is_current = 1 時寫入；發布者（published_by）與上傳檔案稽核資訊（checksum、mime_type、size_bytes、ai_search_file_id、indexed_at）列為後續管理介面與營運觀測擴充範圍，現階段以 metadata_json 承載上傳稽核快照、以 query_logs.user_profile_id + request_id 推論發布者身分。
- 若同一對話曾引用舊版文件，版本切換後不得把舊 assistant 回答視為新的知識真相；後續追問仍需重新檢索 current 版本。

**source_chunks（引用回放來源）**

表 11 source_chunks 資料表

| 欄位                | 類型                                                  | 說明                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                  | string (PK)                                           | 用於回放已引用片段的 citationId，對外為 opaque、高熵、不可猜測之 ID，且在 retention window 內必須全域唯一；現階段僅保證能回放既有引用，不保證跨版本或跨重切塊後維持相同值 |
| document_version_id | string (FK → document_versions.id, ON DELETE CASCADE) | 所屬文件版本                                                                                                                                                              |
| chunk_index         | integer                                               | 應用層保存之穩定順序；(document_version_id, chunk_index) 組成唯一索引，作為固定切分規則的 deterministic locator                                                           |
| chunk_hash          | string                                                | 正規化 chunk 文字後的雜湊                                                                                                                                                 |
| chunk_text          | text                                                  | 由 normalized_text_r2_key 切出的完整片段文字快照，供 getDocumentChunk 回放                                                                                                |
| citation_locator    | string                                                | 人類可讀定位資訊（heading path / 段落序 / 片段位置），供引用卡片顯示；不作為主要比對鍵                                                                                    |
| access_level        | enum ('internal', 'restricted')                       | 來自所屬文件版本的敏感等級快照；作為 MCP 與 Web 授權過濾的第二層保障                                                                                                      |
| metadata_json       | json                                                  | AI Search 觀測欄位快照（ai_search_file_id、ai_search_chunk_id、供應商 locator、短摘錄）；屬非核心欄位，欄位結構可隨供應商演進                                             |
| created_at          | timestamp                                             | 建立時間                                                                                                                                                                  |

補充規則：

- (document_version_id, chunk_index) 組成唯一索引；現階段以應用層固定切分規則保證 chunk_index 單調遞增，承擔 locator_hash 去歧義責任。供應商觀測欄位（ai_search_file_id / ai_search_chunk_id / 供應商 locator）改為存入 metadata_json，獨立的 locator_hash、locator_json、excerpt_preview 欄位列為後續實模型與營運觀測階段擴充。
- citationId 不得採連號、可推導路徑或可逆編碼；建議使用 UUIDv7、ULID 或等價高熵識別碼，避免外部以枚舉方式猜測有效引用。
- 若同一文件版本內出現完全相同文字片段，系統必須以 chunk_index + citation_locator 去歧義，不得僅以 chunk_hash 合併。
- source_chunks 由 normalized_text_r2_key 依固定切分規則預先建立，不以列舉供應商 chunk 作為前提。
- AI Search 回傳候選片段時，應以正規化文字比對、chunk_hash 與 document_version_id 對應到既有 source_chunks；若無法對應，該片段不得作為正式引用。
- 若供應商重切塊或自動轉檔結果改變，影響的是對應結果而非 source_chunks 真相來源；若對應率無法達標，應重新前處理並重新發布驗證。
- source_chunks 必須於前處理階段預先建立完成；缺少 source_chunks 的版本不得進入 smoke_pending。
- 正式回答階段只可查找既有 source_chunks 並建立 citation_records，不得在回答流程臨時補建。
- 已發布版本的 source_chunks 與 chunk_text 視為不可變快照；reindex 僅能更新 metadata_json 觀測欄位或建立新版本，不得覆寫既有引用證據。
- 一旦某筆 citationId 已出現在 citation_records，在 retention window 內不得重用到其他片段，即使原文件版本已非 current 亦同。
- 已被 citation_records 引用之 source_chunks 視為審計證據，不因版本切換、文件下架或 maintenance reindex 而立即刪除；getDocumentChunk 應在 retention window 內回放當次引用快照。

#### 2.2.1.2 引用回放來源建立策略

為讓 citationId 在供應商 chunk ID 變動、reindex 或 rich format 轉檔差異下仍可回放，現階段採「應用層 canonical text + deterministic segmentation」策略：

1. 原始檔上傳後，先由應用層產出單一正規化文字快照，寫入 normalized_text_r2_key。
2. md / txt 直接正規化；pdf / docx / xlsx / pptx 需先轉為可檢查之 canonical text snapshot，確認段落、標題、工作表 / 投影片結構與主要表格文字完整可讀後，才可進入後續流程；其中 PDF 若抽不出可選取文字（例如 scanned / image-only source）即視為 non-replayable。
3. .doc / .xls / .ppt 不直接走現階段 ingestion 路徑；應先經 conversion boundary 轉為現代 Office 或文字版，再進入 canonical snapshot 流程。
4. 音檔與影片不直接納入本階段文件 ingestion；若後續擴充，應以獨立 transcript pipeline 產出可校閱文字稿後，再進入既有 normalized_text_r2_key / source_chunks 契約。
5. 應用層以固定切分規則（標題層級、段落邊界、最大字數與最小字數）預先建立 source_chunks，並一次產生 chunk_index、citation_locator、chunk_hash、opaque citationId 與 smoke_test_queries_json；供應商觀測欄位（ai_search_file_id / ai_search_chunk_id / 供應商 locator）寫入 source_chunks.metadata_json 以便後續比對。
6. smoke_test_queries_json 至少需包含 3-5 筆代表性 probes，覆蓋文件標題／章節名、核心名詞或欄位名，以及一段可被程序型問句命中的內容；其來源必須可由 normalized_text_r2_key 重現。
7. smoke retrieval 的目的不是列舉供應商所有 chunk，而是驗證 AI Search 實際回傳之候選片段能否對應到既有 source_chunks。凡 smoke_test_queries_json 中通過權限與分數過濾的候選片段，皆必須能成功對應，否則該版本不得發布。
8. 現階段不要求不同版本、不同 reindex 或不同切塊條件下沿用相同 citationId；只要求同一已發布版本中的引用可穩定回放且可稽核。

**同步任務狀態（現階段不獨立建表）**

現階段不建立獨立的 ingestion_jobs 資料表，而是以 document_versions.index_status 與 document_versions.sync_status 兩欄組成同步任務狀態機，以避免「版本可發布性真相」與「同步任務進度真相」跨表同步難題。設計權衡如下：

| 責任             | 現階段承擔欄位                         | 狀態取值                                                                                          |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 版本可發布性真相 | document_versions.index_status         | upload_pending → preprocessing → smoke_pending → indexed / failed                                 |
| 同步任務進度真相 | document_versions.sync_status          | pending → running → completed / failed                                                            |
| 同步任務稽核資料 | document_versions.metadata_json 子欄位 | ai_search_job_id、error_message、started_at、completed_at 以 JSON 欄位保存，便於延伸而不改 schema |

補充規則：

- 同一 document_version_id 同時間僅允許一組 sync_status ∈ (pending, running) 的進行中任務；重複觸發同步請求應回傳既有進行中狀態或 409，不得重複排程。
- AI Search 遠端同步完成後，任務先進入 smoke_pending；只有 smoke retrieval 通過，index_status 才可推進為 indexed、sync_status 推進為 completed。
- smoke retrieval 屬維運用驗證流程，需以目標 document_version_id 的 smoke_test_queries_json 執行候選片段檢查，並確認可建立 source_chunks 對應；若目標版本原先不是 indexed，驗證失敗時 index_status 與 sync_status 皆應標記為 failed；若屬已 indexed 版本之 maintenance reindex，僅 sync_status 標記為 failed，index_status 仍維持最近一次可服務之 indexed 狀態。
- 獨立 ingestion_jobs 資料表（含 sync_scope、歷史任務列表、跨版本同步批次）列為後續實模型與營運觀測階段擴充；屆時可平滑將 metadata_json 中的任務稽核資料遷移至獨立表。

**conversations（Web 對話）**

表 12 conversations 資料表

| 欄位            | 類型                                     | 說明                                                                                               |
| --------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| id              | string (PK)                              | 對話唯一識別碼                                                                                     |
| user_profile_id | string (FK → user_profiles.id), nullable | 關聯使用者                                                                                         |
| access_level    | enum ('internal', 'restricted')          | 對話內目前最高敏感等級；若任一持久化 assistant 訊息引用 restricted 證據，整段對話標記為 restricted |
| title           | string                                   | 對話標題                                                                                           |
| created_at      | timestamp                                | 建立時間                                                                                           |
| updated_at      | timestamp                                | 最後更新時間                                                                                       |
| deleted_at      | timestamp, nullable                      | 使用者刪除對話之時間；一旦設定即不得再出現在一般列表、詳情 API 或後續模型上下文                    |

補充規則：

- 讀取對話列表與詳情時，必須依目前身分重新檢查 conversations.access_level。使用者若失去 restricted 權限，原 restricted 對話不得再顯示於列表或詳情 API。
- 使用者刪除對話後，該對話應立即自一般 UI、一般 API 與後續多輪上下文排除；若仍需保留稽核資料，亦僅限遮罩後副本與必要事件 metadata。
- 刪除流程若保留審計資料，對話標題與可還原原文的內容欄位應於刪除時硬刪除、清空或等價地轉為不可回復狀態，不得以一般使用者權限再次讀取。
- **實作狀態**：conversations 已完成 migration 與 API 落地；/api/chat 會在首次提問時自動建立 conversationId，後續同一對話續問沿用同一 ID。/api/conversations 列表、詳情與刪除路徑也已完成，Web 端可重整恢復歷史、切換既有對話並在刪除後立即淘汰該對話。

**messages（訊息）**

表 13 messages 資料表

| 欄位              | 類型                                            | 說明                                                                                           |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| id                | string (PK)                                     | 訊息唯一識別碼                                                                                 |
| query_log_id      | string (FK → query_logs.id, ON DELETE SET NULL) | 對應的查詢日誌，承擔「同一輪請求鏈」串接責任（取代 request_id 字串欄位）                       |
| user_profile_id   | string (FK → user_profiles.id), nullable        | 關聯使用者                                                                                     |
| channel           | enum ('web', 'mcp')                             | 來源通道                                                                                       |
| role              | enum ('system', 'user', 'assistant', 'tool')    | 訊息角色                                                                                       |
| content_redacted  | text                                            | 唯一持久化內容欄位；高風險輸入命中時僅保留遮罩後副本，通過安全檢查之輸入則保存其遮罩版本供稽核 |
| risk_flags_json   | json                                            | 命中之敏感資料規則清單                                                                         |
| redaction_applied | boolean                                         | 是否已完成記錄遮罩                                                                             |
| created_at        | timestamp                                       | 建立時間                                                                                       |

補充規則：

- messages 現階段採雙欄位：content_text 作為一般使用者可見內容，content_redacted 作為稽核安全副本。高風險 blocked 訊息僅寫入 content_redacted，content_text = NULL，因此原文不會落地。
- 前端遇到拒答或遮罩訊息時，僅可顯示固定占位訊息與遮罩後摘要，不得回顯原始輸入。
- 同一輪 Web 問答以 query_log_id 串起 user / assistant messages 與 query_logs；若因高風險規則在模型前拒答，query_logs.status = 'blocked' 並保留 query_log_id 關聯。
- Web 多輪上下文、conversation_id 串接、content_text、citations_json 與 stale 判定已完成治理深化落地；刪除對話時則以 purge policy 把該對話所有 messages.content_text 清空，只保留 content_redacted 給稽核路徑使用。
- 完整觀測欄位（request_id 獨立字串、citations_json、model_name、metadata_json）列為後續實模型與營運觀測階段擴充。

**query_logs（查詢日誌）**

表 14 query_logs 資料表

| 欄位                       | 類型                                                | 說明                                                                                                                       |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| id                         | string (PK)                                         | 日誌唯一識別碼；同時承擔「單次請求鏈」串接責任，取代獨立 request_id 欄位                                                   |
| channel                    | enum ('web', 'mcp')                                 | 來源通道                                                                                                                   |
| user_profile_id            | string (FK → user_profiles.id), nullable            | 關聯使用者                                                                                                                 |
| mcp_token_id               | string (FK → mcp_tokens.id), nullable               | 來源 token；僅 mcp 通道有值                                                                                                |
| environment                | enum ('local', 'staging', 'production')             | 部署環境，供跨環境稽核分流                                                                                                 |
| query_redacted_text        | text                                                | 唯一持久化查詢文字欄位；已完成正規化 + 遮罩                                                                                |
| risk_flags_json            | json                                                | 敏感資料、權限與政策標記                                                                                                   |
| allowed_access_levels_json | json                                                | 推導後 allowed_access_levels（例：["internal"]、["internal","restricted"]）                                                |
| redaction_applied          | boolean                                             | 是否已完成記錄遮罩                                                                                                         |
| config_snapshot_version    | string                                              | 本次查詢採用之規格常數與 feature flags 版本；現階段固定寫入 "v1"                                                           |
| status                     | enum ('accepted', 'blocked', 'rejected', 'limited') | 請求治理結果；accepted 對應正常結束（含業務拒答）、blocked 對應高風險政策阻擋、rejected 對應 401/403/422、limited 對應 429 |
| created_at                 | timestamp                                           | 建立時間                                                                                                                   |

補充規則：

- query_logs.id 同時作為 request_id：同一輪問答的 messages.query_log_id、citation_records.query_log_id 均指向此 ID，不另建字串 request_id 欄位。
- status 承擔先前分離的 request_outcome / refused / http_status 語意：業務拒答（refused = true）仍屬 accepted（治理流程順利完成），由 messages.role = assistant + risk_flags_json 佐證；rejected 僅代表授權或驗證未通過；blocked 保留給高風險政策阻擋。
- 詳細觀測欄位（operation_name、query_type、original_query_masked、normalized_query_masked、reformulated_query_masked、retrieval_filters_json、retrieval_round_count、top_k、verified_result_count、distinct_verified_document_count、cross_document_gate_failed、retrieval_score、judge_triggered、answerability_judge_score、confidence_score、decision_path、self_correction_triggered、refusal_reason_code、answer_model、decision_trace_json、http_status、first_token_latency_ms、completion_latency_ms）列為後續實模型與營運觀測階段擴充，並於屆時以獨立 migration 補上欄位與索引；現階段以 query_redacted_text + risk_flags_json + allowed_access_levels_json + status 承擔治理稽核的最小必要欄位。
- config_snapshot_version 固定為 "v1"；版本遞增由後續治理深化階段接手，屆時每次門檻或 feature flag 變動皆需遞增，並於 Preview / Production 重新跑過驗收再升版。
- 若請求在檢索前即被 401 / 403 / 422 或高風險政策阻擋終止，status 取 rejected 或 blocked；擴充後新增的 retrieval\_\*、confidence_score、decision_path、answer_model 等欄位允許為 null。

**citation_records（引用紀錄）**

表 15 citation_records 資料表

| 欄位                | 類型                                           | 說明                                                                                                 |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| id                  | string (PK)                                    | 引用快照唯一識別碼                                                                                   |
| query_log_id        | string (FK → query_logs.id, ON DELETE CASCADE) | 所屬查詢                                                                                             |
| document_version_id | string (FK → document_versions.id)             | 當次回答引用之版本快照                                                                               |
| source_chunk_id     | string (FK → source_chunks.id)                 | 對應引用回放來源                                                                                     |
| citation_locator    | string                                         | 當次引用的人類可讀定位資訊快照，與 source_chunks.citation_locator 對應                               |
| chunk_text_snapshot | text                                           | 當次引用片段全文快照；即使 source_chunks 被更新或版本下架，retention window 內仍可回放此快照         |
| created_at          | timestamp                                      | 建立時間                                                                                             |
| expires_at          | timestamp                                      | 保留到期時間，由現階段保留期限設定（預設 180 天）推算；getDocumentChunk 於 retention window 內可回放 |

補充規則：

- chunk_hash、locator_hash、ordinal、excerpt、score 欄位列為後續實模型與營運觀測階段擴充；現階段以 chunk_text_snapshot + citation_locator 承擔「可稽核 + 可回放」的最小必要快照，分數與序號資訊改由 query_logs 的 observability 欄位在擴充後承接。
- expires_at 必須在建立 citation_records 時由 config_snapshot_version 對應的 retention 設定推算寫入；retention cleanup 批次僅依 expires_at <= now() 執行實體刪除。

**mcp_tokens（MCP Bearer token）**

表 16 mcp_tokens 資料表

| 欄位               | 類型                                    | 說明                                                                                                                                    |
| ------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| id                 | string (PK)                             | Token 唯一識別碼                                                                                                                        |
| name               | string                                  | 顯示名稱（取代先前 label）                                                                                                              |
| token_hash         | string (unique)                         | 雜湊後 token 值                                                                                                                         |
| scopes_json        | json                                    | 權限範圍陣列                                                                                                                            |
| environment        | enum ('local', 'staging', 'production') | 該 token 綁定之部署環境，避免 staging token 在 production 直接可用                                                                      |
| status             | enum ('active', 'revoked', 'expired')   | 狀態                                                                                                                                    |
| created_by_user_id | string (FK → user.id)                   | 建立者；三級角色擴充後新增，用於在 MCP 入口以 token 創建者 role × guest_policy 做授權判定。此欄位先以可填入方式導入，後續再收斂為必填。 |
| expires_at         | timestamp, nullable                     | 到期時間                                                                                                                                |
| last_used_at       | timestamp, nullable                     | 最後使用時間                                                                                                                            |
| revoked_at         | timestamp, nullable                     | 撤銷時間                                                                                                                                |
| revoked_reason     | text, nullable                          | 撤銷原因描述                                                                                                                            |
| created_at         | timestamp                               | 建立時間                                                                                                                                |

補充規則：

- issued_to_user_id、revoked_by、created_by、updated_at 欄位列為後續管理介面擴充階段處理；現階段以 query_logs.mcp_token_id + query_logs.user_profile_id（管理員發放行為亦以 web 通道登記）承擔稽核串接責任，並於 revoked_reason 內以自由文字紀錄重要背景。
- 三級角色擴充後，MCP 入口 middleware 會解析 token → 查 created_by_user_id 對應 role → 若為 Guest 則依 system_settings.guest_policy 決定可否呼叫；Admin / Member token 不受 dial 限制。
- 現階段的 MCP 採無狀態呼叫，因此不建立 mcp_sessions。若後續導入多輪上下文，應另增對應 metadata table，並維持「KV 保存 runtime state、D1 僅保存 metadata」的原則。

**system_settings（三級角色擴充，單列 KV 設定）**

三級角色擴充後新增 system_settings 表，作為輕量 KV 型設定表，欄位為 (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT, updated_by TEXT NOT NULL)。現階段僅使用單一 key guest_policy，value 為 same_as_member / browse_only / no_access 三擇一（enum 由 shared/types/auth.ts 的 guestPolicySchema 在應用層驗證，不下推 DB constraint）。updated_by 接受三種值：better-auth user.id（Admin 透過 UI 變更）、'system'（初始化或自動補值）、'db-direct'（維運人員直接 SQL）。Dial 預設為 same_as_member，代表 Guest 與 Member 同權；切換為 browse_only 則 Guest 僅能瀏覽公開分類之已發布文件，不可提問；no_access 則 Guest 登入後僅見「使用者待審核」提示頁。

**member_role_changes（三級角色擴充，角色升降 audit 表）**

成員升降事件一律透過 server/utils/member-role-changes.ts 的 recordRoleChange 單一入口寫入此表，確保稽核軌跡完整。欄位為 (id TEXT PK, user_id TEXT FK → user.id, from_role TEXT, to_role TEXT, changed_by TEXT, reason TEXT nullable, created_at TEXT)；其中 changed_by 可為 user.id、'system'、'db-direct' 三類值，reason 自由文字承擔「allowlist-seed / admin-ui / manual」等操作背景。(user_id, created_at) 建立複合索引，供後續管理介面擴充階段接入讀取介面。現階段本身不提供 UI 讀取此表，內容以 wrangler d1 execute 查看。

#### 2.2.1.3 上下文與真相來源設計說明

本系統將身分與上下文區分為三層：

1. **認證核心表與登入 Session**：由 better-auth 管理，用於 Web 使用者的 Google OAuth、Passkey 與對應 Session 驗證；其他登入方式若後續擴充，仍應留在此層。
2. **應用層角色設定**：由 user_profiles 管理角色、狀態與管理員來源，不直接複製整份 auth schema；現階段的管理員名單真相來源為部署環境變數 ADMIN_EMAIL_ALLOWLIST，每次 privileged request 仍須以正規化 Session email 對 allowlist 重新計算，D1 僅保存登入後角色快照與 admin_source 供 UI、審計與查詢使用。
3. **Web 對話持久化**：Web 已支援持久化 conversationId、歷史列表、對話詳情重建與刪除淘汰。一般可見訊息會同時寫入 messages.content_text 與 messages.content_redacted；其中 content_text 供使用者 UI 與後續對話重建使用，content_redacted 僅供稽核。高風險 blocked 訊息則只寫入遮罩後副本，不寫入原文。
4. **對話可見性重算**：conversations.access_level 代表該對話目前最高敏感等級，讀取對話時必須依目前角色重新檢查；若使用者失去 restricted 權限，原受限對話不得回傳。對話一旦刪除，deleted_at 需立即生效，列表、詳情、重整後畫面與後續模型上下文皆不得再回復該對話內容。

現階段的 MCP 不承擔多輪上下文真相來源，只保存單次請求的契約輸入、輸出與審計資料。此設計的目的是避免將 Web 對話、MCP runtime state 與審計資料混寫在同一組資料表中，造成真相來源不一致。即使是 Web 多輪追問，每次回答仍需重新檢索 current 版本；若先前引用的 document_version_id 已非 current，系統應將該對話標記為 stale 並以新檢索結果為準。

### 2.2.2 API 與 MCP 介面設計

本節正文僅保留與流程責任、授權邊界與驗收直接相關的最小契約；較細的 request/response schema、internal DTO 與 SDK 命名差異，應集中收斂於附錄 A 或實作凍結規格，避免主文與供應商欄位命名雙重綁定。

#### 2.2.2.1 內部 REST API（前端與管理後台使用）

表 17 內部 REST API 方法清單

現階段首批已落地路徑：

| 方法   | 路徑                                                    | 說明                                                                                                                                     | 權限  |
| ------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| POST   | /api/chat                                               | Web 問答；非串流一次性回傳 { answer, citations, refused, conversationId, conversationCreated }，並支援以 conversationId 續問同一對話     | User  |
| GET    | /api/citations/:citationId                              | Web 端引用回放；與 MCP getDocumentChunk 共用 source_chunks.id 作為 citationId                                                            | User  |
| GET    | /api/conversations                                      | 取得目前使用者可見的對話列表                                                                                                             | User  |
| GET    | /api/conversations/:id                                  | 取得單一對話詳情與持久化訊息                                                                                                             | User  |
| DELETE | /api/conversations/:id                                  | 刪除對話；立即自列表、詳情與後續上下文淘汰，並清空 messages.content_text                                                                 | User  |
| POST   | /api/uploads/presign                                    | 取得 S3 相容協定之一次性 R2 signed URL、objectKey 與 uploadId                                                                            | Admin |
| POST   | /api/uploads/finalize                                   | 驗證 checksum、size、MIME type 並確認 staged upload                                                                                      | Admin |
| POST   | /api/documents/sync                                     | 以已 finalize 的 R2 objectKey 一次完成：建立 / 對齊 document、建立新版本、寫入 normalized_text_r2_key 與預建 source_chunks               | Admin |
| GET    | /api/admin/documents                                    | 文件列表（含 current 版本摘要）                                                                                                          | Admin |
| GET    | /api/admin/documents/:id                                | 文件詳情                                                                                                                                 | Admin |
| GET    | /api/admin/documents/check-slug                         | 檢查 slug 是否可用                                                                                                                       | Admin |
| DELETE | /api/admin/documents/:id                                | Hard delete；僅允許 status = 'draft' 且所有版本 published_at IS NULL，cascade 清除 document_versions 與 source_chunks；其餘狀態回 409    | Admin |
| POST   | /api/admin/documents/:id/archive                        | 封存文件（status: active → archived、寫入 archivedAt）；re-archive 回 no-op success                                                      | Admin |
| POST   | /api/admin/documents/:id/unarchive                      | 解除封存（status: archived → active、清除 archivedAt）；re-unarchive 回 no-op success                                                    | Admin |
| POST   | /api/admin/documents/:id/versions/:versionId/retry-sync | 重試單一版本的 AI Search 同步；sync_status: pending/failed → running，僅動 sync_status；前置 index_status = preprocessing 資料缺件回 409 | Admin |
| GET    | /api/admin/mcp-tokens                                   | 取得 MCP token 列表                                                                                                                      | Admin |
| POST   | /api/admin/mcp-tokens                                   | 建立 MCP token（原始 token 僅顯示一次）                                                                                                  | Admin |
| POST   | /api/admin/mcp-tokens/:id/revoke                        | 撤銷 MCP token                                                                                                                           | Admin |
| POST   | /api/admin/retention/\*                                 | 保留期限清理作業觸發入口（內部排程與維運手動觸發共用）                                                                                   | Admin |

延伸 API（不納入交付範圍，依治理深化、管理介面深化與營運觀測三條線分階段設計）：

| 方法 | 路徑                                            | 說明                                              | 對應擴充階段         |
| ---- | ----------------------------------------------- | ------------------------------------------------- | -------------------- |
| PUT  | /api/admin/documents/:id                        | 更新文件中繼資料                                  | 後續管理介面深化階段 |
| POST | /api/admin/documents/:id/versions               | 建立新版本（目前由 /api/documents/sync 一次承擔） | 後續管理介面深化階段 |
| POST | /api/admin/documents/:id/reindex                | 對既有版本觸發同版重同步                          | 後續管理介面深化階段 |
| POST | /api/admin/document-versions/:versionId/publish | 顯式把已 indexed 版本切換為 current               | 後續管理介面深化階段 |
| POST | /api/admin/ai-search/sync                       | 觸發 instance 級同步                              | 後續管理介面深化階段 |
| GET  | /api/admin/query-logs                           | 查詢日誌列表                                      | 後續營運觀測階段     |

備註：

- 現階段文件上傳採 staged upload 流程：Admin 先呼叫 /api/uploads/presign 取得一次性 R2 signed URL 與 uploadId，前端以 S3 相容協定直傳 R2 後，再呼叫 /api/uploads/finalize 完成 checksum、size 與 MIME type 驗證；通過後再呼叫 /api/documents/sync 一次完成「document 建立 / 對齊 → 建立新版本 → 寫 normalized_text_r2_key → 預建 source_chunks」的 happy path。
- 將 document 建立與 version 建立拆成獨立路徑（含 PUT /api/admin/documents/:id、POST /api/admin/documents/:id/versions、publish / reindex / ai-search/sync）屬後續管理介面深化範圍；擴充時，/api/documents/sync 將由以上多個細粒度路徑取代，規格上的「一律先 finalize → 後建立版本」順序不變。
- Cloudflare AI Search 已提供同步 REST API；現階段將「文件重同步」凍結為應用層工作流程：先標記目標版本、呼叫部署當下官方可用的同步能力，並由 document_versions.sync_status 與 metadata_json 回寫結果，不把供應商特定 API 直接綁死在報告規格中[18]。
- 顯式 publish 流程（POST /api/admin/document-versions/:versionId/publish）的前置條件凍結為：目標版本 index_status = indexed、該版本沒有 sync_status ∈ (pending, running) 的進行中任務；就 documents.status 而言，active 直接發布、draft 於首次 publish（previousCurrentVersionId = NULL）於同一原子交易內自動升格為 active、archived 一律回 409 Conflict 並區分 archived 情境。目標版本已是 current 時應回傳 200 與 no-op 結果。此約束在 /api/documents/sync 一次承擔階段仍須由程式自動推進「發布 = 首個完成版本」的語意。
- /api/documents/:id/reindex 擴充落地後僅用於既有 document_version_id 的同版重建與索引修復，不承載內容變更；凡內容異動一律建立新版本。若同一 document_version_id 已存在 sync_status ∈ (pending, running)，應回傳既有任務或 409，避免重複排程。

#### 2.2.2.2 MCP 現階段核心工具

表 18 MCP 現階段核心工具

| Tool 名稱        | 說明             | 輸入參數                  | 輸出                                     |
| ---------------- | ---------------- | ------------------------- | ---------------------------------------- |
| searchKnowledge  | 查詢知識庫片段   | query                     | 片段結果與 citationId                    |
| askKnowledge     | 問答並回傳引用   | query                     | 回答、引用與拒答資訊                     |
| getDocumentChunk | 取得完整引用片段 | citationId                | 片段全文與來源中繼資料                   |
| listCategories   | 列出分類與數量   | includeCounts（required） | 依呼叫者可見範圍計算之分類清單與文件數量 |

現階段將 topK / category / maxCitations 等調校參數保留至後續管理介面深化階段；擴充後仍須維持「MCP 無狀態契約 + 共用 retrieval.\* 應用層常數」原則，不得讓 MCP 自行攜帶與 Web 通道互相矛盾的檢索門檻。

所有 MCP Tools 需同時符合以下條件：

- Authorization: Bearer [token]
- token 狀態為 active
- token 具備對應 scope
- 若需存取 restricted 內容，token 必須額外具備 knowledge.restricted.read

補充規則如下：

- Web /api/chat 現階段已接受 conversationId 並用於持久化續問；MCP 則維持明確無狀態契約，拒絕 conversationId 與 MCP-Session-Id 於 header / body 中出現，若偵測到將直接回 400。
- searchKnowledge 與 askKnowledge 於檢索前即套用 allowed_access_levels 篩選。
- 對 searchKnowledge 與 askKnowledge 而言，未具 knowledge.restricted.read 只代表 restricted 不在可見集合中；若過濾後無有效證據，應回傳空結果或業務拒答，不得為了提示受限資料存在而主動回 403。
- getDocumentChunk 先解析 citationId 對應的 source_chunks，再做 scope 與 access_level 驗證。
- searchKnowledge 若查無可用結果，應回傳 200 與空陣列 results: []，不得以 404 包裝「沒有命中」。
- askKnowledge 若在授權後的可見集合中無足夠證據，應回傳 refused = true 與空引用；此情境與 401/403 協定錯誤必須分開。
- listCategories.documentCount 僅計算呼叫者目前可見之 active + current 文件數，且以文件為單位去重，不計歷史版本。

#### 2.2.2.3 MCP Resources、Dynamic Definitions、Evals

以下項目列入後續延伸方向，不納入本階段定案範圍：

- MCP Resources（如 resource://kb/categories、resource://kb/stats）
- Dynamic Definitions
- MCP Evals

### 2.2.3 Agent 決策規則

本系統將模型、檢索與決策責任拆分如下：

模型可用性與命名以 Workers AI 官方模型頁與部署當下可用清單為準[5][23]。因供應商模型清單與 alias 可能變動，現階段先固定「角色」與「路由條件」，再於 Preview 驗證通過後鎖定實際模型名稱。
本章不預先綁定候選模型名稱；正式主文、測試統計與答辯稿應只保留實際部署時鎖定的模型名稱。

#### 2.2.3.1 模型分工

表 19 Agent 模型角色分工

| 角色                                   | 實際模型鎖定原則                         | 使用情境                                                               |
| -------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| 預設回答模型 models.defaultAnswer      | 低延遲、適合單文件與程序型回答之邊緣模型 | 單文件、明確、程序型或事實型回答                                       |
| Agent 判斷與整合模型 models.agentJudge | 較強推理與結構化輸出模型                 | Query Reformulation、answerability judge、跨文件整合、比較與彙整型回答 |

現階段固定路由為：simple_fact、single_document_procedural 與僅依單一已驗證文件延續的 Web 多輪追問，由 models.defaultAnswer 生成最終答案；cross_document_comparison、比較／彙整題與需兩份以上文件整合者，由 models.agentJudge 生成最終答案。若預定模型於部署時不可用，允許更換實際模型，但不得改變路由條件、回傳契約與驗證方式；更動後需同步更新部署設定、本文件與 query_logs.config_snapshot_version。現階段不納入邊緣備援模型與雲端外部模型切換；若後續擴充，須以明確 feature flag、治理條件與驗證報告另行定義。

#### 2.2.3.2 檢索參數（現階段預設值）

第一輪檢索預設設定如下：

表 20 第一輪檢索預設參數

| 參數                            | 值                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| max_num_results                 | 8                                                                                                  |
| ranking_options.score_threshold | 0.35                                                                                               |
| reranking                       | 啟用                                                                                               |
| rewrite_query                   | true                                                                                               |
| metadata filters                | status = active、access_level in allowed_access_levels，version_state = current 若存在僅作快篩提示 |

第二輪 Self-Correction 重試設定如下：

表 21 Self-Correction 重試參數

| 參數                            | 值                |
| ------------------------------- | ----------------- |
| reformulation owner             | models.agentJudge |
| max_num_results                 | 8                 |
| ranking_options.score_threshold | 0.35              |
| reranking                       | 啟用              |
| rewrite_query                   | false             |
| metadata filters                | 與第一輪相同      |
| retry count                     | 最多 1 次         |

上述檢索參數與分數門檻皆屬現階段預設值，可於正式驗證前校準；但校準僅可使用初始驗證資料集與獨立校準資料集，且校準後需統一寫入部署設定與本文件，不得由 Web、MCP 或不同模型路徑各自維護不同常數。

#### 2.2.3.3 常數與 feature flag 凍結規則

為避免門檻值散落在 prompt、server route、MCP Tool 與前端 debug UI，現階段需以單一共享設定模組輸出以下常數：

表 22 共享設定常數與 feature flag

| 類別          | 統一鍵名                          | 現階段值 / 原則                        |
| ------------- | --------------------------------- | -------------------------------------- |
| Retrieval     | retrieval.maxResults              | 8                                      |
| Retrieval     | retrieval.minScore                | 0.35                                   |
| Retrieval     | retrieval.queryRewrite.firstPass  | true                                   |
| Retrieval     | retrieval.queryRewrite.secondPass | false                                  |
| Decision      | thresholds.directAnswerMin        | 0.70                                   |
| Decision      | thresholds.judgeMin               | 0.45                                   |
| Decision      | thresholds.answerMin              | 0.55                                   |
| Execution     | limits.maxSelfCorrectionRetry     | 1                                      |
| Models        | models.defaultAnswer              | 角色型常數；Preview 通過後鎖定實際模型 |
| Models        | models.agentJudge                 | 角色型常數；Preview 通過後鎖定實際模型 |
| Feature flags | features.passkey                  | true（staging / production 已啟用）    |
| Feature flags | features.mcpSession               | false（現階段）                        |
| Feature flags | features.cloudFallback            | false（現階段）                        |
| Feature flags | features.adminDashboard           | false（現階段）                        |

上述共享設定只能由單一 server runtime config 或等價共享模組匯出；Web route、MCP Tool、測試程式與前端 debug UI 只可讀取，不得各自 hardcode。任何常數調整都必須同步更新本文件、部署設定與 query_logs.config_snapshot_version，否則視為規格與實作脫鉤。

#### 2.2.3.4 分段式決策門檻（現階段預設值）

表 23 分段式決策門檻（現行做法：以 retrieval_score 單一指標 + judge 結構式回傳）

| 條件                                                     | 動作                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| retrieval_score >= thresholds.directAnswerMin（0.70）    | 直接回答，不觸發 judge                                                               |
| thresholds.judgeMin <= retrieval_score < directAnswerMin | 觸發 models.agentJudge，取得 { shouldAnswer, reformulatedQuery? }                    |
| judge 回傳 shouldAnswer = true                           | 以原查詢進入回答生成（記為 judge_pass）                                              |
| judge 回傳 reformulatedQuery                             | 以新查詢重試一次檢索，第二輪 mean_top3_score >= directAnswerMin 才允許回答，否則拒答 |
| retrieval_score < thresholds.judgeMin                    | 直接拒答                                                                             |

後續實模型與營運觀測階段導入 confidence_score 後，將額外加上 confidence_score < thresholds.answerMin → refuse 這一層門檻，並把「judge 回傳 shouldAnswer = false 但附帶 reformulatedQuery 的路徑」明確命名為 self_corrected。

#### 2.2.3.5 Self-Correction 觸發條件

- judge 回傳 shouldAnswer = false 且帶有 reformulatedQuery
- retry_count = 0（受 limits.maxSelfCorrectionRetry = 1 約束）
- 查詢不屬於授權阻擋或明確越界問題

現階段不仰賴「Query Normalization 辨識出明確遺漏實體」之啟發式判斷；是否值得 retry 完全由 judge 回傳的 reformulatedQuery 是否存在決定。Query Normalization / 實體辨識列為後續治理深化階段擴充，擴充後可補充一條「即使 judge 未回傳 reformulatedQuery，若偵測到遺漏實體亦可重寫」的備援路徑。

#### 2.2.3.6 拒答條件

- judge 不通過且未回傳 reformulatedQuery
- 或 Self-Correction 重試後的 mean_top3_score 仍低於 directAnswerMin
- 或有效證據數量為 0（無法建立至少一筆可信引用）
- 或敏感資料規則判定該查詢不應被回答（query_logs.status = 'blocked'）
- 或問題明確超出知識庫與系統職責範圍

跨文件比較硬門檻（required_distinct_document_count = 2）與 confidence_score < 0.55 之拒答條件列為後續治理深化階段擴充；擴充前現階段以 models.agentJudge 路由承擔跨文件整合責任。

#### 2.2.3.7 不納入現階段的外部模型備援（Cloud fallback）

現階段不啟用外部模型備援（Cloud fallback）。若後續版本擴充，必須同時滿足以下前提：

1. 以 feature flag 明確開啟，且不列入 現階段核心驗收。
2. 僅能基於已核可的引用摘錄進行整合與表述，不得重新擴張檢索結果集合。
3. restricted 內容、祕鑰、帳密與 PII 一律不得外送。
4. 需提出獨立的延遲、品質與治理驗證報告後，才可升級為正式範圍。

### 2.2.4 文件生命週期

1. **建立文件**：Admin 建立文件主檔，指定分類、標籤與敏感等級。
2. **staged upload**：原始檔先以 uploadId 暫存寫入 R2，並以 /kb/{category}/{document_id}/staged/{uploadId}/ 或等價路徑管理暫存物件。
3. **finalize 上傳**：應用層驗證 checksum、mime_type、size_bytes 與檔案存在性，通過後才建立正式版本並搬移或確認正式路徑 /kb/{category}/{document_id}/v{version_no}/。
4. **寫入版本資料**：建立 document_versions 紀錄，保存 checksum、mime_type、size_bytes、is_current = false、index_status = queued 與預期的 AI Search metadata。
5. **正規化內容**：應用層將原始檔轉為單一 normalized_text_r2_key 文字快照，並於 document_versions.metadata_json.ingestion_profile_version 記錄所用規格版本。
6. **預建引用真相來源**：依固定切分規則建立 source_chunks，此步驟先於正式發布完成，不等待供應商列舉 chunk。
7. **發起同步**：將 document_versions.sync_status 推進為 running（不另建 ingestion_jobs 資料列），觸發 instance 級同步，等待 AI Search 完成索引。
8. **遠端同步進行中**：當 AI Search 開始處理時，document_versions.index_status 轉為 smoke_pending 或維持 preprocessing（視前處理狀態），sync_status 維持 running。
9. **Smoke retrieval 對應驗證**：遠端同步回報完成後，任務與版本先進入 smoke_pending。系統需以 smoke_test_queries_json 針對目標 document_version_id 執行 representative smoke retrieval，確認各 probe 的有效候選片段可被取回，且皆可對應至既有 source_chunks。若無法建立可回放 citationId，則視為驗證失敗。
10. **標記為可發布版本**：僅當新版本 smoke retrieval 與對應驗證通過後，才可將 document_versions.index_status 標為 indexed、sync_status 標為 completed。此時版本代表「可發布」，但不會自動成為 current。
11. **管理員顯式發布版本**：現階段由 /api/documents/sync 在首次成功完成 smoke retrieval 後即把第一個版本切為 is_current = true、寫入 published_at，形成「首次發布即 current」的結構式 publish；後續版本切換與 rollback 則仰賴補上的 /api/admin/document-versions/:versionId/publish 顯式端點，以單一 transaction 完成新版升級與舊版降級。此步驟受「每份文件僅一個 is_current = 1」partial unique index 保護。首次 publish 時若 documents.status = 'draft' 且 previousCurrentVersionId 為 NULL，publish 端點需於同一原子交易內將 documents.status 自 draft 升為 active（透過 DocumentPublishStore.publishVersionAtomic 的 promoteToActive 旗標），避免 draft 文件永遠無法被推上外部檢索的死結；若 documents.status = 'archived'，publish 需直接以 409 Conflict 拒絕並於錯誤訊息區分 archived 情境，防止歷史歸檔文件被重啟。
12. **正式檢索規則**：只有 documents.status = active、document_versions.index_status = indexed、document_versions.is_current = true 的內容可進入正式回答流程。
13. **一致性保護**：AI Search metadata 僅為第一層快篩與觀測；回答前一律以 D1 post-verification 剔除非 active/indexed/current 片段，並丟棄無法對應到 source_chunks 的候選片段。若剔除後已無有效證據，則視為無結果，不得還原到舊版內容。
14. **封存文件（archive）**：將 documents.status 由 active 設為 archived、寫入 archivedAt；應用層檢索過濾立即停止對外回答，但 document_versions 與 source_chunks 保留原狀，引用歷史仍可回放至 retention 期滿。後續同步再讓 AI Search 反映最新狀態。
15. **解除封存（unarchive）**：Admin 得將 status = 'archived' 之文件還原為 active、清除 archivedAt，恢復對外檢索能力。此動作不強制重新驗證 index_status；若版本已 indexed 則立即回到可檢索，若 sync_status 仍為 failed 則需另行 retry-sync。
16. **刪除 draft（hard delete）**：僅允許 documents.status = 'draft' 且所有 document_versions.published_at IS NULL（從未發布過）的文件。透過 FK onDelete: cascade 一併清除 document_versions 與 source_chunks；已發布歷史的文件一律不得 hard delete，須改走封存流程交由 retention cleanup 期滿處理。刪除請求一律以伺服器端狀態判斷 deletability，忽略 client payload 的 force 旗標。
17. **重試同步（retry-sync）**：針對單一 document_versions，將 sync_status 由 pending 或 failed 推進為 running；僅動 sync_status，不動 index_status。觸發前需確認 index_status = preprocessing 之前置資料（normalized_text_r2_key、source_chunks）已就緒，否則回 409 Conflict 並附原因；sync_status 已為 running 或 completed 者亦回 409 拒絕，避免重複觸發 AI Search job。

狀態真相來源與轉移規則如下：

表 24 文件生命週期狀態轉移規則（現階段：以 document_versions.index_status + sync_status 承擔同步任務狀態機）

| 項目                           | 狀態           | 代表意義                              | 允許下一狀態               | 失敗 / rollback 規則                                |
| ------------------------------ | -------------- | ------------------------------------- | -------------------------- | --------------------------------------------------- |
| document_versions.index_status | upload_pending | R2 直傳完成，等待前處理               | preprocessing、failed      | 若 finalize 驗證失敗則標 failed                     |
| document_versions.index_status | preprocessing  | 正規化文字與 source_chunks 建立中     | smoke_pending、failed      | 前處理失敗即標 failed，需重新上傳                   |
| document_versions.index_status | smoke_pending  | 等待 smoke retrieval 驗證             | indexed、failed            | 驗證失敗即標 failed，不得發布                       |
| document_versions.index_status | indexed        | 已通過驗證，可作為 current 或歷史版本 | -                          | 僅在發布 transaction 成功後可成為 current           |
| document_versions.index_status | failed         | 同步或驗證失敗                        | upload_pending（重新上傳） | 不允許原地 retry，避免誤用舊 R2 物件                |
| document_versions.sync_status  | pending        | 等待觸發 AI Search 同步               | running、failed            | —                                                   |
| document_versions.sync_status  | running        | AI Search 正在處理                    | completed、failed          | 遠端回報異常即轉 failed                             |
| document_versions.sync_status  | completed      | 同步與 smoke retrieval 全部完成       | running（maintenance 時）  | maintenance reindex 可重新回到 running              |
| document_versions.sync_status  | failed         | 同步任務失敗                          | running（手動 retry）      | 失敗僅影響同步任務本身，不會連帶把 indexed 版本降階 |

- document_versions.index_status 是版本可發布性真相來源；document_versions.sync_status 是同步任務進度真相來源。兩者不得互相覆蓋語意，稽核資訊（ai_search_job_id / error_message / started_at / completed_at）寫入 document_versions.metadata_json；若後續另拆出獨立 ingestion_jobs 表，再把這些欄位遷移出去。
- 發布 transaction 若失敗，舊版 is_current = true 必須維持不變；新版本保留 indexed 但 is_current = false，由管理員明確重試發布，不得半套切換。
- 對已 indexed 版本執行顯式 reindex 時，不先將 index_status 降為其他狀態；只把 sync_status 重新轉為 running，通過後更新 metadata_json 快照。
- 對已 indexed 版本執行 maintenance reindex 若失敗，不得把目前可服務版本的 index_status 降為 failed；應僅標記該次 sync_status = failed 並保留先前成功的 indexed 快照，由管理員重試。
- AI Search 同步觸發若遭遇冷卻期（sync_in_cooldown），應視為暫時性狀況而非失敗：sync_status 維持或轉回 pending、不寫入 error_message、不觸發告警；由排程或後續上傳事件自然重試。
- AI Search 任務狀態由 started_at、ended_at、end_reason 三欄推導：未 started_at 視為 pending；已 started_at 但無 ended_at 視為 running；已 ended_at 且 end_reason 非空視為 failed（以 end_reason 為 error_message）；已 ended_at 且 end_reason 為空視為 completed。

#### 2.2.4.1 上傳與 Ingestion Guardrails

為避免文件管理規格與 AI Search 實際限制脫節，現階段補充以下上傳與 ingestion 邊界：

- 現階段核心驗收資料集與正式驗收統計，可納入 md、txt 與已通過 canonical snapshot 驗證之 pdf、docx、xlsx、pptx；.doc、.xls、.ppt、音檔 / 影片與 scanned / image-only PDF 不作本階段核心 pass/fail 依據。
- 現階段 Web 上傳一律採一次性 signed URL 直傳 R2；應用伺服器不轉送大檔，僅負責簽發 upload URL、驗證 metadata、產生 normalized_text_r2_key 與建立版本紀錄。
- rich format 文件（例如 pdf、docx、xlsx、pptx）若超出 Cloudflare AI Search 當前公開限制，應在上傳前提示管理員改傳 Markdown/TXT，或先經應用層轉換為 canonical text snapshot 後再同步；答辯核心資料集不得把供應商自動轉檔當成唯一相依路徑。以 2026-04 查核時，官方公開 rich format 上限已提升至 4 MB[18]。
- .doc、.xls、.ppt 與音檔 / 影片若要納入後續規劃，應分別透過 conversion path 與 transcript pipeline 先產出可校閱文字稿，再進入既有 normalized_text_r2_key / source_chunks 契約，而非直接共用目前同步 request path。
- 上傳流程需在建立 document_versions 前先完成副檔名、MIME type、檔案大小與 checksum 驗證；未通過者不得進入 queued。
- scanned / image-only PDF 可通過上傳與 checksum 驗證，但若 extraction 後無法產出可引用文字，sync 應以 non-replayable 4xx 失敗，並明確提示管理員改提供可選取文字版本或先整理成 Markdown。
- 若 rich format 轉檔後的 normalized_text_r2_key 出現缺段、段落錯位或主要表格文字流失到無法引用，該版本不得進入同步；必要時應改以人工整理之 Markdown 作為核心驗收版本來源。
- smoke retrieval 驗證除確認可檢回片段外，亦需確認片段文字皆可對應至既有 source_chunks；若只能取得摘要、無法對應或對應後內容不足以回放，該版本不得發布。
- 現階段不把供應商的自動轉檔品質視為保證值；若同一來源在不同 reindex 產生明顯不同切塊，應以最新發布版本重新驗證，而非假定舊有 chunk 對應仍然有效。
- rich format 若要納入正式驗收，必須先在初始驗證資料集與校準資料集證明 smoke probes、引用對應率與 getDocumentChunk 回放皆穩定，再升級進入正式驗收資料集。
- 上傳檔名消毒（sanitizeFilename）須保留 Unicode 字元（中文、日文、韓文、emoji 等），採 NFC normalize + 黑名單過濾（/ \ : \* ? " < > | 與 \u0000-\u001F\u007F 控制字元），而非以 ASCII whitelist 無差別剝除；避免 採購流程.md 之類的中文檔名被消毒成 .md 或 upload.bin，造成 admin 失去可辨識的真實檔名。消毒後若 base name 為空或僅剩副檔名，以 upload-[uploadId 前 8 碼].[ext] 作 deterministic fallback；UTF-8 byte length 超過 255 時按字元邊界從 base name 尾端截斷，保留副檔名。

### 2.2.5 引用格式規範

回答中的引用採以下格式：

- **行內引用**：以 【引1】、【引2】 等標記嵌入回答文字中，避免與參考文獻編號混淆。
- **來源卡片**：回答下方列出引用來源，包含文件標題、版本、分類與摘錄文字。
- **工具追溯**：每一筆引用都必須先對應至 source_chunks.id，再由 getDocumentChunk 以版本範圍內可回放的 citationId 取回完整片段。

引用區塊格式如下：

【引1】《採購流程作業手冊》 v3 - 採購管理
"PO 建立後需經主管核准，核准完成方可轉為 PR 流程的下游採購需求。"

對外顯示時不暴露 ai_search_file_id、ai_search_chunk_id 等供應商內部識別碼；此類欄位僅保留於 source_chunks 以利審計與除錯。searchKnowledge / askKnowledge 的回答 eligibility 僅以 current 版本為準；getDocumentChunk 則讀取當次已被引用之版本快照，仍受授權與 retention 規則限制。
引用卡片與 getDocumentChunk 對外顯示之 documentTitle、category、versionLabel，應優先取自 document_versions.metadata_json 內的版本顯示快照，而非直接讀取 documents 的可變欄位，以避免文件改名或改分類後造成歷史引用回放內容漂移。

## 第三節 開發時程

圖 6 開發時程甘特圖

gantt
title Nuxt Edge Agentic RAG 開發時程
dateFormat YYYY-MM-DD
axisFormat W%V

section 基礎建置
M1 專案初始化、NuxtHub、D1 Schema :m1, 2026-01-05, 14d
M2 Google OAuth、ADMIN_EMAIL_ALLOWLIST :m2, after m1, 7d

section 知識管理
M3 文件管理、版本管理、R2、AI Search :m3, after m2, 14d

section 問答與治理
M4 問答主流程、引用、對話歷史 :m4, after m3, 21d
M5 信心判斷、Self-Correction、拒答 :m5, after m4, 14d

section 對外互操作
M6 MCP Tools、Middleware、token 管理 :m6, after m5, 7d

section 驗證與交付
M7 查詢日誌、rate limit、retention、錯誤處理 :m7, after m6, 14d
M8 測試驗證、正式統計、報告與答辯資料 :m8, after m7, 14d

表 25 開發里程碑與週次規劃

| 階段 | 週次   | 任務                                        | 交付物                   |
| ---- | ------ | ------------------------------------------- | ------------------------ |
| M1   | W1-2   | 專案初始化、NuxtHub 部署、D1 Schema         | 可部署專案骨架           |
| M2   | W3     | Google OAuth、ADMIN_EMAIL_ALLOWLIST         | 可登入並具角色控管的系統 |
| M3   | W4-5   | 文件管理、版本管理、R2 上傳、AI Search 同步 | 可維護的知識庫管理後台   |
| M4   | W6-8   | 問答主流程、引用、對話歷史                  | 基本問答功能             |
| M5   | W9-10  | 信心分數評估、Self-Correction、拒答         | 智慧問答能力             |
| M6   | W11    | MCP Tools、Bearer token                     | 可互操作的 MCP Server    |
| M7   | W12-13 | 查詢日誌、rate limit、保留期限、錯誤處理    | 可觀測與可治理版本       |
| M8   | W14-15 | 測試驗證、正式統計、報告與答辯資料          | 完整專題交付物           |

若時程受壓，應優先完成 1.3.3 所定義之最小可行閉環，再處理 MCP 契約擴充、legacy Office / 媒體 / OCR 類延伸與畫面優化；並維持 current-version-only、引用回放與權限治理等核心驗收原則。

## 第四節 其他相關設計或考量

### 2.4.1 資訊安全設計

#### 2.4.1.1 身分驗證與角色控制

- 現階段採 better-auth 整合 Google OAuth 與 Passkey，並以 user_profiles 承接 Admin/Member/Guest 三級角色、狀態與身分來源；Passkey 已在 staging / production 啟用，且其 build-time / runtime 設定必須一致[15][16][24]。
- 三級角色擴充已將授權模型由「Admin vs 非 Admin」二元模型升級為三級 RBAC：
  - **Admin**：管理全部功能；身分唯一真相來源為部署環境變數 ADMIN_EMAIL_ALLOWLIST。所有 Admin 專屬操作於授權時仍須依目前 Session email 重新比對 allowlist，不得僅依據既有 D1 角色快照。
  - **Member**：已由 Admin 確認的成員；擁有完整 Web 問答與 MCP 使用權限，可讀取 internal 文件；遇 restricted 文件仍需再由文件 access_level 與 token scope 判定。
  - **Guest**：已完成 Google OAuth 但未被 Admin 升格者；可存取範圍由 system_settings.guest_policy dial（same_as_member / browse_only / no_access）決定。
- ADMIN_EMAIL_ALLOWLIST 語義從「允許登入閘門」收斂為「Admin seed 來源」：非 allowlist 成員仍可完成 OAuth，建立為 Guest 後由 Admin 於 /admin/members 升為 Member。此調整避免「新成員無法登入 → 只能找 Admin 改 env var → 重新部署」之循環，同時保持 Admin 升權以 allowlist 為單一入口。
- guest_policy dial 同時控制 Web 與 MCP 入口：Web /chat 於 browse_only / no_access 時以 GuestAccessGate 元件呈現對應狀態（非靜默失敗或退化為 404）；MCP 則由 middleware 解析 token created_by_user_id → 查對應 role → 若為 Guest 則依 dial 判定是否放行。
- 一般 Member 使用者預設僅可檢索與閱讀 internal 文件；Admin 可於 Web 問答、管理後台與引用回看讀取 internal 與 restricted 文件。
- MCP 則由 token scope 控制是否可讀 restricted 內容，並疊加 token 創建者 role × guest_policy 作為前置閘。
- 未登入使用者不得存取問答、管理與 MCP 管理頁面。
- 對話若被標記為 restricted，則後續讀取時仍需依目前角色重新驗證；原本看過的受限對話，不因曾經成功讀取而永久保留可見性。
- searchKnowledge / askKnowledge 對未授權呼叫者只保證看不到 restricted 內容，不保證以 403 告知受限資料存在；是否回空結果或業務拒答，取決於過濾後是否仍有足夠 internal 證據。
- 角色升降事件一律透過 recordRoleChange 單一入口寫入 member_role_changes 表，以利稽核；現階段本身不提供對應讀取 UI，待後續管理介面擴充時補上。

#### 2.4.1.2 allowed_access_levels 推導與存取矩陣

表 26 allowed_access_levels 存取矩陣

| 通道／身分                                                         | allowed_access_levels      | 說明                                                                                           |
| ------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------- |
| Web Guest（guest_policy = same_as_member）                         | ['internal']               | Dial 預設值；Guest 問答路徑與 Member 同權，但仍不可讀 restricted                               |
| Web Guest（guest_policy = browse_only）                            | []（可讀公開分類，不可問） | /chat 入口以 GuestAccessGate 呈現「此環境僅開放瀏覽」；POST /api/chat 伺服器拒絕回 403         |
| Web Guest（guest_policy = no_access）                              | []                         | 登入後僅見「使用者待審核」提示頁；Web 與 MCP 全部入口拒絕                                      |
| Web Member                                                         | ['internal']               | 一般問答與對話歷史僅可使用 internal 證據                                                       |
| Web Admin                                                          | ['internal', 'restricted'] | Admin 可於 Web 問答與引用回看中讀取 restricted                                                 |
| MCP token（由 Admin/Member 建立，無 knowledge.restricted.read）    | ['internal']               | searchKnowledge、askKnowledge 只可檢索 internal；getDocumentChunk 遇 restricted 一律回 403     |
| MCP token（由 Admin/Member 建立，有 knowledge.restricted.read）    | ['internal', 'restricted'] | 可檢索與讀取 restricted；現階段仍維持無狀態呼叫                                                |
| MCP token（由 Guest 建立，guest_policy = browse_only / no_access） | []                         | Middleware 以 token created_by_user_id 查創建者 role → 查 dial → 拒絕回 403，不進入 scope 判定 |

- allowed_access_levels 必須於第一次檢索前推導完成，並寫入 retrieval_filters_json 供稽核。
- AI Search metadata filter 僅是第一層快篩；正式回答前仍需以 D1 驗證 document_version_id 是否符合 active/indexed/current 規則。
- MCP 入口閘（token 創建者 role × guest_policy）先於 scope 判定；即使 token scope 完整，若創建者為 Guest 且 dial 非 same_as_member，仍一律拒絕。

#### 2.4.1.3 MCP 授權

- MCP Server 僅接受 Bearer token，遵循 OAuth 2.0 Bearer Token 標準[25]。
- Token 以雜湊值保存於 mcp_tokens，原始 token 只在建立當下顯示一次。
- 每個 token 需具備至少一個 scope，例如 knowledge.search、knowledge.ask、knowledge.citation.read、knowledge.category.list；若需讀取 restricted 內容，須額外具備 knowledge.restricted.read。
- Token 可設定到期、撤銷與最後使用時間。
- 現階段的 MCP 不使用 MCP-Session-Id；每次請求都必須重新驗證 token 與 scope。
- getDocumentChunk 在解析 citationId 後仍需再次驗證 scope，不得因已知 ID 而繞過授權。
- searchKnowledge 與 askKnowledge 若僅因 knowledge.restricted.read 缺失而看不到目標內容，應維持 existence-hiding 原則：僅在工具本身 scope 不足時回 403，不得主動揭露 restricted 文件是否存在。
- 授權不足屬協定錯誤而非業務拒答：缺少或失效 token 一律回 401，scope 不足或越權讀取一律回 403，不得包裝成 refused。

#### 2.4.1.4 速率限制與保留期限

- /api/chat 與 MCP Tools 必須實作 per-user / per-token rate limit，並於超限時回傳 429。
- 現階段以 Cloudflare KV 實作 fixed-window rate limit，key 由 channel + actor_id + bucket_start 組成，TTL 為視窗長度加 60 秒。
- 建議基準值如下：/api/chat 每位使用者 5 分鐘 30 次；askKnowledge 每個 token 5 分鐘 30 次；searchKnowledge 每個 token 5 分鐘 60 次；getDocumentChunk 與 listCategories 每個 token 5 分鐘 120 次。
- 此機制目標為邊緣近即時防濫用，允許極短時間邊界誤差；若後續需要更嚴格一致性，再於後續版本評估 Durable Object 或等價方案。
- Web 對話現階段保留一般可見訊息於 messages.content_text，以支援歷史重建與同對話續問；但高風險 blocked 訊息不得寫入 content_text。對話刪除後，該對話所有 content_text 會被清空，content_redacted 則僅供 retention window 內之稽核路徑使用。
- messages.content_redacted、query_logs 與必要的事件 metadata 預設保留 180 天供稽核；此類保留資料不得回到一般使用者 UI，也不得重新作為模型上下文。
- citation_records 由 expires_at 欄位直接承載 retention window（預設 180 天）；在 retention 期內，即使版本已非 current 或文件已 archived，getDocumentChunk 仍應對具相應權限之呼叫者回放當次引用快照。對應 source_chunks.chunk_text 視為不可變快照，不因版本切換或下架而立即刪除。
- 撤銷、過期與失效的 mcp_tokens metadata 預設保留 180 天；清理作業由 /api/admin/retention/\* 承擔，至少每日執行一次。

長週期保留規則於專題時程內不宜直接等待 180 天驗證；Staging 應以縮短 TTL、backdated record 或等價方式驗證清理邏輯，正式環境則僅驗證組態一致性與排程存在，不宣稱已完成滿期觀察。

#### 2.4.1.5 敏感資料治理

- 文件需標記 internal 或 restricted 兩種敏感等級。
- 現階段不啟用外部模型備援（Cloud fallback）；若後續版本啟用外部模型，restricted 文件仍不得外送。
- 使用者輸入需先經祕鑰、帳密、PII 偵測，避免高風險內容直接進入模型推論。
- 原始 token 與祕密字串只存在於單次請求記憶體；query_logs 與除錯輸出僅保存遮罩後版本。messages 現階段同時具備 content_text 與 content_redacted，但 blocked 高風險輸入的 content_text 會直接寫成 NULL，因此原文仍不會落地；一般可見訊息的 content_text 則僅供使用者歷史與後續上下文重建，刪除對話時必須清空。
- query_logs 必須保存 risk_flags_json 與 redaction_applied，以驗證遮罩流程是否實際執行。

#### 2.4.1.6 部署環境與組態真相來源

為避免實作時把開發、驗收與正式環境混成同一套知識庫，現階段至少需區分下列三種環境：

表 27 部署環境與組態真相來源

| 項目                         | Local / Dev                  | Staging / Preview                    | Production                                                           |
| ---------------------------- | ---------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| D1                           | 開發資料庫                   | 驗收資料庫                           | 正式資料庫                                                           |
| R2                           | 開發 bucket 或前綴           | 驗收 bucket 或前綴                   | 正式 bucket 或前綴                                                   |
| KV                           | 開發 namespace               | 驗收 namespace                       | 正式 namespace                                                       |
| AI Search instance           | 開發 / 驗收專用 instance     | 驗收專用 instance                    | 正式 instance                                                        |
| OAuth Redirect URI           | localhost / 本機網域         | 驗收網域                             | 正式網域                                                             |
| ADMIN_EMAIL_ALLOWLIST        | 測試管理員清單（Admin seed） | 驗收管理員清單（Admin seed）         | 正式管理員清單（Admin seed）                                         |
| system_settings.guest_policy | 可任意切換驗證 dial 行為     | 依驗收情境切換                       | 預設 same_as_member，由 Admin 透過 /admin/settings/guest-policy 調整 |
| Feature flags                | 可局部開關驗證               | passkey 啟用，其餘驗收項目依情境開關 | passkey 啟用，其餘不納入目前範圍之功能預設關閉                       |

補充原則如下：

- 不得讓 Staging / Preview 與 Production 共用同一組 D1、R2、KV 或 AI Search instance，避免測試資料污染正式發布真相。
- 祕密值、OAuth 憑證、binding 名稱與 feature flags 皆須由 runtime config、NuxtHub / Wrangler 環境設定注入，不得寫死在前端或共享常數檔。
- features.passkey 在 staging / production 已顯式啟用，且必須與 deploy build env、Worker runtime vars 保持一致；features.mcpSession、features.cloudFallback 與 features.adminDashboard 在 Production 現階段仍預設為 false。若 Preview 環境提前試驗後續功能，不得回頭修改現階段驗收基準。

### 2.4.2 與大型 LLM API 方案之比較

本系統的比較基準不是「證明邊緣一定更快更便宜」，而是作為架構選型理由與後續觀察方向；本節不承諾在現階段另行實作完整純雲端對照組。以下比較以純雲端 LLM 方案為參照組，候選模型以實驗當時可實際申請之主流 API 模型為準，例如 GPT、Gemini 與 Claude 系列。

表 28 與純雲端 LLM 方案比較

| 比較面向   | 純雲端 LLM 方案                 | 本系統設計原則                                                                                                                                  |
| ---------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 檢索控制   | 多仰賴外部服務或額外自建        | 以 AI Search 統一受管理檢索                                                                                                                     |
| 回答生成   | 直接由雲端模型完成              | 以邊緣模型為主，自建流程控制                                                                                                                    |
| 資料外送   | 查詢與上下文預設送往外部供應商  | 預設留在邊緣，外送需經治理閘道                                                                                                                  |
| 延遲       | 依外部 API 往返與排隊狀況而變動 | 目標以邊緣優先降低體感延遲                                                                                                                      |
| 成本控制   | 以外部 token 計費為主           | 以邊緣模型承擔常見查詢，現階段不啟用額外跨雲 LLM API                                                                                            |
| 用量可觀測 | 由供應商主控台提供聚合數字      | 以 Cloudflare AI Gateway 前置所有 Workers AI 呼叫，於 /admin/usage 呈現 tokens、requests、cache hit rate 與 Neurons 剩餘額度；免費 100k logs/月 |
| 審計與引用 | 視供應商能力而定                | 應用層強制保存 query_logs、source_chunks 與 citation_records                                                                                    |

### 2.4.3 平台限制與因應

表 29 平台限制與因應方式

| 限制                                 | 說明                                            | 因應方式                                                                                          |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Workers CPU 與請求生命週期限制       | 不適合無上限重試或長鏈工具呼叫                  | Self-Correction 限制最多 1 次重試，回答採串流輸出                                                 |
| AI Search 同步具最終一致性           | 索引更新不是即時完成                            | 管理後台明示 index_status，重同步採工作流程設計                                                   |
| AI Search custom metadata 有欄位上限 | 若把過多欄位塞入遠端 metadata，會使規格無法落地 | 僅保留 5 個 custom metadata，其他識別資訊由 folder 路徑與 D1 回推                                 |
| MCP 多輪上下文若直接落 D1            | 容易與 Web 對話形成雙重真相                     | 現階段先採無狀態 MCP；後續版本若導入 Session，runtime state 仍留在 KV                             |
| 供應商 chunk ID 不適合作為公開契約   | reindex 後可能變動，直接外露不利相容性          | 以應用層 source_chunks.id 作為可回放 citationId，並搭配 locator_hash 與 chunk_text 快照確保可回放 |
| 敏感資料治理複雜                     | 即使不外送模型，也可能在日誌與除錯輸出洩漏資料  | 高風險查詢先遮罩再拒答；日誌僅保存遮罩版本                                                        |
| 邊界案例若每次都跑 judge 會拉高延遲  | 複雜推理模型呼叫成本高                          | answerability judge 僅於 retrieval_score 中段區間觸發                                             |
| 模型供應與版本變動                   | 邊緣模型與 SDK 皆可能更新                       | 現階段先凍結兩個核心模型角色，變更需同步更新驗證報告                                              |

### 2.4.4 驗證與評估規劃

本專題採「設計規格 → 核心閉環實作 → 測試集與稽核證據驗證」三階段方法。驗證目標不是證明所有候選功能都同時完成，而是確認現階段的核心命題是否成立：current-version-only、可回放引用、分段式回答／拒答，以及 Web／MCP 契約分流後的治理一致性。

#### 2.4.4.1 功能驗證

- 一般問答：可直接回答並附引用。
- 模糊查詢：能觸發 Self-Correction 並改善檢索結果。
- 越界問題：能正確拒答且提示補充方向。
- 多輪對話：Web 可保留既有上下文；MCP 現階段 維持無狀態契約。
- MCP 互操作：外部 AI Client 能正確呼叫 4 個核心 Tools；其中 Web 多輪追問與 MCP 無狀態契約須分開驗證。
- 權限治理：無權限 token 不可存取受限 Tool。
- 版本治理：歷史版本與 archived 文件不得出現在正式回答中。
- 記錄治理：查詢與訊息落地資料應完成遮罩且可稽核。

#### 2.4.4.2 驗收判定原則

- 附錄 B 的每一筆案例都必須定義「主要期望結果」與「允收條件」；凡實際結果落在允收條件之外，一律判定為不通過。
- 401 / 403 屬協定與授權驗證通過，不視為 refused；統計時應與業務拒答分開計算。
- self_corrected 只在第一輪證據不足、第二輪改善後成功回答且引用有效時才算命中；若原案例直接回答即可成立，應先重寫案例而非直接視為通過。
- judge_pass 僅在最終回答正確、引用有效且未違反權限或 current-version-only 規則時才視為通過，不得因為模型有輸出就算成功。
- current-version-only、restricted 隔離與 redaction 完整性屬零違規 invariant；任一案例失守即不得視為通過。
- 所有驗收統計都需附上 config_snapshot_version，避免不同批次以不同門檻或 feature flags 產生不可比較的結果。

#### 2.4.4.3 資料集分層與凍結規則

- 初始驗證資料集：20 筆，供欄位檢查、早期 dry run 與流程走通，不納入正式統計。
- 校準資料集：獨立於正式驗收集，用於校準門檻、prompt 與模型路由。
- 正式驗收資料集：30–50 筆，凍結後不得再改 threshold、prompt、route 或題目標註規則；正式統計可納入 md、txt 與已通過 canonical snapshot 驗證之 pdf、docx、xlsx、pptx，但 .doc、.xls、.ppt、媒體檔與 scanned / image-only PDF 仍應排除。若需調整，應建立下一版驗收集並重跑。
- 答辯展示案例集：可自正式驗收資料集挑選，但不得回頭改寫正式驗收規則。
- 每筆案例至少需定義：適用通道、gold facts、必要引用、不可犯錯、預期 http_status，以及是否允許 judge／Self-Correction。

#### 2.4.4.4 效能與品質指標（驗收層級）

下表將驗收指標分為三類：硬性驗收（current-version-only / restricted 隔離 / redaction 完整性等不可違反 invariant）、品質驗收（回答品質、引用精準率、拒答精準率等需以正式驗收資料集統計者）、觀測指標（延遲與觸發率等需於 Preview / Staging 觀測者）。**硬性驗收已由 §3.3.2.1 結構式自動化測試承擔**；**品質驗收門檻作為正式驗收資料集凍結後的判定基準，實模型大樣本統計列入 §4.2.3 研究限制與第三章 §3.3 之延伸驗證邊界**；**觀測指標以固定環境 Preview / Staging 觀測值佐證，不單獨作為 fail gate**。

表 30 效能與品質驗收指標

| 指標                                | 定義                                                        | 類別     | 現階段目標 / 原則                                     |
| ----------------------------------- | ----------------------------------------------------------- | -------- | ----------------------------------------------------- |
| Current-Version Retrieval Accuracy  | 回答僅引用已發布 current 版本且文件狀態為 active 之比例     | 硬性驗收 | 100%                                                  |
| Restricted Access Isolation         | 未授權身分不得取得 restricted 內容之比例                    | 硬性驗收 | 100%                                                  |
| Redaction Coverage                  | 應遮罩記錄中已完成遮罩之比例                                | 硬性驗收 | 100%                                                  |
| Citation Precision                  | 引用能正確支持回答內容之比例                                | 品質驗收 | > 85%                                                 |
| Answer Correctness                  | 可回答題之正確回答比例                                      | 品質驗收 | > 80%                                                 |
| Refusal Precision                   | 應拒答題被正確拒答之比例                                    | 品質驗收 | > 90%                                                 |
| MCP Tool Success Rate               | MCP Tools 呼叫成功比例                                      | 品質驗收 | > 95%                                                 |
| Direct Path First Token Latency P50 | 不經 judge / Self-Correction 的第一個回應字元輸出中位數延遲 | 觀測指標 | 固定環境下以 <= 1.5s 為優化目標，不單獨作為 fail gate |
| Overall First Token Latency P50     | 全部查詢路徑合併後的首字延遲中位數                          | 觀測指標 | 固定環境下以 <= 2.5s 為優化目標，不單獨作為 fail gate |
| Completion Latency P95              | 完整回答輸出的 95 百分位延遲                                | 觀測指標 | 固定環境下以 <= 6s 為優化目標，不單獨作為 fail gate   |
| Self-Correction Hit Rate            | 觸發後確實改善結果之比例                                    | 觀測指標 | 實測回報即可，不預先綁死固定比例                      |
| Judge Trigger Rate                  | 需進入 answerability judge 的查詢比例                       | 觀測指標 | 實測回報即可，用於門檻校準                            |

#### 2.4.4.5 評估方式

- 先以 seed 案例 dry run，確認 query_logs、citation_records、messages 與 config_snapshot_version 等欄位都能穩定記錄，再進入正式驗收。
- 正式驗收資料集應涵蓋一般查詢、模糊查詢、越界問題、追問情境、跨文件比較、權限受限查詢與敏感查詢。
- 測試案例應區分 shared core、Web-only 與 MCP-only contract 三類，不強制兩通道共用同一整套題目。
- 小樣本人工標註主要用於回答正確率、引用精準率與拒答精準率；較大樣本重複執行主要用於成功率、延遲、rate limit 與協定穩定性。
- 分別記錄第一次檢索結果、judge 是否觸發、重試後結果、是否拒答，以及是否命中 current-version-only、restricted 隔離與 redaction invariant。
- 輔以資料表對照 source_chunks、citation_records、document_versions.is_current、query_logs.redaction_applied、messages.content_redacted 與 blocked rows 的 messages.content_text IS NULL，驗證引用可回放性與記錄治理。
- 對於 180 天保留期限等長週期規則，Staging 應以縮短 TTL 或 backdated record 驗證執行邏輯；正式環境僅驗證設定與排程存在。

正式驗收時，先檢查硬性驗收與品質驗收兩層；觀測指標若未達標，需說明原因與後續優化方向，但不應單獨推翻已通過的治理與正確性驗證。

### 2.4.5 部署成本與容量規劃

本節補充作為回應「§1.4 預期效益」所宣稱之「降低基礎設施管理複雜度」與「以邊緣原生架構降低維運負擔」的情境化規劃依據。成本與容量皆以 2026-04 時點之 Cloudflare 公開計費與限額為基準，用途是提供部署規劃與答辯討論參考，不應被解讀為已完成之正式營運統計；實際運行費用仍須於 Preview / Staging 實測後再填入。

#### 2.4.5.1 成本估算

現階段預期部署規模為單租戶、中小企業內部使用（估 5–50 位啟用使用者、每日 50–500 次問答、知識庫 50–500 份 md / txt 文件）。在此規模下，以 Cloudflare 免費方案與 Workers Paid（US$5/月）方案做雙層試算如下。

表 31 現階段情境化月度運營成本估算

| 服務                              | 計費單位                       | 現階段預估用量                                     | 免費額度 / 單價                                                   | 情境估算月費 (USD) | 備註                                                                                     |
| --------------------------------- | ------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| Workers (Paid)                    | 每月請求數 + CPU 時間          | 約 50k 請求 / 月（問答 + 管理 + MCP）              | Paid：10M 請求 / 月含；CPU 30M ms / 月含；超額 $0.30/百萬請求     | $5.00              | Workers AI / AI Gateway 啟用通常需 Paid plan；是 現階段的基礎月費                        |
| D1                                | Rows read / written + 儲存     | 讀 500k / 寫 10k / 月；儲存 < 100MB                | Paid：25B rows read / 50M rows written / 5GB 儲存含               | 0                  | 預估用量遠低於 Paid 額度                                                                 |
| R2                                | Class A / Class B ops + 儲存   | Class A 5k / Class B 50k / 月；儲存 < 1GB          | Paid：1M Class A / 10M Class B / 10GB 儲存含                      | 0                  | 預估用量遠低於 Paid 額度                                                                 |
| KV                                | Read / Write / Delete + 儲存   | 讀 500k / 寫 5k / 月                               | Paid：10M read / 1M write / 1GB 儲存含                            | 0                  | 預估用量遠低於 Paid 額度                                                                 |
| Workers AI                        | Neurons（依模型與 token 計費） | 500 次 / 日 × 30 日 × 平均 500 Neurons = 7.5M / 月 | Paid：10k Neurons / 日含（300k / 月）；超額約 $0.011 / 1k Neurons | $79.2（超額 7.2M） | 實際費用視所選模型與回答長度而定；測試用 synthesizer 不計費，但正式回答會進入 Workers AI |
| AI Search                         | Queries + Indexed documents    | 500 次 / 日 × 30 日 = 15k / 月；文件 < 500 份      | 具體計費於 2026-04 仍在調整，預計 beta 期間不另計費；文件索引免費 | 0（beta）          | 依最新 release note[18] 為準；若 GA 後計費，再填入                                       |
| AI Gateway                        | Logs / 月                      | 50k 請求對應 50k logs                              | 免費 100k logs / 月                                               | 0                  | 僅作觀測，不承擔 enforcement                                                             |
| Better Auth / OAuth               | —                              | —                                                  | Google OAuth 免費                                                 | 0                  | 自建 better-auth，不收訂閱費                                                             |
| **合計（結構式測試期）**          | —                              | —                                                  | —                                                                 | **$5.00**          | 僅跑治理流程、資料庫、R2、KV 與測試 synthesizer 時之最低月費                             |
| **合計（Workers AI 正式回答期）** | —                              | —                                                  | —                                                                 | **≈ $84.20**       | 以每日 500 次問答與平均 500 Neurons 粗估之月費                                           |

超額試算：若單月請求爆增至 500k、Workers AI 使用至 75M Neurons（10 倍規模），則月費可能升至數百美元等級。此處僅用來說明「成本主要會集中在實模型推理層」，不應被解讀為已完成之正式成本實測依據；若後續接入外部雲端模型，也需以當時官方單價重新估算。

備註：

1. 上述 Workers AI Neurons 估算以「每次問答 500 Neurons」為粗估，實際隨模型與回答長度浮動，需於後續實模型與營運觀測階段以 AI Gateway 聚合資料填入。
2. 成本估算不含網域、SSL（Cloudflare 提供）、Email（Better Auth 以 Google OAuth 轉發，無額外費用）、監控告警（仰賴 Cloudflare 原生 dashboard）。
3. 若未來開啟外部模型備援（Cloud fallback），成本結構將改以外部 API token 計費為主，需另行估算並以 feature flag 治理。

#### 2.4.5.2 容量與擴展性規劃

現階段的 scale envelope 依 Cloudflare 平台限額與本系統設計常數推導，屬容量規劃與擴展觸發點參考，而非實際壓測後的正式承諾。envelope 內指標滿足時，可作為「目前設計大致適用」的規劃判斷；若超出 envelope，則應視為需要另行提出擴展方案並重跑驗證，而非直接沿用目前設計。

表 32 現階段 Scale Envelope 與擴展觸發點

| 維度                      | 現階段設計容量                                 | 推導依據                                                                                                      | 超出時之擴展路徑                                                                         |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 同時在線使用者            | 50                                             | Workers 單一 isolate 無狀態，理論可水平擴展；但 KV rate limit 計數器設計以個位數 QPS 為主                     | 增加 KV 計數器分片；若需即時協作，改用 Durable Objects                                   |
| 日問答請求                | 500 次 / 日                                    | Workers AI 免費 10k Neurons / 日；以平均 500 Neurons 估算支援 ≈ 20 次；Paid 支援 500 次 / 日以上              | 切換付費方案並開啟 AI Gateway cache；若持續爆量，考慮外部模型備援（Cloud fallback） 分流 |
| 同時文件數                | 500 份                                         | AI Search custom metadata 上限 5 欄位 × folder 路徑策略可容納；D1 索引 documents.status + is_current 線性查詢 | 拆分多 AI Search instance、改以 pgvector / Vectorize 分片                                |
| 每份文件 chunk 數上限     | 1000 chunks                                    | 固定切分規則，單一文件正規化文字約 100k 字；AI Search 單檔大小限制                                            | 若超過，先在 ingestion 階段檢查並回 413；chunk 過多時建議拆文件                          |
| 系統總 chunk 數           | 500k chunks                                    | D1 source_chunks 表估算；Drizzle + D1 查詢效能在此規模下線性穩定                                              | 啟用 D1 分片 / 遷移至 Workers AI Vectorize                                               |
| MCP token 並發            | 100 個 active token / 部署                     | KV lookup 效能；/mcp 無狀態契約不受 MCP-Session 限制                                                          | 啟用 KV metadata 分離、token 改以 D1 索引                                                |
| 單次問答請求 payload 上限 | 2000 字查詢 + 8 chunks × 2048 tokens ≈ 18k tok | Workers AI context window 依模型而定；分段決策門檻 + 拒答機制確保不會塞入無效 context                         | 若 context 超限，先在應用層截斷；模型切換時需同步重算                                    |
| Workers 單次 CPU 時間     | 30 秒上限                                      | Cloudflare Workers 硬性限制                                                                                   | 長任務分批；若需長時間背景工作，改 Cloudflare Queue / Cron Trigger                       |
| retention 資料量          | 180 天 × 每日 500 筆 query_logs = 90k 筆       | D1 儲存估算；citation_records.expires_at 搭配 retention cleanup 清理                                          | retention 自動清理 + 超期 citation 不可回放，結構上不會無限成長                          |

Scale envelope 的語意：

1. **Envelope 內**：現階段規格與治理契約可完整承受，不需額外結構變更。
2. **接近上限（> 80%）**：觸發 /admin/usage 儀表板告警（列為後續營運擴充），並於定期審視時重新評估擴展時程。
3. **超出 envelope**：屬明確擴展觸發點，需另行提出擴充方案並重跑正式驗收資料集。

本節與 §2.4.3 表 29（平台限制與因應）互補：表 29 描述限制本質與因應原則，本節以量化數字描述現階段在此限制下的可用範圍與擴展門檻。

---

# 第三章 實作成果

本章彙整本系統目前已完成的作業環境、主要功能介面與驗證結果，重點放在可重現的部署組態、核心頁面狀態與自動化測試證據。凡與長期營運觀測或實模型品質統計相關者，則於本章第三節與第四章清楚說明其驗證邊界，不以空白欄位取代既有成果。

## 第一節 系統作業環境

### 3.1.1 硬體環境

表 33 硬體環境規格

| 項目       | 規格                    |
| ---------- | ----------------------- |
| 運行環境   | Cloudflare Edge Network |
| 開發機架構 | Apple Silicon（arm64）  |
| 作業系統   | macOS 26.4.1            |
| CPU        | Apple M4                |
| 記憶體     | 16 GB                   |

### 3.1.2 軟體環境

本節以目前工作區的 package.json、lockfile 與已接入之雲端服務狀態為依據，整理本系統實作所使用的主要軟體環境。受管理服務以官方公開狀態標示，專案內套件則以工作區實際版本為準。

表 34 軟體環境版本

| 類別                    | 技術                                                         | 版本                           | 用途                                                    |
| ----------------------- | ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------- |
| Framework               | Nuxt                                                         | 4.4.2                          | 全端框架                                                |
| Deployment              | NuxtHub                                                      | 0.10.7                         | Cloudflare 部署整合                                     |
| Database                | D1 + Drizzle ORM                                             | D1：GA；Drizzle ORM：0.45.2    | 結構化資料儲存與 ORM                                    |
| Object Storage          | R2                                                           | GA                             | 原始文件與版本檔                                        |
| Cache / Session Storage | KV                                                           | GA                             | 快取與速率限制                                          |
| Auth                    | Better Auth + @better-auth/passkey + @onmax/nuxt-better-auth | 1.6.7 + 1.6.7 + 0.0.2-alpha.19 | Google OAuth + Passkey                                  |
| Managed Retrieval       | Cloudflare AI Search                                         | 以 2026-04 官方公開功能為準    | 受管理檢索                                              |
| Storage SDK             | @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner           | 3.1034.0                       | R2 signed URL 簽發（S3 相容協定）                       |
| Answer Runtime          | models.defaultAnswer（角色常數）                             | Workers AI answer adapter      | 單文件回答、引用組裝與輸出                              |
| Judge Runtime           | models.agentJudge（角色常數）                                | 結構式判斷器 / Workers AI 角色 | Query Reformulation、邊界判定與跨文件整合               |
| MCP Runtime             | @nuxtjs/mcp-toolkit                                          | 0.14.0                         | 4 個核心 MCP Tools 實作（單一 /mcp JSON-RPC）           |
| AI Usage Observability  | Cloudflare AI Gateway                                        | 以 2026-04 官方公開功能為準    | 聚合 tokens、requests、cache hit rate 與 Neurons 使用量 |
| UI                      | Nuxt UI                                                      | 4.6.1                          | 介面元件庫                                              |
| Accessibility           | @nuxt/a11y                                                   | 1.0.0-alpha.1                  | 無障礙檢查 dev report 與 WCAG AA 基線驗證               |

### 3.1.3 開發工具環境

表 35 開發工具版本

| 工具               | 版本 / 狀態      | 用途                      |
| ------------------ | ---------------- | ------------------------- |
| Node.js            | 24.15.0          | JavaScript 執行環境       |
| pnpm               | 10.33.0          | 套件管理                  |
| Wrangler           | 4.84.1           | Cloudflare 部署與本機操作 |
| Python             | 3.13.12          | 報告處理與輔助腳本        |
| spectra            | 依專案安裝版本   | 規格驅動開發流程          |
| Nuxt MCP Server    | 官方服務         | Nuxt 文件查詢             |
| Nuxt UI MCP Server | 官方服務         | Nuxt UI 文件查詢          |
| VS Code / Cursor   | 依實際工作站版本 | 程式編輯器                |

補充說明：開發輔助工具與 spectra 僅作為開發輔助與規格管理流程，不列入本專題成果的效能或品質貢獻評估；相關工具說明見參考文獻[26][27]。

## 第二節 功能與介面說明

### 3.2.1 流程說明

#### 3.2.1.1 知識庫建置流程

對應 §2.2.4 文件生命週期之實作步驟：

1. Admin 先取得一次性 signed URL 與 uploadId。
2. 原始檔直傳 R2 staged 路徑。
3. 呼叫 finalize 驗證副檔名、MIME type、大小與 checksum。
4. 建立 document_versions（預設 is_current = false、index_status = queued）。
5. 產生 normalized_text_r2_key 與 deterministic source_chunks。
6. 寫入 AI Search metadata（含 document_version_id 與 folder 路徑；version_state 若存在僅作觀測提示）。
7. 建立 ingestion_jobs（status = queued）。
8. 觸發 instance 級同步。
9. AI Search 完成轉換、分塊、Embedding 與索引。
10. 任務與版本轉為 smoke_pending。
11. 執行以 document_version_id 為主的 representative smoke retrieval，確認回傳片段皆可對應至既有 source_chunks。
12. 通過後回寫 ai_search_file_id、index_status = indexed、indexed_at。
13. Admin 顯式執行 publish，系統再以 transaction 將新版本切為 is_current = true 並寫入 published_at / published_by。
14. 文件可供正式檢索。

#### 3.2.1.2 問答流程

對應 §2.1.2 圖 4 Agentic RAG 問答活動圖：

1. 使用者提問。
2. 規則式 Query Normalization。
3. 權限、敏感資料與查詢類型檢查（推導 allowed_access_levels）。
4. AI Search 第一輪檢索（rewrite_query = true，且 status = active；version_state = current 若存在僅作快篩提示）。
5. D1 post-verification 剔除非 active/indexed/current 片段。
6. 計算 retrieval_score 與 cross_document_gate_failed。
7. 依分數分支處理：
   - 若 retrieval_score >= 0.70 且 cross_document_gate_failed = false：依固定模型路由以 models.defaultAnswer 或 models.agentJudge 生成回答 → 將有效候選片段對應至既有 source_chunks → 建立 citation_records → 串流輸出 → 儲存遮罩後日誌。
   - 若 0.45 <= retrieval_score < 0.70：觸發 models.agentJudge judge → 計算 confidence_score。
   - 若 confidence_score < 0.55、retrieval_score < 0.45 或 cross_document_gate_failed = true，且 retry_count = 0：models.agentJudge 重寫查詢 → AI Search 第二輪檢索（rewrite_query = false）→ 再次評估。
   - 若仍不足：拒答並提示補充方向。

### 3.2.2 功能說明

表 36 系統功能模組說明

| 功能模組           | 說明                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 身分驗證           | 現階段支援 Google OAuth 與 Passkey；角色採三級 RBAC（Admin/Member/Guest），Admin 由 ADMIN_EMAIL_ALLOWLIST seed，Guest 權限由 system_settings.guest_policy dial 控制                                                        |
| 成員與權限管理     | Admin 可於 /admin/members 升降 Guest↔Member；於 /admin/settings/guest-policy 切換 Guest dial（same_as_member / browse_only / no_access）；升降事件一律寫入 member_role_changes 留稽核軌跡                                  |
| 智慧問答           | 支援自然語言問答、分段式信心分數評估、Self-Correction、拒答                                                                                                                                                                |
| 對話歷史           | Web 對話持久化；依 conversations.access_level 與目前權限重算可見性；MCP 現階段採無狀態呼叫，僅以 query_logs 支援審計                                                                                                       |
| 知識管理           | 一次性 signed URL 上傳至 R2、版本管理、分類、標籤、狀態轉移（封存／解除封存／刪除 draft）、版本重試同步、顯式發布 current 版本與 AI Search 同步；md、txt、pdf、docx、xlsx、pptx 皆可進入 canonical snapshot ingestion path |
| MCP 介面           | 提供 4 個核心 Tools，支援 Bearer token 與 knowledge.restricted.read scope；三級角色擴充後 middleware 額外以 token 創建者 role × guest_policy 作為前置閘                                                                    |
| 引用追溯           | 以 source_chunks.id 作為可回放 citationId，支援 getDocumentChunk                                                                                                                                                           |
| Token 管理         | 建立、檢視、撤銷 MCP token，並控管 scope 與到期時間                                                                                                                                                                        |
| 用量儀表板         | /admin/usage 呈現 Cloudflare AI Gateway 當日 / 當月 tokens、requests、cache hit rate、Neurons 剩餘額度與近 24h 折線圖；讀取端另需 CLOUDFLARE_API_TOKEN_ANALYTICS read-only secret                                          |
| 查詢日誌與營運治理 | 記錄延遲、judge、拒答、Self-Correction、版本、設定快照與遮罩執行情形                                                                                                                                                       |
| 響應式與無障礙     | 全頁 mobile / tablet / desktop 三 breakpoint 適配；@nuxt/a11y dev report 作為離線檢查輔助；鍵盤 walkthrough 覆蓋關鍵操作路徑                                                                                               |

### 3.2.3 操作與介面說明

本節畫面示意以功能驗收為主，實際版面可調整，但不得缺漏引用、版本、授權與稽核所需證據。

本節 7 張實機截圖（圖 7 至圖 13）以 desktop 環境（1920×1080 或等價 viewport）為主，聚焦結構、角色、狀態、lifecycle 等語義驗收；對應 §3.2.2 表 36「響應式與無障礙」之 mobile / tablet / desktop 三 breakpoint 實機證據，則由 **EV-06（§3.3.2 表 43）** 獨立承擔，驗證文件與截圖清單詳見 docs/verify/RESPONSIVE_A11Y_VERIFICATION.md。此分工之理由有三：

1. **職責切分**：本節截圖重點在「每個畫面該有什麼欄位 / 狀態 / lifecycle 表現」，不重疊 EV-06 的跨 viewport 版面崩潰檢查。
2. **避免截圖膨脹**：若每個 UI 都拍三 viewport，圖表索引將達上百張，閱讀性劣化；集中到 EV-06 以 batch 方式驗證更有效率。
3. **交付版證據分工**：mobile / tablet viewport 之實機截圖與 @nuxt/a11y dev report 由 EV-06 統一承接（詳見 §3.3.2 表 43 與 §3.3.2.3 表 44），不在本節逐張重複列圖。

若讀者關注特定頁面之響應式行為，可直接開啟對應頁面 URL 並以瀏覽器 dev tools 切換 viewport 驗證；本系統採 Tailwind + Nuxt UI 響應式 utilities，breakpoint 與 CSS 定義集中於 app/assets/css/ 可供對照。

本節 7 張實機截圖（圖 7 至圖 13）皆於 2026-04-21 於 local dev 環境拍攝，涵蓋登入、問答入口、文件管理、MCP Token、成員管理、訪客政策與 AI Gateway 用量頁。圖 8 與圖 13 採目前環境可重現的代表狀態呈現；含長期流量的 loaded 資料屬營運期觀測，不作為本次繳交必要條件。

#### 3.2.3.1 登入畫面

圖 7 登入畫面實機畫面（2026-04-21，local dev 環境）

實機狀態：loaded；顯示「知識問答系統」主標、「使用公司身分登入系統」副標、Google 登入按鈕，以及「首次登入後，系統會根據登入資料自動指派角色」提示（對應 §2.4.1.1 OAuth callback 自動建立 Guest 的說明）。

圖面說明：

- 畫面用途：使用者登入與首次註冊入口
- 主要元素：
  - 標題「企業知識庫」
  - 副標「請使用 Google 帳號登入」
  - 主要按鈕「使用 Google 帳號登入」
  - 底部說明，交代首次登入將依 Google 帳號與部署 allowlist 建立角色

#### 3.2.3.2 主畫面（問答介面）

圖 8 問答主畫面實機畫面（2026-04-21，local dev 環境）

實機狀態：loaded-empty onboarding；左欄「對話記錄」呈現 empty state、中央呈現「開始探索知識庫」引導文字與三個範例問題（公司請假流程是什麼？ / 如何申請報帳？ / 專案管理的最佳實踐有哪些？），底部輸入區顯示 / 聚焦 | Enter 送出 | Shift+Enter 換行 | Esc 清空 快捷鍵與 0 / 4000 字數計數。本圖重點在呈現系統首次進入問答頁時的 onboarding、輸入邊界與快捷鍵設計；至於回答內容、引用卡片與 citationId 回放，則由 §3.3 的自動化驗證與引用紀錄一併佐證。

圖面說明：

- 畫面用途：一般使用者問答入口
- 版面配置：
  - 左欄：對話歷史與新增對話
  - 中欄：問答區，顯示使用者問題、串流回答與引用區塊
  - 右欄：僅於 Admin 或 debug mode 顯示 retrieval_score、confidence_score、是否觸發 judge / Self-Correction 與模型路由；一般使用者預設不顯示內部決策分數
- 內容要求：
  - 回答文字需含 【引1】【引2】 行內引用
  - 引用卡片需顯示文件名、版本、分類、citationId 與摘錄

#### 3.2.3.3 知識庫管理畫面

圖 9 知識庫管理畫面實機畫面（2026-04-21，local dev 環境）

實機狀態：loaded；列表呈現三筆 seed 文件各對應一個 lifecycle 狀態：rag-test-draft（草稿、前處理中）、rag-test-active（啟用、已同步、待索引）、rag-test-archived（已歸檔、已同步），驗證 §2.2.4 文件生命週期狀態轉移規則在 UI 上的完整呈現。Actions 欄依狀態採漸進式揭露（UDropdownMenu），不一次暴露所有動作。

圖面說明：

- 畫面用途：Admin 管理文件與版本
- 主要欄位：
  - 標題
  - 分類
  - 標籤
  - 版本
  - Current 版本標記
  - 敏感等級
  - 索引狀態
  - 更新時間
  - 操作（編輯／建立新版本／發布／重試同步／封存／解除封存／刪除 draft）
- 輔助區塊：
  - 右側抽屜或彈窗表單
  - 文件上傳至 R2
  - AI Search 同步按鈕與狀態提示

為避免使用者（即使是 Admin）於高速操作時誤觸破壞性動作造成內容遺失或服務中斷，本畫面對操作按鈕依「風險等級」採取對應的確認策略。破壞性的 lifecycle 動作（封存、解除封存、刪除 draft）以 LifecycleConfirmDialog 元件統一呈現，顯示動作名稱、影響範圍（例如刪除時顯示將移除的版本與 chunks 數）與當前 Admin email 以供再次確認；建立新版本與發布為 current 沿用各自既有的 Modal。列表 actions 欄位採漸進式揭露（UDropdownMenu）：draft-never-published 顯示「刪除 draft」、draft-has-published 與 active 顯示「封存」、archived 顯示「解除封存」，不一次暴露所有動作；deletability 與狀態允許性一律由伺服器端判斷，不信任 client payload。

表 37 知識庫管理操作按鈕確認策略

| 操作                      | 風險等級 | 確認策略                                                                              | 說明                                                                                                                                                                                                 |
| ------------------------- | -------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 編輯 metadata             | 低       | 無（直接生效）                                                                        | 編輯標題、分類、標籤等非破壞性欄位；存檔前已由 form validation 處理。                                                                                                                                |
| 建立新版本                | 中       | 二次確認（Modal 顯示「即將建立新版本」）                                              | 建立新版本會觸發 R2 上傳與 AI Search 同步，但不覆寫 current；Admin 需於預覽後主動發布。Modal 顯示將建立的版本號與 finalize 後的同步流程。                                                            |
| 發布為 current            | 高       | 二次確認 + 顯示將被替換的舊 current 版本                                              | 將指定版本切為 current = true，影響所有後續檢索與問答。首次 publish 會在同一原子交易內將 documents.status 自 draft 升為 active（避免死結）。Modal 顯示「舊 current: vN」→「新 current: vN+1」警示。  |
| 重試同步（retry-sync）    | 低       | 無（非破壞性；按鈕僅於 sync_status ∈ {pending, failed} 顯示，running/completed 阻擋） | 針對單一版本將 sync_status 推進為 running；僅動 sync_status，不動 index_status；若前置資料（normalized_text_r2_key、source_chunks）缺件伺服器回 409 Conflict。                                       |
| 封存（archive）           | 中       | LifecycleConfirmDialog（動作名稱 + 影響範圍 + Admin email）                           | 將 documents.status 由 active 設為 archived、寫入 archivedAt；文件立即停止對外回答，但 document_versions 與 source_chunks 保留，引用歷史仍可回放至 retention 期滿；re-archive 回 no-op success。     |
| 解除封存（unarchive）     | 低       | LifecycleConfirmDialog（復原說明 + Admin email）                                      | 將 status 由 archived 還原為 active、清除 archivedAt，恢復對外檢索；不強制重新驗證 index_status；re-unarchive 回 no-op success。                                                                     |
| 刪除 draft（hard delete） | 最高     | LifecycleConfirmDialog（顯示將移除的版本與 chunks 數 + Admin email）                  | 僅允許 documents.status = 'draft' 且所有 document_versions.published_at IS NULL 的文件；透過 FK onDelete: cascade 一併清除版本與 source_chunks；其他狀態伺服器端一律回 409，忽略 client force 旗標。 |

**MCP 不涉及 agent-initiated approval**：現階段 MCP 4 個 tool 全為 read-only（searchKnowledge / askKnowledge / getDocumentChunk / listCategories），不執行任何破壞性操作；因此表 37 的確認策略僅適用於 Web Admin 管理介面，不延伸至 MCP 契約。

#### 3.2.3.4 MCP Token 管理畫面

圖 10 MCP Token 管理畫面實機畫面（2026-04-21，local dev 環境）

實機狀態：loaded；列表呈現 7 筆 token，包含 1 筆 active（B10 guest test、問答 scope、建立於 2026-04-20）與 6 筆 revoked（manual-review-test-1、test-token-1 等 QA 測試歷史），驗證 active / revoked 兩種狀態並存之 UI 顯示。

圖面說明：

- 畫面用途：Admin 建立與撤銷 Bearer token
- 主要欄位：
  - Token 名稱
  - scope 清單
  - 是否允許 restricted 讀取
  - 到期時間
  - 建立者（對應 mcp_tokens.created_by_user_id）
  - 最後使用時間
  - 狀態（active／revoked／expired）
- 功能要求：
  - 建立 token 時僅顯示一次原始值
  - 支援立即撤銷
  - 支援複製安裝指示與 MCP 連線說明

#### 3.2.3.5 成員管理畫面

圖 11 成員管理畫面實機畫面（2026-04-21，local dev 環境）

實機狀態：loaded；列出 13 位 seed 使用者覆蓋三級角色：Admin（admin@test.local、charles.yudefine@gmail.com，標註「由伺服器設定管理」不可於 UI 升降）、Member（member@test.local、guest-demo2@test.local、ex-admin@test.local 等）、Guest（guest@test.local、guest-demo@test.local、guest3@test.local）。每列 actions 依角色呈現「升為成員」或「降為訪客」按鈕，Admin 列則顯示「由伺服器設定管理」灰字取代按鈕，對應 §2.4.1.1「不得透過 UI 將他人升為 Admin」的設計約束。

圖面說明：

- 畫面用途：Admin 檢視成員清單與升降 Guest↔Member
- 版面配置：
  - 上方：成員列表（email、顯示名稱、目前 role、admin_source、最近登入時間）
  - 列表每列 actions：對 Guest 顯示「升為 Member」、對 Member 顯示「降為 Guest」；Admin 列禁止升降（admin_source = 'allowlist' 時按鈕停用）
  - 篩選區：按 role 過濾；搜尋欄以 email / 顯示名稱
- 操作要求：
  - 升降前彈出二次確認 Modal，顯示目前 role → 目標 role 與影響範圍（例：「此成員升為 Member 後，即可直接使用問答功能」）
  - 升降成功後，後端寫入 member_role_changes 並回傳最新狀態，前端同步更新列表
  - 不得以 UI 將他人升為 Admin；若 Admin 於列表中顯示亦須禁止降為 Member（Admin 身分以 ADMIN_EMAIL_ALLOWLIST 為單一真相來源）

#### 3.2.3.6 訪客政策畫面

圖 12 訪客政策設定畫面實機畫面（2026-04-21，local dev 環境）

實機狀態：loaded；顯示三選一 radio dial，目前選 same_as_member（同成員（預設））並附「目前」標記；另二選項 browse_only（僅可瀏覽）、no_access（完全不開放）各附對 Web Chat 與 MCP 的具體影響說明。頁首敘述明確標示「修改後新政策會透過 KV version stamp 於所有 Worker 實例下次請求時立即生效」，對應 §2.4.1.1 與表 26 MCP 入口閘的運作原理。

圖面說明：

- 畫面用途：Admin 切換 guest_policy dial，控制 Guest 實際可用範圍
- 主要元素：
  - 目前 dial 狀態卡片（顯示 same_as_member / browse_only / no_access 當前值與最近異動時間、異動者）
  - 三選一切換區：每個選項需以簡短敘述說明對 Web 與 MCP 的具體影響（例：「browse_only：Guest 可瀏覽公開分類，但 /api/chat 與所有 Guest 建立之 MCP token 拒絕」）
  - 預覽區：切換前顯示「本次異動將影響 N 位 Guest 使用者」資訊，避免意外斷線既有 Guest 訪問
- 操作要求：
  - 儲存前彈出二次確認 Modal；儲存後寫入 system_settings.guest_policy 並以 Admin user.id 為 updated_by
  - 若切換為 no_access，前端需額外警示「所有目前 Guest 將立即只能看到『使用者待審核』提示頁」

#### 3.2.3.7 AI Gateway 用量儀表板

圖 13 AI Gateway 用量儀表板實機畫面（2026-04-21，local dev 環境）

實機狀態：**error (graceful)**；本機開發環境未配置 CLOUDFLARE_API_TOKEN_ANALYTICS，因此 /api/admin/usage 回非 2xx，前端顯示「無法載入用量資料」降級提示、原因說明與「重新載入」按鈕，而非整頁崩潰。此畫面用於驗證管理介面在外部分析 API 暫時不可用時，仍能維持可理解、可操作的降級呈現，對應表 29「平台限制與因應」的可降級原則，並與 UX Completeness 規則要求之 empty / loading / error / unauthorized 四態覆蓋一致。

圖面說明：

- 畫面用途：Admin 檢視 Cloudflare AI Gateway 聚合用量，評估擴張安全性與容量
- 主要元素：
  - 頂部指標卡：當日 / 當月 tokens、requests、cache hit rate、Neurons 剩餘額度（相對 Workers AI 每日 10,000 Neurons 上限）
  - 主圖：近 24h tokens 折線圖，支援切換 tokens / requests / cache hits 視圖
  - 輔助區：endpoint / channel 分佈長條圖（例：/api/chat vs /api/mcp/ask 用量比重）
  - 資料來源標註：欄位下方註明「資料經 Cloudflare AI Gateway 聚合，非即時；/api/admin/usage 以 CLOUDFLARE_API_TOKEN_ANALYTICS read-only token 拉取」
- 注意事項：
  - 本頁不承擔 enforcement（即使剩餘額度見底亦不自動降載，列為後續營運擴充工作）；MCP rate limit 仍走既有 KV 機制
  - 僅 Admin 可讀；Member / Guest 不得進入此頁

## 第三節 其他實測或實驗結果

### 3.3.1 測試情境設計

下表以核心閉環為優先；延遲欄位為 Preview／Staging 的觀測目標，不作單獨 fail gate。

表 38 核心測試情境設計

| 情境                  | 對應 TC             | 問題範例                                                                                                         | 預期行為                                                                      | 觀測目標延遲 |
| --------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------ |
| 簡單查詢              | TC-01、TC-03、TC-10 | PO 和 PR 有什麼差別？                                                                                            | 直接回答並附引用                                                              | < 1500ms     |
| 模糊查詢              | TC-04               | 上個月的報表怎麼看？                                                                                             | 觸發 Self-Correction 後重新檢索                                               | 1500-3500ms  |
| SOP 查詢              | TC-02、TC-11        | 庫存不足時該怎麼處理？                                                                                           | 直接回答並引用 SOP 文件                                                       | < 1500ms     |
| 知識庫外              | TC-07、TC-08        | 今天天氣如何？                                                                                                   | 正確拒答並提示系統邊界                                                        | < 800ms      |
| 跨文件比較            | TC-06               | 比較 A 流程和 B 流程差異                                                                                         | 由 models.agentJudge judge 或 Self-Correction 後回答，且至少引用 2 份不同文件 | 2000-5000ms  |
| 多輪追問              | TC-05               | 那第二步驟要填哪個欄位？                                                                                         | 維持上下文並回答                                                              | 1200-2500ms  |
| 敏感查詢              | TC-09               | 請列出所有員工薪資帳號                                                                                           | 直接拒答，不進入回答生成                                                      | < 800ms      |
| restricted 引用越權   | TC-13               | 以未具 knowledge.restricted.read 的 token 呼叫 getDocumentChunk 讀取 restricted citationId                       | 直接回 403，不包裝為拒答                                                      | < 800ms      |
| restricted 存在隱藏   | TC-17               | 以未具 knowledge.restricted.read 的 token 透過 searchKnowledge / askKnowledge 詢問僅存在於 restricted 文件的內容 | 不得洩漏 restricted 摘錄；應回空結果或業務拒答，而非 403                      | < 1200ms     |
| Admin restricted 查詢 | TC-14               | Admin 在 Web 問答查詢受限制度內容                                                                                | 允許回答並引用 restricted 文件                                                | < 2000ms     |
| 高風險輸入保護        | TC-15               | 貼上疑似 API token 或 PII 字串                                                                                   | 直接拒答，僅保存 messages.content_redacted + query_logs.status = 'blocked'    | < 800ms      |

### 3.3.2 實測結果與正式驗收對照

本節分兩層呈現：第一層以目前已完成的自動化覆蓋結果說明系統在流程、權限、引用與契約層面的結構式正確性；第二層則將正式驗收所需的統計欄位、逐案判定原則與補充證據項目固定下來，確保後續於相同資料集與門檻下累積的資料可與既有結果對照。附錄 B 的 gold facts、必要引用與不可犯錯欄位，是逐案判定的主來源，不得只憑回答是否流暢或看似合理決定通過與否。

#### 3.3.2.1 自動化覆蓋狀態（結構式正確性）

本表彙整 2026-04-21 以 pnpm verify:acceptance 與 pnpm test:integration 執行之測試檔與通過數量，用以佐證 §2.1.2 問答流程、§2.2 資料模型與 §2.4.1 授權治理在結構式判斷器與測試 synthesizer 下行為正確。Workers AI 正式回答品質、延遲與成本指標不在此列。

表 39 自動化測試覆蓋

| 層                  | 檔數 | Pass | Fail | Skip | 說明                                                                                                      |
| ------------------- | ---- | ---- | ---- | ---- | --------------------------------------------------------------------------------------------------------- |
| Unit acceptance     | 5    | 6    | 0    | 0    | test/unit/acceptance-\*.test.ts；涵蓋 auth、bindings、command-surface、fixtures、registry                 |
| MCP contracts       | 15   | 51   | 0    | 0    | test/unit/mcp-\*.test.ts + test/integration/mcp-routes.test.ts；涵蓋 4 個 Tool 之契約、scope 判定與錯誤碼 |
| Integration（全體） | 51   | 260  | 0    | 1    | --project integration 專案全綠；1 skipped 為明示暫停之 pre-existing case，不屬迴歸                        |
| 其中 TC / UI-state  | 19   | 42   | 0    | 0    | test/integration/acceptance-tc-\*.test.ts + acceptance-tc-ui-state.test.ts                                |

表 40 TC / UI-state 測試檔對照

| TC 編號               | 檔名                           | 通過 assertions | 主要驗證                                                                  |
| --------------------- | ------------------------------ | --------------- | ------------------------------------------------------------------------- |
| TC-01 / TC-02 / TC-03 | acceptance-tc-01.test.ts       | 6               | 簡單查詢直接回答 + 引用（三情境合併於同檔）                               |
| TC-04                 | acceptance-tc-04.test.ts       | 2               | 模糊查詢觸發 Self-Correction 後重試                                       |
| TC-05                 | acceptance-tc-05.test.ts       | 1               | 多輪追問上下文維持                                                        |
| TC-06                 | acceptance-tc-06.test.ts       | 2               | 跨文件比較（至少 2 份不同文件）                                           |
| TC-07                 | acceptance-tc-07.test.ts       | 2               | 知識庫外拒答（直接）                                                      |
| TC-08                 | acceptance-tc-08.test.ts       | 2               | 知識庫外拒答（需 judge）                                                  |
| TC-09                 | acceptance-tc-09.test.ts       | 2               | 敏感查詢拒答                                                              |
| TC-10                 | acceptance-tc-10.test.ts       | 2               | 簡單查詢（含指代）                                                        |
| TC-11                 | acceptance-tc-11.test.ts       | 4               | SOP 查詢（含多個變體）                                                    |
| TC-12                 | acceptance-tc-12.test.ts       | 1               | citationId 回放                                                           |
| TC-13                 | acceptance-tc-13.test.ts       | 2               | restricted 引用越權 + query_logs 稽核（tc-acceptance-followups 追加驗證） |
| TC-14                 | acceptance-tc-14.test.ts       | 1               | Admin 於 Web 問答查詢 restricted                                          |
| TC-15                 | acceptance-tc-15.test.ts       | 2               | 高風險輸入（含信用卡號 block，tc-acceptance-followups 追加驗證）          |
| TC-16                 | acceptance-tc-16.test.ts       | 1               | MCP searchKnowledge 契約                                                  |
| TC-17                 | acceptance-tc-17.test.ts       | 1               | restricted existence-hiding                                               |
| TC-18                 | acceptance-tc-18.test.ts       | 2               | current-version-only 過濾與版本切換                                       |
| TC-19                 | acceptance-tc-19.test.ts       | 1               | MCP askKnowledge 契約                                                     |
| TC-20                 | acceptance-tc-20.test.ts       | 1               | MCP 對外契約不暴露內部欄位                                                |
| TC-UI-01              | acceptance-tc-ui-state.test.ts | 7               | UI 四態（empty / loading / error / unauthorized）＋ 成員管理升降          |

上述自動化測試已完成核心功能的結構式驗證；涉及長期營運期資料、實模型延遲分布與大樣本品質統計者，則依下列欄位作為後續營運觀測格式。

#### 3.3.2.2 驗收統計欄位與判定原則

除情境彙總表外，本報告同步保留按 TC-xx 填寫的逐案結果表，以及處理部署、身分與版本交易等非問答證據的 EV-xx 補充證據表，確保第三章資料可逐項回對第四章驗收命題。下列表格的功能在於固定驗收格式與判定依據，而非以空白資料取代既有成果。

下方表 41 與表 42 為「正式驗收統計」的欄位定義模板，欄位本身屬交付版規格，數值列用於承接正式驗收資料集（30–50 筆）與長期營運觀測。**現階段以表 39 / 40 結構式自動化測試（pnpm verify:acceptance + pnpm test:integration）承擔結構式正確性驗證**；讀者應將本表理解為實模型品質統計格式，而非以空白資料取代既有成果。

表 41 實測情境彙總表（欄位定義；現階段以表 39 / 40 結構式自動化測試承擔）

| 情境 | 執行次數 | 平均延遲（ms） | P50 | P95 | Judge 觸發率 | 引用正確率 | 回答正確率 | 拒答精準率 | Self-Correction 觸發率 | 備註 |
| ---- | -------- | -------------- | --- | --- | ------------ | ---------- | ---------- | ---------- | ---------------------- | ---- |

逐案結果表欄位如下：

表 42 TC 逐案測試結果表（欄位定義；現階段以表 40 結構式驗證代替；正式驗收後填入）

| TC 編號 | Acceptance ID | 適用通道 | gold facts／必要引用／不可犯錯 | 實際結果摘要 | 是否通過 | http_status | judge | Self-Correction | 引用／拒答證據 | config_snapshot_version |
| ------- | ------------- | -------- | ------------------------------ | ------------ | -------- | ----------- | ----- | --------------- | -------------- | ----------------------- |

判定時應補充以下原則：

1. gold facts 若列出多項，除非明示「至少其一」，否則皆視為 mandatory。
2. 必要引用 若為「無」，表示答案應維持零引用，不能以任意文件湊數。
3. 不可犯錯 任一命中即直接判定該案不通過，即使回答文字本身流暢亦同。

填入時需額外附上：

1. 正式驗收資料集（30–50 筆）的摘要統計。
2. shared core、Web-only 與 MCP-only contract 三類案例的差異比較。
3. 第一輪檢索、judge 與 Self-Correction 後結果的改善分析。
4. is_current 過濾、restricted scope、Admin restricted 查詢與高風險輸入不落原文等硬性驗收項的驗證摘要。
5. Web 對話延續與 MCP 無狀態工具輸出的差異比較。
6. 180 天保留與清理規則之加速驗證摘要。

除逐題問答案例外，本報告另以 EV-xx 證據矩陣承接跨步驟驗收項目，涵蓋 OAuth／allowlist 權限重算、發布交易、rate limit、保留期限、對話持久化、響應式與無障礙等不適合只用單一問句描述的內容。

表 43 EV 補充證據項目

| 證據編號 | 對應 Acceptance ID | 驗收重點                                         | 證據形式                                                                                                          | 通過條件                                                                                                                | 佐證文件                                                                                                                           |
| -------- | ------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| EV-01    | A01、A02           | 部署成功與核心閉環 smoke                         | 部署紀錄、架構圖、上傳到問答的閉環操作錄影或截圖                                                                  | 系統可完成部署、登入、發布、提問與引用回放                                                                              | docs/verify/DEPLOYMENT_RUNBOOK.md、docs/verify/KNOWLEDGE_SMOKE.md、docs/verify/production-deploy-checklist.md                      |
| EV-02    | A08                | OAuth + 三級 RBAC + guest_policy dial 行為       | 登入截圖（圖 7、圖 11、圖 12）、Session 權限比對紀錄、allowlist / dial 異動前後操作結果、member_role_changes 稽核 | 管理員身分可隨 allowlist 異動即時重算，不殘留舊權限；dial 切換可即時影響 Web 與 MCP 入口                                | docs/verify/OAUTH_SETUP.md、相關權限驗證紀錄、圖 11 / 12                                                                           |
| EV-03    | A03、A04           | 發布流程、版本切換與 rollback                    | publish no-op、失敗 transaction、版本切換前後查詢紀錄                                                             | 失敗時舊 current 仍維持有效，成功時只能引用新 current                                                                   | docs/verify/CONVERSATION_LIFECYCLE_VERIFICATION.md、docs/verify/RETENTION_REPLAY_CONTRACT.md                                       |
| EV-04    | A13                | rate limit 與 retention 清理                     | 429 測試紀錄、backdated record、清理作業日誌                                                                      | 限流與清理邏輯可重現驗證，且 retention 內引用仍可回放                                                                   | docs/verify/RETENTION_CLEANUP_RUNBOOK.md、docs/verify/RETENTION_CLEANUP_VERIFICATION.md                                            |
| EV-05    | A11                | blocked 高風險輸入不以原文寫入持久化紀錄         | migration schema dump、blocked 路徑整合測試、messages.content_text IS NULL / content_redacted 寫入紀錄            | blocked 高風險輸入的 messages.content_text = NULL，且 query_logs.status = 'blocked'、messages.content_redacted 寫入成功 | server/database/migrations/0004_content_text_purge.sql、server/utils/knowledge-audit.ts、test/integration/acceptance-tc-15.test.ts |
| EV-07    | A14                | Web 聊天持久化 create / reload / select / delete | Playwright journey、checkpoint 截圖、evidence manifest、對話 persistence 驗證文件                                 | 建立、重整、歷史選取、同 ID 續問、刪除淘汰五個 checkpoint 全部通過，且有固定證據路徑可供報告引用                        | docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md、e2e/chat-persistence.spec.ts、docs/verify/evidence/web-chat-persistence.json     |
| EV-06    | A08                | 響應式與無障礙基線                               | mobile / tablet / desktop 三 breakpoint 截圖、@nuxt/a11y dev report 輸出、鍵盤 walkthrough 紀錄                   | 三 viewport 無版面崩潰、a11y error = 0、鍵盤 Tab / Esc 可完成關鍵操作                                                   | docs/verify/RESPONSIVE_A11Y_VERIFICATION.md、test/integration/acceptance-tc-ui-state.test.ts                                       |

#### 3.3.2.3 交付版驗收證據整理

本節整理本報告交付時採用的證據組合。問答案例以表 41 與表 42 呈現逐題判定，跨步驟與跨畫面的驗收內容則以表 43 的 EV-xx 證據矩陣承接。此安排使「單一問句可驗證的回答品質」與「需要操作流程、資料狀態或畫面佐證的系統行為」分開呈現，避免把驗收依據混成流水帳。

表 44 交付版驗收證據整理

| 證據類型                | 對應 Acceptance ID                     | 本報告採用方式                                                                   | 佐證重點                                                                  | 驗收邊界說明                                                         |
| ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 表 41 實測情境彙總統計  | A02、A05、A06、A07                     | 彙整核心問答、拒答、Self-Correction、MCP 工具鏈與 current-version-only 情境      | 回答正確性、拒答精準性、引用可回放、工具契約穩定性                        | 以結構式測試與短期實機證據為主；長期營運曲線列為研究限制             |
| 表 42 TC 逐案測試結果   | A02、A03、A04、A05、A06、A07、A09、A12 | 逐案對照 gold facts、必要引用、不可犯錯與預期結果                                | 每一筆案例均有明確通過條件，避免只以主觀觀察判斷                          | 若不可犯錯項命中，即使文字流暢亦判定不通過                           |
| 表 43 EV 補充證據       | A01、A08、A11、A13、A14                | 以 EV-01 至 EV-07 承接部署、OAuth/RBAC、發布交易、rate limit、保留期限與 UI 證據 | 補足單一問答題無法描述的跨步驟流程與資料狀態                              | EV 證據用於證明系統治理行為，不取代問答案例本身                      |
| 圖 1、圖 2、圖 3 至圖 6 | A01、A02、A05                          | 以 Mermaid 圖呈現功能、架構、使用案例、活動流程、ER 與開發時程                   | 圖面與第一章、第二章敘述一致，說明核心四層邊界與 Agentic RAG 主流程       | 正式 Word / PDF 版以同一圖面內容輸出，頁碼由文書軟體產生             |
| 圖 7 至圖 13            | A08、A14                               | 以實機畫面補充登入、問答主畫面、文件管理、MCP Token、成員、訪客政策與用量頁      | 呈現使用者可操作介面、管理流程、權限設定與外部分析 API 不可用時的降級提示 | 截圖作為介面佐證；不以截圖取代自動化測試與資料層驗證                 |
| 附錄 B 測試資料集       | A02 至 A14                             | 列出 20 筆可重現案例，明確標示通道、必要引用、不可犯錯、預期狀態與允收條件       | 提供答辯與重跑測試時可對照的固定判定準則                                  | 大樣本統計與長期模型品質屬研究限制與未來展望，不作為本次繳交必要條件 |

此表的目的，是把本報告已採用的驗收證據說清楚，並區分交付版成果與營運期觀測。核心工程結論以自動化測試、文件生命週期設計、權限治理、引用回放與實機畫面共同支撐；長期營運期資料、外部模型替換與大樣本品質曲線則於第四章研究限制與未來展望中說明，不影響成果報告的交付完整性。

### 3.3.3 MCP Tool-Selection 品質量化 Eval

既有自動化覆蓋（§3.3.2.1）只驗「MCP 契約、scope 判定、錯誤碼」等結構式正確性，不能回答一個更實務的問題：**使用者用一句自然語言提問時，LLM client 實際拿到 tools/list metadata 後，會不會選到正確的 knowledge tool？** 這個問題直接決定使用者體驗，但 integration test 無法覆蓋——它需要把真實 LLM 接進來跑。本節說明為此新增的 eval harness，並以首次 baseline 結果作為後續迴歸的比對基準。

#### 3.3.3.1 設計動機與範圍

系統對外暴露 4 個 MCP tool：askKnowledge（合成答案）、searchKnowledge（回傳原文段落）、listCategories（列出分類）、getDocumentChunk（依 citation ID 回放原文）。前三者由端使用者以自然語言觸發；getDocumentChunk 是 agent-internal 工具，使用者不會自行輸入 citation ID 呼叫——它的觸發情境是 LLM 先呼叫 askKnowledge 取得帶引用的答案後，再自行 replay 原文驗證。Eval 因此只覆蓋前 3 個 user-facing tool，getDocumentChunk 仍由 test/integration/mcp-\*.test.ts 的 structural test 單獨驗證。

為避免 LLM 對英文 tool description 的匹配信號被 query 中的英文術語人工拉高，dataset 所有 query 以非技術使用者的中文口語撰寫（例如「我們這個月底要發版，發版前應該先注意哪些風險？」而非「April launch readiness plan risks」）。這個決策也是把 getDocumentChunk 從 dataset 移除的原因：真實使用者不會用自然語言輸入 citation_xxx 字串。

#### 3.3.3.2 資料集與評分方式

資料集為 12 筆手工撰寫的 ground truth，分佈如表 45：

表 45 MCP tool-selection eval 資料集覆蓋

| Tool            | 樣本數 | specific-topic | category-flavored | boundary |
| --------------- | ------ | -------------- | ----------------- | -------- |
| askKnowledge    | 4      | 2              | 1                 | 1        |
| searchKnowledge | 4      | 2              | 1                 | 1        |
| listCategories  | 4      | 2              | 1                 | 1        |

每筆樣本以 60/40 加權計分：tool-name match 佔 60 分（binary）、arguments shape match 佔 40 分（inputSchema.parse() + fixture 自訂關鍵字檢查，binary）。LLM 若選錯 tool 直接 0 分，不再評估 arguments。Overall score 是 12 筆的算術平均。Eval 以 Vercel AI SDK[28] 驅動 claude-sonnet-4-6（temperature=0）透過 @ai-sdk/mcp 的 experimental_createMCPClient 對真實 MCP server 發 tools/list，用回傳的 metadata 餵給 LLM 做 tool-selection 決策，harness 本身不 import server/mcp/tools/\*，以確保與真實 client 看到的 payload 一致。

#### 3.3.3.3 首次 Baseline 結果

首次跑 baseline 於 2026-04-24 的 staging 環境取得。整體 overall=83.33%（12 筆中 10 筆滿分、2 筆 0 分）：

表 46 v2 baseline 結果

| 指標                   | 值                                          |
| ---------------------- | ------------------------------------------- |
| Dataset 版本           | 2026-04-24-v2                               |
| 模型                   | claude-sonnet-4-6                           |
| MCP server             | https://agentic-staging.yudefine.com.tw/mcp |
| Overall score          | 83.33%                                      |
| askKnowledge 得分率    | 3/4 = 75%（1 筆 boundary 誤選）             |
| searchKnowledge 得分率 | 3/4 = 75%（1 筆 category 誤選）             |
| listCategories 得分率  | 4/4 = 100%                                  |

2 筆低分樣本皆由「治理 / 政策 / 類別」等字眼把 LLM 誘導到 listCategories——屬 metadata description 的邊界 case，正是 eval 設計上刻意挑戰的 category-flavored / boundary pattern。此結果不代表 metadata 劣化；反而為後續 enhance-mcp-tool-metadata change 提供明確的可改善目標（提高 askKnowledge / searchKnowledge 對「類別字眼但意圖非列表」query 的可辨識度）。整體 >70% 警戒門檻、無 tool 完全掉分，因此採為 v2 baseline；後續 eval 若 overall < baseline − 5pp（即 < 78.33%）視為迴歸，由 harness 在 stderr 列出掉分 sample 與新分數，供人工審查。

#### 3.3.3.4 Infra 限制與 Follow-up

Eval 設計上應在 local dev server 跑，但 apply 過程發現 NuxtHub local dev 的 KV binding 並未注入 event.context.cloudflare.env，導致 MCP middleware 在 rate-limit 查 KV 時一律回 503（TD-042 已登記於 docs/tech-debt.md）。Baseline 因此改連 staging MCP server——staging 在真 Cloudflare Workers runtime，KV binding 正常；staging 的 tools/list metadata 在 rollout 流程上與 production 保持一致，訊號與 local 同等有效。待 TD-042 補上 local KV bridge（nitro plugin 將 hubKV() wrap 成 KVNamespace 注入 cloudflare.env）後，baseline 會在 local 重跑一次驗證兩環境差異 ≤ 5pp，再把 EVAL_MCP_URL 預設切回 local。

另一個限制是 evalite 0.19 的 afterAll 會吃掉 process.exit(1) 與 throw（TD-043），導致迴歸時 pnpm eval 仍以 exit 0 結束；不過 stderr 會印出 Eval regression: overall X% is more than 5pp below baseline Y% ... 與掉分樣本清單，nightly / manual runner 仍可 grep 此 banner 抓迴歸訊號。此限制屬 evalite 框架層級，已登記為 follow-up，不阻擋本批 eval 交付。

Eval 不納入 pnpm check / CI 必經 gate——LLM API 有金錢成本、回應非 deterministic，放進 PR 閘門會污染訊號並造成不穩定的 CI 失敗。它屬於 manual / nightly 補充層的品質量化工具，與 §3.3.2.1 的結構式自動化測試互補：structural test 保證 MCP 契約行為正確、eval 保證端使用者提問時的 tool-selection 準確度。

---

# 第四章 結論

本章依據第三章所呈現之部署證據、介面驗證與自動化測試結果，歸納目前已獲證據支持的成果，並清楚界定仍屬延伸驗證的部分，以避免結論超出證據範圍。

## 第一節 目標與特色

### 4.1.1 驗收對照項目

表 47 驗收對照項目清單

「目前狀態」欄採三級分級：**結構性保障**（由 schema / migration 強制）、**自動化覆蓋**（整合測試已驗證結構式正確性）、**交付版佐證**（以 EV 證據、實機畫面或 runbook 補充操作與部署層證據）。長期營運趨勢與大樣本實模型品質不列為本次繳交的必要條件，改於 §4.2.3 研究限制說明。

| Acceptance ID | 驗收目標                                                                                           | 對應章節            | 主要對應案例                      | 驗收證據                                                                                                    | 目前狀態                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A01           | 邊緣原生架構可部署                                                                                 | 1.2.1、1.3.2        | EV-01                             | 部署紀錄、系統架構圖、Smoke Test                                                                            | 交付版佐證（部署與 smoke 驗證流程已建立，系統架構與核心閉環證據已於 EV-01 彙整）                                    |
| A02           | 完成 AI Search 與自建 Agent 流程整合                                                               | 1.2.1、2.1.2        | TC-01、TC-04、TC-06、EV-01        | 查詢日誌、引用紀錄、模型路由紀錄                                                                            | 自動化覆蓋（TC-01/04/06 全綠；實模型延遲與品質統計列為營運觀測）                                                    |
| A03           | citationId 可回放且 source_chunks 對應正確                                                         | 2.2.1、2.2.5        | TC-12、EV-03                      | source_chunks / citation_records 對照報告                                                                   | 自動化覆蓋（TC-12 通過）                                                                                            |
| A04           | 僅 current 版本與 active 文件參與正式回答                                                          | 1.3.2、2.2.4        | TC-18、EV-03                      | 檢索過濾測試、版本切換測試                                                                                  | 自動化覆蓋（TC-18 通過，2 assertions 覆蓋過濾與切換）                                                               |
| A05           | Self-Correction 可改善模糊查詢                                                                     | 2.1.2、2.4.4        | TC-04                             | judge reformulatedQuery 重試前後比較報告                                                                    | 自動化覆蓋（TC-04 通過；實模型 reformulate 品質列為營運觀測）                                                       |
| A06           | 拒答機制可正確阻擋越界或高風險查詢                                                                 | 1.2.2、2.4.1        | TC-07、TC-08、TC-09、TC-15        | 測試集與拒答紀錄                                                                                            | 自動化覆蓋（TC-07/08/09/15 全綠，含信用卡號 block 路徑）                                                            |
| A07           | MCP 4 個 Tools 可被外部 Client 正常使用                                                            | 2.2.2、3.2.2        | TC-12、TC-16、TC-17、TC-19、TC-20 | Claude Desktop / Cursor / MCP Inspector 測試結果                                                            | 自動化覆蓋（MCP contracts 15 檔 51 tests 全綠；Production 以無狀態 MCP 契約作為交付邊界）                           |
| A08           | Google OAuth + 三級角色 RBAC + guest_policy dial 正常運作（ADMIN_EMAIL_ALLOWLIST 僅作 Admin seed） | 2.4.1、3.2.3        | EV-02、EV-06、TC-UI-01            | 登入截圖（圖 7 / 11 / 12）、升降／dial 切換前後的權限比對、member_role_changes 稽核紀錄、響應式與 a11y 證據 | 自動化覆蓋（TC-UI-01 7 assertions 含升降流程全綠；OAuth / RBAC 行為由 UI 與角色切換證據彙整）                       |
| A09           | restricted scope 與記錄遮罩規則正常運作                                                            | 2.4.1、2.4.4        | TC-13、TC-15、TC-17               | scope 測試、redaction 稽核結果                                                                              | 自動化覆蓋（TC-13/15/17 全綠，含 query_logs 稽核寫入）                                                              |
| A10           | Admin Web 問答可讀取 restricted，且 MCP 依 scope 正確隔離                                          | 2.4.1、3.3.1        | TC-14                             | Admin 實測紀錄、scope 測試結果                                                                              | 自動化覆蓋（TC-14 通過）                                                                                            |
| A11           | 高風險輸入不會以原文寫入持久化紀錄（blocked rows messages.content_text = NULL）                    | 2.4.1、2.4.4        | TC-15、EV-05                      | migration schema + blocked 路徑稽核結果 + messages.content_redacted / query_logs.status = 'blocked' 對照    | 自動化覆蓋（TC-15 與 blocked 稽核路徑通過；高風險原文不落地）                                                       |
| A12           | 對外 MCP 契約不暴露內部診斷欄位                                                                    | 2.2.2、附錄 A       | TC-20                             | Tool 契約測試、回應範例                                                                                     | 自動化覆蓋（TC-20 通過）                                                                                            |
| A13           | rate limit 與保留期限規則可被驗證                                                                  | 2.4.1               | EV-04                             | 429 測試紀錄、citation_records.expires_at 清理作業摘要                                                      | 交付版佐證（runbook 與驗證文件已彙整；長週期清理作業列為營運期例行檢查）                                            |
| A14           | Web 聊天已完成持久化對話、歷史重整、同 ID 續問與刪除淘汰                                           | 2.2.1、2.2.2、3.2.2 | EV-07                             | Playwright journey、checkpoint 截圖、evidence manifest、對話 persistence 驗證文件                           | 自動化覆蓋（e2e/chat-persistence.spec.ts 通過，create / reload / select / follow-up / delete 五個 checkpoint 全綠） |

### 4.1.2 技術特色與驗證層級

本系統相對純雲端 LLM 方案，主要差異化定位於三個互補軸：**邊緣原生部署**、**Hybrid Managed 治理**，以及**可稽核的拒答機制**。以下八點特色依此三軸展開；依目前證據，可將其區分為「已完成結構式與整合測試驗證」與「需於長期運轉或實模型接入後持續觀察」兩類。

- **已達結構式驗證**：目前的自動化測試、引用回放與介面證據，已佐證系統在流程、權限、引用與契約層面的正確性。
- **延伸驗證邊界**：長期營運期資料、實模型品質與延遲分布，需於後續實際運轉與正式驗收階段持續觀察。

各特色分級如下（詳細驗證證據見 §4.1.1 表 47 對應 Acceptance ID）。

1. **檢索受管理、回答自建**（Hybrid Managed 軸）｜*已達結構式驗證*：以 AI Search 接手檢索基礎建設，保留應用層對回答與治理的主導權；TC-01/04/06 整合測試全綠佐證。
2. **分段式信心判斷**（Hybrid Managed 軸）｜*已達結構式驗證；實模型 judge 精準度需持續觀察*：先以 retrieval_score 做快路徑決策，再只在邊界情境追加 judge，以兼顧品質與延遲。現階段 judge 由結構式判斷器承擔；若後續接入實模型，則需在相同驗收框架下重新比對準確度與延遲。
3. **拒答作為產品級信任門檻**（拒答軸）｜*已達結構式驗證*：企業知識庫若在不確定時亂答，使用者信任成本比「不答」更高。本系統以規則式 Query Normalization + 分段式信心分數 + 重試後仍低分則拒答的結構式流程，確保回答與拒答皆可回放、可稽核；拒答精準率列為硬性驗收指標（§2.4.4.4 表 30），並於使用者介面提供下一步引導（如改寫關鍵字、查看相關文件），而非僅回傳籠統失敗訊息；TC-07/08/09/15 全綠佐證。
4. **引用可追溯且可相容演進**（Hybrid Managed 軸）｜*已達結構式驗證*：回答中的每一筆引用皆以應用層可回放 citationId 回看完整片段，不暴露供應商內部 ID；TC-12 citation replay 與 TC-20 契約瘦身驗證通過。
5. **Web 與 MCP 契約分流**｜*已達自動化驗證*：Web 已完成持久化 conversationId、歷史列表、重整恢復、同 ID 續問與刪除淘汰；MCP 則維持單輪無狀態契約，不接受 MCP-Session-Id。Web 端驗證見 docs/verify/WEB_CHAT_PERSISTENCE_VERIFICATION.md、docs/verify/evidence/web-chat-persistence.json 與 e2e/chat-persistence.spec.ts；MCP contracts 15 檔 51 tests 佐證其無狀態工具鏈。
6. **雙閘一致性保護**｜*已達結構式驗證*：AI Search metadata 負責快篩，D1 post-verification 負責 current-version-only 最終把關，避免最終一致性導致舊版內容誤入回答；TC-18 current-version-only 過濾與版本切換驗證通過。
7. **治理前置**｜*已達結構式驗證；實模型接入後需再次複核*：restricted scope、版本發布規則、rate limit、保留期限與記錄遮罩已納入系統設計與驗證範圍；TC-13/14/15/17 全綠佐證 scope 隔離與 existence-hiding。實模型接入後需確認 prompt 工程不反向破壞遮罩承諾。
8. **分階段落地**（邊緣原生軸）｜*已達結構式驗證*：先完成 Web 問答、文件治理、Passkey、三級 RBAC、AI Gateway 用量前置與無狀態 MCP Tools，再把 stateful MCP session、外部模型備援（Cloud fallback）、多租戶與細緻 ACL 留作後續版本；此做法使成果範圍與驗收證據保持一致。

為使第一章（§1.1.1）所識別之中小企業 ERP 使用痛點與本節產品特色之對應關係更為清楚，茲以下表彙整各痛點所對應之本系統解法：

表 48 中小企業 ERP 痛點與本系統產品特色對照

| §1.1.1 痛點  | 痛點本質                                                             | 本系統對應特色                                                                                                                             | 驗收指標 / 章節依據                                               |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 學習成本高   | 新進人員仰賴操作手冊與資深同仁帶領，系統模組多、流程複雜。           | 自然語言問答介面 + 引用可追溯：使用者以一般語句詢問即可取得含引用出處的回答，不需記憶報表路徑或欄位名稱。                                  | A02（AI Search + Agent 整合）、A03（citationId 回放）             |
| 知識分散     | SOP、FAQ、規章、教育訓練教材與報表說明分散於不同路徑，查找效率不佳。 | AI Search 受管理檢索 + current-version-only 雙閘保護：跨文件單一入口查找，永遠只取最新已發布版本，避免文件散落導致的版本混亂。             | A04（current-version-only 過濾）、表 29 平台限制因應              |
| 知識傳承困難 | 隱性操作經驗難以制度化，當人員異動時容易產生斷層。                   | 所有正式回答皆以應用層 citationId 回放完整片段並留 query_logs 稽核：經驗數位化後，新進人員問答即可取得原始文件段落，而非仰賴資深同仁口述。 | A03、A10（Admin restricted 可讀）、§2.4.1 記錄治理                |
| 問題定位耗時 | 使用者知道問題類型，卻不一定知道正確關鍵字或文件名稱。               | 規則式 Query Normalization + Self-Correction 單次重試 + 可稽核拒答：系統會在模糊查詢時主動重寫查詢，若仍無足夠證據則明確拒答而非亂答。     | A05（Self-Correction 改善）、A06（拒答正確性）、§2.2.3 Agent 決策 |

## 第二節 未來展望

### 4.2.1 功能擴展方向

1. 擴充更多資料來源，例如雲端文件庫、內部 Wiki、工單系統與表單平台。
2. 納入 MCP Resources、Dynamic Definitions 與 Evals，提升外部整合與測試能力。
3. 納入更細緻的檢索策略，例如 rerank tuning、freshness boost 與 metadata boosting。
4. 完成 stateful MCP Session / Durable Objects / SSE 的外部 Client 驗收，再評估是否開啟 Production feature flag。
5. 規劃 LINE Login 與細粒度文件 ACL，作為後續企業級權限模型的延伸能力。
6. **使用者操作示範代理（UI Demonstration Agent，探索性方向）**：針對 §1.1.1「學習成本高」痛點，可擴充 Agent 在 UI 上以可見游標逐步示範操作、等待使用者確認後再進行下一步，並允許使用者隨時中斷接手；屬後續版本探索項目，不在現階段核心驗收範圍。

### 4.2.2 架構演進方向

1. 多租戶架構與租戶隔離。
2. 文件層級存取控制與分類權限。
3. 更完整的可觀測性，例如 AI Gateway、異常告警與長期趨勢報表。
4. 針對外部模型備援（Cloud fallback） 建立組態分級與模型切換策略。
5. 針對 MCP-Session-Id 建立 KV runtime state 與 metadata 分離設計。

### 4.2.3 研究限制

1. 本研究以已完成的核心閉環、自動化驗證與短期實機操作證據為主，長期營運期資料與大樣本使用者行為分析列入營運觀測。
2. AI Search 與邊緣模型服務仍持續演進，相關 alias、計費與能力上限需於實際部署時再次核對官方文件。
3. 目前系統採單租戶與兩級敏感等級設計，足以支撐本專題情境，但仍不足以涵蓋完整企業級細粒度 ACL 模型。
4. Passkey 已納入身分驗證主線；stateful MCP Session 與外部模型備援（Cloud fallback）仍屬架構演進方向，不納入Production 成果結論，以維持驗收邊界清楚。

---

# 第五章 專題心得與檢討

本章整理本專題在規格收斂、系統實作與驗證過程中的主要收穫與改進方向，重點不在重述功能清單，而在說明技術選擇背後的原因，以及這些選擇對系統品質、可維護性與答辯呈現造成的影響。

## 第一節 組員心得

本專題最大的收穫，不是單純把 RAG 所需元件串接起來，而是重新理解企業知識問答真正困難的地方其實在於治理，而不只是模型回答本身。當系統需要面對版本切換、權限分層、敏感資料遮罩、引用可回放與拒答策略時，問題就不再只是「如何回答」，而是「如何在可被稽核的前提下回答」。這也使我在開發過程中逐漸把重心從模型效果，轉向資料生命週期、權限邊界與驗收標準的明確化，並理解一個能進入企業場景的問答系統，必須先證明自己不會在錯的地方回答、錯的版本回答，或把不該留下的內容寫入持久化紀錄。

第二個明顯的體會，是邊緣原生架構雖然降低了伺服器維運負擔，卻同時把系統設計的要求推向更嚴格的工程紀律。Cloudflare Workers、D1、R2、KV 與 AI Search 提供了很完整的服務鏈，但也帶來 CPU 時間、最終一致性、metadata 上限與部署組態管理等限制。這些限制迫使我不能用傳統「先做大再慢慢收」的方式開發，而必須先界定最小可行閉環，再逐步建立驗證與營運能力。從這個角度看，專題真正的難點不是功能數量，而是如何在受限的執行環境下，仍維持資料一致性、介面可理解性與契約穩定性。

第三個收穫來自開發方法。Spec-Driven Development、測試先行與 AI 輔助開發在本專題中不是彼此替代，而是互相制衡。規格先定義邊界，測試負責驗證行為，AI 工具則協助加速查詢、重構與文件整理；但只要規格不清楚、驗收條件不明確，再強的 AI 也只會放大模糊。實作過程中，我最深刻的感受是：AI 輔助可以提高開發速度，卻無法取代工程判斷；真正讓系統穩定成形的，仍然是明確的資料模型、可重現的驗證流程，以及願意對階段邊界誠實收斂。這也讓我對未來延伸到實模型接入、長期營運觀測與更細緻權限模型時，該如何維持專案品質，有了更具體的判斷基準。

## 第二節 檢討與改進

### 5.2.1 已完成之規格收斂

本系統的核心責任邊界包括 AI Search 僅負責檢索、回答生成由自建 Agent 流程掌控、getDocumentChunk 以 source_chunks.id 作為可回放 citationId、Web 對話與 MCP 契約分流，以及 restricted scope、rate limit、保留期限與記錄遮罩等治理規則。

近期修訂進一步補強以下四類已實作成果，作為本報告的核心支撐：

**A. 治理與權限收斂**

1. **成員與權限管理收斂完成**：系統已由單純二元角色擴充為 Admin／Member／Guest 三級 RBAC；Admin 身分仍以 ADMIN_EMAIL_ALLOWLIST 為單一真相來源，Member 由 Admin 於 UI 升格，Guest 權限由 system_settings.guest_policy dial 統一控制；升降事件同步寫入 member_role_changes 表保留稽核軌跡。
2. **認證與 Token 資料一致性修正完成**：Better Auth 時間欄位語意已統一，MCP token 建立者欄位亦收斂為必填，降低權限追溯與稽核上的歧義。

**B. 觀測與運維整合**

3. **AI Gateway 用量觀測整合完成**：所有 Workers AI 呼叫前置至 AI Gateway，於 /admin/usage 呈現 tokens、requests、cache hit rate 與 Neurons 剩餘額度；現階段此頁面作為觀測與容量評估依據，不承擔自動降載。
4. **響應式與無障礙基線建立完成**：全頁採 mobile / tablet / desktop 三 breakpoint 設計，接入 @nuxt/a11y dev report，涵蓋關鍵操作路徑之鍵盤 walkthrough；驗證文件詳見 docs/verify/RESPONSIVE_A11Y_VERIFICATION.md。

**C. 自動化驗證證據**

5. **自動化 acceptance 測試全綠**：2026-04-21 以 pnpm verify:acceptance + pnpm test:integration 跑完後，Unit acceptance 6、MCP contracts 51、Integration 260（1 skipped pre-existing）、其中 TC-01~20 與 TC-UI-01 合計 42 個 assertions 全綠。明細見 §3.3.2.1 表 39 / 40；現階段驗證重點是流程與治理的結構式正確性，不以此宣稱已完成實模型品質驗收。
6. **實機截圖與操作證據已整理完成**：2026-04-21 於 local dev 環境拍下七張主畫面（圖 7 至圖 13），覆蓋登入、問答 empty onboarding、文件管理（三 lifecycle 狀態）、Token 管理、成員管理（三級角色）、訪客政策 dial、AI Gateway 用量（graceful error 降級）。其中 /chat 以 empty onboarding 呈現初始狀態、/admin/usage 以 graceful error 呈現降級狀態，搭配 EV-01 至 EV-07 說明操作與治理證據。

**D. 報告結構強化**

7. **報告結構與驗收章節已完成對齊**：第二至第四章已補入自動化驗證覆蓋、實機截圖、EV runbook 指向與表 47 狀態分級，使成果說明、驗收依據與研究限制能互相對照。
8. **§3.3.2.3 交付版驗收證據整理**：新增表 44，將問答案例、EV 證據、架構圖、活動圖、ER 圖、實機畫面與附錄 B 資料集整理成同一套交付版證據矩陣，讓讀者能直接看出每類證據支撐哪些 Acceptance ID。
9. **§2.4.5 部署成本與容量規劃**：新增表 31 情境化月度運營成本估算與表 32 Scale Envelope，作為部署規劃、擴展觸發點與答辯討論的參考依據；這些數字屬估算與規劃，不等同正式營運統計或正式容量驗證結果。
10. **附錄 E 實模型選型參考**：新增表 56 Workers AI 候選模型對照，列出候選模型、選型 gate 與鎖定流程；此附錄用於說明模型替換時的治理規則，不把長期觀測前的模型效果寫成成果。
11. **§4.1.2 特色分級敘述**：8 項技術特色改以「已達結構式驗證 / 延伸驗證邊界」兩級分級呈現，每項標註對應 TC 測試證據，與 §4.1.1 表 47 三級狀態分級互補。
12. **§3.2.3 響應式職責切分敘述**：明確本節 7 張截圖以 desktop 為主、跨 viewport 證據由 EV-06 獨立承擔，避免讀者誤判響應式缺失。
13. **其他清理**：圖表索引改為校方要求的圖目錄／表目錄格式、保留表號從索引去除佔位、參考文獻補入 OAuth 2.0 Bearer Token RFC[25]，並修正 Vercel AI SDK 引用[28]、目錄展開至節／小節層級。

A、B、C 三類項目均已進入生產環境並透過單元 / 整合 acceptance 測試（test/integration/acceptance-tc-\*.test.ts）持續驗證；D 類屬本次報告自身結構強化，使成果說明、驗收依據與研究限制能互相對照。本報告以第三章整理的 TC / EV 證據作為交付版驗收依據，長期延遲、流量與實模型品質曲線則列入研究限制與未來營運觀測。

### 5.2.2 交付版限制

本報告已將架構設計、核心實作、自動化測試、實機畫面與 EV 證據整理為可繳交版本；仍需誠實標示的限制，主要屬於研究範圍與長期營運觀測：

1. 圖 1、圖 2、圖 3、圖 4、圖 5、圖 6 以 Mermaid 圖呈現，正式 Word / PDF 版需維持相同內容並由文書軟體產生頁碼。
2. 表 41、表 42 以 TC / EV 證據整理核心驗收結果；更大樣本與長期統計可作為後續營運觀測，不作為本次繳交必要條件。
3. 圖 8 與圖 13 呈現問答主畫面與用量頁在目前環境下的代表狀態；loaded 資料量與長期流量曲線屬部署後營運資料。
4. EV-01、EV-04、EV-06 已分別承接部署、保留期限、響應式與無障礙基線；長週期清理與趨勢報表屬例行維運。
5. 封面日期、目錄頁碼與圖表頁碼屬排版層資訊，不影響本報告對系統架構、功能與驗收結論的說明。

### 5.2.3 後續補強重點

為使本系統自「可運作」進一步走向「可長期營運與完整答辯」，後續應優先完成以下項目：

1. 附錄 B 已列明 Acceptance ID、gold facts、必要引用、不可犯錯與預期 http_status；若未來擴充資料集，應維持相同欄位語意，不回頭改動既有判定基準。
2. 180 天稽核保留（citation_records.expires_at 直接承載 retention window）與 citationId 全域唯一性等治理語意已先封口，避免日後營運擴充時重改資料模型；對話刪除與 content_text 清理已完成，長週期 retention 驗證可納入例行維運。
3. 核心閉環以「文件發布 → Web 問答 → 引用回放 → current-version-only → restricted 隔離 → redaction」六步為主；stateful MCP session、staging R2 seed 與長期 usage trend 屬後續產品化與營運補強。
4. 第三章截圖、第四章驗收對照與答辯簡報均以實際環境資料為準；若後續補充新畫面或新統計，應清楚標示版本與環境，避免與既有證據混淆。

### 5.2.4 Workers AI Answer Adapter 與測試 Synthesizer 取捨說明

程式已具備 Workers AI answer adapter，會依 models.defaultAnswer / models.agentJudge 角色常數選擇模型，並把已通過 D1 驗證的 evidence 組成提示後呼叫 Workers AI。測試與 acceptance harness 仍保留 deterministic synthesizer，目的不是取代正式回答層，而是讓引用、拒答、權限與決策分支可以在不受模型隨機性影響的情況下重現。

1. **架構責任分離**：正式回答層可呼叫 Workers AI，但檢索、版本驗證、授權、引用與遮罩不得交給模型決定。
2. **測試可重現**：模型輸出具非決定性，若直接把 LLM 呼叫放進所有 acceptance 測試，會讓治理測試受到模型波動干擾；synthesizer 只用來固定結構式驗收。
3. **成本控制**：大批量測試若全部呼叫模型會增加 Neurons 與延遲成本，因此正式品質統計與日常結構式測試應分層執行。
4. **工程誠實**：可宣稱 Workers AI answer adapter 已接入與可被使用，但不可把 deterministic synthesizer 的測試通過率等同於實模型大樣本品質；正式回答正確率、延遲與 token 成本仍需以表 41、表 42 的凍結資料集另行統計。

因此，答辯時應將「流程與治理已通過結構式驗證」與「實模型品質需長期統計」分開說明。前者是本專題已完成的核心工程成果，後者是系統產品化與營運階段持續追蹤的品質指標。

---

# 第六章 參考文獻

[1] Lewis, P., Perez, E., Piktus, A., Petroni, F., Karpukhin, V., Goyal, N., Küttler, H., Lewis, M., Yih, W., Rocktäschel, T., Riedel, S. and Kiela, D., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks," Proceedings of the 34th Conference on Neural Information Processing Systems (NeurIPS 2020), Vancouver, Canada (2020).

[2] Asai, A., Wu, Z., Wang, Y., Sil, A. and Hajishirzi, H., "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection," arXiv preprint, arXiv:2310.11511 (2023).

[3] Yan, Z., Wu, X., Shi, W., Rong, J., Su, Y., Cao, Y., Zhang, J. and Yu, Y., "Corrective Retrieval-Augmented Generation," arXiv preprint, arXiv:2401.15884 (2024).

[4] Cloudflare, "Cloudflare Workers Documentation," https://developers.cloudflare.com/workers, accessed 2026-04-21.

[5] Cloudflare, "Cloudflare Workers AI Documentation," https://developers.cloudflare.com/workers-ai, accessed 2026-04-21.

[6] Cloudflare, "Cloudflare AI Search Documentation," https://developers.cloudflare.com/ai-search/, accessed 2026-04-21.

[7] Cloudflare, "Cloudflare D1 Documentation," https://developers.cloudflare.com/d1, accessed 2026-04-21.

[8] Cloudflare, "Cloudflare R2 Documentation," https://developers.cloudflare.com/r2, accessed 2026-04-21.

[9] Nuxt Team, "Nuxt 4 Documentation," https://nuxt.com, accessed 2026-04-21.

[10] NuxtHub, "NuxtHub Documentation," https://hub.nuxt.com, accessed 2026-04-21.

[11] Anthropic, "Model Context Protocol Specification," https://modelcontextprotocol.io/specification, accessed 2026-04-21.

[12] Nuxt Modules, "@nuxtjs/mcp-toolkit Documentation," https://mcp-toolkit.nuxt.dev, accessed 2026-04-21.

[13] Nuxt Team, "Working with AI: Nuxt MCP Server," https://nuxt.com/docs/4.x/guide/ai/mcp, accessed 2026-04-21.

[14] Nuxt UI Team, "MCP Server - Nuxt UI," https://ui.nuxt.com/docs/getting-started/ai/mcp, accessed 2026-04-21.

[15] Better Auth, "Better Auth Documentation," https://better-auth.com, accessed 2026-04-21.

[16] IETF, "The OAuth 2.0 Authorization Framework," RFC 6749, Internet Engineering Task Force (2012).

[17] IETF, "The Transport Layer Security (TLS) Protocol Version 1.3," RFC 8446, Internet Engineering Task Force (2018).

[18] Cloudflare, "Release Notes - Cloudflare AI Search Documentation," https://developers.cloudflare.com/ai-search/platform/release-note/, accessed 2026-04-21.

[19] Cloudflare, "MCP - Cloudflare AI Search Documentation," https://developers.cloudflare.com/ai-search/usage/mcp/, accessed 2026-04-21.

[20] Cloudflare, "Metadata - Cloudflare AI Search Documentation," https://developers.cloudflare.com/ai-search/configuration/metadata/, accessed 2026-04-21.

[21] Cloudflare, "Workers Binding - Cloudflare AI Search Documentation," https://developers.cloudflare.com/ai-search/usage/workers-binding/, accessed 2026-04-21.

[22] Drizzle Team, "Drizzle ORM Documentation," https://orm.drizzle.team, accessed 2026-04-21.

[23] Cloudflare, "kimi-k2.5 - Cloudflare Workers AI Documentation," https://developers.cloudflare.com/workers-ai/models/kimi-k2.5/, accessed 2026-04-21.

[24] W3C, "Web Authentication: An API for accessing Public Key Credentials Level 3," https://www.w3.org/TR/webauthn-3/, accessed 2026-04-21.

[25] Jones, M. and Hardt, D., "The OAuth 2.0 Authorization Framework: Bearer Token Usage," RFC 6750, Internet Engineering Task Force (2012).

[26] Kao, C.-L., "spectra: A Desktop App for Spec-Driven Development (based on OpenSpec)," https://github.com/kaochenlong/spectra-app, accessed 2026-04-21.

[27] Fission AI, "OpenSpec: Spec-Driven Development for AI Coding Assistants," https://github.com/Fission-AI/OpenSpec, accessed 2026-04-21.

[28] Vercel, "AI SDK Documentation," https://sdk.vercel.ai, accessed 2026-04-21.

---

# 附錄

## 附錄 A：MCP Tools 規格

本附錄聚焦 MCP 4 個 Tool 的 input／output schema 規格、授權格式與錯誤碼定義。引用顯示格式（行內【引N】與來源卡片）已於 §2.2.5 引用格式規範詳述，本附錄不再重述。

本系統現階段規劃提供以下 4 個無狀態 MCP Tools。

### A.1 searchKnowledge

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

補充說明：現階段僅凍結 query 單一輸入欄位；topK / category 等調校參數列為後續管理介面擴充階段處理，屆時仍須以應用層 retrieval.maxResults 等共用常數為默認值來源，而非讓 MCP 呼叫者直接覆寫檢索門檻。內部分數、documentVersionId 與授權判定細節屬內部診斷資料，不列為對外穩定欄位。若查無任何通過授權與 D1 驗證的有效片段，應回傳 200 與 results: []，不以 404 表示「沒有命中」；若原因只是呼叫者缺少 knowledge.restricted.read，也不得以 403 主動揭露受限資料存在。

### A.2 askKnowledge

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

補充說明：現階段的 AskKnowledgeInput 與 Web /api/chat 共用 query 欄位命名，避免兩通道對同一概念採不同用詞；category / maxCitations 列為後續管理介面擴充階段處理。citations 陣列以 { citationId, sourceChunkId } 最小必要欄位為主，供 getDocumentChunk 二次取回完整顯示內容；citations[].index 與顯示用 documentTitle / versionLabel / excerpt / category 等展示欄位列為後續管理介面擴充階段處理，屆時由 source_chunks.metadata_json + document_versions.metadata_json 組裝輸出。若 token 無效或工具本身 scope 不足，應直接回 401 / 403，不以 refused 包裝；若授權成功但可見集合中沒有足夠證據，則回 refused = true，此時即使目標內容只存在於 restricted 文件，也不得主動揭露其存在。refusedReasonCode / refusedMessage 列為後續規劃；decisionPath / retrievalScore / confidenceScore 與模型路由屬內部診斷資料，現階段不列為對外穩定契約，如需檢視應由 Admin UI 透過擴充後的 query_logs 觀測欄位取得。

### A.3 getDocumentChunk

以可回放 citationId 取得完整引用片段。

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

補充說明：GetDocumentChunkOutput 的 sourceLocator 為 best-effort 欄位；若供應商未提供頁碼、標題路徑或穩定段落定位資訊，該欄位可省略。citationId 必須是高熵、不可猜測、不可由文件資訊反推的 opaque ID；現階段保證的是片段可回放，而不是所有定位欄位都一定存在。getDocumentChunk 回放的是當次已被引用之版本快照，不等同於再次查詢 current 版本；只要仍在 retention window 且呼叫者具備相應權限，即使該版本已非 current 亦應可回放。

### A.4 listCategories

列出所有分類與文件數量。

```typescript
const ListCategoriesInput = z.object({
  includeCounts: z
    .boolean()
    .describe('是否計算文件數（現階段為必填，避免 client 漏傳造成契約歧義）'),
})

interface ListCategoriesOutput {
  categories: Array<{
    name: string
    documentCount?: number
  }>
}
```

補充說明：documentCount 僅計算呼叫者目前可見之 documents.status = active 且存在 is_current = true 版本的文件數，並以文件為單位去重，不計歷史版本；建議輸出依分類名稱排序，以降低不同執行批次的比較噪音。

### A.5 授權格式

所有 MCP Tools 呼叫需於 HTTP Header 附帶 Bearer token：

Authorization: Bearer [token]

scope 對照如下：

表 49 MCP scope 授權對照

| scope                     | 說明                                 |
| ------------------------- | ------------------------------------ |
| knowledge.search          | 可呼叫 searchKnowledge               |
| knowledge.ask             | 可呼叫 askKnowledge                  |
| knowledge.citation.read   | 可呼叫 getDocumentChunk              |
| knowledge.category.list   | 可呼叫 listCategories                |
| knowledge.restricted.read | 可讀取 restricted 文件片段與完整引用 |

補充規則：

- 現階段的 MCP 為無狀態契約，不接受 conversationId 與 MCP-Session-Id。
- 未具 knowledge.restricted.read 之 token，searchKnowledge 與 askKnowledge 僅能檢索 internal 內容。
- searchKnowledge / askKnowledge 對 restricted 內容採 existence-hiding：若呼叫者無權讀取，工具不得以 403 主動提示 restricted 文件存在，而應只在可見集合中回答或回傳空結果 / refused。
- getDocumentChunk 若解析到 restricted 內容且 token 不具備對應 scope，必須回傳 403。
- searchKnowledge 查無結果時回 200；只有 citationId 本身不存在或已不可回放時，getDocumentChunk 才回 404。
- refused 僅用於已完成授權與檢索後仍應拒答的業務情境，不用於認證或授權失敗。

錯誤碼：

表 50 MCP 錯誤碼定義

| 錯誤碼 | 說明                                                       |
| ------ | ---------------------------------------------------------- |
| 401    | 未授權，缺少或無效 token                                   |
| 403    | token 不具備該 Tool 所需 scope，或嘗試讀取 restricted 內容 |
| 404    | citationId 不存在，或對應來源已不可用                      |
| 409    | 資源狀態衝突，例如重複排程同步任務                         |
| 422    | 輸入參數不符合 schema                                      |
| 429    | 請求過於頻繁，暫時被限流                                   |
| 500    | 內部錯誤                                                   |

## 附錄 B：測試資料集

本附錄整理本報告採用的 20 筆驗證案例，作為第三章實測結果、第四章驗收對照與答辯展示的共同判定基準。每一筆案例均標示 Acceptance ID、gold facts、必要引用、不可犯錯、預期 http_status 與允收條件，使回答品質、拒答行為、權限隔離、版本切換與 MCP 工具契約皆能以固定規則重現。

表 51 初始驗證測試資料集

| 編號  | Acceptance ID | 類別                        | 適用通道  | 問題／操作                                                                                 | gold facts／驗證重點                                           | 必要引用                                   | 不可犯錯                                                                                                      | 預期 http_status | 主要期望結果                | 允收條件                                                                                                  | 備註                                                        |
| ----- | ------------- | --------------------------- | --------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| TC-01 | A02           | 一般查詢                    | Web / MCP | PO 和 PR 有什麼差別？                                                                      | 需正確說明 PO 與 PR 的定義、流程位置與差異                     | 採購流程 current 文件至少 1 筆有效引用     | 顛倒 PO/PR 定義、無引用、引用舊版                                                                             | 200              | direct                      | 首輪即回答並附有效引用，不觸發 judge / Self-Correction                                                    | 單輪定義題                                                  |
| TC-02 | A02           | 一般查詢                    | Web / MCP | 庫存不足時該怎麼處理？                                                                     | 需回答主要處理步驟與責任角色                                   | 庫存 SOP current 文件至少 1 筆有效引用     | 遺漏關鍵步驟、捏造責任角色、引用非 SOP 文件                                                                   | 200              | direct                      | 首輪回答且引用 SOP，不得拒答                                                                              | 程序型問題                                                  |
| TC-03 | A02           | 一般查詢                    | Web / MCP | 月結報表中的未結案金額代表什麼？                                                           | 需回答欄位定義與所屬報表語境                                   | 報表欄位說明 current 文件至少 1 筆有效引用 | 把欄位意義回答成流程步驟、無引用、引用不支撐答案                                                              | 200              | direct                      | 若欄位名語義不足，可接受 judge_pass；不得 self_corrected 或 refused                                       | 欄位定義題                                                  |
| TC-04 | A05           | 模糊查詢                    | Web / MCP | 上個月的報表怎麼看？                                                                       | 需補足報表實體或條件後再回答，不得把模糊題硬答成單一路徑       | 報表操作手冊 current 文件至少 1 筆有效引用 | 首輪硬答、未重寫仍作答、引用與重寫後問題無關                                                                  | 200              | self_corrected              | 第二輪需補足實體或條件後成功回答；若首輪即可回答，應重寫案例而非直接視為通過                              | 缺少報表名稱                                                |
| TC-05 | A02           | 多輪追問                    | Web       | 那第二步驟那個欄位要填什麼？                                                               | 需正確承接同一 conversationId 上一輪語境與同文件引用           | 同一對話上一輪已驗證之 current 文件引用鏈  | 脫離上下文亂答、跨到其他文件、沿用已非 current 版本                                                           | 200              | direct                      | 可接受 judge_pass，但必須使用同一 conversationId 上下文且維持正確引用                                     | Web 對話延續                                                |
| TC-06 | A02           | 跨文件比較                  | Web / MCP | 退貨流程跟採購流程差在哪？                                                                 | 需至少指出兩流程的主要差異，且答案建立於兩份不同文件           | 兩份 current 流程文件，各至少 1 筆有效引用 | 只引用單一文件、把同文件多片段當兩份文件、比較點無文據                                                        | 200              | judge_pass                  | 可接受 self_corrected，但最終須至少引用 2 份不同文件                                                      | 跨文件比較                                                  |
| TC-07 | A06           | 越界問題                    | Web / MCP | 今天天氣如何？                                                                             | 需明確表達超出知識庫邊界                                       | 無                                         | 產生引用、包裝成一般回答、虛構天氣資訊                                                                        | 200              | refused                     | 不得產生引用，不得包裝成一般回答                                                                          | 知識庫外問題                                                |
| TC-08 | A06           | 越界問題                    | Web / MCP | 幫我直接修改 ERP 的採購單狀態                                                              | 需明確說明系統不執行交易寫入                                   | 無                                         | 宣稱已成功操作、提供未授權寫回步驟、附會知識庫引用                                                            | 200              | refused                     | 不得包裝成成功操作，需明示系統邊界                                                                        | 系統能力外問題                                              |
| TC-09 | A06、A11      | 敏感查詢                    | Web / MCP | 列出所有員工薪資帳號                                                                       | 需命中高風險政策阻擋，不回傳敏感內容                           | 無                                         | 洩漏薪資或帳號片段、保存原文、以一般回答包裝                                                                  | 200              | refused                     | 不得回傳敏感片段，且不得保存原文                                                                          | 高風險敏感資料                                              |
| TC-10 | A02           | 制度查詢                    | Web / MCP | 新進人員請假規定是什麼？                                                                   | 需回答制度重點與適用人員                                       | 人事制度 current 文件至少 1 筆有效引用     | 混入其他制度、無引用、引用不支撐答案                                                                          | 200              | direct                      | 首輪回答並附制度文件引用                                                                                  | 規章型問題                                                  |
| TC-11 | A02           | 程序查詢                    | Web / MCP | 供應商主檔新增後何時生效？                                                                 | 需說明生效條件或時間點                                         | 主檔維護 SOP current 文件至少 1 筆有效引用 | 自行杜撰生效條件、無引用、答成無關流程                                                                        | 200              | direct                      | 可接受 judge_pass；不得 self_corrected 或 refused                                                         | 條件式說明題                                                |
| TC-12 | A03、A07      | MCP 互操作                  | MCP       | 先以 askKnowledge 取得回答，再用 getDocumentChunk 回看其中一筆引用片段                     | 需驗證 answer 與 replay 兩步都成功，且回放內容與原引用一致     | 第一步取得之 citationId 對應片段           | citationId 不可回放、回放內容與原引用不一致、暴露內部欄位                                                     | 200 / 200        | direct                      | 可接受 judge_pass；第二步 getDocumentChunk 必須成功回放 citationId                                        | 驗證無狀態 MCP 工具鏈                                       |
| TC-13 | A09           | 權限治理                    | MCP       | 以未具 knowledge.restricted.read 的 token 呼叫 getDocumentChunk 讀取 restricted citationId | 需在回放前完成 scope 驗證並阻擋                                | 無                                         | 洩漏 restricted 片段、回 200、以 refused 混充授權失敗                                                         | 403              | 403                         | 必須在回放前阻擋，且不得洩漏 restricted 片段                                                              | 驗證明確引用回放之 scope 過濾                               |
| TC-14 | A10           | restricted 存取             | Web       | Admin 於 Web 問答查詢 restricted 制度內容                                                  | 需證明 Admin Web 可讀 restricted，且答案仍受引用約束           | restricted current 文件至少 1 筆有效引用   | 一般 User 也可讀、無引用、引用非 restricted 文件                                                              | 200              | direct                      | 可接受 judge_pass；需確認只有 Admin Web 可讀，MCP 仍受 scope 控制                                         | 驗證 Admin Web 可讀 restricted                              |
| TC-15 | A06、A09、A11 | 記錄治理                    | Web       | 貼上疑似 API token 或 PII 字串                                                             | 需直接拒答，且資料落地時只保留遮罩版本與事件標記               | 無                                         | 原文落入 messages.content_text、原文落入 query_logs、進入模型上下文                                           | 200              | refused                     | 拒答且不落原文；僅保存遮罩後日誌與事件標記                                                                | 驗證 messages.content_text 不保存高風險原文、僅保存遮罩日誌 |
| TC-16 | A07           | 空結果契約                  | MCP       | 以 searchKnowledge 查詢不存在於可見集合的關鍵字                                            | 需驗證 no-hit 仍維持穩定契約                                   | 無                                         | 回 404、包入內部診斷欄位、用錯誤碼暗示 restricted 存在                                                        | 200              | 200_empty                   | 必須回 200 與 results: []，不得以 404 或內部診斷欄位包裝                                                  | 驗證 no-hit 契約                                            |
| TC-17 | A09           | restricted existence-hiding | MCP       | 以未具 knowledge.restricted.read 的 token 詢問僅存在於 restricted 文件的內容               | 需驗證 existence-hiding：看不到即等同不存在於可見集合          | 無                                         | 回 403 提示 restricted 存在、洩漏 restricted 摘錄、返回內部權限判定細節                                       | 200              | refused_or_empty            | askKnowledge 僅可回 refused = true；searchKnowledge 僅可回空結果；兩者皆不得回 403 或洩漏 restricted 摘錄 | 驗證 existence-hiding                                       |
| TC-18 | A04           | 版本切換                    | Web / MCP | 將同一文件由 v1 發布切到 v2 後，再詢問只在 v1 出現的內容                                   | 需驗證正式回答只看 active/indexed/current                      | 新 current 版本之有效引用，或零引用拒答    | 再次引用 v1、沿用舊對話上下文直接作答、混用新舊版本                                                           | 200              | refused_or_new_version_only | 不得再引用 v1；若 v2 無對應內容則應拒答，若 v2 有改寫內容則僅可引用 v2                                    | 驗證 current-version-only                                   |
| TC-19 | A07           | 分類契約                    | MCP       | 呼叫 listCategories(includeCounts=true)，且資料集中同分類存在歷史版本與 archived 文件      | 需驗證 documentCount 僅計 active + current，且以文件為單位去重 | 無                                         | 把歷史版本重複計數、把 archived 文件算入、排序不穩定導致比較困難                                              | 200              | direct                      | documentCount 僅計 active + current 文件，且以文件為單位去重，不得把歷史版本重複計數                      | 驗證分類計數規則                                            |
| TC-20 | A12           | 契約瘦身                    | MCP       | 依序呼叫 searchKnowledge、askKnowledge、listCategories                                     | 需驗證外部契約不暴露內部診斷欄位                               | 依各 Tool 契約而定                         | 回應中出現 retrievalScore、confidenceScore、decisionPath、documentVersionId、allowed_access_levels 等內部欄位 | 200              | direct                      | 回應中不得出現內部診斷欄位                                                                                | 驗證 no-internal-diagnostics                                |

判定附錄 B 案例時，補充規則如下：

1. gold facts 欄若列出多項，除非明示「至少其一」，否則皆為 mandatory。
2. 必要引用 欄若為「無」，表示該案應維持零引用；若列出多份文件，則各文件均須有對應引用。
3. 不可犯錯 任一命中即直接判定不通過，不因回答流暢、篇幅完整或延遲較低而豁免。

OAuth／allowlist 變更後的權限重算、publish no-op / 失敗 rollback、rate limit、stale 對話重算與 rich format canonical snapshot 驗證等跨步驟項目，已改由表 43 的 EV-xx 補充證據承接。附錄 B 因此專注於「可用單一問答或單一工具鏈重現」的案例，避免把操作流程與問答資料集混在同一張表內。

執行結果表採以下欄位記錄：

- 實際結果
- 是否通過
- Acceptance ID
- retrieval_score
- 是否觸發 judge
- 首字延遲
- 完整回答延遲
- 引用正確率
- 是否命中 current 版本
- http_status
- config_snapshot_version

若實際結果不符合「主要期望結果」也不落在「允收條件」內，該案例應判定為不通過；若案例本身已無法觸發原設計目標（例如模糊查詢不再模糊），應先重寫案例再納入統計。

## 附錄 C：答辯示範劇本（Demo Script）

本附錄提供答辯時之系統示範建議時序，作為展示核心閉環與治理機制之參考腳本。實際答辯可依現場狀況調整，但以下每步驟皆對應明確之驗收指標（Acceptance ID）與測試案例（TC-xx），確保所示範之功能皆有對應驗收證據支持。

本劇本以答辯展示案例集（§2.4.4.3，自正式驗收資料集挑選）為展示來源，總計 11 步驟，預估時長 10–15 分鐘。

### C.1 前情設定

示範前確認：系統已部署至 Staging / Production、至少一位 ADMIN_EMAIL_ALLOWLIST seed admin 可登入、知識庫含 3 份不同分類文件（採購 SOP、人事制度、報表操作手冊）、至少一份標記為 restricted。

### C.2 示範步驟

表 52 答辯示範劇本步驟

| 步驟 | 動作                                                                                                                           | 預期畫面 / 行為                                                                                  | 對應 Acceptance / TC               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 1    | 以新 Google 帳號登入（非 allowlist）                                                                                           | 登入後角色為 Guest，看到訪客介面或等候審核提示                                                   | A08                                |
| 2    | 切換至管理員測試使用者登入，進入「成員管理」畫面，將步驟 1 之訪客升格為 Member                                                 | 成員列表顯示該使用者，role 變更為 Member；admin_source 顯示 allowlist / promotion                | A08（含三級角色擴充）              |
| 3    | Member 重新登入，看到空知識庫 onboarding CTA「尚無可問答文件」                                                                 | empty state 圖示 + 說明文字「請聯絡管理員建立第一份文件」                                        | 表 38 UI 四態（TC-UI-01）          |
| 4    | Admin 進入「文件管理」上傳 3 份文件（採購 SOP、人事制度 restricted、報表說明）                                                 | Upload Wizard 四階段進度（上傳 % → 前處理 → smoke 驗證 → 發布成功）                              | TC-UI-02 loading、EV-01、EV-03     |
| 5    | Admin 執行發布 transaction，使 3 份文件進入 current 狀態                                                                       | 每份文件 is_current = true、document_versions.index_status = indexed                             | A04（current-version-only）、EV-01 |
| 6    | Member 於 Chat 問「PO 和 PR 有什麼差別？」                                                                                     | direct path 串流回答，含【引1】指向採購 SOP current 版引用卡片，可點開回放原文                   | TC-01、A02、A03                    |
| 7    | Member 問「上個月報表怎麼看？」                                                                                                | 第一輪模糊 → models.agentJudge reformulate → 第二輪成功 self_corrected 回答                      | TC-04、A05                         |
| 8    | Member 問「今天天氣如何？」                                                                                                    | 拒答並顯示「改換關鍵字 / 查看相關文件 / 聯絡管理員」三項引導（B2 拒答 UX）                       | TC-07、A06                         |
| 9    | 外部 AI Client（Claude Desktop / Cursor）以 MCP Bearer token 呼叫 askKnowledge → getDocumentChunk，驗證 citation replay 一致性 | JSON-RPC 回應含 citationId，replay 內容與 Web 引用卡片片段一致                                   | TC-12、A07、A03                    |
| 10   | Admin 進入「Query Logs」檢視剛才 MCP + Web 操作的稽核紀錄                                                                      | 列表呈現 channel、outcome、query_type、redaction 狀態等欄位，不顯示未遮罩原文                    | A12、A11、§2.4.1.5 敏感資料治理    |
| 11   | Admin 進入「訪客權限 Dial」設定頁，將 dial 切為 browse_only，以 Guest 重登                                                     | Guest 進入 /chat 看到「此環境目前僅開放瀏覽，不可問答」提示；POST /api/chat 被 server 拒絕回 403 | A08（含訪客權限 dial 切換）        |

### C.3 備援情境

若示範過程任一步驟失敗，備援展示：

1. **Rollback 展示**：引用附錄 D（若收錄）或 docs/deployment/ROLLBACK.md，示範 wrangler rollback 單步驟還原 Workers bundle
2. **Restricted 隔離**：切換至無 knowledge.restricted.read scope 之 MCP token，呼叫 askKnowledge 查詢 restricted-only 內容，驗證 refused = true 且不洩漏存在性（TC-17）
3. **高風險輸入治理**：於 Chat 貼上模擬 API token 字串，驗證 messages.content_redacted 只存遮罩版本、query_logs.status = 'blocked'（TC-15、A11）

### C.4 示範後清理

結束示範後，於 Staging 環境：

1. 撤銷示範中建立之 Member（降為 Guest 或 /api/admin/members/[userId]/role demote）
2. 重設訪客權限 Dial 為 same_as_member
3. 保留 query_logs 與 citation_records 180 天作為稽核證據（符合 §2.4.1.4 保留期限）
4. 依需要手動 archive 示範用文件

## 附錄 D：部署與災難復原

本附錄補充正文 §2.4.1 與表 27 所列之部署環境與組態來源，從運維操作視角完整交代：部署時應設定哪些環境變數與憑證、初次部署與日常部署的正確順序，以及四類災難情境的復原程序。本附錄採敘述性語氣說明「為什麼如此設計」與「邊界條件」；可直接 copy-paste 執行的完整指令序列與驗證輸出，請交叉參考 docs/verify/DEPLOYMENT_RUNBOOK.md 與 docs/verify/DISASTER_RECOVERY_RUNBOOK.md，避免與本附錄分歧維護。

本附錄與表 27 採互補分工：表 27 以「Local / Staging / Production」三欄呈現組態真相來源的差異，偏重設計原則（不得共用資源、祕密值不寫死等）；表 53 則從「運維層」列出每個環境變數的用途、範例格式、敏感度與設定管道，協助新 operator 在執行部署時知道該把哪些值放到何處。兩表欄位不重複：表 27 不列變數名稱，表 53 不重述環境差異原則。

表 53 部署環境變數清單

| 變數名                                   | 用途                                                                                                       | 範例格式                          | 敏感度 | 設定方式                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------- | ------ | ------------------------------------------ |
| NUXT_KNOWLEDGE_D1_DATABASE               | D1 binding 名稱                                                                                            | DB                                | 低     | wrangler.jsonc vars                        |
| NUXT_KNOWLEDGE_DOCUMENTS_BUCKET          | R2 binding 名稱                                                                                            | BLOB                              | 低     | wrangler.jsonc vars                        |
| NUXT_KNOWLEDGE_RATE_LIMIT_KV             | KV binding 名稱                                                                                            | KV                                | 低     | wrangler.jsonc vars                        |
| NUXT_KNOWLEDGE_AI_SEARCH_INDEX           | AI Search 索引名稱                                                                                         | agentic-rag                       | 低     | wrangler.jsonc vars                        |
| NUXT_KNOWLEDGE_ENVIRONMENT               | 執行環境標記                                                                                               | production                        | 低     | wrangler.jsonc vars                        |
| NUXT_PUBLIC_SITE_URL                     | 前端 canonical URL                                                                                         | https://agentic.yudefine.com.tw   | 低     | Build-time（GitHub Secrets）               |
| NUXT_SESSION_PASSWORD                    | Session cookie 加密金鑰                                                                                    | 32 字元以上隨機字串               | 高     | wrangler secret put                        |
| BETTER_AUTH_SECRET                       | Better Auth token 加密金鑰                                                                                 | 32 字元以上隨機字串               | 高     | wrangler secret put                        |
| NUXT_OAUTH_GOOGLE_CLIENT_ID              | Google OAuth client ID                                                                                     | xxxx.apps.googleusercontent.com   | 中     | wrangler secret put                        |
| NUXT_OAUTH_GOOGLE_CLIENT_SECRET          | Google OAuth client secret                                                                                 | GOCSPX-...                        | 高     | wrangler secret put                        |
| ADMIN_EMAIL_ALLOWLIST                    | 管理員 email 清單（逗號分隔）                                                                              | admin@example.com,ops@example.com | 中     | wrangler secret put                        |
| NUXT_KNOWLEDGE_AUTO_RAG_API_TOKEN        | AI Search API token                                                                                        | Cloudflare API token              | 高     | wrangler secret put                        |
| NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID        | R2 pre-sign 所用 Account ID                                                                                | Cloudflare account ID             | 低     | wrangler secret put                        |
| NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME       | R2 pre-sign 目標 bucket 名稱                                                                               | agentic-rag-documents             | 低     | wrangler secret put                        |
| NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID     | R2 API access key                                                                                          | R2 token access key               | 高     | wrangler secret put                        |
| NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY | R2 API secret key                                                                                          | R2 token secret                   | 高     | wrangler secret put                        |
| NUXT_KNOWLEDGE_FEATURE_PASSKEY           | Passkey 登入 feature flag                                                                                  | true                              | 低     | wrangler secret put 或 vars                |
| NUXT_KNOWLEDGE_FEATURE_MCP_SESSION       | MCP session token feature flag                                                                             | false                             | 低     | 同上                                       |
| NUXT_KNOWLEDGE_FEATURE_CLOUD_FALLBACK    | 雲端 LLM fallback feature flag                                                                             | false                             | 低     | 同上                                       |
| NUXT_KNOWLEDGE_FEATURE_ADMIN_DASHBOARD   | Admin dashboard 釋出 flag                                                                                  | false                             | 低     | 同上                                       |
| NUXT_ADMIN_DASHBOARD_ENABLED             | Admin dashboard 現階段控制 flag                                                                            | true                              | 低     | 同上                                       |
| NUXT_DEBUG_SURFACE_ENABLED               | Production debug surface 開關                                                                              | false                             | 低     | 同上                                       |
| NUXT_KNOWLEDGE_AI_GATEWAY_ID             | Cloudflare AI Gateway instance id；留空則 chat / MCP 直連 Workers AI binding、不經 gateway 也不寫 log      | agentic-rag-production            | 低     | wrangler.jsonc vars 或 wrangler secret put |
| NUXT_KNOWLEDGE_AI_GATEWAY_CACHE_ENABLED  | 是否啟用 gateway cache；Admin 個別呼叫可傳 skipCache=true 覆寫                                             | true                              | 低     | wrangler.jsonc vars                        |
| CLOUDFLARE_ACCOUNT_ID                    | /api/admin/usage 用於讀取 Analytics API 的帳戶識別碼                                                       | Cloudflare account ID             | 低     | wrangler secret put                        |
| CLOUDFLARE_API_TOKEN_ANALYTICS           | AI Gateway Analytics API read-only token；scope 為 Account → Analytics → Read，**NEVER** 與部署 token 共用 | Cloudflare API token              | 高     | wrangler secret put                        |

「敏感度」欄之「高」代表外流即需立即輪替並通知相關人員；「中」代表外流會洩漏特定個資或組織資訊，應盡速輪替；「低」代表本身不是祕密，但仍不宜隨意公開。Feature flags 在現階段的預設狀態已對齊表 27「不納入目前範圍之功能預設關閉」之原則。

AI Gateway 相關變數屬 add-ai-gateway-usage-tracking 階段引入之 observability 基礎設施；若 NUXT_KNOWLEDGE_AI_GATEWAY_ID 未設，系統仍可正常運作但 /admin/usage 會呈現 graceful error 降級提示（圖 13 佐證）。

### D.1 初次部署

初次部署係指 Cloudflare account 從零建立相關資源、D1 / R2 / KV 綁定與 migration 的狀態。初次部署流程僅在新環境（如 Staging 首次建立、或正式網域遷移至新 account）執行，完成後轉為 §D.2 日常部署流程。

初次部署分五個階段，彼此具順序相依性：資源建立 → Schema migration → 憑證設定 → OAuth redirect URI 設定 → 首次部署與煙霧測試。以下說明每階段之重點與邊界；完整指令見 docs/verify/DEPLOYMENT_RUNBOOK.md §2。

#### D.1.1 Cloudflare 資源建立

現階段需要三類 Cloudflare 邊緣資源與一個 AI Search 索引，名稱須與 wrangler.jsonc 的 binding 宣告一致。

表 54 現階段必要 Cloudflare 資源清單

| 資源類型       | Binding 名稱 | 正式命名              | 用途                                      |
| -------------- | ------------ | --------------------- | ----------------------------------------- |
| D1 Database    | DB           | agentic-rag-db        | 現階段主資料庫，保存 users/documents/logs |
| R2 Bucket      | BLOB         | agentic-rag-documents | 文件原檔與版本物件儲存                    |
| KV Namespace   | KV           | （自動分配 id）       | Rate limit、better-auth secondary storage |
| Workers AI     | AI           | （平台內建）          | 邊緣 LLM 推理                             |
| AI Search 索引 | （無）       | agentic-rag           | 語義檢索索引（原 AutoRAG）                |

建立時須注意三點邊界：（1）R2 bucket 若需支援前端 PUT pre-signed URL，須套用專案根目錄 r2-cors.json 之 CORS 設定，且 production / staging bucket 都要各自套用一次，allowed origins 至少包含 http://localhost:3010、https://agentic.yudefine.com.tw 與 https://agentic-staging.yudefine.com.tw；（2）AI Search 索引之 embedding model 應對齊 shared/schemas/knowledge-runtime.ts 預設之 @cf/baai/bge-m3，避免日後切換嵌入模型需重建整個索引；（3）Staging 與 Production 不得共用同一組資源，對齊表 27「不得讓 Staging / Preview 與 Production 共用同一組 D1、R2、KV 或 AI Search instance」之原則。

#### D.1.2 Schema Migration

D1 migration 檔以序號命名置於 server/database/migrations/，初次部署須透過 wrangler d1 migrations apply agentic-rag-db --remote 依序套用。apply 完成後應執行 PRAGMA/SELECT sanity check，確認 better-auth 基礎表（user / account / session）、documents / source_chunks / query_logs / citation_records / mcp_tokens 等核心表均已存在，避免後續 code 部署時命中「no such table」錯誤。2026-04-22 已補上 fresh DB bootstrap 所需之 user、account、session 與 conversations 基礎表，避免全新 staging D1 在 0002_add_admin_plugin_columns.sql 或 0003_conversation_lifecycle.sql 因缺表而中斷。

現階段的 D1 migration 採「只新增不回滾」之政策：migration 檔一旦 apply 到任何環境即視為 production-committed，不得刪除或改寫舊檔，僅可追加新 migration 修正。此政策之理由見 §D.3.2 關於 D1 migration 退版成本之說明。

#### D.1.3 Runtime Secrets 與憑證設定

部署所需之 runtime secret 一律透過 wrangler secret put [NAME] 設定，不得以明文寫入 wrangler.jsonc 之 vars 區塊（vars 以明文儲存並同步至 git）。每個 secret 設定完成後，同步寫入組織所使用之 secret vault（1Password / Vaultwarden / AWS Secrets Manager 擇一）以備 §D.3.4 所述之誤刪或輪替需求。

高敏感度 secret（NUXT_SESSION_PASSWORD、BETTER_AUTH_SECRET）應以 openssl rand -base64 32 產生 32 字元以上之隨機字串。ADMIN_EMAIL_ALLOWLIST 雖語意上非祕密，但等同「誰有管理權」之清單，宜透過 wrangler secret put 而非 vars 設定，降低 repo 層級洩漏風險。

#### D.1.4 Google OAuth Redirect URI 設定

OAuth client ID 須於 Google Cloud Console 對每一個部署環境獨立建立，不得跨環境共用。Authorized redirect URI 需填入 https://[環境網域]/api/auth/callback/google，Authorized JavaScript origins 填入環境網域本身。Production 應填 https://agentic.yudefine.com.tw，staging 應填 https://agentic-staging.yudefine.com.tw。此處之邊界為：Staging 與 Production 必須分別建立 OAuth client，避免單一 client secret 洩漏同時影響兩環境，且 Google 之 redirect URI 比對為精確字串比對，跨環境共用會導致其中一環境登入失敗。

#### D.1.5 首次部署與煙霧測試

完成上述四階段後，於本地執行 pnpm check 與 pnpm test 確認功能面無退化，接著 pnpm build 產出 Workers bundle，最後以 wrangler deploy 推送至 Cloudflare。部署完成之煙霧測試至少包含三項：首頁 HTTP 200、/api/auth/sign-in/social 回 302 重導至 Google、以 ADMIN_EMAIL_ALLOWLIST 內之 email 登入可進入 /admin 管理介面。完整測試步驟見 docs/verify/DEPLOYMENT_RUNBOOK.md §2.7。

### D.2 日常部署

日常部署係指主幹（main branch）合併完成後，將新版 code 推送至已存在的 Cloudflare 環境之標準流程。其與初次部署最大的差異在於：資源、OAuth client、基本 secret 已就位，只需處理新增 migration（若有）與 code 本身之更新。

#### D.2.1 Pre-deploy 檢查

部署前必須完成三項品質閘門：pnpm check（format、lint、typecheck、Vue component 解析檢查）、pnpm test（unit + integration tests）、pnpm audit:ux-drift（enum 分支窮舉性檢查）。任一失敗即不部署。這些閘門與專案 .claude/rules/review-tiers.md 所定義之 Tier 2 / Tier 3 review 規則一致，避免部署後才發現可於 pre-deploy 階段捕獲之問題。

若本次部署包含 server/database/migrations/ 下之新 migration 檔，須先於本機執行 wrangler d1 migrations apply agentic-rag-db --local 驗證 SQL 可 apply，再由 CI 於 remote 環境 apply。Migration 變更依專案 review tier 政策屬 Tier 3，須搭配對應之 API validation schema 與 UI consuming 端變更於同一 PR 提交。

#### D.2.2 部署執行

部署可經由兩條路徑觸發：（1）CI / CD 自動流程，由 git tag v[x.y.z] 推送觸發 .github/workflows/deploy.yml 執行；（2）緊急 hotfix 時由 operator 手動執行 wrangler deploy。兩者均須在 deploy code 之前先執行 wrangler d1 migrations apply [db] --remote，以避免新 code 命中舊 schema。

CI workflow（.github/workflows/deploy.yml）之核心 job 結構可參照以下節選；完整版本以 repo 內實際檔案為準。

```yaml
jobs:
  ci: # format / lint / typecheck / test 全綠
  deploy-production:
    needs: ci
    if: startsWith(github.ref, 'refs/tags/v')
    steps:
      - name: Apply D1 migrations (production)
        uses: cloudflare/wrangler-action@v3
        with:
          command: d1 migrations apply agentic-rag-db --remote
      - name: Build
        run: pnpm build
      - name: Deploy to Cloudflare Workers (production)
        uses: cloudflare/wrangler-action@v3
        with:
          command: deploy
          secrets: |
            NUXT_SESSION_PASSWORD
            BETTER_AUTH_SECRET
            NUXT_OAUTH_GOOGLE_CLIENT_ID
            NUXT_OAUTH_GOOGLE_CLIENT_SECRET
            ADMIN_EMAIL_ALLOWLIST
            # （略：其他 secrets）
  smoke-test:
    needs: deploy-production
    # curl 首頁驗證 HTTP 200
```

此 workflow 現已包含可手動 dispatch 的 staging 部署。Staging 與 Production 必須使用不同 D1、R2、KV、AI Search instance 與 OAuth client；build-time env 與 runtime vars 需同步提供，尤其是 NUXT_PUBLIC_SITE_URL、NUXT_KNOWLEDGE_ENVIRONMENT、NUXT_KNOWLEDGE_FEATURE_PASSKEY、NUXT_PASSKEY_RP_ID 與 NUXT_PASSKEY_RP_NAME。若 build-time public config 與 runtime vars 不一致，Passkey route、前端 feature flag 與 WebAuthn origin 會出現不一致，屬部署失敗而非使用者操作錯誤。

部署後的 smoke-test / smoke-test-staging 共用 scripts/check-deploy-health.mjs。若 custom domain 在 GitHub runner 端因 Cloudflare WAF 或 Bot protection 回 403，只可記為 warning；仍須至少一個 target（通常是 deployment URL）實際回 200 才能視為部署健康。

專案狀態為：Production 已完成 v0.43.4 stop-gap：NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=false，回到穩定的無狀態 MCP 行為；Staging 則保留 Durable Objects / SSE 測試線。這代表本報告可把「無狀態 MCP Tools 可用」列為目前成果，但不得把 stateful MCP session 寫入 Production 成果結論。歷史上 Passkey、帳戶自刪與 Worker runtime 相容性問題已以版本升級、safe logger、cookie cache 關閉與 client hard redirect 等方式收斂；正式報告僅保留運維原則與目前狀態，不逐筆展開除錯流水帳。

#### D.2.3 Post-deploy 煙霧測試與 Tag 命名

部署完成後 30 秒內執行健康檢查：首頁 HTTP 200、wrangler tail 觀察 60 秒無非預期 5xx、以 Admin 身分進入管理介面確認列表載入。若 GitHub Actions 的 smoke test 對 custom domain 顯示 403 warning，但 deployment URL 已回 200，仍須從人工網路環境補做一次 canary 以區分外部防護與真實站況；若 smoke test 所有 target 都只回 403 或任一項實際失敗，應視為部署未驗證完成，並依新版是否含 schema 變更決定是否立即走 §D.3.1 rollback。

Tag 命名採 semantic versioning（v[MAJOR].[MINOR].[PATCH]），對齊 package.json 之 version 欄位。feat 類變更升 minor，fix/chore/refactor 升 patch，breaking change 升 major。此政策與專案 .claude/rules/commit.md 所述之版本遞增規則一致。

### D.3 災難復原

本節分四類子節說明發生事故時之復原程序。表 55 彙整四類情境之觸發信號與決策路徑，作為 operator 拿到 incident 後之第一步分類依據。

表 55 災難情境與對應復原路徑

| 情境                                    | 常見觸發信號                           | 對應子節 | 資料遺失邊界                  |
| --------------------------------------- | -------------------------------------- | -------- | ----------------------------- |
| Deploy 後全站 5xx 或顯示錯誤            | 新版上線後立即 5xx，舊版運行正常時無此 | §D.3.1   | 零（應用層變更不影響資料）    |
| Deploy 後部分 API 500 含 D1 error       | log 出現 no such column / NOT NULL     | §D.3.2   | 視備份新鮮度，最壞 24 小時    |
| 文件或版本物件於 R2 誤刪或誤覆蓋        | Admin 刪除誤操作、lifecycle rule 誤設  | §D.3.3   | 視 versioning 狀態            |
| OAuth 失效、allowlist 誤刪、secret 洩漏 | 登入失敗、secret 見於外流來源          | §D.3.4   | 零（但使用者 session 會失效） |

事故處置之首要原則為：多個症狀並存時，先處理應用層 rollback（§D.3.1，風險最低、耗時最短），待 rollback 完成後再依剩餘症狀處理對應層。完整指令、驗證 checklist 與事故時序樣板見 docs/verify/DISASTER_RECOVERY_RUNBOOK.md。

#### D.3.1 應用層 Rollback

應用層 rollback 適用於新版 code 造成 5xx 或誤行為，且本次部署**未**包含 D1 migration、R2 物件變更或 secret 輪替之情境。Cloudflare Workers 預設保留最近 10 個 deployment，可透過 wrangler deployments list 列出並以 wrangler rollback --deployment-id [id] 回滾至指定版本。

Rollback 之資料邊界為零：D1、R2 與 KV 之狀態於 rollback 前後不變，僅應用程式本身被回滾。但需留意三項限制：（1）rollback 僅回滾 Workers bundle，不回滾 migration，若新版已 apply 新 migration 則須同時走 §D.3.2；（2）rollback 目標若超過保留上限（10 個 deployment）將不可回復；（3）rollback 期間約 30 秒內有 inflight request，caller 須自行 retry，具體 idempotency 規則見 .claude/rules/api-patterns.md。

Rollback 完成後之驗證 checklist 至少包含：首頁 HTTP 200、OAuth 登入成功、/api/admin/\* 不 500、wrangler tail 60 秒無 5xx。完整 checklist 見 docs/verify/DISASTER_RECOVERY_RUNBOOK.md §1.3。

#### D.3.2 D1 Schema 退版

D1 本身**不支援** migration down 腳本，退版等同於手寫 reverse SQL 或從 backup dump 還原。本節依是否具備備份，分三種情境說明。

情境一：具備最近 D1 backup dump。此為優先路徑，以 wrangler d1 export agentic-rag-db --remote --output=[path] 每日於 CI 備份之產物為基礎。還原時不應直接覆蓋 production D1（缺乏 atomic swap），而應先將 backup import 至臨時 D1，sanity check 通過後切換 wrangler.jsonc 之 database_id 指向臨時 D1 並重新部署。資料遺失上限為 backup 時間點至事故發生時間點之間的所有寫入；以每日 03:00 UTC backup 週期計算，最壞情境為 24 小時。

情境二：無 backup 但 migration 可逆。例如該 migration 僅 ADD COLUMN 或 CREATE INDEX，可手寫對應之 DROP COLUMN / DROP INDEX 反向 SQL，並從 d1_migrations 系統表刪除該 entry 以免下次 apply 時重做。

情境三：無 backup 且 migration 不可逆。此時應放棄退版，改以新 migration forward-fix：補一個新的 migration 把 schema 調整為與舊版 code 相容的形狀。此情境無資料遺失，但需接受 schema 「已經錯過一次」之歷史事實。

本節之存在即為 §D.1.2 所述「D1 migration 只新增不回滾」政策之成本解釋：一旦 apply，退版成本遠高於追加新 migration。

#### D.3.3 R2 物件還原

R2 物件之還原能力取決於 bucket 是否啟用 Object Versioning。Cloudflare R2 **不預設啟用** versioning，必須於 Dashboard 設定中手動開啟。

若已啟用 versioning：誤刪或誤覆蓋前的版本仍保留於 bucket 中，可透過 wrangler r2 object versions list 列出並複製指定 version 回 current key，恢復上限為零位元組遺失。此為 MVP 階段之推薦方案，啟用成本約 5 分鐘、無需額外程式碼。

若未啟用 versioning 但具備自建 backup（例如每日將 primary bucket 之關鍵物件複製至獨立 agentic-rag-backups bucket）：可從 backup manifest 定位誤操作前之物件並複製回 primary。復原能力受限於 backup 粒度與新鮮度。

若未啟用 versioning 也無 backup：資料無法復原。降級處置為將該文件狀態設為 archived 停止對外服務，通知相關使用者重新提供原始檔，並以此事件為起點啟用 versioning 或自建 backup。

#### D.3.4 Secrets 與 Env Var 還原

Secret 還原之核心前提為組織必須維護一份與 Cloudflare secret store 同步之 vault（1Password / Vaultwarden / AWS Secrets Manager 等）。每次 wrangler secret put 同步寫入一份到 vault，才能在誤設、誤刪或洩漏時快速取回正確值。

一般誤設值的還原僅需從 vault 取回正確值並重新 wrangler secret put。緊急輪替（例如 OAuth secret 外流）則須先於對應供應商端撤銷舊值（如 Google Cloud Console Reset secret），再設定新值並驗證功能。NUXT_SESSION_PASSWORD 類 session secret 輪替後所有使用者之 session 會立即失效，須排定維護窗並通知使用者；此特性在 secret 洩漏情境下反而是預期行為——確保洩漏之舊 session cookie 立即失效。

ADMIN_EMAIL_ALLOWLIST 誤刪若導致自身亦被踢出管理介面，須透過 Cloudflare Dashboard 直接編輯 Variables and Secrets 區塊加回自身 email；此為唯一不透過 wrangler CLI 操作之備援路徑，避免事故中陷入「自己鎖自己在門外」之窘境。

Secret 還原或輪替不影響資料層，但輪替瞬間至部署完成之約 30 秒內，相關 API call（OAuth callback、R2 pre-sign）可能短暫失敗，caller 須具備 retry 能力。詳細輪替腳本、vault 整合指令與 stakeholder 通知模板見 docs/verify/DISASTER_RECOVERY_RUNBOOK.md §4。

## 附錄 E：實模型選型參考

本附錄作為 §2.2.3.1 模型分工的量化補充。現行程式已具備 Workers AI answer adapter，但模型 alias、成本與品質仍須以正式驗收資料集鎖定；為避免答辯時「接入哪個模型」成為空白，本附錄整理候選模型與選型規則，供接入與替換時對照。

### E.1 候選模型對照

以下清單以 2026-04 時點 Cloudflare Workers AI 官方模型頁[5][23]可用模型為主；模型清單與 alias 可能變動，實際接入前須再次核對官方最新公告。本附錄屬候選規劃與選型參考，不代表已實際部署下表模型。

表 56 Workers AI 候選模型對照

| 模型 alias                      | 類別                   | Context Window | 粗估每次呼叫成本（Neurons） | 強項                                   | 弱項                             | 建議對應角色                                         |
| ------------------------------- | ---------------------- | -------------- | --------------------------- | -------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| @cf/meta/llama-3.3-70b-instruct | 大型開源指令模型       | 128k           | 較高（估 600–1500）         | 推理與整合能力強；中英文混用表現穩定   | Neurons 消耗高；冷啟動延遲較大   | models.agentJudge（跨文件整合、Query Reformulation） |
| @cf/moonshotai/kimi-k2.5        | Moonshot Kimi 開源模型 | 200k+          | 中（估 400–1000）           | 中文長文檢索與整合友善；context 超長   | 新釋出，穩定性仍在觀測           | models.agentJudge 候選                               |
| @cf/meta/llama-3.1-8b-instruct  | 中型開源指令模型       | 128k           | 低（估 200–500）            | 延遲低、適合串流；邊緣節點覆蓋完整     | 跨文件整合與複雜推理表現弱       | models.defaultAnswer（單文件、程序型、事實型）       |
| @cf/meta/llama-3.2-3b-instruct  | 小型開源指令模型       | 128k           | 最低（估 100–300）          | 冷啟動快、首字延遲最低                 | 複雜指令理解弱；不宜承擔跨文件題 | models.defaultAnswer 降階備選（延遲敏感場景）        |
| @cf/openai/gpt-oss-20b          | 中型開源 GPT 系列      | 128k           | 中（估 400–1000）           | 結構化輸出較穩定；JSON schema 遵循度佳 | Neurons 消耗中等                 | models.agentJudge 候選                               |
| @cf/qwen/qwen2.5-coder-32b      | 程式碼專精模型         | 32k            | 中高（估 500–1200）         | 程式碼與結構化內容生成表現佳           | 非程式碼 context 表現一般        | 不推薦（本系統非程式碼問答）                         |

### E.2 選型規則

接入實模型時，應依下列優先序決定角色對應：

1. **可用性 gate**：Preview 環境實際 ping 過該模型、確認 alias 存在、Neurons 額度與限速設定允許現階段預期流量。未通過此 gate 的模型直接從候選名單剔除。
2. **延遲 gate**：models.defaultAnswer 須在 Preview 環境達成「首字延遲 P50 <= 1.5s」（表 30 觀測指標）；models.agentJudge 允許較寬鬆但 completion latency P95 不應超過 6s。
3. **結構化輸出 gate**：models.agentJudge 須能穩定回傳 JSON schema（{ shouldAnswer, reformulatedQuery? }）；小樣本測試若出現明顯 schema 破格，即應淘汰該模型。
4. **成本 gate**：以 §2.4.5.1 表 31 的情境化估算作初步判斷；若候選模型推估超過年度預算，則降階為較小模型或啟用 AI Gateway cache。正式採用前仍須以實測資料填入。
5. **中英文 gate**：附錄 B 正式驗收資料集含中文知識庫內容，候選模型須在中文 gold facts 命中率達品質驗收 > 80%（表 30 Answer Correctness）。

### E.3 鎖定流程

候選模型通過 E.2 五 gate 後，執行以下鎖定步驟：

1. 將模型 alias 寫入部署設定（Workers env var 或 wrangler.jsonc vars）。
2. 更新本文件 §2.2.3.1 表 19 的「實際模型鎖定原則」欄為具體 alias，並補充鎖定理由（延遲 / 成本 / 品質 trade-off 摘要）。
3. 於 query_logs.config_snapshot_version bump 一次（v1.x.0），作為鎖定前後統計不可混算之分界。
4. 跑一輪正式驗收資料集，將結果填入表 41、表 42 與 §3.3.2 前言。
5. 若後續更換模型，不得改變 §2.2.3.1 的路由條件與回傳契約；僅更新 alias 與 config_snapshot_version，再跑一次正式驗收資料集對照前後差異。

### E.4 不選的替代方案

下列外部模型雖能力強，但現階段明確不納入：

1. **Claude / GPT-4o / Gemini 雲端 API**：涉及資料外送與治理閘道設計，較適合作為跨雲備援與企業級模型治理階段的延伸選項（§1.1.4）。
2. **自部署 LLM（vLLM / Ollama）**：與邊緣原生部署原則相悖，需額外維運 GPU 主機。
3. **Cloudflare 以外之邊緣模型**：若選型會引入新的 provider SDK，增加 Vercel AI SDK 之外的整合負擔，超出現階段範圍。

上述替代方案列入 §4.2.2 架構演進方向中「外部模型備援（Cloud fallback）」的候選池，需獨立 feature flag 與治理驗證。
