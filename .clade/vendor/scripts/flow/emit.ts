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

import { isRecord, parseJson } from '../lib/json-unknown.ts'
import type { FlowEvent } from './spine.ts'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { redactPayload, validateFlowEvent, workReopenCauses } from '../../signals/redact.ts'
import { appendRaw } from '../../signals/ledger-writer.ts'
import { detectConsumer } from '../../signals/shim-core.ts'
import { normalizeArtifacts } from './nodes/lib/artifacts.ts'
import { repositorySpineRoot } from './spine-context.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLADE_ROOT = resolve(__dirname, '..', '..', '..')

export const SCHEMA_VERSION = '1'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function flowDisabled() {
  return process.env.CLADE_FLOW_OFF === '1'
}

function gitTopLevel(cwd: string): string {
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
  const scopedRoot = repositorySpineRoot()
  if (scopedRoot) return spinePathIn(scopedRoot)
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
export function mintWorkId(slug: string, now = new Date()): string {
  const normalized = String(slug)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!SLUG_OK.test(normalized)) throw new Error(`unusable work slug: ${slug}`)
  return `W-${utcDate(now)}-${normalized}`
}

/**
 * Ambient work id first, a caller-supplied stable identity second, orphan last (TD-684).
 *
 * The order is the same one `herdr-session-handoff.ts` and `pi-dispatch.ts` each carry a copy of,
 * and it MUST stay that way: `resolveWorkId(hint)` is `hint ?? env ?? orphan`, so handing the
 * identity in as a hint would SHADOW an ambient CLADE_WORK_ID and split one named piece of work
 * into unrelated per-item traces.
 *
 * `identity` is free text (a `source_id`, a dispatch label). `mintWorkId` throws on a slug its
 * envelope pattern rejects and a fully CJK string normalises to empty, so an unusable identity
 * degrades to an orphan id rather than taking its caller down: emit's contract is fail-open
 * everywhere, and a telemetry mint MUST NEVER outrank the thing being instrumented.
 *
 * The two dispatch adapters predate this and still hold their own copies — see [[TD-684]].
 */
export function workIdFromIdentity(sourceIdentity: string | null | undefined): string {
  const ambient = process.env.CLADE_WORK_ID?.trim()
  if (ambient) return ambient
  const slug = String(sourceIdentity ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  if (slug) {
    try {
      return mintWorkId(slug)
    } catch {
      // Unusable slug — fall through to the orphan mint below.
    }
  }
  return resolveWorkId(null)
}

/**
 * The work id this process belongs to. With no ambient CLADE_WORK_ID an orphan id is minted
 * rather than dropping the event: an unattributed span still belongs on the spine, and the
 * `orphan-` prefix makes the attribution gap countable instead of invisible.
 */
function mintOrphanWorkId() {
  return mintWorkId(`orphan-${randomBytes(3).toString('hex')}`)
}

export function resolveWorkId(hint: string | null | undefined = null): string {
  const explicit = hint ?? process.env.CLADE_WORK_ID ?? null
  if (explicit) return explicit
  return mintOrphanWorkId()
}

function identity(cwd: string): { consumer_id: string; repo_id: string } {
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
  /**
   * Null only for `kind: 'session_summary'`, and `validateFlowEvent` holds the biconditional in
   * both directions. Everything else mints an `orphan-` id rather than going without one — see
   * `resolveWorkId`.
   */
  work_id: string | null
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
  /**
   * Slug half of the name. May be the empty string ONLY together with an explicit `work_id`:
   * a label that normalises to nothing (a fully CJK one does) still deserves a `title`, and an
   * empty slug is omitted from the payload rather than written through. Writing `slug: ''` would
   * be worse than omitting it — `isNamed` reads `slug ?? origin_ref ?? title` and `''` short-
   * circuits the `??` chain, so an empty slug would HIDE a title that is right there.
   */
  slug: string
  /**
   * Name an id that already exists instead of minting one from `slug`.
   *
   * For callers that must decide the id first and can only name it afterwards — the dispatch
   * adapters mint before they know whether the label survives slug normalisation. Without this
   * they can only call `mintWorkId`, and an id whose characters spell the label is NOT a name:
   * `buildWorkItems` reads slug/title/origin from the `work.open` payload and nothing else.
   */
  work_id?: string | null
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
  /** Where the work was born, for readers that group by it. Defaults to `manual` (a person ran `flow open`). */
  substrate?: string
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
interface PayloadRule {
  field: string
  code: string
  why: string
  nullable?: boolean
  /**
   * This field carries a POSITIVE INTEGER rather than prose.
   *
   * Needed because the presence test below is `a non-empty string`, which every rule until
   * `work.rebound` satisfied — its two fields are revision numbers, and stringifying them to fit
   * the check would put a type on the stream that no reader of a revision expects. Zero and
   * negatives are refused with the same message as absence: a revision counts from 1, so neither
   * is a value a binding can hold.
   */
  numeric?: boolean
  /** The values this field may take. Checked only when the field is present and non-empty. */
  oneOf?: readonly string[]
}

/*
 * A LIST per kind, not one rule, because `work.eta` is the first kind whose claim needs two fields
 * to mean anything: a date with no basis is the template number the estimate discipline forbids,
 * and a basis naming no date states nothing. Widening the shape rather than picking one field to
 * enforce keeps the gate honest about what it is actually checking.
 */
const REQUIRED_PAYLOAD: Record<string, PayloadRule[]> = {
  'work.done': [
    {
      field: 'verification',
      code: 'verification-required',
      why: "work.done needs payload.verification — how it was verified, in one line. A done nobody can check is what makes 'accepted' meaningless",
    },
  ],
  'work.accept': [
    {
      field: 'reason',
      code: 'reason-required',
      why: 'work.accept needs payload.reason — an acceptance with no stated basis is a silent close',
    },
  ],
  'work.drop': [
    {
      field: 'reason',
      code: 'reason-required',
      why: 'work.drop needs payload.reason — a drop with no stated basis is a silent delete',
    },
  ],
  // A reopen UNDOES a `work.done` on this stream, so it owes at least as much as the claim it
  // withdraws: `cause` says which of the two admissible reasons it is, `reason` says it in prose.
  // A reopen nobody can check turns `work.done` back into a claim that can be silently retracted.
  'work.reopened': [
    {
      field: 'cause',
      code: 'cause-required',
      why: "work.reopened needs payload.cause (revision | evidence_insufficient) — the two are not interchangeable, and a reopen that cannot say which it is cannot be audited against the requirement's history",
      // Read off `$defs.work_reopen_cause`, the same list `validateFlowEvent` checks. Presence
      // alone was never the claim: a `cause: 'whatever'` says as little as no cause at all while
      // passing every gate, and the description this rule prints already names the two values.
      oneOf: workReopenCauses(),
    },
    {
      field: 'reason',
      code: 'reason-required',
      why: 'work.reopened needs payload.reason — withdrawing a done with no stated basis is a silent retraction',
    },
  ],
  // A rebind states what the binding MOVED FROM and MOVED TO, and both halves are load-bearing:
  // `requirement_revision` alone would be indistinguishable from a re-materialization that changed
  // nothing, which is the overwhelmingly common case and the one this event must not record.
  'work.rebound': [
    {
      field: 'requirement_revision',
      code: 'requirement-revision-required',
      why: 'work.rebound needs payload.requirement_revision — the revision the materialization is bound to now. A rebind naming no revision records that somebody re-read the plan, not what the binding became',
      numeric: true,
    },
    {
      field: 'from_revision',
      code: 'from-revision-required',
      why: 'work.rebound needs payload.from_revision — the revision work.open froze, or null when that materialization recorded none. Without it a rebind cannot be told from a re-materialization that changed nothing',
      numeric: true,
      // Null is the real answer for a `work.open` written before the payload carried a revision at
      // all, and it is the KEY being present that this rule is about — same argument as
      // `work.link`'s detach.
      nullable: true,
    },
  ],
  'work.eta': [
    {
      field: 'target_ts',
      code: 'target-required',
      why: 'work.eta needs payload.target_ts — the estimated delivery date. An estimate naming no date records no estimate',
    },
    {
      field: 'basis',
      code: 'basis-required',
      why: 'work.eta needs payload.basis (human | agent-estimate) — a date that cannot say where it came from is exactly the template number the estimate discipline forbids',
    },
  ],
  // `nullable` is the whole reason this rule shape has a fourth field, and it is not a loophole:
  // the requirement is on the KEY being present, and `null` is a MEANINGFUL value — it is detach.
  //
  // Without a legal null, "no parent" would be reachable only at birth: a work item mis-linked to
  // a parent that turns out not to exist could be re-parented forever but never returned to having
  // none. That is not the same shape as `work.park` or `work.accept` having no inverse event —
  // those reach every state they have by last-write-wins overwrite. Detach is not an inverse
  // event; it is the value that completes the range.
  //
  // The alternative considered was a `{ detached: true }` flag with `parent_work_id` exempted from
  // the requirement. That buys a second code path through the one gate on this stream that is
  // allowed to refuse a write, for a state a legal `null` already expresses.
  // `dispatch.verdict` is written by a THIRD PARTY (herdr-patrol) about a dispatch whose pane is
  // already gone, so it carries the whole burden of saying which dispatch and on what basis —
  // nothing else on the stream can supply either after the fact.
  'dispatch.verdict': [
    {
      field: 'verdict',
      code: 'verdict-required',
      why: 'dispatch.verdict needs payload.verdict — abandoned | adjudicated | reported. A verdict event naming no verdict records that somebody looked, not what they concluded',
    },
    {
      field: 'dispatch_id',
      code: 'dispatch-id-required',
      why: 'dispatch.verdict needs payload.dispatch_id — the dispatch it judges. The pane is gone by definition, so pane_id cannot identify it, and a verdict that names no dispatch is unattachable forever',
    },
    {
      field: 'reason',
      code: 'reason-required',
      why: 'dispatch.verdict needs payload.reason on the same basis work.accept and work.drop do — a closure with no stated basis is a silent delete, and this one closes something its own author never ran',
    },
  ],
  // A scenario verdict is the one fact on this stream whose whole purpose is to be un-fakeable:
  // section 7.5 exists because an implementing agent's account of its own red test is exactly the
  // evidence that cannot be trusted. So the three fields that make a verdict a verdict are refused
  // when absent rather than defaulted — a record that says an evaluator ran, without saying what it
  // judged or how it ruled, is the shape this event was added to replace.
  'scenario.verdict.recorded': [
    {
      field: 'scenario_id',
      code: 'scenario-id-required',
      why: 'scenario.verdict.recorded needs payload.scenario_id — plan section 4.5 carries it in the envelope stream_id, which this envelope has no column for, so a verdict without it attaches to nothing',
    },
    {
      field: 'phase',
      code: 'phase-required',
      why: 'scenario.verdict.recorded needs payload.phase (RED_VALIDITY | GREEN | REFACTOR) — the same scenario has a different verdict in each, and one that names no phase silently overwrites the reader of both',
    },
    {
      field: 'gate_verdict',
      code: 'gate-verdict-required',
      why: 'scenario.verdict.recorded needs payload.gate_verdict (PASS | FAIL) — a verdict event that states no verdict records that somebody looked, not what they concluded',
    },
  ],
  'work.link': [
    {
      field: 'parent_work_id',
      code: 'parent-required',
      why: 'work.link needs payload.parent_work_id — the parent work id, or null to detach. An event naming no parent records no fact and folds to a silent no-op',
      nullable: true,
    },
  ],
}

function requiredPayloadError(kind: string, payload: Record<string, unknown>) {
  const rules = REQUIRED_PAYLOAD[kind]
  if (!rules) return null
  // First failure wins. Reporting every missing field at once would read as a form to fill in, and
  // these are not form fields — each one is a claim the event cannot be written without.
  for (const rule of rules) {
    const value = payload?.[rule.field]
    if (typeof value === 'string' && value.trim().length > 0) continue
    if (rule.numeric && Number.isInteger(value) && (value as number) >= 1) continue
    // Presence, not truthiness, and ONLY for a rule that opted in. The rules that did not are
    // unchanged: `work.done` with `verification: null` is still refused, which is the assertion
    // that keeps this widening from silently becoming a hole in the one fail-closed gate.
    if (rule.nullable && value === null && Object.hasOwn(payload ?? {}, rule.field)) continue
    return { code: rule.code, message: rule.why }
  }
  // A second pass, so that a MISSING field is always reported before a wrong one: "you left cause
  // out" and "cause says something the vocabulary does not know" are different mistakes, and the
  // first is the one to say when both are true of the same payload.
  for (const rule of rules) {
    const value = payload?.[rule.field]
    if (!rule.oneOf || typeof value !== 'string') continue
    if (rule.oneOf.includes(value)) continue
    return {
      code: `${rule.code.replace(/-required$/, '')}-unknown`,
      message: `${kind} payload.${rule.field} must be one of ${rule.oneOf.join(' | ')}, got ${JSON.stringify(value)}`,
    }
  }
  return null
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
  } catch (e: unknown) {
    const message = errorMessage(e)
    process.stderr.write(`[clade flow] emit failed (fail-open): ${message}\n`)
    return { written: false, errors: [{ code: 'emit-failed', message }] }
  }
}

/** Open a work item: one point event that names the work id for everything downstream. */
export function openWork({
  slug,
  work_id: existingId = null,
  actor = 'unknown',
  session_id = null,
  origin = null,
  title = null,
  substrate = 'manual',
  payload = {},
  cwd,
}: OpenWorkInput) {
  const work_id = existingId ?? mintWorkId(slug)
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
    substrate,
    session_id,
    payload: {
      ...(slug ? { slug } : {}),
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
function isReadableFlowEvent(value: unknown): value is FlowEvent & Record<string, unknown> {
  return (
    isRecord(value) &&
    (value.work_id === null || typeof value.work_id === 'string') &&
    ['span_id', 'kind', 'actor', 'substrate', 'ts_utc'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    ['start', 'end', 'point'].includes(String(value.phase)) &&
    (value.payload === undefined || isRecord(value.payload)) &&
    (value.outcome === undefined || value.outcome === null || typeof value.outcome === 'string') &&
    (value.parent_span === undefined ||
      value.parent_span === null ||
      typeof value.parent_span === 'string') &&
    (value.session_id === undefined || typeof value.session_id === 'string')
  )
}

export function readEventsFile(path: string) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return parseJson(line)
      } catch {
        return null
      }
    })
    .filter(isReadableFlowEvent)
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
  /**
   * `\my` bucket. `ruling` and `review` are the answerable pair; the rest are doings and states.
   *
   * `'human-action'` replaced `'irreversible'` on 2026-08-28. The old token is not accepted for
   * NEW spans — but spans already on the append-only spine carry it, and both render surfaces
   * group those into the same 要我動手 bucket rather than rewriting history.
   */
  category?: 'ruling' | 'review' | 'other-repo' | 'human-action' | 'loop-structural'
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
  return (
    text
      // `A. ` / `B、` / `C）`，以及 `A（推薦）…` —— 後者是 [[decision-authoring]] 正向契約裡
      // 逐字示範的寫法，而字母後面接的是**開**括號，2026-08-28 之前的字元類收不到它，於是
      // 卡片上會疊成 `A. A（推薦）留 X`。
      .replace(/^\s*[A-Za-z](?:\s*[.、)）:：]|(?=\s*[（(]))\s*/u, '')
      // 推薦與否是 `recommended` 欄的事。文字裡再留一個前綴標記，剝完字母就會變成
      // `A. （推薦）留 X`，而卡片右邊已經有一個「推薦」了。
      .replace(/^[（(]\s*推薦\s*[)）]\s*/u, '')
      .trim()
  )
}

/**
 * 整組剝字母，而不是逐條剝。
 *
 * 契約寫法是 `A（推薦）第一案` / `B 第二案`——第二種的字母後面只有一個空白，逐條看時
 * 與正常英文句子（`A better approach …`）無法區分。整組看就可以：**每一條**都以字母開頭、
 * 且字母**從 A 起連續**時，那是編號不是內容。任一條不符就退回逐條的保守剝法。
 */
function stripGroupLetters(options: string[]): string[] {
  const prefixed = options.map((o) =>
    /^\s*([A-Za-z])(?:[\s.、)）:：]|[（(])/u.exec(o)?.[1]?.toUpperCase(),
  )
  const numbered =
    options.length >= 2 &&
    prefixed.every((letter, index) => letter === String.fromCodePoint(65 + index))
  if (!numbered) return options.map(stripOptionLetter)
  return options.map((o) => stripOptionLetter(o.replace(/^\s*[A-Za-z]\s+/u, '')))
}

/**
 * 問這一題的人是誰，用得上的那種——`workIdFromIdentity` 的穩定身分欄位（TD-710）。
 *
 * `actor` 預設是 `'unknown'`（`flow ask` 沒帶 `--actor` 就是它），而把全 fleet 的無名提問
 * 折進同一個 `W-<date>-unknown` 比 orphan 更糟：orphan 至少一題一列、數得出歸因缺口，
 * `unknown` 會把互不相干的問題黏成一件看起來有名字的 work。所以它退回 pane id，再退回 null
 * （＝讓 `workIdFromIdentity` 鑄 orphan）。
 *
 * NEVER 改用 `question`：那是自由文字，且一題一 work 會讓 /flow 的清單被決策淹掉（[[TD-710]]）。
 */
function askerIdentity(actor: string | null | undefined): string | null {
  const named = String(actor ?? '').trim()
  if (named && named !== 'unknown') return named
  return process.env.HERDR_PANE_ID?.trim() || null
}

const CLOSED_WORK_KINDS = new Set(['work.done', 'work.accept', 'work.drop'])

/**
 * Raw closed-claim scan, not the fold's `state`.
 *
 * Fold treats `work.done` as standing only when no later real start outlived it (`claimStands`).
 * Relay after a done work writes a new `session_transport` onto the same id (TD-791 實測
 * `W-2026-08-29-board-pm-…`：04:05 `work.done`，04:06 下一棒 TD-787 transport)，於是 fold
 * 讀成 settled／in-flight，問句照樣掛回已結束的卡。問句這條路要的是「有沒有人宣告過結束」，
 * 不是「後來有沒有人又在這張卡上寫了 span」。
 *
 * Fail-open：spine 讀不到時當沒結束，沿用今日行為。
 */
function workHasClosedClaim(workId: string, cwd?: string): boolean {
  try {
    // The LAST of the two, not "is there one anywhere": `work.reopened` withdraws the claim
    // `work.done` filed (TD-884 ruling (m)), and a reopened work is open again by definition —
    // scanning for any closed kind ever would mint an orphan for a question asked about work that
    // is, right now, running. Order in the file, not `ts_utc`: a reopen and the done it withdraws
    // legitimately land in the same millisecond, and `readEvents` preserves append order.
    const claims = readEvents(cwd).filter(
      (e) =>
        e.work_id === workId &&
        (CLOSED_WORK_KINDS.has(String(e.kind)) || String(e.kind) === 'work.reopened'),
    )
    return CLOSED_WORK_KINDS.has(String(claims.at(-1)?.kind))
  } catch {
    return false
  }
}

/**
 * `flow ask` 的 work id：明確參數 → 未結束的 ambient → 提問者身分 → orphan。
 *
 * 過期的 ambient（已有 `work.done` / accept / drop）NEVER 沿用，也 NEVER 退回 pane
 * 身分——relay 之後 pane id 不變，那正是過期身分本身（[[TD-791]]）。此時鑄 orphan
 * （未歸屬），且 MUST 走 `mintOrphanWorkId` 而不是 `resolveWorkId(null)`：後者的順序
 * 是 `hint ?? env`，hint 為 null 時會把過期 ambient 再讀回來。
 *
 * 真正沒有 ambient 時維持 [[TD-710]]：用提問者身分鑄具名 id，NEVER 一上來就 orphan。
 */
function decisionWorkId(
  explicit: string | null | undefined,
  actor: string | null | undefined,
  cwd?: string,
): string {
  const named = String(explicit ?? '').trim()
  if (named) return named
  const ambient = process.env.CLADE_WORK_ID?.trim()
  if (ambient && !workHasClosedClaim(ambient, cwd)) return ambient
  if (ambient) return mintOrphanWorkId()
  return workIdFromIdentity(askerIdentity(actor))
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
  const cleanOptions = stripGroupLetters(options)
  // `recommended` 要跟著剝，否則正規化後的選項比對不回它，推薦標記會整個消失。整組同進退：
  // 呼叫端幾乎都把推薦項的**同一串文字**同時給 options 與 recommended，各剝各的會在整組
  // 剝法命中時分岔。
  const recommendedIndex = recommended === null ? -1 : options.indexOf(recommended)
  const cleanRecommended =
    recommended === null
      ? null
      : recommendedIndex >= 0
        ? cleanOptions[recommendedIndex]
        : stripGroupLetters([recommended, ...options])[0]

  return startSpan({
    /*
     * 沒帶 `work_id` 也沒有（未結束的）ambient 時，用**提問者身分**鑄具名 id，
     * NEVER 落 `resolveWorkId(null)` 的 orphan（[[TD-710]]，Charles 2026-08-28 拍板 A．自成一件 work）。
     *
     * 過期 ambient（已 work.done）另案：鑄 orphan 未歸屬，見 `decisionWorkId`（[[TD-791]]）。
     *
     * 順序仍是 明確參數 → 未結束 ambient → 提問者身分 → orphan。NEVER 把身分餵給
     * `resolveWorkId(hint)`，那個順序是 `hint ?? env`，會把一件具名工作的多題拆成
     * 互不相干的 per-question trace。
     *
     * 同一個 pane 的多題折進同一件（身分逐日鑄名），代價是 `/flow` 上多出以 pane 命名的
     * work item——那正是拍板時接受的那一項。
     */
    work_id: decisionWorkId(work_id, actor, cwd),
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
 * Has a decision carrying this dedupe key ever been asked?
 *
 * Asks the spine rather than keeping local bookkeeping, for the same reason `spanIsClosed` does:
 * the asker is a fresh process on every run (`audit-tech-debt-hygiene` runs per propagate), so
 * anything it remembers locally is gone by the next run.
 *
 * **Deliberately counts closed decisions too.** A recurring probe that fires, gets answered, and
 * then fires again on the next run is exactly the warning fatigue a fire-once queue exists to
 * prevent — an answered question is *more* reason not to re-ask it, not less. When the underlying
 * criterion genuinely changes, the key changes with it (callers derive it from the probe body),
 * and that is the only intended path back onto the queue.
 *
 * Fail-open answers `null` — "cannot prove it was asked". A duplicate question is visible and
 * dismissable; a swallowed one is invisible, which is the worse of the two.
 */
export function findDecisionByDedupeKey(key: string, cwd = process.cwd()): string | null {
  try {
    const hit = readEvents(cwd).find(
      (e) =>
        e.phase === 'start' &&
        e.kind === 'decision.request' &&
        (e.payload as Record<string, unknown> | undefined)?.dedupe_key === key,
    )
    return hit ? String(hit.span_id) : null
  } catch {
    return null
  }
}

/**
 * `requestDecision`, but at most once per `dedupe_key` for the life of the spine.
 *
 * For callers that re-evaluate the same condition on a schedule and must not re-ask on every
 * pass. Returns the pre-existing span id with `asked: false` when the key has been seen before,
 * so the caller can report "already queued" instead of silently doing nothing.
 *
 * Separate from `requestDecision` rather than an extra parameter on it: every existing caller
 * asks a question that is genuinely new each time, and giving them a dedupe path they do not
 * want is how a one-off question gets silently swallowed.
 */
export function requestDecisionOnce(input: RequestDecisionInput & { dedupe_key: string }): {
  span_id: string
  asked: boolean
} {
  const { dedupe_key, ...rest } = input
  const existing = findDecisionByDedupeKey(dedupe_key, input.cwd)
  if (existing) return { span_id: existing, asked: false }
  const handle = requestDecision({
    ...rest,
    payload: { ...rest.payload, dedupe_key },
  })
  return { span_id: handle.span_id, asked: true }
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
  const amendments = latestAmendments(events)
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
 * keeps the payload the broken parser wrote, forever. Measured 2026-08-27: <consumer-h>'s `TD-585` shows
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
  // 同 `requestDecision`：字母是渲染層的東西。amend 走的是另一條寫入路徑，各剝各的就會讓
  // 同一組選項在「原本就帶」與「事後補上」兩種來源長得不一樣。
  const cleanOptions = stripGroupLetters(options)
  const recommendedIndex = recommended === null ? -1 : options.indexOf(recommended)
  const cleanRecommended =
    recommended === null
      ? null
      : recommendedIndex >= 0
        ? cleanOptions[recommendedIndex]
        : stripGroupLetters([recommended, ...options])[0]
  return emitEvent({
    work_id: handle.work_id,
    span_id: newSpanId(),
    parent_span: spanId,
    phase: 'point',
    kind: 'decision.amend',
    actor,
    substrate: handle.substrate,
    payload: {
      options: cleanOptions,
      recommended: cleanRecommended,
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
  const events = readEvents(cwd)
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
  /**
   * Output this claim registers BY HAND, for the part that no span produced: a PR opened from
   * another machine, a landing in a repo whose spine is elsewhere. Everything a span already
   * recorded is aggregated by the fold and MUST NOT be retyped here.
   *
   * Normalised through `normalizeArtifacts`, the same function the read side uses, so a
   * hand-registered coordinate and a node-produced one are the same shape on the stream.
   */
  artifacts?: unknown
  /**
   * Why this claim stands with nothing to show. The escape hatch is deliberately a STATED reason
   * rather than a flag: work with no output is a real and legitimate outcome (a question answered,
   * an investigation that concluded nothing needed changing), and the thing a reader needs is which
   * one of those it was.
   */
  artifactWaiver?: string | null
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
  artifacts,
  artifactWaiver = null,
  verifiedBy = 'unknown',
  actor = 'unknown',
  substrate = 'manual',
  session_id = null,
  payload = {},
  cwd,
}: MarkWorkDoneInput) {
  const registered = normalizeArtifacts(artifacts)
  const waiver = String(artifactWaiver ?? '').trim()
  return workPoint('work.done', {
    work_id,
    actor,
    substrate,
    session_id,
    payload: {
      verification: String(verification ?? '').trim(),
      verified_by: verifiedBy,
      // Absent rather than empty when there is nothing to say: an `artifacts: []` on the stream
      // asserts "this claim registered no output", which is a different fact from a claim written
      // before anybody thought about output at all.
      ...(registered.length > 0 ? { artifacts: registered } : {}),
      ...(waiver ? { artifact_waiver: waiver } : {}),
      ...payload,
    },
    cwd,
  })
}

export interface WorkEtaInput {
  work_id: string
  /** The estimated delivery date, ISO. Required — see REQUIRED_PAYLOAD. */
  target_ts: string
  /** Where the number came from. Required for the same reason: a bare date is a template number. */
  basis: 'human' | 'agent-estimate'
  note?: string | null
  actor?: string
  substrate?: string
  session_id?: string | null
  cwd?: string
}

/**
 * Declare when this work item is expected to land.
 *
 * LAST-WRITE-WINS like `work.link`, and for the same reason: an estimate is a judgement, and a
 * judgement that cannot be revised is one people stop making. The fold reads only the newest.
 *
 * There is deliberately NO event for the derived estimate. The fallback — a percentile over
 * comparable finished work — is computed at read time and never written: written down, it would be
 * stale the moment the next comparable work item finishes, and a stale derived date is
 * indistinguishable on the page from a promise somebody made.
 *
 * NEVER emit this from a periodic sweep that chases people for estimates. Overdue is something the
 * fold RENDERS; a job that pushes about it is a second, nagging surface for a fact the board
 * already shows.
 */
export function emitWorkEta({
  work_id,
  target_ts,
  basis,
  note = null,
  actor = 'unknown',
  substrate = 'manual',
  session_id = null,
  cwd,
}: WorkEtaInput) {
  const target = String(target_ts ?? '').trim()
  return workPoint('work.eta', {
    work_id,
    actor,
    substrate,
    session_id,
    payload: {
      target_ts: target,
      basis,
      ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}),
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

export interface ReopenWorkInput {
  work_id: string
  /** `revision` (the requirement moved) or `evidence_insufficient` (the receipts are not enough). */
  cause: string
  /** Why, in one line. Required — see REQUIRED_PAYLOAD. */
  reason: string
  actor?: string
  substrate?: string
  session_id?: string | null
  payload?: Record<string, unknown>
  cwd?: string
}

/**
 * A delivered work item is running again — the counterpart of `markWorkDone` on this stream.
 *
 * The control plane's runtime journal already records the reopen in full (`work.reopened` plus the
 * `done -> queued` transition, ai-control-plane-runtime.ts). This event exists because the SPINE is
 * where every read side asks whether a work item is finished, and there a lone `work.done` reads as
 * finished forever: a reopened work would be drawn `done` on the board while its runtime state is
 * `queued`. A point event rather than a state edge, for the same reason `work.done` is one — it is
 * a fact about the work, not about whichever pane noticed.
 */
export function reopenWork({
  work_id,
  cause,
  reason,
  actor = 'unknown',
  substrate = 'manual',
  session_id = null,
  payload = {},
  cwd,
}: ReopenWorkInput) {
  return workPoint('work.reopened', {
    work_id,
    actor,
    substrate,
    session_id,
    payload: {
      cause: String(cause ?? '').trim(),
      reason: String(reason ?? '').trim(),
      ...payload,
    },
    cwd,
  })
}

export interface ReboundWorkInput {
  work_id: string
  /** The requirement revision this materialization answers from now on. */
  requirement_revision: number
  /** What `work.open` froze, or null when that materialization recorded no revision. */
  from_revision: number | null
  actor?: string
  substrate?: string
  session_id?: string | null
  payload?: Record<string, unknown>
  cwd?: string
}

/**
 * A materialization now answers a different requirement revision than the one it was opened with.
 *
 * A FACT, not a state change (plan section 10.6 ruling (n)). The control plane rebinds a work item
 * that is not terminal when the plan's revision runs ahead of the one frozen into `work.open`: a
 * work item with no accepted evidence has nothing to protect, so the advance is not staleness and
 * refusing it left <consumer-c>'s gate 5 with a work spec reachable by nothing. Nothing about the work
 * moves, which is why this is a point event that no fold reads as a lifecycle edge — the reason it
 * exists at all is that before it, the rebind happened with no trace in either ledger.
 *
 * NEVER confuse it with `work.reopened`: a reopen withdraws a claim of completion and leaves
 * `done`, and a rebind never touches a `done` work item.
 */
export function reboundWork({
  work_id,
  requirement_revision,
  from_revision,
  actor = 'unknown',
  substrate = 'manual',
  session_id = null,
  payload = {},
  cwd,
}: ReboundWorkInput) {
  return workPoint('work.rebound', {
    work_id,
    actor,
    substrate,
    session_id,
    payload: {
      requirement_revision,
      from_revision,
      ...payload,
    },
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

export interface LinkWorkInput {
  /** The CHILD. The link is carried on it, because that is the id whose belonging changed. */
  work_id: string
  /** The parent work id, or null to detach. Empty string is normalised to null — see below. */
  parent_work_id: string | null
  /** Why it belongs there. Optional: unlike a verdict, a link states a fact rather than closes one. */
  reason?: string | null
  actor?: string
  substrate?: string
  session_id?: string | null
  payload?: Record<string, unknown>
  cwd?: string
}

/**
 * Give a work item a parent — the hierarchy an initiative needs, with no new entity to hold it.
 *
 * An initiative or epic IS a work item: one that other work items point at. That is the whole
 * design. A separate epic type would be a second data model with its own lifecycle, its own
 * states, and its own way of disagreeing with the spine about whether something is finished.
 *
 * A POINT event on the child, with no `parent_span`, for the same reason `work.done` is one: this
 * is a fact about the WORK, not about whichever pane happened to notice. Hanging it off a span
 * would make a work item's parentage depend on which dispatch was last, which is precisely the
 * confusion the work layer exists to remove.
 *
 * LAST-WRITE-WINS, deliberately unlike `work.open`'s first-origin-wins. A work item is born once,
 * so rewriting its origin would re-parent history that is already folded under it; but WHERE it
 * belongs is a judgement, and judgements get revised. The cost is that two links can form a cycle
 * (A→B then B→A), which is why `workDepth` in the spine is cycle-guarded and the PM view marks
 * the members rather than silently picking one to be the root.
 *
 * NEVER emit this from a hook or any automatic path. It is in `REQUIRED_PAYLOAD`, so it is checked
 * before the `CLADE_FLOW_OFF` gate and can refuse a write — an exception to this library's
 * fail-open contract that only holds while the writer is a person, or an orchestration a person
 * asked for, ASSERTING something. Telemetry that observes work NEVER changes that work's outcome.
 */
export function linkWork({
  work_id,
  parent_work_id,
  reason = null,
  actor = 'unknown',
  substrate = 'manual',
  session_id = null,
  payload = {},
  cwd,
}: LinkWorkInput) {
  // '' and null mean the same thing here (no parent), and keeping both spellings would leave a
  // value that a later reader eventually treats as a third state. Normalise at the door.
  const parent =
    typeof parent_work_id === 'string' && parent_work_id.trim() ? parent_work_id.trim() : null
  // A cycle of length one. Nothing but a typo produces it, and the fold would have to carry it.
  if (parent !== null && parent === work_id) {
    return {
      written: false,
      errors: [{ code: 'self-parent', message: 'a work item cannot be its own parent' }],
    }
  }
  return workPoint('work.link', {
    work_id,
    actor,
    substrate,
    session_id,
    payload: {
      parent_work_id: parent,
      ...(typeof reason === 'string' && reason.trim() ? { reason: reason.trim() } : {}),
      ...payload,
    },
    cwd,
  })
}

/** Every work id the spine has ever seen. `flow done` on an unknown id would file a phantom. */
export function knownWorkIds(cwd = process.cwd()): Set<string> {
  return new Set(readEvents(cwd).map((e) => String(e.work_id)))
}
