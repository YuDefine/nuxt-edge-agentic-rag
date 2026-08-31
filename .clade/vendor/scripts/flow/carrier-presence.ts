// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/carrier-presence.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/carrier-presence.ts
// clade flow spine — "is this answer anywhere in the prose world?"
//
// The spine records that a question was answered. It cannot record that the answer SURVIVED: the
// landing writes a file, and a file on a shared working tree can be overwritten by the next
// session that rewrites the same section from its own buffer. Measured 2026-08-29 on <consumer-i> span
// `ee92949d75fa703c` — answered once, revised twice, and `git log -S` over `HANDOFF.md` came back
// empty for all three. The human found it by opening `/decisions` and not seeing his own answer.
//
// The predicate is deliberately REPO-WIDE rather than carrier-only. An answered decision that has
// been archived (its block moved to `docs/archives/`) is filed, not lost, and a carrier-only check
// would report every archived decision forever — a surface that cries wolf gets ignored, and this
// one has exactly one job: to be believed the first time.
//
// Anchor is the span id the landing block carries. 16 hex, unique by construction, and the same
// anchor `findLandedBlock` rewrites by — one identifier, one meaning, in both directions.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { landedBlockPresent } from './answer.ts'

/**
 * Which of `spanIds` are FILED somewhere in the repo — a landed decision block, not a mention.
 *
 * Two stages, and both are load-bearing. `git grep` narrows dozens of ids to the handful of files
 * that name any of them (one process for the whole set: a process per id turns a session-start
 * check into a visible pause). Then each candidate file is read once and asked the real question
 * through `landedBlockPresent`, the same anchor rule the rewrite path uses.
 *
 * Skipping the second stage was the first draft, and it was wrong in the direction that matters:
 * once a lost answer gets written up by hand — a TD entry quoting the span id, a HANDOFF line
 * narrating it — a substring search finds it and the loss reads as filed. Measured on <consumer-i>
 * `ee92949d75fa703c`: two files named it, neither held the answer.
 *
 * `--untracked` is load-bearing too. The answer lands in the WORKING TREE and is committed later,
 * or by somebody else, so the window this surface exists to cover — written but not yet committed
 * — is precisely the window a tracked-only search calls missing.
 *
 * Returns every id on failure, never an empty set. This is a detector for a silent loss; one that
 * reported "all lost" because `git` was not on PATH would be a louder failure than the one it
 * watches for. Unknown means no finding, and the caller stays quiet.
 */
export function spanIdsFiledInRepo(repoRoot: string, spanIds: string[]): Set<string> {
  const ids = [...new Set(spanIds)].filter((id) => /^[0-9a-f]{6,}$/u.test(id))
  if (ids.length === 0) return new Set()
  const args = ['grep', '--no-color', '--untracked', '-I', '-l', '-F']
  for (const id of ids) args.push('-e', id)
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  // exit 1 is `git grep`'s "no match", which is a real answer. Anything else (127, 128, a signal)
  // means the question was never asked — fail to "filed" so nothing is reported.
  if (r.error || (r.status !== 0 && r.status !== 1)) return new Set(ids)

  const filed = new Set<string>()
  for (const rel of (r.stdout ?? '').split('\n').filter(Boolean)) {
    let text: string
    try {
      text = readFileSync(join(repoRoot, rel), 'utf8')
    } catch {
      continue
    }
    for (const id of ids) {
      if (!filed.has(id) && landedBlockPresent(text, id)) filed.add(id)
    }
  }
  return filed
}
