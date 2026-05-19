import { defineConfig } from 'vite-plus'
import { fmtBase, lintBase } from './vendor/oxc-shared/preset.mjs'

export default defineConfig({
  test: {
    globals: true,
    exclude: ['e2e/**', 'node_modules/**', '.nuxt/**', '.output/**'],
    coverage: {
      provider: 'v8',
    },
  },
  lint: {
    ...lintBase,
    rules: {
      ...lintBase.rules,
      'no-console': 'warn',
      'import/no-named-as-default': 'off',
      'unicorn/no-thenable': 'off',
      // 19 處 test mock fallback 原本用 `throw … return … as unknown as T` TS narrowing
      // crutch 已逐個移除 dead return (modern TS narrows throw 為 never，不需 explicit return)。
      // 對齊 clade preset no-unreachable: 'error' 嚴格門檻。
    },
    ignorePatterns: [
      ...(lintBase.ignorePatterns ?? []),
      '.wrangler/',
      'local/',
      '.agent/skills/',
      '.github/skills/',
      'scripts/',
      'build/',
    ],
  },
  fmt: {
    ...fmtBase,
    experimentalTailwindcss: {
      stylesheet: './app/assets/css/main.css',
      attributes: ['class'],
      functions: [],
      preserveDuplicates: false,
      preserveWhitespace: false,
    },
    ignorePatterns: [
      ...fmtBase.ignorePatterns,
      'dist/**',
      'node_modules/**',
      'local/**',
      '.agent/',
      '.agents/',
      '.codex/',
      '.claude/skills/',
      '.github/skills/',
    ],
  },
  staged: {
    '*.{js,ts,vue}': ['vp lint --fix', 'vp fmt'],
    '*.md': ['vp fmt'],
  },
})
