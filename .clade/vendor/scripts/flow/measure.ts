// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/measure.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/measure.ts
// clade flow spine — the "現況量測" line the `\my` contract ends with
//
// `\my` requires a footer of live measurements, and it says why in the same breath: "MUST 當下實跑，
// NEVER 引用 HANDOFF 裡寫死的數字". That is the entire specification of this file. Every number
// below comes from running the command at the moment it is asked for, and there is deliberately no
// cache, no persisted snapshot, and no fallback to a written-down value.
//
// The reason is not tidiness. A stale count of dirty files reads exactly like a fresh one, so a
// cached measurement is indistinguishable from a correct one right up until somebody acts on it.
// The `\my` contract was written after a HANDOFF that quoted round 44 while state.json was on 45.
//
// Reads only. Every git invocation here is a query (`status --porcelain`, `worktree list`,
// `stash list`); nothing mutates the repo, so this is safe to run against a tree another session
// is actively writing.
//
// Propagation constraint: `vendor/scripts/flow/` is copied wholesale to every consumer, so this
// file may import ONLY `node:*` and siblings in this directory.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface RepoMeasurement {
  repo: string
  name: string
  /** Tracked files with uncommitted changes. Untracked files are counted separately. */
  dirty: number
  untracked: number
  /** Linked worktrees, excluding the main one. */
  worktrees: number
  stashes: number
  /** `held by <session>` / `free` / `unknown` — the work-loop lock, when this repo has one. */
  lock: string
  /** Named rather than swallowed, same rule `fleet.ts` holds for an unreadable repo. */
  error: string | null
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024,
  })
}

function countLines(text: string, predicate: (line: string) => boolean): number {
  let n = 0
  for (const line of text.split('\n')) {
    if (line && predicate(line)) n += 1
  }
  return n
}

/**
 * The work-loop lock, read from state rather than from a lockfile.
 *
 * `lockSessionId` is what work-loop actually writes; there is no separate lock file to stat. A
 * missing state file means this repo never ran a loop, which is `free` and not an error — most of
 * the roster is in exactly that position.
 */
function lockState(repoRoot: string): string {
  const path = join(repoRoot, '.clade', 'work-loop', 'state.json')
  if (!existsSync(path)) return 'free'
  try {
    const state = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const held = state.lockSessionId
    if (typeof held === 'string' && held) return `held by ${held}`
    return 'free'
  } catch {
    return 'unknown'
  }
}

export function measureRepo(repoRoot: string): RepoMeasurement {
  const measurement: RepoMeasurement = {
    repo: repoRoot,
    name: basename(repoRoot),
    dirty: 0,
    untracked: 0,
    worktrees: 0,
    stashes: 0,
    lock: 'unknown',
    error: null,
  }

  try {
    const status = git(['status', '--porcelain'], repoRoot)
    measurement.dirty = countLines(status, (line) => !line.startsWith('??'))
    measurement.untracked = countLines(status, (line) => line.startsWith('??'))

    // `worktree list` always includes the main tree, which is not a session worktree.
    const worktrees = countLines(git(['worktree', 'list', '--porcelain'], repoRoot), (line) =>
      line.startsWith('worktree '),
    )
    measurement.worktrees = Math.max(0, worktrees - 1)

    measurement.stashes = countLines(git(['stash', 'list'], repoRoot), () => true)
    measurement.lock = lockState(repoRoot)
  } catch (error) {
    measurement.error = error instanceof Error ? error.message : String(error)
  }

  return measurement
}

/**
 * One line, the shape `\my` prints at the bottom.
 *
 * Repos with nothing to report are omitted rather than listed as zeroes: a footer that names
 * fourteen repos to say thirteen of them are quiet is a footer nobody reads to the end of.
 */
export function measurementLine(measurements: RepoMeasurement[]): string {
  const parts: string[] = []
  for (const m of measurements) {
    if (m.error) {
      parts.push(`${m.name}: 讀不到（${m.error.slice(0, 40)}）`)
      continue
    }
    const bits: string[] = []
    if (m.dirty) bits.push(`dirty ${m.dirty}`)
    if (m.untracked) bits.push(`untracked ${m.untracked}`)
    if (m.worktrees) bits.push(`worktree ${m.worktrees}`)
    if (m.stashes) bits.push(`stash ${m.stashes}`)
    if (m.lock !== 'free' && m.lock !== 'unknown') bits.push(m.lock)
    if (bits.length) parts.push(`${m.name}: ${bits.join(' / ')}`)
  }
  return parts.length
    ? parts.join('　')
    : '全 roster 乾淨：無 dirty、無 worktree、無 stash、無 lock'
}
