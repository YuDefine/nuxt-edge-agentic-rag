#!/usr/bin/env bash
set -euo pipefail

# 本地 CI + Migration + Deploy 腳本
# 之後會遷移到 GitHub Action，現階段手動跑。
#
# Usage:
#   ./scripts/deploy.sh                 # 完整流程
#   ./scripts/deploy.sh --skip-check    # 跳過 pnpm check（趕時間用）
#   ./scripts/deploy.sh --skip-migrate  # 跳過 D1 migration
#   ./scripts/deploy.sh --dry-run       # 只印出會做什麼

SKIP_CHECK=0
SKIP_MIGRATE=0
DRY_RUN=0
DB_NAME="agentic-rag-db"

for arg in "$@"; do
  case "$arg" in
    --skip-check)   SKIP_CHECK=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --dry-run)      DRY_RUN=1 ;;
    -h|--help)
      sed -n '3,11p' "$0"
      exit 0
      ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

color() { printf '\033[%sm%s\033[0m' "$1" "$2"; }
stage() { echo; color "1;36" "▶ $1"; echo; }
ok()    { color "1;32" "✔ $1"; echo; }
warn()  { color "1;33" "⚠ $1"; echo; }
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    color "2" "DRY: $*"; echo
  else
    echo "$ $*"
    "$@"
  fi
}

# -------- 0. Preflight --------
stage "0. Preflight"

if ! command -v wrangler >/dev/null; then
  echo "wrangler 未安裝"; exit 1
fi
if ! wrangler whoami >/dev/null 2>&1; then
  echo "wrangler 未登入 — 請先跑 wrangler login"; exit 1
fi

CURRENT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

echo "  Branch:   $BRANCH"
echo "  Commit:   $CURRENT_SHA"
echo "  Dirty:    $DIRTY file(s)"
if [[ "$DIRTY" != "0" ]]; then
  warn "有未 commit 的變更，deploy 後這些變更也會一起生效"
fi
ok "Preflight"

# -------- 1. Check (lint + typecheck + test) --------
if [[ $SKIP_CHECK -eq 0 ]]; then
  stage "1. pnpm check (lint + typecheck + test)"
  run pnpm check
  ok "Check passed"
else
  warn "Skipping pnpm check (--skip-check)"
fi

# -------- 2. Build --------
stage "2. pnpm build"
run pnpm build
ok "Build passed"

# -------- 3. D1 Migration (remote) --------
if [[ $SKIP_MIGRATE -eq 0 ]]; then
  stage "3. D1 migrations apply ($DB_NAME, --remote)"
  if [[ $DRY_RUN -eq 1 ]]; then
    color "2" "DRY: wrangler d1 migrations list $DB_NAME --remote"; echo
    wrangler d1 migrations list "$DB_NAME" --remote
  else
    wrangler d1 migrations apply "$DB_NAME" --remote
  fi
  ok "Migrations applied"
else
  warn "Skipping D1 migration (--skip-migrate)"
fi

# -------- 4. Deploy Worker --------
stage "4. wrangler deploy"
if [[ $DRY_RUN -eq 1 ]]; then
  color "2" "DRY: cd .output && wrangler deploy"; echo
else
  (cd .output && wrangler deploy)
fi
ok "Deployed"

# -------- 5. Summary --------
stage "Summary"
echo "  Branch:   $BRANCH"
echo "  Commit:   $CURRENT_SHA"
echo "  Database: $DB_NAME (remote)"
echo "  URL:      https://agentic.yudefine.com.tw"
ok "Done"
