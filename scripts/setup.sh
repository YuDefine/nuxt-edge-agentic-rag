#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo ""
echo "🚀 nuxt-edge-agentic-rag — 環境初始化"
echo "========================================"
echo ""

if [ -f .scaffold-cleanup ]; then
  CLEANUP_PATH=$(cat .scaffold-cleanup)
  if [ -n "$CLEANUP_PATH" ] && [ -d "$CLEANUP_PATH" ]; then
    echo "🧹 清除暫存的 starter repo..."
    rm -rf "$CLEANUP_PATH"
    echo "✅ 暫存 repo 已刪除：$CLEANUP_PATH"
    echo ""
  fi
  rm -f .scaffold-cleanup
fi

has_pkg() { grep -q "\"$1\"" package.json 2>/dev/null; }

echo "📋 檢查前置需求..."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "❌ 找不到 Node.js，請先安裝 Node.js 18 以上版本（建議 24 LTS）"
  echo "   https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 版本過低：$(node -v)（需要 v18 以上，建議 v24 LTS）"
  echo "   請升級 Node.js：https://nodejs.org/"
  exit 1
fi
echo "✅ Node.js $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ 找不到 pnpm，請先安裝："
  echo "   corepack enable && corepack prepare pnpm@latest --activate"
  exit 1
fi
echo "✅ pnpm $(pnpm -v)"
echo ""

echo "📦 安裝專案依賴..."
pnpm install
echo ""

if [ -f .env ]; then
  echo "ℹ️  .env 已存在，保留現有設定"
elif [ -f .env.example ]; then
  cp .env.example .env
  echo "✅ 已從 .env.example 複製 .env"
else
  echo "⚠️  找不到 .env.example，請手動建立 .env"
fi
echo ""

ensure_secret() {
  local key="$1"
  local value

  if [ ! -f .env ] || ! grep -q "^${key}=" .env 2>/dev/null; then
    return 0
  fi

  value=$(grep "^${key}=" .env 2>/dev/null | cut -d'=' -f2-)
  if [ -n "$value" ]; then
    return 0
  fi

  value=$(openssl rand -base64 32)
  sed -i.bak "s|^${key}=$|${key}=${value}|" .env && rm -f .env.bak
  echo "  ✅ ${key} 已自動產生"
}

if [ -f .env ]; then
  echo "🔑 檢查 .env secrets..."
  ensure_secret "BETTER_AUTH_SECRET"
  ensure_secret "NUXT_SESSION_PASSWORD"
  echo ""

  echo "📋 檢查 .env 設定..."
  ENV_WARNINGS=()

  check_env() {
    local key="$1"
    local desc="$2"
    local val
    val=$(grep "^${key}=" .env 2>/dev/null | cut -d'=' -f2-)
    if [ -z "$val" ] || [[ "$val" == *"<"* ]]; then
      ENV_WARNINGS+=("  ⚠️  ${key} — ${desc}")
    fi
  }

  check_env "BETTER_AUTH_SECRET" "Better Auth secret（openssl rand -base64 32）"
  check_env "NUXT_SESSION_PASSWORD" "Session secret（openssl rand -base64 32）"

  if [ ${#ENV_WARNINGS[@]} -gt 0 ]; then
    echo ""
    echo "⚠️  以下環境變數需要手動設定："
    printf '%s\n' "${ENV_WARNINGS[@]}"
    echo ""
    echo "  編輯 .env 檔案填入實際值。"
  else
    echo "✅ 所有必要環境變數已設定"
  fi
  echo ""
fi

echo "========================================"
echo "✅ 環境初始化完成！"
echo "========================================"
echo ""
echo "已啟用的功能："
echo "  ✅ Nuxt 4 + Vue 3 + TypeScript"
echo "  ✅ Tailwind CSS + Nuxt UI"
echo "  ✅ Better Auth"
echo "  ✅ Pinia + Pinia Colada（狀態管理）"

has_pkg "@sentry/nuxt" && echo "  ✅ Sentry（錯誤追蹤）"
has_pkg "@nuxthub/core" && echo "  ✅ NuxtHub（Cloudflare Workers）"
has_pkg "nuxt-charts" && echo "  ✅ Nuxt Charts"
has_pkg "@playwright/test" && echo "  ✅ Playwright（E2E 測試）"

echo ""
echo "接下來："
echo "  pnpm dev    # 啟動開發伺服器"
echo ""
