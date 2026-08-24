#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/td-register-scan.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/td-register-scan.ts
// clade flow spine — td-register-scan (P1a)
//
// Structured filter over docs/tech-debt.md, thin wrapper around td-parse.ts. Derived from
// `r107-debtready.mjs`, which hand-rolled a line-by-line state machine to answer "which TD
// entries are ready" — the same predicate `filterTdEntries('ready')` now owns in one place.

import { readFileSync } from 'node:fs'

import { defineNode, listArg, nothingToShow, requireArg } from './lib/contract.ts'
import {
  filterTdEntries,
  maxTdNumber,
  parseTdRegister,
  type TdEntry,
  type TdFilter,
} from './lib/td-parse.ts'

const VALID_FILTERS: TdFilter[] = [
  'all',
  'open',
  'parked',
  'ready',
  'blocked-by-publish',
  'no-evidence',
]
const VALID_FIELDS = new Set(['id', 'status', 'title', 'location'])

defineNode({
  name: 'td-register-scan',
  usage: `usage: td-register-scan [--file <path>] [--filter <${VALID_FILTERS.join('|')}>] [--fields <id,status,title>] [--max <n>]

Filter docs/tech-debt.md (default) by --filter (default ready) and report --fields per entry.
`,
  options: {
    file: { type: 'string', default: 'docs/tech-debt.md' },
    filter: { type: 'string', default: 'ready' },
    fields: { type: 'string', default: 'id,status,title' },
    max: { type: 'string' },
  },
  run(args) {
    const filePath = requireArg(args, 'file')
    const filter = (typeof args.filter === 'string' ? args.filter : 'ready') as TdFilter
    if (!VALID_FILTERS.includes(filter)) {
      throw new Error(`--filter must be one of: ${VALID_FILTERS.join(', ')}`)
    }
    const fields = listArg({ fields: (args.fields as string) ?? 'id,status,title' }, 'fields')
    for (const f of fields) {
      if (!VALID_FIELDS.has(f)) throw new Error(`--fields: unknown field "${f}"`)
    }
    const max = typeof args.max === 'string' ? Number(args.max) : undefined

    const source = readFileSync(filePath, 'utf8')
    const allEntries = parseTdRegister(source)
    const matched = filterTdEntries(allEntries, filter)
    if (matched.length === 0) nothingToShow(`no entries match --filter ${filter} in ${filePath}`)

    const limited =
      typeof max === 'number' && Number.isFinite(max) ? matched.slice(0, max) : matched

    const pick = (e: TdEntry): Record<string, string> => {
      const row: Record<string, string> = {}
      for (const f of fields) row[f] = String(e[f as keyof TdEntry] ?? '')
      return row
    }
    const entries = limited.map(pick)

    return {
      summary: `${filter}: ${limited.length}${limited.length < matched.length ? ` of ${matched.length}` : ''} entr${limited.length === 1 ? 'y' : 'ies'} — ${limited.map((e) => e.id).join(', ')}`,
      data: {
        filter,
        count: limited.length,
        max_td: maxTdNumber(allEntries),
        entries,
      },
    }
  },
})
