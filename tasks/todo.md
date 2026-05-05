# Production / Staging Demo Seed Audit

## Plan

- [x] 盤點每個展示功能需要的 mock 資料面
- [x] 定義 production / staging 共用、可重跑且不污染既有資料的 demo seed 契約
- [x] 先補測試，鎖住 seed idempotency 與核心資料量
- [x] 實作 seed / R2 / AI Search / D1 同步腳本
- [x] 套用 staging 與 production
- [x] 驗證 HTTP、D1、R2、AI Search 與 app retrieval 行為
- [x] 更新 HANDOFF / ROADMAP / tech debt 的結果

## Review

- 2026-05-04：staging / production 皆已套用 demo seed。
- D1 驗證：兩環境各 `documents=12`、`document_versions=14`、`source_chunks=94`、`citation_records=12`、`query_logs=16`、`messages=18`、`users=5`、`mcp_tokens=4`。
- R2 驗證：兩環境末端 normalized chunk 可下載。
- AI Search 驗證：`pnpm demo-seed <env> --verify-only` 對 internal / restricted probes 各回 5 筆 active/current 且 citation metadata 完整的 chunks。
- HTTP 驗證：production / staging 首頁皆 HTTP 200。
