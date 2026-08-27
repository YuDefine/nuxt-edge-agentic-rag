// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/decisions.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/decisions.ts
// clade flow spine — the decision queue (what is waiting on a human)
//
// The rest of the spine records what happened. This projection answers the opposite question:
// what has *not* happened because nobody has answered yet. The `\my` contract states outright
// that pending decisions "mostly exist only in the conversation", which no tool could read —
// this is the surface that makes them queryable.
//
// Two buckets, and the second one is the reason this file exists rather than a one-line filter:
//
//   1. ASKED — a `decision.request` span with no `end`. The question was emitted deliberately.
//   2. GATED — any span that ended `blocked` with nothing following it in the same work item.
//      Nobody wrote a question for these, yet they are exactly as stuck: a publish that refused
//      to run as a runner child, a pane that reported `blocked`. Reading only bucket 1 would
//      show an empty queue while the fleet sits waiting on an attended session.
//
// Bucket 2 shares `lastStartByWork` and the action sentence with `findStalls` rather than copying
// either: two copies of "did anything follow" would let `/flow` and this queue disagree about
// whether the same span is still waiting. It does NOT filter `findStalls` output, because a
// blocked herdr pane that was also never reclaimed is classified `unharvested` there and returns
// before the blocked branch — that is the live case this queue exists for, so it must not depend
// on the classification, only on the oracle.

import type { DecisionLock, LockCandidate } from './emit.ts'
import { applyAmendment, computeDecisionLock } from './emit.ts'
import type { LintCode } from './decision-sources.ts'
import { LINT_NOTES } from './decision-sources.ts'
import type { Span } from './spine.ts'
import { AWAITING_ATTENDED_ACTION, lastStartByWork } from './stall.ts'

/** How far back the `answered` bucket looks. Beyond this an answer is history, not a live edit. */
const ANSWERED_WINDOW_MINUTES = 7 * 24 * 60

export interface AskedDecision {
  span_id: string
  work_id: string
  repo: string | null
  asked_at: string
  actor: string
  substrate: string
  age_minutes: number
  question: string
  options: string[]
  recommended: string | null
  /** `\my` bucket. Only bucket 1 ("ruling") is answerable by picking a letter. */
  category: string
  /** Where the answer has to land: a TD id, a HANDOFF section, a `tasks/` path. */
  carrier: string | null
  /**
   * What the asking side already knew, for a question that cannot carry its own context.
   *
   * A `flow ask` question is written to be read alone. A question that comes off a blocked pane
   * is not: it is the last paragraph of a report, and read without that report it is a pronoun
   * with no antecedent. `/decisions` is used from a phone, where "go read the scrollback" is not
   * an available move, so the context has to travel with the question.
   *
   * Two asking paths, two payload keys — see `readContext`.
   */
  context: string | null
  /**
   * Which FILE source this question was scanned out of, or `null` when an agent asked it directly.
   *
   * This is the `\my` `[已登記]` / `[session-only]` distinction, and it is not cosmetic: a
   * scanned question already has a durable home (the file it came from), while one an agent asked
   * mid-conversation exists ONLY on the spine until somebody answers it. The reader needs to know
   * which, because the second kind is the one that disappears if it is left alone.
   */
  source_kind: string | null
  /** The back-and-forth on this question, oldest first. Empty for the common case. */
  clarifications: ClarificationNote[]
  /**
   * True when this one cannot be answered as it stands: a ruling with no options **as parsed**,
   * and nobody asked for any yet.
   *
   * "As parsed" is the whole of it, and NEVER read the flag as "the author wrote no options".
   * The two causes are indistinguishable from here — the author left them out, or the author
   * wrote them in a shape `extractOptions` could not read — and both need the same move from a
   * human, so the flag deliberately does not try to tell them apart. What it MUST NOT do is
   * assert the first cause, because that assertion has already been wrong once at fleet scale:
   * the 2026-08-27 measurement of 1-of-38 rulings carrying options was taken while the parser
   * only accepted bold hugging the letter, and <consumer-i>'s TD-584 and TD-585 — both written out as
   * A/B/C — sat in the 37.
   *
   * `\my` requires every ruling to carry 2–4 ordered options plus 推薦, and `extractOptions`
   * refuses to guess from prose — correctly, since a guessed option list files an answer nobody
   * meant. So a ruling the parser cannot read lands here as a free-text box, which reads as
   * "answerable" and is not.
   *
   * Surfacing it as its own flag is what lets the page offer the one move that actually helps —
   * hand the question back for options — instead of silently downgrading to a text box that
   * absorbs the failure. Widening the parser shrinks this flag's population on its own; it does
   * not retire it, because the leave-them-out cause stays real.
   */
  needs_options: boolean
  /**
   * How this row is WRITTEN, in codes from `decision-sources.ts`.
   *
   * Distinct from `needs_options`, and NEVER a duplicate of it. `needs_options` is a state of the
   * conversation — the ball is on the agent side, here is the button that moves it. The lint is a
   * remark about the source text, addressed to whoever next edits that file: it says a list was
   * refused, or that a ruling was filed with nothing to choose from.
   *
   * Rendered as a note, never as a blocker. The row stays answerable with or without it.
   */
  lint: string[]
  /**
   * True when the last note is a `request` — the ball is on the agent side.
   *
   * Read the LAST note, never "is there a request anywhere". A question can be clarified, then
   * clarified again; keying on presence would leave every answered clarification looking
   * permanently unanswered, and the surface would fill with work nobody has to do.
   */
  awaiting_clarification: boolean
}

export interface ClarificationNote {
  direction: 'request' | 'response'
  text: string
  actor: string
  at: string
}

export interface GatedWork {
  span_id: string
  work_id: string
  repo: string | null
  blocked_at: string
  actor: string
  substrate: string
  kind: string
  label: string | null
  age_minutes: number
  /** The sentence `findStalls` already writes for this shape — never a second wording. */
  action: string
  /** What the blocked side reported, when it reported anything. Older spans carry neither. */
  summary: string | null
}

/**
 * A question that HAS been answered, and whether that answer can still be changed.
 *
 * The queue used to end at the moment somebody answered: the span closed and the card vanished.
 * That is right for "what is waiting on a human" and wrong for the thing people actually do next,
 * which is realise the answer was wrong. An answer is not final by nature — it is final once an
 * agent has read it and started working, and that is a fact the spine can carry.
 */
export interface AnsweredDecision {
  span_id: string
  work_id: string
  repo: string | null
  question: string
  options: string[]
  recommended: string | null
  category: string
  carrier: string | null
  answered_at: string
  answered_by: string
  /** The effective answer: the last revision if there is one, otherwise what the `end` recorded. */
  answer: string
  revision_count: number
  age_minutes: number
  locked: DecisionLock | null
}

export interface DecisionQueue {
  generated_at: string
  asked: AskedDecision[]
  gated: GatedWork[]
  answered: AnsweredDecision[]
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** Same fields `findStalls` reads for its label — a decision span has none of them, a pane does. */
function labelOf(span: Span): string | null {
  const label = span.payload?.label ?? span.payload?.slug ?? span.payload?.node
  return typeof label === 'string' ? label : null
}

function ageMinutes(ts: string | null, now: number): number {
  if (!ts) return 0
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor((now - parsed) / 60000))
}

/**
 * Per-repo, never over the concatenated stream.
 *
 * Same correctness requirement `buildFleetSnapshot` documents: work ids collide across repos, so
 * "nothing followed in this work item" folded across repos would silently mark a blocked span in
 * one repo as resolved by unrelated activity in another.
 */
function groupByRepo(spans: (Span & { repo?: string })[]): Map<string | null, Span[]> {
  const byRepo = new Map<string | null, Span[]>()
  for (const span of spans) {
    const key = span.repo ?? null
    const bucket = byRepo.get(key)
    if (bucket) bucket.push(span)
    else byRepo.set(key, [span])
  }
  return byRepo
}

/**
 * The clarification notes hanging off each decision, keyed by the decision span id.
 *
 * Built once per repo rather than re-scanned per decision: the queue is fleet-wide and a nested
 * scan would be O(spans x decisions) over fourteen streams to render a page that is usually empty.
 */
function clarificationsBySpan(spans: Span[]): Map<string, ClarificationNote[]> {
  const out = new Map<string, ClarificationNote[]>()
  for (const span of spans) {
    if (span.kind !== 'decision.clarify' || !span.parent_span) continue
    const payload = span.payload ?? {}
    const direction = payload.direction === 'response' ? 'response' : 'request'
    const bucket = out.get(span.parent_span)
    const note: ClarificationNote = {
      direction,
      text: str(payload.text),
      actor: span.actor,
      at: span.start_ts ?? '',
    }
    if (bucket) bucket.push(note)
    else out.set(span.parent_span, [note])
  }
  for (const notes of out.values()) notes.sort((a, b) => a.at.localeCompare(b.at))
  return out
}

/**
 * The amendment in force for each question, keyed by the decision span it hangs off.
 *
 * An amendment refreshes an OPEN question's rendered payload — options above all — after the
 * thing that produced it was fixed. The spine is append-only, so the `start` event keeps whatever
 * the parser of the day wrote; without this fold the page renders that forever, and a question
 * whose source file carries a clean A/B shows a lone 「其他（自己寫）」 box instead.
 *
 * The MERGE itself lives in `emit.ts` (`applyAmendment`), and this file MUST keep importing it
 * rather than growing a second copy. A second copy is not a style problem: the two are only ever
 * edited together by accident, and the half that gets missed drops a field silently. Measured
 * 2026-08-27, in the change that introduced amendments — a local copy here forwarded options and
 * dropped `lint`, so the spine carried the verdict, the reconciler read it, and the page rendered
 * nothing. Every surface agreed except the one a human looks at.
 *
 * NEVER let this reach the `answered` bucket. An answer was picked from the options that were on
 * screen at the time, and re-rendering it against different ones would restate the choice as
 * something the human never saw. `buildDecisionQueue` therefore folds amendments into `asked`
 * only, and `amendDecision` refuses an answered span at the write end as well — two independent
 * guards, because either alone fails silently.
 */
function amendmentsBySpan(spans: Span[]): Map<string, Record<string, unknown>> {
  const held = new Map<string, { at: string; payload: Record<string, unknown> }>()
  for (const span of spans) {
    if (span.kind !== 'decision.amend' || !span.parent_span) continue
    const at = span.start_ts ?? ''
    const previous = held.get(span.parent_span)
    if (previous && previous.at > at) continue
    held.set(span.parent_span, { at, payload: span.payload ?? {} })
  }
  return new Map([...held].map(([parent, entry]) => [parent, entry.payload]))
}

/**
 * Blocked spans a human has explicitly written off, keyed by the span they hang from.
 *
 * The gated bucket needs this and `asked` does not: a question closes by being answered, but a
 * blocked span is already ended and nothing can close it twice. Without an explicit dismissal the
 * only thing that ever removes a gated card is new work starting in the same work id — so a
 * question resolved through a different route (a ruling made elsewhere, work abandoned) sits on
 * the page forever, and a queue that cannot be emptied stops being read.
 */
function dismissedSpanIds(spans: Span[]): Set<string> {
  const out = new Set<string>()
  for (const span of spans) {
    if (span.kind === 'decision.dismiss' && span.parent_span) out.add(span.parent_span)
  }
  return out
}

/**
 * Every revision of one answer, newest last, keyed by the decision span it hangs off.
 *
 * Built per repo alongside the clarifications for the same reason: a nested scan would be
 * O(spans × decisions) across fourteen streams to render a bucket that is usually short.
 */
function revisionsBySpan(spans: Span[]): Map<string, Span[]> {
  const out = new Map<string, Span[]>()
  for (const span of spans) {
    if (span.kind !== 'decision.revise' || !span.parent_span) continue
    const bucket = out.get(span.parent_span)
    if (bucket) bucket.push(span)
    else out.set(span.parent_span, [span])
  }
  for (const list of out.values())
    list.sort((a, b) => String(a.start_ts).localeCompare(String(b.start_ts)))
  return out
}

/**
 * Folded spans in the shape `computeDecisionLock` reads.
 *
 * NOT `lastStartByWork`: that oracle deliberately counts everything, because the gated bucket asks
 * "did ANY activity follow" and a point event is activity. The lock asks a narrower question —
 * "did somebody start EXECUTING this" — and the exclusions live inside the shared rule so both
 * surfaces cannot drift apart on it.
 */
function lockCandidates(spans: Span[]): LockCandidate[] {
  return spans.map((span) => ({
    kind: span.kind,
    work_id: span.work_id,
    at: span.start_ts ?? '',
    is_point: span.is_point,
    actor: span.actor,
    parent_span: span.parent_span,
  }))
}

/**
 * The asking side's context, under EITHER of the two keys the two asking paths actually write.
 *
 * `herdr-session-handoff.ts` writes `payload.context` (the blocked pane's report). The file
 * scanner writes `payload.detail` (the indented continuation lines hanging off a HANDOFF bullet,
 * which is where the question's second half lives — `question` is only the bullet's first line).
 * Reading one key was the same as having no context at all for every question that came off the
 * other path: 2026-08-27 measured 35/38 open spans carrying `detail` and 0/38 carrying `context`,
 * so `/decisions` rendered its 詳情 block exactly zero times while every scanned question stopped
 * mid-sentence.
 *
 * NEVER collapse these into one key by renaming at a write site: both keys are already on spans
 * that exist, and a rename only moves the blind spot to the other half of the queue.
 */
function readContext(payload: Record<string, unknown>): string | null {
  for (const key of ['context', 'detail']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

/**
 * What gets sent back when a question arrives with no options — one wording, one place.
 *
 * Both the page's button and the scanner's automatic hand-back use this string. Two copies would
 * drift, and the drift is invisible: the agent reading it has no way to tell which one it got,
 * so a weaker wording on one path would quietly produce weaker questions on that path forever.
 *
 * It names the contract rather than asking nicely, because "能不能給我選項" is answerable with a
 * paragraph of prose — which is exactly the shape that got us here.
 */
/**
 * 寫法評語的文字 SoT，原地在 `decision-sources.ts`。這裡再出口一次是為了讓既有的
 * 消費端（`flow.ts`、`/api/decisions`）維持單一 import 面，NEVER 在任何一端重打一句。
 */
export { LINT_NOTES }
export type { LintCode }

export const OPTIONS_REQUEST_TEXT =
  '這題沒有選項，我答不了。請依 `\\my` 契約補上 2–4 個排序過的選項' +
  '（推薦的排第一並標「（推薦）」），每項一句「這樣做會怎樣」，並寫出「答完的下一步」。' +
  '若這題本來就不是選擇題，請改寫成「這題要給值」並逐項列出要填什麼。' +
  '兩者都不成立（它其實不需要我拍板）就把它從佇列上收掉，並說明為什麼。'

/**
 * Whether this question still has to be handed back before anybody can pick an answer.
 *
 * Only `ruling` — the other buckets are states, not questions, and options on them would be an
 * answer sheet for something nobody asked. And only while no clarification is pending: once the
 * ball is on the agent side, saying it again adds a second identical request to the thread.
 */
function needsOptions(
  payload: Record<string, unknown>,
  notes: ClarificationNote[],
  category: string,
): boolean {
  if (category !== 'ruling') return false
  const options = Array.isArray(payload.options) ? payload.options : []
  if (options.length > 0) return false
  return notes.at(-1)?.direction !== 'request'
}

export function buildDecisionQueue(
  spans: (Span & { repo?: string })[],
  { now = Date.now() }: { now?: number } = {},
): DecisionQueue {
  const asked: AskedDecision[] = []
  const gated: GatedWork[] = []
  const answered: AnsweredDecision[] = []

  for (const [repo, repoSpans] of groupByRepo(spans)) {
    const clarifications = clarificationsBySpan(repoSpans)
    const revisions = revisionsBySpan(repoSpans)
    const candidates = lockCandidates(repoSpans)
    for (const span of repoSpans) {
      if (span.kind !== 'decision.request' || !span.end_ts) continue
      const payload = span.payload ?? {}
      // A source that vanished from a file was RETRACTED, not ruled on (§ 待拍板佇列 MUST 2).
      // Offering it in a list of "answers you can still change" would present a disappearance as
      // one of Charles's decisions — the exact conflation that MUST exists to prevent.
      if (payload.retracted === true) continue
      const age = ageMinutes(span.end_ts, now)
      if (age > ANSWERED_WINDOW_MINUTES) continue
      const history = revisions.get(span.span_id) ?? []
      const last = history.at(-1)
      const lastPayload = last?.payload ?? {}
      answered.push({
        span_id: span.span_id,
        work_id: span.work_id,
        repo,
        question: str(payload.question, '(沒有記下問題)'),
        options: Array.isArray(payload.options) ? payload.options.map((o) => String(o)) : [],
        recommended: typeof payload.recommended === 'string' ? payload.recommended : null,
        category: str(payload.category, 'ruling'),
        carrier: typeof payload.carrier === 'string' ? payload.carrier : null,
        answered_at: span.end_ts,
        answered_by: str(
          typeof lastPayload.revised_by === 'string' ? lastPayload.revised_by : payload.answered_by,
          'unknown',
        ),
        answer: str(
          typeof lastPayload.answer === 'string' ? lastPayload.answer : payload.answer,
          '(沒有記下答案)',
        ),
        revision_count: history.length,
        age_minutes: age,
        locked: computeDecisionLock(span.span_id, span.work_id, span.end_ts, candidates),
      })
    }
    const writtenOff = dismissedSpanIds(repoSpans)
    const amendments = amendmentsBySpan(repoSpans)
    for (const span of repoSpans) {
      if (span.kind !== 'decision.request' || span.end_ts) continue
      /**
       * `decision.dismiss` retires an ASKED question too, not only a gated one.
       *
       * An asked span normally closes by being answered, which is right while the question is
       * still a question. It stops being right when the question turns out never to have been
       * one: the 2026-08-27 cross-repo intake wrote 15 spans off `跨 repo` sections whose own
       * text says `本 repo 不修` / `已移交` / `不用再開`. Those cannot be answered — there is no
       * ruling to give — and the source no longer emits them, so without an exit they would sit
       * on the spine unanswered forever.
       *
       * NEVER retire them by filtering on category at render time instead. A row that vanishes
       * from the queue with nothing written down is indistinguishable from one that was never
       * scanned, and `flow status --stalled` would still report the span as overdue while the
       * page showed nothing — the split-brain this queue exists to remove. Dismissal is a point
       * event with a required reason, so the write-off is auditable.
       */
      if (writtenOff.has(span.span_id)) continue
      const payload = applyAmendment(span.payload ?? {}, amendments.get(span.span_id))
      const notes = clarifications.get(span.span_id) ?? []
      const category = str(payload.category, 'ruling')
      asked.push({
        span_id: span.span_id,
        work_id: span.work_id,
        repo,
        asked_at: span.start_ts ?? '',
        actor: span.actor,
        substrate: span.substrate,
        age_minutes: ageMinutes(span.start_ts, now),
        question: str(payload.question, '(沒有記下問題)'),
        options: Array.isArray(payload.options) ? payload.options.map((o) => String(o)) : [],
        recommended: typeof payload.recommended === 'string' ? payload.recommended : null,
        category,
        carrier: typeof payload.carrier === 'string' ? payload.carrier : null,
        source_kind:
          payload.source && typeof (payload.source as { kind?: unknown }).kind === 'string'
            ? String((payload.source as { kind: string }).kind)
            : null,
        context: readContext(payload),
        clarifications: notes,
        awaiting_clarification: notes.at(-1)?.direction === 'request',
        needs_options: needsOptions(payload, notes, category),
        lint: Array.isArray(payload.lint) ? payload.lint.map((c) => String(c)) : [],
      })
    }

    // No grace period, unlike `findStalls`: a stall needs one because a young span with no outcome
    // is a race, but `blocked` is a *reported* state — it is waiting the moment it is written, and
    // holding it back for an hour is exactly the silence this queue removes.
    const lastStart = lastStartByWork(repoSpans)
    for (const span of repoSpans) {
      if (span.is_point || span.outcome !== 'blocked' || !span.end_ts) continue
      if ((lastStart.get(span.work_id) ?? '') > span.end_ts) continue
      if (writtenOff.has(span.span_id)) continue
      gated.push({
        span_id: span.span_id,
        work_id: span.work_id,
        repo,
        blocked_at: span.end_ts,
        actor: span.actor,
        substrate: span.substrate,
        kind: span.kind,
        label: labelOf(span),
        age_minutes: ageMinutes(span.end_ts, now),
        action: AWAITING_ATTENDED_ACTION,
        summary: typeof span.payload?.summary === 'string' ? span.payload.summary : null,
      })
    }
  }

  return {
    generated_at: new Date(now).toISOString(),
    asked: asked.toSorted((a, b) => b.age_minutes - a.age_minutes),
    gated: gated.toSorted((a, b) => b.age_minutes - a.age_minutes),
    // Newest first, unlike the other two: those sort by how long something has been ignored, and
    // this one answers "what did I just answer" — the edit people want is almost always the last one.
    answered: answered.toSorted((a, b) => a.age_minutes - b.age_minutes),
  }
}
