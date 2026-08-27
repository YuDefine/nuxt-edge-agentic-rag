// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/emit.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/emit.ts
// clade flow spine — emit library
//
// One append-only JSONL per repo: .clade/flow/events.jsonl. Every record is a
// $defs.flow_envelope from vendor/signals/schema.json, redacted and validated by
// vendor/signals/redact.ts. There is no second schema and no second validator: the spine
// reuses the signals governance so redaction stays non-bypassable.
//
// Fail-open, like the signals ledger: a spine write NEVER changes the exit code, stdout, or
// stderr semantics of the work it observes. A dispatch that cannot be recorded still runs.
//
// Env contract (read by adapters, so a child process joins its parent's trace):
//   CLADE_WORK_ID           work item this process belongs to; absent -> orphan work id
//   CLADE_FLOW_PARENT_SPAN  span that spawned this process; absent -> root span
//   CLADE_FLOW_EVENTS       override the events.jsonl path (tests, scoped runs)
//   CLADE_FLOW_OFF=1        disable capture entirely
//   CLADE_CONSUMER_ID       override registry-resolved consumer id

import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { redactPayload, validateFlowEvent } from '../../signals/redact.ts'
import { appendRaw } from '../../signals/ledger-writer.ts'
import { detectConsumer } from '../../signals/shim-core.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLADE_ROOT = resolve(__dirname, '..', '..', '..')

export const SCHEMA_VERSION = '1'

export function flowDisabled() {
  return process.env.CLADE_FLOW_OFF === '1'
}

function gitTopLevel(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/**
 * The spine path of one repo root, with no environment override.
 *
 * The fleet reader needs exactly this: `CLADE_FLOW_EVENTS` points at ONE file, so resolving 14
 * repo roots through `eventsPath()` would collapse all fourteen onto that file — every consumer
 * would appear to hold clade's stream, and the aggregate would be confidently wrong.
 */
export function spinePathIn(root: string) {
  return join(root, '.clade', 'flow', 'events.jsonl')
}

/** Repo-local spine path. Explicit override wins so tests never touch a real repo's stream. */
export function eventsPath(cwd = process.cwd()) {
  if (process.env.CLADE_FLOW_EVENTS) return resolve(process.env.CLADE_FLOW_EVENTS)
  return spinePathIn(gitTopLevel(cwd) || CLADE_ROOT)
}

export function newSpanId() {
  return randomBytes(8).toString('hex')
}

function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

const SLUG_OK = /^[a-z0-9][a-z0-9-]*$/

/** W-<YYYY-MM-DD>-<slug>. Throws on a slug the envelope pattern would reject. */
export function mintWorkId(slug, now = new Date()) {
  const normalized = String(slug)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!SLUG_OK.test(normalized)) throw new Error(`unusable work slug: ${slug}`)
  return `W-${utcDate(now)}-${normalized}`
}

/**
 * The work id this process belongs to. With no ambient CLADE_WORK_ID an orphan id is minted
 * rather than dropping the event: an unattributed span still belongs on the spine, and the
 * `orphan-` prefix makes the attribution gap countable instead of invisible.
 */
export function resolveWorkId(hint = null) {
  const explicit = hint ?? process.env.CLADE_WORK_ID ?? null
  if (explicit) return explicit
  return mintWorkId(`orphan-${randomBytes(3).toString('hex')}`)
}

function identity(cwd) {
  const consumer = detectConsumer(cwd) ?? {}
  return {
    consumer_id: process.env.CLADE_CONSUMER_ID ?? consumer.consumer_id ?? 'unknown',
    repo_id: consumer.repo_id ?? 'unknown/unknown',
  }
}

/**
 * Build + persist one envelope. Returns { written, record } and never throws: callers are
 * dispatchers and gates whose own contract outranks telemetry.
 */
export interface FlowEventInput {
  work_id: string
  span_id: string
  parent_span?: string | null
  phase: 'start' | 'end' | 'point'
  kind: string
  actor: string
  substrate: string
  session_id?: string | null
  payload?: Record<string, unknown>
  outcome?: string | null
  ts_utc?: string
  cwd?: string
}

export interface OpenWorkInput {
  slug: string
  actor?: string
  session_id?: string | null
  /**
   * `<scheme>:<id>` naming where this work item was born — `notion:<uuid>`, `td:TD-NNN`,
   * `tasks:<path>`, `handoff:<section>`, `im:<one line>`. Optional on purpose: minting is
   * fail-open everywhere, and a work item with no stated origin is still worth having a name.
   */
  origin?: string | null
  /** One human line naming the problem, so a reader recognises it without opening anything. */
  title?: string | null
  payload?: Record<string, unknown>
  cwd?: string
}

export interface StartSpanInput {
  work_id?: string | null
  /**
   * Pre-generated span id. A dispatcher that must hand CLADE_FLOW_PARENT_SPAN to a child process
   * before the child exists needs the id in hand earlier than the start event can be emitted;
   * minting it here would force either a second id or an event emitted too late to survive a crash.
   */
  span_id?: string
  kind: string
  actor: string
  substrate: string
  session_id?: string | null
  parent_span?: string | null
  payload?: Record<string, unknown>
  cwd?: string
}

export interface SpanHandle {
  work_id: string
  span_id: string
  parent_span: string | null
  started_at: string
  kind: string
  actor: string
  substrate: string
  session_id: string | null
}

/**
 * Payload a kind cannot be written without.
 *
 * The rest of this library is fail-open — a spine write NEVER changes the outcome of the work it
 * observes — and these three are the deliberate exception, checked before anything else so the
 * refusal does not depend on capture being switched on.
 *
 * `work.done` is the load-bearing one. Every other kind records something that happened; `work.done`
 * records a CLAIM about it, and a claim with no evidence attached is worse than silence: the whole
 * point of the terminal states is that acceptance rests on the verification, so a done that may be
 * empty makes "has this been accepted" rest on a fabricated "is this finished". `work.accept` and
 * `work.drop` hold the bar `flow close --reason` already holds — a closure with no stated basis is
 * indistinguishable from quietly deleting the evidence.
 *
 * Refused, not thrown: callers are dispatchers and gates whose own contract outranks telemetry, and
 * the same `{ written: false, errors }` shape every other rejection uses is what the CLI turns into
 * a non-zero exit. The gate lives HERE rather than in the helpers below because `flow emit --kind
 * work.done` is a door too, and a gate only one door honours is not a gate.
 */
const REQUIRED_PAYLOAD: Record<string, { field: string; code: string; why: string }> = {
  'work.done': {
    field: 'verification',
    code: 'verification-required',
    why: "work.done needs payload.verification — how it was verified, in one line. A done nobody can check is what makes 'accepted' meaningless",
  },
  'work.accept': {
    field: 'reason',
    code: 'reason-required',
    why: 'work.accept needs payload.reason — an acceptance with no stated basis is a silent close',
  },
  'work.drop': {
    field: 'reason',
    code: 'reason-required',
    why: 'work.drop needs payload.reason — a drop with no stated basis is a silent delete',
  },
}

function requiredPayloadError(kind: string, payload: Record<string, unknown>) {
  const rule = REQUIRED_PAYLOAD[kind]
  if (!rule) return null
  const value = payload?.[rule.field]
  if (typeof value === 'string' && value.trim().length > 0) return null
  return { code: rule.code, message: rule.why }
}

export function emitEvent({
  work_id,
  span_id,
  parent_span = null,
  phase,
  kind,
  actor,
  substrate,
  session_id,
  payload = {},
  outcome = null,
  ts_utc = new Date().toISOString(),
  cwd = process.cwd(),
}: FlowEventInput) {
  // Before the CLADE_FLOW_OFF check on purpose: refusing an unsupported claim is not telemetry,
  // and it must not become conditional on telemetry being enabled.
  const required = requiredPayloadError(kind, payload)
  if (required) {
    process.stderr.write(`[clade flow] ${required.message}\n`)
    return { written: false, errors: [required] }
  }
  if (flowDisabled()) return { written: false, skipped: 'CLADE_FLOW_OFF' }
  try {
    const { consumer_id, repo_id } = identity(cwd)
    const record = redactPayload({
      schema_version: SCHEMA_VERSION,
      event_id: randomUUID(),
      work_id,
      span_id,
      parent_span,
      phase,
      kind,
      actor,
      substrate,
      ts_utc,
      consumer_id,
      repo_id,
      session_id: session_id ?? String(process.pid),
      payload,
      outcome,
      redaction_applied: true,
    })
    const { ok, errors } = validateFlowEvent(record)
    if (!ok) {
      process.stderr.write(`[clade flow] event rejected (${errors.map((e) => e.code).join(',')})\n`)
      return { written: false, errors }
    }
    const path = eventsPath(cwd)
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // appendRaw gives the single-writer advisory lock; validation already ran above.
    const res = appendRaw(record, { ledgerPath: path })
    return { written: res.written === true, record }
  } catch (e) {
    process.stderr.write(`[clade flow] emit failed (fail-open): ${e.message}\n`)
    return { written: false, errors: [{ code: 'emit-failed', message: e.message }] }
  }
}

/** Open a work item: one point event that names the work id for everything downstream. */
export function openWork({
  slug,
  actor = 'unknown',
  session_id = null,
  origin = null,
  title = null,
  payload = {},
  cwd,
}: OpenWorkInput) {
  const work_id = mintWorkId(slug)
  const span_id = newSpanId()
  // origin_kind is derived from origin_ref rather than passed separately: two fields that must
  // agree are two fields that can disagree, and the scheme is already the first half of the ref.
  const origin_ref = typeof origin === 'string' && origin.trim() ? origin.trim() : null
  const origin_kind = origin_ref ? (origin_ref.split(':')[0] ?? null) : null
  emitEvent({
    work_id,
    span_id,
    parent_span: null,
    phase: 'point',
    kind: 'work.open',
    actor,
    substrate: 'manual',
    session_id,
    payload: {
      slug,
      ...(origin_ref ? { origin_ref, origin_kind } : {}),
      ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
      ...payload,
    },
    outcome: 'ok',
    cwd,
  })
  return { work_id, span_id }
}

/**
 * Emit the start half of a span and return the handle its end half needs. An unmatched start
 * is a legible in-flight/stalled span, so adapters emit it BEFORE the work runs — not after,
 * where a crash would erase the fact that anything was attempted.
 */
export function startSpan({
  work_id,
  span_id: spanIdHint,
  kind,
  actor,
  substrate,
  session_id = null,
  parent_span = process.env.CLADE_FLOW_PARENT_SPAN ?? null,
  payload = {},
  cwd,
}: StartSpanInput): SpanHandle {
  const resolved = resolveWorkId(work_id)
  const span_id = spanIdHint ?? newSpanId()
  const started_at = new Date().toISOString()
  emitEvent({
    work_id: resolved,
    span_id,
    parent_span,
    phase: 'start',
    kind,
    actor,
    substrate,
    session_id,
    payload,
    outcome: null,
    ts_utc: started_at,
    cwd,
  })
  return { work_id: resolved, span_id, parent_span, started_at, kind, actor, substrate, session_id }
}

export function endSpan(
  handle: SpanHandle | null,
  {
    outcome = 'ok',
    payload = {},
    cwd,
  }: { outcome?: string; payload?: Record<string, unknown>; cwd?: string } = {},
) {
  if (!handle) return { written: false, errors: [{ code: 'no-span-handle' }] }
  const ended_at = new Date().toISOString()
  const duration_ms = Math.max(0, Date.parse(ended_at) - Date.parse(handle.started_at))
  return emitEvent({
    work_id: handle.work_id,
    span_id: handle.span_id,
    parent_span: handle.parent_span ?? null,
    phase: 'end',
    kind: handle.kind,
    actor: handle.actor,
    substrate: handle.substrate,
    session_id: handle.session_id,
    payload: { started_at: handle.started_at, duration_ms, ...payload },
    outcome,
    ts_utc: ended_at,
    cwd,
  })
}

/**
 * Has this span already been closed on the spine?
 *
 * The spine itself is the authority, not any adapter's own bookkeeping: a span is opened and closed
 * by different processes, and the closers cannot see each other. Asking the stream directly is what
 * makes closing idempotent no matter which of them gets there first.
 *
 * Fail-open answers `false` — "cannot prove it is closed". A duplicate end merely lets the later
 * one win when spans are folded; a missing end is a permanent false stall in every `--stalled`
 * style query, which is the worse of the two.
 */
export function spanIsClosed(spanId: string, cwd = process.cwd()) {
  try {
    return readEvents(cwd).some((e) => e.span_id === spanId && e.phase === 'end')
  } catch {
    return false
  }
}

/**
 * Read one spine file. Malformed lines are skipped, never thrown on.
 *
 * Split out from `readEvents` so the fleet reader parses events the same way this one does —
 * two parsers would be two answers to "what counts as an event".
 */
export function readEventsFile(path: string) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

/** Read this repo's spine back. */
export function readEvents(cwd = process.cwd()) {
  return readEventsFile(eventsPath(cwd))
}

/**
 * Merge externally produced envelopes into this repo's spine.
 *
 * The one place where records arrive that this process did not build: a CI job's events.jsonl
 * downloaded back from an artifact (the ephemeral runner's copy dies with the job), or a harness
 * `Workflow` journal converted after the fact (§5). Both are the same problem — events that
 * happened elsewhere — so they get one door, not one door each.
 *
 * Three properties the door must have:
 *   - **dedupe by `event_id`**: re-ingesting the same artifact is how anyone will actually use
 *     this (download again, run again), so it MUST be a no-op rather than a doubled timeline.
 *   - **re-redact**: the source is outside this repo's governance. Redaction is not opt-out here
 *     any more than it is on emit.
 *   - **validate每筆**: a malformed record is skipped and counted, never appended. One bad line
 *     in an artifact NEVER poisons the stream.
 */
export function ingestEvents(records: unknown[], { cwd = process.cwd() } = {}) {
  if (flowDisabled()) return { ingested: 0, duplicates: 0, rejected: 0, skipped: 'CLADE_FLOW_OFF' }
  const seen = new Set(readEvents(cwd).map((e) => e.event_id))
  let ingested = 0
  let duplicates = 0
  let rejected = 0
  const path = eventsPath(cwd)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  for (const raw of records) {
    if (!raw || typeof raw !== 'object') {
      rejected++
      continue
    }
    const record = redactPayload({
      ...(raw as Record<string, unknown>),
      redaction_applied: true,
    }) as Record<string, unknown> & { event_id?: string }
    const eventId = record.event_id
    if (!eventId) {
      rejected++
      continue
    }
    if (seen.has(eventId)) {
      duplicates++
      continue
    }
    const { ok } = validateFlowEvent(record)
    if (!ok) {
      rejected++
      continue
    }
    const res = appendRaw(record, { ledgerPath: path })
    if (res.written === true) {
      seen.add(eventId)
      ingested++
    } else rejected++
  }
  return { ingested, duplicates, rejected }
}

/** Parse a JSONL blob into candidate records. Malformed lines count as rejects, not throws. */
export function parseEventLines(text: string) {
  const records = []
  let malformed = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      malformed++
    }
  }
  return { records, malformed }
}

/**
 * The `\my` first bucket — decisions waiting on a human — as spine events.
 *
 * Modelled as a SPAN, not a pair of point events: `phase: 'start'` is the question and
 * `phase: 'end'` is the answer, so an unanswered decision is simply an unclosed span. Every
 * query that already exists — in-flight rendering, `spanIsClosed`, `--stalled` — covers the
 * decision queue for free, and a question left open for three days shows up as a stall because
 * that is exactly what it is. A separate `decision.resolve` kind was deliberately NOT added:
 * the resolved-ness lives in `phase`, so a second kind would be vocabulary nothing reads.
 *
 * The failure this closes is stated in the `\my` contract itself — pending decisions "mostly
 * exist only in the conversation", invisible to all four registered sources. A decision that is
 * never emitted stays invisible; **emit at the moment the question forms**, not when it is
 * answered.
 */
export interface RequestDecisionInput {
  /** The question, in the language the human will read it in. */
  question: string
  /** Ordered options; put the recommended one first, matching the `\my` output contract. */
  options?: string[]
  recommended?: string | null
  /** `\my` bucket: which of the four categories this belongs to. */
  category?: 'ruling' | 'other-repo' | 'irreversible' | 'loop-structural'
  /** Where the answer must land once given — a TD id, HANDOFF section, or tasks/ path. */
  carrier?: string | null
  work_id?: string | null
  actor?: string
  substrate?: string
  session_id?: string | null
  payload?: Record<string, unknown>
  cwd?: string
}

/**
 * 剝掉呼叫端自己寫進選項文字的字母前綴（`A. ` / `B、`）。
 *
 * 字母是**渲染層**的東西：`/decisions` 依索引自己編號，卡片才不會因為刪掉一題就跳號。
 * 呼叫端連字母一起寫進來時兩層會疊成 `A. A. 改，…`。剝在這裡而不是各呼叫端，是因為
 * `ask` CLI、`decision-sync`、`herdr-session-handoff` 三個入口都經過這個函式。
 */
function stripOptionLetter(text: string): string {
  return text.replace(/^[A-Za-z][.、)）]\s*/, '')
}

export function requestDecision({
  question,
  options = [],
  recommended = null,
  category = 'ruling',
  carrier = null,
  work_id = null,
  actor = 'unknown',
  substrate = 'claude-code',
  session_id = null,
  payload = {},
  cwd,
}: RequestDecisionInput): SpanHandle {
  const cleanOptions = options.map(stripOptionLetter)
  // `recommended` 要跟著剝，否則正規化後的選項比對不回它，推薦標記會整個消失。
  const cleanRecommended = recommended === null ? null : stripOptionLetter(recommended)

  return startSpan({
    work_id,
    kind: 'decision.request',
    actor,
    substrate,
    session_id,
    payload: {
      question,
      options: cleanOptions,
      recommended: cleanRecommended,
      category,
      carrier,
      ...payload,
    },
    cwd,
  })
}

/**
 * Rebuild a span handle from the spine so a *different process* can close it.
 *
 * `endSpan` needs the handle the opener held, but a decision is answered somewhere else entirely
 * — Charles on his phone, hours later, via the projector. Without this the answer would have to
 * invent a fresh span, and the question would stay open forever next to it.
 *
 * Returns null when the start event is not on the spine; the caller decides whether that is a
 * fatal condition. It is deliberately NOT an error here: fail-open matches the rest of this lib.
 */
export function spanHandleFromSpine(spanId: string, cwd = process.cwd()): SpanHandle | null {
  const start = readEvents(cwd).find((e) => e.span_id === spanId && e.phase === 'start') as
    | Record<string, unknown>
    | undefined
  if (!start) return null
  return {
    work_id: String(start.work_id),
    span_id: String(start.span_id),
    parent_span: (start.parent_span as string | null) ?? null,
    started_at: String(start.ts_utc),
    kind: String(start.kind),
    actor: String(start.actor),
    substrate: String(start.substrate),
    session_id: (start.session_id as string | null) ?? null,
  }
}

/**
 * Close a decision span with the human's answer.
 *
 * Idempotent by asking the spine, not by local bookkeeping (same reasoning as `spanIsClosed`):
 * the projector may see the same filled-in row on two consecutive polls, and a second `end`
 * would make the same question look answered twice.
 */
export function resolveDecision(
  spanId: string,
  {
    answer,
    answeredBy = 'human',
    payload = {},
    cwd = process.cwd(),
  }: { answer: string; answeredBy?: string; payload?: Record<string, unknown>; cwd?: string },
) {
  if (spanIsClosed(spanId, cwd)) {
    return { written: false, errors: [{ code: 'already-resolved' }] }
  }
  const handle = spanHandleFromSpine(spanId, cwd)
  if (!handle) return { written: false, errors: [{ code: 'no-such-decision' }] }
  return endSpan(handle, {
    outcome: 'ok',
    payload: { answer, answered_by: answeredBy, ...payload },
    cwd,
  })
}

/**
 * Decisions still waiting on a human: `decision.request` spans with no `end`.
 *
 * This is what `\my` bucket 1 becomes — one query instead of a hand-assembled sweep over five
 * sources, the fifth of which (the live conversation) no tool could read at all.
 */
export function pendingDecisions(cwd = process.cwd()) {
  const events = readEvents(cwd)
  const closed = new Set(events.filter((e) => e.phase === 'end').map((e) => e.span_id as string))
  // Folded here, not at each call site: a caller that read the raw start payload would see the
  // options a since-fixed parser wrote, and act on a question the page no longer shows.
  const amendments = latestAmendments(events as unknown as Record<string, unknown>[])
  return events
    .filter((e) => e.kind === 'decision.request' && e.phase === 'start')
    .filter((e) => !closed.has(e.span_id as string))
    .map((e) => ({
      span_id: e.span_id as string,
      work_id: e.work_id as string,
      asked_at: e.ts_utc as string,
      actor: e.actor as string,
      repo_id: e.repo_id as string,
      ...applyAmendment(e.payload as Record<string, unknown>, amendments.get(e.span_id as string)),
    }))
}

/**
 * The back-and-forth on a question that was asked too tersely to answer.
 *
 * Modelled as POINT EVENTS hanging off the decision span (`parent_span` = the decision), never as
 * a second span. A clarification is part of *this* question, not another piece of work, so the one
 * thing the span means — "not closed = not answered yet" — has to keep meaning exactly that.
 * Every existing query (`spanIsClosed`, in-flight rendering, `--stalled`) stays correct untouched.
 *
 * The failure this closes: a question the human cannot answer has, until now, exactly two exits —
 * answer it anyway, or open an attended session to go ask. Both lose the queue. This gives the
 * "I need more information" a place to live where the asking side will actually see it.
 *
 * `direction` is on the payload rather than in two event kinds because both halves are the same
 * fact ("someone said something about this question") and every reader wants them in one ordered
 * list. Two kinds would make the common query a union of two filters, and a reader that forgot
 * one half would silently render half a conversation.
 */
export type ClarifyDirection = 'request' | 'response'

export interface ClarifyInput {
  spanId: string
  text: string
  actor?: string
  substrate?: string
  cwd?: string
}

function emitClarify(
  direction: ClarifyDirection,
  { spanId, text, actor, substrate, cwd }: ClarifyInput,
) {
  // The work id has to come off the decision itself. Minting a fresh one would put the
  // clarification in a work item of its own, where every per-work query would stop associating it
  // with the question it belongs to.
  const handle = spanHandleFromSpine(spanId, cwd ?? process.cwd())
  if (!handle) return { written: false, errors: [{ code: 'no-such-decision' }] }
  if (handle.kind !== 'decision.request') {
    return { written: false, errors: [{ code: 'not-a-decision' }] }
  }
  return emitEvent({
    work_id: handle.work_id,
    span_id: newSpanId(),
    parent_span: spanId,
    phase: 'point',
    kind: 'decision.clarify',
    actor: actor ?? 'unknown',
    substrate: substrate ?? handle.substrate,
    payload: { direction, text },
    outcome: 'ok',
    cwd,
  })
}

/** A human says the question is not answerable as written. Does NOT close the span. */
export function requestClarification(input: ClarifyInput) {
  return emitClarify('request', input)
}

/** The agent side supplies what was missing. Also does NOT close the span — the human still answers. */
export function answerClarification(input: ClarifyInput) {
  return emitClarify('response', input)
}

/**
 * A human says a decision span no longer needs anyone — `blocked`, or asked-but-never-a-question.
 *
 * The name says `Gated` for history only; it retires either shape and NEVER only the gated one.
 *
 * The gated bucket has no other exit. A blocked span is *already ended* — nothing can close it a
 * second time, and `lastStartByWork` only stops reporting it if new work happens to start in the
 * same work id. The 2026-08-27 case that forced this: a blocked pane asked an A/B question, the
 * underlying TD was ruled on two days later through an entirely different session, and the card
 * stayed on `/decisions` forever because nothing on the spine could say "that question evaporated".
 *
 * `asked` normally closes by being answered, and that stays the rule while the question is still
 * a question. It stops being the rule when the row turns out never to have been one: the same day
 * retired the `跨 repo` intake, whose 15 open spans quote sections saying `本 repo 不修` /
 * `已移交` / `不用再開`. Nobody can rule on those — there is no ruling — and the scanner no longer
 * emits them, so without this exit they would sit unanswered on the spine forever. NEVER retire
 * such a row by filtering it out at render time instead: a row that vanishes with nothing written
 * down is indistinguishable from one that was never scanned, and `--stalled` would still report
 * it. A dismissal is a point event with a required reason, so the write-off stays auditable.
 *
 * A point event, never an `end`: the span already has one, and overwriting it would rewrite what
 * actually happened (blocked) with what someone later decided about it.
 */
export interface DismissInput {
  spanId: string
  /** Why it no longer needs anyone. Required — a dismissal with no reason is indistinguishable
   * from someone tidying the queue, which is the one thing this must not become. */
  reason: string
  dismissedBy?: string
  cwd?: string
}

export function dismissGated({ spanId, reason, dismissedBy = 'human', cwd }: DismissInput) {
  if (!reason.trim()) return { written: false, errors: [{ code: 'reason-required' }] }
  const handle = spanHandleFromSpine(spanId, cwd ?? process.cwd())
  if (!handle) return { written: false, errors: [{ code: 'no-such-span' }] }
  return emitEvent({
    work_id: handle.work_id,
    span_id: newSpanId(),
    parent_span: spanId,
    phase: 'point',
    kind: 'decision.dismiss',
    actor: dismissedBy,
    substrate: handle.substrate,
    payload: { reason: reason.trim(), dismissed_by: dismissedBy },
    outcome: 'ok',
    cwd,
  })
}

/**
 * A human changes an answer they already gave.
 *
 * A point event for the same reason `dismissGated` is one: the decision span already has an `end`
 * carrying what was decided at the time, and overwriting it would erase exactly what the spine
 * exists to keep. So the span stays closed and the correction hangs underneath it — which also
 * means every reader that wants "what is the answer now" has to fold, and `effectiveAnswer` below
 * is that fold. NEVER read the `end` payload alone once revisions exist.
 *
 * `revision` is computed from the spine (count the existing revise events + 1) rather than stored
 * anywhere: a counter kept beside the stream is a second copy of a fact the stream already has.
 */
export interface ReviseInput {
  spanId: string
  answer: string
  revisedBy?: string
  cwd?: string
  payload?: Record<string, unknown>
}

export function reviseDecisionEvent({
  spanId,
  answer,
  revisedBy = 'human',
  cwd,
  payload = {},
}: ReviseInput) {
  if (!answer.trim()) return { written: false, errors: [{ code: 'answer-required' }] }
  const root = cwd ?? process.cwd()
  const handle = spanHandleFromSpine(spanId, root)
  if (!handle) return { written: false, errors: [{ code: 'no-such-decision' }] }
  if (handle.kind !== 'decision.request') {
    return { written: false, errors: [{ code: 'not-a-decision' }] }
  }
  const history = decisionAnswerHistory(spanId, root)
  if (!history.answered) return { written: false, errors: [{ code: 'not-answered' }] }
  return emitEvent({
    work_id: handle.work_id,
    span_id: newSpanId(),
    parent_span: spanId,
    phase: 'point',
    kind: 'decision.revise',
    actor: revisedBy,
    substrate: handle.substrate,
    payload: {
      answer: answer.trim(),
      previous_answer: history.answer,
      revision: history.revisions + 1,
      revised_by: revisedBy,
      ...payload,
    },
    outcome: 'ok',
    cwd,
  })
}

/**
 * Refresh what an OPEN question shows, without closing it and without asking it again.
 *
 * THE REASON THIS EXISTS: the spine is append-only, and a question's options live in the payload
 * of its `start` event. So when the thing that PRODUCED that payload is fixed — a parser that
 * could not read the bold shape the fleet actually writes — every question already on the queue
 * keeps the payload the broken parser wrote, forever. Measured 2026-08-27: <consumer-i>'s `TD-585` shows
 * zero options on `/decisions` while `HANDOFF.md` carries a clean A/B two feet away.
 *
 * The obvious repair is the forbidden one. `source_id` dedup is a DELIBERATE CONTRACT — a
 * question whose wording is edited is the same question, and re-asking it would buzz a phone for
 * something already answered — so the fix MUST NEVER be "let it be scanned again". Amending is
 * the other half of that contract: identity is fixed by `source_id`, and everything downstream of
 * identity (what the options are, how they are worded) is allowed to be corrected in place.
 *
 * NEVER amend an ANSWERED question. An answer was given against the options that were on screen;
 * swapping them underneath it would silently restate what the human chose. Those get
 * `decision.revise` — which requires an answer to exist — or nothing at all.
 */
export function amendDecision({
  spanId,
  options,
  recommended = null,
  question = null,
  detail = null,
  lint = null,
  fingerprint = null,
  reason,
  actor = 'source-scan',
  cwd,
}: {
  spanId: string
  options: string[]
  recommended?: string | null
  question?: string | null
  detail?: string | null
  lint?: string[] | null
  fingerprint?: string | null
  reason: string
  actor?: string
  cwd?: string
}) {
  const root = cwd ?? process.cwd()
  const handle = spanHandleFromSpine(spanId, root)
  if (!handle) return { written: false, errors: [{ code: 'no-such-decision' }] }
  if (handle.kind !== 'decision.request') {
    return { written: false, errors: [{ code: 'not-a-decision' }] }
  }
  // An answered question is out of scope by construction — see the doc comment.
  if (decisionAnswerHistory(spanId, root).answered) {
    return { written: false, errors: [{ code: 'already-answered' }] }
  }
  if (!reason.trim()) return { written: false, errors: [{ code: 'reason-required' }] }
  return emitEvent({
    work_id: handle.work_id,
    span_id: newSpanId(),
    parent_span: spanId,
    phase: 'point',
    kind: 'decision.amend',
    actor,
    substrate: handle.substrate,
    payload: {
      options,
      recommended,
      ...(question === null ? {} : { question }),
      ...(detail === null ? {} : { detail }),
      ...(lint === null ? {} : { lint }),
      ...(fingerprint === null ? {} : { source_fingerprint: fingerprint }),
      reason: reason.trim(),
      amended_by: actor,
    },
    outcome: 'ok',
    cwd,
  })
}

/**
 * The amendment in force for each open decision, newest wins.
 *
 * Exported because two readers need the same fold: `pendingDecisions` here, and the queue builder
 * in `decisions.ts`. Two folds would be two answers to "what does this question ask", and the
 * page and the scanner would disagree the first time one of them was updated alone.
 */
export function latestAmendments(
  events: Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const byParent = new Map<string, { ts: string; payload: Record<string, unknown> }>()
  for (const event of events) {
    if (event.kind !== 'decision.amend') continue
    const parent = typeof event.parent_span === 'string' ? event.parent_span : null
    if (!parent) continue
    const ts = String(event.ts_utc ?? '')
    const held = byParent.get(parent)
    if (held && held.ts > ts) continue
    byParent.set(parent, { ts, payload: (event.payload ?? {}) as Record<string, unknown> })
  }
  return new Map([...byParent].map(([parent, held]) => [parent, held.payload]))
}

/** The subset of an amendment payload that overrides the question's own payload. */
export function applyAmendment(
  payload: Record<string, unknown>,
  amendment: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!amendment) return payload
  const merged = { ...payload }
  if (Array.isArray(amendment.options)) merged.options = amendment.options
  if ('recommended' in amendment) merged.recommended = amendment.recommended
  if (typeof amendment.question === 'string') merged.question = amendment.question
  if (typeof amendment.detail === 'string') merged.detail = amendment.detail
  if (Array.isArray(amendment.lint)) merged.lint = amendment.lint
  if (
    typeof amendment.source_fingerprint === 'string' &&
    merged.source &&
    typeof merged.source === 'object'
  ) {
    merged.source = {
      ...(merged.source as Record<string, unknown>),
      fingerprint: amendment.source_fingerprint,
    }
  }
  return merged
}

/**
 * An agent declares it has read an answer and is acting on it.
 *
 * This is the only HARD evidence that revising an answer is now unsafe. The alternative — infer
 * pickup from a later span in the same work item — is structurally blind to the common case: an
 * agent that reads the answer in a fresh process gets an unrelated orphan work id from
 * `resolveWorkId`, so nothing connects its work to the question it answered. Inference can
 * therefore only ever be the soft lock; this is the one a surface may refuse an edit on outright.
 */
export function pickupDecision({
  spanId,
  actor = 'unknown',
  substrate,
  note = null,
  cwd,
}: {
  spanId: string
  actor?: string
  substrate?: string
  note?: string | null
  cwd?: string
}) {
  const handle = spanHandleFromSpine(spanId, cwd ?? process.cwd())
  if (!handle) return { written: false, errors: [{ code: 'no-such-decision' }] }
  if (handle.kind !== 'decision.request') {
    return { written: false, errors: [{ code: 'not-a-decision' }] }
  }
  return emitEvent({
    work_id: handle.work_id,
    span_id: newSpanId(),
    parent_span: spanId,
    phase: 'point',
    kind: 'decision.pickup',
    actor,
    substrate: substrate ?? handle.substrate,
    payload: { picked_by: actor, ...(note ? { note } : {}) },
    outcome: 'ok',
    cwd,
  })
}

/**
 * What one decision's answer is right now, folded over the end event and every revision.
 *
 * Lives here rather than in each caller because "the answer" stopped being a single field the
 * moment revisions existed, and two readers folding it differently is how a queue starts showing
 * one answer while the file on disk carries another.
 */
export function decisionAnswerHistory(spanId: string, cwd = process.cwd()) {
  const events = readEvents(cwd) as unknown as Record<string, unknown>[]
  let answered = false
  let answer = ''
  let answeredBy = ''
  let answeredAt = ''
  let retracted = false
  const revisions: Record<string, unknown>[] = []
  for (const event of events) {
    const payload = (event.payload ?? {}) as Record<string, unknown>
    if (event.span_id === spanId && event.phase === 'end') {
      answered = true
      answer = typeof payload.answer === 'string' ? payload.answer : ''
      answeredBy = typeof payload.answered_by === 'string' ? payload.answered_by : ''
      answeredAt = String(event.ts_utc ?? '')
      retracted = payload.retracted === true
    }
    if (event.kind === 'decision.revise' && event.parent_span === spanId) revisions.push(event)
  }
  revisions.sort((a, b) => String(a.ts_utc ?? '').localeCompare(String(b.ts_utc ?? '')))
  const last = revisions.at(-1)
  if (last) {
    const payload = (last.payload ?? {}) as Record<string, unknown>
    if (typeof payload.answer === 'string') answer = payload.answer
    answeredBy = typeof payload.revised_by === 'string' ? payload.revised_by : answeredBy
  }
  return {
    answered,
    retracted,
    answer,
    answeredBy,
    answeredAt,
    revisions: revisions.length,
    lastRevisedAt: last ? String(last.ts_utc ?? '') : null,
  }
}

/**
 * Whether an answer is still safe to change, and on what evidence.
 *
 * ONE rule, two adapters. `answer.ts` feeds it raw events (single repo, about to write) and
 * `decisions.ts` feeds it folded spans (fleet-wide, about to render). A second copy of "has this
 * been picked up" would let the page offer an edit that the writer then refuses, which is worse
 * than either answer alone.
 *
 * `pickup` is an agent saying so. `follow-up` is the inference: real work started in the same work
 * item after the answer. The inference EXCLUDES point events and the whole `decision.` family on
 * purpose — a clarification, a dismissal, a revision, or the 60-second source scan opening another
 * question are all conversation ABOUT the decision, not somebody executing it. Without those two
 * exclusions the queue's own reconciliation would lock every answer it walked past.
 */
export interface LockCandidate {
  kind: string
  work_id: string
  at: string
  is_point: boolean
  actor: string
  parent_span: string | null
}

export interface DecisionLock {
  by: 'pickup' | 'follow-up'
  at: string
  actor: string
}

export function computeDecisionLock(
  spanId: string,
  workId: string,
  answeredAt: string,
  candidates: LockCandidate[],
): DecisionLock | null {
  let followUp: DecisionLock | null = null
  for (const c of candidates) {
    if (c.kind === 'decision.pickup' && c.parent_span === spanId) {
      return { by: 'pickup', at: c.at, actor: c.actor }
    }
    if (c.is_point || !c.at || !answeredAt) continue
    if (c.work_id !== workId || c.kind.startsWith('decision.')) continue
    if (c.at <= answeredAt) continue
    if (!followUp || c.at < followUp.at) followUp = { by: 'follow-up', at: c.at, actor: c.actor }
  }
  return followUp
}

/**
 * The work-item terminal vocabulary: done → accept | drop, plus park for "stopped at a carrier".
 *
 * All four are POINT events carried on the work id with no `parent_span`. They are facts about the
 * WORK, not about any one dispatch that touched it, and hanging them off a span would make a work
 * item's finishedness depend on which pane happened to be last — precisely the confusion the work
 * layer exists to remove. `settled` is NOT retired by any of them: it stays as "nobody is moving and
 * nobody claimed completion", which is the state that answers "is this actually finished?" honestly.
 *
 * Who may write which is a real distinction, kept in the kinds rather than in a permission field:
 * `work.done` is the doing agent's claim, `work.accept` / `work.drop` are the human's verdict.
 */
export interface MarkWorkDoneInput {
  work_id: string
  /** How it was verified, in one line. Required — see REQUIRED_PAYLOAD. */
  verification: string
  verifiedBy?: string
  actor?: string
  substrate?: string
  session_id?: string | null
  payload?: Record<string, unknown>
  cwd?: string
}

function workPoint(
  kind: string,
  {
    work_id,
    actor,
    substrate = 'manual',
    session_id = null,
    payload,
    cwd,
  }: {
    work_id: string
    actor: string
    substrate?: string
    session_id?: string | null
    payload: Record<string, unknown>
    cwd?: string
  },
) {
  return emitEvent({
    work_id,
    span_id: newSpanId(),
    parent_span: null,
    phase: 'point',
    kind,
    actor,
    substrate,
    session_id,
    payload,
    outcome: 'ok',
    cwd,
  })
}

/** The doing side claims completion. Refused without `verification` — the one fail-closed write. */
export function markWorkDone({
  work_id,
  verification,
  verifiedBy = 'unknown',
  actor = 'unknown',
  substrate = 'manual',
  session_id = null,
  payload = {},
  cwd,
}: MarkWorkDoneInput) {
  return workPoint('work.done', {
    work_id,
    actor,
    substrate,
    session_id,
    payload: {
      verification: String(verification ?? '').trim(),
      verified_by: verifiedBy,
      ...payload,
    },
    cwd,
  })
}

export interface WorkVerdictInput {
  work_id: string
  /** Why it was accepted / dropped. Required, on the same basis `flow close --reason` requires one. */
  reason: string
  by?: string
  actor?: string
  substrate?: string
  session_id?: string | null
  payload?: Record<string, unknown>
  cwd?: string
}

/** A human accepts the work: the terminal state everything else is measured against. */
export function acceptWork({
  work_id,
  reason,
  by = 'human',
  actor,
  substrate = 'manual',
  session_id = null,
  payload = {},
  cwd,
}: WorkVerdictInput) {
  return workPoint('work.accept', {
    work_id,
    actor: actor ?? by,
    substrate,
    session_id,
    payload: { reason: String(reason ?? '').trim(), accepted_by: by, ...payload },
    cwd,
  })
}

/** A human writes the work off. Terminal like accept — dropped work is finished, not unfinished. */
export function dropWork({
  work_id,
  reason,
  by = 'human',
  actor,
  substrate = 'manual',
  session_id = null,
  payload = {},
  cwd,
}: WorkVerdictInput) {
  return workPoint('work.drop', {
    work_id,
    actor: actor ?? by,
    substrate,
    session_id,
    payload: { reason: String(reason ?? '').trim(), dropped_by: by, ...payload },
    cwd,
  })
}

export interface ParkWorkInput {
  work_id: string
  /** Where the remaining work landed: `handoff:<section>`, `td:TD-NNN`, `tasks:<path>`. */
  carrier: string
  note?: string | null
  actor?: string
  substrate?: string
  session_id?: string | null
  cwd?: string
}

/**
 * The work stopped at a prose carrier and is waiting for whoever picks that carrier up.
 *
 * Without it, `/handoff park` is the one exit that leaves no structured trace at all: the work item
 * simply goes quiet, and quiet is indistinguishable from abandoned. Parked is NOT terminal — the
 * successor is expected — so it deliberately does not enter the state machine; it is the note that
 * says where to look.
 */
export function parkWork({
  work_id,
  carrier,
  note = null,
  actor = 'unknown',
  substrate = 'manual',
  session_id = null,
  cwd,
}: ParkWorkInput) {
  const trimmed = String(carrier ?? '').trim()
  if (!trimmed) return { written: false, errors: [{ code: 'carrier-required' }] }
  return workPoint('work.park', {
    work_id,
    actor,
    substrate,
    session_id,
    payload: { carrier: trimmed, ...(note ? { note } : {}) },
    cwd,
  })
}

/** Every work id the spine has ever seen. `flow done` on an unknown id would file a phantom. */
export function knownWorkIds(cwd = process.cwd()): Set<string> {
  return new Set(readEvents(cwd).map((e) => String(e.work_id)))
}
