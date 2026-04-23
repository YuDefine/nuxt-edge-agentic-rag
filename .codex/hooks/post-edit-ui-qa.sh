#!/usr/bin/env bash
# spectra-ux: AI Agent thin wrapper around ui-qa-reminder.sh
# Triggers on Edit|Write PostToolUse.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // ""' 2>/dev/null || echo "")

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

ROOT="${PROJECT_DIR:-$(pwd)}"
SCRIPT="$ROOT/scripts/spectra-ux/ui-qa-reminder.sh"

if [ -x "$SCRIPT" ]; then
  cd "$ROOT" && exec "$SCRIPT" "$FILE_PATH"
fi

exit 0
