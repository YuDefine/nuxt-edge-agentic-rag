## Why

main-v0.0.39.md 表 2-25 已完整列出 Local / Staging / Production 三環境的 D1 / R2 / KV / AI Search / OAuth / `ADMIN_EMAIL_ALLOWLIST` / Feature flags 資源與環境變數，但**具體部署步驟**（wrangler 指令順序、CI workflow、secrets 設定、migration apply 時機）與**災難復原程序**（wrangler rollback、D1 migration 退版、env 還原）未明確寫入報告。答辯展示與實務交付皆需要可照著做的部署手冊，避免 oral 口述造成操作誤差。

improve.md D1 🟢（時間允許才做）+ D4 🟢（併入 D1）合併為純文件 change：新增附錄 D 部署手冊，包含初次部署、日常部署、災難復原三節。

## What Changes

- **附錄 D-1 初次部署**：步驟式手冊，從 Cloudflare 帳號準備 → wrangler CLI 安裝 → 建立 D1 / R2 / KV / AI Search 資源 → `wrangler.toml` bindings → OAuth client secret 與 `ADMIN_EMAIL_ALLOWLIST` 設定 → migration apply → 首次 deploy。
- **附錄 D-2 日常部署**：git merge 主幹後的標準流程（lint/typecheck/test → `pnpm generate` → `wrangler deploy` → smoke test → tag 版本）；CI GitHub Action workflow 範例（`.github/workflows/deploy.yml`）。
- **附錄 D-3 災難復原**：四類復原情境逐一說明：
  - **應用層 rollback**：`wrangler deployments list` → `wrangler rollback <deployment-id>` 的步驟與驗證
  - **D1 migration 退版**：drizzle-kit 或手動 SQL 還原 schema；保留 `backups/d1/<YYYY-MM-DD>.sqlite.dump` 的 backup 策略
  - **R2 物件還原**：誤刪或誤覆蓋時從 `backups/r2/` 或 Cloudflare 版本歷史還原
  - **env var / secrets 還原**：從 `1Password` / vault 還原 OAuth client secret、allowlist；secrets rotate 流程
- **環境變數完整清單表格**：報告 §附錄 D 開頭以單一表格列出所有 env var（名稱、用途、範例格式、敏感度、各環境預設）；與表 2-25 互補但更偏「運維操作」視角。

## Non-Goals

- **不重複 §2.4.3 資料生命週期內容**：retention 清理、日常 cron 已在正文；附錄 D 僅提部署層視角。
- **不涵蓋 local dev 環境設定**：local 開發由 `CLAUDE.md` / `template/HANDOFF.md` 說明；附錄 D 僅限 Staging / Production deploy。
- **不提供完整 CI script**：僅範例示意，實際 CI YAML 可能隨專案演進；以「參考配置」性質呈現。
- **不處理跨雲商遷移**：僅限 Cloudflare 目標平台；若未來遷到 AWS / GCP 為另一獨立工作。
- **不做實測部署紀錄**：d-部分的驗證（Acceptance）留待實際部署時回填；此 change 僅建立手冊本體。

## Capabilities

### New Capabilities

- `deployment-and-disaster-recovery-docs`: 純文件 capability，紀錄部署流程、CI workflow、災難復原程序；正文綁定至報告附錄 D。

### Modified Capabilities

（none — 純新增文件不改 v1.0.0 系統行為）

## Impact

- **Affected specs**: `deployment-and-disaster-recovery-docs`（新）
- **Affected code**: 無程式碼變更
- **Affected docs**:
  - `main-v0.0.40+.md` 新增附錄 D 三節（D-1 初次部署、D-2 日常部署、D-3 災難復原）+ env var 清單表格
  - `docs/verify/DEPLOYMENT_RUNBOOK.md`（新）— operator 日常操作手冊；與附錄 D 互補但更即時可執行
  - `docs/verify/DISASTER_RECOVERY_RUNBOOK.md`（新）— 緊急事故處理手冊
  - `.github/workflows/deploy.yml`（新或修訂）— CI 部署 workflow 範例
- **Affected runtime**: 無 runtime 行為改變
