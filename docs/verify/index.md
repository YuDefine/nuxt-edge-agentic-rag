# 驗證指南

這一區現在改成「主題導向」入口，不再只是一串檔名。原始檔名全部保留，避免打斷 repo 內既有引用；整理重點放在讓人能先找到類別，再進到對應文件。

## 你應該先看哪一類

### 部署與復原

- 上線、回滾、事故處置、正式部署檢查。
- 先看 [DEPLOYMENT_RUNBOOK](./DEPLOYMENT_RUNBOOK.md) 與 [DISASTER_RECOVERY_RUNBOOK](./DISASTER_RECOVERY_RUNBOOK.md)。

### 功能驗證與 QA

- 驗收、smoke、debug surface、對話生命週期、RWD 與 a11y。
- 先看 [ACCEPTANCE_RUNBOOK](./ACCEPTANCE_RUNBOOK.md)、[KNOWLEDGE_SMOKE](./KNOWLEDGE_SMOKE.md)、[RESPONSIVE_A11Y_VERIFICATION](./RESPONSIVE_A11Y_VERIFICATION.md)。

### 開發與架構

- Composable、Pinia、快取策略、測試流程、常見 production 問題。
- 先看 [COMPOSABLE_DEVELOPMENT](./COMPOSABLE_DEVELOPMENT.md)、[PINIA_ARCHITECTURE](./PINIA_ARCHITECTURE.md)、[TEST_DRIVEN_DEVELOPMENT](./TEST_DRIVEN_DEVELOPMENT.md)。

### 權限與保留策略

- OAuth、retention cleanup、replay contract。
- 先看 [OAUTH_SETUP](./OAUTH_SETUP.md)、[RETENTION_CLEANUP_RUNBOOK](./RETENTION_CLEANUP_RUNBOOK.md)、[RETENTION_REPLAY_CONTRACT](./RETENTION_REPLAY_CONTRACT.md)。

## Repo 瀏覽入口

- 如果你是在檔案樹中直接打開資料夾，請看 [README](./README.md)。
- 如果你是在文件站瀏覽，左側 sidebar 已按主題重新分組。

## 這輪整理的原則

- 不改既有檔名。
- 不搬動檔案位置。
- 先改善可找性，再考慮後續命名一致化。
