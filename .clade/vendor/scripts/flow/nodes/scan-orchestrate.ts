#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/scan-orchestrate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/scan-orchestrate.ts
// clade flow spine — scan-orchestrate (P1a)
//
// Thin wrapper around `handoff-scan.ts`, derived from `r78-scan.mjs` — the wrapper that got
// rewritten from scratch on r81 too. handoff-scan.ts itself is an informational scanner (exit 0
// unless CLI args are wrong; per-check failures land inside the JSON, not the exit code) and it
// exposes exactly two flags: `--cwd <consumer-root>` and `--json`. It has no notion of "mode" —
// it always runs its four fixed sections — so this node names its flag `--cwd` too, passed through as
// `--cwd`, the one flag that actually changes what gets scanned. `--args` exists for whatever
// flag handoff-scan grows next, so this node does not need editing to stay a thin wrapper.
//
// This node deliberately does NOT interpret the scan's JSON — that judgment belongs to the LLM
// / caller (handoff-scan.ts's own doc comment says the same about itself). Here we only run it,
// optionally persist the output, and report exit code + byte count.

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'

import { defineNode, fatal } from './lib/contract.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const HANDOFF_SCAN = resolve(SCRIPT_DIR, '../../handoff-scan.ts')

defineNode({
  name: 'scan-orchestrate',
  usage: `usage: scan-orchestrate [--cwd <consumer-root>] [--out <path>] [--args <string>]

Runs handoff-scan.ts --json. --cwd is passed straight through to handoff-scan (its only
scan-target flag); --args appends raw extra flags verbatim.
`,
  options: {
    cwd: { type: 'string' },
    out: { type: 'string' },
    args: { type: 'string' },
  },
  run(args) {
    const cliArgs = ['--experimental-strip-types', HANDOFF_SCAN, '--json']
    if (typeof args.cwd === 'string' && args.cwd.length > 0) {
      cliArgs.push('--cwd', args.cwd)
    }
    if (typeof args.args === 'string' && args.args.length > 0) {
      cliArgs.push(...args.args.split(' ').filter(Boolean))
    }

    const r = spawnSync('node', cliArgs, { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 })
    const exitCode = r.status ?? 1
    if (r.error) fatal(`failed to spawn handoff-scan.ts: ${r.error.message}`)
    // handoff-scan.ts only exits non-zero on CLI usage errors (its own doc comment: "Exit code
    // 永遠 0（informational scanner），除非 CLI 參數錯誤（exit 2）") — surface that verbatim
    // rather than re-deriving what non-zero means.
    if (exitCode !== 0)
      fatal(`handoff-scan.ts exited ${exitCode}: ${r.stderr.trim().slice(0, 2000)}`)

    let out: string | undefined
    if (typeof args.out === 'string' && args.out.length > 0) {
      mkdirSync(dirname(resolve(args.out)), { recursive: true })
      writeFileSync(args.out, r.stdout)
      out = args.out
    }

    return {
      summary: `scan-orchestrate: exit ${exitCode}, ${r.stdout.length} bytes${out ? ` -> ${out}` : ''}`,
      data: { exit_code: exitCode, out, bytes: r.stdout.length },
    }
  },
})
