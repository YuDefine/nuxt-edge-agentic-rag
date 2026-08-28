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
import type { QuestionPageRef } from '../review-gui.question-page.ts'
import { readQuestionPageRef } from '../review-gui.question-page.ts'
import type { Span, WorkItem } from './spine.ts'
import { buildWorkItems } from './spine.ts'
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
  /** `\my` bucket. `ruling` and `review` are answerable; the other three are states. */
  category: string
  /**
   * The GROUPING key both surfaces render under, with the retired `'irreversible'` token folded
   * into `'human-action'`.
   *
   * Distinct from `category` on purpose: the spine is append-only and `category` is rendered
   * verbatim (a tested contract), so a rename of the bucket vocabulary cannot rewrite it. What
   * a rename may do is decide where the row is DISPLAYED — and that fold lives here, computed
   * once, so `flow pending` and `/decisions` cannot disagree about which heading a legacy row
   * sits under. Unknown categories pass through verbatim and land in each surface's fallback
   * group, exactly as before.
   */
  bucket: string
  /**
   * One imperative line for a `human-action` row — what the human actually DOES, and where.
   *
   * `null` everywhere else. Derived mechanically from the row's source shape, NEVER from prose:
   * a `handoff` action is a review (`Ready for review` is the only heading that emits the
   * bucket), and the entry URL is lifted from the body when one is written there; a `tech-debt`
   * action points at the TD section that spells the steps out; a `tasks` action is the task
   * title itself, so the line only says where to tick it off. 2026-08-28 exists because the
   * bucket rendered `employee-backpay-request —— ready-for-review（r118）` with nothing else,
   * and Charles's verbatim reading was 「我看不懂我要幹嘛」.
   */
  action: string | null
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
   * True when a `review` row cannot be reviewed as it stands: no openable evidence on it, and
   * nobody has asked for any yet.
   *
   * The exact sibling of `needs_options`, for the exact same reason. A ruling with no options
   * renders as a text box that LOOKS answerable; a review with no evidence renders as a title
   * that LOOKS reviewable, and both quietly move the cost onto the one person who cannot pay it.
   * 「見 HANDOFF」 is not evidence: chasing that pointer is the 20 minutes that kept 7 finished
   * changes unreviewed for 10.8–16.6h each.
   *
   * Note what this flag does NOT do: it does not keep the row out of the queue. Refusing
   * admission would make finished work INVISIBLE — the author never learns they under-filed it
   * and Charles never learns something is waiting — which is strictly worse than a row that sits.
   * So the row is admitted, marked, and handed back to the agent side, exactly like a ruling
   * missing its options.
   */
  needs_evidence: boolean
  /**
   * 這一題有一個互動決策頁要嵌，而不是用選項按鈕回答。
   *
   * 目前唯一的來源是 `/design` 的 impeccable 決策頁（視覺方向、元件組合、skill 序列）——
   * 那些選擇要看得到卡片、色票與 comp 才答得下去，壓成 `options[]` 的一行字就不是同一個問題了。
   *
   * **它記的是怎麼重建那一頁（payload 檔路徑），NEVER 記 port。** decision item 可能幾小時後
   * 才在手機上被點開，而 question server 有 idle-grace 會自己收掉 —— 記下來的 port 必然過期，
   * 且過期的 port 與活著的 port 在 span 裡長得一模一樣。`/decisions` 在點開那一秒才 spawn。
   *
   * 答案不走這條佇列：`serve-question` 把答案寫進它自己的 answer 檔，發問的 agent 用 `--wait`
   * 讀。這個欄位只決定卡片畫成什麼，不決定答案落在哪。
   */
  question_page: QuestionPageRef | null
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

/** See `AskedDecision.bucket`. The one place the legacy token is folded — NEVER copy this fold. */
export function bucketOf(category: string): string {
  return category === 'irreversible' ? 'human-action' : category
}

/**
 * First URL in a body, for the review-entry line. Presentation only: finding one never promotes
 * an entry into the queue, so this stays outside the scanner's precision-bias contract.
 */
const URL_IN_TEXT = /https?:\/\/[^\s)）（(」「>`'"、，;；]+/

/** See `AskedDecision.action`. */
function actionOf(
  bucket: string,
  sourceKind: string | null,
  sourceId: string | null,
  question: string,
  context: string | null,
  carrier: string | null,
): string | null {
  /*
   * `review` earns an action line too, and it is the SAME line — 「你要去哪裡看」 is what both
   * buckets owe the reader. The two differ only in what happens after looking: a review ends in
   * 通過／退回 (so it also gets `Qn` and an input), a human-action ends in the doing itself.
   *
   * NEVER drop the line for review on the grounds that it now has buttons. The buttons say what
   * you can REPLY; this says where to go first, and a 通過 button with nowhere to look is the
   * thing `needs_evidence` exists to withhold.
   */
  if (bucket !== 'human-action' && bucket !== 'review') return null
  if (sourceKind === 'handoff') {
    /*
     * A `需要 Charles` section labelled 「人工驗收」 would send the reader to a review screen that
     * does not exist, so the verb keys on the heading — NEVER on the body's prose.
     *
     * Two ways to know the heading, and BOTH are needed. The bucket is the current answer. The
     * `source.id` (`handoff:HANDOFF.md#<heading-slug>/…`) is the answer for spans written before
     * `review` existed: those carry the retired `irreversible` token, fold into `human-action`,
     * and would otherwise be told 「動手做」 about a change that only needs looking at. They
     * retract on the next scan, but 「otherwise correct until the scan catches up」 is not a
     * property worth giving up for one fewer parameter.
     *
     * REMOVE THIS BRANCH when the fleet scan stops producing spans with `category ===
     * 'irreversible'` whose `source.id` contains `ready-for-review` — a one-liner over the
     * spine answers it. Stated as a predicate on purpose: a self-expiring fallback with no
     * written expiry is how dead code becomes code nobody dares delete.
     */
    const url = context ? URL_IN_TEXT.exec(context)?.[0] : undefined
    if (bucket === 'review' || /ready.?for.?review/iu.test(sourceId ?? ''))
      return url ? `人工驗收：${url}` : `人工驗收；入口與細節見 ${carrier ?? 'HANDOFF.md'} 該節`
    return `動手做；細節見 ${carrier ?? 'HANDOFF.md'} 該節，做完把該節收掉`
  }
  if (sourceKind === 'tech-debt') {
    const td = /^TD-\d+/.exec(question)?.[0]
    return `步驟見 ${carrier ?? 'docs/tech-debt.md'}${td ? ` § ${td}` : ''}；做完把該節收掉`
  }
  if (sourceKind === 'tasks') return `做完把 ${carrier ?? '該 tasks.md'} 這項勾掉`
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
  '兩者都不成立（它其實不需要我拍板）就把它從佇列上收掉，並說明為什麼。' +
  '補選項走 `flow amend-options <span_id> --option … --reason …`——就地補上，' +
  'NEVER 改寫問句重問（那會撤回這一題再開一題新的，我這邊看到的是它消失又出現）。'

/**
 * The review-side sibling of `OPTIONS_REQUEST_TEXT`, and fixed wording for the same reason.
 *
 * It names the three fields verbatim instead of asking for "more detail", because 「寫清楚一點」
 * is satisfiable by a paragraph that still costs 20 minutes to act on — which is the shape that
 * produced the measured backlog.
 */
export const EVIDENCE_REQUEST_TEXT =
  '這條等驗收，但我看不到要看什麼，所以驗不了。請在來源檔的這一條下面補三行：' +
  '「改了什麼: <一句>」、「證據: <可點的東西——preview URL / commit hash / repo 相對路徑>」、' +
  '「退回會怎樣: <一句>」。' +
  '證據 NEVER 寫「見 HANDOFF」或只寫 change 名字——那要我自己去翻，正是這條契約要刪掉的成本。' +
  '若這條其實不需要我驗收，就把它從 Ready for review 移走，並說明為什麼。'

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
  // 有互動決策頁的題**本來就沒有** `options[]`：選項是頁面上的卡片，帶著色票、comp 與
  // trade-off 一起讀。少了這一行，每一題 `/design` 的決策都會頂著一個「這題缺選項、要退回給
  // agent 補」的警告框出現 —— 而那個退回會要求把卡片壓成一行字，正好毀掉它要問的東西。
  if (readQuestionPageRef(payload)) return false
  const options = Array.isArray(payload.options) ? payload.options : []
  if (options.length > 0) return false
  return notes.at(-1)?.direction !== 'request'
}

/**
 * Whether this review has nothing on it worth looking at yet.
 *
 * Reads the `missing-evidence` LINT rather than re-deriving the answer from the body. The scan
 * already decided this, `driftOf` already compares lint, and a second detector here would be a
 * parallel copy that drifts — the failure `LINT_NOTES` exists to avoid on the render side.
 *
 * NEVER add `needsOptions`'s clarification guard here, however symmetrical the two look. That
 * guard exists to stop a second identical REQUEST, and the review side never issues one: the
 * hand-back fires once, in `syncDecisions`'s open branch, keyed on the lint. What the guard would
 * do instead is drop this flag the moment the row is handed back — and unlike a ruling, whose
 * radio then covers an EMPTY option array, a review's 通過／退回 are synthesised by the scanner
 * and always present. The result is a pressable 通過 against zero evidence, with
 * `handedBackCount`'s 「切到條列去看 →」 pointing right at it.
 *
 * The invariant is 「沒有證據時不渲染通過」. 「flag 為 true 時不渲染通過」 is a different and
 * weaker claim, satisfiable by making the flag false — see `flow-decisions.test.ts`
 * 「STAYS true after the hand-back」.
 */
function needsEvidence(payload: Record<string, unknown>, category: string): boolean {
  if (category !== 'review') return false
  const lint = Array.isArray(payload.lint) ? payload.lint.map(String) : []
  return lint.includes('missing-evidence')
}

/**
 * 驗收合成題 —— `done` 但還沒被裁決的 work item，長成佇列上的一題。
 *
 * `work.accept` / `work.drop` 的硬約束是「NEVER 由 agent 代按」，而實測 `accepted 0 / dropped 0`：
 * 契約守住了，人卻一次都沒按過。成因不是不同意，是**呈現面錯位** —— 那兩顆按鈕活在 `/flow`
 * 這種等人來訪的頁面上，而 `\my` 與 session-start 一直在餵的是 `/decisions` 這條推式問答。
 * 拉式頁面 + 按鈕 = `answeredAt` 全 null 的形狀；同一個判決搬到推式問答就是已驗證有效的形狀。
 *
 * 所以這裡合成的是**題**，不是按鈕：既有的 pending builder 生一列 `review`，`flow pending`
 * 與 `/decisions` 照原樣渲染，人回 A/B/C，`answerDecision` 才依**人的答案** emit `work.accept`。
 * 授權結構與原來那顆按鈕一模一樣（按的仍是人），變的只有它出現在哪裡。
 *
 * 三個因此成立的性質，NEVER 在任何一端把它們拆開：
 *
 *   1. 純投影、零寫入。這一列完全由 `state === 'done'` 導出，被裁決之後 `state` 變成
 *      `accepted` / `dropped`，這一列自己就消失 —— 不需要任何 dedup 表，也不需要撤回事件。
 *      board 因此可以是 100% read-only，一個寫入動作都沒有。
 *   2. `verification` 全文掛在**推薦選項**上，因為那正是「要不要按這一個」的判斷依據。
 *   3. 但它是**材料，NEVER 是免驗通行證**。渲染它不代表可以跳過重驗 —— 見
 *      `tasks/2026-08-28-flow-board-shared-state-layer.md` § 硬判準：spine 可信的是「發生過」，
 *      憑證是否仍為真 MUST 實跑。那句話掛在 `action` 上，`/decisions` 逐字印它；
 *      `flow pending` 的 `Qn` 迴圈目前只對非可答桶印 action，所以 CLI 這一面還看不到 ——
 *      渲染端在 `flow.ts`，不在這裡改。
 */
export const ACCEPT_SPAN_PREFIX = 'accept:'

/** 合成題的 span id。不是脊椎上的 span——它是 `work_id` 的可定址別名，寫入端據此分流。 */
export function acceptSpanId(workId: string): string {
  return `${ACCEPT_SPAN_PREFIX}${workId}`
}

/** 反解。非合成題回 null，所以呼叫端一個 if 就分流得掉，NEVER 各自比對前綴字串。 */
export function parseAcceptSpanId(spanId: string): string | null {
  if (!spanId.startsWith(ACCEPT_SPAN_PREFIX)) return null
  return spanId.slice(ACCEPT_SPAN_PREFIX.length).trim() || null
}

export type AcceptVerdict = 'accept' | 'drop' | 'defer'

/**
 * 選項文字的 SoT。渲染端只讀不寫，判讀端（`answer.ts`）只用 `acceptVerdictOf`。
 *
 * `verification` 進推薦選項而不是進問句：問句要一行、要數得出有幾題（`flow pending` 對它跑
 * `oneLine(…, 78)`），而選項不截斷。截斷過的證據比沒有證據更糟——它看起來像已經給過了。
 */
const VERIFICATION_MAX = 300

export function acceptOptions(verification: string | null): string[] {
  const raw = (verification ?? '').replace(/\s+/gu, ' ').trim()
  const evidence =
    raw.length === 0
      ? '(沒有記下驗證——這條現在驗不了)'
      : raw.length > VERIFICATION_MAX
        ? `${raw.slice(0, VERIFICATION_MAX - 1)}…（全文見 flow status --json）`
        : raw
  return [
    `收 —— 結案，state 進 accepted，這一列從佇列上消失。驗證：${evidence}`,
    'drop —— 寫掉不收，state 進 dropped，同樣不再出現',
    '還沒 —— 什麼都不寫，下次還會問',
  ]
}

/**
 * 人的答案 → 判決。認字母也認詞，因為兩個入口的答法本來就不同：`\my` 回 `Q1A`，
 * `/decisions` 送的是整串選項原文。
 *
 * 認不出來就回 null，NEVER 猜。猜錯的那一次寫下去的是一個**終態**——`accepted` 之後沒有任何
 * 東西會再改它，而人以為自己說的是「還沒」。
 */
export function acceptVerdictOf(answer: string): AcceptVerdict | null {
  const text = String(answer ?? '').trim()
  if (!text) return null
  const letter = /^([ABCabc])\b[.．、)）]?/u.exec(text)?.[1]?.toUpperCase()
  if (letter === 'A') return 'accept'
  if (letter === 'B') return 'drop'
  if (letter === 'C') return 'defer'
  if (text.startsWith('收')) return 'accept'
  if (/^(drop|寫掉|不收)/iu.test(text)) return 'drop'
  if (/^(還沒|defer|等等|先不)/iu.test(text)) return 'defer'
  return null
}

/**
 * 驗收前 MUST 重跑驗證，NEVER 只信選項上那行字。
 *
 * 這一行印在題目底下（`review` 桶的 action 線），因為讀者手上唯一的材料就是那段 verification，
 * 而那段是**過去式的宣稱**。spine 可信的是「發生過」，「現在是」照舊實跑。
 */
const ACCEPT_ACTION =
  '驗收前重跑選項上那段 verification 指的驗證——spine 記得住「宣稱過」，記不住「現在仍為真」'

/** 合成一列。`repo` 由呼叫端帶，因為 `WorkItem` 是 per-repo fold 出來的，自己不知道自己在哪。 */
function acceptRow(item: WorkItem, repo: string | null, now: number): AskedDecision {
  const name = item.title ?? item.slug ?? item.work_id
  const verification = item.verification?.trim() ? item.verification : null
  return {
    span_id: acceptSpanId(item.work_id),
    work_id: item.work_id,
    repo,
    asked_at: item.done_ts ?? item.last_ts,
    actor: item.verified_by ?? 'unknown',
    substrate: 'synthetic',
    age_minutes: ageMinutes(item.done_ts, now),
    question: `${name} 驗收？`,
    options: acceptOptions(verification),
    recommended: acceptOptions(verification)[0] ?? null,
    category: 'review',
    bucket: 'review',
    action: ACCEPT_ACTION,
    carrier: null,
    // 「問題全文」那一格要的就是這個。選項那份會被 `VERIFICATION_MAX` 截，這一份不會。
    context: verification,
    // Truthy，因為這一列**有**耐久的家（脊椎上的 `work.done`），不是只存在於對話裡。
    source_kind: 'work-accept',
    clarifications: [],
    awaiting_clarification: false,
    needs_options: false,
    // 合成列沒有 question page，也不該有：那個欄位記的是「這一題在哪個 serve-question 頁被問」，
    // 而驗收題是從 spine 的 `work.done` 摺出來的，從來沒有被誰在頁面上問過。null 是事實不是佔位。
    question_page: null,
    // 既有機制原樣用：沒有 verification 的 done 就是「看不到要看什麼」，與 handoff 那半同一格。
    needs_evidence: verification === null,
    lint: verification === null ? ['missing-evidence'] : [],
  }
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
      const bucket = bucketOf(category)
      const question = str(payload.question, '(沒有記下問題)')
      const carrier = typeof payload.carrier === 'string' ? payload.carrier : null
      const context = readContext(payload)
      const source = (payload.source ?? null) as { kind?: unknown; id?: unknown } | null
      const sourceKind = source && typeof source.kind === 'string' ? source.kind : null
      const sourceId = source && typeof source.id === 'string' ? source.id : null
      asked.push({
        span_id: span.span_id,
        work_id: span.work_id,
        repo,
        asked_at: span.start_ts ?? '',
        actor: span.actor,
        substrate: span.substrate,
        age_minutes: ageMinutes(span.start_ts, now),
        question,
        options: Array.isArray(payload.options) ? payload.options.map((o) => String(o)) : [],
        recommended: typeof payload.recommended === 'string' ? payload.recommended : null,
        category,
        bucket,
        action: actionOf(bucket, sourceKind, sourceId, question, context, carrier),
        carrier,
        source_kind: sourceKind,
        context,
        clarifications: notes,
        awaiting_clarification: notes.at(-1)?.direction === 'request',
        needs_options: needsOptions(payload, notes, category),
        needs_evidence: needsEvidence(payload, category),
        question_page: readQuestionPageRef(payload),
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

    // 驗收合成題，per-repo 因為 work id 跨 repo 會撞（同 `groupByRepo` 的理由）。
    //
    // 放在最後、與另外兩桶同一層：它是第三個「什麼還沒發生」的來源，不是第一桶的變體。
    // 它不讀 `asked` 也不被 `asked` 讀——被裁決之後 `state` 就不是 `done`，這一列自己消失。
    for (const item of buildWorkItems(repoSpans)) {
      if (item.state !== 'done') continue
      asked.push(acceptRow(item, repo, now))
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
