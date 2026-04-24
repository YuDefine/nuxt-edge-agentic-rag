#!/usr/bin/env bash
# PreToolUse:Skill hook —— 攔截 /spectra-commit（本專案已停用）
#
# 理由：/commit 封裝了品質閘門（0-A simplify + code-review、0-B design review、
# 0-C pnpm check、版本號升級、tag push）；spectra-commit 會繞過全部閘門。
# SKILL.md 檔屬 spectra 管轄會被自動更新覆蓋，無法直接改；改用 harness hook 攔截。

set -euo pipefail

input=$(cat)

skill=""
if command -v jq >/dev/null 2>&1; then
  skill=$(printf '%s' "$input" | jq -r '.tool_input.skill // ""' 2>/dev/null || printf '')
fi

if [ "$skill" = "spectra-commit" ]; then
  cat >&2 <<'EOF'
⛔ /spectra-commit 在本專案已停用（.claude/rules/commit.md）

品質閘門（0-A simplify + code-review、0-B design review、0-C pnpm check、
schema 同步、版本號升級、tag push）只在 /commit 跑；spectra-commit 會繞過全部。

改用：
  /commit 只 commit <change-name> 相關檔案

/commit 的 Step 2 分組會依 $ARGUMENTS 限定檔案範圍；使用者若真的需要限定某個
spectra change，在 argument 裡寫「只 commit openspec/changes/<name>/ 與該 change
觸動的實作檔」即可。
EOF
  exit 2
fi

exit 0
