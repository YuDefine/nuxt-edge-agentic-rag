#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/propagate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/propagate.ts
// clade flow spine — propagate (P2)
//
// Same shape and same reason as `publish.ts` next door, and both are needed rather than one: publish
// and propagate are two independent entry points to a fleet-wide effect, so guarding only the first
// would leave "content already in main, pushed out by propagate" entirely unguarded.
//
// This is a wrapper, never a reimplementation. `scripts/propagate.ts` owns every decision about
// consumers, stashes and partial commits; the node adds the blocked state and nothing else — which
// is also why it does not touch that script and therefore does not trip the three-question gate in
// .claude/rules/local/propagate-maintenance-mode.md (that gate governs growing the machinery itself).

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { journalArtifacts } from './lib/artifacts.ts'
import { blocked, defineNode, fatal } from './lib/contract.ts'

const RUNNER_CHILD_ENV = 'WORK_LOOP_RUNNER_CHILD'

defineNode({
  name: 'propagate',
  usage: `usage: propagate [--repo <path>] [--canary <consumer>] [--args <string>]

Runs \`node scripts/propagate.ts\`. Under ${RUNNER_CHILD_ENV}=1 it returns BLOCKED (exit 3) without
running anything: propagation is attended-only, and that wait belongs on the graph.
`,
  options: {
    repo: { type: 'string', default: '.' },
    canary: { type: 'string' },
    args: { type: 'string' },
  },
  run(args) {
    const repo = typeof args.repo === 'string' && args.repo.length > 0 ? args.repo : '.'
    if (process.env[RUNNER_CHILD_ENV] === '1') {
      blocked(
        'awaiting-attended: propagate is attended-only, and this round is a work-loop runner child. ' +
          'An attended session has to run it (see clade-role-and-todo-discipline.md § 動作層才是真邊界).',
      )
    }

    const flags = [
      ...(typeof args.canary === 'string' && args.canary.length > 0
        ? ['--canary', args.canary]
        : []),
      ...(typeof args.args === 'string' && args.args.length > 0
        ? args.args.split(' ').filter(Boolean)
        : []),
    ]
    const start = Date.now()
    const r = spawnSync(process.execPath, [join(repo, 'scripts', 'propagate.ts'), ...flags], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const durationMs = Date.now() - start
    if (r.error) fatal(`failed to spawn propagate.ts: ${r.error.message}`)
    const exitCode = r.status ?? 1
    if (exitCode !== 0) {
      const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-40).join('\n')
      fatal(`propagate failed (exit ${exitCode}) after ${durationMs}ms:\n${tail}`)
    }
    // Where the delivery actually landed, one coordinate per consumer. Read out of the journal
    // `propagate.ts` already writes (`.git/.clade-propagate/v<version>/<consumer>.json`) rather
    // than scraped from its log: the journal is the same record `--resume` trusts, so an artifact
    // that disagrees with it would be a second, weaker copy of the truth.
    //
    // Best-effort throughout — propagation already succeeded by this point, and a missing
    // coordinate NEVER turns a delivered fleet into a failed node.
    const artifacts = journalArtifacts(repo)

    return {
      summary: `propagate finished in ${durationMs}ms${artifacts.length > 0 ? `, ${artifacts.length} consumer(s) recorded` : ''}`,
      data: {
        exit_code: exitCode,
        duration_ms: durationMs,
        canary: args.canary ?? null,
        artifacts,
      },
    }
  },
})
