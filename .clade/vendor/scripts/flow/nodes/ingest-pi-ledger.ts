#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/ingest-pi-ledger.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/ingest-pi-ledger.ts
// clade flow spine — ingest-pi-ledger (TD-794 刀 1)
//
// Backfill: every `~/.pi/agent/clade/dispatch-ledger.jsonl` row inside the window becomes ONE
// point event on the spine of the repo that row named as its cwd. Live dispatches instrument
// themselves (`pi-dispatch.ts` opens a span before `runPi`); this node exists only for the rows
// that predate that instrumentation, so `/board` is not blind to Pi/Codex work that already
// happened.
//
// THE LEDGER STAYS THE LEDGER. This is a tee, never a move: the ledger is machine-wide, fail-open
// telemetry that the quota fallback chain walks by `retryOf`, while the spine is repo-local
// authority. NEVER make a projection read the ledger directly — that is a second data model.
// `ledger_label` is the join key in both directions and it is the ONE field a reader has to know.
//
// This node emits events it did not itself perform, which is not the thing the library forbids:
// "NEVER 自己 emit span" is about a node recording its OWN execution (the engine does that, so a
// direct call and an engine call keep one shape). The rows here are somebody else's history.
//
// Two dedupe sets, not one, and they answer different questions:
//   - a LIVE span carrying this `ledger_label` means the dispatch instrumented itself → skip the
//     label entirely, whatever its timestamp. This is the plan's「跳過已有同 ledger_label 的 span」.
//   - a BACKFILLED event is matched on `(ledger_label, ledger_ts)` → re-running is a no-op, and
//     the 31 labels that were legitimately reused across dispatches (44 rows, 2026-08-29 measured)
//     do not collapse into one. Deduping backfill on the label alone would silently drop them.
//
// Usage:
//   node vendor/scripts/flow/nodes/ingest-pi-ledger.ts [--days 90] [--repo <path>] [--all-repos]
//                                                      [--ledger <path>] [--dry-run] [--json]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { emitEvent, mintWorkId, newSpanId, readEvents } from '../emit.ts'
import { defineNode, fatal } from './lib/contract.ts'

/** Hard ceiling on the window. Backfilling past it writes a stretch of history nobody lived. */
const MAX_DAYS = 90

const WORK_ID_RE = /^W-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9][a-z0-9-]*$/

/**
 * NEVER hardcode `~/.pi`: the env override is what lets a test point at a fixture, and a node that
 * ignores it can only be tested against the real machine-wide ledger.
 */
function defaultLedgerPath() {
  return (
    process.env.PI_DISPATCH_LEDGER ||
    process.env.CODEX_DISPATCH_LEDGER ||
    join(homedir(), '.pi', 'agent', 'clade', 'dispatch-ledger.jsonl')
  )
}

/**
 * exit → outcome, the same mapping `pi-dispatch.ts` applies live (0 ok, 2 the agent's own
 * fail-closed verdict, everything else a failure). Duplicated rather than imported because
 * `pi-dispatch.ts` is a CLI that dispatches on import; change one, change the other.
 */
function outcomeForExit(exit: unknown) {
  if (exit === 0) return 'ok'
  if (exit === 2) return 'blocked'
  return 'fail'
}

const topLevelCache = new Map<string, string | null>()
function repoRootOf(cwd: unknown): string | null {
  if (typeof cwd !== 'string' || !cwd) return null
  if (topLevelCache.has(cwd)) return topLevelCache.get(cwd) ?? null
  let root: string | null = null
  if (existsSync(cwd)) {
    try {
      root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      root = null
    }
  }
  topLevelCache.set(cwd, root || null)
  return root || null
}

/**
 * Which repo's spine a row belongs on.
 *
 * A dispatch that ran inside a worktree ran inside THAT REPO — `wt-helper add` builds the path as
 * `<dirname>/<repo>-wt/<slug>` (wt-helper.ts:933), and the worktree shares the repo it was cut
 * from. So when the worktree is gone (they are removed on merge-back; 285 of 842 rows on
 * 2026-08-29) the row is not homeless: it belongs to the repo the path names.
 *
 * This is inference from a naming convention, so the event SAYS SO (`cwd_resolved_via`). NEVER let
 * it become silent: a fact recorded where it happened and a fact filed by a path-shape guess are
 * different strengths of evidence, and only the event can carry that difference to a reader.
 *
 * NEVER widen this to "walk up until some git repo appears" — that would file a dispatch from a
 * deleted /tmp scratchpad under whatever repo happens to sit above it, which is invention.
 */
function resolveRowRepo(cwd: unknown): { root: string; via: 'cwd' | 'worktree-parent' } | null {
  const direct = repoRootOf(cwd)
  if (direct) return { root: direct, via: 'cwd' }
  if (typeof cwd !== 'string') return null
  const wt = /^(.*)-wt\/[^/]+$/.exec(cwd)
  if (!wt) return null
  const parent = repoRootOf(wt[1])
  return parent ? { root: parent, via: 'worktree-parent' } : null
}

/**
 * Work id for one row. `originId` is the only ledger field that can legally hold one; everything
 * else there is a round tag (`wl-r63`) or a routing receipt id, and reading a work id out of those
 * would be inventing attribution. No id → an orphan minted from the label ON THE ROW'S OWN DATE,
 * so the card sits where the dispatch happened rather than where the backfill ran.
 *
 * NEVER `resolveWorkId(null)` here: it reads ambient `CLADE_WORK_ID`, which would file hundreds of
 * rows of somebody else's history under whatever the backfill operator happens to be working on.
 */
function workIdForRow(row: Record<string, unknown>, ts: Date) {
  const origin = typeof row.originId === 'string' ? row.originId.trim() : ''
  if (WORK_ID_RE.test(origin)) return origin
  const slug = String(row.label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  try {
    return mintWorkId(`orphan-pi-${slug}`, ts)
  } catch {
    return mintWorkId('orphan-pi-unnamed', ts)
  }
}

function dedupeKey(label: string, ledgerTs: string) {
  return `${label} @ ${ledgerTs}`
}

interface RepoState {
  liveLabels: Set<string>
  backfilled: Set<string>
}

function stateOf(root: string, cache: Map<string, RepoState>): RepoState {
  const hit = cache.get(root)
  if (hit) return hit
  const liveLabels = new Set<string>()
  const backfilled = new Set<string>()
  for (const e of readEvents(root)) {
    const payload = (e as { payload?: Record<string, unknown> }).payload
    const label = payload?.ledger_label
    if (typeof label !== 'string' || !label) continue
    if (payload?.backfilled === true) {
      const ts = typeof payload.ledger_ts === 'string' ? payload.ledger_ts : ''
      backfilled.add(dedupeKey(label, ts))
    } else {
      liveLabels.add(label)
    }
  }
  const state = { liveLabels, backfilled }
  cache.set(root, state)
  return state
}

defineNode({
  name: 'ingest-pi-ledger',
  usage: `usage: ingest-pi-ledger [--days 90] [--repo <path>] [--all-repos] [--ledger <path>] [--dry-run]

Backfill dispatch-ledger rows onto the spine as point events. Idempotent: a row already on the
spine (live span with the same ledger_label, or a backfilled event with the same label+ts) is
skipped. Rows are routed to the repo they ran in; by default only rows belonging to --repo
(default: this repo) are ingested, --all-repos fans out to every repo the ledger names.
`,
  options: {
    days: { type: 'string', default: String(MAX_DAYS) },
    repo: { type: 'string' },
    'all-repos': { type: 'boolean', default: false },
    ledger: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  run(args) {
    const days = Number(args.days)
    if (!Number.isFinite(days) || days <= 0) {
      fatal(`--days must be a positive number, got ${String(args.days)}`)
    }
    if (days > MAX_DAYS) {
      fatal(
        `--days ${days} exceeds the ${MAX_DAYS}-day ceiling. Backfilling further back writes a stretch of history nobody lived; the board says「資料起點」instead.`,
      )
    }
    const ledgerPath =
      typeof args.ledger === 'string' && args.ledger ? args.ledger : defaultLedgerPath()
    if (!existsSync(ledgerPath)) fatal(`ledger not found: ${ledgerPath}`)

    const allRepos = args['all-repos'] === true
    const dryRun = args['dry-run'] === true
    let targetRoot: string | null = null
    if (!allRepos) {
      targetRoot = repoRootOf(
        typeof args.repo === 'string' && args.repo ? args.repo : process.cwd(),
      )
      if (!targetRoot) {
        fatal('cannot resolve a repo root for --repo (or cwd); pass --repo <path> or --all-repos')
      }
    }

    const cutoff = Date.now() - days * 86_400_000
    const cache = new Map<string, RepoState>()
    const counts = {
      rows: 0,
      malformed: 0,
      out_of_window: 0,
      no_repo: 0,
      other_repo: 0,
      via_worktree_parent: 0,
      already_live: 0,
      already_backfilled: 0,
      ingested: 0,
      rejected: 0,
    }
    const perRepo = new Map<string, number>()

    for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      counts.rows += 1
      let row: Record<string, unknown>
      try {
        row = JSON.parse(line)
      } catch {
        counts.malformed += 1
        continue
      }
      const label = typeof row.label === 'string' ? row.label : ''
      const ledgerTs = typeof row.ts === 'string' ? row.ts : ''
      const parsed = ledgerTs ? Date.parse(ledgerTs) : Number.NaN
      if (!label || !Number.isFinite(parsed)) {
        counts.malformed += 1
        continue
      }
      if (parsed < cutoff) {
        counts.out_of_window += 1
        continue
      }
      const resolved = resolveRowRepo(row.cwd)
      if (!resolved) {
        counts.no_repo += 1
        continue
      }
      const root = resolved.root
      if (targetRoot && root !== targetRoot) {
        counts.other_repo += 1
        continue
      }
      const state = stateOf(root, cache)
      if (state.liveLabels.has(label)) {
        counts.already_live += 1
        continue
      }
      const key = dedupeKey(label, ledgerTs)
      if (state.backfilled.has(key)) {
        counts.already_backfilled += 1
        continue
      }
      // Mark it seen BEFORE the write: two rows sharing label+ts inside one run are the same
      // dispatch logged twice, and the second must not become a second event.
      state.backfilled.add(key)

      if (dryRun) {
        counts.ingested += 1
        if (resolved.via === 'worktree-parent') counts.via_worktree_parent += 1
        perRepo.set(root, (perRepo.get(root) ?? 0) + 1)
        continue
      }

      const res = emitEvent({
        work_id: workIdForRow(row, new Date(parsed)),
        span_id: newSpanId(),
        parent_span: null,
        phase: 'point',
        kind: 'invoke_agent',
        actor: `pi:${String(row.model ?? 'unknown')}`,
        substrate: 'pi',
        session_id:
          typeof row.claudeCodeSessionId === 'string' && row.claudeCodeSessionId
            ? row.claudeCodeSessionId
            : 'pi-ledger-backfill',
        ts_utc: new Date(parsed).toISOString(),
        outcome: outcomeForExit(row.exit),
        cwd: root,
        payload: {
          ledger_label: label,
          ledger_ts: ledgerTs,
          // Every backfilled event says so. Without it, a reader cannot tell a fact recorded as it
          // happened from one reconstructed afterwards, and the second is weaker evidence.
          backfilled: true,
          effort: row.effort ?? null,
          model: row.model ?? null,
          provider: row.provider ?? null,
          route: row.route ?? null,
          tier_basis: row.tierBasis ?? null,
          table_row: row.tableRow ?? null,
          retry_of: row.retryOf ?? null,
          chain_origin: row.chainOrigin ?? null,
          decision_origin: row.decisionOrigin ?? null,
          prompt_sha256: row.promptSha256 ?? null,
          exit: row.exit ?? null,
          ok: row.ok === true,
          duration_ms: row.durationMs ?? null,
          tokens: row.tokens ?? null,
          error_class: row.errorClass ?? null,
          error_layer: row.errorLayer ?? null,
          cwd: row.cwd ?? null,
          // 'cwd' when the row's own directory still resolves, 'worktree-parent' when only the
          // `<repo>-wt/<slug>` shape did. A reader MUST be able to tell the two apart.
          cwd_resolved_via: resolved.via,
        },
      })
      if (res.written) {
        counts.ingested += 1
        if (resolved.via === 'worktree-parent') counts.via_worktree_parent += 1
        perRepo.set(root, (perRepo.get(root) ?? 0) + 1)
      } else {
        counts.rejected += 1
      }
    }

    return {
      summary: `${dryRun ? '[dry-run] would ingest' : 'ingested'} ${counts.ingested} dispatch row${counts.ingested === 1 ? '' : 's'} (skipped: ${counts.already_live} live, ${counts.already_backfilled} already backfilled, ${counts.other_repo} other repo, ${counts.no_repo} no repo, ${counts.out_of_window} outside ${days}d, ${counts.malformed} malformed; ${counts.rejected} rejected)`,
      data: {
        ledger: ledgerPath,
        days,
        dry_run: dryRun,
        scope: allRepos ? 'all-repos' : targetRoot,
        counts,
        per_repo: Object.fromEntries(perRepo),
      },
    }
  },
})
