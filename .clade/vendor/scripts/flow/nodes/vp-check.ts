#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/vp-check.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/vp-check.ts
// clade flow spine — vp-check (P1a)
//
// `pnpm check` (== `vp check`, per package.json's "check" script) as a gate node — every flow
// that ends in a commit or publish needs this to pass first. Runs the real check rather than
// re-implementing any of its lint/format rules; a node here would drift from `vite.config.ts`
// the moment either changed.

import { spawnSync } from 'node:child_process'

import { defineNode, fatal } from './lib/contract.ts'

defineNode({
  name: 'vp-check',
  usage: `usage: vp-check [--repo <path>] [--args <string>]

Runs \`pnpm check\` (vp check). Non-zero exit is FATAL with the last 40 lines of stderr.
`,
  options: {
    repo: { type: 'string', default: '.' },
    args: { type: 'string' },
  },
  run(args) {
    const repo = typeof args.repo === 'string' && args.repo.length > 0 ? args.repo : '.'
    const extra =
      typeof args.args === 'string' && args.args.length > 0
        ? args.args.split(' ').filter(Boolean)
        : []

    const pnpmArgs = ['run', 'check', ...(extra.length > 0 ? ['--', ...extra] : [])]
    const start = Date.now()
    const r = spawnSync('pnpm', pnpmArgs, { cwd: repo, encoding: 'utf8' })
    const durationMs = Date.now() - start
    if (r.error) fatal(`failed to spawn pnpm run check: ${r.error.message}`)

    const exitCode = r.status ?? 1
    if (exitCode !== 0) {
      const tail =
        r.stderr.trim().split('\n').slice(-40).join('\n') ||
        r.stdout.trim().split('\n').slice(-40).join('\n')
      fatal(`vp check failed (exit ${exitCode}) in ${durationMs}ms:\n${tail}`)
    }

    return {
      summary: `vp check passed in ${durationMs}ms`,
      data: { exit_code: exitCode, duration_ms: durationMs },
    }
  },
})
