// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/decision-sync.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/decision-sync.ts
// clade flow spine — reconciling the file sources against the decision queue
//
// `decision-sources.ts` reads the four files and returns objects. This is the only thing that
// turns those objects into spans, and the only thing that closes them again. The split matters:
// the parsers can be tested against fixture text, and the write path has exactly one entry point
// to reason about.
//
// The whole design is one invariant:
//
//   A SOURCE ITEM MAPS TO AT MOST ONE OPEN SPAN, FOR AS LONG AS IT EXISTS IN THE FILE.
//
// A scan runs every 60 seconds. Getting that wrong does not produce a subtle bug — it produces a
// queue that grows by thirty rows a minute and a phone that buzzes forever. So the reconciliation
// is keyed on `source_id`, which `decision-sources.ts` derives from identity (file + title) and
// NEVER from content, and it asks the spine rather than keeping a local ledger. A second ledger
// would be a second answer to "has this been asked", and the two would drift the first time a
// question was answered anywhere else.
//
// Three transitions, and only three:
//
//   in file, never answered → open a decision.request
//   on spine, not in file   → close it as RETRACTED (never as answered — see below)
//   in both                 → leave the QUESTION alone; amend its payload if what the file now
//                             says differs from what the queue is rendering. See `driftOf`.
//   in file, ALREADY ANSWERED → leave it alone. See `answeredSourceIds`.
//
// The amend transition is not a fourth way to ask something. `source_id` still decides identity,
// and a question keeps its span for as long as its identity holds — what amending fixes is the
// case where the payload was written by something since corrected, most of all a parser that
// could not read the option shape the fleet actually writes. Without it an append-only spine can
// never carry a parser fix backwards, and every question asked before the fix keeps the broken
// rendering for as long as it stays open.
//
// The retraction distinction is load-bearing. When Charles edits HANDOFF.md by hand and deletes a
// bullet, that item is gone but it was not *answered*. Closing it with `answered_by: 'source-scan'`
// and a `retracted: true` payload keeps the two apart, so the queue can stop showing it without
// anything later reading it as a ruling Charles made.
//
// Propagation constraint: `vendor/scripts/flow/` is copied wholesale to every consumer, so this
// file may import ONLY `node:*` and siblings in this directory.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { scanDecisionSources, type SourceItem } from './decision-sources.ts'
import {
  EVIDENCE_REQUEST_TEXT,
  OPTIONS_REQUEST_TEXT,
  REVIEW_SURFACE_REQUEST_TEXT,
} from './decisions.ts'
import {
  amendDecision,
  answerClarification,
  pendingDecisions,
  readEvents,
  requestClarification,
  requestDecision,
  resolveDecision,
  workIdFromIdentity,
} from './emit.ts'

export interface SyncAction {
  type: 'open' | 'retract' | 'amend'
  source_id: string
  span_id: string | null
  question: string
  category: string
}

export interface SyncResult {
  repo: string
  /** Everything the files currently say is waiting. */
  scanned: number
  /** Open spans that came from a scan (i.e. carry `payload.source`). */
  tracked: number
  actions: SyncAction[]
  /**
   * Opens that were reported by the emitter but are NOT on the spine afterwards.
   *
   * `startSpan` discards the result of `emitEvent`, so `requestDecision` hands back a handle even
   * when the event was rejected (a substrate outside the schema enum, a redaction failure). Left
   * unchecked that is an invisible infinite loop: every scan "opens" the same question, every
   * scan writes nothing, and the queue stays empty while the log says it is working. Verified
   * against the spine rather than trusted, and named here when it does not hold.
   */
  unwritten: string[]
  /**
   * Source items skipped because a human already answered them (`answeredSourceIds`).
   *
   * Named rather than silent: this is the count of rows the queue is deliberately NOT showing,
   * and a number that climbs without bound means answers are landing but nobody is deleting the
   * source bullets — a different problem than the one this suppression fixes.
   */
  suppressed: number
  /**
   * Open questions whose rendered payload was corrected in place this run (`driftOf`).
   *
   * Counted separately from `open` because it answers a different question: `open` is how much
   * new work arrived, this is how much of what was already on the queue was being shown WRONG.
   * A number that is large once is a parser fix reaching the backlog — which is what it was
   * built for. One that stays large every run means the drift check and the scanner disagree
   * about what the payload should be, and the queue is rewriting itself in a loop.
   */
  amended: number
  /**
   * Rulings opened this run that arrived with no options, and were handed straight back.
   *
   * `\my` requires every ruling to carry 2–4 ordered options, and `extractOptions` refuses to
   * guess from prose. A bullet written without them therefore lands on the queue unanswerable —
   * and the page's free-text box makes that look like a question rather than an unfinished one.
   * Opening it and immediately asking for options puts the ball where the missing work is, at the
   * moment the gap appears, instead of leaving it for whoever next opens the page on a phone.
   *
   * Counted rather than silent: a number that stays high means entries keep being written against
   * the contract, which is a writing problem no amount of asking will fix.
   */
  options_requested: number
  /**
   * Reviews opened this run that arrived with no openable evidence, and were handed straight back.
   *
   * The review-side twin of `options_requested`, and read the same way: a number that stays high
   * means entries keep being written against the contract, which is a writing problem no amount
   * of asking will fix — escalate to the rule, not to more requests.
   */
  evidence_requested: number
  /**
   * Rows opened this run that restated a live change's `## 人工檢查`, and were handed straight back.
   *
   * Unlike its two siblings this one counts a ROUTING mistake, not a writing one: the row is not
   * badly written, it is filed on a surface that cannot act on it. A number that stays high means
   * changes keep failing to reach the /review inbox and authors keep routing around that — so the
   * thing to fix is the bucket the changes are stuck in, NEVER the wording of the rows.
   */
  review_surface_requested: number
  /** Reasons this repo produced nothing, when that is not simply "nothing to do". */
  skipped: string | null
}

/** The marker that separates a scanned decision from one an agent asked by hand. */
interface SourceStamp {
  id: string
  kind: string
  fingerprint: string
}

function stampOf(decision: Record<string, unknown>): SourceStamp | null {
  const source = decision.source
  if (!source || typeof source !== 'object') return null
  const s = source as Record<string, unknown>
  if (typeof s.id !== 'string') return null
  return {
    id: s.id,
    kind: typeof s.kind === 'string' ? s.kind : 'unknown',
    fingerprint: typeof s.fingerprint === 'string' ? s.fingerprint : '',
  }
}

/**
 * Source items a human has already ruled on.
 *
 * THE REASON THIS EXISTS: answering does not remove the source bullet. `answer.ts` APPENDS the
 * ruling to the carrier the question named — the `- [ ]` line in HANDOFF.md that produced the
 * question is still there afterwards, verbatim. So to a scan that only asks `pendingDecisions`,
 * an answered question is indistinguishable from a brand-new one: in the file, not on the spine,
 * therefore open it. The result is not a stale row — it is a LOOP. Charles answers, the span
 * closes, the next 60-second scan re-opens the identical question under a new span id, and the
 * page he reloads shows it unanswered again, forever.
 *
 * Measured on <consumer-b> 2026-08-27: source id `handoff:HANDOFF.md#…main-push-被-provenance-gate-擋`
 * opened as 8b0102 → answered 04:33:13 via review-gui → re-opened 04:33:20 (7 seconds) → answered
 * 04:40:17 → re-opened 04:41:02. Two rulings recorded, question still pending, and nothing in
 * either view said why.
 *
 * A RETRACTION IS NOT AN ANSWER, and is deliberately excluded: an item deleted from the file and
 * later written back is a question being asked again, and MUST re-open. Only a real close — one
 * carrying a human's ruling — suppresses.
 *
 * Consequence worth stating: once answered, an item never re-asks while it keeps the same
 * `source_id`. `source_id` is derived from identity (file + title), so re-asking is done by
 * changing the title — which is also what makes it a different question to every other reader.
 */
function answeredSourceIds(repoRoot: string): Set<string> {
  const events = readEvents(repoRoot) as unknown as Record<string, unknown>[]

  // The stamp lives on the START event; the ruling lives on the END. Join them on span id.
  const sourceBySpan = new Map<string, string>()
  for (const event of events) {
    if (event.kind !== 'decision.request' || event.phase !== 'start') continue
    const stamp = stampOf((event.payload ?? {}) as Record<string, unknown>)
    if (stamp) sourceBySpan.set(String(event.span_id), stamp.id)
  }

  const answered = new Set<string>()
  for (const event of events) {
    if (event.kind !== 'decision.request' || event.phase !== 'end') continue
    const sourceId = sourceBySpan.get(String(event.span_id))
    if (!sourceId) continue
    if (((event.payload ?? {}) as Record<string, unknown>).retracted === true) continue
    answered.add(sourceId)
  }
  return answered
}

/**
 * The other half of `OPTIONS_REQUEST_TEXT`: the options asked for are now there.
 *
 * Written as a RESPONSE on the same thread rather than as silence. The request that stands next
 * to it says 「這題沒有選項，我答不了」, and `needsOptions` treats a pending request as "ball on
 * the agent side" — so a question that quietly grew options would keep rendering as blocked on
 * somebody else while being perfectly answerable.
 */
const OPTIONS_FILLED_TEXT = '選項已補上（來源檔重掃後解析出 A/B/C）。這題現在可以直接回覆選項字母。'

/**
 * What, if anything, an open question is rendering that its source no longer says.
 *
 * Returns a human-readable reason, or `null` when the queue and the file agree. The reason is
 * stored on the amendment: an audit that finds a question whose options changed under it MUST be
 * able to read why without re-deriving anything.
 *
 * COMPARES THE DERIVED PAYLOAD, NEVER THE SOURCE FINGERPRINT. The fingerprint hashes the source
 * TEXT, and the failure this exists for does not touch the text: on 2026-08-27 the parser was
 * widened to read the bold option shape the fleet actually writes, and every question asked
 * before that kept `options: []` while its file was unchanged — identical fingerprint, different
 * meaning. A fingerprint check would have reported "nothing to do" on exactly the backlog it was
 * added to repair.
 *
 * Deliberately narrow — options and the recommendation, nothing else.
 *
 * WORDING IS NOT COMPARED, and NEVER may be. `leaves a reworded question alone rather than
 * re-asking it` is a tested contract, and it is about more than the span id: an edit to a
 * HANDOFF bullet is the most common write in the fleet, and making each one emit an event would
 * turn the spine into an edit log of files git already versions. A reworded question keeps its
 * span AND its text; what the queue owes the reader is the CHOICE being current, not the prose.
 *
 * Category is not compared either: a question that changed bucket is a different question, and
 * quietly re-filing it would move a row between the four `\my` buckets with no record. When a
 * source's category changes the honest outcome already happens — the old id stops being emitted
 * and retracts, the new one opens.
 */
function driftOf(rendered: Record<string, unknown>, item: SourceItem): string | null {
  const shown = Array.isArray(rendered.options) ? rendered.options.map(String) : []
  const reasons: string[] = []
  if (shown.join('\u0000') !== item.options.join('\u0000')) {
    reasons.push(
      shown.length === 0
        ? `來源解析出 ${item.options.length} 個選項，佇列上是 0 個`
        : `選項由 ${shown.length} 個變成 ${item.options.length} 個`,
    )
  }
  const shownRecommended = typeof rendered.recommended === 'string' ? rendered.recommended : null
  if (shownRecommended !== item.recommended) reasons.push('推薦項改變')
  // A warning that outlives the thing it warns about is worse than none: it teaches the reader
  // that the marks are noise. So a bullet rewritten into shape clears its lint on the next scan,
  // through the same amend path that carries options.
  const shownLint = Array.isArray(rendered.lint) ? rendered.lint.map(String) : []
  if (shownLint.join('\u0000') !== item.lint.join('\u0000')) reasons.push('寫法警示改變')
  return reasons.length > 0 ? reasons.join('；') : null
}

/**
 * Reconcile one repo.
 *
 * `dryRun` computes the identical action list and writes nothing — that is what the CLI shows
 * before anyone lets this near a real spine, and what the tests assert on.
 */
export function syncDecisions({
  repoRoot,
  dryRun = false,
  actor = 'source-scan',
}: {
  repoRoot: string
  dryRun?: boolean
  actor?: string
}): SyncResult {
  const result: SyncResult = {
    repo: repoRoot,
    scanned: 0,
    tracked: 0,
    actions: [],
    unwritten: [],
    suppressed: 0,
    amended: 0,
    options_requested: 0,
    evidence_requested: 0,
    review_surface_requested: 0,
    skipped: null,
  }

  /**
   * `CLADE_FLOW_EVENTS` pins every repo's spine onto one file. Under it, "the open decisions in
   * this repo" is not a question this function can answer — it would read another repo's spans,
   * find no matching source, and retract them. Refuse rather than corrupt.
   *
   * Same refusal `answer.ts` makes for the same reason (`spine-override`).
   */
  if (process.env.CLADE_FLOW_EVENTS && !process.env.CLADE_FLOW_SYNC_ALLOW_OVERRIDE) {
    result.skipped = 'CLADE_FLOW_EVENTS 把所有 repo 的 spine 指向同一個檔，對帳會誤刪別 repo 的題'
    return result
  }

  const items = scanDecisionSources(repoRoot)
  result.scanned = items.length

  const bySourceId = new Map<string, SourceItem>()
  for (const item of items) bySourceId.set(item.source_id, item)

  // `pendingDecisions` already folds amendments, so `rendered` is what the page shows right now,
  // not what the start event said. That is what makes the drift check idempotent: once amended,
  // the next scan compares against the corrected payload and finds nothing to do.
  const open = pendingDecisions(repoRoot) as unknown as Record<string, unknown>[]
  const openBySourceId = new Map<
    string,
    { span_id: string; stamp: SourceStamp; rendered: Record<string, unknown> }
  >()
  for (const decision of open) {
    const stamp = stampOf(decision)
    if (!stamp) continue // asked by hand — never this function's to close.
    openBySourceId.set(stamp.id, { span_id: String(decision.span_id), stamp, rendered: decision })
  }
  result.tracked = openBySourceId.size

  const answered = answeredSourceIds(repoRoot)

  // 1. New in the files.
  for (const item of items) {
    const alreadyOpen = openBySourceId.get(item.source_id)
    if (alreadyOpen) {
      // 1b. Open already, but rendering something the files no longer say.
      const drift = driftOf(alreadyOpen.rendered, item)
      if (!drift) continue
      let written = true
      if (!dryRun) {
        const amendment = amendDecision({
          spanId: alreadyOpen.span_id,
          options: item.options,
          recommended: item.recommended,
          detail: item.detail,
          lint: item.lint,
          fingerprint: item.fingerprint,
          reason: drift,
          actor,
          cwd: repoRoot,
        })
        written = amendment.written === true
        /**
         * An amendment that FILLS IN the options is the moment a handed-back ruling becomes
         * answerable. Say so on the thread: the outstanding request is 「這題沒有選項，我答不了」,
         * and leaving it standing next to a question that now has options makes the ball look
         * like it is still on the agent side when it is not.
         */
        if (
          written &&
          item.category === 'ruling' &&
          item.options.length > 0 &&
          (alreadyOpen.rendered.options as unknown[] | undefined)?.length === 0
        ) {
          answerClarification({
            spanId: alreadyOpen.span_id,
            text: OPTIONS_FILLED_TEXT,
            actor,
            cwd: repoRoot,
          })
        }
      }
      if (!written) {
        result.unwritten.push(item.source_id)
        continue
      }
      result.amended += 1
      result.actions.push({
        type: 'amend',
        source_id: item.source_id,
        span_id: alreadyOpen.span_id,
        question: item.question,
        category: item.category,
      })
      continue
    }
    // Answered, and the bullet simply was never deleted. NEVER re-ask — see `answeredSourceIds`.
    if (answered.has(item.source_id)) {
      result.suppressed += 1
      continue
    }
    let spanId: string | null = null
    if (!dryRun) {
      const handle = requestDecision({
        question: item.question,
        options: item.options,
        recommended: item.recommended,
        category: item.category,
        carrier: item.carrier,
        // A scanned question is its own work item, and `source_id` is already its stable
        // identity (file + title) — the same key the dedup above is keyed on. Leaving this
        // null let `resolveWorkId` mint an orphan on every hook-driven scan, because a hook
        // has no ambient CLADE_WORK_ID: measured 2026-08-28, this was the only entry point
        // still minting orphans after the dispatch adapters were fixed (TD-684).
        work_id: workIdFromIdentity(item.source_id),
        actor,
        substrate: 'file-scan',
        payload: {
          detail: item.detail,
          // Carried onto the span so both surfaces read the SAME verdict. Recomputing it at
          // render time would need the source file, which the page does not have and the phone
          // certainly does not.
          lint: item.lint,
          source: {
            id: item.source_id,
            kind: item.source_kind,
            fingerprint: item.fingerprint,
          },
        },
        cwd: repoRoot,
      })
      spanId = handle.span_id

      /**
       * A ruling with no options is unanswerable the moment it opens — hand it back now.
       *
       * NEVER wait for somebody to notice on the page: the page is read on a phone, and the one
       * move that helps (ask for options) is the one that costs the most to type there. Doing it
       * here means the gap is worked while the writing is still fresh, and the person who opens
       * the queue next sees either options or a visible "球在 agent 手上", never a text box
       * pretending the question is finished.
       *
       * Only `ruling`: the other buckets are states, and options on a state would be an answer
       * sheet for something nobody asked.
       */
      if (item.category === 'ruling' && item.options.length === 0) {
        const asked = requestClarification({
          spanId,
          text: OPTIONS_REQUEST_TEXT,
          actor,
          cwd: repoRoot,
        })
        if (asked.written) result.options_requested += 1
      }

      /*
       * Same move for a review that arrived with nothing to look at.
       *
       * Keyed on the LINT the scan already computed, never on a second evidence check here — one
       * detector, one verdict. `lintOf` is the only thing that decides what "has evidence" means.
       */
      if (item.category === 'review' && item.lint.includes('missing-evidence')) {
        const asked = requestClarification({
          spanId,
          text: EVIDENCE_REQUEST_TEXT,
          actor,
          cwd: repoRoot,
        })
        if (asked.written) result.evidence_requested += 1
      }

      /*
       * And for a row that belongs on /review. Keyed on the lint for the same reason as above —
       * one detector, one verdict — and deliberately NOT gated on category: the restatement is a
       * routing mistake, and it is the same mistake whether its author filed it as a doing
       * (`## 需要 Charles 執行`) or as a thing to sign off (`## Ready for review`).
       */
      if (item.lint.includes('belongs-on-review')) {
        const asked = requestClarification({
          spanId,
          text: REVIEW_SURFACE_REQUEST_TEXT,
          actor,
          cwd: repoRoot,
        })
        if (asked.written) result.review_surface_requested += 1
      }
    }
    result.actions.push({
      type: 'open',
      source_id: item.source_id,
      span_id: spanId,
      question: item.question,
      category: item.category,
    })
  }

  // 2. Gone from the files.
  for (const [sourceId, { span_id }] of openBySourceId) {
    if (bySourceId.has(sourceId)) continue
    if (!dryRun) {
      resolveDecision(span_id, {
        answer: '(來源條目已從檔案消失)',
        answeredBy: actor,
        // NOT an answer. Every reader that reports "what did Charles decide" MUST check this.
        payload: { retracted: true, retracted_source: sourceId },
        cwd: repoRoot,
      })
    }
    result.actions.push({
      type: 'retract',
      source_id: sourceId,
      span_id,
      question: '',
      category: '',
    })
  }

  // 2b. Verify. Anything reported open that the spine does not have is named, never assumed.
  if (!dryRun) {
    const landed = new Set(
      (pendingDecisions(repoRoot) as unknown as Record<string, unknown>[])
        .map((decision) => stampOf(decision)?.id)
        .filter((id): id is string => typeof id === 'string'),
    )
    for (const action of result.actions) {
      if (action.type !== 'open') continue
      if (!landed.has(action.source_id)) result.unwritten.push(action.source_id)
    }
  }

  // 3. Present in both — deliberately no branch. A reworded question is the same question, and
  //    re-opening it would re-notify. The stale wording on the span is the price, and it is
  //    cheaper than a queue that churns every time somebody fixes a typo in HANDOFF.md.

  return result
}

/**
 * The fleet roster, read the same way `fleet.ts` reads it.
 *
 * Duplicated rather than imported because `fleet.ts` folds the roster into a snapshot build; all
 * that is needed here is the list of roots. The duplication is two lines and pinned by the test,
 * which is the same trade `fleet.ts` documents for its own copy.
 */
export function fleetRoots(cladeRoot: string): string[] {
  const rosterPath = join(cladeRoot, 'consumers.local')
  const roots = [cladeRoot]
  if (!existsSync(rosterPath)) return roots
  for (const rawLine of readFileSync(rosterPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const root = line.split(/\s+/)[0]
    if (root) roots.push(root)
  }
  return [...new Set(roots)]
}

export function syncFleet({
  cladeRoot,
  dryRun = false,
}: {
  cladeRoot: string
  dryRun?: boolean
}): SyncResult[] {
  return fleetRoots(cladeRoot).map((root) => {
    try {
      return syncDecisions({ repoRoot: root, dryRun })
    } catch (error) {
      // A repo that cannot be read is NAMED, never silently dropped — same rule `fleet.ts` holds.
      return {
        repo: root,
        scanned: 0,
        tracked: 0,
        actions: [],
        unwritten: [],
        suppressed: 0,
        amended: 0,
        options_requested: 0,
        evidence_requested: 0,
        review_surface_requested: 0,
        skipped: error instanceof Error ? error.message : String(error),
      }
    }
  })
}
