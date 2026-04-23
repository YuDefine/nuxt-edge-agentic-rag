#!/usr/bin/env bash
# PostToolUse hook: Bash 指令失敗時建議使用 spectra-debug
# 過濾掉 git/pnpm check 等預期可能失敗的指令

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")
EXIT_CODE=$(
  printf '%s' "$INPUT" | jq -r '
    def tool_response_object:
      if (.tool_response | type) == "string" then
        (.tool_response | fromjson? // {})
      elif (.tool_response | type) == "object" then
        .tool_response
      else
        {}
      end;

    tool_response_object.exit_code // 0
  ' 2>/dev/null || echo "0"
)

# 只在非零 exit code 時觸發
if [ "$EXIT_CODE" = "0" ] || [ "$EXIT_CODE" = "null" ]; then
  exit 0
fi

# 排除預期可能失敗的指令（check/lint/test 的失敗是正常流程）
if echo "$CMD" | grep -qE '^(git diff|git status|git log|git show|pnpm check|pnpm lint|pnpm format|pnpm typecheck|pnpm test|pnpm audit:ux-drift|pnpm spectra:roadmap|grep|find|ls|cat|which|spectra|rg)'; then
  exit 0
fi

# 排除簡單的 command not found
if [ "$EXIT_CODE" = "127" ]; then
  exit 0
fi

# 每小時最多提醒一次（per-project marker）
MARKER="/tmp/nuxt-starter-debug-reminder-$(date +%Y%m%d%H)"
if [ -f "$MARKER" ]; then
  exit 0
fi
touch "$MARKER"

printf -v REASON '[Auto-Harness] 指令執行失敗（exit code: %s）。如果這不是預期的失敗，使用 /spectra-debug 進行系統性排查（四階段：觀察 → 假設 → 驗證 → 修復）。' "$EXIT_CODE"

printf '%s\n' "$REASON" >&2

exit 0
