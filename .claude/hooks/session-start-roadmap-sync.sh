#!/usr/bin/env bash
# spectra-ux: Claude Code SessionStart hook — re-sync openspec/ROADMAP.md at
# the start of every session so the agent sees the latest view of in-flight
# spectra work before its first tool call. This is the last line of defense:
# if hooks fire midway (PostToolUse) were missed because /assign delegated
# work to an external runtime (Codex / Copilot / Claude native subagent),
# SessionStart catches up.
#
# v1.6+: script always does a full sync (no mtime fast path). Still fast
# (< 100ms on typical trees). MANUAL-block drift detection runs on every
# invocation and surfaces warnings to stderr so Claude sees stale claims
# (archived-as-active / td-status-mismatch / version-mismatch) at session
# start — stdout is discarded, stderr is preserved.
#
# All business logic lives in scripts/spectra-ux/roadmap-sync.mts.

set -euo pipefail

ROOT="${SPECTRA_UX_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
SCRIPT="$ROOT/scripts/spectra-ux/roadmap-sync.mts"

if [ ! -f "$SCRIPT" ]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

# stdout → /dev/null (normal status line is noise); stderr passes through
# so MANUAL drift warnings reach the agent.
cd "$ROOT" && node "$SCRIPT" >/dev/null || true

exit 0
