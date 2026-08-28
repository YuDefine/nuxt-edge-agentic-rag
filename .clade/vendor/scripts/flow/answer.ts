// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/answer.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/answer.ts
// clade flow spine — answering a decision, and landing that answer where it survives
//
// `decisions.ts` projects what is waiting on a human. This is the other half: what happens when
// the human finally answers. Two things must happen, in this order, and the order is the contract:
//
//   1. CLOSE THE SPAN. The answer is recorded where every view already reads.
//   2. LAND IT ON THE CARRIER. Append it to the file the question named — a TD entry, a HANDOFF
//      section, a `tasks/` path — so it survives this process and the next context window.
//
// NEVER the other way round. Landing first and then failing to close leaves a file saying
// "answered" next to a queue still showing the question, and nothing on either side can tell
// which one is stale. Closing first means the worst case is an answer that is recorded but not
// yet filed — visible, recoverable, and honest about which step did not happen.
//
// This file exists because there were about to be TWO implementations of that contract. The
// logic first shipped inside `notion-fleet-decisions.ts`, whose `pull` was the only way to answer
// anything. The review-gui `/decisions` page is now a second entry point, and a second copy of
// "where does an answer go" would be a second answer to that question — the exact drift the
// single-writer design of the Notion projector was built to avoid. Both entry points call here.
//
// Propagation constraint: `vendor/scripts/flow/` is copied wholesale to every consumer
// (`scripts/lib/vendor-targets.ts`, closure-checked by `test/vendor-targets-flow-closure.test.ts`).
// So this file may import ONLY `node:*` and siblings in this directory. NEVER `../lib/` or
// `scripts/` — those are clade-only and a consumer would get ERR_MODULE_NOT_FOUND at link time.

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { QuestionPageRef } from '../review-gui.question-page.ts'
import { readQuestionPageRef } from '../review-gui.question-page.ts'
import type { AcceptVerdict } from './decisions.ts'
import { acceptVerdictOf, parseAcceptSpanId } from './decisions.ts'
import type { DecisionLock, LockCandidate } from './emit.ts'
import {
  acceptWork,
  computeDecisionLock,
  decisionAnswerHistory,
  dropWork,
  readEvents,
  resolveDecision,
  reviseDecisionEvent,
} from './emit.ts'
import { buildWorkItems, foldSpans } from './spine.ts'

/** The register whose invariants an append can break. Only clade has it. */
const TD_REGISTER = 'docs/tech-debt.md'
const TD_AUDIT = 'scripts/audit-tech-debt-hygiene.ts'

export type AnswerFailure =
  /** The question named no landing place. The answer lives on the spine only. */
  | 'no-carrier'
  /** It named one, but there is no such file to append to. */
  | 'carrier-missing'
  /** The carrier resolved outside the repo — refused rather than followed. */
  | 'carrier-outside-repo'
  /** Somebody already answered this one (the Notion projector, another tab). */
  | 'already-resolved'
  /** No `decision.request` start event with this id on this repo's spine. */
  | 'no-such-decision'
  /** The append would add new `docs/tech-debt.md` hygiene findings; rolled back. */
  | 'td-hygiene-regression'
  /** `CLADE_FLOW_EVENTS` pins every repo onto one file; writing would land in the wrong spine. */
  | 'spine-override'
  /** Asked to revise something nobody has answered yet. */
  | 'not-answered'
  /** An agent already picked this answer up; changing it now would desync work already underway. */
  | 'picked-up'
  /** The landed block is not on the carrier any more — nothing to rewrite in place. */
  | 'landed-block-missing'
  /** The span id appears more than once on the carrier; refused rather than guessing which. */
  | 'landed-block-ambiguous'
  /** 驗收合成題：這個 work item 現在不是 `done`，沒有待裁決的判決可下。 */
  | 'accept-not-pending'
  /** 驗收合成題：答案讀不出是收、drop 還是還沒。NEVER 猜——那寫下去的是終態。 */
  | 'accept-unreadable'
  /** 驗收合成題：人選了「還沒」。什麼都沒寫，這一列留在佇列上。 */
  | 'accept-deferred'
  /** 驗收合成題：判決事件沒能落檔（schema 拒絕、spine 不可寫）。 */
  | 'accept-write-failed'
  /** 驗收合成題：判決不是可改寫的答案。翻案走下一次判決，不走 revise。 */
  | 'accept-not-revisable'

export interface AnswerDecisionInput {
  spanId: string
  /** The answer as the human gave it — `A. <option>` for a pick, free text otherwise. */
  answer: string
  /** Recorded on the closing event. `notion` / `review-gui`. */
  answeredBy: string
  /** Human-readable provenance for the landed block, so the file says where the answer came in. */
  via: string
  /** The repo that owns this span. NEVER assume clade: the queue is fleet-wide. */
  repoRoot: string
  /** Compute everything, write nothing. What the preview screen renders. */
  dryRun?: boolean
}

export interface AnswerDecisionResult {
  ok: boolean
  /** Whether the span was actually closed. Always false under `dryRun`. */
  resolved: boolean
  landed: boolean
  carrier: string | null
  carrierPath: string | null
  /** The exact text that was (or would be) appended. The preview shows this verbatim. */
  block: string
  reason: AnswerFailure | null
  detail: string | null
  /** Why this answer can no longer be changed, when it cannot. Null while it is still editable. */
  locked?: DecisionLock | null
  /** How many times this answer has been revised, including the revision just written. */
  revisions?: number
}

export interface DecisionLookup {
  spanId: string
  workId: string
  question: string
  options: string[]
  recommended: string | null
  category: string
  carrier: string | null
  /**
   * 這一題的互動決策頁，沒有就是 null。
   *
   * 具名欄位而不是把整包 payload 交出去：`lookupDecision` 的回傳是給**寫入端**用的
   * （answer / clarify / question-page 的 spawn gate），而 spawn gate 拿到整包 payload 就
   * 等於讓 request 有機會影響它要跑什麼。給它剛好夠用的那一個欄位。
   */
  question_page: QuestionPageRef | null
}

/**
 * The open question behind one span id, read straight off the repo's own spine.
 *
 * Deliberately not `buildDecisionQueue`: answering one question does not need a fold over 14
 * repos' streams, and reaching for the fleet snapshot here would make a single click cost a
 * fleet-wide read.
 */
export function lookupDecision(spanId: string, repoRoot: string): DecisionLookup | null {
  const start = readEvents(repoRoot).find(
    (e) => e.span_id === spanId && e.phase === 'start' && e.kind === 'decision.request',
  ) as Record<string, unknown> | undefined
  if (!start) return null
  const payload = (start.payload ?? {}) as Record<string, unknown>
  return {
    spanId,
    workId: String(start.work_id ?? ''),
    question: typeof payload.question === 'string' ? payload.question : '(沒有記下問題)',
    options: Array.isArray(payload.options) ? payload.options.map((o) => String(o)) : [],
    recommended: typeof payload.recommended === 'string' ? payload.recommended : null,
    category: typeof payload.category === 'string' ? payload.category : 'ruling',
    carrier: typeof payload.carrier === 'string' ? payload.carrier : null,
    question_page: readQuestionPageRef(payload),
  }
}

/**
 * The one scheme vocabulary shared by a decision's `carrier` and a work item's `origin_ref`.
 *
 * They point in the same direction (structured stream → the prose world) and differ only in what
 * they name: origin is where a work item was born, carrier is where a decision's answer has to
 * land. One vocabulary means one resolver — two would drift, and a reader holding a `td:` ref
 * would have to know which half of the spine produced it before it could follow it.
 *
 * `im:` is the deliberate odd one: a message from a customer has no addressable location, so it
 * resolves to nothing. That is a fact worth recording rather than a gap to be filled — it is the
 * one origin with no mechanical backstop possible.
 */
export const REF_SCHEMES = ['notion', 'im', 'td', 'tasks', 'handoff'] as const
export type RefScheme = (typeof REF_SCHEMES)[number]

const SCHEME_RE = new RegExp(`^(${REF_SCHEMES.join('|')}):(.+)$`, 'u')

/** Split `<scheme>:<id>`. A bare value (no known scheme) keeps its historical meaning: a path. */
export function parseRef(ref: string | null): { scheme: RefScheme | null; id: string } | null {
  if (!ref) return null
  const trimmed = ref.trim()
  if (!trimmed) return null
  const m = SCHEME_RE.exec(trimmed)
  if (!m) return { scheme: null, id: trimmed }
  return { scheme: m[1] as RefScheme, id: m[2].trim() }
}

/**
 * Where an answer has to be written down so it survives this process — and, for the same reason
 * and through the same rules, where a work item's origin can be read.
 *
 * A bare `TD-<n>` (or `td:TD-<n>`) means the shared register, not a file of its own. `notion:`
 * and `im:` live outside this repo and resolve to null by design. Everything else is a repo
 * -relative path, and the containment check is load-bearing: the value reaches here from a
 * payload, and a payload is not a trusted path source. Outside the repo → null, never followed.
 */
export function carrierPath(carrier: string | null, repoRoot: string): string | null {
  const parsed = parseRef(carrier)
  if (!parsed) return null
  // Off-repo by definition: a Notion page and a chat message have no path, and inventing one
  // here would hand a caller a repo-relative path built from a customer-controlled string.
  if (parsed.scheme === 'notion' || parsed.scheme === 'im') return null
  const trimmed = parsed.id
  if (/^TD-\d+$/u.test(trimmed)) return join(repoRoot, TD_REGISTER)
  const root = resolve(repoRoot)
  const p = resolve(root, trimmed.split('#')[0])
  return p === root || p.startsWith(`${root}/`) ? p : null
}

/**
 * The one formatter for a landed answer — revisions rewrite through this same function.
 *
 * A revision could have written its own shape ("**更正**：…" appended below the original), and
 * that would have been easier. It would also have split the register into two block shapes, and
 * the next rewrite has to find and replace whichever one it happens to meet. One shape, one
 * anchor, one parser.
 *
 * `revisions` prints a line the downstream reader needs and cannot get anywhere else: an answer
 * that changed after somebody may already have acted on it is the one case where the file alone
 * is not enough, and this line is the only thing on the carrier that says to go look at the spine.
 */
export function landingBlock(
  question: string,
  answer: string,
  spanId: string,
  via: string,
  now = new Date(),
  revisions = 0,
): string {
  const stamp = now.toISOString().slice(0, 10)
  return [
    '',
    `### 決策紀錄 ${stamp} — ${question}`,
    '',
    `**答案**：${answer}`,
    '',
    ...(revisions > 0
      ? [`已修訂 ${revisions} 次（最後 ${stamp}）；每一版的原文在 flow spine 上。`, '']
      : []),
    `來源：flow spine \`decision.request\` span \`${spanId}\`（${via}）。`,
    '',
  ].join('\n')
}

/** The block's heading marker. The anchor is the span id; this is only where the block STARTS. */
const BLOCK_HEADING = '### 決策紀錄 '

/**
 * Replace a previously landed block in place.
 *
 * The anchor is the `` `<spanId>` `` the block already carries — 16 hex, unique by construction.
 * NEVER a new marker comment: existing landed blocks predate anything we add today, so a new
 * marker would only ever cover blocks written from now on and every rewrite would still need this
 * path as a fallback. Two locating strategies is one more than can be kept correct.
 *
 * Fail closed on anything but exactly one hit. Zero means the block was moved, archived, or the
 * carrier was rewritten; more than one means somebody copied it. Both are recoverable by a human
 * in ten seconds and unrecoverable if this function guesses a range and replaces it — the carriers
 * are `HANDOFF.md` and `docs/tech-debt.md`, shared registers other sessions are writing to.
 */
function findLandedBlock(
  text: string,
  spanId: string,
): { start: number; end: number } | 'missing' | 'ambiguous' {
  const needle = `\`${spanId}\``
  const first = text.indexOf(needle)
  if (first === -1) return 'missing'
  if (text.indexOf(needle, first + needle.length) !== -1) return 'ambiguous'

  const headingStart = text.lastIndexOf(`\n${BLOCK_HEADING}`, first)
  if (headingStart === -1) return 'missing'
  const lineEnd = text.indexOf('\n', first)
  const end = lineEnd === -1 ? text.length : lineEnd + 1
  // The block was written with a leading blank line; take it back so repeated rewrites do not
  // accumulate blank lines around the same section.
  return { start: headingStart, end }
}

/** The audit's findings, as a comparable set. Its metrics section moves every run; findings do not. */
function tdFindings(output: string): Set<string> {
  return new Set(
    output
      .split('\n')
      .filter((line) => /^\s*[❌⚠]/u.test(line))
      .map((line) => line.trim()),
  )
}

/**
 * The register's hygiene findings, or null when this repo has no such audit.
 *
 * Null is not "clean" — it is "not measurable here", and the caller must treat it as a reason to
 * skip the comparison rather than as a passing baseline. Consumer repos have neither the register
 * nor the audit; only clade does.
 */
function runTdAudit(repoRoot: string): Set<string> | null {
  if (!existsSync(join(repoRoot, TD_AUDIT))) return null
  const r = spawnSync(process.execPath, [TD_AUDIT], { cwd: repoRoot, encoding: 'utf8' })
  return tdFindings(`${r.stdout ?? ''}${r.stderr ?? ''}`)
}

/**
 * Append the answer to its carrier, and refuse to make `docs/tech-debt.md` worse.
 *
 * The register is governed by a set of invariants and a free-form append can break one. Rather
 * than encode those rules a second time here, this measures the audit before and after and rolls
 * back only when NEW findings appear.
 *
 * NEVER gate on the audit's exit code alone. The register is shared: when this was written it was
 * already red on a finding belonging to another session's TD, so an exit-code gate would have
 * refused every landing forever while reporting it as "your append broke hygiene" — a permanently
 * stuck channel that looks like a working one. Measured 2026-08-26, and that is how it was found.
 */
function landOnCarrier(
  carrier: string | null,
  path: string | null,
  block: string,
  repoRoot: string,
  dryRun: boolean,
): { landed: boolean; reason: AnswerFailure | null; detail: string | null } {
  if (!carrier) {
    return {
      landed: false,
      reason: 'no-carrier',
      detail: '這題沒有指定落點，答案只會留在 flow spine 上',
    }
  }
  if (!path) {
    return {
      landed: false,
      reason: 'carrier-outside-repo',
      detail: `落點 ${carrier} 解析到 repo 之外，拒絕寫入`,
    }
  }
  if (!existsSync(path)) {
    return { landed: false, reason: 'carrier-missing', detail: `落點 ${carrier} 對應的檔案不存在` }
  }
  if (dryRun) return { landed: true, reason: null, detail: null }

  const isRegister = path === join(repoRoot, TD_REGISTER)
  const baseline = isRegister ? runTdAudit(repoRoot) : null
  const before = readFileSync(path, 'utf8')
  appendFileSync(path, block)
  if (!baseline) return { landed: true, reason: null, detail: null }

  const after = runTdAudit(repoRoot)
  const introduced = [...(after ?? [])].filter((f) => !baseline.has(f))
  if (introduced.length === 0) return { landed: true, reason: null, detail: null }

  writeFileSync(path, before)
  return {
    landed: false,
    reason: 'td-hygiene-regression',
    detail: `寫進 ${TD_REGISTER} 會新增 ${introduced.length} 條 hygiene findings，已還原。答案仍在 spine 上，請人工放進對應 TD entry。第一條：${introduced[0]?.slice(0, 160)}`,
  }
}

/**
 * Rewrite the landed block in place, under the same hygiene guard the append runs under.
 *
 * A rewrite can break `docs/tech-debt.md`'s invariants exactly like an append can — it is the same
 * free-form edit to the same shared register — so it measures the same audit before and after and
 * rolls back on NEW findings only, for the reason `landOnCarrier` documents: the register is
 * routinely red on somebody else's entry, and an exit-code gate would refuse every rewrite forever
 * while reporting it as your fault.
 */
function replaceOnCarrier(
  carrier: string | null,
  path: string | null,
  spanId: string,
  block: string,
  repoRoot: string,
  dryRun: boolean,
): { landed: boolean; reason: AnswerFailure | null; detail: string | null } {
  if (!carrier) {
    return {
      landed: false,
      reason: 'no-carrier',
      detail: '這題沒有指定落點，修訂只會留在 flow spine 上',
    }
  }
  if (!path) {
    return {
      landed: false,
      reason: 'carrier-outside-repo',
      detail: `落點 ${carrier} 解析到 repo 之外，拒絕寫入`,
    }
  }
  if (!existsSync(path)) {
    return { landed: false, reason: 'carrier-missing', detail: `落點 ${carrier} 對應的檔案不存在` }
  }

  const before = readFileSync(path, 'utf8')
  const found = findLandedBlock(before, spanId)
  if (found === 'missing') {
    return {
      landed: false,
      reason: 'landed-block-missing',
      detail: `${carrier} 上找不到 span ${spanId} 的決策紀錄段落（可能被搬走或歸檔了）。修訂已記在 spine 上，請人工更新該段`,
    }
  }
  if (found === 'ambiguous') {
    return {
      landed: false,
      reason: 'landed-block-ambiguous',
      detail: `${carrier} 上有多處提到 span ${spanId}，無法判斷要改哪一段，拒絕猜。修訂已記在 spine 上，請人工更新`,
    }
  }
  if (dryRun) return { landed: true, reason: null, detail: null }

  const isRegister = path === join(repoRoot, TD_REGISTER)
  const baseline = isRegister ? runTdAudit(repoRoot) : null
  writeFileSync(path, `${before.slice(0, found.start)}${block}${before.slice(found.end)}`)
  if (!baseline) return { landed: true, reason: null, detail: null }

  const after = runTdAudit(repoRoot)
  const introduced = [...(after ?? [])].filter((f) => !baseline.has(f))
  if (introduced.length === 0) return { landed: true, reason: null, detail: null }

  writeFileSync(path, before)
  return {
    landed: false,
    reason: 'td-hygiene-regression',
    detail: `改寫 ${TD_REGISTER} 會新增 ${introduced.length} 條 hygiene findings，已還原。修訂仍在 spine 上，請人工更新該段。第一條：${introduced[0]?.slice(0, 160)}`,
  }
}

/**
 * Whether this answer has been picked up, read off this repo's own spine.
 *
 * The rule itself is `computeDecisionLock` in `emit.ts` — this only adapts raw events into what it
 * takes. The projection in `decisions.ts` adapts folded spans into the same shape, so the page and
 * the writer are answering from one rule; the alternative is a page that offers an edit the writer
 * then refuses.
 */
export function decisionLockFor(
  spanId: string,
  workId: string,
  answeredAt: string,
  repoRoot: string,
): DecisionLock | null {
  const candidates: LockCandidate[] = (readEvents(repoRoot) as unknown as Record<string, unknown>[])
    .filter((e) => e.phase === 'start' || e.phase === 'point')
    .map((e) => ({
      kind: String(e.kind ?? ''),
      work_id: String(e.work_id ?? ''),
      at: String(e.ts_utc ?? ''),
      is_point: e.phase === 'point',
      actor: String(e.actor ?? 'unknown'),
      parent_span: (e.parent_span as string | null) ?? null,
    }))
  return computeDecisionLock(spanId, workId, answeredAt, candidates)
}

/**
 * Change an answer that was already given, and rewrite it where it landed.
 *
 * Same order as `answerDecision`, and for the same reason: spine first, carrier second. The worst
 * case stays "recorded but not filed" — visible and recoverable — rather than a file claiming one
 * answer next to a spine holding another, where nothing can say which is stale.
 *
 * The lock is recomputed HERE rather than trusted from the caller. `/decisions` polls every 15
 * seconds, so its idea of "still editable" is up to 15 seconds old, and the whole point of the
 * lock is the moment an agent starts acting on the answer.
 */
export function reviseDecision({
  spanId,
  answer,
  revisedBy,
  via,
  repoRoot,
  force = false,
  dryRun = false,
}: {
  spanId: string
  answer: string
  revisedBy: string
  via: string
  repoRoot: string
  /** Override a `follow-up` (inferred) lock. NEVER overrides a `pickup` — that one is a statement. */
  force?: boolean
  dryRun?: boolean
}): AnswerDecisionResult {
  const base = { resolved: false, landed: false, carrier: null, carrierPath: null, block: '' }

  if (spineOverrideBlocks(repoRoot)) {
    return {
      ...base,
      ok: false,
      reason: 'spine-override',
      detail: `CLADE_FLOW_EVENTS 指向 ${process.env.CLADE_FLOW_EVENTS}，不在 ${repoRoot} 內；寫入會落到別的 spine`,
    }
  }

  // 驗收合成題不走改答案這條路：它沒有 `decision.request` 可改寫，而它的「答案」是 work item
  // 的終態。要翻案就再下一次判決（`flow accept` / `flow drop` 最後一筆生效），NEVER 讓這裡
  // 靜靜地掉進下面的 `no-such-decision`——那會把一個不支援的操作說成一題不存在。
  if (parseAcceptSpanId(spanId)) {
    return {
      ...base,
      ok: false,
      reason: 'accept-not-revisable',
      detail: '驗收判決不是可改寫的答案；要翻案請再下一次 accept / drop 判決',
    }
  }

  const decision = lookupDecision(spanId, repoRoot)
  if (!decision) {
    return {
      ...base,
      ok: false,
      reason: 'no-such-decision',
      detail: `${repoRoot} 的 spine 上沒有 span ${spanId} 的 decision.request`,
    }
  }

  const history = decisionAnswerHistory(spanId, repoRoot)
  if (!history.answered) {
    return {
      ...base,
      ok: false,
      reason: 'not-answered',
      detail: '這題還沒有人回答過，要走作答不是修訂',
    }
  }

  const lock = decisionLockFor(spanId, decision.workId, history.answeredAt, repoRoot)
  if (lock && (lock.by === 'pickup' || !force)) {
    return {
      ...base,
      ok: false,
      reason: 'picked-up',
      locked: lock,
      detail:
        lock.by === 'pickup'
          ? `${lock.actor} 已於 ${lock.at} 宣告接手這個答案，不能再改`
          : `答案之後同一件工作（${decision.workId}）在 ${lock.at} 又開了新的 span，看起來已經有人在執行`,
    }
  }

  const path = carrierPath(decision.carrier, repoRoot)
  const revisions = history.revisions + 1
  const block = landingBlock(decision.question, answer, spanId, via, new Date(), revisions)
  const preview = { carrier: decision.carrier, carrierPath: path, block }

  if (dryRun) {
    const r = replaceOnCarrier(decision.carrier, path, spanId, block, repoRoot, true)
    return { ...preview, ok: true, resolved: false, ...r, locked: null, revisions }
  }

  const written = reviseDecisionEvent({ spanId, answer, revisedBy, cwd: repoRoot })
  if (!written.written) {
    return {
      ...preview,
      ok: false,
      resolved: false,
      landed: false,
      reason: 'no-such-decision',
      detail: `修訂寫不進 spine：${written.errors?.map((e) => e.code).join(',') ?? 'unknown'}`,
    }
  }

  const r = replaceOnCarrier(decision.carrier, path, spanId, block, repoRoot, false)
  // Same contract as answering: the revision is recorded either way, so this is `ok` even when the
  // carrier could not be rewritten. `landed:false` + `reason` says what still needs a human.
  return { ...preview, ok: true, resolved: true, ...r, locked: null, revisions }
}

/**
 * `CLADE_FLOW_EVENTS` pins every repo's spine onto one file (see `eventsPath`). Reading through
 * it is merely wrong; WRITING through it lands a consumer's answer in clade's stream, where the
 * question it closes does not exist. Refuse instead, unless the override already points inside
 * the repo being answered — which is what a test fixture does.
 */
function spineOverrideBlocks(repoRoot: string): boolean {
  const override = process.env.CLADE_FLOW_EVENTS
  if (!override) return false
  const root = resolve(repoRoot)
  return !resolve(override).startsWith(`${root}/`)
}

/**
 * 驗收合成題的寫入端 —— 人回了 A/B/C，這裡把它變成 `work.accept` / `work.drop`。
 *
 * **按的仍然是人。** `work.accept` 的硬約束是「NEVER 由 agent 代按」，而這條路徑的每一次寫入
 * 都以一個人類答案為前提：沒有答案就沒有事件，答案讀不出來就拒絕而不是猜。授權結構與
 * `/flow` 上那顆按鈕相同，變的只是它出現在人真的會看到的那一面（見 `decisions.ts` 的
 * `ACCEPT_SPAN_PREFIX` 頭註解）。
 *
 * 為什麼不走 `resolveDecision`：合成題**不在脊椎上**，沒有 `decision.request` 可以收。它的
 * 「答案落點」就是 work item 自己的終態——所以 `landed:false` + `no-carrier`，逐字符合那個
 * 代碼原本的定義（沒有落檔的地方，答案只活在 spine 上），NEVER 另發明一個看起來像失敗的碼。
 */
function answerAcceptGate({
  workId,
  spanId,
  answer,
  answeredBy,
  via,
  repoRoot,
  dryRun,
}: {
  workId: string
  spanId: string
  answer: string
  answeredBy: string
  via: string
  repoRoot: string
  dryRun: boolean
}): AnswerDecisionResult {
  const base = { resolved: false, landed: false, carrier: null, carrierPath: null, block: '' }
  const item = buildWorkItems(foldSpans(readEvents(repoRoot))).find((w) => w.work_id === workId)
  if (!item) {
    return {
      ...base,
      ok: false,
      reason: 'no-such-decision',
      detail: `${repoRoot} 的 spine 上沒有 work item ${workId}`,
    }
  }
  // 不是 `done` 就沒有待裁決的東西：可能別人剛裁決過（`accepted` / `dropped`），也可能它被
  // 新的 span 打回去重做（`in-flight`）。兩種都不該由這一次點擊蓋掉——`state` 的優先序已經
  // 是答案，這裡只是不去推翻它。
  if (item.state !== 'done') {
    return {
      ...base,
      ok: false,
      reason: 'accept-not-pending',
      detail: `${workId} 現在是 ${item.state}，不是 done——這題已經不在驗收佇列上了`,
    }
  }
  const verdict: AcceptVerdict | null = acceptVerdictOf(answer)
  if (verdict === null) {
    return {
      ...base,
      ok: false,
      reason: 'accept-unreadable',
      detail: `讀不出「${answer}」是 A（收）、B（drop）還是 C（還沒）——沒有猜，什麼都沒寫`,
    }
  }

  const preview =
    verdict === 'defer'
      ? `${workId}：留在驗收佇列上，什麼都不寫`
      : `${workId} → work.${verdict === 'accept' ? 'accept' : 'drop'}
理由：${answer}
（${via}）`

  if (dryRun) return { ...base, ok: true, block: preview, reason: null, detail: null }

  // 「還沒」是一個真的答案，而它的內容是「不要寫」。NEVER 為了讓每個答案都留下痕跡而 emit
  // 一個 point event：那會讓一個人說「我還沒看」變成脊椎上的一筆判決史。
  if (verdict === 'defer') {
    return {
      ...base,
      ok: true,
      block: preview,
      reason: 'accept-deferred',
      detail: '這一列留在佇列上，下次 `flow pending` 還會問',
    }
  }

  const res = (verdict === 'accept' ? acceptWork : dropWork)({
    work_id: workId,
    reason: answer,
    by: answeredBy,
    substrate: 'manual',
    payload: { via, gate: spanId },
    cwd: repoRoot,
  })
  if (res.written !== true) {
    return {
      ...base,
      ok: false,
      block: preview,
      reason: 'accept-write-failed',
      detail: `判決沒能落檔：${res.errors?.map((e) => e.code).join(',') ?? 'unknown'}`,
    }
  }
  return {
    ...base,
    ok: true,
    resolved: true,
    block: preview,
    reason: 'no-carrier',
    detail: `已寫入 work.${verdict === 'accept' ? 'accept' : 'drop'}；驗收判決的落點是 work item 自己的終態，沒有 carrier 檔`,
  }
}

/**
 * Answer one decision: close its span, then file the answer on its carrier.
 *
 * `dryRun` runs the identical resolution — same carrier, same block, same containment and
 * existence checks — and stops before any write. That is deliberate: the confirmation screen must
 * show what the write will actually do, and a separate "preview" code path is a second opinion
 * that eventually disagrees with the real one.
 */
export function answerDecision({
  spanId,
  answer,
  answeredBy,
  via,
  repoRoot,
  dryRun = false,
}: AnswerDecisionInput): AnswerDecisionResult {
  const base = {
    resolved: false,
    landed: false,
    carrier: null,
    carrierPath: null,
    block: '',
  }

  if (spineOverrideBlocks(repoRoot)) {
    return {
      ...base,
      ok: false,
      reason: 'spine-override',
      detail: `CLADE_FLOW_EVENTS 指向 ${process.env.CLADE_FLOW_EVENTS}，不在 ${repoRoot} 內；寫入會落到別的 spine`,
    }
  }

  // 驗收合成題先分流：它的 id 是 `work_id` 的別名，不是脊椎上的 span，`lookupDecision` 對它
  // 必然回 null，而那會被報成「沒有這一題」——一個真的在佇列上的東西被說成不存在。
  const acceptWorkId = parseAcceptSpanId(spanId)
  if (acceptWorkId) {
    return answerAcceptGate({
      workId: acceptWorkId,
      spanId,
      answer,
      answeredBy,
      via,
      repoRoot,
      dryRun,
    })
  }

  const decision = lookupDecision(spanId, repoRoot)
  if (!decision) {
    return {
      ...base,
      ok: false,
      reason: 'no-such-decision',
      detail: `${repoRoot} 的 spine 上沒有 span ${spanId} 的 decision.request`,
    }
  }

  const path = carrierPath(decision.carrier, repoRoot)
  const block = landingBlock(decision.question, answer, spanId, via)
  const preview = { carrier: decision.carrier, carrierPath: path, block }

  if (dryRun) {
    const { landed, reason, detail } = landOnCarrier(decision.carrier, path, block, repoRoot, true)
    return { ...preview, ok: true, resolved: false, landed, reason, detail }
  }

  const closed = resolveDecision(spanId, { answer, answeredBy, cwd: repoRoot })
  if (!closed.written) {
    const code = closed.errors?.[0]?.code
    return {
      ...preview,
      ok: false,
      resolved: false,
      landed: false,
      reason: code === 'already-resolved' ? 'already-resolved' : 'no-such-decision',
      detail:
        code === 'already-resolved'
          ? '這題已經被回答過了（Notion 那側、或另一個分頁）——沒有重複落檔'
          : `收不掉 span：${closed.errors?.map((e) => e.code).join(',') ?? 'unknown'}`,
    }
  }

  const { landed, reason, detail } = landOnCarrier(decision.carrier, path, block, repoRoot, false)
  // The span is closed either way, so this is `ok` even when nothing was filed: the answer is
  // recorded and the queue will stop showing the question. `landed:false` + `reason` says what
  // still needs a human — NEVER report that as a failed answer.
  return { ...preview, ok: true, resolved: true, landed, reason, detail }
}
