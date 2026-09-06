# 2026-09-06 21:17 — backlog-cleanup 分支落地

## 背景

clade coordinator（w1V:pY）判定 `session/2026-09-06-1222-backlog-cleanup` 內容通過，
`verify-doc-drain.py` 報的 FAIL 是假陽性（TD-071 已合規 rotate 進
`docs/archives/tech-debt-closed-2026-09.md`）。blocker 是與 main 上未 commit WIP 重疊。

## WIP 歸屬判定（本 session 完成）

| 檔 | main WIP vs branch | 判定 |
| --- | --- | --- |
| `vite.config.ts` | **byte-identical** | 同一份改動。main HEAD 的 `./vendor/oxc-shared/preset.mts` 已不存在（只有 tracked 的 `preset.ts`）⇒ 這是修壞掉的 import，非風險改動。batch 的獨立 review 已逐項確認 |
| `.oxfmtignore` | **byte-identical** | 同一份改動 |
| `HANDOFF.md` | 真分歧：main WIP 多出 29 行「0-S UNSCANNED」段 | MUST 保留；branch 側刪的 10 條 heading 是已完成段落，SHA 零損失 |

main 另有 40 檔 parked WIP（2026-09-04 security-scan 配額卡住的批次，配額 2026-09-07 10:38 才重置）
⇒ NEVER 納入本次。

## 步驟

- [x] 重取基線：`batch refresh`（`69f79920` → `a0d70fa0`，seal 失效退回 review）
- [x] 0-C on main：`pnpm check` exit 1 / 13 warnings 0 errors，全部落在 untracked `e2e/screenshots/*.spec.ts`（parked WIP），本次 3 檔零 finding
- [x] main 側 WIP 歸屬 commit：`74d3db97` vite.config.ts / `dc4491d3` .oxfmtignore / `f583c767` HANDOFF 0-S 段
- [x] 另兩筆為跑品質鏈時暴露的根因：`78c86266` gitignore `.pi/`（0-A.1 exit 6 根因）、`d636e84b` oxfmt `extract-mutation-summary.mjs`（0-C format:check 擋住整條鏈）
- [x] batch refresh → 0-A.0 simplify（無修正）→ 0-A.1 第 2 輪 **No findings** → 0-C `pnpm check` / `pnpm test`（218 檔 1316 passed）/ `doctor`（100/100）全 exit 0 → 0-D 修 1 條 dangling 路徑 → seal → land `bdab3fbe`
- [x] `verify-doc-drain.py` 複量（base `69f799207` → `bdab3fbe`）：
  - HANDOFF unchecked 9→15、index rows 0→1、可解析 SHA 1→5（三項皆增加）
  - tech-debt unchecked 25→25、index rows 19→18、可解析 SHA 4→3
  - 掉的 index row 與 SHA 都是 TD-071 / `1896b929`，已 rotate；`git grep -c 1896b929 bdab3fbe -- docs/archives/` 命中 1
  - 工具仍報 FAIL：`headings` 是段落合併的假陽性，且它不掃 archive 檔（base 不存在 → skipped）
- [ ] **未 push** — `deploy-trigger-check.ts` 回 `verdict=needs-approval status=unconfirmable derived=ambiguous`，依 commit skill Step 6-B.0 需授權才可 `git push origin main`
