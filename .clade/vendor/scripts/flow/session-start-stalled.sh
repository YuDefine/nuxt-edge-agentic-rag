#!/usr/bin/env bash
# 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/session-start-stalled.sh · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/session-start-stalled.sh
#
# clade — SessionStart: 把 flow 的停滯清單印進 session 開頭。
#
# 為什麼是 hook 而不是「記得去看 /flow」：`flow status --stalled` 早就 exit 3、早就端出可直接
# 跑的 action，缺的從來不是判準，是**消費端** —— 沒有任何本來就會被 invoke 的入口順路讀到它。
# 2026-08-27 實測：/flow 上掛著 67.3 小時與 33.6 小時的 unharvested pane、兩條 28.9 小時的待
# 拍板，全部附了正確指令，全部沒人動。停滯的存活時間等於「下一次有人想到要開那一頁」。
#
# 掛在 SessionStart 之後，那個上限變成「下一個 attended session 開啟」。挑 attended 而非
# runner child 的理由是動作本身：reclaim / adjudicate / 回答拍板都只有人在場時做得掉，印給
# 一個 `claude --print` 看只是把同一份文字寫進沒人讀的地方。
#
# 三條 fail-open：沒有 flow.ts、node 不在、跑超過各自的 timeout，都靜默 exit 0。SessionStart
# hook 擋不住 session 才是它唯一不能做的事。
#
# 本檔共三次 node spawn，timeout 相加 MUST ≤ settings.json 給這支的 20 秒（現為 5 + 10 + 4
# = 19）。**加第四次呼叫時 MUST 重新配這個和**，NEVER 只給新的那次一個 timeout 就收工——
# 超過預算時被砍的不是新加的那一支，是整個 hook，三段訊號一起消失。
#
# 整支實測（2026-08-28，本機）：worktree spine 0.63 秒、clade home 1.4 MB / 5.3k 事件 spine
# 0.53 秒——三次 spawn 全部走完的 wall time，不是單支。預算的 19 秒是最壞情況的上限。
set -uo pipefail

# runner child 執行不了這些 action（見上）。印給它只會變成另一種底噪。
[ "${WORK_LOOP_RUNNER_CHILD:-}" = "1" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$ROOT" ] || exit 0

FLOW="$ROOT/vendor/scripts/flow/flow.ts"
[ -f "$FLOW" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

# --- board 一行：**MUST 在下面的治理軌跡 stamp 之前取值** -----------------------
#
# 順序是這一行的正確性本身，不是風格。下面那個 stamp 會往 spine 寫一筆事件，而
# `renderOverview` 對「一筆治理事件、零件工作」與「一件都沒有」給的是兩種輸出：前者是一行
# 全 0 的 board，後者是 `flow: no events on the spine`。stamp 之後才讀，就永遠讀不到後者——
# 空 spine 會被自己的遙測填成「board 上有 0 件」，而那兩件事對讀的人意思完全不同：
# 一個是「你沒有待辦」，一個是「這裡量不到東西」。
#
# 2026-08-28 實測：對空 spine 跑一次 `transcript-summary.ts session` 後事件數 1，
# 同一支 `flow brief` 的第一行由 `flow: no events on the spine` 變成
# `board: 待你 0 · 受阻 0 · 進行中 0 · 擱置 0 · 已收 0`。
#
# **NEVER 改成「印之前再取一次」**：那會把這個順序依賴變成隱形的，下一個在中間插入寫入動作
# 的人不會知道自己弄壞了什麼。取值與印出分開，中間那段就是刻意的。
#
# **NEVER 在這裡注入完整 brief**：那份輸出數十行、每個 session 都付一次，而 session 開頭要的
# 只是一個「要不要展開」的數字。展開的入口寫在同一行裡。
#
# 取 `flow brief` 的第一行——它本來就是 `board: 待你 N · 受阻 N · …`（renderOverview 產）。
# **NEVER 自己從 --json 重算一份 counts**：第二份推導就是第二塊板子，兩塊板子會漂。
#
# 4 秒 timeout（預算 5 + 10 + 4 = 19 ≤ settings.json 給的 20）。2026-08-28 實測，clade home
# 1.4 MB / 5.3k 事件的 spine 連跑三次：0.08 / 0.12 / 0.11 秒；worktree 冷路徑（含 node 啟動
# 與 ownership 掃描）0.35 秒。最壞情況 4 秒有 10 倍以上餘裕。
BOARD=$(timeout 4 node "$FLOW" brief 2>/dev/null | head -1)

# --- 治理軌跡（見 rules/core/flow-work-tracking.md § 治理軌跡） -----------------
#
# 兩件事共用這一次 node spawn：session 開場 stamp（clade_version + rule bundle 指紋——只有此刻
# 量得到，transcript 永遠不會有它），以及 transcript 的增量 sweep。掛在**這支既有 script 內部**
# 是刻意的：`.claude/settings.json` 零改動 → 不觸 attended-only 邊界，也不必等 attended 窗口。
#
# 全程靜默、全程 fail-open：它是 telemetry，NEVER 有權讓 session start 慢下來或失敗。
TS="$ROOT/vendor/scripts/flow/transcript-summary.ts"
if [ -f "$TS" ]; then
  # SessionStart hook 的 stdin 是一份帶 session_id 的 JSON。拿不到就只 sweep 不 stamp——
  # 沒有 session id 的 stamp 沒有 join 鍵，寫出去也沒有讀端能用它。
  HOOK_INPUT=''
  [ -t 0 ] || HOOK_INPUT=$(timeout 2 cat 2>/dev/null || true)
  SID=$(printf '%s' "$HOOK_INPUT" |
    sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([0-9a-zA-Z-]\{1,128\}\)".*/\1/p' | head -1)
  # 5 秒而非 8：這支與下面的 `flow status`、`flow brief` 共用 settings.json 給的 20 秒 hook
  # 預算（5 + 10 + 4 = 19）。舊版的 8 + 15 = 23 已經超過預算，加第三次呼叫前先把總和壓回來——
  # 超過預算不是某一支被砍，是 hook 整支被砍，三段訊號一起消失。
  # 冷路徑實測 25 檔約 0.6 秒，5 秒仍是 8 倍餘裕不是門檻。
  if [ -n "$SID" ]; then
    (cd "$ROOT" && timeout 5 node "$TS" session --session-id "$SID" >/dev/null 2>&1) || true
  else
    (cd "$ROOT" && timeout 5 node "$TS" session >/dev/null 2>&1) || true
  fi
fi

# 10 秒而非 15：見上方預算算式。1.4 MB spine 實測 0.5 秒。
OUT=$(timeout 10 node "$FLOW" status --stalled 2>/dev/null)
STATUS=$?

# exit 3 是「有停滯」。0 = 乾淨、2 = 沒東西可看、124 = timeout、其餘 = 壞了：全部靜默。
# 只在有東西要人動的時候出聲，否則這行本身就變成下一個被學會跳過的區塊。
if [ "$STATUS" -eq 3 ]; then
  printf '\n[clade flow] 這棵樹有停滯，沒人會自動處理：\n\n%s\n' "$OUT" >&2
  printf '完整畫面與一鍵複製：review-gui /flow　·　待拍板走 /decisions\n\n' >&2
fi

# --- board 一行（每次都印，刻意不綁 exit 3） ---------------------------------
#
# 上面的停滯區塊只在有停滯時出聲；這一行相反。兩者答的是不同的問題：停滯區塊答「有什麼壞了」，
# board 答「現在有幾件事在等你」——後者在一切正常時仍是 session 開頭最該知道的數字，而
# 「一切正常」正是沒有人會想到去開那一頁的那一天。
#
# 取不到數字時靜默：半殘的一行（`board:` 後面空的、或 timeout 截斷的半句）比沒有更糟——
# 它看起來像 board 上真的沒東西。`case` 的前綴比對就是那道 gate，它同時擋掉
# `flow: no events on the spine`（空 spine 的正當輸出，不是失敗）。
# BOARD 在本檔上方、stamp 之前就取好了——見那裡的順序說明。
case "$BOARD" in
  board:*) printf '[clade flow] %s — 跑 `flow brief` 看全景\n\n' "$BOARD" >&2 ;;
esac
exit 0
