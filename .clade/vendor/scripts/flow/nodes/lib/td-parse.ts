// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/lib/td-parse.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/lib/td-parse.ts
// clade flow spine — shared tech-debt register parser (P1a)
//
// This regex set was copy-pasted verbatim across at least four `.clade/work-loop/*.mjs` scripts
// (`r107-debtready.mjs`, `tmp-list-ready.mjs`, `tmp-list-scripts-only.mjs`, and the `r*-tdmax`
// family). Copies drift: a predicate fixed in one round stays broken in the next round's copy,
// and nothing detects it because each copy is a fresh file. One definition, one place to fix.
//
// Consumed by the td-* nodes and by anything else that needs to read `docs/tech-debt.md`
// structurally rather than by grep.

import { markdownSections, trimSeparatorTail } from './contract.ts'

export const TD_ID = /\bTD-\d+\b/
export const DEBT_OPEN_STATUS = /\b(open|in-progress|pending|landed-pending-verification)\b/i
export const DEBT_PARKED_STATUS = /blocked-attended-only|wontfix-until-signal/i
export const SELF_VERIFY_HEADING = /^#{2,6}\s*自驗/
export const ACCEPTANCE_PREDICATE =
  /\*\*(驗收|Acceptance|Unblock predicate|解凍 predicate)\*\*\s*[:：]/i
export const LOCATION_LINE = /^(?:[-*+]\s+)?\*\*Location\*\*\s*[:：]/
export const STATUS_LINE = /^(?:[-*+]\s+)?\*\*Status\*\*\s*[:：]\s*(.*)$/
/**
 * `**Parent**: TD-NNN` — the ONLY machine-readable statement that one entry belongs under another.
 *
 * Explicit marker only, on the same basis `scanTechDebt` refuses a keyword heuristic. `[[TD-NNN]]`
 * prose links do NOT carry direction: TD-787's Class line names both TD-684 and TD-786 while being
 * their DOWNSTREAM, and no reading of the link tells you which way it points. A field a person
 * typed on purpose is the only source that does.
 */
export const PARENT_LINE = /^(?:[-*+]\s+)?\*\*Parent\*\*\s*[:：]\s*(TD-\d+)\b/
/** A Location pointing into a clade-managed tree means the fix is not done until it propagates. */
export const PUBLISH_REQUIRED_PATH =
  /(?:^|[\s`(（、＋+])(?:rules|plugins|vendor|claude-md|\.claude)\//

export interface TdEntry {
  id: string
  /** Heading text after the `## `, verbatim. */
  title: string
  status: string
  location: string
  /** `**Parent**: TD-NNN`, when the entry states one. NEVER inferred from prose links. */
  parent: string | null
  /** A 自驗 heading or an acceptance predicate — either counts as an evidence carrier. */
  hasEvidence: boolean
  needsPublish: boolean
  isOpen: boolean
  isParked: boolean
  /** Line range of the whole entry within the source file, separator tail excluded. */
  start: number
  end: number
  /** The entry body, verbatim, separator tail excluded — this is what a byte-exact move carries. */
  text: string
}

/**
 * Parse the register into entries. Section boundaries come from `markdownSections`, which skips
 * fenced blocks — the register embeds markdown examples whose `## ` lines are not entries.
 */
export function parseTdRegister(source: string): TdEntry[] {
  const lines = source.split('\n')
  const entries: TdEntry[] = []

  for (const section of markdownSections(lines)) {
    const heading = /^##\s+(.*)$/.exec(section.heading)
    if (!heading || !TD_ID.test(heading[1])) continue

    const end = trimSeparatorTail(lines, section.start, section.end)
    const body = lines.slice(section.start, end)

    let status = ''
    let location = ''
    let parent: string | null = null
    let hasEvidence = false
    let needsPublish = false

    for (const line of body.slice(1)) {
      const st = STATUS_LINE.exec(line)
      if (st) status = st[1]
      const pa = PARENT_LINE.exec(line)
      if (pa) parent = pa[1]
      if (SELF_VERIFY_HEADING.test(line) || ACCEPTANCE_PREDICATE.test(line)) hasEvidence = true
      if (LOCATION_LINE.test(line)) {
        location = line
        if (PUBLISH_REQUIRED_PATH.test(line)) needsPublish = true
      }
    }

    entries.push({
      id: TD_ID.exec(heading[1])![0],
      title: heading[1],
      status: status.trim(),
      location: location.trim(),
      parent,
      hasEvidence,
      needsPublish,
      isOpen: DEBT_OPEN_STATUS.test(status) && !DEBT_PARKED_STATUS.test(status),
      isParked: DEBT_PARKED_STATUS.test(status),
      start: section.start,
      end,
      text: body.join('\n'),
    })
  }

  return entries
}

/** Highest TD number present, or 0. The `r*-tdmax` family existed only to answer this. */
export function maxTdNumber(entries: TdEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, Number(e.id.slice(3))), 0)
}

export type TdFilter = 'all' | 'open' | 'parked' | 'ready' | 'blocked-by-publish' | 'no-evidence'

/**
 * `ready` is the predicate the loop actually asks for each round: open, not parked, carries
 * evidence, and does not need a publish to land. `blocked-by-publish` is the same minus that last
 * clause — the two are reported separately because the second is not the agent's to unblock.
 */
export function filterTdEntries(entries: TdEntry[], filter: TdFilter): TdEntry[] {
  switch (filter) {
    case 'all':
      return entries
    case 'open':
      return entries.filter((e) => e.isOpen)
    case 'parked':
      return entries.filter((e) => e.isParked)
    case 'ready':
      return entries.filter((e) => e.isOpen && e.hasEvidence && !e.needsPublish)
    case 'blocked-by-publish':
      return entries.filter((e) => e.isOpen && e.hasEvidence && e.needsPublish)
    case 'no-evidence':
      return entries.filter((e) => e.isOpen && !e.hasEvidence)
  }
}
