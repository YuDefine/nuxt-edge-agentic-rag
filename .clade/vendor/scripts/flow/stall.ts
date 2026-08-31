// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/stall.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/stall.ts
// clade flow spine — stall query (P2)
//
// `herdr-patrol --stalled` answers "what has stopped moving and nobody will notice" for one
// substrate, by reading live Herdr panes plus the durable dispatch records. This asks the same
// question of the spine, which means it answers it for every substrate at once: a pi dispatch that
// died mid-run, a node that ended blocked, a pane that reported and was never harvested.
//
// COVERAGE BOUNDARY — NEVER read this as "patrol is now redundant". Patrol reports three classes of
// fact that are not events and therefore cannot be on the spine at all:
//   1. pane geometry disagreeing with the dispatch record (a `pane swap` nobody recorded)
//   2. orphaned dev-tool processes a dead session left running
//   3. whether the session that may act on a pane still exists — which decides between `--reclaim`
//      and `--recover-orphan`, two different instructions for one stalled pane
// It is also machine-wide, while a spine is repo-local: a dispatch whose cwd is another repo lands
// on that repo's events.jsonl and is invisible here. What moves onto the spine is the *stall
// verdict* — abandoned dispatches, reported-but-unharvested ones, work that failed with nothing
// after it — for every substrate at once rather than for Herdr alone.
//
// Measured 2026-08-24 on one live pane: patrol said `orphan-recoverable [blocked]`, this said
// `unharvested`. Same pane, same stall, and the actions differ exactly where patrol knows something
// the stream cannot: the coordinator session is gone.
//
// Every predicate below is a pure function of the folded spans plus `now`. There is no second
// store, no bookkeeping file, and nothing to keep in sync.

import type { Span } from './spine.ts'
import type { WhoRow } from './who.ts'

export type StallShape =
  | 'in-flight-overdue'
  | 'unharvested'
  | 'failed-open'
  | 'dead-holder'
  | 'stash-residue'
  | 'clarification-requested'

export interface Stall {
  shape: StallShape
  span_id: string
  work_id: string
  substrate: string
  kind: string
  actor: string
  /** Minutes since the moment that makes this a stall (start for in-flight, end for the others). */
  age_minutes: number
  since: string
  /** What a reader should do about it — the same contract patrol's `action` column carries. */
  action: string
  label: string | null
  /**
   * The handles that locate this stall in the substrate it lives in — a Herdr pane, a dispatch
   * record. Both are ALSO interpolated into `action`, and that is the point: `action` is a
   * sentence for a human to run, these are fields for a caller to group, filter and probe by.
   *
   * They exist because the sentence was the only carrier for three months, and a reader looking
   * at 52 anonymous residue cards could not get from the board to the pane without parsing
   * English. NEVER recover a missing value by regexing `action` — that is a second derivation of
   * the same fact wearing a disguise, and the two copies will disagree the first time the
   * sentence is reworded. Missing here means missing in `span.payload`; say so with null.
   *
   * Null on every stall whose substrate has no such handle (a `stash-residue` has no pane) and on
   * older spans emitted before the payload carried one — consumers MUST render the null case.
   */
  pane_id: string | null
  dispatch_id: string | null
}

/**
 * Default grace period. Matches `herdr-patrol.ts`'s `ABANDONED_RECORD_MIN_AGE_MS` (60 minutes) on
 * purpose: a dispatch record is written before its pane finishes launching, so a young record with
 * no outcome is a race, not a leak, and the two surfaces must not disagree about where that line is.
 */
export const DEFAULT_STALL_MINUTES = 60

/** One string field off a span payload, or null. The payload is an open bag; nothing is promised. */
function payloadString(span: Span, key: string): string | null {
  const held = span.payload?.[key]
  return typeof held === 'string' && held.length > 0 ? held : null
}

function ageMinutes(ts: string | null, now: number): number | null {
  if (!ts) return null
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return null
  return Math.floor((now - parsed) / 60000)
}

/** Longest label a CLI line or a `/flow` card carries before it stops being scannable. */
const LABEL_MAX = 60

function labelOf(span: Span): string | null {
  const label = span.payload?.label ?? span.payload?.slug ?? span.payload?.node
  if (typeof label === 'string') return label
  // A decision span carries none of those fields, and its identity *is* the question it asked —
  // `buildDecisionQueue` reads `payload.question` for exactly that reason. Without this fallback
  // two pending decisions render as one repeated line ("Claude Code, 28.9h" twice, measured
  // 2026-08-27) and a reader who is told "answering it is what closes it" cannot tell which `it`.
  const question = span.payload?.question
  if (typeof question === 'string' && question.length > 0) {
    return question.length > LABEL_MAX ? `${question.slice(0, LABEL_MAX - 1)}\u2026` : question
  }
  return null
}

/**
 * Blocked spans a human wrote off, keyed by the span the dismissal hangs from.
 *
 * Mirrors the decision queue's filter for the same reason `lastStartByWork` is shared: two copies
 * of "is this one still waiting" let `/flow` and `/decisions` disagree about the same span, and a
 * dismissal that clears the card but not the stall line teaches the reader that dismissing does
 * nothing.
 */
function dismissedSpanIds(spans: Span[]): Set<string> {
  const out = new Set<string>()
  for (const s of spans) {
    if (s.kind === 'decision.dismiss' && s.parent_span) out.add(s.parent_span)
  }
  return out
}

/**
 * Work items a human has already ruled on (`work.accept` / `work.drop`).
 *
 * A failure inside a work item that was subsequently accepted or written off is history, not a
 * stall: the verdict IS the answer to "either retry it or record why it was dropped", and a list
 * that keeps demanding an action already taken is the kind of list people stop reading. Only
 * `failed-open` is filtered by it — an unclosed span and an unharvested pane are facts about a
 * process or a pane, and those do not stop being true because the work was written off.
 */
function ruledWorkIds(spans: Span[]): Set<string> {
  const out = new Set<string>()
  for (const s of spans) {
    if (s.kind === 'work.accept' || s.kind === 'work.drop') out.add(s.work_id)
  }
  return out
}

/**
 * Point events emitted by a reclaim, keyed by canonical dispatch identity when available.
 *
 * One dispatch can have several completion spans after continuation. A reclaim belongs to that
 * dispatch, not only to whichever continuation span happened to be its parent. Older events did
 * not carry `dispatch_id`, so their parent span remains the compatibility identity.
 */
function reclaimedIdentities(spans: Span[]): {
  dispatchIds: Set<string>
  spanIds: Set<string>
} {
  const dispatchIds = new Set<string>()
  const spanIds = new Set<string>()
  for (const s of spans) {
    if (!s.is_point || s.payload?.transport_event !== 'reclaim') continue
    const dispatchId = payloadString(s, 'dispatch_id')
    if (dispatchId) dispatchIds.add(dispatchId)
    else if (s.parent_span) spanIds.add(s.parent_span)
  }
  return { dispatchIds, spanIds }
}

/**
 * The one sentence for a blocked span that nothing followed.
 *
 * Exported because the decision queue shows the same state and must not word it a second way:
 * two phrasings of one state read as two states.
 */
/**
 * A human said the question is not answerable as written, and nobody has answered that yet.
 *
 * Named as one exported constant for the same reason as `AWAITING_ATTENDED_ACTION`: patrol, the
 * stall list and any future surface must print one phrasing, or two wordings of one state read as
 * two states. It carries the command that closes the loop — a stall a reader cannot act on from
 * the line itself is a notification, not a stall.
 */
export const CLARIFICATION_REQUESTED_ACTION =
  '有人要求補充說明，答案不在他手上：node vendor/scripts/flow/flow.ts clarify <span_id> --text "<說明>"'

export const AWAITING_ATTENDED_ACTION =
  "blocked and nothing followed — this is the awaiting-attended state; an attended session has to pick it up. If it was already settled another way, say so instead of leaving it here: node vendor/scripts/flow/flow.ts dismiss <span_id> --reason '<why it no longer needs anyone>'"

/**
 * The latest start timestamp per work item, so "nothing happened after this failure" is checkable.
 *
 * Exported for the decision queue, which needs the same oracle without the stall classification:
 * a blocked pane that was also never reclaimed is reported here as `unharvested` (that branch
 * returns first), and a queue that read only `failed-open` would drop exactly the live case it
 * exists for. Sharing the oracle instead of copying it keeps the two surfaces from disagreeing
 * about whether anything followed.
 */
export function lastStartByWork(spans: Span[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of spans) {
    if (!s.start_ts) continue
    const cur = out.get(s.work_id)
    if (!cur || s.start_ts > cur) out.set(s.work_id, s.start_ts)
  }
  return out
}

/**
 * Per decision span: which way the last clarification note pointed, and how long it has sat there.
 *
 * Deliberately not imported from `decisions.ts`: that module builds a full render-ready queue
 * (four buckets, repo grouping, human strings) and this needs one boolean per span. Depending on
 * it would make the stall query pay for a page it never draws — and would invert the dependency,
 * since the decision queue already imports this file.
 */
function clarifyState(spans: Span[], now: number) {
  const lastClarify = new Map<string, 'request' | 'response'>()
  const clarifySince = new Map<string, string>()
  const clarifyAge = new Map<string, number>()
  for (const span of spans) {
    if (span.kind !== 'decision.clarify' || !span.parent_span) continue
    const at = span.start_ts ?? ''
    if ((clarifySince.get(span.parent_span) ?? '') > at) continue
    lastClarify.set(
      span.parent_span,
      span.payload?.direction === 'response' ? 'response' : 'request',
    )
    clarifySince.set(span.parent_span, at)
    clarifyAge.set(span.parent_span, ageMinutes(at, now) ?? 0)
  }
  return { lastClarify, clarifyAge, clarifySince }
}

export function findStalls(
  spans: Span[],
  {
    now = Date.now(),
    thresholdMinutes = DEFAULT_STALL_MINUTES,
  }: { now?: number; thresholdMinutes?: number } = {},
): Stall[] {
  const reclaimed = reclaimedIdentities(spans)
  const dismissed = dismissedSpanIds(spans)
  const lastStart = lastStartByWork(spans)
  const ruled = ruledWorkIds(spans)
  const { lastClarify, clarifyAge, clarifySince } = clarifyState(spans, now)
  const stalls: Stall[] = []

  for (const span of spans) {
    // A point event is an instant; it can never be in flight and never be harvested.
    if (span.is_point) continue
    const base = {
      span_id: span.span_id,
      work_id: span.work_id,
      substrate: span.substrate,
      kind: span.kind,
      actor: span.actor,
      label: labelOf(span),
      // Read once, here, for every shape — the `unharvested` branch below interpolates the same
      // two values into its sentence and MUST keep reading them from this one place. Two readers
      // of `span.payload.pane_id` is how a card ends up pointing at a different pane than the
      // command printed underneath it.
      pane_id: payloadString(span, 'pane_id'),
      dispatch_id: payloadString(span, 'dispatch_id'),
    }

    if (!span.end_ts) {
      // A dismissed question is not stalled. `dismissed` is consulted here as well as in the
      // ended-span branches below because an ASKED span never ends — `decision.dismiss` is its
      // only exit once the question turns out never to have been one (see `buildDecisionQueue`).
      // Without this the write-off would clear `/decisions` and leave the stall line standing,
      // which is the split-brain the comment at `dismissedSpanIds` warns about, one branch over.
      //
      // Scoped to `decision.` on purpose, and NEVER widen it to every un-ended span. Dismissal is
      // not closure: a `run` span that is still open is still open, and letting a dismissal
      // silence it here would build the exact escape hatch this file exists to deny — the span
      // would vanish from `--stalled` while remaining open forever, with no surface left that
      // shows it. For work spans the exit stays `flow close`.
      if (span.kind.startsWith('decision.') && dismissed.has(span.span_id)) continue

      // Checked before the overdue branch on purpose: an unanswered decision is ALSO an unclosed
      // span, so both shapes would fire for it. One span reports as one stall, and the specific,
      // actionable shape has to be the one that survives — `in-flight-overdue` would bury the only
      // line that says what to actually do.
      //
      // No grace period, unlike everything else here. A grace period exists because a young span
      // with no outcome is a race; a clarification request is a *reported* state — it is waiting
      // the moment it is written, and holding it an hour removes the point of the surface.
      if (span.kind === 'decision.request' && lastClarify.get(span.span_id) === 'request') {
        stalls.push({
          ...base,
          shape: 'clarification-requested',
          age_minutes: clarifyAge.get(span.span_id) ?? 0,
          since: clarifySince.get(span.span_id) ?? (span.start_ts as string),
          action: CLARIFICATION_REQUESTED_ACTION,
        })
        continue
      }
      const age = ageMinutes(span.start_ts, now)
      if (age !== null && age >= thresholdMinutes) {
        stalls.push({
          ...base,
          shape: 'in-flight-overdue',
          age_minutes: age,
          since: span.start_ts as string,
          action:
            span.substrate === 'herdr'
              ? `pane never reported an outcome; read its scrollback, then redispatch or close it out with \`herdr-session-handoff.ts --adjudicate\``
              : span.kind === 'decision.request'
                ? `a question waiting on a human — answering it is what closes it; answer it in review-gui /decisions, which lands the answer on the carrier the question named`
                : `span opened and never closed — the process died or is still running; confirm which first, then close it out: node vendor/scripts/flow/flow.ts close ${span.span_id} --outcome <ok|fail|skipped> --reason '<why>'`,
        })
      }
      continue
    }

    const endAge = ageMinutes(span.end_ts, now)
    if (endAge === null) continue

    // Reported, but nobody harvested it. Closing the span is what a completion does; taking the
    // pane back is a separate act, and only the reclaim point event proves it happened.
    if (
      span.substrate === 'herdr' &&
      span.payload?.closed_by === 'completion' &&
      !reclaimed.spanIds.has(span.span_id) &&
      !(base.dispatch_id && reclaimed.dispatchIds.has(base.dispatch_id)) &&
      endAge >= thresholdMinutes
    ) {
      // Same two values as `base.pane_id` / `base.dispatch_id`, placeholder-substituted for the
      // sentence. The substitution is presentation only — NEVER let the placeholders leak back
      // into the fields, or a caller probing `pane_id` gets the literal string `<pane>`.
      const dispatchId = base.dispatch_id ?? ''
      const paneId = base.pane_id ?? '<pane>'
      stalls.push({
        ...base,
        shape: 'unharvested',
        age_minutes: endAge,
        since: span.end_ts,
        // Only the dispatching session may reclaim. If it is gone the reclaim refuses, and
        // `herdr-patrol` is the surface that can tell you so — hence the pointer rather than a
        // promise that this one command will work.
        // Two commands, because there are two states behind one line. The reclaim is the honest
        // first try; when the pane is gone it refuses, and before TD-673 the trail ended there —
        // the entry could never be cleared by anyone. The second names the door that opened.
        action: `outcome reported, pane not reclaimed: node vendor/scripts/herdr-session-handoff.ts --reclaim ${paneId} --verified${dispatchId ? `  (dispatch ${dispatchId})` : ''} — if that refuses the pane is gone; record the harvest instead: node vendor/scripts/herdr-session-handoff.ts --adjudicate ${dispatchId || '<dispatch-id>'} --disposition harvested-absent --reason '<why>'`,
      })
      continue
    }

    // Failed or blocked, and nothing in this work item started afterwards — the shape of
    // "everyone stopped and nobody is going to wake anyone", including a node that returned
    // blocked because it refuses to run unattended.
    if (
      (span.outcome === 'fail' || span.outcome === 'blocked') &&
      endAge >= thresholdMinutes &&
      (lastStart.get(span.work_id) ?? '') <= span.end_ts &&
      !dismissed.has(span.span_id) &&
      !ruled.has(span.work_id)
    ) {
      stalls.push({
        ...base,
        shape: 'failed-open',
        age_minutes: endAge,
        since: span.end_ts,
        action:
          span.outcome === 'blocked'
            ? AWAITING_ATTENDED_ACTION
            : `failed and nothing followed in this work item; either retry it or record why it was dropped`,
      })
    }
  }

  return stalls.toSorted((a, b) => b.age_minutes - a.age_minutes)
}

export function renderStalls(stalls: Stall[]): string {
  if (stalls.length === 0) return 'no stalls\n'
  const lines = [`STALLED (${stalls.length}):`, '']
  for (const s of stalls) {
    const hours = (s.age_minutes / 60).toFixed(1)
    lines.push(
      `${s.shape}  ${s.substrate}:${s.kind}${s.label ? ` [${s.label}]` : ''}  ${hours}h  ${s.work_id}  ${s.span_id.slice(0, 8)}`,
    )
    lines.push(`    → ${s.action}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Ownership stalls — contended working-tree state that nobody is coming back for.
 *
 * These are NOT spine events, which is why they are a separate function rather than two more
 * branches in `findStalls`. A spine event records that something happened; a dirty file whose
 * writer died records that something *stopped* happening, and there is no event for that. The
 * evidence is `git status` × the provenance journal, folded by `buildWhoRows`.
 *
 * Both shapes report state the prose rules already describe, so the point of mechanising them is
 * that a stall query now *asks* — the prose only helped a reader who already knew to go look.
 */
export const STASH_RESIDUE_MINUTES = 30

export function findOwnershipStalls(
  rows: WhoRow[],
  {
    now = Date.now(),
    stashResidueMinutes = STASH_RESIDUE_MINUTES,
  }: { now?: number; stashResidueMinutes?: number } = {},
): Stall[] {
  const stalls: Stall[] = []
  for (const row of rows) {
    if (row.kind === 'dirty-path' && row.verdict === 'orphan') {
      // `orphan` already means two independent signals agreed the writer is gone, so the one
      // thing this must never say is "wait". Waiting on a dead holder is the exact 2026-08-26
      // failure: a gate blind-waited on a session that had already committed and exited.
      const age = ageMinutes(row.written_at, now)
      stalls.push({
        shape: 'dead-holder',
        span_id: `ownership:${row.resource}`,
        work_id: row.resource,
        substrate: 'git',
        kind: 'dirty-path',
        actor: row.session_id ?? 'unknown',
        age_minutes: age ?? 0,
        since: row.written_at ?? '',
        label: row.session_id,
        // git-substrate stalls have no pane and no dispatch: the handle for a dirty path IS the
        // path, and it is already `work_id`. Explicit nulls, NEVER an empty string — "" reads as
        // "there is a pane and it is nameless".
        pane_id: null,
        dispatch_id: null,
        action: `dirty and its writer is gone (two signals agree) — NEVER 盲等. Adjudicate now: git commit --only -- ${row.resource}, or stash it`,
      })
      continue
    }
    if (row.kind === 'stash') {
      const age = ageMinutes(row.written_at, now)
      if (age === null || age < stashResidueMinutes) continue
      stalls.push({
        shape: 'stash-residue',
        span_id: `ownership:${row.resource}`,
        work_id: row.resource,
        substrate: 'git',
        kind: 'stash',
        actor: 'unknown',
        age_minutes: age,
        since: row.written_at as string,
        label: row.resource,
        pane_id: null,
        dispatch_id: null,
        // A live publish holds its stash for minutes, not half an hour. Past that the stash is
        // residue and reading it as "a publish is in flight" blocks a gate on nothing —
        // clade-role-and-todo-discipline § Commit 前 MUST 先確認別人的 publish 沒在飛 says the
        // same thing in prose; this is the surface that asks the question unprompted.
        action: `stash older than ${stashResidueMinutes}min — treat as residue, NEVER as "a publish is in flight": node vendor/scripts/stash-reconcile.ts --include-all, then drop or apply it`,
      })
    }
  }
  return stalls.toSorted((a, b) => b.age_minutes - a.age_minutes)
}
