#!/usr/bin/env bash
# Cleanup legacy per-document normalized-text R2 objects.
#
# Background:
#   pre-B3 sync flow wrote one large object per version at:
#     normalized/<env>/<documentId>/<versionId>.txt
#   B3 switched to per-chunk objects at:
#     normalized-text/<versionId>/<NNNN>.txt
#   The legacy objects under `normalized/` no longer carry chunk-level
#   customMetadata and should be removed so AutoRAG doesn't keep indexing
#   them without the required filter/citation attributes.
#
# This script only touches the `normalized/` prefix. It never touches
# `normalized-text/` (the new layout) or `staged/` (upload originals).
#
# Required environment variables (會自動從 .env 讀取 NUXT_KNOWLEDGE_UPLOADS_* 作為 fallback)：
#   CF_ACCOUNT_ID         Cloudflare account id (default: $NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID)
#   R2_ACCESS_KEY_ID      R2 S3 key (default: $NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID)
#   R2_SECRET_ACCESS_KEY  R2 S3 secret (default: $NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY)
#   R2_BUCKET_NAME        Target bucket (default: $NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME 或 agentic-rag-documents)
#
# Usage:
#   bash scripts/cleanup-legacy-normalized-r2.sh --dry-run   # 只列不刪
#   bash scripts/cleanup-legacy-normalized-r2.sh             # 刪除（會二次確認）

set -euo pipefail

MODE=${1:-}

# 從 .env 讀 fallback（若存在）
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${CF_ACCOUNT_ID:=${NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID:-}}"
: "${R2_ACCESS_KEY_ID:=${NUXT_KNOWLEDGE_UPLOADS_ACCESS_KEY_ID:-}}"
: "${R2_SECRET_ACCESS_KEY:=${NUXT_KNOWLEDGE_UPLOADS_SECRET_ACCESS_KEY:-}}"
: "${R2_BUCKET_NAME:=${NUXT_KNOWLEDGE_UPLOADS_BUCKET_NAME:-agentic-rag-documents}}"

: "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID is required (可以放 .env 的 NUXT_KNOWLEDGE_UPLOADS_ACCOUNT_ID)}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
: "${R2_BUCKET_NAME:?R2_BUCKET_NAME is required}"

if ! command -v aws >/dev/null 2>&1; then
  echo "錯誤：需要 aws CLI（brew install awscli）" >&2
  exit 1
fi

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto

ENDPOINT_URL="https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com"
LEGACY_PREFIX="normalized/"

echo "=== Bucket: ${R2_BUCKET_NAME}"
echo "=== Endpoint: ${ENDPOINT_URL}"
echo "=== Legacy prefix 檢查: s3://${R2_BUCKET_NAME}/${LEGACY_PREFIX}"
echo

LEGACY_LIST=$(aws s3 ls "s3://${R2_BUCKET_NAME}/${LEGACY_PREFIX}" \
  --endpoint-url "$ENDPOINT_URL" \
  --recursive || true)

if [ -z "$LEGACY_LIST" ]; then
  echo "legacy prefix 下沒有物件，無需清理。"
  exit 0
fi

echo "$LEGACY_LIST"
echo
LEGACY_COUNT=$(echo "$LEGACY_LIST" | wc -l | tr -d ' ')
echo "找到 ${LEGACY_COUNT} 個 legacy 物件。"

if [ "$MODE" = "--dry-run" ]; then
  echo "dry-run 模式：不執行實際刪除。"
  exit 0
fi

echo
read -r -p "確認要刪除上述所有 ${LEGACY_PREFIX} 物件？輸入 YES 以繼續：" confirm
if [ "$confirm" != "YES" ]; then
  echo "取消。"
  exit 1
fi

echo "=== 執行刪除 ==="
aws s3 rm "s3://${R2_BUCKET_NAME}/${LEGACY_PREFIX}" \
  --recursive \
  --endpoint-url "$ENDPOINT_URL"

echo
echo "=== 驗證 ==="
REMAINING=$(aws s3 ls "s3://${R2_BUCKET_NAME}/${LEGACY_PREFIX}" \
  --endpoint-url "$ENDPOINT_URL" \
  --recursive || true)
if [ -z "$REMAINING" ]; then
  echo "完成：legacy prefix 已清空。新 per-chunk 物件保留在 normalized-text/ prefix。"
else
  echo "警告：仍有殘留物件，請檢查權限："
  echo "$REMAINING"
  exit 1
fi
