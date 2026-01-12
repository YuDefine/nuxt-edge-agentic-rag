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
echo "📦 Onmax Nuxt Skills..."
for skill in nuxthub vueuse reka-ui motion nuxt-better-auth; do
  npx skills add onmax/nuxt-skills@$skill $COPY_FLAGS
done
echo "  ✓ Onmax Nuxt Skills 完成"
echo ""

# 官方 Skills
echo "📦 官方 Skills..."
npx skills add nuxt/ui $COPY_FLAGS
echo "  ✓ 官方 Skills 完成"
echo ""

# TDD
echo "📦 TDD Skill..."
npx skills add obra/superpowers@test-driven-development $COPY_FLAGS
echo "  ✓ TDD Skill 完成"
echo ""

# Evlog
echo "📦 Evlog Skills..."
npx skills add hugorcd/evlog@review-logging-patterns $COPY_FLAGS
echo "  ✓ Evlog Skills 完成"
echo ""

# Impeccable Design Skills（pbakaus/impeccable）
echo "📦 Impeccable Design Skills..."
for skill in adapt animate arrange audit bolder clarify colorize critique delight distill extract frontend-design harden normalize onboard optimize overdrive polish quieter teach-impeccable typeset; do
  npx skills add pbakaus/impeccable@$skill $COPY_FLAGS
done
echo "  ✓ Impeccable Design Skills 完成"
echo ""
echo "📝 注意：design orchestrator 為手動管理，位於 .claude/skills/design/"
echo ""

echo "✅ 所有 skills 安裝完成！"
echo ""
echo "💡 提示："
echo "  - 查看已安裝：pnpm skills:list"
echo "  - 重新安裝/更新：pnpm skills:install（本腳本）"
echo "  - 重啟 Claude Code CLI 以載入變更"
