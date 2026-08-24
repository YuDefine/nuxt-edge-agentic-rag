#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/transcript-scan.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/transcript-scan.ts
// clade flow spine — transcript-scan (P1a)
//
// Walk Claude session `.jsonl` transcripts under a cutoff, optionally match a regex per line and
// extract a field from matching lines. Derived from 6 baseline scripts (`r72-corpus.mjs`,
// `td406-parent-dispatch.mjs`), both of which walked `~/.claude/projects` by hand every round.
// `--control-since` is contract.ts idiom 4 applied to a directory walk instead of a threshold
// check: zero matches only means "nothing happened" once the same walk is shown, in the same
// run, that an earlier cutoff does find files — otherwise zero is indistinguishable from a
// walk that is silently broken (wrong root, cutoff parsed wrong, etc).
//
// Deliberately synchronous and per-file: `defineNode`'s `run` is sync, and reading one file at a
// time (rather than concatenating the corpus into one buffer) is what keeps memory bounded when
// a project directory holds hundreds of multi-megabyte transcripts.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { defineNode, fatal, nothingToShow, requireArg } from './lib/contract.ts'

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

function drill(value: Json, path: string[]): Json | undefined {
  let cur: Json | undefined = value
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, Json>)[seg]
  }
  return cur
}

function parseCutoff(raw: string, flag: string): number {
  const t = Date.parse(raw)
  if (Number.isNaN(t)) fatal(`${flag} is not a parseable date: "${raw}"`)
  return t
}

interface WalkResult {
  filesScanned: number
  linesMatched: number
  samples: { file: string; line: number; text: string; extracted?: Json }[]
}

/** Walk `root` recursively, visiting every `*.jsonl` file newer than `cutoffMs`. Each file is
 * read and processed independently — never concatenated — so memory stays bounded regardless of
 * corpus size. */
function walk(
  root: string,
  cutoffMs: number,
  match: RegExp | null,
  field: string[] | null,
  max: number,
): WalkResult {
  const out: WalkResult = { filesScanned: 0, linesMatched: 0, samples: [] }
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(p)
        continue
      }
      if (!e.name.endsWith('.jsonl')) continue
      let mtimeMs: number
      try {
        mtimeMs = statSync(p).mtimeMs
      } catch {
        continue
      }
      if (mtimeMs < cutoffMs) continue
      out.filesScanned++

      let raw: string
      try {
        raw = readFileSync(p, 'utf8')
      } catch {
        continue
      }
      const lines = raw.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line) continue
        if (match && !match.test(line)) continue
        out.linesMatched++
        if (out.samples.length >= max) continue
        let extracted: Json | undefined
        if (field) {
          try {
            extracted = drill(JSON.parse(line), field)
          } catch {
            extracted = undefined
          }
        }
        out.samples.push({ file: p, line: i + 1, text: line.slice(0, 200), extracted })
      }
    }
  }
  return out
}

defineNode({
  name: 'transcript-scan',
  usage: `usage: transcript-scan --since <ISO|YYYY-MM-DD> --control-since <ISO|YYYY-MM-DD>
                       [--root <dir>] [--match <regex>] [--field <a.b>] [--max <n>]

Walks Claude session *.jsonl files under --root modified at/after --since. --control-since is a
required earlier cutoff known to include files, run in the same invocation, so a zero-match
result can be trusted rather than mistaken for a broken walk.
`,
  options: {
    root: { type: 'string', default: join(homedir(), '.claude', 'projects') },
    since: { type: 'string' },
    'control-since': { type: 'string' },
    match: { type: 'string' },
    field: { type: 'string' },
    max: { type: 'string', default: '50' },
  },
  run(args) {
    const root = requireArg(args, 'root')
    const since = requireArg(args, 'since')
    const controlSince = requireArg(args, 'control-since')
    const max = Number(args.max)
    if (!Number.isFinite(max) || max < 0) fatal(`--max is not a valid number: ${String(args.max)}`)

    let match: RegExp | null = null
    const matchRaw = args.match
    if (typeof matchRaw === 'string' && matchRaw.length > 0) {
      try {
        match = new RegExp(matchRaw)
      } catch (e) {
        fatal(`--match is not a valid regex: ${(e as Error).message}`)
      }
    }
    const fieldRaw = args.field
    const field = typeof fieldRaw === 'string' && fieldRaw.length > 0 ? fieldRaw.split('.') : null

    const cutoff = parseCutoff(since, '--since')
    const controlCutoff = parseCutoff(controlSince, '--control-since')

    const primary = walk(root, cutoff, match, field, max)
    const control = walk(root, controlCutoff, match, field, 0)

    if (control.filesScanned === 0) {
      fatal(
        `control check failed: --control-since ${controlSince} found 0 files under ${root} — the walk itself is broken, not "no data"`,
      )
    }

    if (primary.linesMatched === 0) {
      nothingToShow(
        `0 lines matched under --since ${since} (control found ${control.filesScanned} files, so the walk works)`,
      )
    }

    return {
      summary: `${primary.filesScanned} file(s) scanned since ${since}, ${primary.linesMatched} line(s) matched (control: ${control.filesScanned} file(s) since ${controlSince})`,
      data: {
        files_scanned: primary.filesScanned,
        lines_matched: primary.linesMatched,
        control_files: control.filesScanned,
        samples: primary.samples,
      },
    }
  },
})
