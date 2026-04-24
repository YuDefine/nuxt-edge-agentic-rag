---
description: 依功能分類變更並逐步完成 commit，遵循 commitlint 規範
---

## User Input

```text
$ARGUMENTS
```

政策、禁止事項、commit 類型表見 `.claude/rules/commit.md`。本檔只定義執行流程。

## Step 0-Lock: 單一 session 防呆（**必做第一步**）

```bash
node .codex/scripts/commit-lock.mjs acquire
```

失敗（exit 1）代表另一個 session 正在跑 `/commit` → **停下**，向使用者回報鎖資訊，**不要**自行 `rm` 清鎖或重試。

成功後此 session 取得獨占權，直到 Step 7 釋放。**中斷處理**：若 `/commit` 流程中途失敗 / 使用者中斷，仍**必須**在終止前呼叫 `node .codex/scripts/commit-lock.mjs release`；漏釋放的鎖會在 30 分鐘後被下次 acquire 自動清除（可用 `COMMIT_LOCK_STALE_MINUTES` 調整）。

## Step 0-Scope: WIP 預設全部納入

**預設行為**：所有 `git status` 顯示的 uncommitted 變更（含與本次工作無關、其他 session 並行的 WIP）**一律**列入本次 `/commit` 流程，在 Step 2 依功能自然分組成不同 commit。

**理由**：`/commit` 已付出 0-A / 0-B / 0-C 閘門的完整成本。把 WIP 排除在外等於下次 `/commit` 要重跑一次，浪費時間與 token，還會讓 WIP 長期積著。

**排除條件（唯一）**：使用者在 `$ARGUMENTS` 中**明確**指名要排除的檔案 / 路徑 / scope，例如：
- 「排除 `.env.local`」
- 「不要動 `reports/`」
- 「只 commit `app/` 底下」

**NEVER** 自行判定「這個不在我 scope」而排除。若看到不認得的變更 → 走 `scope-discipline.md` 的「意外發現」流程：`git diff` 確認內容合理 → 納入流程讓 Step 2 分組。**NEVER** `git restore --staged` 或 `git checkout --` 清場。

## Step 0: 品質檢查

### 0-A. 程式碼審查（平行）

**在同一訊息內**平行派兩個 subagent，等兩者都回報：

1. **general-purpose agent** — 於 agent 內透過 Skill tool 呼叫 `simplify` skill，審查重用性、品質、效率
2. **code-review agent**（`agent_type: code-review`）— 審查邏輯與安全

**所有回報的問題必須修正**。完成後明確輸出：

```text
✅ 0-A-1 simplify 通過
✅ 0-A-2 code-review 通過
```

兩個 ✅ 都出現才進入 0-B。

### 0-B. UI Design Review（條件觸發）

```bash
git diff --name-only
```

**同時滿足才觸發**：

1. 變更含 `.vue` 檔的 `<template>` 區塊
2. 屬於下列之一：新增頁面/元件、佈局結構變動、互動流程變動、大範圍樣式調整

**不觸發**：純 `<script>` / `<style>` 微調、composable / store / API 純邏輯、測試、文件、設定檔、單純重構不影響視覺輸出。

觸發時派 `screenshot-review` agent 截圖並評估。問題修正後輸出 `✅ 0-B 通過`；不觸發則直接輸出 `⏭️ 0-B 跳過（無 UI 變更）`。

### 0-C. CI 等效檢查（Fix-Verify Loop）

```bash
pnpm check
```

失敗時進入 loop：修復 → `vp fmt` → `pnpm check` → 重複直到 0 errors + 0 warnings。

**禁止**用 `npx vitest run` / `npx eslint` 等個別工具替代 `pnpm check`。若 `.claude/worktrees/` 干擾結果，先清理再跑。

通過後輸出 `✅ 0-C 通過`。

## Step 1: 檢查變更狀態

```bash
git status
git diff --stat
```

若 `.gitignore` 有變更 → `git checkout .gitignore` 還原。

## Step 2: 分析變更並分組

**分組前提**：Step 0-Scope 已宣告所有 uncommitted 變更都納入流程。這裡的任務是**分類到正確的 commit group**，不是二次過濾要不要納入。

依功能/目的分組並輸出：

```text
### Group 1: [功能描述]
類型: ✨ feat
檔案:
- path/to/file.ts
```

**典型分組模式**（供參考，不強制）：

- 與本次主要工作直接相關 → 一組（主 commit）
- 其他 session 並行編輯的獨立工作（如 `.claude/` 規範、文件、設定檔） → 獨立一組，類型照實（通常 📝 docs / 🔨 refactor / 🧹 chore）
- Formatter / lint 自動修復副作用 → 併入最相關的 group
- 純 rename / 移動 → 獨立一組標 🔨 refactor

若分組完發現某個 group 與主 commit 完全無關且無法合理歸類，**先停下回報使用者**，不要硬塞或默默排除。

## Step 3: 逐一執行 Commit

對每個分組：

```bash
git add <files>
git commit -m "$(cat <<'EOF'
✨ feat: 功能描述

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
git log -1 --oneline
```

## Step 4: 版本號升級、Staging 驗證、Tag Production

判斷升級類型：

- 包含 `✨ feat` → `pnpm version minor --no-git-tag-version`
- 只有 `🐛 fix` 或其他 → `pnpm version patch --no-git-tag-version`

建立 deploy commit：

```bash
git add package.json
git commit -m "$(cat <<'EOF'
🚀 deploy: 發布新版本 v{新版本號}

- 功能描述一
- 功能描述二

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### 4-A. Push main → 觸發 staging 自動部署

```bash
git push origin main
```

`.github/workflows/deploy.yml` 的 `push: branches: [main]` 會觸發 `deploy-staging` + `smoke-test-staging`（以及 docs 對應 job）。

若 `git push origin main` 因 non-fast-forward 被擋，停下處理 upstream 漂移（pull / rebase），**不要**跳過 staging 直接 tag。

### 4-B. 自動等 staging 綠燈（`gh run watch`）

取得剛才 push 觸發的 Deploy workflow run id，`gh run watch` 阻塞等結果：

```bash
# 取當前 HEAD commit 對應的 Deploy workflow run
RUN_ID=$(gh run list --workflow=deploy.yml --branch=main --commit=$(git rev-parse HEAD) \
  --limit=1 --json databaseId --jq '.[0].databaseId')

test -n "$RUN_ID" || { echo "找不到 Deploy workflow run；確認 push 已觸發"; exit 1; }

gh run watch "$RUN_ID" --exit-status
```

`--exit-status` 讓 `gh run watch` 在 run failure 時 exit 非 0。若失敗：

1. 停下不 tag
2. 修復問題（push 新 commit 會觸發新 staging run）
3. 重跑 4-B

### 4-C. Staging 綠 → 建 tag 推 production

```bash
pnpm tag
```

`pnpm tag` 現在只做 `git tag v{版本號} && git push origin --tags`（main 已在 4-A push）。tag push 觸發 `deploy-production`：workflow 內的 `verify-ci-gate` + `verify-staging-gate`（跑 `scripts/check-staging-gate.mjs`）會 double-check 此 SHA 有對應的 staging success；若沒有 → production 被擋下。

tag 推完後可選擇 `gh run watch` 等 production 完成，或讓 Step 6 的 HANDOFF 提醒使用者追蹤部署進度。

## Step 5: 完成報告

```text
✅ Commit 完成！

共建立 N 個 commit：
1. abc1234 ✨ feat: ...
2. def5678 🐛 fix: ...
3. ghi9012 🚀 deploy: 發布新版本 v1.8.0

版本：1.7.1 → 1.8.0 (minor)
Tag：v1.8.0 已建立並推送
```

## Step 6: 更新 HANDOFF.md 與 ROADMAP

遵守 `.claude/rules/handoff.md`：commit 完成後**必須**更新 `HANDOFF.md`，把**所有可延續且尚未被接手的後續工作**寫入 —— 不限於 spectra change。同時同步 Spectra ROADMAP。

### 6-A. 判斷是否需要 handoff

檢查以下任一條件成立 → 需要 handoff：

- `openspec/changes/` 仍有非 archive 目錄（in-progress spectra change）
- `git status` 仍有 uncommitted 變更（刻意未入本次 commit 的 WIP）
- 本次 session 中提及但未做的後續工作（例：refactor 機會、文件更新、測試補強、效能優化）
- 本次 commit 揭露的新 follow-up（`@followup[TD-NNN]` marker、TODO 註解、scope 外發現）
- commit 後必要的驗證 / 部署步驟（人工檢查、deploy smoke test、DB migration 套用）
- 使用者曾提過但還沒做的事（在本 session 或前 session 出現過的 backlog）
- 使用者明確表達接下來要交接 / 暫停

全部不成立（真正什麼都沒得做了）→ 跳到 6-D：若 `HANDOFF.md` 存在且內容已過時，清空或刪除。

### 6-B. 收集下一步資訊

從本次 session 脈絡、`git log`、`docs/tech-debt.md`、`openspec/ROADMAP.md` 的 Next Moves 萃取：

- **In Progress**：正在進行但未完結的工作（spectra change / 自由任務皆可，含進度描述）
- **Blocked**：被什麼擋住、需要什麼才能繼續（無則省略此區塊）
- **Next Steps**（不分來源，一律收齊，按優先序排列）：
  - commit 後的驗證動作：人工檢查、截圖 review、deploy smoke test
  - follow-up marker：`@followup[TD-NNN]` 指向的 tech debt
  - session 中浮現但刻意未處理的機會：refactor、抽共用元件、補測試
  - 跨 session backlog：使用者提過的待辦、roadmap 的 near-term 項目
  - 注意事項 / 陷阱：下一人接手前需要知道的隱性脈絡

### 6-C. 寫入 `HANDOFF.md`

依 `.claude/rules/handoff.md` 格式覆寫：

```markdown
# Handoff

## In Progress

- [ ] <任務描述（spectra change 名稱 / 自由任務 / WIP）>
- <做到哪、關鍵檔案或決策點>

## Blocked

- <blocker 描述；無則省略整個區塊>

## Next Steps

1. <下一步，按優先序>
2. <...>
```

**禁止**：

- 編造不存在的 in-progress / blocker
- 只寫 openspec 相關內容而漏掉其他可延續工作
- 為了「填滿」區塊灌水 —— 真沒有就省略該區塊

### 6-D. 同步 Spectra ROADMAP

```bash
pnpm spectra:roadmap
```

重算 `openspec/ROADMAP.md` 的 AUTO 區塊（Active Changes / Active Claims / Parallel Tracks / Parked Changes）。

若 6-B 收集到的 **Next Steps** 中包含跨 session backlog（不只是「commit 後立刻要做」的驗證動作），依 `.claude/rules/proactive-skills.md` 的「Spectra Roadmap Maintenance」**手動**更新 MANUAL 區塊的 `## Next Moves`，格式：

```text
- [priority] 描述 — 依賴：xxx / 獨立 / 互斥：yyy
```

**禁止**：手編 `<!-- SPECTRA-UX:ROADMAP-AUTO:* -->` 區塊（會被下次 sync 覆寫）。

### 6-E. 報告

```text
✅ HANDOFF.md 已更新
✅ ROADMAP 已同步
（或：無可延續工作，HANDOFF.md 已清空 / 未建立）
```

## Step 7: 釋放 /commit lock（**必做最後一步**）

```bash
node .codex/scripts/commit-lock.mjs release
```

**必須執行**，即使前面任何 step 失敗：

- ✅ 正常完成 → 於 Step 6 後釋放
- ⚠️ 中途失敗（0-A / 0-B / 0-C 修不動、staging 出問題、deploy workflow 紅燈）→ 回報使用者後**仍要**釋放 lock，再等使用者指示
- ⛔ 使用者明確中止 → 釋放 lock

**NEVER** 讓鎖長期遺留；stale lock 雖然 30 分鐘後會自動清，但中間其他 session 要跑 /commit 會被卡住。
