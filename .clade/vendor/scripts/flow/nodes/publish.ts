#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/publish.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/publish.ts
// clade flow spine — publish (P2)
//
// A thin wrapper around `scripts/publish.ts`, not a reimplementation of it: the gate order and the
// dirty-tree handling in that script change every few versions, and a second copy would be wrong
// within a release. This node adds exactly one thing — the runner-child guard becomes a *state*.
//
// §11.2 of tasks/2026-08-24-flow-spine.md promised that. Today the guard is a tripwire: an
// unattended round that reaches publish gets exit 2 and a message nobody is watching, so the work
// stops silently and the only trace is a wakeup somebody scheduled. Returning `blocked` puts it on
// the graph instead — a work item that reads "awaiting attended session" and shows up in
// `flow status --stalled`, which is what feeds the \\my "human gate" bucket.
//
// The guard here does NOT replace the one inside publish.ts. That one is the boundary; this one
// makes the boundary legible, and it fires first only so the reason is recorded as blocked rather
// than as an exit-2 failure.

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { blocked, defineNode, fatal } from './lib/contract.ts'

export const RUNNER_CHILD_ENV = 'WORK_LOOP_RUNNER_CHILD'

defineNode({
  name: 'publish',
  usage: `usage: publish --bump <patch|minor|major> [--repo <path>] [--args <string>]

Runs \`node scripts/publish.ts <bump>\`. Under ${RUNNER_CHILD_ENV}=1 it returns BLOCKED (exit 3)
without running anything: publish is attended-only, and that wait belongs on the graph.
`,
  options: {
    bump: { type: 'string' },
    repo: { type: 'string', default: '.' },
    args: { type: 'string' },
  },
  run(args) {
    const repo = typeof args.repo === 'string' && args.repo.length > 0 ? args.repo : '.'
    const bump = typeof args.bump === 'string' ? args.bump : ''
    if (!['patch', 'minor', 'major'].includes(bump)) {
      fatal('--bump must be one of patch|minor|major')
    }
    if (process.env[RUNNER_CHILD_ENV] === '1') {
      blocked(
        'awaiting-attended: publish is attended-only, and this round is a work-loop runner child. ' +
          'An attended session has to run it (see clade-role-and-todo-discipline.md § 動作層才是真邊界).',
      )
    }

    const extra =
      typeof args.args === 'string' && args.args.length > 0
        ? args.args.split(' ').filter(Boolean)
        : []
    const start = Date.now()
    const r = spawnSync(process.execPath, [join(repo, 'scripts', 'publish.ts'), bump, ...extra], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const durationMs = Date.now() - start
    if (r.error) fatal(`failed to spawn publish.ts: ${r.error.message}`)
    const exitCode = r.status ?? 1
    if (exitCode !== 0) {
      const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-40).join('\n')
      fatal(`publish failed (exit ${exitCode}) after ${durationMs}ms:\n${tail}`)
    }
    return {
      summary: `publish ${bump} succeeded in ${durationMs}ms`,
      data: { bump, exit_code: exitCode, duration_ms: durationMs },
    }
  },
})
