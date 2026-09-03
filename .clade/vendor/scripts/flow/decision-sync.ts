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

import { LINT_NOTES, scanDecisionSources, type SourceItem } from './decision-sources.ts'
import {
  amendDecision,
  pendingDecisions,
  readEvents,
  requestDecision,
  resolveDecision,
  workIdFromIdentity,
} from './emit.ts'

/**
 * 寫法不合契約就**不鑄 span**（TD-904，Charles 2026-09-03 拍板）。
 *
 * 這兩碼的共同點不是「寫得不夠好」，是**這一列在佇列上不成立**：一條沒有選項的拍板題渲染出來
 * 是一個空白輸入框，一條沒有三欄的驗收題渲染出來是一顆按得下去的「通過」配零證據。兩者都不是
 * 問題，是**沒寫完的問題**，而佇列的收件人是一個拿著手機、無法補件的人。
 *
 * 在這之前的做法是**先鑄再退**：開好 span，再用兩個固定模板（要選項／要三欄證據）對著它寫一則
 * `decision.clarify`，要求某個 agent 回來補。Charles 逐字的裁定是「這是治標」——
 * 那個做法把一條寫壞的 bullet 變成**手機上一張不是他打的字**，而佇列本來就只該有他要回答的東西。
 * 2026-09-03 實測 /decisions 上這類注入文字的量已經多過真正的題。
 *
 * 所以退件發生在 ingest：不鑄 span、不寫任何事件，改由 `flow sources` 與 `handoff-scan` 對
 * **來源檔的作者**印一行「哪一條、在哪一行、缺什麼」。收件人從此是能修的那個人。
 *
 * `belongs-on-review` 刻意不在這裡。那一碼是**路由**錯誤不是寫法錯誤——列本身寫得好好的，只是
 * 該由 /review 收；它照樣鑄 span（否則那列會靜默消失），只是不再被注入任何文字，`lint` 帶著的
 * `LINT_NOTES` 已經在兩個渲染端說清楚了。
 *
 * `near-miss-option-line` 同樣不在這裡：它是**評語**，一條差一點就解析成功的寫法。它單獨出現時
 * 那一列仍然可答（非 ruling 的桶），拿它擋 ingest 會把評語升級成拒收。
 */
export const REJECTING_LINTS = ['no-options-under-ruling', 'missing-evidence'] as const

/** 一條被 ingest 退回的來源條目 —— 它**不在**佇列上，所以這裡是它唯一的載體。 */
export interface RejectedItem {
  source_id: string
  question: string
  category: string
  /** Repo-relative carrier path. */
  carrier: string
  /** 1-based line in `carrier`, or 0 when the source is not a file (see `SourceItem.line`). */
  line: number
  /** 命中的退件碼。 */
  lint: string[]
  /** 那幾碼對作者說的話 —— 借 `LINT_NOTES`，**NEVER** 在這裡重寫一份。 */
  notes: string[]
}

function rejectingLintsOf(item: SourceItem): string[] {
  return (REJECTING_LINTS as readonly string[]).filter((code) => item.lint.includes(code as never))
}

export interface SyncAction {
  type: 'open' | 'retract' | 'amend' | 'self-closed'
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
   * 來源條目自己寫著已經結案，卻還留在待拍板段（`self-closed` lint）。
   *
   * 與 `suppressed` 分開數，因為要做的事不同：`suppressed` 是人已經答過了、只是 bullet 沒刪，
   * 那是**答題端**的殘留；這一格是**寫的人**把一段結論留在了問題區，而它會一直被重新掃到。
   * 數字報出來的收件人是下一個編那份檔的 agent，`handoff-scan` 逐字轉述它。
   */
  self_closed: number
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
   * 這一趟被 ingest 退回、**因此沒有進佇列**的來源條目（TD-904）。
   *
   * 逐條而不是只給數字：這一格取代的是三個舊計數（`options_requested` / `evidence_requested` /
   * `review_surface_requested`），而那三個數字的收件人**根本不會看到它們** —— 它們數的是寫進
   * 別人手機的注入文字，讀 stdout 的是跑 `flow sources` 的 agent。現在收件人對了（就是那個編
   * 來源檔的人），所以要給的是他修得動的東西：哪一條、第幾行、缺什麼。
   *
   * 空陣列是常態。**NEVER** 讓它靜默 —— 一條被拒收的條目在佇列上沒有任何載體，這裡不印就等於
   * 它從所有畫面上消失了，而那是比一列寫壞的題更糟的失敗。
   */
  rejected: RejectedItem[]
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
    self_closed: 0,
    amended: 0,
    rejected: [],
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

  /**
   * 自述結案的條目**不進佇列**（R2）。
   *
   * 掃描端一路以來只看 heading 分桶、不讀內容，所以一條逐字寫著「已拍板 A」的 bullet 照樣被鑄成
   * 一題。判準在 `decision-sources.ts` 的 `isSelfClosed`——**NEVER** 在這裡再寫一份：兩份會漂，
   * 而漂掉的那一次是一題該問的被吞掉，而它不會有任何訊號。
   */
  const selfClosed = new Map<string, SourceItem>()
  const rejected = new Map<string, SourceItem>()
  const bySourceId = new Map<string, SourceItem>()
  for (const item of items) {
    if (item.lint.includes('self-closed')) {
      selfClosed.set(item.source_id, item)
      continue
    }
    /**
     * 寫法不合契約 → **不鑄 span**（TD-904）。判準借 `item.lint`，**NEVER** 在這裡重判一次
     * 「有沒有選項」「有沒有三欄」：`lintOf` / `hasReviewEvidence` 是唯一的偵測器，第二份會漂，
     * 而漂掉的那一次是一條該被退回的題悄悄進了佇列，或一條寫得好好的題被悄悄擋在門外。
     */
    const codes = rejectingLintsOf(item)
    if (codes.length > 0) {
      rejected.set(item.source_id, item)
      result.rejected.push({
        source_id: item.source_id,
        question: item.question,
        category: item.category,
        carrier: item.carrier,
        line: item.line,
        lint: codes,
        notes: codes.map((code) => LINT_NOTES[code as keyof typeof LINT_NOTES]),
      })
      continue
    }
    bySourceId.set(item.source_id, item)
  }
  result.self_closed = selfClosed.size

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

  // 1. New in the files. 自述結案的那幾條不在這個集合裡，所以它們一開始就不會被鑄成題。
  for (const item of bySourceId.values()) {
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
    }
    result.actions.push({
      type: 'open',
      source_id: item.source_id,
      span_id: spanId,
      question: item.question,
      category: item.category,
    })
  }

  // 2. Gone from the files —— 或者還在，但條目自己說它已經結案了。
  for (const [sourceId, { span_id }] of openBySourceId) {
    if (bySourceId.has(sourceId)) continue
    /**
     * 被退件的條目**不撤回它既有的 span**。
     *
     * 它還在檔案裡，所以「來源已消失」是假的；而 ingest 這一支從來沒有「因為寫得不好就把人正在
     * 看的一題收掉」的授權。TD-904 (4) 把存量交給一次性清理腳本
     * （`purge-injected-decisions.ts`，人下 `--apply`、寫 `decision.dismiss`、carrier 標
     * `dismissed:`），因為那是一個**帶理由、可稽核、一次性**的動作，而不是每 60 秒跑一次的
     * 自動收斂。
     *
     * 代價寫在這裡以免下一個人以為是漏的：一條先前帶著選項開了 span、之後被作者改到剩零個選項
     * 的題，會停在佇列上顯示舊選項。它不會增生（`source_id` 去重照舊），而讓 ingest 有權關掉
     * 人正在讀的題，比這個代價貴得多。
     */
    if (rejected.has(sourceId)) continue
    const closed = selfClosed.get(sourceId)
    if (!dryRun) {
      resolveDecision(span_id, {
        answer: closed ? '(來源條目自述已結案)' : '(來源條目已從檔案消失)',
        answeredBy: actor,
        // NOT an answer. Every reader that reports "what did Charles decide" MUST check this.
        //
        // `self_closed` 與 `retracted` 一起帶：既有的每一個讀者都是查 `retracted`（答案清單、
        // stall），而它們對這兩種情形要做的事一模一樣——不要把它當成 Charles 的裁決。多帶的那個
        // 旗標只回答「為什麼不見了」，NEVER 讓任何讀者改讀它來決定要不要顯示。
        payload: closed
          ? { retracted: true, retracted_source: sourceId, self_closed: true }
          : { retracted: true, retracted_source: sourceId },
        cwd: repoRoot,
      })
    }
    result.actions.push({
      type: closed ? 'self-closed' : 'retract',
      source_id: sourceId,
      span_id,
      question: closed?.question ?? '',
      category: closed?.category ?? '',
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
        self_closed: 0,
        amended: 0,
        rejected: [],
        skipped: error instanceof Error ? error.message : String(error),
      }
    }
  })
}
