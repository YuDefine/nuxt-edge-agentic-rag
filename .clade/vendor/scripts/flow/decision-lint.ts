#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/decision-lint.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/decision-lint.ts
// Decision-queue lint for ONE file, at the moment it is written.
//
// `flow sources` already reports `no-options-under-ruling`, and the ingest side already hands such
// a ruling straight back with `ask-options`. Both are correct and both are too late: by then the
// question is on Charles's phone as a blank text box, the request to fix it is a card in a queue,
// and the agent that could fix it in five seconds — the one that still has the options in its own
// context — has moved on. Measured 2026-08-29: one such hand-back sat unanswered for 3.2 hours.
//
// So this asks the same question at the only moment the answer is free: the write itself. Same
// scanners, same `lint` codes, same wording (`OPTIONS_REQUEST_TEXT`) — NEVER a second parser and
// NEVER a second phrasing. A rule this file disagreed with would be worse than no check at all,
// because it would teach its reader that the real one is noise.
//
// Advisory by construction. Exit 0 always; findings go to stderr. Blocking a write on the shape of
// a bullet buys a bypass flag, not a better bullet — the same reason `lint` itself is warn-only.

import { basename, relative, resolve } from 'node:path'

import { OPTIONS_REQUEST_TEXT } from './decisions.ts'
import type { SourceItem } from './decision-sources.ts'
import { scanHandoff, scanTasks, scanTechDebt } from './decision-sources.ts'

/**
 * Which scanner owns a path, or null when nothing does.
 *
 * Keyed on the file the scanners actually read rather than on a directory: each `scan*` takes a
 * repo root and opens its own canonical filename, so dispatching on anything looser would run a
 * scanner against a file it was never pointed at and report findings that belong elsewhere.
 */
function scannerFor(rel: string): ((root: string) => SourceItem[]) | null {
  if (rel === 'HANDOFF.md' || basename(rel) === 'HANDOFF.md') return scanHandoff
  if (rel.endsWith('docs/tech-debt.md')) return scanTechDebt
  if (rel.startsWith('openspec/')) return scanTasks
  return null
}

export function lintOneFile(repoRoot: string, filePath: string): SourceItem[] {
  const rel = relative(resolve(repoRoot), resolve(filePath))
  if (rel.startsWith('..')) return []
  const scan = scannerFor(rel)
  if (!scan) return []
  return scan(repoRoot).filter((item) => item.lint.includes('no-options-under-ruling'))
}

/** The sentence an author sees, with the one thing the queue's version cannot carry: which bullet. */
export function lintReport(items: SourceItem[]): string {
  if (items.length === 0) return ''
  const head =
    items.length === 1
      ? '⚠ 剛寫入的檔案裡有 1 條拍板題沒有選項：'
      : `⚠ 剛寫入的檔案裡有 ${items.length} 條拍板題沒有選項：`
  return [
    head,
    ...items.map((i) => `    ${i.source_id}\n      ${i.question}`),
    '',
    `    ${OPTIONS_REQUEST_TEXT}`,
    '',
    '    現在補最省：選項還在你的 context 裡。等它進佇列之後，補件的請求會退回給你，',
    '    而中間那段時間 Charles 手機上是一張答不了的卡。',
    '',
  ].join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [repoRoot, filePath] = process.argv.slice(2)
  if (!repoRoot || !filePath) {
    process.stderr.write('usage: decision-lint.ts <repo-root> <edited-file>\n')
    process.exit(0)
  }
  let report = ''
  try {
    report = lintReport(lintOneFile(repoRoot, filePath))
  } catch {
    // A lint that takes the edit down with it is worse than a lint that misses one. Stay quiet.
    process.exit(0)
  }
  if (report) process.stderr.write(report)
  process.exit(0)
}
