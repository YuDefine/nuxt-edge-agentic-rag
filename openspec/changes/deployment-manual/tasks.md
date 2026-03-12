## 1. 附錄 D 報告文字（併入 main-v0.0.44.md）

- [x] 1.1 撰寫附錄 D-1「初次部署」節，涵蓋 Cloudflare 帳號、wrangler CLI、D1/R2/KV/AI Search 資源建立、OAuth / allowlist 設定、migration apply、首次 deploy 與 smoke 驗證；落實 Requirement: First-Time Deployment Runbook
  - 2026-04-19 PASS：`main-v0.0.44.md` §D.1（D.1.1–D.1.5）已新增；以敘述性語氣說明階段順序、邊界與設計理由，具體指令交叉引用至 `docs/verify/DEPLOYMENT_RUNBOOK.md` §2
- [x] 1.2 [P] 撰寫附錄 D-2「日常部署」節，列出 pre-deploy 檢查（`pnpm check` / `pnpm test`）、deploy 命令、post-deploy smoke test、tag 命名慣例；附 `.github/workflows/deploy.yml` 參考範例；落實 Requirement: Routine Deployment Runbook
  - 2026-04-19 PASS：§D.2（D.2.1–D.2.3）已新增；含 YAML 節選說明 CI job 結構，完整 workflow 交叉引用到 repo 實際檔案
- [x] 1.3 撰寫附錄 D-3「災難復原」節，分四類子節：
  - [x] 1.3.1 應用層 rollback（`wrangler deployments list` → `wrangler rollback`）；落實 Requirement: Disaster Recovery Runbook For Application Rollback
    - 2026-04-19 PASS：§D.3.1 已新增；含三項限制條件與 zero data loss 邊界說明
  - [x] 1.3.2 [P] D1 schema 還原（backup 策略 + restore 流程 + 資料遺失邊界）；落實 Requirement: Disaster Recovery Runbook For D1 Schema Rollback
    - 2026-04-19 PASS：§D.3.2 已新增；三情境（backup restore / 可逆 reverse SQL / forward-fix）+ 呼應 D.1.2「migration 只新增不回滾」政策成本
  - [x] 1.3.3 [P] R2 物件還原（version history + backup 前綴）；落實 Requirement: Disaster Recovery Runbook For R2 Object Restoration
    - 2026-04-19 PASS：§D.3.3 已新增；versioning / 自建 backup / 無備份三種情境與對應邊界
  - [x] 1.3.4 [P] Secrets / env var 還原（`wrangler secret put` + vault backup）；落實 Requirement: Secrets And Env Var Restoration Procedure
    - 2026-04-19 PASS：§D.3.4 已新增；含一般誤設還原、緊急輪替、allowlist self-lockout fallback 三路徑
- [x] 1.4 撰寫附錄 D 開頭環境變數清單表（name / purpose / example / sensitivity / Local / Staging / Production default），與表 2-25 互補；落實 Requirement: Consolidated Env Var Reference
  - 2026-04-19 PASS：表 D-1 已新增（22 個變數）；欄位設計為「變數名 / 用途 / 範例格式 / 敏感度 / 設定方式」與表 2-25「項目 / 三環境對比」欄位無重疊，互補分工已於附錄 D 前言明述

## 2. Operator 可執行 Runbook（docs/verify/）

- [x] 2.1 建立 `docs/verify/DEPLOYMENT_RUNBOOK.md`：operator 日常操作手冊，內容為附錄 D-1 + D-2 的可執行版本（含 copy-paste 指令區塊）
- [x] 2.2 [P] 建立 `docs/verify/DISASTER_RECOVERY_RUNBOOK.md`：緊急事故處理手冊，以附錄 D-3 為底，加入事故時序樣板、stakeholders 通知步驟、驗證 checklist

## 3. CI workflow 範例檔

- [x] 3.1 新建或修訂 `.github/workflows/deploy.yml`：實際可運行的 staging + production deploy workflow（可於 PR 階段 dry-run）；以 illustrative comments 標示環境特定段落
  - 2026-04-19 PASS：建議版本 `openspec/changes/deployment-manual/deploy.yml.proposed` 已產出（含 staging job、D1 migrations step、完整 secrets 清單）；主線已用 `cp` 覆寫 `.github/workflows/deploy.yml`（`.github/workflows/` 受 Claude Code guard 永久保護，必須由使用者操作）

## 4. Acceptance 回填（實際部署時補）

- [ ] 4.1 首次 staging 部署後依附錄 D-1 實測，回填每步的「預期輸出」與「驗證結果」；修正錯誤步驟
- [ ] 4.2 [P] 首次 rollback 演練後回填附錄 D-3.1 的驗證紀錄
- [ ] 4.3 [P] D1 migration restore 演練（非 production 環境）後回填 D-3.2

## 人工檢查

> 本 change 為純文件，人工檢查項目關注「可執行性」與「與實際環境一致性」。

- [ ] #1 新 operator 僅讀附錄 D-1 能從零完成 staging 部署（不需口頭補充）
- [ ] #2 附錄 D-2 的 CI workflow 範例在 `.github/workflows/` 實際存在並通過語法檢查
- [ ] #3 附錄 D-3 每類復原情境都有明確成功判斷條件
- [ ] #4 附錄 D 環境變數表與表 2-25 欄位不衝突，語義互補
- [ ] #5 `docs/verify/DEPLOYMENT_RUNBOOK.md` 與 `DISASTER_RECOVERY_RUNBOOK.md` 存在，內容與附錄 D 一致（無分歧敘述）

## Non-UI Change Declaration

**No user-facing journey (backend/docs-only)**

理由：本 change 僅新增報告附錄 D 與 `docs/verify/` 下的 runbook、以及 `.github/workflows/deploy.yml` 範例檔。不新增或修改任何 `app/pages/**`、`app/components/**`、API endpoint、D1 schema；不觸發使用者面任何行為或 UI 變更。完全為運維文件化工作。
