#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/audit-assert.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/audit-assert.ts
// clade flow spine — audit-assert (P1a)
//
// Run an existing `scripts/audit-*.ts --json`, drill one field, compare it to a baseline.
// Derived from 8 baseline scripts, all shaped like `td406-timing.mjs`: run an audit, eyeball one
// number against a threshold. The recurring bug in that cluster wasn't the comparison — it was
// trusting a 0/empty result without ever having seen the same probe return non-zero. `--control`
// makes that a required second run rather than an assumption (contract.ts idiom 4).

import { execFileSync } from 'node:child_process'

import { defineNode, fatal, requireArg } from './lib/contract.ts'

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

function drill(value: Json, path: string[]): Json | undefined {
  let cur: Json | undefined = value
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, Json>)[seg]
  }
  return cur
}

function splitArgs(raw: string | undefined): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return []
  return raw.split(/\s+/).filter(Boolean)
}

function runAudit(script: string, extraArgs: string[], field: string): Json | undefined {
  let stdout: string
  try {
    stdout = execFileSync('node', [script, '--json', ...extraArgs], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string }
    fatal(
      `audit script failed: node ${script} --json ${extraArgs.join(' ')} :: ${(err.stderr ?? err.message).toString().trim()}`,
    )
  }
  let parsed: Json
  try {
    parsed = JSON.parse(stdout)
  } catch (e) {
    fatal(`audit script did not print JSON on --json: ${(e as Error).message}`)
  }
  return drill(parsed, field.split('.'))
}

function compare(actual: number, expect: number, op: 'eq' | 'lte' | 'gte'): boolean {
  if (op === 'eq') return actual === expect
  if (op === 'lte') return actual <= expect
  return actual >= expect
}

defineNode({
  name: 'audit-assert',
  usage: `usage: audit-assert --script <path> --field <a.b> --expect <value> --control <args>
                     [--args <args>] [--compare eq|lte|gte]

Runs \`node <script> --json <args>\`, drills --field, and compares it to --expect. --control
is required: the same script is re-run with different args known to change the result, and if
that run's field is identical to the primary run's, the assertion fails as a broken probe rather
than a passing/failing check — a 0/empty result proves nothing until the probe is known to be
capable of returning something else.

--args and --control values almost always start with "--" (they are the target script's own
flags) — node:util parseArgs treats a following token starting with "-" as ambiguous, so pass
them with "=": --control="--since 2020-01-01", not --control "--since 2020-01-01".
`,
  options: {
    script: { type: 'string' },
    args: { type: 'string' },
    field: { type: 'string' },
    expect: { type: 'string' },
    compare: { type: 'string', default: 'eq' },
    control: { type: 'string' },
  },
  run(args) {
    const script = requireArg(args, 'script')
    const field = requireArg(args, 'field')
    const expectRaw = requireArg(args, 'expect')
    const controlArgsRaw = args.control
    if (typeof controlArgsRaw !== 'string' || controlArgsRaw.length === 0) {
      fatal('--control is required (a known-different args set, per contract.ts idiom 4)')
    }
    const cmp = args.compare
    if (cmp !== 'eq' && cmp !== 'lte' && cmp !== 'gte') {
      fatal(`--compare must be eq|lte|gte, got "${String(cmp)}"`)
    }

    const primaryArgs = splitArgs(args.args as string | undefined)
    const controlArgs = splitArgs(controlArgsRaw)

    const actual = runAudit(script, primaryArgs, field)
    const controlActual = runAudit(script, controlArgs, field)

    if (JSON.stringify(actual) === JSON.stringify(controlActual)) {
      fatal(
        `control check failed: --control args produced the same "${field}" value (${JSON.stringify(controlActual)}) as the primary run — the probe has no discriminating power, not the assertion`,
      )
    }

    let expect: Json = expectRaw
    if (cmp !== 'eq' || /^-?\d+(\.\d+)?$/.test(expectRaw)) {
      const n = Number(expectRaw)
      if (Number.isFinite(n)) expect = n
    }

    let passed: boolean
    if (cmp === 'eq') {
      passed = JSON.stringify(actual) === JSON.stringify(expect)
    } else {
      if (typeof actual !== 'number' || typeof expect !== 'number') {
        fatal(
          `--compare ${cmp} requires numeric values; got actual=${JSON.stringify(actual)} expect=${JSON.stringify(expect)}`,
        )
      }
      passed = compare(actual, expect, cmp)
    }

    if (!passed) {
      fatal(
        `assertion failed: ${field} ${cmp} ${JSON.stringify(expect)} — actual ${JSON.stringify(actual)}`,
      )
    }

    return {
      summary: `${script} :: ${field} ${cmp} ${JSON.stringify(expect)} — actual ${JSON.stringify(actual)} (control ${JSON.stringify(controlActual)}) OK`,
      data: {
        script,
        field,
        expected: expect,
        actual,
        compare: cmp,
        control_actual: controlActual,
        passed: true,
      },
    }
  },
})
