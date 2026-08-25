#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/td-open.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/td-open.ts
// clade flow spine — td-open
//
// Mints the next TD number and emits an entry skeleton that already satisfies the two hygiene
// invariants a fresh entry can violate: Invariant 1 (numbers are never reused, archive included)
// and Invariant 13 (actionable entries carry a `### Restart brief`).
//
// Why this is a node and not the 79th audit script: audits report after the fact. TD-660 was
// opened as a duplicate and only surfaced on the next hygiene run — by which point two entries
// shared a number and one of them had to be renumbered by hand. Minting removes the failure
// instead of detecting it.
//
// **The archive is part of the number space.** `td-register-scan` reports `max_td` from a single
// file, which is precisely how a collision gets minted: the live register's highest number says
// nothing about the 507 entries already rotated out. NEVER derive the next number from
// docs/tech-debt.md alone.

import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { defineNode, fatal, requireArg } from './lib/contract.ts'
import { maxTdNumber, parseTdRegister } from './lib/td-parse.ts'

const ARCHIVE_DIR = 'docs/archives'
const ARCHIVE_PREFIX = 'tech-debt-closed-'

/** Every file that holds TD numbers: the live register plus every rotated-out archive. */
function numberSpaceFiles(register: string, archiveDir: string): string[] {
  let archives: string[] = []
  try {
    archives = readdirSync(archiveDir)
      .filter((f) => f.startsWith(ARCHIVE_PREFIX) && f.endsWith('.md'))
      .map((f) => join(archiveDir, f))
      .toSorted()
  } catch {
    // No archive directory yet — the live register is the whole number space. Not an error:
    // a fresh consumer register legitimately has nothing rotated out.
    archives = []
  }
  return [register, ...archives]
}

function skeleton(
  id: string,
  opts: {
    title: string
    cls: string
    priority: string
    discovered: string
    location: string
  },
): string {
  return [
    '',
    `## ${id} — ${opts.title}`,
    '',
    `**Class**: ${opts.cls}`,
    `**Status**: open`,
    `**Priority**: ${opts.priority}`,
    `**Discovered**: ${opts.discovered}`,
    `**Location**: ${opts.location}`,
    '',
    '### Problem',
    '',
    'TODO — 症狀、觸發條件、為什麼平時不炸。',
    '',
    '### Restart brief',
    '',
    '- **讀這幾份**：TODO（路徑）',
    '- **跑什麼**：TODO（指令）',
    '- **驗收 predicate**：TODO（可觀察、能回 pass/fail）',
    '- **已排除**：TODO（哪些方案評估過但不走，附理由）',
    '',
  ].join('\n')
}

defineNode({
  name: 'td-open',
  usage: `usage: td-open --title <text> [--class <text>] [--priority <text>] [--location <text>]
                [--discovered <YYYY-MM-DD>] [--file <path>] [--archive-dir <path>] [--write]

Mint the next unused TD number across the live register AND every docs/archives/tech-debt-closed-*.md,
then print an entry skeleton carrying a '### Restart brief'. Without --write nothing is modified.
`,
  options: {
    title: { type: 'string' },
    class: { type: 'string', default: 'A — clade 標準層 issue' },
    priority: { type: 'string', default: 'mid' },
    location: { type: 'string', default: 'TODO' },
    discovered: { type: 'string' },
    file: { type: 'string', default: 'docs/tech-debt.md' },
    'archive-dir': { type: 'string', default: ARCHIVE_DIR },
    write: { type: 'boolean', default: false },
  },
  run(args) {
    const title = requireArg(args, 'title')
    const register = requireArg(args, 'file')
    const archiveDir = requireArg(args, 'archive-dir')

    // `--discovered` is injectable so the node stays a pure function under test. Defaulting to
    // today is the normal path; a fixture passes its own date rather than freezing the clock.
    const discovered =
      typeof args.discovered === 'string' && args.discovered
        ? args.discovered
        : new Date().toISOString().slice(0, 10)

    const files = numberSpaceFiles(register, archiveDir)
    const perFile: Record<string, number> = {}
    let highest = 0
    for (const f of files) {
      let source: string
      try {
        source = readFileSync(f, 'utf8')
      } catch {
        // The live register MUST exist; a listed archive that vanished mid-run is a real problem
        // and fails closed rather than silently shrinking the number space.
        fatal(`cannot read ${f} — the number space is incomplete, refusing to mint`)
      }
      const n = maxTdNumber(parseTdRegister(source))
      perFile[f] = n
      if (n > highest) highest = n
    }
    if (highest === 0) {
      fatal(
        `no TD numbers found across ${files.length} file(s) — that means the parse failed, not that the register is empty. Refusing to mint TD-1 over a live register.`,
      )
    }

    const next = highest + 1
    const id = `TD-${next}`
    const block = skeleton(id, {
      title,
      cls: String(args.class),
      priority: String(args.priority),
      discovered,
      location: String(args.location),
    })

    if (args.write === true) appendFileSync(register, block, 'utf8')

    return {
      summary: `${id} minted (highest was ${highest} across ${files.length} file${files.length === 1 ? '' : 's'})${args.write === true ? ` — appended to ${register}` : ' — dry run, nothing written'}`,
      data: {
        id,
        number: next,
        highest_seen: highest,
        scanned: perFile,
        written: args.write === true,
        block,
      },
    }
  },
})
