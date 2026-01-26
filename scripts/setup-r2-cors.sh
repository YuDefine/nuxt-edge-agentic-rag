#!/bin/bash
# 套用 r2-cors.json 到 R2 bucket
#
# 用法：
#   ./scripts/setup-r2-cors.sh [bucket-name]
#
# 預設 bucket 名稱為 .env 的 NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME。
# 允許的 origins 定義在 r2-cors.json — 修改該檔後執行此腳本以同步。

set -euo pipefail

CONFIG_FILE="r2-cors.json"
BUCKET="${1:-}"

if [ -z "$BUCKET" ]; then
  if [ -f .env ]; then
    BUCKET=$(grep '^NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME=' .env | cut -d= -f2-)
  fi
fi

if [ -z "$BUCKET" ]; then
  echo "❌ 未指定 bucket，且 .env 無 NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME" >&2
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ 找不到 $CONFIG_FILE" >&2
  exit 1
fi

echo "▶ Applying $CONFIG_FILE → bucket $BUCKET"
pnpm exec wrangler r2 bucket cors set "$BUCKET" --file "$CONFIG_FILE" --force

echo "✅ CORS 設定已同步"
echo ""
pnpm exec wrangler r2 bucket cors list "$BUCKET"
