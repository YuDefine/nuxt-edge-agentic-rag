# TODO

## 範圍說明

本清單只處理「環境清理」與「地基校正」。

不在此階段進行：

- Web 問答功能開發
- MCP Tools 實作
- D1 schema / migration 設計
- R2 / KV / AI Search / Workers AI 串接
- Agentic RAG 流程實作
- 管理後台與 UI 功能開發

上述開始開發的部分，後續交由 Spectra 流程接手。

## 目標

- 移除目前 repo 內與目標架構不一致的 starter 痕跡
- 讓專案設定不再誤導成特定資料供應商專案
- 保留 Nuxt 4 + Cloudflare Workers 可延續的乾淨骨架
- 讓 Spectra 後續接手時，面對的是一致且可收斂的起點

## P0 必做

- [x] 清掉目前工作樹中的產物與暫存痕跡
- [x] 處理未追蹤的型別與工具暫存目錄
- [x] 補齊 `.gitignore`，避免 CLI / local tooling 產物再次進入工作樹
- [ ] 盤點並移除與目標架構不符的 starter 殘留
- [ ] 明確保留哪些是「可沿用骨架」，哪些是「必須移除或改名」

## P1 設定清理

- [ ] 重寫 `.env.example`
- [ ] 移除舊資料層專用變數
- [ ] 移除 GitHub OAuth 變數，先只保留 Google OAuth 與必要 session / observability 設定
- [ ] 補上未來 Cloudflare/D1/R2/KV/AI 會需要的占位變數名稱，但只做命名與註解，不做功能串接

- [ ] 清理 `package.json`
- [ ] 移除舊資料層導向的 scripts
- [ ] 移除不再符合目標架構的依賴
- [ ] 保留 lint / format / typecheck / test 這類通用開發腳本

- [ ] 清理 `nuxt.config.ts`
- [ ] 移除舊資料層整合相關設定
- [ ] 保留 Nuxt UI、security、Sentry、Cloudflare preset 等可沿用設定
- [ ] 檢查 runtimeConfig 命名，避免殘留舊資料層前綴

- [ ] 清理 `wrangler.jsonc`
- [ ] 至少整理成可作為 Cloudflare 專案骨架的狀態
- [ ] 先不補完整 binding 細節，但保留後續接線空間

- [ ] 重寫 `scripts/setup.sh`
- [ ] 移除舊資料層 CLI、Docker/OrbStack 為中心的初始化流程
- [ ] 改成較中性的專案啟動前檢查
- [ ] 若暫時不需要自動 setup，可先縮成最小版本

## P1 Auth 與頁面去誤導化

- [ ] 清理 email/password 導向的 auth 設定
- [ ] 清理註冊 / 忘記密碼等與報告範圍不一致的頁面
- [ ] 保留最小登入入口骨架，但不在此階段完成正式 Google OAuth 實作
- [ ] 清理 `useUserRole()` 這類目前直接信任 session role 的暫時邏輯
- [ ] 改成註記明確的 placeholder / TODO，避免後續誤用為正式權限模型

- [ ] 清理首頁與 layout 文案
- [ ] 移除 starter 式的 welcome 畫面
- [ ] 改成中性的 project shell，避免讓 repo 看起來像已完成可用產品

## P2 文件與交接清理

- [ ] 補一份簡短的 repo 現況說明
- [ ] 說明這一輪只完成環境清理，不代表開始功能開發
- [ ] 列出後續應由 Spectra 接手的第一批工作主題

- [ ] 補一份 cleanup 驗收標準
- [ ] repo 不再預設自己是特定資料供應商專案
- [ ] repo 不再包含明顯錯誤的 auth / env / script 預設
- [ ] git status 應保持乾淨，只留下有意識的 cleanup 變更

## 不在本輪處理

- [ ] 不實作 `askKnowledge`
- [ ] 不實作 `getDocumentChunk`
- [ ] 不建立 D1 正式 schema
- [ ] 不接 Cloudflare AI Search
- [ ] 不接 Workers AI / Vercel AI SDK
- [ ] 不做 citation replay
- [ ] 不做 current-version-only 核心流程
- [ ] 不做 admin 後台功能

## 交給 Spectra 的起手主題

- [ ] 建立 `v1.0.0` 核心閉環的 Spectra proposal
- [ ] 凍結 invariant：`active/indexed/current`、`source_chunks`、`citationId`、existence-hiding、redaction logging
- [ ] 規劃資料模型與 server 邊界
- [ ] 規劃 Web 主線優先、MCP 共用核心的實作順序
