#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/td-rotate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/td-rotate.ts
// clade flow spine — td-rotate (P1a)
//
// Move requested TD entries from the register to an archive file, byte-exact.
// Shared move/verify lives in `lib/td-rotate.ts`.

import { readFileSync, writeFileSync } from 'node:fs'

import { defineNode, listArg, requireArg } from './lib/contract.ts'
import { formatArchiveAppend, planRotate, verifyZeroLoss } from './lib/td-rotate.ts'

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
    const fromPath = requireArg(args, 'from')
    const toPath = requireArg(args, 'to')
    const dryRun = args['dry-run'] === true
    const banner = typeof args.banner === 'string' ? args.banner : undefined

    const fromSource = readFileSync(fromPath, 'utf8')
    const { remaining, moved } = planRotate(fromSource, ids)
    const toSource = readFileSync(toPath, 'utf8')
    const appended = formatArchiveAppend(toSource, moved, banner)

    if (!dryRun) {
      writeFileSync(fromPath, remaining)
      writeFileSync(toPath, appended)
      verifyZeroLoss(readFileSync(fromPath, 'utf8'), readFileSync(toPath, 'utf8'), moved)
    }

    return {
      summary: `${dryRun ? '[dry-run] would rotate' : 'rotated'} ${moved.length} entr${moved.length === 1 ? 'y' : 'ies'}: ${ids.join(', ')}`,
      data: {
        rotated: moved.map((e) => e.id),
        from_lines: { before: fromSource.split('\n').length, after: remaining.split('\n').length },
        to_lines: { before: toSource.split('\n').length, after: appended.split('\n').length },
      },
    }
  },
})
