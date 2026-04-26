# 驗證指南

本區提供部署、驗收、回復與品質檢查所需的正式操作文件。內容以主題分類，協助開發與維運人員先定位工作類型，再進入對應手冊。

## 適用情境

- 正式部署前後的檢查、回滾與事故處置。
- 功能驗收、Smoke 測試、A11y 與響應式驗證。
- 開發過程中的架構對照、測試流程與常見問題排查。
- OAuth 與資料保留策略相關的設定與驗證。

## 依任務選擇入口

### 部署與復原

- 適用於上線、回滾、事故處置與正式部署檢查。
- 建議先讀 [DEPLOYMENT_RUNBOOK](./DEPLOYMENT_RUNBOOK.md) 與 [DISASTER_RECOVERY_RUNBOOK](./DISASTER_RECOVERY_RUNBOOK.md)。

### 功能驗證與 QA

- 適用於驗收、Smoke 測試、debug surface、對話生命週期、響應式與無障礙驗證。
- 建議先讀 [ACCEPTANCE_RUNBOOK](./ACCEPTANCE_RUNBOOK.md)、[KNOWLEDGE_SMOKE](./KNOWLEDGE_SMOKE.md)、[WEB_CHAT_PERSISTENCE_VERIFICATION](./WEB_CHAT_PERSISTENCE_VERIFICATION.md) 與 [RESPONSIVE_A11Y_VERIFICATION](./RESPONSIVE_A11Y_VERIFICATION.md)。

### Workers AI

- 適用於 Workers AI grounded answering 的成本／延遲基線、accepted-path 驗收與報告口徑。
- 建議先讀 [WORKERS_AI_ACCEPTED_PATH_VERIFICATION](./WORKERS_AI_ACCEPTED_PATH_VERIFICATION.md) 與 [WORKERS_AI_BASELINE_REPORTING](./WORKERS_AI_BASELINE_REPORTING.md)。

### 開發與架構

- 適用於 composable、Pinia、快取策略、測試流程與常見 production 問題對照。
- 建議先讀 [COMPOSABLE_DEVELOPMENT](./COMPOSABLE_DEVELOPMENT.md)、[PINIA_ARCHITECTURE](./PINIA_ARCHITECTURE.md) 與 [TEST_DRIVEN_DEVELOPMENT](./TEST_DRIVEN_DEVELOPMENT.md)。

### 權限與保留策略

- 適用於 OAuth、retention cleanup 與 replay contract 相關工作。
- 建議先讀 [OAUTH_SETUP](./OAUTH_SETUP.md)、[RETENTION_CLEANUP_RUNBOOK](./RETENTION_CLEANUP_RUNBOOK.md) 與 [RETENTION_REPLAY_CONTRACT](./RETENTION_REPLAY_CONTRACT.md)。

## 使用方式

- 從 repo 檔案樹進入時，可先看 [README](./README.md) 取得本區導覽。
- 從文件站進入時，可使用左側 sidebar 依主題展開。
- 若需要專案層導覽，先回到 [開發者文件總覽](../README.md)。

## 維護原則

- 保留既有檔名與路徑，避免打斷 repo 內明確引用。
- 新增驗證手冊時，優先放入對應主題群組，再更新 sidebar。
- 若內容已超出驗證範圍，應評估移至 runbooks、decisions 或其他治理文件。
