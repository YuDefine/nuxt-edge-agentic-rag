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
# 三條 fail-open：沒有 flow.ts、node 不在、跑超過 15 秒，都靜默 exit 0。SessionStart hook
# 擋不住 session 才是它唯一不能做的事。
set -uo pipefail

# runner child 執行不了這些 action（見上）。印給它只會變成另一種底噪。
[ "${WORK_LOOP_RUNNER_CHILD:-}" = "1" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$ROOT" ] || exit 0

FLOW="$ROOT/vendor/scripts/flow/flow.ts"
[ -f "$FLOW" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

OUT=$(timeout 15 node "$FLOW" status --stalled 2>/dev/null)
STATUS=$?

# exit 3 是「有停滯」。0 = 乾淨、2 = 沒東西可看、124 = timeout、其餘 = 壞了：全部靜默。
# 只在有東西要人動的時候出聲，否則這行本身就變成下一個被學會跳過的區塊。
[ "$STATUS" -eq 3 ] || exit 0

printf '\n[clade flow] 這棵樹有停滯，沒人會自動處理：\n\n%s\n' "$OUT" >&2
printf '完整畫面與一鍵複製：review-gui /flow　·　待拍板走 /decisions\n\n' >&2
exit 0
