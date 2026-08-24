# Flow node library v1

一支 node 是一個普通 CLI：`node vendor/scripts/flow/nodes/<name>.ts [--flags]`。直接呼叫合法，
只是不會出現在圖上；經 `flow run <spec.json>` 或 `flow step <node>` 呼叫才會記 span。

**這批節點的選材是實測的，不是推想的。** 把 `.clade/work-loop/` 的 88 支 ad-hoc `.mjs` 逐一讀完分群後，
前 9 支各自對應一個真實存在的群（`registry.json` 的 `coverage` 記著每支從幾份語料長出來）。
後 4 支覆蓋數是 0，收進來的理由不同：它們把 rules 裡的操作型條文降格成 pre/postcondition。

## 四條契約（每支節點都適用）

這四條是從語料裡提煉的——是那 88 支**做對的時候**做對了什麼，從慣例升格成 code。
`lib/contract.ts` 提供對應 helper，**NEVER** 自己重寫一份。

1. **定位靠內容錨點，NEVER 靠行號。** `oversize-r76.mjs` 的註解逐字寫著「NEVER 憑行號盲改」，
   然後 hardcode 了行號。`docs/tech-debt.md` 是熱檔，任何併發編輯都讓那些數字失效，而失效時
   它不會報錯——它會切在錯的位置。helper：`markdownSections` / `trimSeparatorTail`。
2. **zero-loss verify。** 任何搬移或切分之後重讀兩邊，逐段 assert 原文仍在。`r107-rotate.mjs`
   改印行數差——行數對得上完全不代表內容對得上。helper：`assertZeroLoss`。
3. **missing-id fail-fast。** 請求的 id 有一個找不到就 exit 1 印 FATAL，**NEVER** 靜默跳過，
   而且一次report全部的缺項。helper：`assertAllFound`。
4. **known-positive control。** 回 0／回空的門檻檢查在沒有 control 之前不可信——它與「探針本身壞了」
   事後不可區分。`audit-assert` 與 `transcript-scan` 把 control 做成**必填參數**，不是選填。

## 節點

| node | 取代的語料群 | 覆蓋 |
| --- | --- | --- |
| `td-rotate` | TD 條目 byte-exact 搬進 archive | 7 |
| `td-inject` | 條目內 idempotent 插入區塊 | 2 |
| `td-register-scan` | `docs/tech-debt.md` 的結構化過濾 | 6 |
| `state-patch-write` | `state.json` 的 read-merge-write-verify | 16 |
| `json-inspect` | 鑽 key path、tally、列 outlier | 20 |
| `audit-assert` | 跑 audit script 比對欄位對基線 | 8 |
| `git-provenance` | land 了沒／是不是祖先／自某時起改了什麼 | 4 |
| `transcript-scan` | session jsonl 的 cutoff + regex 走訪 | 6 |
| `scan-orchestrate` | `handoff-scan.ts` 的 wrapper | 3 |
| `commit-only` | `git commit --only` + 三層 verify | — |
| `worktree-open` | worktree 開工判定 | — |
| `worktree-close` | 五欄 lifecycle gate | — |
| `vp-check` | `vp check` 當 gate | — |
| `publish` | `scripts/publish.ts` 的 wrapper；runner child 下回 blocked | — |
| `propagate` | `scripts/propagate.ts` 的 wrapper；runner child 下回 blocked | — |

## 加一支新節點

1. `lib/contract.ts` 的 `defineNode` 建立，四條契約照用
2. 進 `registry.json` 的 `nodes`，`coverage` 誠實填——**0 就寫 0**，那不是缺點，是選材理由不同
3. 補測試進 `test/flow-nodes-*.test.ts`：正常路徑、fail-fast 回 exit 1、`nothingToShow` 回 exit 2
4. 測試 **MUST** 帶 hermetic `CLADE_FLOW_EVENTS`。P0 踩過：fixture 事件寫進 repo 真正的
   `.clade/flow/events.jsonl`，而且是掛在一個真實 work item 底下

## 節點 NEVER 做的事

- **NEVER 自己 emit span。** engine 負責包 —— 節點自己記會讓直接呼叫與經 engine 呼叫產生兩種 span 形狀
- **NEVER 接受行號當定位參數**（契約 1）
- **NEVER 做條件分支式的「聰明」判斷。** 判斷力留給 agent；節點只保證「做了什麼、結果是什麼」
  被結構化記下來。engine 同理：serial / parallel / retry / on-fail 就是全部的語言

## 沒有合用的節點時

`node vendor/scripts/flow/flow.ts step <label> -- <你的指令>` —— 包一層讓它上圖，**不必**先為它造一支節點。

這條路存在是為了讓「沒有節點合用」與「這件工作沒發生」在圖上分得出來。少了它，`audit-flow-nodes.ts`
建議的「沒有一個合用就說出來」會把說出來的那件工作變成隱形的，而 library 量到的就只剩自己的採用率。

**NEVER** 為了讓某件工作上圖而硬造一支只用一次的節點——那是把 `r<N>-*.mjs` 換個目錄重演一次。
同一形狀重複出現三次以上才值得收成節點（前 9 支的 coverage 就是這樣算出來的）。

## 這個 library 的成敗判準

P1 的驗收判準逐字是「連續 5 個 loop round 零新增 `r<N>-*.mjs`」。量測工具是
`node scripts/audit-flow-nodes.ts`（warn-only，永遠 exit 0）。

**降幅不成立就是選材沒切中真實需求，MUST 停下重看，NEVER 加強制。** 在這裡加 gate 會把
「節點不合用」變成「agent 找到繞過 gate 的方法」，訊號安靜下來但問題留著。
