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
      // test mock fallback intentionally uses `throw … return … as unknown as T`
      // for TS narrowing crutch (see test/integration/conversation-*.test.ts).
      // Downgrade until those mocks adopt Promise<never> return type — ~19 sites.
      'no-unreachable': 'warn',
    },
    ignorePatterns: [
      ...(lintBase.ignorePatterns ?? []),
      '.wrangler/',
      'local/',
      '.agent/skills/',
      '.github/skills/',
      'scripts/',
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
