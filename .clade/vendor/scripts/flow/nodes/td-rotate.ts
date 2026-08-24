#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/td-rotate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/td-rotate.ts
// clade flow spine — td-rotate (P1a)
//
// Move requested TD entries from the register to an archive file, byte-exact. Derived from
// `r107-rotate.mjs`, which rotated by line-count delta instead of content — a count that matches
// proves nothing about what actually moved. This node adds the zero-loss verify that was missing:
// after the write, re-read both files and assert each entry's text landed in the archive and is
// gone from the register.

import { readFileSync, writeFileSync } from 'node:fs'

import {
  assertAllFound,
  assertZeroLoss,
  defineNode,
  fatal,
  listArg,
  requireArg,
} from './lib/contract.ts'
import { parseTdRegister } from './lib/td-parse.ts'

defineNode({
  name: 'td-rotate',
  usage: `usage: td-rotate --ids <TD-1,TD-2> --to <path> [--from <path>] [--banner <text>] [--dry-run]

Move the named TD entries from --from (default docs/tech-debt.md) to --to, byte-exact.
`,
  options: {
    ids: { type: 'string' },
    from: { type: 'string', default: 'docs/tech-debt.md' },
    to: { type: 'string' },
    banner: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  run(args) {
    const ids = listArg(args, 'ids')
    if (ids.length === 0) fatal('--ids is required')
    const fromPath = requireArg(args, 'from')
    const toPath = requireArg(args, 'to')
    const dryRun = args['dry-run'] === true

    const fromSource = readFileSync(fromPath, 'utf8')
    const entries = parseTdRegister(fromSource)
    assertAllFound(
      ids,
      entries.map((e) => e.id),
      'TD id',
    )

    const want = new Set(ids)
    const toMove = entries.filter((e) => want.has(e.id))
    const drop = new Set<number>()
    for (const e of toMove) for (let i = e.start; i < e.end; i++) drop.add(i)

    const fromLines = fromSource.split('\n')
    const remaining = fromLines.filter((_, i) => !drop.has(i)).join('\n')

    const toSource = readFileSync(toPath, 'utf8')
    const bannerLine = typeof args.banner === 'string' ? `<!-- ${args.banner} -->\n\n` : ''
    const appended = `${toSource.replace(/\s*$/, '')}\n\n---\n\n${bannerLine}${toMove.map((e) => e.text).join('\n\n---\n\n')}\n`

    if (!dryRun) {
      writeFileSync(fromPath, remaining)
      writeFileSync(toPath, appended)

      // Zero-loss verify: re-read both files off disk, not the in-memory strings we just wrote —
      // a bug in the write path should show up here, not be hidden by verifying our own buffer.
      const fromAfter = readFileSync(fromPath, 'utf8')
      const toAfter = readFileSync(toPath, 'utf8')
      assertZeroLoss(
        toAfter,
        toMove.map((e) => e.text),
        toPath,
      )
      for (const e of toMove) {
        if (fromAfter.includes(e.text))
          fatal(`zero-loss check failed: ${e.id} still present in ${fromPath}`)
      }
    }

    return {
      summary: `${dryRun ? '[dry-run] would rotate' : 'rotated'} ${toMove.length} entr${toMove.length === 1 ? 'y' : 'ies'}: ${ids.join(', ')}`,
      data: {
        rotated: toMove.map((e) => e.id),
        from_lines: { before: fromLines.length, after: remaining.split('\n').length },
        to_lines: { before: toSource.split('\n').length, after: appended.split('\n').length },
      },
    }
  },
})
