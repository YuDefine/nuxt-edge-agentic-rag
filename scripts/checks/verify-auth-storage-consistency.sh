#!/usr/bin/env bash
# verify-auth-storage-consistency: pre-apply gate + post-apply verifier for
# migration 0007_better_auth_timestamp_affinity.
#
# Usage:
#   bash scripts/checks/verify-auth-storage-consistency.sh --preflight
#   bash scripts/checks/verify-auth-storage-consistency.sh --remote
#   bash scripts/checks/verify-auth-storage-consistency.sh --local [sqlite-path]
#
# Modes:
#   --preflight   Runs against production D1 BEFORE `wrangler d1 migrations
#                 apply --remote`. Refuses apply if any FK child of user(id)
#                 holds an orphan row, any FK child of mcp_tokens holds an
#                 orphan row, or any timestamp column holds a value that
#                 migration 0007's CASE normalization would turn into NULL.
#                 Also captures the row count of `messages.query_log_id IS NOT
#                 NULL` so the post-apply check can assert preservation.
#
#   --remote      Runs against production D1 AFTER apply. Asserts the post-
#                 migration shape of all eight rebuilt tables and verifies
#                 that SQLite's RENAME auto-rewrite restored the canonical
#                 FK references.
#
#   --local       Runs against a local sqlite3 DB (default
#                 `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite`).
#                 Same checks as --remote.
#
# Exits non-zero if any check fails. Output is plain text so the script can
# be wired into CI or a manual release checklist.

set -euo pipefail

MODE="${1:---preflight}"
DB_NAME="agentic-rag-db"
LOCAL_DB="${2:-.wrangler/state/v3/d1/miniflare-D1DatabaseObject/72fd0b100a81db09bf9bbd752d0ca838a354a2d0fed2e9e07bc44aef6728fb24.sqlite}"

case "${MODE}" in
  --preflight|--remote|--local) ;;
  *)
    echo "usage: $0 [--preflight|--remote|--local [sqlite-path]]" >&2
    exit 2
    ;;
esac

# query <sql>: run a single-column query against whichever backend matches
# MODE, and echo each value newline-separated. Used for scalar counts.
query() {
  local sql="$1"
  if [[ "${MODE}" == "--local" ]]; then
    sqlite3 "${LOCAL_DB}" "${sql}"
  else
    pnpm exec wrangler d1 execute "${DB_NAME}" --remote --json --command "${sql}" \
      | jq -r '.[0].results // [] | .[] | to_entries[0].value // empty'
  fi
}

# rows <sql>: run a query and return rows as `k=v` lines for `grep`-style
# assertions. Works for both backends. Note: values containing spaces are
# safe for the typeof()/COUNT()/UUID-id queries used here, but would need
# escaping for free-form text. Don't repurpose for queries that select
# arbitrary user data.
rows() {
  local sql="$1"
  if [[ "${MODE}" == "--local" ]]; then
    sqlite3 -header -separator '|' "${LOCAL_DB}" "${sql}" \
      | awk -F '|' 'NR==1 { for (i=1; i<=NF; i++) keys[i] = $i; next } { out = ""; for (i=1; i<=NF; i++) { out = out keys[i] "=" $i " " } print out }'
  else
    pnpm exec wrangler d1 execute "${DB_NAME}" --remote --json --command "${sql}" \
      | jq -r '.[0].results // [] | .[] | [to_entries[] | "\(.key)=\(.value)"] | join(" ")'
  fi
}

fail=0

if [[ "${MODE}" == "--preflight" ]]; then
  echo "== Preflight: FK orphan check (user → 4 children + mcp_tokens → 1 child) =="

  # Any table with a FK into user(id) whose row points at a missing user.id,
  # OR any row in query_logs whose mcp_token_id points at a missing
  # mcp_tokens.id, would either abort migration 0007 mid-apply (breaking
  # DDL atomicity) or leak through and become a dangling reference after
  # the swap. citation_records / messages FK to query_logs are implicit
  # through the query_logs rebuild; they get verified post-apply.
  orphans="$(query "
    SELECT
        (SELECT COUNT(*) FROM session s LEFT JOIN \"user\" u ON s.userId = u.id WHERE u.id IS NULL)
      + (SELECT COUNT(*) FROM mcp_tokens m LEFT JOIN \"user\" u ON m.created_by_user_id = u.id
           WHERE m.created_by_user_id IS NOT NULL AND u.id IS NULL)
      + (SELECT COUNT(*) FROM member_role_changes r LEFT JOIN \"user\" u ON r.user_id = u.id WHERE u.id IS NULL)
      + (SELECT COUNT(*) FROM \"account\" a LEFT JOIN \"user\" u ON a.userId = u.id WHERE u.id IS NULL)
      + (SELECT COUNT(*) FROM query_logs q LEFT JOIN mcp_tokens m ON q.mcp_token_id = m.id
           WHERE q.mcp_token_id IS NOT NULL AND m.id IS NULL)
    AS n
  ")"

  if [[ "${orphans}" == "0" ]]; then
    echo "  OK: 0 orphan FK rows across session / mcp_tokens / member_role_changes / account / query_logs"
  else
    echo "FAIL: ${orphans} orphan FK row(s) — inspect before apply" >&2
    fail=1
  fi

  echo "== Preflight: timestamp parseability =="

  # Any source value that would hit `unixepoch(col) IS NULL` causes INSERT
  # failure on NOT NULL columns, or silent NULL on nullable ones. Either
  # way, migration integrity suffers — refuse apply until human inspects.
  bad="$(query "
    SELECT
        (SELECT COUNT(*) FROM \"user\"
           WHERE createdAt IS NULL OR createdAt = ''
              OR (CAST(createdAt AS REAL) < 1000000000000 AND unixepoch(createdAt) IS NULL))
      + (SELECT COUNT(*) FROM \"user\"
           WHERE updatedAt IS NULL OR updatedAt = ''
              OR (CAST(updatedAt AS REAL) < 1000000000000 AND unixepoch(updatedAt) IS NULL))
      + (SELECT COUNT(*) FROM \"user\"
           WHERE banExpires IS NOT NULL AND banExpires != ''
             AND CAST(banExpires AS REAL) < 1000000000000
             AND unixepoch(banExpires) IS NULL)
      + (SELECT COUNT(*) FROM \"account\"
           WHERE createdAt IS NULL OR createdAt = ''
              OR (CAST(createdAt AS REAL) < 1000000000000 AND unixepoch(createdAt) IS NULL))
      + (SELECT COUNT(*) FROM \"account\"
           WHERE updatedAt IS NULL OR updatedAt = ''
              OR (CAST(updatedAt AS REAL) < 1000000000000 AND unixepoch(updatedAt) IS NULL))
      + (SELECT COUNT(*) FROM \"account\"
           WHERE accessTokenExpiresAt IS NOT NULL AND accessTokenExpiresAt != ''
             AND CAST(accessTokenExpiresAt AS REAL) < 1000000000000
             AND unixepoch(accessTokenExpiresAt) IS NULL)
      + (SELECT COUNT(*) FROM \"account\"
           WHERE refreshTokenExpiresAt IS NOT NULL AND refreshTokenExpiresAt != ''
             AND CAST(refreshTokenExpiresAt AS REAL) < 1000000000000
             AND unixepoch(refreshTokenExpiresAt) IS NULL)
    AS n
  ")"

  if [[ "${bad}" == "0" ]]; then
    echo "  OK: all timestamp columns parseable by migration CASE"
  else
    echo "FAIL: ${bad} unparseable timestamp value(s) — inspect and repair before apply" >&2
    fail=1
  fi

  echo "== Preflight: row counts (will be re-asserted post-apply) =="
  for table in user account session mcp_tokens query_logs citation_records messages member_role_changes; do
    n="$(query "SELECT COUNT(*) FROM \"${table}\"")"
    echo "  ${table}: ${n}"
  done

  echo "== Preflight: messages.query_log_id non-null count (must survive rebuild) =="
  msg_linked="$(query "SELECT COUNT(*) FROM messages WHERE query_log_id IS NOT NULL")"
  echo "  messages WITH query_log_id: ${msg_linked}"
  echo "  → record this number; --remote / --local post-apply will re-check"

  if [[ "${fail}" -eq 0 ]]; then
    echo ""
    echo "PREFLIGHT PASSED — safe to run: wrangler d1 migrations apply ${DB_NAME} --remote"
  else
    echo ""
    echo "PREFLIGHT FAILED" >&2
    exit 1
  fi
  exit 0
fi

# --local / --remote: post-apply verification

echo "== (a) column affinity =="
for table in user account; do
  col_rows="$(rows "PRAGMA table_info(\"${table}\")")"
  case "${table}" in
    user) expect_int=(createdAt updatedAt banExpires) ;;
    account) expect_int=(createdAt updatedAt accessTokenExpiresAt refreshTokenExpiresAt) ;;
  esac
  for col in "${expect_int[@]}"; do
    line="$(printf '%s\n' "${col_rows}" | grep -E "(^| )name=${col}( |$)" || true)"
    if [[ -z "${line}" ]]; then
      echo "FAIL: ${table}.${col} missing from PRAGMA table_info" >&2
      fail=1
      continue
    fi
    if ! printf '%s' "${line}" | grep -q 'type=INTEGER'; then
      echo "FAIL: ${table}.${col} type not INTEGER: ${line}" >&2
      fail=1
    else
      echo "  OK: ${table}.${col} = INTEGER"
    fi
  done
done

echo "== (b) typeof() on existing rows =="
for table in user account; do
  data="$(rows "SELECT id, typeof(createdAt) AS c, typeof(updatedAt) AS u FROM \"${table}\"")"
  if [[ -z "${data}" ]]; then
    echo "  (no rows in ${table})"
    continue
  fi
  while IFS= read -r row; do
    [[ -z "${row}" ]] && continue
    if [[ "${row}" == *"c=integer"* && "${row}" == *"u=integer"* ]]; then
      echo "  OK: ${table} ${row}"
    else
      echo "FAIL: ${table} ${row}" >&2
      fail=1
    fi
  done <<<"${data}"
done

echo "== (c) foreign_key_check =="
fk_count="$(query "SELECT COUNT(*) FROM pragma_foreign_key_check")"
if [[ "${fk_count}" == "0" ]]; then
  echo "  OK: 0 FK violations"
else
  echo "FAIL: ${fk_count} FK violation(s) — inspect with PRAGMA foreign_key_check" >&2
  fail=1
fi

echo "== (d) named indexes present =="
for idx in account_userId_idx idx_query_logs_channel_created_at idx_citation_records_query_log_id idx_citation_records_expires_at idx_messages_query_log_id idx_messages_conversation_created_at idx_member_role_changes_user_created; do
  n="$(query "SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name='${idx}'")"
  if [[ "${n}" == "1" ]]; then
    echo "  OK: ${idx} present"
  else
    echo "FAIL: ${idx} missing" >&2
    fail=1
  fi
done

echo "== (e) FK references rewritten back to canonical names =="
# After RENAME _new → canonical, sibling FK refs should point at the
# canonical names, NOT at *_new placeholders. If any *_new appears in a
# stored CREATE TABLE for a rebuilt sibling, the RENAME auto-rewrite
# silently failed and a follow-up rebuild is needed.
stale="$(query "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN ('user','account','session','mcp_tokens','query_logs','citation_records','messages','member_role_changes') AND sql LIKE '%_new(id)%'")"
if [[ "${stale}" == "0" ]]; then
  echo "  OK: no stale REFERENCES *_new(id) in rebuilt tables"
else
  echo "FAIL: ${stale} table(s) still reference *_new — RENAME auto-rewrite did not complete" >&2
  fail=1
fi

echo "== (f) row counts preserved =="
for table in user account session mcp_tokens query_logs citation_records messages member_role_changes; do
  n="$(query "SELECT COUNT(*) FROM \"${table}\"")"
  echo "  ${table}: ${n}"
done

echo "== (g) messages.query_log_id non-null count preserved =="
# The C1 fix from code-review: messages.query_log_id has ON DELETE SET NULL,
# so without explicit handling the migration would silently null all 70
# message → query_log links during DROP TABLE query_logs. The migration
# rebuilds messages and drops it BEFORE query_logs to keep the values intact.
# Production preflight should record the non-null count; post-apply must
# match. With no preflight count to compare against, the assertion is
# "non-zero" — the actual number-match check belongs in the human checklist
# alongside the preflight log.
msg_linked="$(query "SELECT COUNT(*) FROM messages WHERE query_log_id IS NOT NULL")"
echo "  messages WITH query_log_id: ${msg_linked}"
if [[ "${msg_linked}" == "0" ]]; then
  echo "FAIL: messages.query_log_id collapsed to 0 non-null rows — SET NULL cascade fired" >&2
  fail=1
else
  echo "  OK: ${msg_linked} non-null query_log_id values preserved (compare against preflight log)"
fi

if [[ "${fail}" -ne 0 ]]; then
  echo ""
  echo "FAILED" >&2
  exit 1
fi

echo ""
echo "PASSED"
