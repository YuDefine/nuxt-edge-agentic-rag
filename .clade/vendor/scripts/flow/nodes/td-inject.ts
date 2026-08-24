#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/td-inject.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/td-inject.ts
// clade flow spine — td-inject (P1a)
//
// Insert a block of text into one TD entry, anchored on the first line within that entry
// containing --after-match, idempotent via --guard. Derived from `apply-r110-venue.mjs` and
// `apply-r110-evidence-stale.mjs`, both of which located their insertion point by content and
// skipped when a guard string was already present — the two things a re-run must get right.

import { readFileSync, writeFileSync } from 'node:fs'

import { assertZeroLoss, defineNode, fatal, requireArg } from './lib/contract.ts'
import { parseTdRegister } from './lib/td-parse.ts'

defineNode({
  name: 'td-inject',
  usage: `usage: td-inject --id <TD-N> --after-match <substring> --block <text> --guard <substring> [--file <path>] [--dry-run]

Insert --block after the first line in TD entry --id containing --after-match. Skips (exit 0) if
--guard is already present anywhere in the entry.
`,
  options: {
    id: { type: 'string' },
    file: { type: 'string', default: 'docs/tech-debt.md' },
    'after-match': { type: 'string' },
    block: { type: 'string' },
    guard: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  run(args) {
    const id = requireArg(args, 'id')
    const filePath = requireArg(args, 'file')
    const afterMatch = requireArg(args, 'after-match')
    const blockRaw = requireArg(args, 'block')
    const guard = requireArg(args, 'guard')
    const dryRun = args['dry-run'] === true

    const source = readFileSync(filePath, 'utf8')
    const entries = parseTdRegister(source)
    const entry = entries.find((e) => e.id === id)
    if (!entry) fatal(`TD id not found: ${id}`)

    const lines = source.split('\n')
    const entryLines = lines.slice(entry.start, entry.end)

    if (entryLines.some((l) => l.includes(guard))) {
      return {
        summary: `${id}: already-applied, skipped`,
        data: { id, applied: false, reason: 'already-applied' },
      }
    }

    const offset = entryLines.findIndex((l) => l.includes(afterMatch))
    if (offset < 0) fatal(`anchor not found in ${id}: "${afterMatch}"`)

    const anchorLine = entry.start + offset
    const blockLines = blockRaw.split('\n')
    const newLines = [
      ...lines.slice(0, anchorLine + 1),
      ...blockLines,
      ...lines.slice(anchorLine + 1),
    ]
    const result = newLines.join('\n')

    if (!dryRun) {
      writeFileSync(filePath, result)

      // Zero-loss verify. entry.text is not checked whole — the insertion splits it in two, so
      // asserting it verbatim would always fail. Check the two halves the insertion split it
      // into instead: everything up to and including the anchor line, and everything after.
      const after = readFileSync(filePath, 'utf8')
      const prefix = entryLines.slice(0, offset + 1).join('\n')
      const suffix = entryLines.slice(offset + 1).join('\n')
      assertZeroLoss(after, [blockRaw, prefix, suffix], filePath)
    }

    return {
      summary: `${dryRun ? '[dry-run] would insert' : 'inserted'} ${blockLines.length} line(s) into ${id} at line ${anchorLine + 2}`,
      data: { id, applied: true, anchor_line: anchorLine + 2 },
    }
  },
})
