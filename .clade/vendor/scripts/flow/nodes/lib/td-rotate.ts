// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/lib/td-rotate.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/lib/td-rotate.ts
// Shared byte-exact TD register → archive move. Used by the `td-rotate` node
// and by `vendor/scripts/rotate-closed-bloat.ts`. File I/O stays in the callers.

import { assertAllFound, assertZeroLoss, fatal } from './contract.ts'
import { parseTdRegister, type TdEntry } from './td-parse.ts'

export interface RotatedEntry {
  id: string
  text: string
}

export interface RotatePlan {
  remaining: string
  moved: RotatedEntry[]
}

export function planRotate(fromSource: string, ids: string[]): RotatePlan {
  if (ids.length === 0) fatal('--ids is required')
  const entries = parseTdRegister(fromSource)
  assertAllFound(
    ids,
    entries.map((e) => e.id),
    'TD id',
  )
  const want = new Set(ids)
  const moved = entries.filter((e) => want.has(e.id)).map((e) => ({ id: e.id, text: e.text }))
  const drop = new Set<number>()
  for (const e of entries) {
    if (!want.has(e.id)) continue
    for (let i = e.start; i < e.end; i++) drop.add(i)
  }
  const fromLines = fromSource.split('\n')
  const remaining = fromLines.filter((_, i) => !drop.has(i)).join('\n')
  return { remaining, moved }
}

export function formatArchiveAppend(
  toSource: string,
  moved: RotatedEntry[],
  banner?: string,
): string {
  const bannerLine = banner ? `<!-- ${banner} -->\n\n` : ''
  return `${toSource.replace(/\s*$/, '')}\n\n---\n\n${bannerLine}${moved.map((e) => e.text).join('\n\n---\n\n')}\n`
}

export function verifyZeroLoss(fromAfter: string, toAfter: string, moved: RotatedEntry[]): void {
  assertZeroLoss(
    toAfter,
    moved.map((e) => e.text),
    'archive',
  )
  for (const e of moved) {
    if (fromAfter.includes(e.text))
      fatal(`zero-loss check failed: ${e.id} still present in register`)
  }
}

export type { TdEntry }
