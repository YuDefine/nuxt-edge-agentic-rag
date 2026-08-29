// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/decision-sources.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/decision-sources.ts
// clade flow spine — the four FILE sources of `\my`, read into the shape the decision queue speaks
//
// `decisions.ts` projects what is waiting on a human *out of the spine*. That covers exactly one
// of the five sources the `\my` contract names: a question an agent deliberately emitted. The
// other four live in files, and nothing has ever read them into the queue — which is why clade's
// own `HANDOFF.md` carries the line "登在這裡是因為 `\my` 掃 HANDOFF 掃不到 spine". This file
// closes that gap from the other side: the spine learns to see HANDOFF, so the page can.
//
// READ-ONLY, and pure. It opens files and returns objects; it NEVER writes, and it NEVER touches
// the spine. `decision-sync.ts` is the only thing that turns these into spans. Keeping the split
// is what makes the parsers testable against real fixture text instead of against a live repo.
//
// The precision bias is deliberate and asymmetric: a missed item costs one `\my` typed by hand,
// a false one costs a push notification at 3am for something nobody has to decide. So every
// parser here refuses to guess — no option list is invented, no heuristic keyword promotes an
// entry, and a source with no explicit marker contributes nothing.
//
// Propagation constraint (same as every sibling): `vendor/scripts/flow/` is copied wholesale to
// every consumer, so this file may import ONLY `node:*` and siblings in this directory.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The `\my` output buckets, in the order the contract fixes them.
 *
 * The axis is WHOSE MOVE IT IS AND WHAT KIND OF MOVE — never importance, which is unmeasurable
 * and always claims every new entry:
 *
 *   `ruling`        one short reply closes it. Gets a `Qn` number.
 *   `review`        somebody finished something and the verdict IS one short reply (通過／退回).
 *                   Gets a `Qn` number too — see `ANSWERABLE`.
 *   `human-action`  a doing whose end is NOT a reply — hold a phone, press a physical button,
 *                   tick a box somewhere else. A bullet with an action line, never a number.
 *   `other-repo`    somebody else's checkout (legacy; nothing emits it since 2026-08-27).
 *   `loop-structural` the loop hit the same wall repeatedly and a human must change structure.
 *
 * `'irreversible'` was this vocabulary's old name for `human-action`, retired 2026-08-28: it
 * described the heading rule (`Blocked` sections poured in whole) rather than what the reader
 * must DO, and the measured queue was 15 rows of which ~10 were status notes. The spine is
 * append-only, so spans written with the old token still exist — both render surfaces GROUP
 * them into the 要我動手 bucket while leaving the stored `category` field verbatim
 * (`flow-decisions.test.ts` pins the verbatim half).
 *
 * `review` was split back OUT of `human-action` the same day, on a second and orthogonal axis:
 * whether the doing ENDS IN A SHORT REPLY. It is the only member of that set that does — you
 * open the evidence, then you say 通過 or 退回. Leaving it in meant the reader was told where to
 * look and given nowhere to record the verdict, which is half of why 7 rows sat 10.8–16.6h.
 * The other half was that its own bucket printed 「這條是狀態不是問題」 at them.
 */
export type DecisionCategory =
  | 'ruling'
  | 'review'
  | 'other-repo'
  | 'human-action'
  | 'loop-structural'

/**
 * The two answers a review can have, synthesised at SCAN time rather than at render time.
 *
 * A review's choices are not written in the source file and never will be — 「通過 / 退回」 is a
 * property of the verb, not of the change under review. Putting them here means the span payload,
 * `flow pending`, `/decisions` and `\my` all carry the identical pair from one definition; each
 * renderer inventing its own is the two-surfaces-disagree failure `LINT_NOTES` already exists to
 * prevent.
 *
 * 退回 deliberately carries no reason slot of its own: a rejection needs prose, and the free-text
 * path every surface already has is where prose goes. NEVER expand this into a menu of rejection
 * reasons — that is a taxonomy nobody asked for, guessed in advance of the rejection.
 */
export const REVIEW_CHOICES: readonly string[] = ['通過', '退回']

/**
 * The buckets that close on one short reply, and therefore get `Qn` numbers and an input.
 *
 * The admission test is the QnX one — 「回一則短訊即可結案」 — NEVER reversibility and NEVER
 * whether the row feels important. `human-action` fails it not because its rows are weightier
 * but because holding a phone does not end in a sentence.
 */
export const ANSWERABLE: readonly DecisionCategory[] = ['ruling', 'review']

export function isAnswerable(category: string): boolean {
  return (ANSWERABLE as readonly string[]).includes(category)
}

export type SourceKind = 'work-loop' | 'handoff' | 'tech-debt' | 'tasks'

export interface SourceItem {
  source_kind: SourceKind
  /**
   * The dedup key, and the whole reason a 60-second scan does not open the same question forever.
   *
   * MUST be derived from the item's IDENTITY (file + title), NEVER from its text: a question whose
   * wording is edited is the same question, and keying on content would re-ask it on every save.
   */
  source_id: string
  question: string
  /** The body under the question. Rendered as context; never parsed for meaning. */
  detail: string
  options: string[]
  recommended: string | null
  category: DecisionCategory
  /** Repo-relative path the answer gets filed back onto. `answer.ts` resolves and contains it. */
  carrier: string
  /** Content hash. A change here means "same question, reworded" — NEVER a new question. */
  fingerprint: string
  /**
   * What is wrong with the way this item is WRITTEN, in codes the surfaces render.
   *
   * Not errors: every one of these still produces a usable row. They exist because the failure
   * they describe is otherwise SILENT — an author writes what they believe are options, the
   * parser declines to read them, and the page shows a free-text box with nothing anywhere
   * saying a list was refused. The person who could fix it (whoever next edits that file) never
   * finds out, and the person who cannot (Charles, on a phone) is the only one who sees it.
   *
   * Warn-only by design, and NEVER a pre-commit block: HANDOFF.md is a high-frequency living
   * document, and blocking a write on the shape of a bullet buys a bypass flag, not a better
   * bullet. Showing it where the two readers already look costs nobody anything.
   */
  lint: LintCode[]
}

/**
 * `no-options-under-ruling` — a ruling with nothing to choose from. Unanswerable as written.
 * `near-miss-option-line` — lines that ALMOST parsed as options. Somebody meant to write a list.
 * `belongs-on-review` — a HANDOFF row restating a live change's `## 人工檢查`. See `RESTATES_MANUAL_REVIEW`.
 */
export type LintCode =
  | 'no-options-under-ruling'
  | 'near-miss-option-line'
  | 'missing-evidence'
  | 'belongs-on-review'

/**
 * The three fields a `review` row owes its reader, and the shape that makes them machine-checkable.
 *
 * Prose cannot carry this contract: 「這條寫清楚一點」 is unfalsifiable, and the measured rows
 * (`employee-backpay-request —— ready-for-review（r118）`) prove a title can name a change slug
 * and a round number while saying nothing about what it does or what is at stake. Named fields
 * are the cheapest thing an author can satisfy and the only thing a scanner can verify.
 *
 * NEVER relax this to "any one of the three". Each answers a different question the reviewer has
 * to answer before replying, and the row is unreviewable if any is missing: what changed (do I
 * care), what do I look at (can I check it in 30 seconds), what happens if I say no (how hard do
 * I have to look).
 */
const REVIEW_FIELDS = {
  changed: /^[\s>]*[-*]?\s*(?:改了什麼|what changed)\s*[:：]\s*(\S.*)$/imu,
  evidence: /^[\s>]*[-*]?\s*(?:證據|evidence)\s*[:：]\s*(\S.*)$/imu,
  stakes: /^[\s>]*[-*]?\s*(?:退回會怎樣|退回)\s*[:：]\s*(\S.*)$/imu,
} as const

/**
 * What counts as evidence: something the reviewer can OPEN, not something they must go find.
 *
 * A URL, a commit hash, or a repo-relative path with an extension. NEVER accept a bare change
 * name or a pointer to another document — 「見 HANDOFF」 is what the 15 measured rows already
 * said, and chasing it is the 20 minutes this whole contract exists to delete.
 */
const CLICKABLE = /(?:https?:\/\/\S+|\b[0-9a-f]{7,40}\b|(?:[\w.-]+\/)+[\w.-]+\.\w+)/u

/** Whether a `review` body carries all three fields, with evidence that can actually be opened. */
export function hasReviewEvidence(body: string): boolean {
  const evidence = REVIEW_FIELDS.evidence.exec(body)
  if (!evidence || !CLICKABLE.test(evidence[1] ?? '')) return false
  return REVIEW_FIELDS.changed.test(body) && REVIEW_FIELDS.stakes.test(body)
}

/**
 * 每個 lint 碼對讀的人講的那一句話。**兩個渲染端共用這一份**（`flow pending` 的文字模式、
 * `/decisions` 的卡片），理由同 `OPTIONS_REQUEST_TEXT`：同一句話手抄兩次，改的時候只會改到
 * 一半，而兩個渲染端各說各話正是 `rules/core/review-gui-surface.md` MUST 6 要防的。
 *
 * 措辭的收件人是**下一個編那份來源檔的 agent**（「這條是我造成的、該去修哪」），對答題的人
 * 只是一句「這題長這樣不是你看錯」。所以 NEVER 寫成指令或動作——動作那一半是 `needs_options`
 * 的按鈕，這裡只是評語。
 */
export const LINT_NOTES: Record<LintCode, string> = {
  'no-options-under-ruling':
    '來源檔把這題寫成要拍板的題，卻沒有選項、也沒說要給什麼值（見 decision-authoring）',
  'near-miss-option-line':
    '來源檔有幾行差一點就是選項——寫法不合，解析器沒收（見 decision-authoring）',
  'missing-evidence':
    '這條等驗收，但沒寫齊「改了什麼 / 證據 / 退回會怎樣」三欄，證據要可點（見 decision-authoring）',
  'belongs-on-review':
    '這條指向的 change 還有沒勾的 `[review:ui]`——那是要人在瀏覽器逐條驗的，verdict 落在 /review inbox 與 tasks.md 的 checkbox，不是這裡的一句「通過」（見 decision-authoring）',
}

/**
 * The lint codes one parsed item earns.
 *
 * Only `ruling` can earn `no-options-under-ruling`: `review` gets its pair synthesised and the
 * rest are doings and states, so options on those would be an answer sheet for something nobody
 * asked. `near-miss-option-line`
 * applies wherever a near miss was seen, because a refused list is a writing problem in any
 * bucket — but it can only be reported when the item has no options, since a group that parsed
 * is not a miss.
 */
function lintOf(
  category: DecisionCategory,
  options: string[],
  nearMiss: boolean,
  body: string,
): LintCode[] {
  const codes: LintCode[] = []
  /*
   * Evidence is ORTHOGONAL to options, so it MUST be judged before the short-circuit below.
   * A review row can carry a cleanly parsed 通過／退回 pair and still be unreviewable because
   * nothing says what to look at — folding this under `options.length > 0` would silence the
   * lint on exactly the rows that look most finished.
   */
  if (category === 'review' && !hasReviewEvidence(body)) codes.push('missing-evidence')
  if (options.length > 0) return codes
  if (category === 'ruling') codes.push('no-options-under-ruling')
  if (nearMiss) codes.push('near-miss-option-line')
  return codes
}

/* ------------------------------------------------------------------ shared */

function readIfPresent(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/**
 * A stable, path-safe token for a title.
 *
 * CJK is kept verbatim rather than transliterated: the titles here are almost entirely Chinese,
 * and stripping non-ASCII would collapse every one of them onto the same empty slug.
 */
function slug(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\s　]+/g, '-')
    .replace(/[/\\#?[\]{}]/g, '')
    .slice(0, 80)
}

function fingerprint(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16)
}

/** Markdown emphasis / checkbox / trailing punctuation stripped, for use as a title. */
function plainTitle(line: string): string {
  return line
    .replace(/^\s*[-*]\s*\[[ xX]\]\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
}

/**
 * The part of a title that is its IDENTITY, as opposed to its current description.
 *
 * This is the single load-bearing function in the file. `source_id` is built from it, and
 * `source_id` is what stops a 60-second scan from re-asking everything: two scans of the same
 * bullet MUST produce the same id even after somebody rewrites the prose hanging off it.
 *
 * Real bullets are `**<name>**（<aside>）—— <description that gets edited>`. So the name is the
 * first bold run when there is one, and otherwise everything before the first dash/colon
 * separator. NEVER the whole line: an early version used it, and the test that rewrote only the
 * description watched the id change — which in production is one new queue row and one push
 * notification per edit, forever.
 */
function identityKey(rawTitle: string): string {
  const bold = /\*\*(.+?)\*\*/.exec(rawTitle)
  const head = bold ? bold[1] : rawTitle.split(/——|—|：|:/)[0]
  return plainTitle(head).slice(0, 60)
}

/**
 * Cut a task/bullet line at its first parenthetical annotation.
 *
 * The real lines run to 2000+ characters because every annotation round appends another
 * `（deferred: …）` / `（issue: …）` block. The question is the part before all of that.
 * Both bracket widths, because `openspec` lines mix them freely.
 */
function beforeAnnotation(text: string): string {
  const cut = text.search(
    /[（(](?:deferred|deferred-user-only|issue|partial|claude-analyzed|precondition-resolved)/,
  )
  return (cut === -1 ? text : text.slice(0, cut)).trim()
}

/**
 * One option line, in either of the two bold shapes the fleet actually writes.
 *
 *   SPLIT     `- **A**（推薦）—— 文字`   bold wraps the letter only. This is canonical.
 *   WRAPPED   `- **A（推薦）文字**`      bold wraps the whole option. This is what people write.
 *
 * WRAPPED was rejected until 2026-08-27 on a precision argument, and the measurement says the
 * argument cost everything it was defending: across the 12 fleet repos with a `HANDOFF.md`,
 * SPLIT matched **3** lines and WRAPPED **90**, with 11 of the 12 repos at zero SPLIT — clade,
 * the repo that mandates the shape, among them. `/decisions` therefore rendered page after page
 * of questions whose author HAD written A/B options, each showing a single lonely
 * 「其他（自己寫）」 radio. Recall was ~3%, and no signal anywhere said so.
 *
 * NEVER read this widening as "looser is fine now". Prose alternatives (`或者可以…`) still return
 * nothing, and TWO guards make the widening safe — the alternation here, and the sequence check
 * in `extractOptions`.
 *
 * The alternation is the load-bearing half and the easy one to get wrong: the letter MUST be a
 * standalone token, so after it comes either the closing `**` (SPLIT) or a separator, bracket or
 * space (WRAPPED). Dropping that lookahead and simply making `**` optional matches the FIRST
 * LETTER OF ANY BOLD RUN — `**Status**: open` parses as option `S` with text `tatus**: open`,
 * which is exactly how the first draft of this widening broke `scanTechDebt`, whose own fixtures
 * carry `**Status**` and `**Awaiting**` lines in every body it reads.
 */
const OPTION_LINE =
  /^\s*(?:[-*]\s*)?\*\*([A-Z])(?:\*\*|(?=[（(\s—:：、.,-]))\s*(（推薦）|\(推薦\))?\s*[—:：、.,-]*\s*(.+?)\s*$/

/**
 * How far apart two option lines may sit and still be the same list.
 *
 * Real options are sibling bullets: each may carry its own explanation lines, so the gap is not
 * zero, but it is small. A narrative that happens to bold `A` in one paragraph and `B` forty
 * lines later is not a list, and no amount of letter-sequence checking can tell the two apart —
 * only distance can.
 *
 * Six is measured, not chosen: across the 12 fleet HANDOFF files the widest real option list
 * spans 3 lines between adjacent entries. Six leaves room for a two-line explanation without
 * reaching the next paragraph.
 */
const OPTION_GAP_LIMIT = 6

/**
 * Option text that records a decision already taken.
 *
 * `- **A 方案已採用**：…` / `- **B 案已否決**：…` is a pair of bold letters, gapless from A,
 * adjacent, same indent — every structural guard passes, and it is still not a question. The
 * only thing that separates it from a live choice is what the words say, so this is the one
 * guard that has to read them.
 *
 * Rejecting the WHOLE group rather than the matching line is deliberate: a list where one entry
 * is already settled is a list being narrated, and offering the remainder would present the
 * leftovers of a finished decision as the decision.
 */
const RESOLVED_NARRATIVE = /(?:已(?:採用|否決|拍板|落地|完成|收掉|land)|採納|作廢)/

interface OptionCandidate {
  letter: string
  text: string
  recommended: boolean
  line: number
  /**
   * `null` on the body's first line, which is NOT the same as zero.
   *
   * Every caller hands this function a body whose first line has already been trimmed — the
   * title and the body are split off the same bullet. So a first-line option reads as indent 0
   * while its siblings below read as 2, and a strict same-indent rule would split one real list
   * in half. Absent information is recorded as absent rather than defaulted, because defaulting
   * it to 0 makes it silently disagree with every line under it.
   */
  indent: number | null
}

/**
 * Options, only when the text spells them out as an A/B/C list.
 *
 * Four guards, and they do different jobs — NEVER drop one because another looks sufficient:
 *
 *  - **at least two**: a lone `A` is a sentence that happened to start with a bold letter.
 *  - **A-consecutive**: the letters collected MUST be A, B, C… from A with no gaps. This is what
 *    replaces the old bold-must-hug-the-letter rule. Without it, two unrelated bold lines
 *    (`**Awaiting**: …` / `**Because** …`) could pair up into a two-item "choice"; with it they
 *    cannot, because real options always number from A and stray bold lines essentially never
 *    spell a gapless run. A body whose bold letters read `A, D` is not a half-read option list,
 *    it is not an option list — discard the whole group rather than offer two of an unknown N.
 *  - **adjacent, same indent** (`OPTION_GAP_LIMIT`): options are sibling bullets. Two bold
 *    letters that happen to read A and B from opposite ends of a long body are prose, and the
 *    two guards above cannot see the difference — they never look at where a line sits.
 *  - **not a resolved narrative** (`RESOLVED_NARRATIVE`): the structural guards all pass on
 *    `- **A 方案已採用**` / `- **B 案已否決**`, because structurally it IS a list. Only the
 *    words say it is a list of things already decided.
 *
 * The last two exist because the first two are blind in the same direction: they check the
 * SHAPE of the letters and nothing about the lines carrying them. Widening the bold alternation
 * on 2026-08-27 made that blindness reachable, so it is closed in the same change rather than
 * left for the first body that trips it.
 */
function extractOptions(body: string): {
  options: string[]
  recommended: string | null
  /** Candidate lines existed and every group was refused — somebody wrote a list we cannot read. */
  nearMiss: boolean
} {
  const candidates: OptionCandidate[] = []
  const lines = body.split(/\r?\n/)
  for (const [index, rawLine] of lines.entries()) {
    const match = OPTION_LINE.exec(rawLine)
    if (!match) continue
    const [, letter, rec, text] = match
    const option = plainTitle(text).replace(/\s*（推薦）\s*$/, '')
    if (!option) continue
    candidates.push({
      letter,
      text: option,
      // WRAPPED puts 「（推薦）」 inside the bold, so it can arrive in either capture group.
      recommended: Boolean(rec) || /（推薦）|\(推薦\)/.test(text),
      line: index,
      indent: index === 0 ? null : rawLine.length - rawLine.trimStart().length,
    })
  }

  for (const group of groupAdjacent(candidates)) {
    const picked = qualify(group)
    if (picked) return { ...picked, nearMiss: false }
  }
  /**
   * The one thing this function used to throw away, and the only place it is known.
   *
   * `extractOptions` refusing a group is the RIGHT call every time — the guards exist because
   * loose matching fills the queue with bold sentences. But refusing silently means an author
   * who wrote `- **A 這樣做**` / `- **D 那樣做**` gets a free-text box and no hint that two lines
   * were nearly a choice. Only the parser knows a candidate was seen at all, so only the parser
   * can say so.
   *
   * A single candidate counts. `- **A 只有這條**` alone is the most common shape of a
   * half-written list, and it is exactly the one the "at least two" guard drops.
   */
  return { options: [], recommended: null, nearMiss: candidates.length > 0 }
}

/** Runs of candidates that sit close enough together, at one indent, to be one list. */
function groupAdjacent(candidates: OptionCandidate[]): OptionCandidate[][] {
  const groups: OptionCandidate[][] = []
  let current: OptionCandidate[] = []
  for (const candidate of candidates) {
    const previous = current.at(-1)
    // An unknown indent on either side joins whatever it is next to: it is missing, not different.
    const sameIndent =
      previous === undefined ||
      previous.indent === null ||
      candidate.indent === null ||
      previous.indent === candidate.indent
    const continues =
      previous !== undefined && sameIndent && candidate.line - previous.line <= OPTION_GAP_LIMIT
    if (continues) {
      current.push(candidate)
      continue
    }
    if (current.length > 0) groups.push(current)
    current = [candidate]
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/** One group, kept only if it passes every guard. */
function qualify(
  group: OptionCandidate[],
): { options: string[]; recommended: string | null } | null {
  const options: string[] = []
  const seen = new Set<string>()
  let recommended: string | null = null
  for (const candidate of group) {
    if (seen.has(candidate.letter)) continue
    seen.add(candidate.letter)
    options.push(candidate.text)
    if (candidate.recommended) recommended = candidate.text
  }
  if (options.length < 2) return null
  const consecutiveFromA = [...seen].every((l, i) => l.codePointAt(0) === 65 + i)
  if (!consecutiveFromA) return null
  if (options.some((option) => RESOLVED_NARRATIVE.test(option))) return null
  return { options, recommended }
}

/** First non-empty line of a section body, for the "this section is declared empty" check. */
function firstMeaningfulLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return ''
}

/** `目前沒有等待拍板的項。` and its relatives — a section that says it is empty IS empty. */
const DECLARED_EMPTY = /^(?:目前)?(?:沒有|無)|^N\/A$|^—$|^-$/

/* --------------------------------------------------- 1. work-loop state.json */

/**
 * `.clade/work-loop/state.json` — the only source that arrives already structured.
 *
 * `awaiting[]` is what work-loop packaging produced for exactly this purpose, so its fields map
 * one-to-one and nothing has to be inferred. `escalated` is the other half: items the loop could
 * not push forward on its own, which is `\my` bucket 4 rather than a question.
 */
export function scanWorkLoopState(repoRoot: string): SourceItem[] {
  const rel = '.clade/work-loop/state.json'
  const raw = readIfPresent(join(repoRoot, rel))
  if (!raw) return []

  let state: Record<string, unknown>
  try {
    state = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return []
  }

  const out: SourceItem[] = []

  const awaiting = Array.isArray(state.awaiting) ? state.awaiting : []
  for (const entry of awaiting) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : null
    const title = typeof item.title === 'string' ? item.title : null
    if (!id && !title) continue

    const blocker = typeof item.blocker === 'string' ? item.blocker : ''
    const rawOptions = Array.isArray(item.options) ? item.options : []
    const options: string[] = []
    let recommended: string | null = null
    for (const opt of rawOptions) {
      if (!opt || typeof opt !== 'object') continue
      const o = opt as Record<string, unknown>
      const label = typeof o.label === 'string' ? o.label : null
      if (!label) continue
      options.push(label)
      if (o.recommended === true) recommended = label
    }

    out.push({
      source_kind: 'work-loop',
      source_id: `work-loop:${rel}#${slug(id ?? title ?? '')}`,
      question: title ?? id ?? '',
      detail: blocker,
      options,
      recommended,
      category: 'ruling',
      // The answer belongs where the loop reads it back, not in the state file it rewrites.
      carrier: 'HANDOFF.md',
      fingerprint: fingerprint(title ?? '', blocker, options.join('|')),
      // The structured source: options are FIELDS here, so a missing list is a missing field,
      // never a shape the parser failed to read. `near-miss` cannot arise.
      lint: options.length === 0 ? ['no-options-under-ruling'] : [],
    })
  }

  const escalated = state.escalated
  if (typeof escalated === 'string' && escalated.trim()) {
    out.push({
      source_kind: 'work-loop',
      source_id: `work-loop:${rel}#escalated`,
      question: 'work-loop 已 escalate，自己推不動了',
      detail: escalated.trim(),
      options: [],
      recommended: null,
      category: 'loop-structural',
      carrier: 'HANDOFF.md',
      fingerprint: fingerprint(escalated.trim()),
      lint: [],
    })
  }

  return out
}

/* ---------------------------------------------------------- 2. HANDOFF.md */

interface Section {
  heading: string
  body: string
}

function splitSections(text: string): Section[] {
  const sections: Section[] = []
  let heading: string | null = null
  let buffer: string[] = []

  for (const line of text.split(/\r?\n/)) {
    // `## ` only. `###` is a sub-part of the section above it, never a section of its own here.
    if (/^##\s+/.test(line) && !line.startsWith('###')) {
      if (heading !== null) sections.push({ heading, body: buffer.join('\n') })
      heading = line.replace(/^##\s+/, '').trim()
      buffer = []
      continue
    }
    if (heading !== null) buffer.push(line)
  }
  if (heading !== null) sections.push({ heading, body: buffer.join('\n') })
  return sections
}

/**
 * Which `\my` bucket a HANDOFF section belongs to — by heading, and only by heading.
 *
 * Headings vary widely across the fleet (`Blocked / Waiting`, `Blocked（需 user 親自操作）`,
 * `⏳ Awaiting Charles — main push 被 gate 擋`), so this matches on containment rather than
 * equality. Order matters: `跨 repo` is tested first so that a cross-repo section is rejected
 * no matter what else its title says.
 *
 * `跨 repo` yields NOTHING, and that is the point.
 *
 * A cross-repo section is a POINTER at another repo's backlog. Its rows say, in the fleet's own
 * words, `本 repo 不修` / `已移交 clade 主線 w7:pF` / `不用再開` — every one of them names an
 * owner who is not the reader, and several name an agent that has already picked it up. Nothing
 * in such a row is waiting on a human answer, so putting it anywhere in this queue is wrong; the
 * only question is how loudly.
 *
 * NEVER route it to `other-repo` "so the reader can see it": that bucket comes from `\my`, which
 * runs inside ONE checkout and there means "somebody else's to do". `/decisions` scans the whole
 * fleet and labels every row with its repo, so in fleet mode the bucket has no referent — and
 * folding it into `ruling` to paper over that (which is what `bucketOf` used to do) does not
 * remove the row, it relabels a standing pointer as a question waiting on Charles. 2026-08-27
 * measured: 15 of 40 rows in the live queue arrived this way, four whole sections' worth
 * (<consumer-i> `跨 repo（clade 規約洞，本 repo 不修）`, <consumer-b> `跨 repo`, <consumer-l> `跨 repo 待處理` and
 * `跨 repo 已登記（不用再開）`), one of which was a section HEADING rendered as a question.
 *
 * `Blocked` yields nothing either, since 2026-08-28, for the same shape of reason.
 *
 * A Blocked section narrates WHY WORK IS STOPPED — its ball is, by the fleet's own convention,
 * not in the reader's hand. <consumer-i>'s review heading spells the convention out (`Ready for review
 *（球在 Charles 手上，非 agent 可推）`); Blocked is the *other* section. Measured 2026-08-28:
 * 9 of the 15 rows in the live 「不可逆／人類 gate」 bucket came off Blocked headings, and every
 * single one was a signal-wait (`維護期 cutover 日期（signal-wait）`, merge-backs waiting on a
 * clade tag) or a standing status note (`<consumer-e> derive 推送仍在 shadow —— 非故障，是刻意設定`
 * — whose own text says 「不是待拍板」). Zero named an action for Charles. Charles's verbatim
 * reading of that queue: 「我看不懂我要幹嘛」.
 *
 * When the blocker really IS a human, the fleet already writes it where this scanner looks —
 * `Awaiting Charles` / `待拍板` (a ruling), `Ready for review` (a review to perform),
 * tech-debt's `### 需要 Charles`, or a `deferred-user-only` task. That is the precision bias
 * this file declares at the top: a missed item costs one `\my` typed by hand; a false one costs
 * a push notification for something nobody has to do. NEVER re-admit `Blocked` wholesale, and
 * NEVER replace this with a keyword heuristic over the section body.
 */
function categoryOfHeading(heading: string): DecisionCategory | null {
  if (heading.includes('跨 repo')) return null
  if (heading.includes('Awaiting Charles') || heading.includes('待拍板')) return 'ruling'
  // Answerable: 「做完了，去看一下」 ends in 通過 or 退回, which is one short reply. Filing it as
  // a doing told 7 rows' worth of finished work that there was nowhere to record the verdict.
  if (heading.includes('Ready for review')) return 'review'
  // `需要 Charles` is the explicit home for a one-off doing that is NOT a review — the heading
  // tech-debt already uses for the same gate. Dropping `Blocked` removed the accidental home
  // such items used to fall into; this is the deliberate one that replaces it.
  if (heading.includes('需要 Charles')) return 'human-action'
  return null
}

/**
 * The one-way migration that moves the EXISTING ready-for-review spans into the new bucket.
 *
 * The spine is append-only and `driftOf()` deliberately does not compare `category`, on the
 * stated grounds that a bucket change always arrives with a new `source_id`. That holds when a
 * HUMAN edits a heading; it does not hold here, because what changed is `categoryOfHeading()`
 * itself and the headings in every HANDOFF.md are untouched. Without a discriminator the already
 * open spans keep `category: 'irreversible'` in their frozen payload forever, and the fix ships
 * with the measured rows still unanswerable.
 *
 * So review ids carry an epoch. The old id stops being emitted and retracts, the new one opens —
 * which is precisely the honest outcome `decision-sync.ts` documents for a bucket change.
 *
 * SCOPED TO `review` ON PURPOSE. Stamping every handoff id would retract and reopen the whole
 * fleet's queue in one scan, discarding the clarification threads on open rulings Charles is
 * mid-conversation about. NEVER widen it to buy symmetry.
 */
const REVIEW_EPOCH = '@r2'

/**
 * Status markers, which is how the fleet actually says "done" without a checkbox.
 *
 * <consumer-i>'s `HANDOFF.md` uses a coloured lamp on every bullet — `- 🟡 **…**` open, `- ✅ **…**`
 * already ruled on — and never a checkbox. Reading only `- [ ]` there surfaces nothing at all
 * while the section is full of live items; reading every `- ` there re-asks nine questions
 * Charles has already answered, twice with the answer quoted in the bullet itself.
 */
/** One item lifted out of a section: its display title, the raw text it came from, its body. */
interface SectionItem {
  title: string
  /** Pre-`plainTitle` text — `identityKey` needs the `**bold**` markers still on it. */
  raw: string
  body: string
}

const RESOLVED_MARK = /^(?:✅|✔️?|☑️?|🆗)/
/**
 * The same "done" said in words, which sub-section headings do instead of using a lamp.
 *
 * <consumer-b> closes its `## ⏳ Awaiting Charles — main push …` section with a `### 本次已完成（不需接手）`
 * footer. Without this the footer becomes the only item the section yields — and the actual
 * question, three options and all, disappears behind it.
 */
const RESOLVED_PHRASE = /(?:^|[（(\s])(?:本次)?已(?:完成|解決|拍板|處理|落地|收掉)|不需接手/
const OPEN_MARK = /^(?:🟡|🟢|🔴|🟠|🔵|⛔|🔶|🔷|⚠️?|🚨|⏳|❓)/

/**
 * The §QnX question form, which is a lamp written in letters.
 *
 * `Qn` is not incidental wording — the operator's own §QnX protocol *defines* it: a bullet may
 * carry a `Q` number only if answering it with one short reply closes it, and every such bullet
 * must ship either options or an explicit "this one needs a value". That is a stronger open-item
 * signal than any coloured circle, and it is the shape the protocol *requires* for exactly the
 * rows this queue exists to surface.
 *
 * Measured 2026-08-28 on <consumer-e>: its `## ⏳ Awaiting Charles` section held eight such
 * bullets and `scanDecisionSources()` returned **0** — every one was read as a bare-bullet note.
 * Prefixing five of them with a lamp turned the same scan into **5**. The rows were never the
 * problem; the marker vocabulary was.
 *
 * Deliberately narrow: `**Q` plus optional digits plus a full stop. It does NOT match `- Q4 是什麼`
 * or a sentence that merely opens with the letter Q — the bold-plus-terminator shape is what the
 * protocol writes and what a note never accidentally is.
 */
const QUESTION_MARK = /^\*\*Q\d*[.．、]/

/**
 * The open items in a section body — checkbox, lamp, or §QnX question form; NEITHER for a bare
 * bullet.
 *
 * A `- ` with no checkbox, no lamp and no `**Qn.` is a NOTE, not an item: <consumer-b>'s Awaiting section
 * closes with three of them (`- TD-272：landed main …`) that are provenance for decisions already
 * taken. Requiring an explicit open-marker is what keeps those out without a keyword heuristic.
 */
function openBullets(body: string): SectionItem[] {
  const lines = body.split(/\r?\n/)
  const out: SectionItem[] = []
  let current: { title: string; raw: string; body: string[] } | null = null

  const close = () => {
    if (current) {
      out.push({ title: current.title, raw: current.raw, body: current.body.join('\n').trim() })
    }
    current = null
  }

  for (const line of lines) {
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    if (bullet) {
      close()
      const rest = bullet[1]
      const box = /^\[([ xX])\]\s*(.+)$/.exec(rest)
      if (box) {
        if (box[1] === ' ') current = { title: plainTitle(box[2]), raw: box[2], body: [] }
        continue
      }
      if (RESOLVED_MARK.test(rest)) continue
      if (OPEN_MARK.test(rest)) {
        const lamped = rest.replace(OPEN_MARK, '').trim()
        current = { title: plainTitle(lamped), raw: lamped, body: [] }
        continue
      }
      // §QnX form: the `**Qn.` prefix stays on `raw` — it is part of the question's own wording,
      // unlike a lamp, which is pure marker and gets stripped.
      if (QUESTION_MARK.test(rest)) {
        current = { title: plainTitle(rest), raw: rest, body: [] }
      }
      continue
    }
    // An unindented non-bullet line ends the continuation of the item above it.
    if (current && line.trim() && !/^\s/.test(line)) {
      close()
      continue
    }
    if (current) current.body.push(line)
  }
  close()
  return out.filter((item) => item.title)
}

/**
 * `### ` sub-sections of a section, each one an item.
 *
 * <consumer-i> writes `## Blocked` as a container of `### 🟡 <one blocker>` and <consumer-b> writes
 * `## 🟢 Ready for review` the same way. A container heading is not a question; its children are.
 */
function subSections(body: string): SectionItem[] {
  const out: { title: string; raw: string; body: string[] }[] = []
  let current: { title: string; raw: string; body: string[] } | null = null
  for (const line of body.split(/\r?\n/)) {
    const heading = /^###\s+(.+)$/.exec(line)
    if (heading) {
      if (current) out.push(current)
      const title = heading[1].trim()
      const lamped = title.replace(OPEN_MARK, '').trim()
      current =
        RESOLVED_MARK.test(title) || RESOLVED_PHRASE.test(title)
          ? null
          : { title: plainTitle(lamped), raw: lamped, body: [] }
      continue
    }
    if (current) current.body.push(line)
  }
  if (current) out.push(current)
  return out
    .filter((item) => item.title)
    .map((item) => ({ title: item.title, raw: item.raw, body: item.body.join('\n').trim() }))
}

/** `⏳ Awaiting Charles — <topic>` reads as a question only once the container name is off it. */
function stripContainerPrefix(heading: string): string {
  return (
    heading
      // 交替而不是字元類：`⚠️` 是 `⚠` + U+FE0F 變體選擇符，放進字元類等於把選擇符當成獨立
      // 成員，會匹配到裸的 U+FE0F。lint 的 no-misleading-character-class 抓的就是這個。
      .replace(/^(?:[⏳✅🟢🚨🔴🟡]|⚠️?|\s)+/u, '')
      .replace(/^(?:Awaiting Charles|待拍板|Blocked|跨 repo)\s*[—-]\s*/, '')
      .trim()
  )
}

/**
 * The live change slugs under `openspec/changes/`, archive excluded.
 *
 * Archive is excluded for the same reason `scanTasks` excludes it, and the exclusion is what
 * keeps the `deferred-user-only` route intact: <consumer-i>'s `#5 True-device verification` and
 * <consumer-g>'s iPad-Safari row both name an ARCHIVED change, and both legitimately belong on
 * /decisions because /review has no surface for a change that is already closed.
 */
function liveChangeNames(repoRoot: string): string[] {
  const changesDir = join(repoRoot, 'openspec', 'changes')
  if (!existsSync(changesDir)) return []
  let entries: string[]
  try {
    entries = readdirSync(changesDir)
  } catch {
    return []
  }
  return entries.filter((name) => {
    if (name === 'archive') return false
    /*
     * Four characters minimum, because the test below is a plain substring search over prose.
     * A change slug is kebab-cased and multi-word in every measured instance; a two-letter
     * directory name would match half the register by accident, and a false positive here hands
     * a real question back to its author instead of asking it.
     */
    if (name.length < 4) return false
    try {
      return statSync(join(changesDir, name)).isDirectory()
    } catch {
      return false
    }
  })
}

/**
 * Whether a register row is a restatement of a live change's `## 人工檢查`.
 *
 * Both halves are required, and neither is sufficient. 「人工檢查」 alone appears in prose all
 * over these files (rules about it, TD entries about the parser that reads it); a change slug
 * alone appears in every ordinary progress note. Together they name one thing: somebody wrote
 * "go tick the manual checks on <live change>" into a register that cannot show them.
 *
 * That row is never Charles's to act on, in either state it can be in:
 *
 *   - The change IS on the /review inbox → the row is a duplicate of a ticket that already has
 *     the preview, the evidence and the write-back. Two surfaces asking for the same tick.
 *   - The change is NOT on the inbox → it is sitting in a bucket `changeBelongsOnReviewInbox`
 *     refuses (`readyForEvidence`, `applyInProgress`), every one of which means the ball is on
 *     the AGENT. The row is then a workaround for a gate, and answering it would be answering
 *     past the gate.
 *
 * So the verdict is the same either way and the lint says one thing: fix the change, delete the
 * row. NEVER weaken this to "flag only when the change is already on the inbox" — the measured
 * instance (<consumer-g> `product-save-hardening`, 2026-08-28) was the second case, and it is the
 * second case precisely BECAUSE the author could not get it onto /review.
 */
function restatesManualReview(
  text: string,
  liveChanges: readonly string[],
  openManualReview: ReadonlyMap<string, number>,
): boolean {
  /*
   * Ground truth first, prose second.
   *
   * The prose test below asks whether the AUTHOR happened to type 「人工檢查」. That is a
   * property of the writing, not of the change — and the four measured <consumer-i> rows (2026-08-29:
   * `retire-legacy-employee-route-cluster`, `employee-backpay-request`,
   * `manager-my-approval-inbox`, `line-messaging-interaction`) all escaped it while naming a
   * change whose `tasks.md` still had every `[review:ui]` item unticked. All four were answered
   * 「A. 通過」 on the queue; `retire-legacy-employee-route-cluster` had nine `[review:ui]` items
   * open at the time and has them open still, because answering the queue row is what made the
   * row disappear.
   *
   * So the first test reads the checkbox, not the sentence: naming a change that still owes
   * `[review:ui]` ticks IS restating its manual review, however the row is worded. NEVER fold
   * this back into the prose test to save a directory walk — the failure being fixed is exactly
   * that the prose does not say it.
   */
  for (const [name] of openManualReview) if (text.includes(name)) return true
  if (!text.includes('人工檢查')) return false
  return liveChanges.some((name) => text.includes(name))
}

/**
 * Live changes that still owe `[review:ui]` ticks, and how many.
 *
 * `[review:ui]` is the marker for a check only a HUMAN can perform in a browser — the whitelist
 * in `manual-review.evidence.md` is email, webhook, physical device, subjective visual, real
 * handset. Its verdict is recorded by ticking the box in `tasks.md`, through the /review inbox
 * that carries the preview and the write-back.
 *
 * That is a DIFFERENT verdict from the queue's 「通過」, which says only 「the direction is fine,
 * put it on the inbox」. Conflating them is how nine browser checks stayed unticked behind a row
 * that read as passed. NEVER add these to the queue as rows of their own: `scanTasks` already
 * documents why seventeen sub-steps of one errand must not become seventeen queue rows.
 */
export function changesWithOpenManualReview(repoRoot: string): Map<string, number> {
  const out = new Map<string, number>()
  const changesDir = join(repoRoot, 'openspec', 'changes')
  if (!existsSync(changesDir)) return out
  let entries: string[]
  try {
    entries = readdirSync(changesDir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'archive' || name.length < 4) continue
    try {
      if (!statSync(join(changesDir, name)).isDirectory()) continue
    } catch {
      continue
    }
    const text = readIfPresent(join(changesDir, name, 'tasks.md'))
    if (!text) continue
    let open = 0
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes('[review:ui]')) continue
      const box = /\[([ xX])\]/.exec(line)
      if (box && box[1] === ' ') open++
    }
    if (open > 0) out.set(name, open)
  }
  return out
}

export function scanHandoff(repoRoot: string): SourceItem[] {
  const rel = 'HANDOFF.md'
  const text = readIfPresent(join(repoRoot, rel))
  if (!text) return []
  const liveChanges = liveChangeNames(repoRoot)
  const openManualReview = changesWithOpenManualReview(repoRoot)

  const out: SourceItem[] = []
  for (const section of splitSections(text)) {
    const category = categoryOfHeading(section.heading)
    if (!category) continue

    /**
     * Three shapes, tried in this order, and the FIRST one that yields anything wins.
     *
     * Falling through after a shape produced items would double-ask: <consumer-i>'s `## Blocked` holds
     * `### ` children that themselves contain bullets, and reading both levels files the same
     * blocker twice under two different ids — which then needs two answers to clear one thing.
     */
    const items = ((): SectionItem[] => {
      const subs = subSections(section.body)
      if (subs.length > 0) return subs
      const bullets = openBullets(section.body)
      if (bullets.length > 0) return bullets

      // Shape 3: the section IS one item. That needs a topic in the heading — a bare container
      // heading with prose under it is a preamble, not something to answer.
      //
      // The `other-repo` exemption that used to sit here is GONE with the bucket. It let a bare
      // cross-repo heading become an item on the grounds that such a section is "a standing
      // pointer, never phrased as a question" — which is the reason to DROP it, not to admit it.
      // What that exemption actually shipped was <consumer-l>'s `跨 repo 待處理（非本 repo，**NEVER** 在本
      // repo 改）` rendered as a question with a radio under it, asking Charles to rule on a
      // heading whose own text says the work is not here.
      const first = firstMeaningfulLine(section.body)
      if (!first || DECLARED_EMPTY.test(first)) return []
      if (!/[—-]/.test(section.heading)) return []
      const title = stripContainerPrefix(section.heading)
      return [{ title, raw: title, body: section.body.trim() }]
    })()

    for (const item of items) {
      const { options: parsed, recommended, nearMiss } = extractOptions(item.body)
      const belongsOnReview = restatesManualReview(
        `${item.title}\n${item.body}`,
        liveChanges,
        openManualReview,
      )
      // A review's choices come from the verb, not from the file. See `REVIEW_CHOICES`.
      //
      // …except when the verdict is not this surface's to take. A row that restates a live
      // change's manual review gets NO synthesised 通過／退回 pair: the pair is what let four
      // <consumer-i> rows be closed with one tap while the browser checks they stood for stayed
      // unticked. Without it the row stays visible (NEVER hidden — decision-authoring is
      // explicit that hiding finished work is worse than a row sitting there) but it renders
      // like any other option-less item, and the lint note says where the verdict actually
      // lives. NEVER "fix" this by dropping such rows from the scan.
      const options =
        category === 'review' && parsed.length === 0 && !belongsOnReview
          ? [...REVIEW_CHOICES]
          : parsed
      out.push({
        source_kind: 'handoff',
        source_id: `handoff:${rel}#${slug(section.heading)}${
          category === 'review' ? REVIEW_EPOCH : ''
        }/${slug(identityKey(item.raw))}`,
        question: item.title,
        detail: item.body,
        options,
        recommended,
        category,
        carrier: rel,
        fingerprint: fingerprint(item.title, item.body),
        lint: [
          ...lintOf(category, options, nearMiss, item.body),
          ...(belongsOnReview ? (['belongs-on-review'] as LintCode[]) : []),
        ],
      })
    }
  }
  return out
}

/* ------------------------------------------------------- 3. docs/tech-debt.md */

/**
 * `docs/tech-debt.md` — explicit marker ONLY.
 *
 * This is the one source where the obvious reading is wrong, and `decision-drain.md` says so
 * outright: an open TD is DEBT, not a question waiting on Charles. <consumer-b> has 158 open entries;
 * promoting them would bury the real questions under a queue nobody can read, which is the exact
 * failure that made `no-admissible-work` fire while 161 debts were outstanding.
 *
 * So an entry joins the queue only when it says it is waiting, in one of two machine-readable
 * ways, both of which an agent writes deliberately:
 *
 *   `**Awaiting**: charles — <question>`   → a ruling. The field is this file's contract.
 *   `### 需要 Charles <...>`                → a human gate. Already used in the wild.
 *
 * NEVER add a keyword heuristic here ("拍板" appears in 45 lines of clade's register alone, almost
 * all of them prose about some other entry).
 */
export function scanTechDebt(repoRoot: string): SourceItem[] {
  const rel = 'docs/tech-debt.md'
  const text = readIfPresent(join(repoRoot, rel))
  if (!text) return []
  const liveChanges = liveChangeNames(repoRoot)
  const openManualReview = changesWithOpenManualReview(repoRoot)

  const out: SourceItem[] = []
  const lines = text.split(/\r?\n/)

  let tdId: string | null = null
  let tdTitle = ''
  let status = ''
  let buffer: string[] = []

  const flush = () => {
    if (!tdId) return
    const body = buffer.join('\n')
    // `wontfix-until-signal` is parked by definition, `resolved` is done. Neither is waiting.
    if (status && !/^open\b/.test(status)) {
      return
    }

    const awaiting = /^\*\*Awaiting\*\*:\s*charles\s*[—:：-]?\s*(.*)$/im.exec(body)
    if (awaiting) {
      const question = plainTitle(awaiting[1]) || tdTitle
      const { options, recommended, nearMiss } = extractOptions(body)
      out.push({
        source_kind: 'tech-debt',
        source_id: `tech-debt:${rel}#${tdId}`,
        question: `${tdId} — ${question}`,
        detail: body.trim(),
        options,
        recommended,
        category: 'ruling',
        carrier: rel,
        fingerprint: fingerprint(tdId, question, body),
        lint: [
          ...lintOf('ruling', options, nearMiss, body),
          ...(restatesManualReview(body, liveChanges, openManualReview)
            ? (['belongs-on-review'] as LintCode[])
            : []),
        ],
      })
      return
    }

    const gate = /^###\s+(需要 Charles\s*.*)$/m.exec(body)
    if (gate) {
      out.push({
        source_kind: 'tech-debt',
        source_id: `tech-debt:${rel}#${tdId}/human-gate`,
        question: `${tdId} — ${plainTitle(gate[1])}`,
        detail: body.trim(),
        options: [],
        recommended: null,
        category: 'human-action',
        carrier: rel,
        fingerprint: fingerprint(tdId, gate[1], body),
        /*
         * `### 需要 Charles` in the debt register is the SAME admission path as `## 需要 Charles
         * 執行` in HANDOFF — one register row asking a human to do something. Covering only the
         * HANDOFF spelling would leave the identical row admissible one file over, which is the
         * hole an author finds on the first retry.
         */
        lint: restatesManualReview(body, liveChanges, openManualReview)
          ? (['belongs-on-review'] as LintCode[])
          : [],
      })
    }
  }

  for (const line of lines) {
    const heading = /^##\s+(TD-\d+)\s*[—-]\s*(.+)$/.exec(line)
    if (heading) {
      flush()
      tdId = heading[1]
      tdTitle = plainTitle(heading[2])
      status = ''
      buffer = []
      continue
    }
    if (!tdId) continue
    const statusLine = /^\*\*Status\*\*:\s*(.+)$/.exec(line)
    if (statusLine) status = statusLine[1].trim()
    buffer.push(line)
  }
  flush()

  return out
}

/* --------------------------------------------- 4. openspec changes tasks.md */

/**
 * `(deferred-user-only: …)` — work an agent cannot do, marked as such at the point of deferral.
 *
 * These land in `human-action`, NOT `ruling`: every real instance is a physical gate (a phone
 * in someone's hand, a production OA account), never a choice between options. Filing them as
 * rulings would put an answer box under a task that has no answer, only a doing.
 *
 * `openspec/changes/archive/**` is excluded. An archived change is finished by definition, and
 * <consumer-b>'s archive alone carries four of them with the marker still on the line.
 */
export function scanTasks(repoRoot: string): SourceItem[] {
  const changesDir = join(repoRoot, 'openspec', 'changes')
  if (!existsSync(changesDir)) return []

  let entries: string[]
  try {
    entries = readdirSync(changesDir)
  } catch {
    return []
  }

  const out: SourceItem[] = []
  for (const name of entries) {
    if (name === 'archive') continue
    const tasksPath = join(changesDir, name, 'tasks.md')
    try {
      if (!statSync(join(changesDir, name)).isDirectory()) continue
    } catch {
      continue
    }
    const text = readIfPresent(tasksPath)
    if (!text) continue
    const rel = `openspec/changes/${name}/tasks.md`

    /**
     * Only the OUTERMOST deferred task, never its children.
     *
     * The marker propagates down: <consumer-i>'s `#5 True-device verification` carries it and so does
     * every one of its seventeen `#5.x` sub-steps, because they are all the same phone in the
     * same hand. Emitting each one turns a single "go verify on your phone" into seventeen queue
     * rows and seventeen push notifications for one errand.
     */
    let deferredParentIndent = -1

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine
      const indent = /^\s*/.exec(line)?.[0].length ?? 0
      if (/^\s*[-*]\s*\[[ xX]\]/.test(line) && indent <= deferredParentIndent) {
        deferredParentIndent = -1
      }
      if (!line.includes('deferred-user-only')) continue
      const box = /\[([ xX])\]/.exec(line)
      if (!box || box[1] !== ' ') continue
      if (deferredParentIndent !== -1 && indent > deferredParentIndent) continue
      deferredParentIndent = indent

      const idMatch = /#(\d+(?:\.\d+)*)/.exec(line)
      const title = beforeAnnotation(plainTitle(line))
      if (!title) continue
      const key = idMatch ? `#${idMatch[1]}` : slug(title)

      out.push({
        source_kind: 'tasks',
        source_id: `tasks:${rel}#${key}`,
        question: title,
        detail: `${name} ${key}`,
        options: [],
        recommended: null,
        category: 'human-action',
        carrier: rel,
        fingerprint: fingerprint(rel, key, title),
        lint: [],
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ entry */

/**
 * All four file sources for one repo.
 *
 * Deduped on `source_id`: the same question can legitimately appear in both `state.json` and the
 * HANDOFF section the loop mirrors it into, and asking it twice would make answering one of them
 * look like it did nothing. First writer wins, and the scan order below fixes which that is —
 * `state.json` first, because it is the only source that carries real option objects.
 */
export function scanDecisionSources(repoRoot: string): SourceItem[] {
  const all = [
    ...scanWorkLoopState(repoRoot),
    ...scanHandoff(repoRoot),
    ...scanTechDebt(repoRoot),
    ...scanTasks(repoRoot),
  ]
  const seen = new Set<string>()
  const out: SourceItem[] = []
  for (const item of all) {
    if (seen.has(item.source_id)) continue
    seen.add(item.source_id)
    out.push(item)
  }
  return out
}
