#!/bin/bash

# Skills 安裝／更新腳本（由 scaffold 依選擇的功能自動產生）
# 統一使用 --agent claude-code --copy：直接寫入 .claude/skills/，不建立 symlink
# 重複執行會覆寫為最新版（等同 update）
# 產生日期：2026-04-15

set -e

cd "$(dirname "$0")/.."

COPY_FLAGS="--agent claude-code --copy -y"

echo "🚀 開始安裝 skills（--copy 模式，直接寫入 .claude/skills/）..."
echo ""

# Antfu Skills
echo "📦 Antfu Skills..."
for skill in nuxt vue vitest vue-best-practices vue-testing-best-practices vueuse-functions pinia vitepress; do
  npx skills add antfu/skills@$skill $COPY_FLAGS
done
echo "  ✓ Antfu Skills 完成"
echo ""

# Onmax Nuxt Skills
# onmax/nuxt-skills@vueuse 已於上游下架（2026-08-02 實測 npx skills add 列不到），
# 故從清單移除。VueUse 的 composable 參考仍由 antfu/skills@vueuse-functions 提供。
echo "📦 Onmax Nuxt Skills..."
for skill in nuxthub reka-ui motion; do
  npx skills add onmax/nuxt-skills@$skill $COPY_FLAGS
done
echo "  ✓ Onmax Nuxt Skills 完成"
echo ""

# 官方 Skills
echo "📦 官方 Skills..."
npx skills add nuxt/ui $COPY_FLAGS
echo "  ✓ 官方 Skills 完成"
echo ""

# Better Auth 官方 Skills
echo "📦 Better Auth 官方 Skills..."
npx skills add better-auth/skills@better-auth-best-practices $COPY_FLAGS
npx skills add better-auth/skills@better-auth-security-best-practices $COPY_FLAGS
echo "  ✓ Better Auth 官方 Skills 完成"
echo ""

# Cloudflare Skills
echo "📦 Cloudflare Skills..."
npx skills add cloudflare/skills@wrangler $COPY_FLAGS
npx skills add cloudflare/skills@workers-best-practices $COPY_FLAGS
npx skills add cloudflare/skills@durable-objects $COPY_FLAGS
npx skills add cloudflare/skills@agents-sdk $COPY_FLAGS
echo "  ✓ Cloudflare Skills 完成"
echo ""

# TDD
echo "📦 TDD Skill..."
npx skills add obra/superpowers@test-driven-development $COPY_FLAGS
echo "  ✓ TDD Skill 完成"
echo ""

# Playwright
echo "📦 Playwright 最佳實踐 Skill..."
npx skills add currents-dev/playwright-best-practices-skill $COPY_FLAGS
echo "  ✓ Playwright 最佳實踐 Skill 完成"
echo ""

# Zod
echo "📦 Zod Skill..."
npx skills add pproenca/dot-skills@zod $COPY_FLAGS
echo "  ✓ Zod Skill 完成"
echo ""

# Evlog
echo "📦 Evlog Skills..."
npx skills add https://www.evlog.dev $COPY_FLAGS
echo "  ✓ Evlog Skills 完成"
echo ""

# Impeccable Design Skill（pbakaus/impeccable — 單一 skill 含 23 sub-command；目前 v4.1.1）
echo "📦 Impeccable Design Skill..."
npx skills add pbakaus/impeccable $COPY_FLAGS
echo "  ✓ Impeccable Design Skill 完成"
echo ""

# 清理 v2.x deprecated sub-skill 目錄（v4 已把所有 sub-command 合併入單一 skill）
DEPRECATED_DIR="$(pwd)/.claude/skills"
for legacy in adapt animate arrange audit bolder clarify colorize critique delight distill extract frontend-design harden layout normalize onboard optimize overdrive polish quieter shape teach-impeccable typeset; do
  if [ -d "$DEPRECATED_DIR/$legacy" ] && grep -qi impeccable "$DEPRECATED_DIR/$legacy/SKILL.md" 2>/dev/null; then
    echo "🧹 移除 v2 deprecated：$legacy"
    rm -rf "$DEPRECATED_DIR/$legacy"
  fi
done
echo ""
echo "📝 注意：design orchestrator 為手動管理，位於 .claude/skills/design/"
echo ""

# Modern Web Guidance（Chrome team / Baseline-aware）
# 對應 clade ~/.claude/rules/modern-web-mcp.md + vendor/snippets/modern-web-guidance/README.md
echo "📦 Modern Web Guidance Skill..."
npx skills add GoogleChrome/modern-web-guidance@modern-web-guidance $COPY_FLAGS
echo "  ✓ Modern Web Guidance 完成"
echo ""

echo "✅ 所有 skills 安裝完成！"
echo ""
echo "💡 提示："
echo "  - 查看已安裝：pnpm skills:list"
echo "  - 重新安裝/更新：pnpm skills:install（本腳本）"
echo "  - 重啟 Claude Code CLI 以載入變更"
