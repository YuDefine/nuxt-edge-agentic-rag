#!/usr/bin/env bash

set -euo pipefail

# Parse NUL-delimited git output into arrays. Avoids bash 4+ `mapfile` so this
# script also runs on macOS's bundled bash 3.2.
lint_targets=()
typecheck_targets=()

while IFS= read -r -d '' file; do
  [[ -f "$file" ]] || continue

  case "$file" in
    *.js | *.ts | *.vue)
      lint_targets+=("$file")
      ;;
  esac

  case "$file" in
    *.ts | *.mts | *.cts | *.tsx | *.vue)
      typecheck_targets+=("$file")
      ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACM -z)

if ((${#lint_targets[@]} > 0)); then
  echo "🔍 執行 VitePlus staged lint..."
  pnpm exec vp lint --fix --no-error-on-unmatched-pattern "${lint_targets[@]}"

  echo "🎨 執行 VitePlus staged format..."
  pnpm exec vp fmt --no-error-on-unmatched-pattern "${lint_targets[@]}"

  git add -- "${lint_targets[@]}"
fi

if ((${#typecheck_targets[@]} > 0)); then
  echo "🔍 執行 Nuxt typecheck..."
  pnpm exec nuxt typecheck
fi
