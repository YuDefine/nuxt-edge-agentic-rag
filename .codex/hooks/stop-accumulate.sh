#!/usr/bin/env bash
# Stop hook: Compound Janitor — 評估 session 是否產出值得累積的知識

set -euo pipefail

INPUT=$(cat)
STOP_HOOK_ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || printf 'false')

# Stop hook 只應續跑一次；第二次 stop 時直接放行，避免無限 continuation loop。
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

ACTIVE_CHANGES=$(
  find openspec/changes -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
    | sed 's#/$##' \
    | xargs -n1 basename 2>/dev/null \
    | grep -v '^archive$' \
    | wc -l \
    | tr -d ' '
)

ACTIVE_CHANGE_LIST=$(
  find openspec/changes -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
    | sed 's#/$##' \
    | xargs -n1 basename 2>/dev/null \
    | grep -v '^archive$' \
    | awk 'BEGIN { first = 1 } { if (!first) printf(", "); printf("%s", $0); first = 0 } END { if (!first) printf("\n") }' \
    || true
)

if [ -z "$ACTIVE_CHANGE_LIST" ]; then
  ACTIVE_CHANGE_LIST="(none)"
fi

if git status --porcelain >/dev/null 2>&1 && [ -n "$(git status --porcelain)" ]; then
  DIRTY_WORKTREE=true
else
  DIRTY_WORKTREE=false
fi

MESSAGE=$(cat <<'PROMPT'
執行結束前 janitor，只做適用項，完成後直接結束：

1. 若本輪解了非 trivial 問題（3+ 嘗試、隱性限制、非直覺 root cause、workaround），搜尋並更新 `docs/solutions/`；schema 見 `docs/solutions/README.md`
2. 若本輪累積了可重用流程，再評估是否更新 skill
3. 交接檢查：
   - active_changes: __ACTIVE_CHANGES__
   - active_change_list: __ACTIVE_CHANGE_LIST__
   - dirty_worktree: __DIRTY_WORKTREE__
   - 若 active change 或 dirty worktree 存在，更新 `template/HANDOFF.md`；否則清理舊 handoff
PROMPT
)

MESSAGE=${MESSAGE/__ACTIVE_CHANGES__/$ACTIVE_CHANGES}
MESSAGE=${MESSAGE/__ACTIVE_CHANGE_LIST__/$ACTIVE_CHANGE_LIST}
MESSAGE=${MESSAGE/__DIRTY_WORKTREE__/$DIRTY_WORKTREE}

jq -n --arg reason "$MESSAGE" '{ decision: "block", reason: $reason }'
