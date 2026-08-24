#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/json-inspect.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/json-inspect.ts
// clade flow spine — json-inspect (P1a)
//
// Read a JSON file, drill a dot path, tally a field across an array, list outliers. Derived from
// 20 baseline scripts — the largest single cluster in `.clade/work-loop/` — most of which were a
// round spent guessing a JSON file's shape one `console.log(Object.keys(...))` at a time
// (`r80-svsum.mjs`, `r74-scan-summary.mjs`). The recurring judgment call in that cluster was
// "which entries are NOT the passing/zero case" — that is `--outlier`, not a generic filter.

import { readFileSync } from 'node:fs'

import { defineNode, fatal, nothingToShow, requireArg } from './lib/contract.ts'

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

/** Drill a dot path (numeric segments index into arrays). Fatal, with the available keys at the
 * point of failure — the baseline scripts' actual bottleneck was guessing shape one probe at a
 * time; printing the failing level's keys collapses that to one round trip. */
function drill(value: Json, path: string[], walked: string[]): Json {
  if (path.length === 0) return value
  const [seg, ...rest] = path
  if (Array.isArray(value)) {
    const idx = Number(seg)
    if (!Number.isInteger(idx) || idx < 0 || idx >= value.length) {
      fatal(
        `--path segment "${seg}" is not a valid index at ${walked.join('.') || '(root)'} (array length ${value.length})`,
      )
    }
    return drill(value[idx], rest, [...walked, seg])
  }
  if (value !== null && typeof value === 'object') {
    if (!(seg in value)) {
      fatal(
        `--path segment "${seg}" not found at ${walked.join('.') || '(root)'}; available keys: ${Object.keys(value).join(', ') || '(none)'}`,
      )
    }
    return drill((value as Record<string, Json>)[seg], rest, [...walked, seg])
  }
  fatal(`--path segment "${seg}" cannot descend into scalar at ${walked.join('.') || '(root)'}`)
}

function fieldOf(el: Json, field: string): Json | undefined {
  let cur: Json | undefined = el
  for (const seg of field.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, Json>)[seg]
  }
  return cur
}

defineNode({
  name: 'json-inspect',
  usage: `usage: json-inspect --file <path> [--path <a.b.0.c>] [--tally <field>]
                     [--outlier <field=value>] [--max <n>]

Drill a JSON file by dot path, then optionally tally a field across an array or list the
elements whose field does NOT equal a given value.
`,
  options: {
    file: { type: 'string' },
    path: { type: 'string' },
    tally: { type: 'string' },
    outlier: { type: 'string' },
    max: { type: 'string', default: '20' },
  },
  run(args) {
    const filePath = requireArg(args, 'file')
    let root: Json
    try {
      root = JSON.parse(readFileSync(filePath, 'utf8'))
    } catch (e) {
      fatal(`cannot read/parse ${filePath}: ${(e as Error).message}`)
    }

    const pathArg = args.path
    const path = typeof pathArg === 'string' && pathArg.length > 0 ? pathArg.split('.') : []
    const target = drill(root, path, [])

    const max = Number(args.max)
    if (!Number.isFinite(max) || max < 0) fatal(`--max is not a valid number: ${String(args.max)}`)

    const kind: 'array' | 'object' | 'scalar' = Array.isArray(target)
      ? 'array'
      : target !== null && typeof target === 'object'
        ? 'object'
        : 'scalar'
    const count =
      kind === 'array'
        ? (target as Json[]).length
        : kind === 'object'
          ? Object.keys(target as object).length
          : 1

    if (kind === 'array' && (target as Json[]).length === 0) {
      nothingToShow(`--path ${pathArg ?? '(root)'} resolved to an empty array`)
    }

    let tally: Record<string, number> | undefined
    const tallyField = args.tally
    if (typeof tallyField === 'string' && tallyField.length > 0) {
      if (kind !== 'array') fatal(`--tally requires --path to resolve to an array, got ${kind}`)
      tally = {}
      for (const el of target as Json[]) {
        const v = fieldOf(el, tallyField)
        const key = v === undefined ? '(missing)' : JSON.stringify(v)
        tally[key] = (tally[key] ?? 0) + 1
      }
      if (Object.keys(tally).length === 0) nothingToShow(`--tally ${tallyField} matched nothing`)
    }

    let outliers: Json[] | undefined
    let truncated = false
    const outlierArg = args.outlier
    if (typeof outlierArg === 'string' && outlierArg.length > 0) {
      if (kind !== 'array') fatal(`--outlier requires --path to resolve to an array, got ${kind}`)
      const eq = outlierArg.indexOf('=')
      if (eq < 0) fatal(`--outlier must be field=value, got "${outlierArg}"`)
      const field = outlierArg.slice(0, eq)
      const wantRaw = outlierArg.slice(eq + 1)
      const all = (target as Json[]).filter((el) => {
        const v = fieldOf(el, field)
        return JSON.stringify(v) !== JSON.stringify(wantRaw) && String(v) !== wantRaw
      })
      truncated = all.length > max
      outliers = all.slice(0, max)
    }

    return {
      summary: `${filePath}${pathArg ? ` :: ${pathArg}` : ''} — ${kind}, count=${count}${
        tally ? `, tally keys=${Object.keys(tally).length}` : ''
      }${outliers ? `, outliers=${outliers.length}${truncated ? ' (truncated)' : ''}` : ''}`,
      data: { path: pathArg ?? '', kind, count, tally, outliers, truncated },
    }
  },
})
