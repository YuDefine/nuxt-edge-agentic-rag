# Spectra Roadmap

<!-- SPECTRA-UX:ROADMAP-MANUAL:START -->

## Current State

> 狀態（2026-04-21 更新）：目前 branch `main`，local 版本仍是 `v0.25.0`（tag `v0.25.0` 已建立但 repo 無 `origin` remote，需手動 push）。報告 current draft 已切到 `main-v0.0.48.md`（`AGENTS.md` / `CLAUDE.md` 已指向 v48；目前可見的是 working tree 草稿，尚未看到對應 commit）。Open tech debt：TD-009 mid / TD-010 mid / TD-011 high / TD-012 high / TD-014 mid。
>
> **最新進度**（2026-04-21 晚）：
>
> - `fk-cascade-repair-for-self-delete`（active，收尾中）— migration 0010 已完成並套用 local + production；PRAGMA / row count 驗證與 local self-delete manual check 已完成。剩 production passkey-only 自刪、production D1 tombstone/token cascade 複核，以及 `docs/tech-debt.md` 的 TD-011 狀態回填。
> - `drizzle-refactor-credentials-admin-members`（active，收尾中）— `/api/auth/me/credentials` 與 `/api/admin/members` 已改為 portable drizzle query builder；整合測試、local curl 與 local happy-path 截圖已完成。剩 local/production 人工檢查與 TD-010 狀態回填；apply 階段另發現獨立 follow-up **TD-014**（error-sanitizer 後 12 個 integration tests 的 evlog logger init 問題）。
> - `multi-format-document-ingestion`（draft，尚未開工）— proposal / design / tasks 已齊，下一步是 shared format registry red test → 共用 format registry → rich-format extractor / sync orchestration。
>
> **先前完成**（2026-04-21 晚）：
>
> - **passkey-authentication**（archived）+ **v0.25.0**（commits `235e4d7` / `df49b11` / `f74b331` → deploy `eff64c7` / tag `v0.25.0`，minor bump）— passkey-first 三段式 auth + account self-management（`/account/settings` + 新 passkey dialog + self-delete + migration 0009 + 5 capabilities spec sync）+ 全站 server API 錯誤訊息洩漏防護（`server/plugins/error-sanitizer.ts` + 23 handler 修 + 新 review rule）+ spectra-ux follow-up register 強化。實機 §17 人工檢查 7 項 OK + 3 項 skip（TD-010 / TD-012 blocked）。
>
> **2026-04-21 早**：
>
> - **專題報告 current draft 切到 `main-v0.0.48.md`**（working tree 草稿）— `AGENTS.md` / `CLAUDE.md` 的 Current Version 已指向 v48；ROADMAP 先前仍停在 v47，這次一併校正 current state。
> - **專題報告升版至 `main-v0.0.47.md`**（commit `0368556` + deploy `1ab5262` / tag `v0.24.4`，patch bump）— 補齊 v46 thinking 檢視發現之結構空洞：§3.3.2.3 驗收延後項收束契約（表 3-10）、§2.4.5 部署成本與容量規劃（表 2-29 / 2-30）、附錄 E 實模型選型參考（表 E-1）、§4.1.2 特色分級敘述、§3.2.3 響應式職責切分敘述、圖表目錄總數校正（62 張）、參考文獻 accessed date 格式。1/2/5/7（封面日期、目錄頁碼、組員心得、圖 3-2/3-7 補拍）與架構圖留待 frozen-final / 定稿排版階段。
> - **專題報告升版至 `main-v0.0.46.md`**（commit `b660c08` → deploy `f264132` / tag `v0.24.3`，patch bump）— 把 2026-04-21 跑通之驗收自動化（Unit 6 / MCP 51 / Integration 260 / TC 42 全綠）、§3.2.3 七張實機截圖（`screenshots/local/report-v46/`）、EV runbook 指向、表 4-1 三級狀態分級、附錄 D-1 AI Gateway env var 寫進第三、四章。`frozen-final` 正式驗收跑報仍留待實模型接入後。
> - **conversation-create test 補 member role**（commit `87bd6ce` → deploy `f3962fa` / tag `v0.24.2`，patch bump）— 消除 `getGuestPolicy` 的 `hub:db` dynamic import warn log 4 次；test 數不變（260 passed / 1 skipped）。
>
> **2026-04-20 完成**：
>
> - **專題報告升版至 `main-v0.0.45.md`**（commit `971511d` / tag `v0.24.1`，patch bump）— 補齊 B16 三級 RBAC、AI Gateway、migration 0007-0008、響應式等已完成實作在第二、三章的敘述；圖表目錄總張數 50 → 53；§5.2.1 新增「已實作但尚未驗收」段落。
> - `add-ai-gateway-usage-tracking` — Phase 1~5 實作 + test + Design Review + 人工檢查 H.1~H.9 全通過 → archive（commit `23d4ffd`）。Cloudflare AI Gateway 外部前置 + Analytics token + wrangler secret 完成；v0.23.0 → v0.23.1 部署上線。
> - TD-001~TD-008 — 技術債全數解決（Drizzle 遷移、guest_policy runbook、text-dimmed 對比度、首頁 hit-target、admin a11y 批次、Nuxt UI variant override、裝飾 icon aria-hidden、acceptance-tc-0x MCP mock drift）。
> - **Follow-up 全清**（2026-04-20 下午）：
>   - `admin-session.ts` allowlist fallback 刪除 — Phase 3 hook (`session.create.before` A/B/C/D drift reconciliation) 已於 B16 archive 時部署並活躍運行，fallback 分支確定無 prod 流量；移除同時精簡註解。
>   - `mcp_tokens.created_by_user_id` 收緊為 NOT NULL（migration 0008）— prod 先 DELETE 4 筆 local/staging test seed（無 query_logs 引用）+ UPDATE 2 筆 prod test token 到 charles user id（保留 audit trail），剩 3 筆全 non-NULL 後才 ALTER；同步清掉 `mcp-role-gate.ts` 的「null as system seed」legacy bypass 與 `McpTokenRecord.createdByUserId` 的 `| null`。
>   - `chat.post.ts` 雙重 session 讀取 follow-up — 全 repo 審視後確認所有 `server/api/**` endpoint 已收斂為單次 session helper（`requireRole` / `requireUserSession` / `requireRuntimeAdminSession`），無其他 handler 殘留此 pattern。
>
> **待辦**（handoff 中）：
>
> - `frozen-final` 驗收跑報：實模型接入後跑 30–50 筆正式測試集，回填 v47 §3.3.2 表 3-7 / 表 3-8 的延遲 / P50 / P95 / Judge 觸發率統計
> - `/chat` 實機截圖重拍「有回答 + 引用卡片」版本（需完整 R2 + AI Search 閉環或 staging 環境）
> - `/admin/usage` 接上真實 `CLOUDFLARE_API_TOKEN_ANALYTICS` 後重拍 loaded 版本
> - 第五章 §5.1 組員心得、§5.2.2 實作前待驗證事項在最終交付前依實際驗收結果回填

## Next Moves

### 本輪優先序：先收尾兩個已接近完成的 active changes，再開 `multi-format-document-ingestion`

目前最接近完成的是 **TD-011** 與 **TD-010** 對應的兩個 active changes。這兩條線的程式實作、測試與大部分 local 驗證都已完成，剩下的是 production / manual closeout 與 tech debt 狀態回填；在它們收乾淨前，不應直接把焦點切到新的 rich-format ingestion 實作。

- [high] `fk-cascade-repair-for-self-delete`：production 以 passkey-only test user 實測自刪流程（task 8.5）
- [high] `fk-cascade-repair-for-self-delete`：production D1 複核 tombstone 保留 + token cascade（task 8.6）
- [mid] `fk-cascade-repair-for-self-delete`：`docs/tech-debt.md` 將 TD-011 狀態由 `open` 回填為 `done`（task 8.7）
- [mid] `drizzle-refactor-credentials-admin-members`：local `/account/settings` happy path 人工確認（task 7.1）
- [mid] `drizzle-refactor-credentials-admin-members`：local `/admin/members` happy path 人工確認（task 7.2）
- [mid] `drizzle-refactor-credentials-admin-members`：production `/account/settings` + `/admin/members` regression check 與 §16 responsive pipeline 收尾（tasks 7.3 / 7.4）
- [mid] `drizzle-refactor-credentials-admin-members`：`docs/tech-debt.md` 將 TD-010 狀態由 `open` 回填為 `done`（task 7.5）

### 下一個實作切入點：`multi-format-document-ingestion`

等 TD-010 / TD-011 closeout 後，下一個真正要開工的是 rich-format ingestion。此 change 目前還在 0/21，最合理的起手式是先把格式分級與共用 registry 釘牢，再進 extractor 與 sync orchestration。

- [high] 1.1 shared format registry 紅測試（direct text / supported rich / deferred legacy / deferred media）
- [high] 1.2 共用 format registry，供 Upload Wizard、staged upload、sync orchestration 共用
- [high] 1.3 client / server validation 改成 tier-specific acceptance + guidance
- [mid] 2.1~2.3 rich-format canonical snapshot extractor 與 line-oriented replay contract
- [mid] 3.1~3.3 sync path 改為 extraction-first，避免 orphan `documents` / `document_versions`
- [mid] 4.x Upload Wizard 文案、錯誤提示、design review / a11y / responsive 收尾

### 後續輪次（不在本輪動）

- 封面日期填寫（項目 1）— 定稿排版時
- 目錄正式頁碼產生（項目 2）— 定稿排版時
- §5.1 組員心得、§5.2.2 實作前待驗證事項回填（項目 5）— frozen-final 完成後
- 圖 3-2（問答主畫面含回答 + 引用卡片）、圖 3-7（AI Gateway loaded）補拍（項目 7）— frozen-final 或 staging 環境完備後
- frozen-final 30–50 筆實測跑報（表 3-7 / 表 3-8 統計回填）— 實模型接入後

### Open tech debt / follow-ups（2026-04-21）

- [high] **TD-012** 實作 `passkey-first → link Google` 的 custom endpoint（better-auth `linkSocial` 不支援 email=NULL session）— 獨立：TD-012 scope 完整
- [high] **TD-011** `fk-cascade-repair-for-self-delete` 已完成 migration / apply / local 驗證；剩 production manual closeout + tech debt 狀態回填
- [mid] **TD-010** `drizzle-refactor-credentials-admin-members` 已完成主體 refactor / test / local 驗證；剩 manual closeout + tech debt 狀態回填
- [mid] **TD-014** error-sanitizer 後 12 個 integration tests 拋 `evlog` logger not init — 獨立 follow-up，與 TD-010 refactor 無直接因果
- [mid] **TD-009** 獨立 change `passkey-user-profiles-nullable-email` 把 `user_profiles.email_normalized` 全面改 nullable（含 FK children rebuild，去掉 `'__passkey__:'` sentinel）— 互斥：TD-011（兩者都 touch migration 鏈）

### Push 本機 v0.25.0 到 remote

- [mid] 配置 `origin` remote 後 `git push --tags` 把 `v0.25.0` 上到 remote — 獨立

<!-- SPECTRA-UX:ROADMAP-MANUAL:END -->

<!-- SPECTRA-UX:ROADMAP-AUTO:active -->

## Active Changes

_last synced: 2026-04-21T14:25:55.172Z_

3 active changes (0 ready · 2 in progress · 1 draft · 0 blocked)

### Ready to apply

_(none)_

### In progress

- **drizzle-refactor-credentials-admin-members** — 22/27 tasks (81%)
  - Specs: `admin-member-management-ui`, `auth-storage-consistency`, `passkey-authentication`, `responsive-and-a11y-foundation`
- **fk-cascade-repair-for-self-delete** — 41/44 tasks (93%)
  - Specs: `auth-storage-consistency`, `member-and-permission-model`, `passkey-authentication`

### Draft

- **multi-format-document-ingestion** — 0/21 tasks (0%)
  - Specs: `admin-document-management-ui`, `document-ingestion-and-publishing`

### Blocked

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/active -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parallelism -->

## Parallel Tracks

> Which active changes can be worked on **simultaneously** without stepping on each other.

### Independent (can run in parallel)

- `multi-format-document-ingestion`

### Mutex (same spec touched)

- **auth-storage-consistency** — conflict between: `drizzle-refactor-credentials-admin-members`, `fk-cascade-repair-for-self-delete`
- **passkey-authentication** — conflict between: `drizzle-refactor-credentials-admin-members`, `fk-cascade-repair-for-self-delete`

### Blocked by dependency

_(none)_

<!-- SPECTRA-UX:ROADMAP-AUTO:/parallelism -->

<!-- SPECTRA-UX:ROADMAP-AUTO:parked -->

## Parked Changes

> 已 `spectra park` 的 changes。檔案暫時從 `openspec/changes/` 移出，
> metadata 保留在 `.spectra/spectra.db`。`spectra unpark <name>` 可取回。

1 parked change

- **passkey-first-link-google-custom-endpoint** — 0/45 tasks (0%)
  - Summary: passkey-first 使用者（`user.email …

<!-- SPECTRA-UX:ROADMAP-AUTO:/parked -->

<!-- SPECTRA-UX:ROADMAP-MANUAL:backlog -->

## Parked Changes Backlog

_(none — 2026-04-19 下午 8 個 parked change 全部 unpark 處理完畢：2 個刪除、1 對合併、5 個留作 active。)_

<!-- SPECTRA-UX:ROADMAP-MANUAL:/backlog -->
