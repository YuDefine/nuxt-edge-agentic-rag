# Disaster Recovery Runbook

> 緊急事故處理手冊。對齊 `openspec/changes/deployment-manual/` 附錄 D-3。日常部署請改看 `DEPLOYMENT_RUNBOOK.md`。

**重要前提**：此手冊為「事故發生時的操作步驟」，**不取代事前備份策略**。任何情境的復原下限取決於備份新鮮度與完整度——參考 §6「備份策略」。

## 0. 事故分類與第一步

拿到 incident 後，**先做這三件事**，不管後面走哪一條復原路徑：

1. **Timeline 起點**：記下「發現時間」+「第一個症狀」+「通報者」，後續所有動作都以此為 T0
2. **Blast radius 初判**：是 single-user 問題、部分 feature 壞掉、全站 down、或資料錯誤？
3. **通知 stakeholders**：依 §7 的 stakeholder 清單逐級通知——**even if** 還不知道原因

然後依症狀分類：

| 症狀                                      | 走哪節               |
| ----------------------------------------- | -------------------- |
| Deploy 後全站 5xx / 顯示錯誤              | §1 應用層 rollback   |
| Deploy 後部分 API 500，log 含 D1 error    | §2 D1 migration 退版 |
| 文件 / 版本檔在 R2 被誤刪或誤覆蓋         | §3 R2 物件還原       |
| OAuth 失效 / allowlist 誤刪 / secret 洩漏 | §4 Secrets 還原      |

多個症狀並存 → 先處理**應用層 rollback**（§1 通常最快、風險最低），再根據 rollback 後仍存在的問題處理其他層。

## 1. 應用層 Rollback（Wrangler Rollback）

### 1.1 何時用

- Deploy 後立刻發現 bug（幾分鐘 ~ 數小時內）
- 新版 code 造成 5xx / 誤行為，但**沒有** schema / data model 變動
- DB migration 無變化、R2 無誤動、secrets 沒換

### 1.2 步驟

```bash
# 1. 列出最近的 deployment
pnpm exec wrangler deployments list --name nuxt-edge-agentic-rag
```

**預期輸出**：

```
Deployment ID: abc-...   Created: 2026-04-19T12:00Z   Tag: deploy 2026-04-19
Deployment ID: xyz-...   Created: 2026-04-19T10:00Z   Tag: deploy 2026-04-19  ← target
...
```

最頂端是 current，複製**上一個穩定版**的 Deployment ID。

```bash
# 2. 預覽要回滾到的版本
pnpm exec wrangler deployments view <target-deployment-id>
# 確認日期與 code 版本符合預期

# 3. 執行 rollback
pnpm exec wrangler rollback --deployment-id <target-deployment-id>
# 系統會提示確認；輸入 rollback reason

# 4. 驗證
pnpm exec wrangler deployments list --name nuxt-edge-agentic-rag
# 頂端應變成 target-deployment-id
```

### 1.3 驗證 Checklist

- [ ] 首頁 200：`curl -sf -w '%{http_code}\n' https://agentic.yudefine.com.tw/ -o /dev/null`
- [ ] OAuth 可登入（瀏覽器實測）
- [ ] `/api/admin/*`（admin 登入）不 500
- [ ] `wrangler tail` 觀察 60 秒，無異常 5xx
- [ ] 之前 incident 的症狀已消失
- [ ] 對照 `SENTRY`（若啟用）錯誤率回落至 baseline

### 1.4 不能用 `wrangler rollback` 的情境

- Rollback 目標版本老於 **保留上限**（Cloudflare 保留最近 10 個 deployment，超過就消失）
- 新版同時動了 D1 migration（migration 已 forward → rollback code 但 schema 仍是新的 → 新 code 和舊 code 都可能不相容 → 必須同時退 migration，見 §2）
- 新版同時動了 secrets（secret 已切新值 → rollback code 若依賴舊 secret 格式會壞，見 §4）

若遇到任一，改走 forward-fix（用 patch PR 修）或走對應章節的 rollback 路徑。

### 1.5 Data Loss 邊界

- **應用層 rollback 不影響資料**：D1 / R2 / KV 的 state 在 rollback 前後不變
- 但 rollback 期間（~30 秒）可能有 inflight request 處在 new code 或 old code 之間的不確定狀態
- 若該段時間有 POST/PATCH/DELETE，caller 應 retry（見 `.claude/rules/api-patterns.md` idempotency）

## 2. D1 Schema / Migration 退版

### 2.1 何時用

- Migration apply 後 production 出現 D1 error（`no such column`、`NOT NULL constraint failed`）
- 新 migration 有設計錯誤（例如 column type 錯、missing default）
- 應用層 rollback 已把 code 退回舊版，但舊 code 無法在新 schema 上跑

### 2.2 核心原則

> **D1 不支援 migration down 腳本**。退版等於**手寫 reverse SQL**。

因此 §2 的步驟分三種情境：

- **情境 A**：有最近的 D1 backup dump（見 §6.1） → restore from dump
- **情境 B**：沒有 dump，但 migration 是**可逆的**（例如加 column、加 index） → 手寫 `DROP` / `ALTER` reverse SQL
- **情境 C**：沒有 dump，migration **不可逆**（例如 drop column、rename column、data transform） → 資料遺失，走 forward-fix

### 2.3 情境 A：從 backup dump 還原

```bash
# 1. 找最新 backup
ls -lht backups/d1/*.sqlite.dump | head -5
# 例：backups/d1/2026-04-19T03-00Z.sqlite.dump

# 2. （強烈建議）先再做一份現況 dump 以備萬一
pnpm exec wrangler d1 export agentic-rag-db --remote \
  --output=backups/d1/before-restore-$(date -u +%Y-%m-%dT%H-%M-%SZ).sqlite.dump

# 3. 建立臨時 D1 做 restore 演練（production 不可直接 import 覆蓋）
pnpm exec wrangler d1 create agentic-rag-db-restore-test
# 把回傳的 database_id 記下

# 4. Import 到臨時 D1
pnpm exec wrangler d1 execute agentic-rag-db-restore-test --remote \
  --file=backups/d1/2026-04-19T03-00Z.sqlite.dump

# 5. Sanity check 臨時 D1
pnpm exec wrangler d1 execute agentic-rag-db-restore-test --remote \
  --command "SELECT COUNT(*) FROM documents;"
# 對照 backup 時的預期數量

# 6. 確認 OK 後，切換 wrangler.jsonc 的 database_id 為臨時 D1 的 id
#    並 deploy
# 7. 驗證 production 回復正常後，再決定是否把臨時 D1 rename 為 primary
```

⚠️ **NEVER** 用 `wrangler d1 execute ... --file=<dump>` 直接對 production D1 覆蓋——沒有 atomic swap，中途失敗會讓 production 進入 half-restored 狀態。

### 2.4 情境 B：手寫 reverse SQL

例如 migration `0005` 加了 column `query_logs.observability_mode`，想退版：

```bash
# 1. 確認目前 migration state
pnpm exec wrangler d1 migrations list agentic-rag-db --remote

# 2. 手寫 reverse SQL
cat > /tmp/reverse-0005.sql <<'SQL'
-- Reverse 0005_query_logs_observability_fields
ALTER TABLE query_logs DROP COLUMN observability_mode;
-- （列出所有該 migration 加過的 column / index / constraint）
SQL

# 3. Dry-run（local）
pnpm exec wrangler d1 execute agentic-rag-db --local --file=/tmp/reverse-0005.sql

# 4. Apply 到 remote
pnpm exec wrangler d1 execute agentic-rag-db --remote --file=/tmp/reverse-0005.sql

# 5. 手動從 D1 `d1_migrations` 表刪除該 entry 避免下次 apply 重做
pnpm exec wrangler d1 execute agentic-rag-db --remote \
  --command "DELETE FROM d1_migrations WHERE name='0005_query_logs_observability_fields';"
```

⚠️ 如果該 migration 已有 production 資料寫入新 column，drop column 會遺失那段資料——先用 `wrangler d1 export` 備份後再動。

### 2.5 情境 C：不可逆（forward-fix）

不嘗試退版，改成**再寫一個 migration** 把 schema 補成 code 期望的形狀：

```bash
# 1. 新增 migration
touch server/database/migrations/0006_hotfix_revert_observability_mode.sql
# 內容：用 ALTER TABLE 把 column 調整為與舊 code 相容的 shape（例如設 default）
```

走正常 deploy 流程（見 `DEPLOYMENT_RUNBOOK.md` §3）。

### 2.6 驗證 Checklist

- [ ] `pnpm exec wrangler d1 execute agentic-rag-db --remote --command "PRAGMA table_info(<table>);"` 欄位結構符合預期
- [ ] `SELECT COUNT(*) FROM <critical-table>;` 行數沒掉
- [ ] 應用 `/api/admin/*` 不再 D1 500
- [ ] `wrangler tail` 無 `D1_ERROR:` log

### 2.7 Data Loss 邊界

| 情境              | 可能的資料遺失                                          |
| ----------------- | ------------------------------------------------------- |
| A（dump restore） | backup 時間點之後的所有寫入（差額 = T0 - dump_time）    |
| B（reverse SQL）  | 僅該 migration 寫入的新欄位資料                         |
| C（forward-fix）  | 零（但要接受 schema 仍是「錯的」，透過新 migration 補） |

每日 03:00 UTC 如果有 backup cron（見 §6.1），**最壞情境 = 24 小時資料**。

## 3. R2 物件還原

### 3.1 何時用

- Admin 誤 delete 文件（`/admin/documents/<id>` → 刪除）
- `api/documents/sync` 誤覆蓋 object key
- R2 bucket 的 lifecycle rule 誤設成過短 expiry
- 被入侵者清空 bucket

### 3.2 Cloudflare R2 Version History

R2 **不預設啟用** object versioning——要先在 Dashboard 開。若未開：

- **Dashboard → R2 → agentic-rag-documents → Settings → Object Versioning → Enable**
- 開啟後只保護**之後**的變更，之前的 overwrite/delete **無法**從 R2 端還原

### 3.3 步驟（已啟用 versioning 的情境）

```bash
# 1. 列出該 key 的所有 versions
pnpm exec wrangler r2 object versions list \
  --bucket agentic-rag-documents \
  --key "documents/<document-id>/<version-id>.bin"

# 2. 找到誤刪前最後一個 version id
# 3. Restore（R2 API：複製該 version 到 current）
pnpm exec wrangler r2 object copy \
  --bucket agentic-rag-documents \
  --source-key "documents/<document-id>/<version-id>.bin?versionId=<good-version-id>" \
  --dest-key "documents/<document-id>/<version-id>.bin"
```

⚠️ Wrangler CLI 對 versioning 的支援仍在演進，最新指令請對照 `pnpm exec wrangler r2 object --help`。若 CLI 不支援，改用 R2 API `Upload-Part-Copy` 或 Dashboard UI 直接操作。

### 3.4 步驟（未啟用 versioning，有自建 backup）

我們的 backup 策略（見 §6.2）：每日 03:05 UTC 把 R2 bucket 的 manifest + 關鍵物件複製到 `backups/r2/<YYYY-MM-DD>/` 前綴。

```bash
# 1. 查 backup manifest
pnpm exec wrangler r2 object get \
  agentic-rag-documents/backups/r2/2026-04-18/manifest.json \
  --file=/tmp/manifest.json
cat /tmp/manifest.json | jq '.objects[] | select(.key | contains("<document-id>"))'

# 2. 從 backup 複製回 primary key
pnpm exec wrangler r2 object get \
  agentic-rag-documents/backups/r2/2026-04-18/documents/<document-id>/<version-id>.bin \
  --file=/tmp/restore.bin

pnpm exec wrangler r2 object put \
  agentic-rag-documents/documents/<document-id>/<version-id>.bin \
  --file=/tmp/restore.bin \
  --content-type="application/octet-stream"
```

### 3.5 步驟（無 versioning 也無 backup）

⛔ **資料無法復原**。降級處置：

1. 停止對外服務該文件的 API（`documents.status='archived'`）
2. 通知 stakeholders 資料遺失
3. 從其他來源（uploader 的原始檔、version manifest 的 checksum 提示）請原作者重新上傳
4. 建立 post-mortem，立刻啟用 §6.2 的 backup 策略避免下次再發生

### 3.6 驗證 Checklist

- [ ] `pnpm exec wrangler r2 object get agentic-rag-documents/<key> --file=/tmp/verify.bin` 成功取回
- [ ] `shasum -a 256 /tmp/verify.bin` 與 D1 `document_versions.checksum_sha256` 一致
- [ ] `/admin/documents/<id>` 頁面的版本 preview 正常顯示
- [ ] `api/chat` 對該文件 citation 能回傳 chunk

### 3.7 Data Loss 邊界

| 防線               | 最壞情境                            |
| ------------------ | ----------------------------------- |
| Versioning enabled | 0 bytes（所有變更都有 version）     |
| Daily backup cron  | 24 小時新增內容 + 當日內所有 delete |
| 無任何防線         | **全部**                            |

## 4. Secrets / Env Var 還原

### 4.1 何時用

- 誤把錯誤值 push 進 `wrangler secret put`
- Secret 洩漏（git commit 外流、log 外流），需立即輪替
- `ADMIN_EMAIL_ALLOWLIST` 誤刪導致自己都進不了 admin
- OAuth credentials 被撤銷

### 4.2 單一 Secret 誤設（有 vault backup 的正常情境）

前提：公司有 1Password / Vaultwarden / AWS Secrets Manager 的「secret vault」，每次 `wrangler secret put` 同步寫入一份到 vault。

```bash
# 1. 從 vault 取回正確值
# 1Password CLI 範例：
op item get "Cloudflare Workers — nuxt-edge-agentic-rag — NUXT_SESSION_PASSWORD" \
  --fields password

# 2. 重新 put
echo "<value-from-vault>" | pnpm exec wrangler secret put NUXT_SESSION_PASSWORD

# 3. 驗證
pnpm exec wrangler secret list | grep NUXT_SESSION_PASSWORD
```

⚠️ `wrangler secret put` 會讓 Worker 自動重新 deploy，現有 session 的 user 會被迫登出。排維護窗 or 通知使用者。

### 4.3 Secret 洩漏緊急輪替

假設 `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` 外流：

1. **立刻**在 Google Cloud Console → Credentials → 對應 OAuth Client → **Reset secret**（舊值立刻失效）
2. 新值存入 vault
3. `echo "<new-secret>" | pnpm exec wrangler secret put NUXT_OAUTH_GOOGLE_CLIENT_SECRET`
4. 驗證 OAuth 登入仍正常（§1.3 的驗證 checklist 第二項）
5. 檢查外流來源（git log、public log、screenshot）確認影響範圍
6. 寫 post-mortem，考慮開啟 secret scanning（GitHub → Settings → Secret scanning）

**Session 類 secret**（`NUXT_SESSION_PASSWORD` / `BETTER_AUTH_SECRET`）輪替：

```bash
openssl rand -base64 32 | pnpm exec wrangler secret put NUXT_SESSION_PASSWORD
```

輪替後**所有使用者的 session 會失效**，強制重新登入。這是 expected behaviour（尤其在 secret 洩漏時反而是 feature）。

### 4.4 `ADMIN_EMAIL_ALLOWLIST` 誤刪

如果自己也被踢出 admin：

- 若 vault 有 backup：`echo "<csv>" | pnpm exec wrangler secret put ADMIN_EMAIL_ALLOWLIST`
- 若無 backup，但你有 Cloudflare Dashboard 權限：
  1. Dashboard → Workers → nuxt-edge-agentic-rag → Settings → Variables and Secrets
  2. 編輯 `ADMIN_EMAIL_ALLOWLIST` → 加回自己的 email
  3. 部署會自動重啟，再登入即可

### 4.5 R2 API Token 洩漏

1. Dashboard → R2 → Manage R2 API Tokens → 找到該 token → **Revoke**
2. 新建同權限 token，更新 `NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID` / `NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY`
3. 檢查 token 洩漏期間的 R2 audit log（Dashboard → R2 → audit logs）有無異常讀寫

### 4.6 驗證 Checklist

- [ ] `pnpm exec wrangler secret list` 無意外條目
- [ ] 相關 feature 功能正常（OAuth 可登入、admin 可進後台、upload presign 能用）
- [ ] 舊 secret 值在外流來源已不存在（或已 revoke）
- [ ] Vault 中的版本紀錄已更新，註明輪替原因與時間

### 4.7 Data Loss 邊界

Secret 輪替不影響資料，但可能影響 UX：

- Session secret 輪替 → 所有 user 強制重登
- OAuth secret 輪替 → 輪替瞬間到 deploy 完成約 30 秒的 OAuth callback 會失敗（retry 即可）
- R2 token 輪替 → 輪替瞬間到 deploy 完成約 30 秒的 pre-sign 會失敗

## 5. 事故時序樣板（Timeline Template）

每次事故都寫一份 timeline，存到 `docs/post-mortem/YYYY-MM-DD-<slug>.md`（目錄不存在則建立）。

```markdown
# Incident YYYY-MM-DD: <slug>

## Summary

一段話描述發生了什麼、影響了誰、持續多久。

## Timeline (UTC)

- T0 (HH:MM): 發現症狀 / 通報者 / 最初的錯誤訊息
- T0+Xm: 第一個 diagnosis 動作
- T0+Ym: 確認 root cause
- T0+Zm: 執行 rollback / hotfix
- T0+Wm: 驗證通過 / 宣告 resolved

## Root Cause

技術層面真正的原因（不是「bug 寫錯了」這種廢話）。

## Impact

- 影響使用者數：
- 影響 feature：
- 資料遺失：有 / 無（量化）
- 財務損失：（若有）

## What Went Well

- Rollback 指令第一次就對
- Stakeholder 通知準時

## What Went Wrong

- Alert 沒及時觸發（→ action item）
- Runbook 某步驟描述不清（→ 改 runbook）

## Action Items

- [ ] （負責人, deadline）具體改善項
- [ ] …

## References

- Deploy ID：
- Commit SHA：
- Wrangler tail log 快照：
```

## 6. 備份策略（Backup Strategy）

復原能力 = 備份新鮮度 × 備份完整度 × restore 演練頻率。**沒演練過 = 沒有備份**。

### 6.1 D1 Backup（每日）

Backup cron（建議用 GitHub Actions scheduled workflow，不要放 Workers 自己因為會跟業務邏輯搶 CPU 額度）：

```yaml
# 示意 .github/workflows/d1-backup.yml（尚未建立，視需求啟用）
name: D1 Backup
on:
  schedule:
    - cron: '0 3 * * *' # 每日 UTC 03:00
  workflow_dispatch:
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 export agentic-rag-db --remote --output=/tmp/dump.sqlite
      - name: Upload to R2 backup bucket
        run: |
          # 命名：backups/d1/YYYY-MM-DDTHH-MM-SSZ.sqlite
          # 建議 R2 bucket 與 primary 分開（e.g. agentic-rag-backups），
          # 並加 lifecycle rule 自動刪除 > 30 天的舊 dump
          ...
```

**Retention**：30 天（可依成本調整）。超過 30 天的事故通常走 forward-fix 而非 restore。

**驗證演練**：每 **3 個月**跑一次情境 A restore 到臨時 D1，對比 SELECT COUNT 是否正確。演練結果記到 `docs/verify/drills/d1-restore-YYYY-MM.md`。

### 6.2 R2 Backup（每日）

選項 1（推薦）：**啟用 R2 Object Versioning**（見 §3.2），省去自建 backup。

- 優點：零額外程式碼，single source of truth
- 缺點：Versioning 只保護**啟用後**的變更；歷史誤刪救不回來

選項 2：自建 backup cron，把 `agentic-rag-documents` 的 manifest + 關鍵物件複製到獨立 `agentic-rag-backups` bucket。

選項 3：定期 `wrangler r2 object list --prefix=documents/` 並對比 D1 `document_versions.object_key`，偵測孤兒或遺失。

**MVP 建議**：**啟用 Versioning**（5 分鐘搞定）+ 不額外建 backup cron，成本與複雜度最低。升級需求出現再加 cron。

### 6.3 Secrets Backup（即時）

**必須**每次 `wrangler secret put` 同步寫入 vault。沒有 vault = 誤刪 / 輪替後無法還原。

**推薦**：

- 1Password：`op item create ... --vault "Cloudflare Secrets"`
- Bitwarden / Vaultwarden：同上
- AWS Secrets Manager（如公司已用）

**NEVER** 把 secret 明文寫進：

- Git repo（就算 `.gitignore` 也 NEVER）
- GitHub Actions log（用 `::add-mask::` 保護）
- Slack / email / DM（即使是「暫時貼一下」）

### 6.4 演練要求

| 資源                        | 演練頻率               | 負責人        |
| --------------------------- | ---------------------- | ------------- |
| D1 restore（情境 A）        | 每季                   | 主要 operator |
| R2 restore                  | 每半年                 | 主要 operator |
| Secret rotation             | 每季（session secret） | 主要 operator |
| Full DR drill（三者串起來） | 每年一次               | Team          |

## 7. Stakeholder 通知

事故一發生（不管有沒有 root cause），**立刻**通知以下人員。晚通知 = 延後復原 + 失去信任。

| 角色                     | 通知管道                  | 通知時機 | 訊息範本                                                         |
| ------------------------ | ------------------------- | -------- | ---------------------------------------------------------------- |
| 指導教授                 | email + 簡訊              | T0+15min | 「事故通報：<symptom>，已開始處置，預計 <ETA> 前更新。」         |
| 同 team 組員             | Discord / 群組            | T0+5min  | 同上，附 incident channel 連結                                   |
| 外部使用者（若全站影響） | Status page / 首頁 banner | T0+30min | 「系統暫時異常維護中，已知問題 <simplified>，預計 <ETA> 恢復。」 |
| Sentry alerts 收件人     | 自動（若已設）            | 即時     | —                                                                |

**Post-resolution**（T0 + Wm 宣告 resolved 後）：

- T0 + Wm + 1h：發初步 summary 給指導教授與組員
- T0 + Wm + 24h：發完整 post-mortem（§5 格式）

## 8. 不可做的事（Anti-Patterns）

- **NEVER** 在 production D1 直接 `DROP TABLE` 或 `TRUNCATE`——任何破壞性 SQL 先演練
- **NEVER** 用 `wrangler d1 execute --file=<dump>` 直接覆蓋 production D1（見 §2.3 ⚠️）
- **NEVER** 在事故處置中 `git push -f` 到 main 覆蓋歷史——保留所有變更紀錄供後續追溯
- **NEVER** 處置完畢就跳過 post-mortem——沒寫 = 下次一定再踩
- **NEVER** 讓單一工程師獨自處置 high-severity incident（認知負載 + 盲點）——至少兩人 over-the-shoulder
- **NEVER** 把 secret rotation 當成「沒事順便做」——輪替都有 UX 風險，排維護窗做
- **NEVER** 假設「備份有在跑」——沒演練過的備份等於沒備份

## 9. 相關文件

- `DEPLOYMENT_RUNBOOK.md` — 正常部署流程
- `production-deploy-checklist.md` — Secrets 清單與部署前 checklist
- `RETENTION_CLEANUP_RUNBOOK.md` — 日常 retention job（本 runbook 不涵蓋 retention 層面的事故）
- `main-v0.0.43.md`（或最新版）附錄 D-3 — 災難復原正文
- `.claude/rules/api-patterns.md` — Idempotency 與 retry policy
