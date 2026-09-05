---
name: opsx
description: 'OPSX — 用於 consumer 的需求建立、修訂、BDD 實作接續與 change 歸檔。歷史查詢也由此進入；clade 中央標準變更走 plan 與 work-loop，既有待拍板回答走 my。'
effort: high
permission_tier: action
---
<!--
🔒 LOCKED — managed by clade
Source: plugins/hub-core/skills/opsx/
Edit at: $CLADE_HOME
Local edits will be reverted by the next sync.
-->


# OPSX 需求交付

沿需求、work、attempt 與證據的既有身分推進使用者交付目標。以 OPSX intent 記需求版本、flow 記工作與執行事實，完成與否由既有 BDD／驗收判定器計算。

## 入口

1. 從使用者意圖及當前 checkout 確認責任 repo、要交付的結果與既有 change／work。clade 中央倉自身維持 plan／tasks 工作流。已有明確指示就接續執行，不再用選單重問一次。
2. 問答、除錯調查、稽核或方案討論先讀 `references/inquiry.md`，完成該唯讀流程；它們不建立需求、不 materialize，也不要求先有 OPSX change。
3. 確認 CLI：clade source checkout 用 `vendor/scripts/opsx-control.ts`；consumer 用 `.clade/vendor/scripts/opsx-control.ts`。以下 `<cli>` 指已確認存在的那個檔。執行 `node <cli> --help` 核對已交付能力；缺檔是標準未送達，記錄具體 repo／版本並交由標準發布流程修復。
4. 執行 `node <cli> list --repo-root <repo> --json` 找既有身分。每一個 mutation 都明確帶 repo 及 change/work，NEVER 由相似標題合併、由 slug 推論 workflow profile，或把其他 checkout 的同名檔案當作目標。

## 依目標執行

| 使用者目標 | 執行與出口 |
| --- | --- |
| 問答／除錯調查／稽核／方案討論 | 讀 `references/inquiry.md`，保留原請求的調查模式與唯讀邊界，回報有證據的答案。 |
| 新需求／新的功能 | 讀 `references/intent.md`，形成有來源、驗收及 impact 的 canonical source；create 後回讀正式身分與 binding。 |
| 補充／修訂需求 | 讀 `references/intent.md`，沿用原 change/work 身分，digest-guarded revise；變更所影響的舊證據失效。 |
| 開始／繼續實作 | 讀 `references/execution.md`，materialize 後依目前 instruction、原本 routing 與 BDD gate 執行，回收真實證據。 |
| 查看進度／舊資料 | inspect／history 讀 canonical projection 或具來源與 digest 的歷史原件；尚無 change ID 時用 `history --path <openspec/changes/...> --repo-root <repo> --json`。SQLite 暫存來源用 `history --legacy-change-id <id> --repo-root <repo> --json`；list 的 `legacy_store`／`legacy_changes` 提供來源狀態。無法讀取、截斷與未知狀態明示。 |
| 驗證／歸檔 | 讀 `references/execution.md`，current revision evidence、人工 gate、projection 及 active lease 全經既有判定後 archive。 |

## 寫入與完成契約

- 每一個 Spectra writer 都已退役；NEVER 以舊 CLI、直接勾 tasks.md、修改 touched sidecar 或改歷史檔案替代 OPSX／flow command。`tasks.md` 是生成投影。
- legacy 未完需求有 supersedes/provenance 承接後接續。封存原件只表示歷史保存，不表示原需求已完成。
- 每一張 work 的 process exit、實作完成、BDD 通過、人工驗收、commit 與部署分開呈現。證據與當前 requirement revision 不符時保留為歷史，不能通過目前 gate。
- 執行入口按任務類型選 harness/model/effort；Claude 只經 cc／ccw 機械選槽。專案自動關閉時保留全部觀測與手動進度，新自動工作遵守共同啟動 gate。

## 回報

先說可驗證結果，再給 change/work、當前 revision、實跑證據連結及仍未通過的具體 gate。只要原請求還有已授權且可執行的工作，就繼續；NEVER 把 CLI 成功、計畫寫完或已派工當成交付完成。
