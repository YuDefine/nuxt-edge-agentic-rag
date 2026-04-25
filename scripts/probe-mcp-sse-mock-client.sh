#!/usr/bin/env bash
# wire-do-tool-dispatch §7.1 (b) — SSE-aware mock client probe
#
# 模擬 MCP client 對 stateful DO 的 SSE 行為，覆蓋 §5.x DO-internal spec
# 之外的「worker fetch → DO → SSE」整鏈：
#   1. POST initialize → 取 Mcp-Session-Id
#   2. POST notifications/initialized
#   3. GET /mcp (Accept: text/event-stream) → ReadableStream consume，
#      驗 200 + Content-Type + 收到 `: connected` frame
#   4. POST tools/list → 驗 4 個 knowledge tools
#   5. Close stream + reconnect with Last-Event-Id: e-99999 → 驗 server
#      接受 invalid Last-Event-Id 不 crash（events_dropped 或 empty）
#
# Auth: dev MCP Bearer token (mint via `pnpm mint:dev-mcp-token`)
# Target: localhost:3010 (stateful dev with NUXT_KNOWLEDGE_FEATURE_MCP_SESSION=true)

set -euo pipefail

URL="${MCP_URL:-http://localhost:3010/mcp}"
TOKEN="${MCP_TOKEN:?must set MCP_TOKEN}"

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

PASS_COUNT=0
FAIL_COUNT=0

check() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    green "✓ $label"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    red "✗ $label — expected '$expected', got '$actual'"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

contains() {
  local label="$1"
  local actual="$2"
  local needle="$3"
  if [[ "$actual" == *"$needle"* ]]; then
    green "✓ $label"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    red "✗ $label — '$needle' not in: $actual"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# ---------- Step 1: initialize ----------
blue "[1/5] POST initialize"
INIT_HEADERS=$(mktemp)
INIT_BODY=$(curl -s -D "$INIT_HEADERS" -o - \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -X POST "$URL" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"initialize",
    "params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe-mock-client","version":"0.1"}}
  }')
SID=$(grep -i '^mcp-session-id:' "$INIT_HEADERS" | awk '{print $2}' | tr -d '\r\n' || true)
INIT_STATUS=$(grep -E '^HTTP/' "$INIT_HEADERS" | tail -1 | awk '{print $2}')
check "initialize HTTP 200" "$INIT_STATUS" "200"
[[ -n "$SID" ]] && green "✓ Mcp-Session-Id present: $SID" && PASS_COUNT=$((PASS_COUNT + 1)) || { red "✗ Mcp-Session-Id missing"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# ---------- Step 2: notifications/initialized ----------
blue "[2/5] POST notifications/initialized"
INIT_NOTIFY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -X POST "$URL" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}')
check "notifications/initialized accepted (202)" "$INIT_NOTIFY_STATUS" "202"

# ---------- Step 3: GET /mcp SSE channel ----------
blue "[3/5] GET /mcp SSE channel — ReadableStream consume"
SSE_OUT=$(mktemp)
SSE_HEADERS=$(mktemp)
# Use curl --max-time to bound; -N for no-buffer; capture first ~2 seconds of stream
( curl -sN --max-time 3 -D "$SSE_HEADERS" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: text/event-stream" \
    -H "Mcp-Session-Id: $SID" \
    "$URL" > "$SSE_OUT" 2>&1 || true )

SSE_STATUS=$(grep -E '^HTTP/' "$SSE_HEADERS" | tail -1 | awk '{print $2}')
SSE_CT=$(grep -i '^content-type:' "$SSE_HEADERS" | head -1 | tr -d '\r\n')
check "GET /mcp HTTP 200" "$SSE_STATUS" "200"
contains "Content-Type: text/event-stream" "$SSE_CT" "text/event-stream"
contains "received initial ': connected' comment" "$(cat "$SSE_OUT")" ": connected"

# ---------- Step 4: tools/list ----------
blue "[4/5] POST tools/list — 驗 4 tools registered"
TOOLS_BODY=$(curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -X POST "$URL" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
TOOL_COUNT=$(echo "$TOOLS_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('result',{}).get('tools',[])))" 2>/dev/null || echo "0")
check "tools/list returned 4 tools" "$TOOL_COUNT" "4"

# ---------- Step 5: reconnect with invalid Last-Event-Id ----------
blue "[5/5] GET /mcp with Last-Event-Id: e-99999 — replay logic doesn't crash"
REPLAY_OUT=$(mktemp)
REPLAY_HEADERS=$(mktemp)
( curl -sN --max-time 3 -D "$REPLAY_HEADERS" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: text/event-stream" \
    -H "Mcp-Session-Id: $SID" \
    -H "Last-Event-Id: e-99999" \
    "$URL" > "$REPLAY_OUT" 2>&1 || true )
REPLAY_STATUS=$(grep -E '^HTTP/' "$REPLAY_HEADERS" | tail -1 | awk '{print $2}')
check "Reconnect HTTP 200 (Last-Event-Id replay tolerated)" "$REPLAY_STATUS" "200"
# DO 應 emit `events_dropped` notification 或 silently skip — 都算 PASS（不 crash）
REPLAY_BODY=$(cat "$REPLAY_OUT")
if [[ "$REPLAY_BODY" == *": connected"* ]] || [[ "$REPLAY_BODY" == *"events_dropped"* ]]; then
  green "✓ Reconnect produced graceful frame (connected or events_dropped)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  red "✗ Reconnect body unexpected: $REPLAY_BODY"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ---------- Summary ----------
echo
echo "============================================"
echo "PASS: $PASS_COUNT   FAIL: $FAIL_COUNT"
echo "============================================"

# Cleanup
rm -f "$INIT_HEADERS" "$SSE_OUT" "$SSE_HEADERS" "$REPLAY_OUT" "$REPLAY_HEADERS"

[[ $FAIL_COUNT -eq 0 ]] && exit 0 || exit 1
