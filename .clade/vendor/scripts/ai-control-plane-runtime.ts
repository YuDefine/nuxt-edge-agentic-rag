// 🔒 LOCKED — managed by clade · Source: vendor/scripts/ai-control-plane-runtime.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/ai-control-plane-runtime.ts
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { assertBindingCommittedIfGoverned } from './ai-control-plane-profile.ts'
import { redactPayload } from '../signals/redact.ts'

export type RuntimeDigest = `sha256:${string}`
export type CanonicalMachineWorkState =
  | 'created'
  | 'queued'
  | 'leased'
  | 'running'
  | 'retry_wait'
  | 'done'
  | 'exhausted'
  | 'cancelled'
  | 'superseded'
export type MachineWorkState = CanonicalMachineWorkState | 'legacy_unverified' | 'quarantined'

export type AttemptState =
  | 'leased'
  | 'running'
  | 'paused'
  | 'abandoned'
  | 'succeeded'
  | 'failed'
  | 'exhausted'
  | 'cancelled'
  | 'superseded'

export type RuntimeMessageType =
  | 'question'
  | 'answer'
  | 'delegation_request'
  | 'delegation_result'
  | 'evidence_notice'

export type RuntimeSpanName =
  | 'agent.turn'
  | 'tool.call'
  | 'test.run'
  | 'evidence.capture'
  | 'work.delegate'
  | 'gate.wait'
  | 'runtime.resume'

export interface WorkerProfile {
  artifact_type: 'worker.profile'
  schema_version: 1
  worker_id: string
  name: string
  role: string
  capabilities: string[]
  allowed_repositories: string[]
  allowed_folders: string[]
  delegation_grants: string[]
  messaging_grants: string[]
  routine_triggers: string[]
  default_engines: Array<{ engine: string; version: string }>
  evidence_policy: string
  verification_policy: string
  registered_at: string
}

export interface CapabilityGrant {
  grant_id: string
  worker_id: string
  repositories: string[]
  folders: string[]
  tools: string[]
  network: string[]
  credentials: string[]
  child_work_creation: boolean
  messaging: boolean
  pause_resume: boolean
  global_control: boolean
  initiative_ids: string[]
  issued_at: string
  expires_at: string | null
  digest: RuntimeDigest
}

export interface RuntimeEngine {
  artifact_type: 'runtime.engine'
  schema_version: 1
  engine: string
  path: string
  version: string
  health: 'healthy' | 'degraded' | 'unavailable'
  ownership: 'clade-managed' | 'user-managed'
  structured_output: boolean
  resume_capability: boolean
  incompatibilities: string[]
  validated_at: string
}

export interface RuntimeWork {
  work_id: string
  repo_id: string
  change_id: string
  initiative_id: string | null
  parent_work_id: string | null
  created_by_grant_digest: RuntimeDigest | null
  causation_id: string | null
  state: MachineWorkState
  retry_limit: number
  /**
   * How many times this work has been HANDED OVER (plan section 9.8 rule 8), counted apart from
   * retries because the two answer different questions: `retry_limit` governs what happens after an
   * attempt FAILED, and a handover is not a failure. Bounded by `CONTINUATION_HANDOVER_BUDGET`.
   */
  handover_count: number
  /**
   * How many times this work has been REOPENED out of `done` (plan section 10.6 ruling (m)).
   *
   * A third counter beside `retry_limit` and `handover_count` because it answers a third question:
   * a reopen is neither a failed attempt nor a live handover, it is a delivery that was accepted
   * and then stopped being enough — because the requirement moved, or because readiness judged its
   * evidence insufficient. Counted rather than flagged so `/board` can tell a change that was
   * reopened once from one that has been reopened five times; nothing budgets on it, and
   * `retry_limit` is deliberately NOT reset when it increments.
   */
  reopen_count: number
  created_at: string
  updated_at: string
}

export interface RuntimeAttempt {
  attempt_id: string
  work_id: string
  worker_id: string
  repo_id: string
  change_id: string
  engine: string
  engine_version: string
  scope_folder: string
  worktree_id: string | null
  worktree_head: string | null
  workspace_id: string | null
  pane_id: string | null
  lease_id: string
  root_trace_id: string
  root_span_id: string
  capability_grant_digest: RuntimeDigest
  initiative_id: string | null
  requirement_id: string | null
  requirement_revision: number | null
  scenario_id: string | null
  code_revision: string | null
  /**
   * The code revision each verification phase actually ran against (TD-885).
   *
   * One attempt spans RED_VALIDITY, GREEN and mutation (ruling 5b), and those genuinely run on
   * different trees: RED runs against the baseline in a `--code-worktree`, GREEN after the
   * implementation lands. A single `code_revision` therefore answered a question nobody asked —
   * it could describe at most one of them. `code_revision` is kept and now means the LAST revision
   * a phase was recorded against, which at finish is the one the delivery stands on.
   *
   * Keyed by `VerificationPhase`, `{}` on an attempt that never recorded one (and on every attempt
   * written before this field existed).
   */
  phase_revisions: Record<string, string>
  intent_revision: number | null
  resumes_attempt_id: string | null
  supersedes_attempt_id: string | null
  flow_state: 'pending_start' | 'started' | 'pending_end' | 'ended'
  pending_outcome: 'ok' | 'fail' | 'blocked' | 'cancelled' | 'superseded' | null
  state: AttemptState
  started_at: string
  updated_at: string
}

export interface RuntimeLease {
  lease_id: string
  work_id: string
  attempt_id: string
  worker_id: string
  acquired_at: string
  heartbeat_at: string
  expires_at: string
  released_at: string | null
  release_reason: string | null
}

export interface ResumeRecord {
  artifact_type: 'runtime.resume_record'
  schema_version: 1
  resume_record_id: string
  work_id: string
  attempt_id: string
  worker_id: string
  repo_id: string
  change_id: string
  worktree_id: string
  worktree_head: string
  opsx_artifact_digest: RuntimeDigest
  last_event_offset: number
  checkpoint_ids: string[]
  evidence_ids: string[]
  workspace_id: string | null
  pane_id: string | null
  engine: string
  engine_version: string
  capability_grant_digest: RuntimeDigest
  resume_token_digest: RuntimeDigest
  consumed_by_attempt_id: string | null
  recorded_at: string
}

export interface PaneMapping {
  mapping_id: string
  work_id: string
  attempt_id: string
  workspace_id: string
  pane_id: string
  resume_record_id: string
  resume_token_digest: RuntimeDigest
  state: 'attached' | 'reattached' | 'closed'
  attached_at: string
  updated_at: string
}

/**
 * The runtime's own name for one Herdr pane, and for the workspace it lives in.
 *
 * Herdr's `w7:p8B` handles are MUTABLE aliases (plan section 3.2 rule 4): a pane keeps its handle
 * only until somebody splits, renames or re-creates it, and a workspace's handle is reused as soon
 * as the old one closes. Plan section 9.8 therefore has the adapter mint `pane_*` / `ws_*` ONCE per
 * handle and persist them here, so that two attempts dispatched into the same pane are recognisably
 * the same pane even after the handle has been recycled.
 *
 * Deliberately NOT `PaneMapping`. That record is the resume-attachment ledger: every one of its
 * writers, its fold branch and `readRuntimeState`'s closing check require a CONSUMED resume record
 * behind it, and `pane.state` refuses a transition whose event attempt is not the mapping's own —
 * so a mapping cannot be carried from one dispatch attempt to the next, which is the whole point of
 * this record. Two collections, two questions: `PaneMapping` answers "which resumed attempt is
 * living in this pane right now", `PaneIdentity` answers "which pane is this, across handles".
 */
export interface PaneIdentity {
  pane_ref: string
  workspace_ref: string
  /** The Herdr handle as observed at mint time. The ALIAS, never the identity. */
  pane_handle: string
  workspace_handle: string
  minted_at: string
}

export interface RuntimeMessage {
  message_id: string
  sender_worker_id: string
  recipient_worker_id: string
  work_id: string
  change_id: string
  type: RuntimeMessageType
  causation_id: string | null
  child_work_id: string | null
  capability_grant_digest: RuntimeDigest
  authoritative_delegation: boolean
  payload: Record<string, unknown>
  recorded_at: string
}

export interface RuntimePause {
  scope: 'global' | 'repository' | 'initiative'
  scope_id: string
  paused: boolean
  actor: string
  grant_digest: RuntimeDigest
  reason: string
  updated_at: string
}

export interface RuntimeTraceObservation {
  observation_id: string
  attempt_id: string
  name: RuntimeSpanName
  span_id: string
  parent_span_id: string
  started_at: string
  ended_at: string | null
  attributes: Record<string, string | number | boolean>
  links: Array<{ trace_id: string; span_id: string; relationship: string }>
}

export interface RuntimeEvent {
  schema_version: 1
  sequence: number
  event_id: string
  kind: string
  recorded_at: string
  actor: string
  work_id: string | null
  attempt_id: string | null
  payload: Record<string, any>
}

export interface RuntimeState {
  events: RuntimeEvent[]
  workers: WorkerProfile[]
  grants: CapabilityGrant[]
  engines: RuntimeEngine[]
  works: RuntimeWork[]
  attempts: RuntimeAttempt[]
  leases: RuntimeLease[]
  resume_records: ResumeRecord[]
  pane_mappings: PaneMapping[]
  pane_identities: PaneIdentity[]
  messages: RuntimeMessage[]
  pauses: RuntimePause[]
  trace_observations: RuntimeTraceObservation[]
  /**
   * Work ids reopened since their last attempt was leased (ruling (m)).
   *
   * Exposed rather than kept private to the fold because `validateAttemptAdmission` needs the SAME
   * answer: two derivations of "has this been reopened since the last lease" drift, and the drift
   * is unrecoverable — admission accepting a linkless attempt the fold then refuses (or the
   * reverse) leaves the work with no attempt shape it can take at all. One producer, two readers.
   */
  reopened_since_last_lease: string[]
}

const TERMINAL_WORK = new Set<MachineWorkState>(['done', 'exhausted', 'cancelled', 'superseded'])

/**
 * The verification phases a single attempt runs through (plan section 4.5, section 7.7 ruling 5b).
 *
 * The SAME vocabulary as the BDD verdict event, and deliberately not a second one:
 * `docs/contracts/bdd/v1/scenario-verdict-event.schema.json` holds the enum, `bdd/evaluate.ts` holds
 * the `Phase` type, and `test/ai-control-plane-phase4.test.ts` pins this list against that schema so
 * the three cannot drift. A receipt tagged with a phase the verdict event cannot express would be
 * evidence for a gate that never ran.
 *
 * Mutation is not a fourth entry: it is the sensitivity check that runs from GREEN onward, judged
 * inside whichever phase requested it, not a phase of its own.
 */
export const VERIFICATION_PHASES = ['RED_VALIDITY', 'GREEN', 'REFACTOR'] as const
export type VerificationPhase = (typeof VERIFICATION_PHASES)[number]

/** Ruling (m): the two, and only two, reasons a delivered work item goes back in the queue. */
export const REOPEN_CAUSES = ['revision', 'evidence_insufficient'] as const
export type ReopenCause = (typeof REOPEN_CAUSES)[number]

/**
 * The one readiness predicate an `evidence_insufficient` reopen may cite.
 *
 * A literal shared by the runtime's validator and `ai-control-plane.ts`'s CLI rather than a free
 * string, because the whole point of the field is that the reopen is answerable: a reader has to be
 * able to go back to readiness and re-run the same judgement. A reopen citing a predicate readiness
 * does not compute is a claim nobody can check.
 */
export const EVIDENCE_READINESS_PREDICATE = 'required_work_terminal_with_current_evidence'

const ACTIVE_ATTEMPT = new Set<AttemptState>(['leased', 'running', 'paused'])
const WORK_TRANSITIONS: Record<MachineWorkState, MachineWorkState[]> = {
  created: ['queued', 'cancelled', 'superseded', 'quarantined'],
  queued: ['leased', 'cancelled', 'superseded', 'quarantined'],
  leased: ['running', 'retry_wait', 'exhausted', 'cancelled', 'superseded', 'quarantined'],
  running: ['retry_wait', 'done', 'exhausted', 'cancelled', 'superseded', 'quarantined'],
  retry_wait: ['queued', 'cancelled', 'superseded', 'quarantined'],
  // `done` is left by exactly ONE event (ruling (m)): the `queued` edge here is what the reopen
  // rides on, and the fold refuses it unless the immediately preceding event is `work.reopened`
  // for this same work at this same instant. The edge and the guard are two halves of one rule —
  // NEVER add a second producer of this transition without going through `reopenRuntimeWork`,
  // because the edge alone reads as "done is retryable", which is exactly what it is not.
  done: ['queued'],
  exhausted: [],
  cancelled: [],
  superseded: [],
  legacy_unverified: ['quarantined'],
  quarantined: [],
}
const ATTEMPT_TRANSITIONS: Record<AttemptState, AttemptState[]> = {
  leased: ['running', 'abandoned', 'cancelled', 'superseded'],
  running: ['paused', 'abandoned', 'succeeded', 'failed', 'exhausted', 'cancelled', 'superseded'],
  paused: ['running', 'abandoned', 'cancelled', 'superseded'],
  abandoned: [],
  succeeded: [],
  failed: [],
  exhausted: [],
  cancelled: [],
  superseded: [],
}
const SAFE_ID = /^[A-Za-z][A-Za-z0-9._:-]*$/
// Work IDs are minted by the flow controller, never here (plan section 3.2 rule 7): the spine
// already holds every real work item fleet-wide, so the control plane reads its form rather than
// inventing a second vocabulary. The slug is a mint seed, never an identity key.
const WORK_ID = /^W-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9][a-z0-9-]*$/
const ATTEMPT_ID = /^att_[A-Za-z0-9]+$/
const CHANGE_ID = /^chg_[A-Za-z0-9]+$/
const WORKER_ID = /^wkr_[A-Za-z0-9]+$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const MAX_CLOCK_SKEW_MS = 5 * 60_000
/**
 * The one reason string that lets a lease holder end its own attempt as `abandoned`.
 *
 * A constant rather than a literal because the fold and the emitter must agree exactly: the fold
 * matches on it, `handOffRuntimeAttempt` writes it, and a typo in either would fail open into a
 * silently unrecorded handover.
 */
const HANDOFF_REASON = 'relay handoff'

/**
 * How many times one piece of work may change hands before the runtime stops counting.
 *
 * NOT a retry budget, and no longer expressed as one (plan section 9.8 rule 8). `retry_limit`
 * governs what happens after an attempt FAILED; a handover is a live attempt passing its work to a
 * successor, which spends nothing. Riding the handover on `retry_limit` made the two inseparable,
 * and the visible cost was that the FIRST relay of every real chain was refused: a chain starts on a
 * card an ordinary dispatch minted, and rule 3 gives that card zero retries.
 *
 * 64 is a chain length no honest workflow reaches; it is here so the counter has a bound at all,
 * not because any handover past it is meaningfully different. A work item that changes hands 64
 * times has a problem no budget can express, and it will show up as a stall long before this.
 */
export const CONTINUATION_HANDOVER_BUDGET = 64
const RUNTIME_EVENT_PAYLOAD_KEYS: Record<string, { required: string[]; optional?: string[] }> = {
  'worker.registered': { required: ['profile'] },
  'grant.registered': { required: ['grant'] },
  'engine.registered': { required: ['engine'] },
  'work.created': { required: ['work'] },
  'work.state': { required: ['from', 'state', 'reason'] },
  'work.reopened': {
    required: ['cause', 'reopen_count', 'reason'],
    optional: [
      'revision_commit',
      'requirement_revision',
      'readiness_predicate',
      'receipt_ids',
      'spine_written',
    ],
  },
  'attempt.leased': { required: ['attempt', 'lease'] },
  'attempt.state': { required: ['from', 'state', 'reason'] },
  'attempt.flow': { required: ['from', 'state', 'pending_outcome'] },
  'attempt.flow_recovered': { required: ['from', 'state', 'pending_outcome', 'reason'] },
  // `phase` / `code_revision` ride the heartbeat rather than a verb of their own: ruling 5b says
  // the phases are one attempt's internal sequence and adds NO new runtime verb, and a heartbeat is
  // already what an attempt sends when it crosses from one phase to the next.
  'lease.heartbeat': { required: ['lease_id', 'expires_at'], optional: ['phase', 'code_revision'] },
  'lease.released': { required: ['lease_id', 'reason'] },
  'resume.recorded': { required: ['record'] },
  'resume.consumed': { required: ['resume_record_id'] },
  'pane.attached': { required: ['mapping'] },
  'pane.state': { required: ['mapping_id', 'state'], optional: ['pane_id'] },
  'pane.identity': { required: ['identity'] },
  'message.sent': { required: ['message'] },
  'control.paused': { required: ['control'] },
  'control.resumed': { required: ['control'] },
  'trace.observed': { required: ['observation'] },
}

/**
 * Every event kind this runtime can emit, as data.
 *
 * Exported so the contract test can assert the v1 schema carries a payload variant for each one.
 * The map above is the only place a kind is declared, so a new kind added there is a new kind here
 * — which is the whole point: `test/ai-control-plane-contracts.test.ts` fails the moment a kind
 * exists in the runtime with no `event_payload` variant behind it. Before this list the schema's
 * `oneOf` was closed and `pane.identity` had simply never been added to it; the test stayed green
 * because it only validated the kinds somebody had remembered to write a fixture for.
 */
export const RUNTIME_EVENT_KINDS: readonly string[] = Object.keys(RUNTIME_EVENT_PAYLOAD_KEYS)

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function runtimeDigest(value: unknown): RuntimeDigest {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

/** A workspace handle can be recycled, so the pane handle alone is not the key. */
function paneIdentityKey(workspaceHandle: string, paneHandle: string): string {
  return `${workspaceHandle}\u0000${paneHandle}`
}

function opaque(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

function iso(value: string | Date | undefined): string {
  if (value !== undefined && typeof value !== 'string' && !(value instanceof Date)) {
    throw new Error(`runtime timestamp must be a string or Date: ${String(value)}`)
  }
  const result = value instanceof Date ? value.toISOString() : (value ?? new Date().toISOString())
  if (Number.isNaN(Date.parse(result))) throw new Error(`invalid runtime timestamp: ${result}`)
  return result
}

function assertTrustedTimestamp(value: string): void {
  if (Date.parse(value) > Date.now() + MAX_CLOCK_SKEW_MS) {
    throw new Error(`runtime timestamp is too far in the future: ${value}`)
  }
}

function trustedAuthorizationTimestamp(): string {
  return new Date(Date.now()).toISOString()
}

function assertGrantActiveAt(grant: CapabilityGrant, timestamp: string): void {
  const at = Date.parse(timestamp)
  if (Date.parse(grant.issued_at) > at) throw new Error('capability grant is not issued yet')
  if (grant.expires_at !== null && Date.parse(grant.expires_at) <= at) {
    throw new Error('capability grant is expired')
  }
}

function requirePattern(label: string, value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (!pattern.test(value)) throw new Error(`${label} has invalid canonical form: ${value}`)
  return value
}

function requireDigest(label: string, value: unknown): RuntimeDigest {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (!DIGEST.test(value)) throw new Error(`${label} must be sha256:<64 lowercase hex>`)
  return value as RuntimeDigest
}

function requireNonEmptyString(label: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireNullableString(label: string, value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string or null`)
  }
  return value
}

function sleep(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, milliseconds)
}

export function runtimeJournalPath(repoRoot: string): string {
  return join(repoRoot, '.clade', 'ai-control-plane', 'runtime-events.jsonl')
}

function withRuntimeLock<T>(repoRoot: string, run: () => T): T {
  const path = runtimeJournalPath(repoRoot)
  const lockPath = `${path}.lock`
  mkdirSync(dirname(path), { recursive: true })
  let descriptor: number | null = null
  for (let attempt = 0; attempt < 700; attempt += 1) {
    try {
      descriptor = openSync(lockPath, 'wx')
      writeFileSync(
        descriptor,
        `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`,
      )
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let owner: { pid: number; acquired_at: string } | null = null
      try {
        owner = JSON.parse(readFileSync(lockPath, 'utf8'))
      } catch {}
      const validOwner =
        owner !== null &&
        Number.isInteger(owner.pid) &&
        owner.pid > 0 &&
        typeof owner.acquired_at === 'string' &&
        !Number.isNaN(Date.parse(owner.acquired_at))
      let ownerAlive = true
      if (validOwner) {
        try {
          process.kill(owner!.pid, 0)
        } catch (probeError) {
          ownerAlive = (probeError as NodeJS.ErrnoException).code !== 'ESRCH'
        }
      }
      const lockAgeMs = Date.now() - statSync(lockPath).mtimeMs
      if ((validOwner && !ownerAlive) || (!validOwner && lockAgeMs >= 5_000)) {
        const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`
        try {
          renameSync(lockPath, stalePath)
          unlinkSync(stalePath)
          continue
        } catch (reclaimError) {
          if ((reclaimError as NodeJS.ErrnoException).code !== 'ENOENT') throw reclaimError
        }
      }
      sleep(10)
    }
  }
  if (descriptor === null) throw new Error(`runtime journal lock contention: ${lockPath}`)
  try {
    return run()
  } finally {
    closeSync(descriptor)
    try {
      unlinkSync(lockPath)
    } catch {}
  }
}

function validateSafePayload(payload: Record<string, unknown>): void {
  assertJsonRoundTripStable('runtime payload', payload)
  const { redaction_applied: _, ...redacted } = redactPayload(payload)
  if (canonical(redacted) !== canonical(payload)) {
    throw new Error('runtime payload contains a value that requires redaction')
  }
}

function assertJsonRoundTripStable(label: string, value: unknown): void {
  const active = new Set<object>()
  const visit = (candidate: unknown, path: string): void => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean')
      return
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new Error(`${path} must contain only finite numbers`)
      return
    }
    if (typeof candidate !== 'object') {
      throw new Error(`${path} contains a non-JSON value`)
    }
    if (active.has(candidate)) throw new Error(`${path} contains a circular reference`)
    active.add(candidate)
    try {
      if (Array.isArray(candidate)) {
        if (Object.getPrototypeOf(candidate) !== Array.prototype) {
          throw new Error(`${path} must contain only plain JSON arrays`)
        }
        for (const key of Reflect.ownKeys(candidate)) {
          if (key === 'length') continue
          if (typeof key !== 'string') {
            throw new Error(`${path} contains a property that JSON cannot preserve`)
          }
          const index = Number(key)
          if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= 2 ** 32 - 1 ||
            index >= candidate.length ||
            String(index) !== key
          ) {
            throw new Error(`${path} contains a property that JSON cannot preserve`)
          }
          const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
          if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
            throw new Error(`${path}[${index}] contains a property that JSON cannot preserve`)
          }
          visit(descriptor.value, `${path}[${index}]`)
        }
        return
      }
      const prototype = Object.getPrototypeOf(candidate)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${path} must contain only plain JSON objects`)
      }
      for (const key of Reflect.ownKeys(candidate)) {
        if (typeof key !== 'string') {
          throw new Error(`${path} contains a property that JSON cannot preserve`)
        }
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          throw new Error(`${path}.${key} contains a property that JSON cannot preserve`)
        }
        visit(descriptor.value, `${path}.${key}`)
      }
    } finally {
      active.delete(candidate)
    }
  }

  visit(value, label)
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error(`${label} cannot be serialized as JSON`)
  const roundTripped = JSON.parse(serialized)
  if (canonical(roundTripped) !== canonical(value)) {
    throw new Error(`${label} is not stable across JSON persistence`)
  }
}

function requireRecord(label: string, value: unknown): Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, any>
}

function assertExactKeys(label: string, value: Record<string, any>, expected: string[]): void {
  const expectedKeys = new Set(expected)
  const missing = expected.filter((key) => !Object.hasOwn(value, key))
  const unexpected = Object.keys(value).filter((key) => !expectedKeys.has(key))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} contract mismatch: missing=${missing.join(',')} unexpected=${unexpected.join(',')}`,
    )
  }
}

function requireStringList(label: string, value: unknown, minimum = 0): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array`)
  }
  if (value.length < minimum) throw new Error(`${label} must contain at least ${minimum} item(s)`)
  if (new Set(value).size !== value.length) throw new Error(`${label} must contain unique items`)
  return value
}

function validateRuntimeWork(work: RuntimeWork): void {
  assertExactKeys('runtime work', work, [
    'work_id',
    'repo_id',
    'change_id',
    'initiative_id',
    'parent_work_id',
    'created_by_grant_digest',
    'causation_id',
    'state',
    'retry_limit',
    'handover_count',
    'reopen_count',
    'created_at',
    'updated_at',
  ])
  requirePattern('work_id', work.work_id, WORK_ID)
  requirePattern('change_id', work.change_id, CHANGE_ID)
  requireNonEmptyString('runtime work repo_id', work.repo_id)
  requireNullableString('runtime work initiative_id', work.initiative_id)
  requireNullableString('runtime work causation_id', work.causation_id)
  if (typeof work.state !== 'string' || !(work.state in WORK_TRANSITIONS)) {
    throw new Error('invalid runtime work')
  }
  if (!Number.isInteger(work.retry_limit) || work.retry_limit < 0) {
    throw new Error('runtime work retry_limit must be >= 0')
  }
  if (!Number.isInteger(work.handover_count) || work.handover_count < 0) {
    throw new Error('runtime work handover_count must be >= 0')
  }
  if (!Number.isInteger(work.reopen_count) || work.reopen_count < 0) {
    throw new Error('runtime work reopen_count must be >= 0')
  }
  if (work.parent_work_id !== null) requirePattern('parent work_id', work.parent_work_id, WORK_ID)
  if (work.created_by_grant_digest !== null) {
    requireDigest('created-by grant digest', work.created_by_grant_digest)
  }
  iso(work.created_at)
  iso(work.updated_at)
}

function validateRuntimeAttempt(attempt: RuntimeAttempt): void {
  assertExactKeys('runtime attempt', attempt, [
    'attempt_id',
    'work_id',
    'worker_id',
    'repo_id',
    'change_id',
    'engine',
    'engine_version',
    'scope_folder',
    'worktree_id',
    'worktree_head',
    'workspace_id',
    'pane_id',
    'lease_id',
    'root_trace_id',
    'root_span_id',
    'capability_grant_digest',
    'initiative_id',
    'requirement_id',
    'requirement_revision',
    'scenario_id',
    'code_revision',
    'phase_revisions',
    'intent_revision',
    'resumes_attempt_id',
    'supersedes_attempt_id',
    'flow_state',
    'pending_outcome',
    'state',
    'started_at',
    'updated_at',
  ])
  requirePattern('attempt_id', attempt.attempt_id, ATTEMPT_ID)
  requirePattern('work_id', attempt.work_id, WORK_ID)
  requirePattern('worker_id', attempt.worker_id, WORKER_ID)
  requirePattern('change_id', attempt.change_id, CHANGE_ID)
  requirePattern('lease_id', attempt.lease_id, /^lse_[A-Za-z0-9]+$/)
  requirePattern('trace_id', attempt.root_trace_id, /^[0-9a-f]{32}$/)
  requirePattern('root span_id', attempt.root_span_id, /^[0-9a-f]{16}$/)
  requireDigest('capability grant digest', attempt.capability_grant_digest)
  requireNonEmptyString('runtime attempt repo_id', attempt.repo_id)
  requireNonEmptyString('runtime attempt engine', attempt.engine)
  requireNonEmptyString('runtime attempt engine_version', attempt.engine_version)
  requireNonEmptyString('runtime attempt scope_folder', attempt.scope_folder)
  requireNullableString('runtime attempt worktree_id', attempt.worktree_id)
  requireNullableString('runtime attempt worktree_head', attempt.worktree_head)
  requireNullableString('runtime attempt workspace_id', attempt.workspace_id)
  requireNullableString('runtime attempt pane_id', attempt.pane_id)
  requireNullableString('runtime attempt initiative_id', attempt.initiative_id)
  requireNullableString('runtime attempt requirement_id', attempt.requirement_id)
  requireNullableString('runtime attempt scenario_id', attempt.scenario_id)
  requireNullableString('runtime attempt code_revision', attempt.code_revision)
  requireRecord('runtime attempt phase_revisions', attempt.phase_revisions)
  for (const [phase, revision] of Object.entries(attempt.phase_revisions)) {
    if (!VERIFICATION_PHASES.includes(phase as VerificationPhase)) {
      throw new Error(`unknown verification phase: ${phase}`)
    }
    requireNonEmptyString(`phase_revisions.${phase}`, revision)
  }
  if (!(attempt.state in ATTEMPT_TRANSITIONS)) throw new Error('invalid runtime attempt state')
  if (!['pending_start', 'started', 'pending_end', 'ended'].includes(attempt.flow_state)) {
    throw new Error('invalid runtime attempt flow state')
  }
  for (const linkedAttemptId of [attempt.resumes_attempt_id, attempt.supersedes_attempt_id]) {
    if (linkedAttemptId !== null) requirePattern('linked attempt_id', linkedAttemptId, ATTEMPT_ID)
  }
  for (const revision of [attempt.requirement_revision, attempt.intent_revision]) {
    if (revision !== null && (!Number.isInteger(revision) || revision < 1)) {
      throw new Error('runtime attempt revisions must be positive integers')
    }
  }
  if (
    attempt.pending_outcome !== null &&
    !['ok', 'fail', 'blocked', 'cancelled', 'superseded'].includes(attempt.pending_outcome)
  ) {
    throw new Error('invalid runtime attempt pending outcome')
  }
  iso(attempt.started_at)
  iso(attempt.updated_at)
}

function validateRuntimeLease(lease: RuntimeLease): void {
  assertExactKeys('runtime lease', lease, [
    'lease_id',
    'work_id',
    'attempt_id',
    'worker_id',
    'acquired_at',
    'heartbeat_at',
    'expires_at',
    'released_at',
    'release_reason',
  ])
  requirePattern('lease_id', lease.lease_id, /^lse_[A-Za-z0-9]+$/)
  requirePattern('work_id', lease.work_id, WORK_ID)
  requirePattern('attempt_id', lease.attempt_id, ATTEMPT_ID)
  requirePattern('worker_id', lease.worker_id, WORKER_ID)
  iso(lease.acquired_at)
  iso(lease.heartbeat_at)
  iso(lease.expires_at)
  if (lease.released_at !== null) iso(lease.released_at)
  requireNullableString('runtime lease release_reason', lease.release_reason)
}

function validateResumeRecord(record: ResumeRecord): void {
  assertExactKeys('resume record', record, [
    'artifact_type',
    'schema_version',
    'resume_record_id',
    'work_id',
    'attempt_id',
    'worker_id',
    'repo_id',
    'change_id',
    'worktree_id',
    'worktree_head',
    'opsx_artifact_digest',
    'last_event_offset',
    'checkpoint_ids',
    'evidence_ids',
    'workspace_id',
    'pane_id',
    'engine',
    'engine_version',
    'capability_grant_digest',
    'resume_token_digest',
    'consumed_by_attempt_id',
    'recorded_at',
  ])
  if (record.artifact_type !== 'runtime.resume_record' || record.schema_version !== 1) {
    throw new Error('resume record contract version mismatch')
  }
  requirePattern('resume_record_id', record.resume_record_id, /^rsm_[A-Za-z0-9]+$/)
  requirePattern('work_id', record.work_id, WORK_ID)
  requirePattern('attempt_id', record.attempt_id, ATTEMPT_ID)
  requirePattern('worker_id', record.worker_id, WORKER_ID)
  requirePattern('change_id', record.change_id, CHANGE_ID)
  requireNonEmptyString('resume repo_id', record.repo_id)
  requireNonEmptyString('resume worktree_id', record.worktree_id)
  requirePattern('resume worktree_head', record.worktree_head, /^[0-9a-f]{7,64}$/)
  requireNullableString('resume workspace_id', record.workspace_id)
  requireNullableString('resume pane_id', record.pane_id)
  requireNonEmptyString('resume engine', record.engine)
  requireNonEmptyString('resume engine_version', record.engine_version)
  requireDigest('OPSX artifact digest', record.opsx_artifact_digest)
  requireDigest('capability grant digest', record.capability_grant_digest)
  requireDigest('resume token digest', record.resume_token_digest)
  requireStringList('resume checkpoint_ids', record.checkpoint_ids)
  requireStringList('resume evidence_ids', record.evidence_ids)
  if (!Number.isInteger(record.last_event_offset) || record.last_event_offset < 0) {
    throw new Error('resume last_event_offset must be >= 0')
  }
  if (record.consumed_by_attempt_id !== null) {
    requirePattern('consumed attempt_id', record.consumed_by_attempt_id, ATTEMPT_ID)
  }
  iso(record.recorded_at)
}

function validatePaneMapping(mapping: PaneMapping): void {
  assertExactKeys('pane mapping', mapping, [
    'mapping_id',
    'work_id',
    'attempt_id',
    'workspace_id',
    'pane_id',
    'resume_record_id',
    'resume_token_digest',
    'state',
    'attached_at',
    'updated_at',
  ])
  requirePattern('mapping_id', mapping.mapping_id, /^pmp_[A-Za-z0-9]+$/)
  requirePattern('work_id', mapping.work_id, WORK_ID)
  requirePattern('attempt_id', mapping.attempt_id, ATTEMPT_ID)
  requirePattern('resume_record_id', mapping.resume_record_id, /^rsm_[A-Za-z0-9]+$/)
  requireDigest('resume token digest', mapping.resume_token_digest)
  requireNonEmptyString('pane mapping workspace_id', mapping.workspace_id)
  requireNonEmptyString('pane mapping pane_id', mapping.pane_id)
  if (!['attached', 'reattached', 'closed'].includes(mapping.state)) {
    throw new Error('invalid pane mapping state')
  }
  iso(mapping.attached_at)
  iso(mapping.updated_at)
}

function validatePaneIdentity(identity: PaneIdentity): void {
  assertExactKeys('pane identity', identity, [
    'pane_ref',
    'workspace_ref',
    'pane_handle',
    'workspace_handle',
    'minted_at',
  ])
  requirePattern('pane_ref', identity.pane_ref, /^pane_[A-Za-z0-9]+$/)
  requirePattern('workspace_ref', identity.workspace_ref, /^ws_[A-Za-z0-9]+$/)
  requireNonEmptyString('pane identity pane_handle', identity.pane_handle)
  requireNonEmptyString('pane identity workspace_handle', identity.workspace_handle)
  iso(identity.minted_at)
}

function validateRuntimeMessage(message: RuntimeMessage): void {
  assertExactKeys('runtime message', message, [
    'message_id',
    'sender_worker_id',
    'recipient_worker_id',
    'work_id',
    'change_id',
    'type',
    'causation_id',
    'child_work_id',
    'capability_grant_digest',
    'authoritative_delegation',
    'payload',
    'recorded_at',
  ])
  requirePattern('message_id', message.message_id, /^msg_[A-Za-z0-9]+$/)
  requirePattern('sender_worker_id', message.sender_worker_id, WORKER_ID)
  requirePattern('recipient_worker_id', message.recipient_worker_id, WORKER_ID)
  requirePattern('work_id', message.work_id, WORK_ID)
  requirePattern('change_id', message.change_id, CHANGE_ID)
  if (
    !['question', 'answer', 'delegation_request', 'delegation_result', 'evidence_notice'].includes(
      message.type,
    )
  ) {
    throw new Error('invalid runtime message type')
  }
  if (message.child_work_id !== null)
    requirePattern('child work_id', message.child_work_id, WORK_ID)
  requireNullableString('runtime message causation_id', message.causation_id)
  requireDigest('message capability grant digest', message.capability_grant_digest)
  if (typeof message.authoritative_delegation !== 'boolean') {
    throw new Error('runtime message authority must be boolean')
  }
  requireRecord('runtime message payload', message.payload)
  iso(message.recorded_at)
}

function validateRuntimePause(control: RuntimePause): void {
  assertExactKeys('runtime pause', control, [
    'scope',
    'scope_id',
    'paused',
    'actor',
    'grant_digest',
    'reason',
    'updated_at',
  ])
  if (!['global', 'repository', 'initiative'].includes(control.scope)) {
    throw new Error('invalid runtime pause scope')
  }
  requireNonEmptyString('runtime pause scope_id', control.scope_id)
  requireNonEmptyString('runtime pause actor', control.actor)
  requireNonEmptyString('runtime pause reason', control.reason)
  if (typeof control.paused !== 'boolean') throw new Error('runtime pause state must be boolean')
  requireDigest('pause grant digest', control.grant_digest)
  iso(control.updated_at)
}

function validateTraceObservation(observation: RuntimeTraceObservation): void {
  assertExactKeys('trace observation', observation, [
    'observation_id',
    'attempt_id',
    'name',
    'span_id',
    'parent_span_id',
    'started_at',
    'ended_at',
    'attributes',
    'links',
  ])
  requirePattern('observation_id', observation.observation_id, /^obs_[A-Za-z0-9]+$/)
  requirePattern('attempt_id', observation.attempt_id, ATTEMPT_ID)
  if (
    ![
      'agent.turn',
      'tool.call',
      'test.run',
      'evidence.capture',
      'work.delegate',
      'gate.wait',
      'runtime.resume',
    ].includes(observation.name)
  ) {
    throw new Error('invalid runtime trace observation name')
  }
  requirePattern('span_id', observation.span_id, /^[0-9a-f]{16}$/)
  requirePattern('parent_span_id', observation.parent_span_id, /^[0-9a-f]{16}$/)
  iso(observation.started_at)
  if (observation.ended_at !== null) {
    iso(observation.ended_at)
    if (Date.parse(observation.ended_at) < Date.parse(observation.started_at)) {
      throw new Error('trace observation cannot end before it starts')
    }
  }
  const attributes = requireRecord('trace attributes', observation.attributes)
  if (
    Object.values(attributes).some(
      (value) => !['string', 'number', 'boolean'].includes(typeof value),
    )
  ) {
    throw new Error('trace attributes must contain only scalar values')
  }
  if (!Array.isArray(observation.links)) throw new Error('trace links must be an array')
  for (const link of observation.links) {
    assertExactKeys('trace link', requireRecord('trace link', link), [
      'trace_id',
      'span_id',
      'relationship',
    ])
    requirePattern('trace link trace_id', link.trace_id, /^[0-9a-f]{32}$/)
    requirePattern('trace link span_id', link.span_id, /^[0-9a-f]{16}$/)
    requireNonEmptyString('trace link relationship', link.relationship)
  }
}

function validateNestedEventPayload(event: RuntimeEvent): void {
  const payload = event.payload
  if (event.kind === 'worker.registered') validateWorkerProfile(payload.profile)
  if (event.kind === 'grant.registered') validateGrant(payload.grant)
  if (event.kind === 'engine.registered') validateEngine(payload.engine)
  if (event.kind === 'work.created') validateRuntimeWork(payload.work)
  if (event.kind === 'work.state') {
    if (
      typeof payload.from !== 'string' ||
      !(payload.from in WORK_TRANSITIONS) ||
      typeof payload.state !== 'string' ||
      !(payload.state in WORK_TRANSITIONS)
    ) {
      throw new Error('invalid runtime work state payload')
    }
    requireNonEmptyString('runtime work state reason', payload.reason)
  }
  if (event.kind === 'work.reopened') {
    if (!REOPEN_CAUSES.includes(payload.cause)) {
      throw new Error(`invalid work reopen cause: ${String(payload.cause)}`)
    }
    if (!Number.isInteger(payload.reopen_count) || payload.reopen_count < 1) {
      throw new Error('work reopen reopen_count must be >= 1')
    }
    requireNonEmptyString('work reopen reason', payload.reason)
    // Present ONLY to record that the paired spine write did not land, so `false` is the only value
    // it may carry: a `true` here would be a claim about another ledger made by the ledger that
    // cannot see it.
    if ('spine_written' in payload && payload.spine_written !== false) {
      throw new Error('work reopen spine_written is written only as false')
    }
    // Each cause carries the thing that makes it checkable, and carries ONLY that: a revision
    // reopen points at the commit that moved the requirement, an evidence reopen at the readiness
    // predicate that named the work and the receipts it judged. Accepting either field under
    // either cause would let a caller present an unrelated commit as a readiness verdict.
    if (payload.cause === 'revision') {
      requirePattern('work reopen revision_commit', payload.revision_commit, /^[0-9a-f]{7,40}$/)
      // The revision the work is being sent back to answer. Optional on the shape but written by
      // the only emitter, because `materializeWork` reads it: without it, re-materializing the work
      // spec after a revision compares the plan's r2 against the r1 frozen into `work.open` and
      // refuses the work spec as stale — the reopen would put the work back in the queue and
      // nothing could take it out again.
      if ('requirement_revision' in payload) {
        if (
          !Number.isInteger(payload.requirement_revision) ||
          (payload.requirement_revision as number) < 1
        ) {
          throw new Error('work reopen requirement_revision must be a positive integer')
        }
      }
      if ('readiness_predicate' in payload || 'receipt_ids' in payload) {
        throw new Error('a revision reopen carries a revision commit, not a readiness verdict')
      }
    } else {
      if ('requirement_revision' in payload) {
        throw new Error('an evidence reopen does not move the requirement, so it names no revision')
      }
      if (payload.readiness_predicate !== EVIDENCE_READINESS_PREDICATE) {
        throw new Error(
          `an evidence reopen must name ${EVIDENCE_READINESS_PREDICATE}, not ${String(payload.readiness_predicate)}`,
        )
      }
      requireStringList('work reopen receipt_ids', payload.receipt_ids)
      if ('revision_commit' in payload) {
        throw new Error('an evidence reopen carries the receipts it judged, not a revision commit')
      }
    }
  }
  if (event.kind === 'attempt.leased') {
    validateRuntimeAttempt(payload.attempt)
    validateRuntimeLease(payload.lease)
    if (
      payload.attempt.attempt_id !== event.attempt_id ||
      payload.lease.attempt_id !== event.attempt_id
    ) {
      throw new Error('attempt lease payload identity mismatch')
    }
  }
  if (event.kind === 'attempt.state') {
    if (
      typeof payload.from !== 'string' ||
      !(payload.from in ATTEMPT_TRANSITIONS) ||
      typeof payload.state !== 'string' ||
      !(payload.state in ATTEMPT_TRANSITIONS)
    ) {
      throw new Error('invalid runtime attempt state payload')
    }
    requireNonEmptyString('runtime attempt state reason', payload.reason)
  }
  if (event.kind === 'attempt.flow') {
    if (
      !['pending_start', 'started', 'pending_end'].includes(payload.from) ||
      !['started', 'pending_end', 'ended'].includes(payload.state) ||
      !['ok', 'fail', 'blocked', 'cancelled', 'superseded', null].includes(payload.pending_outcome)
    ) {
      throw new Error('invalid runtime attempt flow payload')
    }
  }
  if (event.kind === 'attempt.flow_recovered') {
    if (
      !['pending_start', 'started', 'pending_end'].includes(payload.from) ||
      payload.state !== 'ended' ||
      payload.pending_outcome !== null ||
      !payload.reason
    ) {
      throw new Error('invalid recovered runtime attempt flow payload')
    }
    requireNonEmptyString('recovered runtime flow reason', payload.reason)
  }
  if (event.kind === 'lease.heartbeat') {
    requirePattern('lease_id', payload.lease_id, /^lse_[A-Za-z0-9]+$/)
    iso(payload.expires_at)
    // Both or neither (TD-885). A phase with no revision records that something happened without
    // recording what it happened to, which is the exact gap this field exists to close; a revision
    // with no phase has nowhere to be filed.
    if ('phase' in payload !== 'code_revision' in payload) {
      throw new Error('a heartbeat records a phase together with the revision it ran against')
    }
    if ('phase' in payload) {
      if (!VERIFICATION_PHASES.includes(payload.phase)) {
        throw new Error(`unknown verification phase: ${String(payload.phase)}`)
      }
      requireNonEmptyString('heartbeat code_revision', payload.code_revision)
    }
  }
  if (event.kind === 'lease.released') {
    requirePattern('lease_id', payload.lease_id, /^lse_[A-Za-z0-9]+$/)
    requireNonEmptyString('lease release reason', payload.reason)
  }
  if (event.kind === 'resume.recorded') validateResumeRecord(payload.record)
  if (event.kind === 'resume.consumed')
    requirePattern('resume_record_id', payload.resume_record_id, /^rsm_[A-Za-z0-9]+$/)
  if (event.kind === 'pane.attached') validatePaneMapping(payload.mapping)
  if (event.kind === 'pane.state') {
    requirePattern('mapping_id', payload.mapping_id, /^pmp_[A-Za-z0-9]+$/)
    if (payload.pane_id !== undefined) requireNonEmptyString('pane_id', payload.pane_id)
    if (!['reattached', 'closed'].includes(payload.state))
      throw new Error('invalid pane state payload')
  }
  if (event.kind === 'pane.identity') validatePaneIdentity(payload.identity)
  if (event.kind === 'message.sent') validateRuntimeMessage(payload.message)
  if (event.kind === 'control.paused' || event.kind === 'control.resumed')
    validateRuntimePause(payload.control)
  if (event.kind === 'trace.observed') validateTraceObservation(payload.observation)
}

function validateEvent(event: RuntimeEvent, expectedSequence?: number): void {
  const expectedKeys = [
    'schema_version',
    'sequence',
    'event_id',
    'kind',
    'recorded_at',
    'actor',
    'work_id',
    'attempt_id',
    'payload',
  ]
  const unexpectedTopLevel = Object.keys(event).filter((key) => !expectedKeys.includes(key))
  const missingTopLevel = expectedKeys.filter((key) => !Object.hasOwn(event, key))
  if (unexpectedTopLevel.length > 0 || missingTopLevel.length > 0) {
    throw new Error(
      `runtime event envelope mismatch: missing=${missingTopLevel.join(',')} unexpected=${unexpectedTopLevel.join(',')}`,
    )
  }
  if (event.schema_version !== 1) throw new Error('runtime event schema_version must be 1')
  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    throw new Error('runtime event sequence must be a positive integer')
  }
  if (expectedSequence !== undefined && event.sequence !== expectedSequence) {
    throw new Error(`runtime event sequence gap at ${event.sequence}; expected ${expectedSequence}`)
  }
  requirePattern('runtime event_id', event.event_id, /^rte_[A-Za-z0-9]+$/)
  requirePattern('runtime event kind', event.kind, /^[a-z]+(?:\.[a-z_]+)+$/)
  iso(event.recorded_at)
  requireNonEmptyString('runtime event actor', event.actor)
  if (event.work_id !== null) requirePattern('work_id', event.work_id, WORK_ID)
  if (event.attempt_id !== null) requirePattern('attempt_id', event.attempt_id, ATTEMPT_ID)
  requireRecord('runtime event payload', event.payload)
  const payloadContract = RUNTIME_EVENT_PAYLOAD_KEYS[event.kind]
  if (!payloadContract) throw new Error(`unknown runtime event kind: ${event.kind}`)
  if (event.payload.event_kind !== event.kind) {
    throw new Error(`runtime payload discriminator mismatch: ${event.kind}`)
  }
  const allowed = new Set([
    'event_kind',
    ...payloadContract.required,
    ...(payloadContract.optional ?? []),
  ])
  const missing = payloadContract.required.filter((key) => !(key in event.payload))
  const unexpected = Object.keys(event.payload).filter((key) => !allowed.has(key))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `runtime payload contract mismatch for ${event.kind}: missing=${missing.join(',')} unexpected=${unexpected.join(',')}`,
    )
  }
  validateNestedEventPayload(event)
  validateSafePayload(event.payload)
}

/**
 * The ONE place a journal written before a field existed is made readable again.
 *
 * `handover_count` (plan section 9.8 rule 8) arrived after journals were already on disk in every
 * repo that has dispatched anything, and `work.created` is validated key-for-key — so without this
 * every one of those journals becomes unreadable, which for a fail-open adapter means every later
 * dispatch silently records nothing. A default of 0 is not a guess: no journal written before the
 * field existed could contain a handover, because the verb did not exist either.
 *
 * NEVER grow this into a general "fill in whatever is missing" pass. Every entry in the table below
 * is one field, on the one kind that carries it, whose absence is PROVABLY equivalent to the value
 * it is given — because the verb that could have set it did not exist when the journal was written.
 * A field whose absence is not provably equivalent to a known value does not belong here; it
 * belongs in a refusal.
 */
const EVENT_BACKFILL: Record<string, { key: string; fields: Record<string, unknown> }> = {
  'work.created': {
    key: 'work',
    fields: {
      // Plan section 9.8 rule 8. No journal written before the verb existed can contain a handover.
      handover_count: 0,
      // Ruling (m). Same argument, same shape: `work.reopened` did not exist, so no journal
      // written before it can describe a work item that had ever been reopened.
      reopen_count: 0,
    },
  },
  'attempt.leased': {
    key: 'attempt',
    // TD-885. There was no way to record a phase revision, so an attempt written before this field
    // recorded none — `{}` is what it held, not a guess at what it might have held.
    fields: { phase_revisions: {} },
  },
}

function migrateReadEvent(event: RuntimeEvent): RuntimeEvent {
  const rule = EVENT_BACKFILL[event.kind]
  if (!rule) return event
  const target = event.payload[rule.key] as Record<string, unknown> | undefined
  if (!target || typeof target !== 'object') return event
  const missing = Object.entries(rule.fields).filter(([key]) => !(key in target))
  if (missing.length === 0) return event
  return {
    ...event,
    payload: {
      ...event.payload,
      [rule.key]: { ...target, ...Object.fromEntries(missing) },
    },
  }
}

export function readRuntimeEvents(repoRoot: string): RuntimeEvent[] {
  const path = runtimeJournalPath(repoRoot)
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  const complete = raw.endsWith('\n') ? raw : raw.slice(0, raw.lastIndexOf('\n') + 1)
  const events = complete
    .split('\n')
    .filter(Boolean)
    .map((line) => migrateReadEvent(JSON.parse(line) as RuntimeEvent))
  const eventIds = new Set<string>()
  events.forEach((event, index) => {
    validateEvent(event, index + 1)
    assertTrustedTimestamp(event.recorded_at)
    if (eventIds.has(event.event_id))
      throw new Error(`duplicate runtime event_id: ${event.event_id}`)
    eventIds.add(event.event_id)
  })
  return events
}

function writeRuntimeEventsAtomic(repoRoot: string, events: RuntimeEvent[]): void {
  const path = runtimeJournalPath(repoRoot)
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  let descriptor: number | null = null
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600)
    writeFileSync(descriptor, events.map((event) => JSON.stringify(event)).join('\n') + '\n')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporaryPath, path)
    const directoryDescriptor = openSync(dirname(path), 'r')
    try {
      fsyncSync(directoryDescriptor)
    } finally {
      closeSync(directoryDescriptor)
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor)
    try {
      unlinkSync(temporaryPath)
    } catch {}
  }
}

function makeEvent(input: {
  kind: string
  actor: string
  recordedAt: string
  workId?: string | null
  attemptId?: string | null
  payload?: Record<string, any>
}): Omit<RuntimeEvent, 'sequence'> {
  return {
    schema_version: 1,
    event_id: opaque('rte'),
    kind: input.kind,
    recorded_at: input.recordedAt,
    actor: input.actor,
    work_id: input.workId ?? null,
    attempt_id: input.attemptId ?? null,
    payload: { event_kind: input.kind, ...input.payload },
  }
}

function mutateRuntime<T>(
  repoRoot: string,
  run: (state: RuntimeState) => { value: T; events: Array<Omit<RuntimeEvent, 'sequence'>> },
): T {
  return withRuntimeLock(repoRoot, () => {
    const current = readRuntimeEvents(repoRoot)
    const result = run(foldRuntimeEvents(current))
    const additions = result.events.map((event, index) => ({
      ...event,
      sequence: current.length + index + 1,
    }))
    const lastRecordedAt = current.at(-1)?.recorded_at
    for (const [index, event] of additions.entries()) {
      validateEvent(event, current.length + index + 1)
      assertTrustedTimestamp(event.recorded_at)
      if (lastRecordedAt && Date.parse(event.recorded_at) < Date.parse(lastRecordedAt)) {
        throw new Error('runtime events cannot backfill the canonical journal clock')
      }
    }
    foldRuntimeEvents([...current, ...additions])
    if (additions.length > 0) {
      writeRuntimeEventsAtomic(repoRoot, [...current, ...additions])
    }
    return result.value
  })
}

export function foldRuntimeEvents(events: RuntimeEvent[]): RuntimeState {
  const workers = new Map<string, WorkerProfile>()
  const grants = new Map<string, CapabilityGrant>()
  const engines = new Map<string, RuntimeEngine>()
  const works = new Map<string, RuntimeWork>()
  const attempts = new Map<string, RuntimeAttempt>()
  const leases = new Map<string, RuntimeLease>()
  const resumes = new Map<string, ResumeRecord>()
  const panes = new Map<string, PaneMapping>()
  const paneIdentities = new Map<string, PaneIdentity>()
  const messages = new Map<string, RuntimeMessage>()
  const pauses = new Map<string, RuntimePause>()
  const observations = new Map<string, RuntimeTraceObservation>()
  const eventIds = new Set<string>()
  const rootTraceIds = new Set<string>()
  /**
   * Work items reopened since their last attempt was leased (ruling (m)).
   *
   * The fold is the authority — a rule enforced only in `validateAttemptAdmission` would be
   * enforced only for events this process emitted — and it publishes the answer on `RuntimeState`
   * so admission reads it instead of re-deriving it. Cleared on the lease it authorizes, so a
   * reopen buys exactly one linkless attempt and the retry after it says why it exists like every
   * other retry.
   */
  const reopenedSinceLastLease = new Set<string>()
  const spanIds = new Set<string>()

  events.forEach((event, index) => {
    validateEvent(event, index + 1)
    if (eventIds.has(event.event_id))
      throw new Error(`duplicate runtime event_id: ${event.event_id}`)
    eventIds.add(event.event_id)
    if (index > 0 && Date.parse(event.recorded_at) < Date.parse(events[index - 1]!.recorded_at)) {
      throw new Error('runtime journal clock moved backwards')
    }
  })

  for (const [eventIndex, event] of events.entries()) {
    const payload = event.payload
    const previousEvent = events[eventIndex - 1]
    if (event.kind === 'worker.registered') {
      if (event.work_id !== null || event.attempt_id !== null)
        throw new Error('worker event cannot carry work identity')
      if (workers.has(payload.profile.worker_id))
        throw new Error(`duplicate worker_id: ${payload.profile.worker_id}`)
      if (payload.profile.registered_at !== event.recorded_at)
        throw new Error('worker registration timestamp mismatch')
      workers.set(payload.profile.worker_id, payload.profile)
    }
    if (event.kind === 'grant.registered') {
      if (event.work_id !== null || event.attempt_id !== null)
        throw new Error('grant event cannot carry work identity')
      if (grants.has(payload.grant.grant_id))
        throw new Error(`duplicate grant_id: ${payload.grant.grant_id}`)
      if (!workers.has(payload.grant.worker_id)) throw new Error('grant references unknown worker')
      if (payload.grant.issued_at !== event.recorded_at)
        throw new Error('grant registration timestamp mismatch')
      assertGrantActiveAt(payload.grant, event.recorded_at)
      grants.set(payload.grant.grant_id, payload.grant)
    }
    if (event.kind === 'engine.registered') {
      if (event.work_id !== null || event.attempt_id !== null)
        throw new Error('engine event cannot carry work identity')
      if (event.actor !== 'runtime-reconciler')
        throw new Error('engine registration requires runtime-reconciler authority')
      if (payload.engine.validated_at !== event.recorded_at)
        throw new Error('engine validation timestamp mismatch')
      const current = engines.get(payload.engine.engine)
      if (
        current?.ownership === 'user-managed' &&
        canonical(current) !== canonical(payload.engine)
      ) {
        throw new Error(`user-managed runtime cannot be overwritten: ${payload.engine.engine}`)
      }
      if (current && current.ownership !== payload.engine.ownership) {
        throw new Error('runtime engine ownership cannot transition')
      }
      if (
        current?.ownership === 'clade-managed' &&
        (current.path !== payload.engine.path || current.version !== payload.engine.version) &&
        payload.engine.health !== 'healthy'
      ) {
        throw new Error('clade-managed runtime updates require a healthy compatibility validation')
      }
      engines.set(payload.engine.engine, payload.engine)
    }
    if (event.kind === 'work.created') {
      if (event.work_id !== payload.work.work_id || event.attempt_id !== null)
        throw new Error('work create identity mismatch')
      if (works.has(event.work_id)) throw new Error(`duplicate work_id: ${event.work_id}`)
      if (
        payload.work.state !== 'created' ||
        payload.work.created_at !== event.recorded_at ||
        payload.work.updated_at !== event.recorded_at
      )
        throw new Error('work create state or timestamp mismatch')
      if (payload.work.parent_work_id !== null) {
        const parent = works.get(payload.work.parent_work_id)
        const grant = [...grants.values()].find(
          (candidate) => candidate.digest === payload.work.created_by_grant_digest,
        )
        const request =
          payload.work.causation_id === null ? null : messages.get(payload.work.causation_id)
        if (
          !parent ||
          parent.repo_id !== payload.work.repo_id ||
          parent.change_id !== payload.work.change_id ||
          parent.initiative_id !== payload.work.initiative_id ||
          !grant ||
          !grant.child_work_creation ||
          (!grant.repositories.includes('*') &&
            !grant.repositories.includes(payload.work.repo_id)) ||
          (payload.work.initiative_id !== null &&
            grant.initiative_ids.length > 0 &&
            !grant.initiative_ids.includes(payload.work.initiative_id)) ||
          !request ||
          request.type !== 'delegation_request' ||
          request.work_id !== parent.work_id ||
          request.change_id !== parent.change_id ||
          request.child_work_id !== payload.work.work_id ||
          request.capability_grant_digest !== grant.digest ||
          request.sender_worker_id !== grant.worker_id
        ) {
          throw new Error('child work create has invalid canonical lineage')
        }
        assertGrantActiveAt(grant, event.recorded_at)
      }
      works.set(event.work_id, payload.work)
    }
    if (event.kind === 'work.reopened') {
      const work = works.get(event.work_id!)
      if (!work) throw new Error(`runtime work reopen references unknown work: ${event.work_id}`)
      if (event.attempt_id !== null) {
        throw new Error('work reopen is a work-level event and carries no attempt')
      }
      // `done` and nothing else. `exhausted` / `cancelled` / `superseded` are terminal for reasons
      // a reopen does not answer, and ruling (m) names exactly one state it lets go of.
      if (work.state !== 'done') {
        throw new Error(`work reopen requires a done work item, not ${work.state}: ${work.work_id}`)
      }
      if (payload.reopen_count !== work.reopen_count + 1) {
        throw new Error(
          `work reopen count must step +1 from ${work.reopen_count}, got ${payload.reopen_count}`,
        )
      }
      works.set(event.work_id!, {
        ...work,
        // `retry_limit` is untouched, on purpose (ruling (m)). A reopen is not a retry, and
        // refilling the retry budget here would let a change buy attempts by revising itself.
        reopen_count: payload.reopen_count,
        updated_at: event.recorded_at,
      })
      reopenedSinceLastLease.add(event.work_id!)
    }
    if (event.kind === 'work.state') {
      const work = works.get(event.work_id!)
      if (!work) throw new Error(`runtime work state references unknown work: ${event.work_id}`)
      const attempt = event.attempt_id === null ? undefined : attempts.get(event.attempt_id)
      const lease = attempt ? leases.get(attempt.lease_id) : undefined
      const leaseActive = Boolean(
        lease &&
        lease.released_at === null &&
        Date.parse(lease.expires_at) > Date.parse(event.recorded_at),
      )
      if (event.attempt_id !== null) {
        if (!attempt || attempt.work_id !== event.work_id)
          throw new Error('work state attempt identity mismatch')
        const terminalCausality: Partial<Record<MachineWorkState, AttemptState[]>> = {
          done: ['succeeded'],
          retry_wait: ['failed', 'abandoned'],
          exhausted: ['failed', 'exhausted', 'abandoned'],
          cancelled: ['cancelled'],
          superseded: ['superseded'],
        }
        const allowedAttemptStates = terminalCausality[payload.state as MachineWorkState]
        if (allowedAttemptStates && !allowedAttemptStates.includes(attempt.state)) {
          throw new Error('work terminal transition lacks matching attempt outcome')
        }
      } else if (
        ['done', 'retry_wait', 'exhausted', 'cancelled', 'superseded'].includes(payload.state)
      ) {
        const parentTerminalRecovery =
          event.actor === 'runtime-reconciler' &&
          ['cancelled', 'superseded'].includes(payload.state) &&
          payload.reason === `parent ${payload.state}`
        if (!parentTerminalRecovery) {
          throw new Error('work terminal transition requires attempt causality')
        }
      }
      // The other half of `WORK_TRANSITIONS.done: ['queued']`. Anything that reaches this edge
      // without a `work.reopened` immediately before it — a hand-written journal line, a caller
      // that emitted `work.state` directly, a future emitter that forgot — is refused here, so
      // "done is left by exactly one event" is a property of the fold rather than of the callers.
      if (
        payload.from === 'done' &&
        payload.state === 'queued' &&
        (!previousEvent ||
          previousEvent.kind !== 'work.reopened' ||
          previousEvent.work_id !== event.work_id ||
          previousEvent.recorded_at !== event.recorded_at)
      ) {
        throw new Error('work reopen transition lacks work.reopened causality')
      }
      if (
        payload.from === 'created' &&
        payload.state === 'queued' &&
        (!previousEvent ||
          previousEvent.kind !== 'work.created' ||
          previousEvent.work_id !== event.work_id ||
          previousEvent.recorded_at !== event.recorded_at)
      ) {
        throw new Error('work queue transition lacks creation causality')
      }
      if (payload.state === 'leased' && (!attempt || attempt.state !== 'leased' || !leaseActive)) {
        throw new Error('work lease transition lacks an active leased attempt')
      }
      if (
        payload.from === 'leased' &&
        payload.state === 'running' &&
        (!attempt || attempt.state !== 'running' || !leaseActive)
      ) {
        throw new Error('work running transition lacks an active running attempt')
      }
      if (payload.from === 'retry_wait' && payload.state === 'queued') {
        const workAttempts = [...attempts.values()].filter(
          (candidate) => candidate.work_id === work.work_id,
        )
        const latestAttempt = workAttempts.at(-1)
        // TWO budgets, counted apart (plan section 9.8 rule 8). The handovers this work already
        // spent are on the work itself — the abandonment event that caused THIS requeue is earlier
        // in the same batch, so the count already includes it — and everything else is a retry.
        // Subtracting is what keeps a relay chain from eating the retry budget of the card it rides
        // on, and what lets a card with no retry budget at all be handed over.
        const retryAttempts = workAttempts.length - work.handover_count
        if (!latestAttempt || !['failed', 'abandoned'].includes(latestAttempt.state)) {
          throw new Error('work retry transition lacks retryable terminal attempt causality')
        }
        if (work.handover_count > CONTINUATION_HANDOVER_BUDGET) {
          throw new Error('work handover transition exceeds the handover budget')
        }
        if (retryAttempts > work.retry_limit) {
          throw new Error('work retry transition lacks retryable terminal attempt causality')
        }
      }
      if (
        payload.state === 'quarantined' &&
        (event.actor !== 'runtime-reconciler' || payload.reason !== 'reference orphan')
      ) {
        throw new Error('work quarantine transition lacks reconciler authority')
      }
      if (payload.state === 'quarantined') {
        const workAttempts = [...attempts.values()].filter(
          (candidate) => candidate.work_id === work.work_id,
        )
        const lifecycleOpen = workAttempts.some((candidate) => {
          const candidateLease = leases.get(candidate.lease_id)
          return (
            ACTIVE_ATTEMPT.has(candidate.state) ||
            candidate.flow_state !== 'ended' ||
            candidate.pending_outcome !== null ||
            !candidateLease ||
            candidateLease.released_at === null
          )
        })
        const paneOpen = [...panes.values()].some(
          (mapping) => mapping.work_id === work.work_id && mapping.state !== 'closed',
        )
        if (lifecycleOpen || paneOpen) {
          throw new Error('work quarantine transition requires complete lifecycle closure')
        }
      }
      if (payload.from !== work.state || !WORK_TRANSITIONS[work.state].includes(payload.state)) {
        throw new Error(
          `illegal runtime work transition ${payload.from} -> ${payload.state} for ${event.work_id}`,
        )
      }
      works.set(event.work_id!, {
        ...work,
        state: payload.state,
        updated_at: event.recorded_at,
      })
    }
    if (event.kind === 'attempt.leased') {
      const attempt = payload.attempt as RuntimeAttempt
      const lease = payload.lease as RuntimeLease
      const work = works.get(event.work_id!)
      const worker = workers.get(attempt.worker_id)
      const grant = [...grants.values()].find(
        (candidate) => candidate.digest === attempt.capability_grant_digest,
      )
      const engine = engines.get(attempt.engine)
      if (!work || !worker || !grant || !engine)
        throw new Error('attempt lease references unknown canonical identity')
      if (attempts.has(event.attempt_id!))
        throw new Error(`duplicate attempt_id: ${event.attempt_id}`)
      if (leases.has(lease.lease_id)) throw new Error(`duplicate lease_id: ${lease.lease_id}`)
      if (rootTraceIds.has(attempt.root_trace_id))
        throw new Error(`duplicate root_trace_id: ${attempt.root_trace_id}`)
      if (spanIds.has(attempt.root_span_id))
        throw new Error(`duplicate span_id: ${attempt.root_span_id}`)
      if (
        event.work_id !== attempt.work_id ||
        event.work_id !== lease.work_id ||
        event.attempt_id !== attempt.attempt_id ||
        event.attempt_id !== lease.attempt_id ||
        lease.lease_id !== attempt.lease_id ||
        lease.worker_id !== attempt.worker_id ||
        attempt.repo_id !== work.repo_id ||
        attempt.change_id !== work.change_id ||
        attempt.engine_version !== engine.version ||
        attempt.initiative_id !== work.initiative_id ||
        grant.worker_id !== attempt.worker_id
      ) {
        throw new Error('attempt lease canonical identity mismatch')
      }
      assertGrantActiveAt(grant, event.recorded_at)
      if (
        !worker.allowed_repositories.includes('*') &&
        !worker.allowed_repositories.includes(work.repo_id)
      )
        throw new Error('attempt worker repository mismatch')
      if (!grant.repositories.includes(work.repo_id) && !grant.repositories.includes('*'))
        throw new Error('attempt grant repository mismatch')
      if (
        !folderScopesCover(grant.folders, attempt.scope_folder) ||
        !folderScopesCover(worker.allowed_folders, attempt.scope_folder)
      )
        throw new Error('attempt folder scope mismatch')
      if (engine.version !== attempt.engine_version || engine.health === 'unavailable')
        throw new Error('attempt engine compatibility mismatch')
      if (
        attempt.state !== 'leased' ||
        attempt.flow_state !== 'pending_start' ||
        attempt.pending_outcome !== null ||
        attempt.started_at !== event.recorded_at ||
        attempt.updated_at !== event.recorded_at
      )
        throw new Error('attempt lease state or timestamp mismatch')
      if (
        lease.acquired_at !== event.recorded_at ||
        lease.heartbeat_at !== event.recorded_at ||
        Date.parse(lease.expires_at) <= Date.parse(event.recorded_at) ||
        lease.released_at !== null ||
        lease.release_reason !== null
      )
        throw new Error('lease create state or timestamp mismatch')
      if (work.state !== 'queued' && work.state !== 'retry_wait')
        throw new Error('attempt leased from non-admissible work state')
      if (
        [...leases.values()].some(
          (candidate) => candidate.work_id === work.work_id && candidate.released_at === null,
        )
      )
        throw new Error('overlapping runtime lease')
      const previousAttempts = [...attempts.values()].filter(
        (candidate) => candidate.work_id === work.work_id,
      )
      const links = [attempt.resumes_attempt_id, attempt.supersedes_attempt_id].filter(Boolean)
      const reopened = reopenedSinceLastLease.delete(work.work_id)
      const requiredLinks = previousAttempts.length === 0 || reopened ? 0 : 1
      if (links.length !== requiredLinks) {
        throw new Error(
          requiredLinks === 0 && reopened
            ? 'the first attempt after a reopen carries no causal link; the reopen is the causality'
            : 'attempt must have exactly one causal link after the first attempt',
        )
      }
      if (attempt.supersedes_attempt_id !== null) {
        const superseded = attempts.get(attempt.supersedes_attempt_id)
        if (
          !superseded ||
          superseded.work_id !== work.work_id ||
          ACTIVE_ATTEMPT.has(superseded.state)
        )
          throw new Error('supersession must reference a terminal attempt for the same work')
      }
      if (attempt.resumes_attempt_id !== null) {
        const resumed = attempts.get(attempt.resumes_attempt_id)
        const latest = previousAttempts.at(-1)
        const record = [...resumes.values()].find(
          (candidate) =>
            candidate.attempt_id === attempt.resumes_attempt_id &&
            candidate.work_id === work.work_id &&
            candidate.consumed_by_attempt_id === null,
        )
        if (
          !resumed ||
          latest?.attempt_id !== resumed.attempt_id ||
          !record ||
          record.worker_id !== attempt.worker_id ||
          record.repo_id !== attempt.repo_id ||
          record.change_id !== attempt.change_id ||
          record.worktree_id !== attempt.worktree_id ||
          record.worktree_head !== attempt.worktree_head ||
          record.engine !== attempt.engine ||
          record.engine_version !== attempt.engine_version ||
          record.capability_grant_digest !== attempt.capability_grant_digest ||
          !engine.resume_capability
        )
          throw new Error('resume attempt lacks current canonical lineage')
      }
      rootTraceIds.add(attempt.root_trace_id)
      spanIds.add(attempt.root_span_id)
      attempts.set(event.attempt_id!, payload.attempt)
      leases.set(payload.lease.lease_id, payload.lease)
    }
    if (event.kind === 'attempt.state') {
      const attempt = attempts.get(event.attempt_id!)
      if (!attempt) throw new Error(`attempt state references unknown attempt: ${event.attempt_id}`)
      if (event.work_id !== attempt.work_id) throw new Error('attempt state work identity mismatch')
      if (
        payload.from !== attempt.state ||
        !ATTEMPT_TRANSITIONS[attempt.state].includes(payload.state)
      ) {
        throw new Error(
          `illegal runtime attempt transition ${payload.from} -> ${payload.state} for ${event.attempt_id}`,
        )
      }
      const lease = leases.get(attempt.lease_id)
      const leaseActive = Boolean(
        lease &&
        lease.released_at === null &&
        Date.parse(lease.expires_at) > Date.parse(event.recorded_at),
      )
      if (payload.from === 'leased' && payload.state === 'running' && !leaseActive) {
        throw new Error('attempt start lacks an active lease')
      }
      if (
        payload.state === 'paused' ||
        (payload.from === 'paused' && payload.state === 'running')
      ) {
        const work = works.get(attempt.work_id)
        const matchingControl = work
          ? [...pauses.values()].find(
              (control) =>
                control.updated_at === event.recorded_at &&
                control.actor === event.actor &&
                control.paused === (payload.state === 'paused') &&
                (control.scope === 'global' ||
                  (control.scope === 'repository' && control.scope_id === work.repo_id) ||
                  (control.scope === 'initiative' && control.scope_id === work.initiative_id)),
            )
          : undefined
        const effectivePause = work ? matchingPauseIn(pauses.values(), work) : undefined
        if (
          !matchingControl ||
          !leaseActive ||
          (payload.state === 'paused' ? !effectivePause : Boolean(effectivePause))
        ) {
          throw new Error('attempt pause transition lacks matching control and active lease')
        }
      }
      if (payload.state === 'abandoned') {
        const validRecovery =
          event.actor === 'runtime-reconciler' &&
          (payload.reason === 'reference orphan' ||
            (payload.reason === 'flow start missing' && attempt.flow_state === 'pending_start') ||
            (payload.reason === 'lease expired' &&
              Boolean(lease && Date.parse(lease.expires_at) <= Date.parse(event.recorded_at))))
        // The fourth cause, and the only one authored by the lease HOLDER rather than the
        // reconciler: a handover (plan section 9.8 rule 8). The other three are recoveries — some
        // watcher noticed an attempt that stopped — and their authority comes from being the
        // watcher. A handoff is the holder saying so about its own attempt while it is still alive,
        // so its authority has to come from evidence instead, and the evidence is an UNCONSUMED
        // resume record published for this very attempt in this very batch. Without one there is no
        // successor to hand to, and this is just an attempt disappearing without a verdict.
        //
        // NEVER loosen this to "the holder said the reason" — the reason string is free text and
        // would make `abandoned` reachable for anything.
        const validHandoff =
          payload.reason === HANDOFF_REASON &&
          event.actor === attempt.worker_id &&
          leaseActive &&
          [...resumes.values()].some(
            (record) =>
              record.attempt_id === attempt.attempt_id && record.consumed_by_attempt_id === null,
          )
        if (!validRecovery && !validHandoff) {
          throw new Error('attempt abandonment lacks reconciler authority')
        }
        // The handover counter moves HERE, at the event the fold just authorized, and nowhere else.
        // Counting it later — at the requeue, say — would make it reachable by a work.state event
        // the holder wrote without an authorized abandonment behind it.
        if (validHandoff) {
          const handedWork = works.get(attempt.work_id)
          if (handedWork) {
            works.set(attempt.work_id, {
              ...handedWork,
              handover_count: handedWork.handover_count + 1,
            })
          }
        }
      }
      if (payload.state !== 'abandoned' && !ACTIVE_ATTEMPT.has(payload.state)) {
        const expectedOutcomes: Partial<Record<AttemptState, RuntimeAttempt['pending_outcome'][]>> =
          {
            succeeded: ['ok'],
            failed: ['fail', 'blocked'],
            exhausted: ['fail', 'blocked'],
            cancelled: ['cancelled'],
            superseded: ['superseded'],
          }
        const reconciledParentTerminal =
          event.actor === 'runtime-reconciler' &&
          ['cancelled', 'superseded'].includes(payload.state) &&
          payload.reason === `parent ${payload.state}`
        const normalTerminalIsValid = Boolean(
          attempt.flow_state === 'pending_end' &&
          expectedOutcomes[payload.state as AttemptState]?.includes(attempt.pending_outcome) &&
          lease &&
          lease.released_at === null &&
          Date.parse(lease.expires_at) > Date.parse(event.recorded_at),
        )
        if (!reconciledParentTerminal && !normalTerminalIsValid) {
          throw new Error('attempt terminal transition lacks prepared flow and active lease')
        }
      }
      attempts.set(event.attempt_id!, {
        ...attempt,
        state: payload.state,
        updated_at: event.recorded_at,
      })
    }
    if (event.kind === 'attempt.flow') {
      const attempt = attempts.get(event.attempt_id!)
      if (!attempt) throw new Error(`attempt flow references unknown attempt: ${event.attempt_id}`)
      if (event.work_id !== attempt.work_id) throw new Error('attempt flow work identity mismatch')
      if (payload.state === 'pending_end') {
        const lease = leases.get(attempt.lease_id)
        if (
          !lease ||
          lease.released_at !== null ||
          Date.parse(lease.expires_at) <= Date.parse(event.recorded_at)
        ) {
          throw new Error('attempt finish prepare lacks an active lease')
        }
      }
      if (payload.from !== attempt.flow_state) {
        throw new Error(
          `illegal attempt flow transition ${payload.from} -> ${payload.state} for ${event.attempt_id}`,
        )
      }
      const allowed: Record<RuntimeAttempt['flow_state'], RuntimeAttempt['flow_state'][]> = {
        pending_start: ['started', 'ended'],
        started: ['pending_end'],
        pending_end: ['ended'],
        ended: [],
      }
      if (!allowed[attempt.flow_state].includes(payload.state)) {
        throw new Error(
          `illegal attempt flow transition ${payload.from} -> ${payload.state} for ${event.attempt_id}`,
        )
      }
      attempts.set(event.attempt_id!, {
        ...attempt,
        flow_state: payload.state,
        pending_outcome: Object.hasOwn(payload, 'pending_outcome')
          ? payload.pending_outcome
          : attempt.pending_outcome,
        updated_at: event.recorded_at,
      })
    }
    if (event.kind === 'attempt.flow_recovered') {
      const attempt = attempts.get(event.attempt_id!)
      if (!attempt) {
        throw new Error(`recovered attempt flow references unknown attempt: ${event.attempt_id}`)
      }
      const lease = leases.get(attempt.lease_id)
      if (
        event.actor !== 'runtime-reconciler' ||
        event.work_id !== attempt.work_id ||
        payload.from !== attempt.flow_state ||
        payload.state !== 'ended' ||
        payload.pending_outcome !== null ||
        ACTIVE_ATTEMPT.has(attempt.state) ||
        !lease ||
        (lease.released_at === null && Date.parse(lease.expires_at) > Date.parse(event.recorded_at))
      ) {
        throw new Error('recovered attempt flow lacks terminal recovery authority')
      }
      attempts.set(event.attempt_id!, {
        ...attempt,
        flow_state: 'ended',
        pending_outcome: null,
        updated_at: event.recorded_at,
      })
    }
    if (event.kind === 'lease.heartbeat') {
      const lease = leases.get(payload.lease_id)
      if (!lease) throw new Error(`heartbeat references unknown lease: ${payload.lease_id}`)
      const attempt = attempts.get(lease.attempt_id)
      if (
        event.actor !== lease.worker_id ||
        !attempt ||
        !ACTIVE_ATTEMPT.has(attempt.state) ||
        event.work_id !== lease.work_id ||
        event.attempt_id !== lease.attempt_id ||
        lease.released_at !== null
      )
        throw new Error('heartbeat lacks active lease-holder authority')
      if (
        Date.parse(lease.expires_at) <= Date.parse(event.recorded_at) ||
        Date.parse(payload.expires_at) <= Date.parse(lease.expires_at)
      )
        throw new Error('heartbeat cannot revive or shorten an expired lease')
      leases.set(payload.lease_id, {
        ...lease,
        heartbeat_at: event.recorded_at,
        expires_at: payload.expires_at,
      })
      if ('phase' in payload) {
        attempts.set(attempt.attempt_id, {
          ...attempt,
          phase_revisions: { ...attempt.phase_revisions, [payload.phase]: payload.code_revision },
          // `code_revision` follows the last phase recorded, so at finish it holds the revision the
          // delivery actually stands on. Set at `attempt.leased` it described the tree the RED
          // phase ran against and then silently stopped being true.
          code_revision: payload.code_revision,
          updated_at: event.recorded_at,
        })
      }
    }
    if (event.kind === 'lease.released') {
      const lease = leases.get(payload.lease_id)
      if (!lease) throw new Error(`release references unknown lease: ${payload.lease_id}`)
      const attempt = attempts.get(lease.attempt_id)
      const precedingTerminalCause = Boolean(
        attempt &&
        !ACTIVE_ATTEMPT.has(attempt.state) &&
        previousEvent?.kind === 'attempt.state' &&
        previousEvent.work_id === lease.work_id &&
        previousEvent.attempt_id === lease.attempt_id &&
        previousEvent.recorded_at === event.recorded_at &&
        previousEvent.actor === event.actor &&
        previousEvent.payload.state === attempt.state &&
        previousEvent.payload.reason === payload.reason,
      )
      const authorizedActor =
        event.actor === lease.worker_id || event.actor === 'runtime-reconciler'
      if (
        !precedingTerminalCause ||
        !authorizedActor ||
        event.work_id !== lease.work_id ||
        event.attempt_id !== lease.attempt_id ||
        lease.released_at !== null
      )
        throw new Error('lease release lacks a preceding terminal holder or reconciler cause')
      leases.set(payload.lease_id, {
        ...lease,
        released_at: event.recorded_at,
        release_reason: payload.reason,
      })
    }
    if (event.kind === 'resume.recorded') {
      if (resumes.has(payload.record.resume_record_id))
        throw new Error(`duplicate resume_record_id: ${payload.record.resume_record_id}`)
      const attempt = attempts.get(payload.record.attempt_id)
      if (
        !attempt ||
        event.work_id !== attempt.work_id ||
        event.attempt_id !== attempt.attempt_id ||
        payload.record.work_id !== attempt.work_id ||
        payload.record.worker_id !== attempt.worker_id ||
        payload.record.repo_id !== attempt.repo_id ||
        payload.record.change_id !== attempt.change_id ||
        payload.record.worktree_id !== attempt.worktree_id ||
        payload.record.worktree_head !== attempt.worktree_head ||
        payload.record.workspace_id !== attempt.workspace_id ||
        payload.record.pane_id !== attempt.pane_id ||
        payload.record.engine !== attempt.engine ||
        payload.record.engine_version !== attempt.engine_version ||
        payload.record.capability_grant_digest !== attempt.capability_grant_digest ||
        payload.record.last_event_offset !== event.sequence - 1 ||
        payload.record.consumed_by_attempt_id !== null ||
        payload.record.recorded_at !== event.recorded_at
      )
        throw new Error('resume record identity mismatch')
      resumes.set(payload.record.resume_record_id, payload.record)
    }
    if (event.kind === 'resume.consumed') {
      const record = resumes.get(payload.resume_record_id)
      if (!record)
        throw new Error(`resume consumption references unknown record: ${payload.resume_record_id}`)
      if (record.consumed_by_attempt_id !== null) {
        throw new Error(`resume record already consumed: ${payload.resume_record_id}`)
      }
      const attempt = attempts.get(event.attempt_id!)
      if (
        !attempt ||
        event.work_id !== record.work_id ||
        attempt.resumes_attempt_id !== record.attempt_id
      ) {
        throw new Error('resume consumption identity mismatch')
      }
      resumes.set(payload.resume_record_id, {
        ...record,
        consumed_by_attempt_id: event.attempt_id,
      })
    }
    if (event.kind === 'pane.attached') {
      if (panes.has(payload.mapping.mapping_id))
        throw new Error(`duplicate mapping_id: ${payload.mapping.mapping_id}`)
      const attempt = attempts.get(payload.mapping.attempt_id)
      const record = resumes.get(payload.mapping.resume_record_id)
      const lease = attempt ? leases.get(attempt.lease_id) : undefined
      if (
        !attempt ||
        !record ||
        payload.mapping.state !== 'attached' ||
        !ACTIVE_ATTEMPT.has(attempt.state) ||
        !lease ||
        lease.released_at !== null ||
        Date.parse(lease.expires_at) <= Date.parse(event.recorded_at) ||
        [...panes.values()].some(
          (mapping) => mapping.attempt_id === attempt.attempt_id && mapping.state !== 'closed',
        ) ||
        event.work_id !== payload.mapping.work_id ||
        event.attempt_id !== payload.mapping.attempt_id ||
        payload.mapping.work_id !== attempt.work_id ||
        attempt.resumes_attempt_id !== record.attempt_id ||
        record.work_id !== attempt.work_id ||
        record.consumed_by_attempt_id !== attempt.attempt_id ||
        payload.mapping.resume_token_digest !== record.resume_token_digest ||
        (attempt.workspace_id !== null && payload.mapping.workspace_id !== attempt.workspace_id) ||
        (attempt.pane_id !== null && payload.mapping.pane_id !== attempt.pane_id) ||
        payload.mapping.attached_at !== event.recorded_at ||
        payload.mapping.updated_at !== event.recorded_at
      ) {
        throw new Error('pane attachment lacks consumed resume lineage')
      }
      panes.set(payload.mapping.mapping_id, payload.mapping)
      attempts.set(attempt.attempt_id, {
        ...attempt,
        workspace_id: payload.mapping.workspace_id,
        pane_id: payload.mapping.pane_id,
        updated_at: event.recorded_at,
      })
    }
    if (event.kind === 'pane.state') {
      const mapping = panes.get(payload.mapping_id)
      if (!mapping) throw new Error(`pane state references unknown mapping: ${payload.mapping_id}`)
      if (event.work_id !== mapping.work_id || event.attempt_id !== mapping.attempt_id)
        throw new Error('pane state identity mismatch')
      const attempt = attempts.get(mapping.attempt_id)
      const lease = attempt ? leases.get(attempt.lease_id) : undefined
      if (event.actor !== 'runtime-reconciler' || mapping.state === 'closed') {
        throw new Error('pane state transition lacks reconciler authority')
      }
      if (
        payload.state === 'reattached' &&
        (!payload.pane_id ||
          !attempt ||
          !ACTIVE_ATTEMPT.has(attempt.state) ||
          !lease ||
          lease.released_at !== null ||
          Date.parse(lease.expires_at) <= Date.parse(event.recorded_at))
      ) {
        throw new Error('pane reattachment requires an active leased attempt')
      }
      if (payload.state === 'closed' && payload.pane_id !== undefined) {
        throw new Error('pane closure cannot replace pane identity')
      }
      panes.set(payload.mapping_id, {
        ...mapping,
        pane_id: payload.pane_id ?? mapping.pane_id,
        state: payload.state,
        updated_at: event.recorded_at,
      })
      if (payload.pane_id) {
        if (attempt) {
          attempts.set(attempt.attempt_id, {
            ...attempt,
            pane_id: payload.pane_id,
            updated_at: event.recorded_at,
          })
        }
      }
    }
    if (event.kind === 'pane.identity') {
      const identity = payload.identity as PaneIdentity
      // MINT ONCE is the whole contract, so both directions are checked: one handle pair never
      // gets a second `pane_ref`, and one `pane_ref` is never claimed by a second handle pair.
      // Without the second check the registry would answer "which pane is this" with two answers.
      if (paneIdentities.has(paneIdentityKey(identity.workspace_handle, identity.pane_handle)))
        throw new Error(`duplicate pane identity for handle: ${identity.pane_handle}`)
      if ([...paneIdentities.values()].some((known) => known.pane_ref === identity.pane_ref))
        throw new Error(`duplicate pane_ref: ${identity.pane_ref}`)
      if (event.work_id !== null || event.attempt_id !== null)
        throw new Error('pane identity event cannot carry work identity')
      if (identity.minted_at !== event.recorded_at)
        throw new Error('pane identity mint time must be the event time')
      paneIdentities.set(paneIdentityKey(identity.workspace_handle, identity.pane_handle), identity)
    }
    if (event.kind === 'message.sent') {
      const message = payload.message as RuntimeMessage
      if (messages.has(message.message_id))
        throw new Error(`duplicate message_id: ${message.message_id}`)
      const work = works.get(message.work_id)
      const grant = [...grants.values()].find(
        (candidate) => candidate.digest === message.capability_grant_digest,
      )
      if (
        !work ||
        event.work_id !== message.work_id ||
        event.attempt_id !== null ||
        !grant ||
        !grant.messaging ||
        grant.worker_id !== message.sender_worker_id
      )
        throw new Error('message authority identity mismatch')
      assertGrantActiveAt(grant, event.recorded_at)
      if (
        message.recorded_at !== event.recorded_at ||
        message.change_id !== work.change_id ||
        (!grant.repositories.includes('*') && !grant.repositories.includes(work.repo_id))
      )
        throw new Error('message canonical context mismatch')
      const child = message.child_work_id === null ? null : works.get(message.child_work_id)
      const delegationType =
        (message.type === 'delegation_request' || message.type === 'delegation_result') &&
        message.child_work_id !== null
      const authoritative = Boolean(
        delegationType &&
        child &&
        grant.child_work_creation &&
        child.parent_work_id === work.work_id &&
        child.repo_id === work.repo_id &&
        child.change_id === work.change_id &&
        child.created_by_grant_digest === grant.digest &&
        message.causation_id !== null &&
        child.causation_id === message.causation_id,
      )
      if (message.authoritative_delegation !== authoritative)
        throw new Error('message delegation authority is not derivable from canonical lineage')
      messages.set(message.message_id, message)
    }
    if (event.kind === 'control.paused' || event.kind === 'control.resumed') {
      const control = payload.control as RuntimePause
      if (event.work_id !== null || event.attempt_id !== null)
        throw new Error('control event cannot carry work identity')
      const grant = [...grants.values()].find(
        (candidate) => candidate.digest === control.grant_digest,
      )
      if (!grant || !grant.pause_resume || grant.worker_id !== control.actor)
        throw new Error('control event lacks canonical grant authority')
      assertGrantActiveAt(grant, event.recorded_at)
      if ((event.kind === 'control.paused') !== control.paused)
        throw new Error('control event discriminator mismatch')
      if (control.scope === 'global' && !grant.global_control)
        throw new Error('global control grant mismatch')
      if (
        control.scope === 'repository' &&
        !grant.repositories.includes('*') &&
        !grant.repositories.includes(control.scope_id)
      )
        throw new Error('repository control grant mismatch')
      if (control.scope === 'initiative' && !grant.initiative_ids.includes(control.scope_id))
        throw new Error('initiative control grant mismatch')
      pauses.set(`${control.scope}:${control.scope_id}`, control)
    }
    if (event.kind === 'trace.observed') {
      if (observations.has(payload.observation.observation_id))
        throw new Error(`duplicate observation_id: ${payload.observation.observation_id}`)
      const attempt = attempts.get(payload.observation.attempt_id)
      if (!attempt || event.work_id !== attempt.work_id || event.attempt_id !== attempt.attempt_id)
        throw new Error('trace observation identity mismatch')
      if (spanIds.has(payload.observation.span_id))
        throw new Error(`duplicate span_id: ${payload.observation.span_id}`)
      spanIds.add(payload.observation.span_id)
      observations.set(payload.observation.observation_id, payload.observation)
    }
  }

  for (const attempt of attempts.values()) {
    const lease = leases.get(attempt.lease_id)
    if (ACTIVE_ATTEMPT.has(attempt.state)) {
      if (!lease || lease.released_at !== null) {
        throw new Error(`active attempt lacks an unreleased lease: ${attempt.attempt_id}`)
      }
      continue
    }
    if (
      attempt.flow_state !== 'ended' ||
      attempt.pending_outcome !== null ||
      !lease ||
      lease.released_at === null
    ) {
      throw new Error(`terminal attempt has incomplete lifecycle closure: ${attempt.attempt_id}`)
    }
  }
  for (const work of works.values()) {
    if (
      (TERMINAL_WORK.has(work.state) || work.state === 'quarantined') &&
      [...attempts.values()].some(
        (attempt) => attempt.work_id === work.work_id && ACTIVE_ATTEMPT.has(attempt.state),
      )
    ) {
      throw new Error(`terminal work retains an active attempt: ${work.work_id}`)
    }
  }
  for (const attempt of attempts.values()) {
    const work = works.get(attempt.work_id)
    if (!work || !ACTIVE_ATTEMPT.has(attempt.state)) continue
    const effectivePause = matchingPauseIn(pauses.values(), work)
    if (attempt.state === 'paused' && !effectivePause) {
      throw new Error(`paused attempt lacks an effective pause: ${attempt.attempt_id}`)
    }
    if (attempt.state === 'running' && effectivePause) {
      throw new Error(`running attempt violates an effective pause: ${attempt.attempt_id}`)
    }
  }
  for (const mapping of panes.values()) {
    const attempt = attempts.get(mapping.attempt_id)
    const record = resumes.get(mapping.resume_record_id)
    if (
      !attempt ||
      !record ||
      record.consumed_by_attempt_id !== attempt.attempt_id ||
      mapping.work_id !== attempt.work_id ||
      mapping.resume_token_digest !== record.resume_token_digest
    ) {
      throw new Error(`pane mapping has incomplete resume lineage: ${mapping.mapping_id}`)
    }
  }

  return {
    events,
    workers: [...workers.values()],
    grants: [...grants.values()],
    engines: [...engines.values()],
    works: [...works.values()],
    attempts: [...attempts.values()],
    leases: [...leases.values()],
    resume_records: [...resumes.values()],
    pane_mappings: [...panes.values()],
    pane_identities: [...paneIdentities.values()],
    messages: [...messages.values()],
    pauses: [...pauses.values()],
    trace_observations: [...observations.values()],
    reopened_since_last_lease: [...reopenedSinceLastLease],
  }
}

export function readRuntimeState(repoRoot: string): RuntimeState {
  const state = foldRuntimeEvents(readRuntimeEvents(repoRoot))
  for (const record of state.resume_records) {
    const attempt = state.attempts.find((candidate) => candidate.attempt_id === record.attempt_id)
    if (!attempt) throw new Error(`resume record references unknown attempt: ${record.attempt_id}`)
    assertCanonicalResumeRecord(repoRoot, state, attempt, record)
  }
  return state
}

function validateWorkerProfile(profile: WorkerProfile): void {
  assertExactKeys('worker profile', profile, [
    'artifact_type',
    'schema_version',
    'worker_id',
    'name',
    'role',
    'capabilities',
    'allowed_repositories',
    'allowed_folders',
    'delegation_grants',
    'messaging_grants',
    'routine_triggers',
    'default_engines',
    'evidence_policy',
    'verification_policy',
    'registered_at',
  ])
  if (profile.artifact_type !== 'worker.profile' || profile.schema_version !== 1) {
    throw new Error('worker profile contract version mismatch')
  }
  requirePattern('worker_id', profile.worker_id, WORKER_ID)
  requireNonEmptyString('worker name', profile.name)
  requireNonEmptyString('worker role', profile.role)
  requireStringList('worker capabilities', profile.capabilities, 1)
  requireStringList('worker allowed_repositories', profile.allowed_repositories, 1)
  requireStringList('worker allowed_folders', profile.allowed_folders)
  requireStringList('worker delegation_grants', profile.delegation_grants)
  requireStringList('worker messaging_grants', profile.messaging_grants)
  requireStringList('worker routine_triggers', profile.routine_triggers)
  if (!Array.isArray(profile.default_engines) || profile.default_engines.length === 0) {
    throw new Error('worker default_engines must contain at least one engine')
  }
  for (const defaultEngine of profile.default_engines) {
    const engine = requireRecord('worker default engine', defaultEngine)
    assertExactKeys('worker default engine', engine, ['engine', 'version'])
    requireNonEmptyString('worker default engine', engine.engine)
    requireNonEmptyString('worker default engine version', engine.version)
  }
  requireNonEmptyString('worker evidence_policy', profile.evidence_policy)
  requireNonEmptyString('worker verification_policy', profile.verification_policy)
  iso(profile.registered_at)
  validateSafePayload(profile as unknown as Record<string, unknown>)
}

export function registerWorkerProfile(repoRoot: string, profile: WorkerProfile): WorkerProfile {
  validateWorkerProfile(profile)
  return mutateRuntime(repoRoot, (state) => {
    const current = state.workers.find((worker) => worker.worker_id === profile.worker_id)
    if (current) {
      if (canonical(current) !== canonical(profile)) {
        throw new Error(`worker profile is immutable: ${profile.worker_id}`)
      }
      return { value: current, events: [] }
    }
    return {
      value: profile,
      events: [
        makeEvent({
          kind: 'worker.registered',
          actor: 'flow-controller',
          recordedAt: profile.registered_at,
          payload: { profile },
        }),
      ],
    }
  })
}

export function capabilityGrantDigest(grant: Omit<CapabilityGrant, 'digest'>): RuntimeDigest {
  return runtimeDigest(grant)
}

function validateGrant(grant: CapabilityGrant): void {
  assertExactKeys('capability grant', grant, [
    'grant_id',
    'worker_id',
    'repositories',
    'folders',
    'tools',
    'network',
    'credentials',
    'child_work_creation',
    'messaging',
    'pause_resume',
    'global_control',
    'initiative_ids',
    'issued_at',
    'expires_at',
    'digest',
  ])
  requirePattern('grant_id', grant.grant_id, /^grt_[A-Za-z0-9]+$/)
  requirePattern('worker_id', grant.worker_id, WORKER_ID)
  requireDigest('grant digest', grant.digest)
  const { digest: _, ...body } = grant
  if (capabilityGrantDigest(body) !== grant.digest)
    throw new Error('capability grant digest mismatch')
  iso(grant.issued_at)
  if (grant.expires_at !== null) iso(grant.expires_at)
  requireStringList('grant repositories', grant.repositories)
  requireStringList('grant folders', grant.folders)
  requireStringList('grant tools', grant.tools)
  requireStringList('grant network', grant.network)
  requireStringList('grant credentials', grant.credentials)
  requireStringList('grant initiative_ids', grant.initiative_ids)
  if (grant.repositories.length === 0 || grant.folders.length === 0) {
    throw new Error('grant repository and folder scopes are required')
  }
  for (const field of [
    grant.child_work_creation,
    grant.messaging,
    grant.pause_resume,
    grant.global_control,
  ]) {
    if (typeof field !== 'boolean') throw new Error('grant control fields must be boolean')
  }
}

function normalizeScopeFolder(value: string | null | undefined): string {
  const folder = (value ?? '.').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '') || '.'
  if (folder.startsWith('/') || folder.split('/').includes('..')) {
    throw new Error(`attempt scope folder must be repository-relative: ${value}`)
  }
  return folder
}

function folderScopesCover(folders: string[], folder: string): boolean {
  return folders.some((candidate) => {
    const allowed = normalizeScopeFolder(candidate)
    return (
      allowed === '.' || allowed === '*' || allowed === folder || folder.startsWith(`${allowed}/`)
    )
  })
}

export function registerCapabilityGrant(repoRoot: string, grant: CapabilityGrant): CapabilityGrant {
  validateGrant(grant)
  assertTrustedTimestamp(grant.issued_at)
  return mutateRuntime(repoRoot, (state) => {
    assertGrantActiveAt(grant, trustedAuthorizationTimestamp())
    if (!state.workers.some((worker) => worker.worker_id === grant.worker_id)) {
      throw new Error(`capability grant references unknown worker: ${grant.worker_id}`)
    }
    const current = state.grants.find((candidate) => candidate.grant_id === grant.grant_id)
    if (current) {
      if (canonical(current) !== canonical(grant))
        throw new Error(`grant is immutable: ${grant.grant_id}`)
      return { value: current, events: [] }
    }
    return {
      value: grant,
      events: [
        makeEvent({
          kind: 'grant.registered',
          actor: 'flow-controller',
          recordedAt: grant.issued_at,
          payload: { grant },
        }),
      ],
    }
  })
}

function validateEngine(engine: RuntimeEngine): void {
  assertExactKeys('runtime engine', engine, [
    'artifact_type',
    'schema_version',
    'engine',
    'path',
    'version',
    'health',
    'ownership',
    'structured_output',
    'resume_capability',
    'incompatibilities',
    'validated_at',
  ])
  if (engine.artifact_type !== 'runtime.engine' || engine.schema_version !== 1) {
    throw new Error('runtime engine contract version mismatch')
  }
  requirePattern('engine', engine.engine, SAFE_ID)
  requireNonEmptyString('runtime engine path', engine.path)
  requireNonEmptyString('runtime engine version', engine.version)
  if (!['healthy', 'degraded', 'unavailable'].includes(engine.health)) {
    throw new Error('invalid runtime engine health')
  }
  if (!['clade-managed', 'user-managed'].includes(engine.ownership)) {
    throw new Error('invalid runtime engine ownership')
  }
  if (
    typeof engine.structured_output !== 'boolean' ||
    typeof engine.resume_capability !== 'boolean'
  ) {
    throw new Error('runtime engine capability flags must be boolean')
  }
  requireStringList('runtime engine incompatibilities', engine.incompatibilities)
  iso(engine.validated_at)
}

export function reconcileRuntimeEngine(repoRoot: string, engine: RuntimeEngine): RuntimeEngine {
  validateEngine(engine)
  return mutateRuntime(repoRoot, (state) => {
    const current = state.engines.find((candidate) => candidate.engine === engine.engine)
    if (current?.ownership === 'user-managed' && canonical(current) !== canonical(engine)) {
      throw new Error(`user-managed runtime cannot be overwritten: ${engine.engine}`)
    }
    if (
      current?.ownership === 'clade-managed' &&
      (current.path !== engine.path || current.version !== engine.version) &&
      engine.health !== 'healthy'
    ) {
      throw new Error('clade-managed runtime updates require a healthy compatibility validation')
    }
    if (current && canonical(current) === canonical(engine)) return { value: current, events: [] }
    return {
      value: engine,
      events: [
        makeEvent({
          kind: 'engine.registered',
          actor: 'runtime-reconciler',
          recordedAt: engine.validated_at,
          payload: { engine },
        }),
      ],
    }
  })
}

export function ensureRuntimeWork(input: {
  repoRoot: string
  workId: string
  repoId: string
  changeId: string
  initiativeId?: string | null
  parentWorkId?: string | null
  createdByGrantDigest?: RuntimeDigest | null
  causationId?: string | null
  retryLimit?: number
  actor?: string
  now?: string | Date
}): RuntimeWork {
  const workId = requirePattern('work_id', input.workId, WORK_ID)
  const changeId = requirePattern('change_id', input.changeId, CHANGE_ID)
  // §10.6 item 2: a control-plane change whose binding is not durable refuses **every**
  // adapter operation, `work.created` included — and this is that write entry. The check is
  // here rather than in the adapter because this function is exported and directly callable;
  // gating only the adapter would leave the journal reachable around the side of the gate.
  //
  // It runs before `mutateRuntime` on purpose: refusing must not take the journal lock, so a
  // refusal cannot serialize behind, or interfere with, a healthy writer.
  assertBindingCommittedIfGoverned(input.repoRoot, changeId)
  const recordedAt = iso(input.now)
  return mutateRuntime(input.repoRoot, (state) => {
    const authorizationAt = trustedAuthorizationTimestamp()
    if (input.parentWorkId) {
      const parent = state.works.find((candidate) => candidate.work_id === input.parentWorkId)
      const grant = state.grants.find(
        (candidate) => candidate.digest === input.createdByGrantDigest,
      )
      const request = input.causationId
        ? state.messages.find((candidate) => candidate.message_id === input.causationId)
        : undefined
      if (
        !parent ||
        parent.repo_id !== input.repoId ||
        parent.change_id !== changeId ||
        parent.initiative_id !== (input.initiativeId ?? null) ||
        !grant ||
        !grant.child_work_creation ||
        (!grant.repositories.includes(input.repoId) && !grant.repositories.includes('*')) ||
        ((input.initiativeId ?? null) !== null &&
          grant.initiative_ids.length > 0 &&
          !grant.initiative_ids.includes(input.initiativeId!)) ||
        !request ||
        request.type !== 'delegation_request' ||
        request.work_id !== parent.work_id ||
        request.change_id !== parent.change_id ||
        request.child_work_id !== workId ||
        request.capability_grant_digest !== grant.digest ||
        request.sender_worker_id !== grant.worker_id
      ) {
        throw new Error('child work requires canonical delegation request lineage')
      }
      assertGrantActiveAt(grant, authorizationAt)
    } else if (input.createdByGrantDigest || input.causationId) {
      throw new Error('child-work grant and causation require parentWorkId')
    }
    const current = state.works.find((work) => work.work_id === workId)
    const retryLimit = input.retryLimit ?? current?.retry_limit ?? 2
    if (!Number.isInteger(retryLimit) || retryLimit < 0) throw new Error('retryLimit must be >= 0')
    if (current) {
      if (
        current.repo_id !== input.repoId ||
        current.change_id !== changeId ||
        current.initiative_id !== (input.initiativeId ?? null) ||
        current.parent_work_id !== (input.parentWorkId ?? null) ||
        current.created_by_grant_digest !== (input.createdByGrantDigest ?? null) ||
        current.causation_id !== (input.causationId ?? null) ||
        current.retry_limit !== retryLimit
      ) {
        throw new Error(`runtime work identity is immutable: ${workId}`)
      }
      return { value: current, events: [] }
    }
    const work: RuntimeWork = {
      work_id: workId,
      repo_id: input.repoId,
      change_id: changeId,
      initiative_id: input.initiativeId ?? null,
      parent_work_id: input.parentWorkId ?? null,
      created_by_grant_digest: input.createdByGrantDigest ?? null,
      causation_id: input.causationId ?? null,
      state: 'created',
      retry_limit: retryLimit,
      handover_count: 0,
      reopen_count: 0,
      created_at: recordedAt,
      updated_at: recordedAt,
    }
    return {
      value: { ...work, state: 'queued', updated_at: recordedAt },
      events: [
        makeEvent({
          kind: 'work.created',
          actor: input.actor ?? 'flow-controller',
          recordedAt,
          workId,
          payload: { work },
        }),
        makeEvent({
          kind: 'work.state',
          actor: input.actor ?? 'flow-controller',
          recordedAt,
          workId,
          payload: { from: 'created', state: 'queued', reason: 'work materialized' },
        }),
      ],
    }
  })
}

function matchingPauseIn(
  pauses: Iterable<RuntimePause>,
  work: RuntimeWork,
): RuntimePause | undefined {
  return [...pauses].find(
    (pause) =>
      pause.paused &&
      (pause.scope === 'global' ||
        (pause.scope === 'repository' && pause.scope_id === work.repo_id) ||
        (pause.scope === 'initiative' && pause.scope_id === work.initiative_id)),
  )
}

function matchingPause(state: RuntimeState, work: RuntimeWork): RuntimePause | undefined {
  return matchingPauseIn(state.pauses, work)
}

function validateAttemptAdmission(
  repoRoot: string,
  state: RuntimeState,
  input: {
    workId: string
    workerId: string
    engine: string
    engineVersion: string
    capabilityGrantDigest: RuntimeDigest
    resumesAttemptId?: string | null
    resumeRecordId?: string | null
    resumeToken?: string | null
    resumeOpsxArtifactDigest?: RuntimeDigest | null
    resumeCheckpointIds?: string[] | null
    resumeEvidenceIds?: string[] | null
    worktreeId?: string | null
    worktreeHead?: string | null
    scopeFolder?: string | null
    initiativeId?: string | null
    attemptId?: string | null
    supersedesAttemptId?: string | null
  },
): RuntimeWork {
  const work = state.works.find((candidate) => candidate.work_id === input.workId)
  if (!work) throw new Error(`runtime work is not materialized: ${input.workId}`)
  if (work.state !== 'queued' && work.state !== 'retry_wait') {
    throw new Error(`work ${input.workId} cannot lease from state ${work.state}`)
  }
  const pause = matchingPause(state, work)
  if (pause) throw new Error(`runtime is paused by ${pause.scope}:${pause.scope_id}`)
  const worker = state.workers.find((candidate) => candidate.worker_id === input.workerId)
  if (!worker) throw new Error(`unknown worker profile: ${input.workerId}`)
  if (
    !worker.allowed_repositories.includes(work.repo_id) &&
    !worker.allowed_repositories.includes('*')
  ) {
    throw new Error(`worker ${input.workerId} is not allowed in repository ${work.repo_id}`)
  }
  const scopeFolder = normalizeScopeFolder(input.scopeFolder)
  if (!folderScopesCover(worker.allowed_folders, scopeFolder)) {
    throw new Error(`worker ${input.workerId} is not allowed in folder ${scopeFolder}`)
  }
  const engine = state.engines.find((candidate) => candidate.engine === input.engine)
  if (!engine || engine.version !== input.engineVersion || engine.health === 'unavailable') {
    throw new Error(`runtime engine is not validated at ${input.engine}@${input.engineVersion}`)
  }
  const grant = state.grants.find((candidate) => candidate.digest === input.capabilityGrantDigest)
  if (!grant || grant.worker_id !== input.workerId)
    throw new Error('attempt capability grant is unknown')
  assertGrantActiveAt(grant, trustedAuthorizationTimestamp())
  if (!grant.repositories.includes(work.repo_id) && !grant.repositories.includes('*')) {
    throw new Error(`attempt capability grant does not cover repository ${work.repo_id}`)
  }
  if (!folderScopesCover(grant.folders, scopeFolder)) {
    throw new Error(`attempt capability grant does not cover folder ${scopeFolder}`)
  }
  if (state.leases.some((lease) => lease.work_id === input.workId && lease.released_at === null)) {
    throw new Error(`work already has an unreconciled lease: ${input.workId}`)
  }
  if (input.attemptId && state.attempts.some((attempt) => attempt.attempt_id === input.attemptId)) {
    throw new Error(`duplicate attempt_id: ${input.attemptId}`)
  }
  if (input.initiativeId !== undefined && input.initiativeId !== work.initiative_id) {
    throw new Error('attempt initiative does not match runtime work')
  }
  if (input.supersedesAttemptId) {
    const superseded = state.attempts.find(
      (candidate) => candidate.attempt_id === input.supersedesAttemptId,
    )
    if (
      !superseded ||
      superseded.work_id !== work.work_id ||
      ACTIVE_ATTEMPT.has(superseded.state)
    ) {
      throw new Error('supersession must reference a terminal attempt for the same work')
    }
  }
  if (input.resumesAttemptId) {
    const previous = state.attempts.find(
      (candidate) => candidate.attempt_id === input.resumesAttemptId,
    )
    if (!previous || previous.work_id !== input.workId)
      throw new Error('resume link must reference the same work')
    const latestAttempt = state.attempts.findLast((candidate) => candidate.work_id === input.workId)
    if (latestAttempt?.attempt_id !== previous.attempt_id) {
      throw new Error('resume link must reference the latest attempt for the work')
    }
    if (!input.resumeRecordId || !input.resumeToken || !input.worktreeId || !input.worktreeHead) {
      throw new Error('resume admission requires record, token, worktree, and HEAD')
    }
    const record = state.resume_records.find(
      (candidate) => candidate.resume_record_id === input.resumeRecordId,
    )
    if (!record || record.attempt_id !== previous.attempt_id || record.work_id !== work.work_id) {
      throw new Error('resume record does not match the previous attempt')
    }
    if (record.consumed_by_attempt_id !== null) throw new Error('resume record is already consumed')
    if (record.resume_token_digest !== runtimeDigest(input.resumeToken)) {
      throw new Error('resume token does not match the resume record')
    }
    assertCanonicalResumeRecord(repoRoot, state, previous, record)
    if (
      record.worker_id !== input.workerId ||
      record.repo_id !== work.repo_id ||
      record.change_id !== work.change_id ||
      record.engine !== input.engine ||
      record.engine_version !== input.engineVersion ||
      record.capability_grant_digest !== input.capabilityGrantDigest ||
      (input.resumeOpsxArtifactDigest !== undefined &&
        input.resumeOpsxArtifactDigest !== null &&
        record.opsx_artifact_digest !== input.resumeOpsxArtifactDigest) ||
      (input.resumeCheckpointIds !== undefined &&
        input.resumeCheckpointIds !== null &&
        canonical(record.checkpoint_ids.toSorted()) !==
          canonical(input.resumeCheckpointIds.toSorted())) ||
      (input.resumeEvidenceIds !== undefined &&
        input.resumeEvidenceIds !== null &&
        canonical(record.evidence_ids.toSorted()) !==
          canonical(input.resumeEvidenceIds.toSorted())) ||
      record.worktree_id !== input.worktreeId ||
      input.worktreeHead !== record.worktree_head ||
      record.last_event_offset > state.events.length
    ) {
      throw new Error('resume record context does not match attempt admission')
    }
    if (!engine.resume_capability) throw new Error('runtime engine does not support resume')
    const sameWorkTail = state.events
      .slice(record.last_event_offset)
      .filter((event) => event.work_id === work.work_id)
    const recoveryKinds = new Set([
      'attempt.state',
      'attempt.flow',
      // The one recovery kind this set was missing. It is how EVERY writer here ends the flow of an
      // attempt that stopped without a verdict — the orphan reconciler, the unbound-attempt branch,
      // and the relay handoff — so a resume record could never survive the very events that make a
      // resume necessary. Added 2026-09-02 with rule 8; before it, a handed-off attempt's successor
      // was refused with `resume record cursor is stale`.
      'attempt.flow_recovered',
      'lease.released',
      'pane.state',
      'work.state',
    ])
    if (
      sameWorkTail.some(
        (event) =>
          !(
            (event.kind === 'resume.recorded' &&
              event.payload.record.resume_record_id === record.resume_record_id) ||
            (event.attempt_id === previous.attempt_id && recoveryKinds.has(event.kind))
          ),
      )
    ) {
      throw new Error('resume record cursor is stale for current canonical work facts')
    }
  } else if (
    input.resumeRecordId ||
    input.resumeToken ||
    input.resumeOpsxArtifactDigest ||
    input.resumeCheckpointIds ||
    input.resumeEvidenceIds
  ) {
    throw new Error('resume record/token require resumesAttemptId')
  }
  const priorAttempts = state.attempts.filter((attempt) => attempt.work_id === input.workId)
  const causalLinks = [input.resumesAttemptId, input.supersedesAttemptId].filter(Boolean)
  // A reopen IS the causality (ruling (m)), and it lives on the work rather than on any attempt.
  // The link rule exists so that a second attempt always says why it exists; after a reopen the
  // answer is the `work.reopened` event, and demanding a link anyway would force the caller to
  // name the succeeded attempt as resumed or superseded — neither of which it is. Its receipt
  // stays valid history that a later one supersedes by being read, not by being overwritten.
  //
  // READ off the fold (`reopened_since_last_lease`), NEVER re-derived here. The obvious local
  // derivation — is there a `work.reopened` at or after the last attempt's `started_at` — answers a
  // different question the moment the two land in the same millisecond, because the fold reads
  // event ORDER and a timestamp comparison reads the clock. When they disagree the work has no
  // legal attempt shape at all: admission demands a causal link the fold refuses, or the reverse,
  // and it sits in `queued` forever.
  const reopenedSinceLastAttempt = state.reopened_since_last_lease.includes(input.workId)
  const requiredLinks = priorAttempts.length === 0 || reopenedSinceLastAttempt ? 0 : 1
  if (causalLinks.length !== requiredLinks) {
    throw new Error(
      requiredLinks === 0
        ? 'the first attempt after a reopen carries no causal link; the reopen is the causality'
        : 'attempt must have exactly one causal link after the first attempt',
    )
  }
  return work
}

/**
 * Reopen a `done` work item so it can be executed again (plan section 10.6 ruling (m)).
 *
 * `done` is left by exactly one event, and this is its only emitter. Two causes, and they are not
 * interchangeable:
 *
 * - `revision` — the requirement this work delivered has moved, so what it delivered no longer
 *   answers the current intent. Emitted by `reviseOpsxChange` for every required work whose
 *   requirement stepped, carrying the revision commit as its causality.
 * - `evidence_insufficient` — the requirement is unchanged, but readiness judged the receipts on
 *   record insufficient under `required_work_terminal_with_current_evidence`. Emitted explicitly,
 *   carrying the receipt ids the judgement was made on (an empty list is legitimate: "no receipt at
 *   all" is precisely the shape <consumer-h>'s `W-2026-09-02-wsp-leavesubmitguard` had, driven to `done`
 *   by a RED-only attempt).
 *
 * What it deliberately does NOT do: mint a second work item for the same work spec (`materializeWork`
 * refuses that, and ruling (m) keeps it refusing), and reset `retry_limit`. Reopening is not free
 * retries — a work item that has spent its retries reopens with none left, and that is the honest
 * reading: the reason it needs running again is not that its attempts failed.
 */
export function reopenRuntimeWork(input: {
  repoRoot: string
  workId: string
  cause: ReopenCause
  reason: string
  /** Required for `cause: 'revision'`: the commit that moved the requirement. */
  revisionCommit?: string | null
  /** For `cause: 'revision'`: the revision the requirement moved TO. See the payload validator. */
  requirementRevision?: number | null
  /** Required for `cause: 'evidence_insufficient'`: the receipts readiness judged. */
  receiptIds?: string[] | null
  /**
   * Write the same fact on the flow spine, returning whether it landed.
   *
   * Called INSIDE the mutation, after every precondition has passed and before the journal events
   * are built, so that `spine_written: false` can be recorded on the runtime event itself rather
   * than reported to a caller that may not look. Two ledgers, one fact (TD-884): the spine is where
   * every read side asks whether a work item is finished, so a reopen that only reached the runtime
   * leaves `/board`, `flow ask` and the projector all reading a standing `work.done`.
   *
   * Ordering is deliberate and is the lesser of two exposures. Spine-first can leave a spine reopen
   * behind if the journal append then fails; runtime-first cannot record whether the spine write
   * succeeded, and a fail-open telemetry write that nothing can observe is the failure this
   * parameter exists to end. `mutateRuntime` runs its callback exactly once inside the lock, so
   * this is never invoked twice for one reopen.
   */
  recordOnSpine?: () => boolean
  actor?: string
  now?: string | Date
}): RuntimeWork {
  const workId = requirePattern('work_id', input.workId, WORK_ID)
  const recordedAt = iso(input.now)
  if (!REOPEN_CAUSES.includes(input.cause)) {
    throw new Error(`invalid work reopen cause: ${String(input.cause)}`)
  }
  requireNonEmptyString('work reopen reason', input.reason)
  return mutateRuntime(input.repoRoot, (state) => {
    const work = state.works.find((candidate) => candidate.work_id === workId)
    if (!work) throw new Error(`unknown runtime work: ${workId}`)
    if (work.state !== 'done') {
      throw new Error(`only a done work item can be reopened, ${workId} is ${work.state}`)
    }
    const reopenCount = work.reopen_count + 1
    const spineWritten = input.recordOnSpine ? input.recordOnSpine() : true
    const payload: Record<string, unknown> =
      input.cause === 'revision'
        ? {
            cause: input.cause,
            reopen_count: reopenCount,
            reason: input.reason,
            revision_commit: input.revisionCommit,
            ...(input.requirementRevision === undefined || input.requirementRevision === null
              ? {}
              : { requirement_revision: input.requirementRevision }),
          }
        : {
            cause: input.cause,
            reopen_count: reopenCount,
            reason: input.reason,
            readiness_predicate: EVIDENCE_READINESS_PREDICATE,
            receipt_ids: [...(input.receiptIds ?? [])],
          }
    // Only when it FAILED. A `spine_written: true` on every reopen would be a field nobody reads;
    // the absence of this one is the normal case, and its presence is the incident.
    if (!spineWritten) payload.spine_written = false
    const actor = input.actor ?? 'flow-controller'
    return {
      value: { ...work, state: 'queued', reopen_count: reopenCount, updated_at: recordedAt },
      events: [
        makeEvent({ kind: 'work.reopened', actor, recordedAt, workId, payload }),
        // Same instant, immediately after: the fold matches on exactly that adjacency, so these
        // two are one write or neither. `mutateRuntime` appends the batch atomically.
        makeEvent({
          kind: 'work.state',
          actor,
          recordedAt,
          workId,
          payload: { from: 'done', state: 'queued', reason: `reopened: ${input.cause}` },
        }),
      ],
    }
  })
}

export function assertRuntimeAttemptCanStart(input: {
  repoRoot: string
  workId: string
  workerId: string
  engine: string
  engineVersion: string
  capabilityGrantDigest: RuntimeDigest
  resumesAttemptId?: string | null
  resumeRecordId?: string | null
  resumeToken?: string | null
  resumeOpsxArtifactDigest?: RuntimeDigest | null
  resumeCheckpointIds?: string[] | null
  resumeEvidenceIds?: string[] | null
  worktreeId?: string | null
  worktreeHead?: string | null
  scopeFolder?: string | null
  attemptId?: string | null
  supersedesAttemptId?: string | null
  now?: string | Date
}): void {
  iso(input.now)
  validateAttemptAdmission(input.repoRoot, readRuntimeState(input.repoRoot), input)
}

export function beginRuntimeAttempt(input: {
  repoRoot: string
  workId: string
  workerId: string
  engine: string
  engineVersion: string
  capabilityGrantDigest: RuntimeDigest
  rootSpanId: string
  attemptId?: string
  leaseId?: string
  traceId?: string
  leaseDurationMs?: number
  scopeFolder?: string | null
  worktreeId?: string | null
  worktreeHead?: string | null
  workspaceId?: string | null
  paneId?: string | null
  initiativeId?: string | null
  requirementId?: string | null
  requirementRevision?: number | null
  scenarioId?: string | null
  codeRevision?: string | null
  intentRevision?: number | null
  resumesAttemptId?: string | null
  resumeRecordId?: string | null
  resumeToken?: string | null
  resumeOpsxArtifactDigest?: RuntimeDigest | null
  resumeCheckpointIds?: string[] | null
  resumeEvidenceIds?: string[] | null
  supersedesAttemptId?: string | null
  actor?: string
  now?: string | Date
}): RuntimeAttempt {
  const workId = requirePattern('work_id', input.workId, WORK_ID)
  const workerId = requirePattern('worker_id', input.workerId, WORKER_ID)
  const attemptId = requirePattern('attempt_id', input.attemptId ?? opaque('att'), ATTEMPT_ID)
  const leaseId = requirePattern('lease_id', input.leaseId ?? opaque('lse'), /^lse_[A-Za-z0-9]+$/)
  const rootTraceId = requirePattern(
    'trace_id',
    input.traceId ?? randomUUID().replaceAll('-', ''),
    /^[0-9a-f]{32}$/,
  )
  const rootSpanId = requirePattern('root span_id', input.rootSpanId, /^[0-9a-f]{16}$/)
  const grantDigest = requireDigest('capability grant digest', input.capabilityGrantDigest)
  const recordedAt = iso(input.now)
  const leaseDurationMs = input.leaseDurationMs ?? 60_000
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
    throw new Error('leaseDurationMs must be a positive integer')
  }
  return mutateRuntime(input.repoRoot, (state) => {
    const work = validateAttemptAdmission(input.repoRoot, state, {
      workId,
      workerId,
      engine: input.engine,
      engineVersion: input.engineVersion,
      capabilityGrantDigest: grantDigest,
      resumesAttemptId: input.resumesAttemptId,
      resumeRecordId: input.resumeRecordId,
      resumeToken: input.resumeToken,
      resumeOpsxArtifactDigest: input.resumeOpsxArtifactDigest,
      resumeCheckpointIds: input.resumeCheckpointIds,
      resumeEvidenceIds: input.resumeEvidenceIds,
      worktreeId: input.worktreeId,
      worktreeHead: input.worktreeHead,
      scopeFolder: input.scopeFolder,
      initiativeId: input.initiativeId,
      attemptId,
      supersedesAttemptId: input.supersedesAttemptId,
    })
    if (state.attempts.some((candidate) => candidate.attempt_id === attemptId)) {
      throw new Error(`duplicate attempt_id: ${attemptId}`)
    }
    if (state.leases.some((candidate) => candidate.lease_id === leaseId)) {
      throw new Error(`duplicate lease_id: ${leaseId}`)
    }
    if (state.attempts.some((candidate) => candidate.root_trace_id === rootTraceId)) {
      throw new Error(`duplicate root_trace_id: ${rootTraceId}`)
    }
    if (
      state.attempts.some((candidate) => candidate.root_span_id === rootSpanId) ||
      state.trace_observations.some((candidate) => candidate.span_id === rootSpanId)
    ) {
      throw new Error(`duplicate span_id: ${rootSpanId}`)
    }
    const lease: RuntimeLease = {
      lease_id: leaseId,
      work_id: workId,
      attempt_id: attemptId,
      worker_id: workerId,
      acquired_at: recordedAt,
      heartbeat_at: recordedAt,
      expires_at: new Date(Date.parse(recordedAt) + leaseDurationMs).toISOString(),
      released_at: null,
      release_reason: null,
    }
    const attempt: RuntimeAttempt = {
      attempt_id: attemptId,
      work_id: workId,
      worker_id: workerId,
      repo_id: work.repo_id,
      change_id: work.change_id,
      engine: input.engine,
      engine_version: input.engineVersion,
      scope_folder: normalizeScopeFolder(input.scopeFolder),
      worktree_id: input.worktreeId ?? null,
      worktree_head: input.worktreeHead ?? null,
      workspace_id: input.workspaceId ?? null,
      pane_id: input.paneId ?? null,
      lease_id: leaseId,
      root_trace_id: rootTraceId,
      root_span_id: rootSpanId,
      capability_grant_digest: grantDigest,
      initiative_id: input.initiativeId ?? work.initiative_id,
      requirement_id: input.requirementId ?? null,
      requirement_revision: input.requirementRevision ?? null,
      scenario_id: input.scenarioId ?? null,
      code_revision: input.codeRevision ?? null,
      phase_revisions: {},
      intent_revision: input.intentRevision ?? null,
      resumes_attempt_id: input.resumesAttemptId ?? null,
      supersedes_attempt_id: input.supersedesAttemptId ?? null,
      flow_state: 'pending_start',
      pending_outcome: null,
      state: 'running',
      started_at: recordedAt,
      updated_at: recordedAt,
    }
    return {
      value: attempt,
      events: [
        makeEvent({
          kind: 'attempt.leased',
          actor: input.actor ?? workerId,
          recordedAt,
          workId,
          attemptId,
          payload: { attempt: { ...attempt, state: 'leased' }, lease },
        }),
        makeEvent({
          kind: 'work.state',
          actor: input.actor ?? workerId,
          recordedAt,
          workId,
          attemptId,
          payload: { from: work.state, state: 'leased', reason: 'lease acquired' },
        }),
        makeEvent({
          kind: 'attempt.state',
          actor: input.actor ?? workerId,
          recordedAt,
          workId,
          attemptId,
          payload: { from: 'leased', state: 'running', reason: 'attempt started' },
        }),
        ...(input.resumeRecordId
          ? [
              makeEvent({
                kind: 'resume.consumed',
                actor: input.actor ?? workerId,
                recordedAt,
                workId,
                attemptId,
                payload: { resume_record_id: input.resumeRecordId },
              }),
            ]
          : []),
        makeEvent({
          kind: 'work.state',
          actor: input.actor ?? workerId,
          recordedAt,
          workId,
          attemptId,
          payload: { from: 'leased', state: 'running', reason: 'attempt started' },
        }),
      ],
    }
  })
}

export function markRuntimeFlowStarted(input: {
  repoRoot: string
  attemptId: string
  actor?: string
  now?: string | Date
}): RuntimeAttempt {
  const recordedAt = iso(input.now)
  return mutateRuntime(input.repoRoot, (state) => {
    const attempt = state.attempts.find((candidate) => candidate.attempt_id === input.attemptId)
    if (!attempt || attempt.flow_state !== 'pending_start') {
      throw new Error(`attempt is not waiting for flow start: ${input.attemptId}`)
    }
    return {
      value: { ...attempt, flow_state: 'started', updated_at: recordedAt },
      events: [
        makeEvent({
          kind: 'attempt.flow',
          actor: input.actor ?? attempt.worker_id,
          recordedAt,
          workId: attempt.work_id,
          attemptId: attempt.attempt_id,
          payload: { from: 'pending_start', state: 'started', pending_outcome: null },
        }),
      ],
    }
  })
}

export function prepareRuntimeAttemptFinish(input: {
  repoRoot: string
  attemptId: string
  outcome: 'ok' | 'fail' | 'blocked' | 'cancelled' | 'superseded'
  actor?: string
  now?: string | Date
}): RuntimeAttempt {
  const recordedAt = iso(input.now)
  return mutateRuntime(input.repoRoot, (state) => {
    const authorizationAt = trustedAuthorizationTimestamp()
    const attempt = state.attempts.find((candidate) => candidate.attempt_id === input.attemptId)
    if (!attempt || attempt.state !== 'running' || attempt.flow_state !== 'started') {
      throw new Error(`attempt is not ready for flow end: ${input.attemptId}`)
    }
    const lease = state.leases.find((candidate) => candidate.lease_id === attempt.lease_id)
    if (
      !lease ||
      lease.released_at !== null ||
      Date.parse(lease.expires_at) <= Date.parse(authorizationAt)
    ) {
      throw new Error(`attempt lease is not active at finish prepare: ${input.attemptId}`)
    }
    return {
      value: {
        ...attempt,
        flow_state: 'pending_end',
        pending_outcome: input.outcome,
        updated_at: recordedAt,
      },
      events: [
        makeEvent({
          kind: 'attempt.flow',
          actor: input.actor ?? attempt.worker_id,
          recordedAt,
          workId: attempt.work_id,
          attemptId: attempt.attempt_id,
          payload: { from: 'started', state: 'pending_end', pending_outcome: input.outcome },
        }),
      ],
    }
  })
}

/**
 * Extend an attempt's lease, optionally recording the verification phase it just crossed into.
 *
 * The phase arguments are how ruling 5b's "one attempt, three phases" becomes readable: RED, GREEN
 * and mutation run under one lease, and the heartbeat between them is already the message that says
 * the attempt is still alive. Passing `phase` without `codeRevision` is refused — see the payload
 * validator for why.
 */
export function heartbeatRuntimeAttempt(input: {
  repoRoot: string
  attemptId: string
  leaseDurationMs?: number
  /** The verification phase this heartbeat opens; requires `codeRevision`. */
  phase?: VerificationPhase
  /** The code revision that phase runs against; requires `phase`. */
  codeRevision?: string
  actor?: string
  now?: string | Date
}): RuntimeLease {
  const attemptId = requirePattern('attempt_id', input.attemptId, ATTEMPT_ID)
  const recordedAt = iso(input.now)
  const leaseDurationMs = input.leaseDurationMs ?? 60_000
  return mutateRuntime(input.repoRoot, (state) => {
    const authorizationAt = trustedAuthorizationTimestamp()
    const attempt = state.attempts.find((candidate) => candidate.attempt_id === attemptId)
    if (!attempt || !ACTIVE_ATTEMPT.has(attempt.state)) {
      throw new Error(`attempt is not heartbeatable: ${attemptId}`)
    }
    const lease = state.leases.find((candidate) => candidate.lease_id === attempt.lease_id)
    if (!lease || lease.released_at !== null)
      throw new Error(`attempt lease is not active: ${attemptId}`)
    if (Date.parse(lease.expires_at) <= Date.parse(authorizationAt)) {
      throw new Error(`attempt lease is expired: ${attemptId}`)
    }
    const updated = {
      ...lease,
      heartbeat_at: recordedAt,
      expires_at: new Date(Date.parse(recordedAt) + leaseDurationMs).toISOString(),
    }
    const actor = input.actor ?? attempt.worker_id
    if (actor !== attempt.worker_id) {
      throw new Error('heartbeat actor must match the lease holder')
    }
    return {
      value: updated,
      events: [
        makeEvent({
          kind: 'lease.heartbeat',
          actor,
          recordedAt,
          workId: attempt.work_id,
          attemptId,
          payload: {
            lease_id: lease.lease_id,
            expires_at: updated.expires_at,
            // Each key only when it has a value: writing `code_revision: undefined` would make
            // `'code_revision' in payload` true and let the both-or-neither check pass on a
            // half-recorded phase, which is the one thing it exists to refuse.
            ...(input.phase === undefined ? {} : { phase: input.phase }),
            ...(input.codeRevision === undefined ? {} : { code_revision: input.codeRevision }),
          },
        }),
      ],
    }
  })
}

export function finishRuntimeAttempt(input: {
  repoRoot: string
  attemptId: string
  outcome: 'ok' | 'fail' | 'blocked' | 'cancelled' | 'superseded'
  actor?: string
  now?: string | Date
}): RuntimeAttempt {
  const attemptId = requirePattern('attempt_id', input.attemptId, ATTEMPT_ID)
  const recordedAt = iso(input.now)
  return mutateRuntime(input.repoRoot, (state) => {
    const authorizationAt = trustedAuthorizationTimestamp()
    const attempt = state.attempts.find((candidate) => candidate.attempt_id === attemptId)
    if (!attempt || attempt.state !== 'running') {
      throw new Error(`attempt must be running before finish: ${attemptId}`)
    }
    if (attempt.flow_state !== 'pending_end') {
      throw new Error(`attempt flow end is not prepared: ${attemptId}`)
    }
    if (attempt.pending_outcome !== input.outcome) {
      throw new Error(`attempt pending outcome mismatch: ${attemptId}`)
    }
    const work = state.works.find((candidate) => candidate.work_id === attempt.work_id)!
    const lease = state.leases.find((candidate) => candidate.lease_id === attempt.lease_id)
    if (
      !lease ||
      lease.released_at !== null ||
      Date.parse(lease.expires_at) <= Date.parse(authorizationAt)
    ) {
      throw new Error(`attempt lease is not active at finish commit: ${attemptId}`)
    }
    const attemptState: AttemptState =
      input.outcome === 'ok'
        ? 'succeeded'
        : input.outcome === 'cancelled'
          ? 'cancelled'
          : input.outcome === 'superseded'
            ? 'superseded'
            : 'failed'
    // Handovers are not retries (plan section 9.8 rule 8): a chain of relays must leave the card's
    // retry budget exactly where it found it.
    const retryCount =
      state.attempts.filter((candidate) => candidate.work_id === work.work_id).length -
      work.handover_count
    const workState: MachineWorkState =
      input.outcome === 'ok'
        ? 'done'
        : input.outcome === 'cancelled'
          ? 'cancelled'
          : input.outcome === 'superseded'
            ? 'superseded'
            : retryCount <= work.retry_limit
              ? 'retry_wait'
              : 'exhausted'
    const updatedAttempt = {
      ...attempt,
      state: attemptState,
      flow_state: 'ended' as const,
      pending_outcome: null,
      updated_at: recordedAt,
    }
    const events: Array<Omit<RuntimeEvent, 'sequence'>> = []
    events.push(
      makeEvent({
        kind: 'attempt.state',
        actor: input.actor ?? attempt.worker_id,
        recordedAt,
        workId: work.work_id,
        attemptId,
        payload: {
          from: attempt.state,
          state: attemptState,
          reason: `attempt outcome ${input.outcome}`,
        },
      }),
      makeEvent({
        kind: 'lease.released',
        actor: input.actor ?? attempt.worker_id,
        recordedAt,
        workId: work.work_id,
        attemptId,
        payload: { lease_id: lease.lease_id, reason: `attempt outcome ${input.outcome}` },
      }),
      makeEvent({
        kind: 'work.state',
        actor: input.actor ?? attempt.worker_id,
        recordedAt,
        workId: work.work_id,
        attemptId,
        payload: { from: work.state, state: workState, reason: `attempt outcome ${input.outcome}` },
      }),
      makeEvent({
        kind: 'attempt.flow',
        actor: input.actor ?? attempt.worker_id,
        recordedAt,
        workId: work.work_id,
        attemptId,
        payload: { from: 'pending_end', state: 'ended', pending_outcome: null },
      }),
    )
    if (workState === 'retry_wait') {
      events.push(
        makeEvent({
          kind: 'work.state',
          actor: 'runtime-reconciler',
          recordedAt,
          workId: work.work_id,
          attemptId,
          payload: { from: 'retry_wait', state: 'queued', reason: 'retry budget remains' },
        }),
      )
    }
    return { value: updatedAttempt, events }
  })
}

export function finishRuntimeAttemptBySpan(input: {
  repoRoot: string
  rootSpanId: string
  outcome: 'ok' | 'fail' | 'blocked'
  actor?: string
  now?: string | Date
}): RuntimeAttempt {
  const state = readRuntimeState(input.repoRoot)
  const attempt = state.attempts.find((candidate) => candidate.root_span_id === input.rootSpanId)
  if (!attempt) throw new Error(`runtime attempt not found for span: ${input.rootSpanId}`)
  return finishRuntimeAttempt({
    repoRoot: input.repoRoot,
    attemptId: attempt.attempt_id,
    outcome: input.outcome,
    actor: input.actor,
    now: input.now,
  })
}

export function reconcileRuntimeFlowBoundaries(input: {
  repoRoot: string
  flowEvents: Array<{ span_id: string; phase: string; outcome?: string | null }>
  readFlowEvents?: () => Array<{ span_id: string; phase: string; outcome?: string | null }>
  emitMissingEnd?: (attempt: RuntimeAttempt) => boolean
  boundaryGraceMs?: number
  actor?: string
  now?: string | Date
}): Array<{ attempt_id: string; action: string }> {
  const recordedAt = iso(input.now)
  const authorizationAt = trustedAuthorizationTimestamp()
  const boundaryGraceMs = input.boundaryGraceMs ?? 5_000
  const actions: Array<{ attempt_id: string; action: string }> = []
  for (const snapshot of readRuntimeState(input.repoRoot).attempts) {
    if (!ACTIVE_ATTEMPT.has(snapshot.state)) {
      if (snapshot.flow_state === 'ended') continue
      const closed = mutateRuntime(input.repoRoot, (state) => {
        const current = state.attempts.find(
          (candidate) => candidate.attempt_id === snapshot.attempt_id,
        )
        if (!current || current.flow_state === 'ended') return { value: false, events: [] }
        const events: Array<Omit<RuntimeEvent, 'sequence'>> = [
          makeEvent({
            kind: 'attempt.flow_recovered',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: current.work_id,
            attemptId: current.attempt_id,
            payload: {
              from: current.flow_state,
              state: 'ended',
              pending_outcome: null,
              reason: 'terminal attempt missing flow boundary',
            },
          }),
        ]
        return { value: true, events }
      })
      if (closed) actions.push({ attempt_id: snapshot.attempt_id, action: 'terminal-flow-closed' })
      continue
    }
    const hasStart = input.flowEvents.some(
      (event) => event.span_id === snapshot.root_span_id && event.phase === 'start',
    )
    const end = input.flowEvents.find(
      (event) => event.span_id === snapshot.root_span_id && event.phase === 'end',
    )
    if (snapshot.flow_state === 'pending_start' && hasStart) {
      markRuntimeFlowStarted({
        repoRoot: input.repoRoot,
        attemptId: snapshot.attempt_id,
        actor: 'runtime-reconciler',
        now: recordedAt,
      })
      actions.push({ attempt_id: snapshot.attempt_id, action: 'flow-start-committed' })
      continue
    }
    if (snapshot.flow_state === 'pending_start') {
      const boundaryLease = readRuntimeState(input.repoRoot).leases.find(
        (candidate) => candidate.lease_id === snapshot.lease_id,
      )
      const boundaryExpired =
        Date.parse(authorizationAt) - Date.parse(snapshot.started_at) >= boundaryGraceMs ||
        !boundaryLease ||
        boundaryLease.released_at !== null ||
        Date.parse(boundaryLease.expires_at) <= Date.parse(authorizationAt)
      if (!boundaryExpired) continue
      const latestFlowEvents = input.readFlowEvents?.() ?? input.flowEvents
      if (
        latestFlowEvents.some(
          (event) => event.span_id === snapshot.root_span_id && event.phase === 'start',
        )
      ) {
        markRuntimeFlowStarted({
          repoRoot: input.repoRoot,
          attemptId: snapshot.attempt_id,
          actor: 'runtime-reconciler',
          now: recordedAt,
        })
        actions.push({ attempt_id: snapshot.attempt_id, action: 'flow-start-committed' })
        continue
      }
      mutateRuntime(input.repoRoot, (state) => {
        const attempt = state.attempts.find(
          (candidate) => candidate.attempt_id === snapshot.attempt_id,
        )!
        const work = state.works.find((candidate) => candidate.work_id === attempt.work_id)!
        const lease = state.leases.find((candidate) => candidate.lease_id === attempt.lease_id)!
        const attemptCount =
          state.attempts.filter((candidate) => candidate.work_id === work.work_id).length -
          work.handover_count
        const retry = attemptCount <= work.retry_limit
        const events: Array<Omit<RuntimeEvent, 'sequence'>> = [
          makeEvent({
            kind: 'attempt.state',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: work.work_id,
            attemptId: attempt.attempt_id,
            payload: { from: attempt.state, state: 'abandoned', reason: 'flow start missing' },
          }),
          makeEvent({
            kind: 'lease.released',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: work.work_id,
            attemptId: attempt.attempt_id,
            payload: { lease_id: lease.lease_id, reason: 'flow start missing' },
          }),
          makeEvent({
            kind: 'attempt.flow_recovered',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: work.work_id,
            attemptId: attempt.attempt_id,
            payload: {
              from: 'pending_start',
              state: 'ended',
              pending_outcome: null,
              reason: 'flow start missing',
            },
          }),
          makeEvent({
            kind: 'work.state',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: work.work_id,
            attemptId: attempt.attempt_id,
            payload: {
              from: work.state,
              state: retry ? 'retry_wait' : 'exhausted',
              reason: 'flow start missing',
            },
          }),
        ]
        if (retry) {
          events.push(
            makeEvent({
              kind: 'work.state',
              actor: 'runtime-reconciler',
              recordedAt,
              workId: work.work_id,
              attemptId: attempt.attempt_id,
              payload: { from: 'retry_wait', state: 'queued', reason: 'retry budget remains' },
            }),
          )
        }
        return { value: undefined, events }
      })
      actions.push({ attempt_id: snapshot.attempt_id, action: 'unbound-attempt-abandoned' })
      continue
    }
    if (snapshot.flow_state === 'pending_end') {
      const emitted = end !== undefined || input.emitMissingEnd?.(snapshot) === true
      if (!emitted) continue
      finishRuntimeAttempt({
        repoRoot: input.repoRoot,
        attemptId: snapshot.attempt_id,
        outcome: snapshot.pending_outcome!,
        actor: 'runtime-reconciler',
        now: recordedAt,
      })
      actions.push({ attempt_id: snapshot.attempt_id, action: 'flow-end-committed' })
    }
  }
  return actions
}

function readCanonicalJsonl(path: string): Array<Record<string, any>> {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => requireRecord(`canonical record in ${path}`, JSON.parse(line)))
}

function canonicalOpsxDigest(repoRoot: string, attempt: RuntimeAttempt): RuntimeDigest {
  const path = join(repoRoot, '.clade', 'ai-control-plane', 'intent', `${attempt.change_id}.json`)
  return existsSync(path)
    ? runtimeDigest(JSON.parse(readFileSync(path, 'utf8')))
    : runtimeDigest({
        change_id: attempt.change_id,
        intent_revision: attempt.intent_revision,
      })
}

function assertCanonicalResumeRecord(
  repoRoot: string,
  state: RuntimeState,
  attempt: RuntimeAttempt,
  record: ResumeRecord,
): void {
  if (
    attempt.worktree_id === null ||
    attempt.worktree_head === null ||
    record.worktree_id !== attempt.worktree_id ||
    record.worktree_head !== attempt.worktree_head
  ) {
    throw new Error('resume record HEAD does not match the canonical attempt worktree')
  }
  if (record.opsx_artifact_digest !== canonicalOpsxDigest(repoRoot, attempt)) {
    throw new Error('resume record OPSX digest is not current')
  }
  const checkpointIds = new Set(
    readCanonicalJsonl(join(repoRoot, '.clade', 'ai-control-plane', 'projection-events.jsonl'))
      .filter((checkpoint) => checkpoint.change_id === attempt.change_id)
      .map((checkpoint) => checkpoint.projection_id),
  )
  const evidenceIds = new Set(
    readCanonicalJsonl(join(repoRoot, '.clade', 'ai-control-plane', 'evidence.jsonl'))
      .filter(
        (evidence) =>
          evidence.change_id === attempt.change_id &&
          evidence.work_id === attempt.work_id &&
          evidence.attempt_id === attempt.attempt_id,
      )
      .map((evidence) => evidence.evidence_id),
  )
  if (record.checkpoint_ids.some((id) => !checkpointIds.has(id))) {
    throw new Error('resume record references a non-canonical checkpoint')
  }
  if (record.evidence_ids.some((id) => !evidenceIds.has(id))) {
    throw new Error('resume record references non-canonical evidence')
  }
  if (record.last_event_offset > state.events.length) {
    throw new Error('resume record cursor exceeds the canonical journal')
  }
}

export function createResumeRecord(input: {
  repoRoot: string
  attemptId: string
  worktreeHead: string
  opsxArtifactDigest: RuntimeDigest
  checkpointIds?: string[]
  evidenceIds?: string[]
  resumeToken: string
  actor?: string
  now?: string | Date
}): ResumeRecord {
  const attemptId = requirePattern('attempt_id', input.attemptId, ATTEMPT_ID)
  const recordedAt = iso(input.now)
  requireDigest('OPSX artifact digest', input.opsxArtifactDigest)
  if (!/^[0-9a-f]{7,64}$/.test(input.worktreeHead))
    throw new Error('worktreeHead must be a git object id')
  if (!input.resumeToken) throw new Error('resumeToken is required')
  return mutateRuntime(input.repoRoot, (state) => {
    const attempt = state.attempts.find((candidate) => candidate.attempt_id === attemptId)
    if (!attempt) throw new Error(`unknown attempt: ${attemptId}`)
    if (!attempt.worktree_id || !attempt.worktree_head) {
      throw new Error('resume record requires canonical attempt worktree and HEAD')
    }
    if (input.worktreeHead !== attempt.worktree_head) {
      throw new Error('resume record HEAD does not match the canonical attempt worktree')
    }
    const opsxArtifactDigest = canonicalOpsxDigest(input.repoRoot, attempt)
    if (input.opsxArtifactDigest !== opsxArtifactDigest) {
      throw new Error('resume record OPSX digest must match the canonical intent')
    }
    const record: ResumeRecord = {
      artifact_type: 'runtime.resume_record',
      schema_version: 1,
      resume_record_id: opaque('rsm'),
      work_id: attempt.work_id,
      attempt_id: attemptId,
      worker_id: attempt.worker_id,
      repo_id: attempt.repo_id,
      change_id: attempt.change_id,
      worktree_id: attempt.worktree_id,
      worktree_head: attempt.worktree_head,
      opsx_artifact_digest: opsxArtifactDigest,
      last_event_offset: state.events.length,
      checkpoint_ids: input.checkpointIds ?? [],
      evidence_ids: input.evidenceIds ?? [],
      workspace_id: attempt.workspace_id,
      pane_id: attempt.pane_id,
      engine: attempt.engine,
      engine_version: attempt.engine_version,
      capability_grant_digest: attempt.capability_grant_digest,
      resume_token_digest: runtimeDigest(input.resumeToken),
      consumed_by_attempt_id: null,
      recorded_at: recordedAt,
    }
    assertCanonicalResumeRecord(input.repoRoot, state, attempt, record)
    return {
      value: record,
      events: [
        makeEvent({
          kind: 'resume.recorded',
          actor: input.actor ?? attempt.worker_id,
          recordedAt,
          workId: attempt.work_id,
          attemptId,
          payload: { record },
        }),
      ],
    }
  })
}

/**
 * End the attempt currently running a work item BECAUSE SOMEBODY ELSE IS TAKING IT OVER, and leave
 * the work leasable (plan section 9.8 rule 8).
 *
 * A relay is a resume, not a delegation. The predecessor did not fail and did not finish; it handed
 * one piece of work to another session. Every terminal outcome the runtime already had says
 * something else — `ok` marks the work `done` and declines every later relay in the chain with
 * `cannot lease from state done`, `fail` spends a retry the handover never used — so this is the
 * missing verb, added rather than borrowed.
 *
 * ADDITIVE, and deliberately so: it invents no state, relaxes no admission rule, and emits only
 * events the fold already authorizes. `abandoned` is the attempt state the reconciler already uses
 * for "this attempt stopped without a verdict"; `retry_wait` → `queued` is the work path the fold
 * already allows behind it. What is new is only WHO may cause them and why.
 *
 * The resume record is minted here, in the same batch, for one reason: `validateAttemptAdmission`
 * requires the successor's `resumes_attempt_id` to arrive with a record, a token, a worktree and a
 * HEAD, and requires the record's cursor to be fresh. Minting it anywhere else means a window in
 * which the journal moves and the successor is refused. The token is the caller's — for a Herdr
 * relay it is the successor's own session id, which is exactly the thing that lets the work
 * continue, never a value invented to satisfy the check.
 *
 * Returns null when there is nothing to hand off (no attempt on this work yet — the first pane in a
 * chain). THROWS when there is an attempt that cannot be handed off, because that is the case a
 * caller must not paper over.
 */
export function handOffRuntimeAttempt(input: {
  repoRoot: string
  workId: string
  resumeToken: string
  now?: string | Date
}): {
  attempt_id: string
  resume_record_id: string
  worktree_id: string
  worktree_head: string
  engine: string
  engine_version: string
} | null {
  const workId = requirePattern('work_id', input.workId, WORK_ID)
  const recordedAt = iso(input.now)
  if (!input.resumeToken) throw new Error('handoff requires a resume token')
  const reason = HANDOFF_REASON
  return mutateRuntime(input.repoRoot, (state) => {
    const work = state.works.find((candidate) => candidate.work_id === workId)
    if (!work) return { value: null, events: [] }
    const attempt = state.attempts.findLast((candidate) => candidate.work_id === workId)
    if (!attempt || !ACTIVE_ATTEMPT.has(attempt.state)) return { value: null, events: [] }
    if (attempt.state !== 'running' || attempt.flow_state !== 'started') {
      throw new Error(`attempt is not handoffable: ${attempt.attempt_id}`)
    }
    if (!attempt.worktree_id || !attempt.worktree_head) {
      throw new Error('handoff requires canonical attempt worktree and HEAD')
    }
    const lease = state.leases.find((candidate) => candidate.lease_id === attempt.lease_id)
    if (
      !lease ||
      lease.released_at !== null ||
      Date.parse(lease.expires_at) <= Date.parse(trustedAuthorizationTimestamp())
    ) {
      throw new Error(`attempt lease is not active at handoff: ${attempt.attempt_id}`)
    }
    // The handover budget, and ONLY it. This check used to read `retry_limit`, which meant the
    // first relay of every real chain was refused: a chain starts on the card an ordinary dispatch
    // minted, and rule 3 gives that card zero retries. Retries and handovers now count apart
    // (rule 8), so a card with no retry budget is still handed over up to this bound.
    if (work.handover_count >= CONTINUATION_HANDOVER_BUDGET) {
      throw new Error(
        `work ${workId} has no handover budget left (${work.handover_count} handovers, limit ${CONTINUATION_HANDOVER_BUDGET})`,
      )
    }
    const record: ResumeRecord = {
      artifact_type: 'runtime.resume_record',
      schema_version: 1,
      resume_record_id: opaque('rsm'),
      work_id: workId,
      attempt_id: attempt.attempt_id,
      worker_id: attempt.worker_id,
      repo_id: attempt.repo_id,
      change_id: attempt.change_id,
      worktree_id: attempt.worktree_id,
      worktree_head: attempt.worktree_head,
      opsx_artifact_digest: canonicalOpsxDigest(input.repoRoot, attempt),
      // The record is the FIRST event of this batch, so the cursor is the journal length right
      // before it — which is what the fold checks (`last_event_offset !== event.sequence - 1`).
      // Everything after it in this batch is a recovery-kind event for this same attempt, which is
      // exactly the tail `validateAttemptAdmission` tolerates when the successor consumes it.
      last_event_offset: state.events.length,
      checkpoint_ids: [],
      evidence_ids: [],
      workspace_id: attempt.workspace_id,
      pane_id: attempt.pane_id,
      engine: attempt.engine,
      engine_version: attempt.engine_version,
      capability_grant_digest: attempt.capability_grant_digest,
      resume_token_digest: runtimeDigest(input.resumeToken),
      consumed_by_attempt_id: null,
      recorded_at: recordedAt,
    }
    assertCanonicalResumeRecord(input.repoRoot, state, attempt, record)
    // The fold authorizes a handover only when the event actor IS the lease holder, so this is
    // not a default that a caller may override — it is the only value that works.
    const holder = attempt.worker_id
    return {
      value: {
        attempt_id: attempt.attempt_id,
        resume_record_id: record.resume_record_id,
        worktree_id: attempt.worktree_id,
        worktree_head: attempt.worktree_head,
        engine: attempt.engine,
        engine_version: attempt.engine_version,
      },
      events: [
        makeEvent({
          kind: 'resume.recorded',
          actor: holder,
          recordedAt,
          workId,
          attemptId: attempt.attempt_id,
          payload: { record },
        }),
        makeEvent({
          kind: 'attempt.state',
          actor: holder,
          recordedAt,
          workId,
          attemptId: attempt.attempt_id,
          payload: { from: attempt.state, state: 'abandoned', reason },
        }),
        // Adjacent to the `attempt.state` above, same actor and same reason: the fold authorizes a
        // release only when the event immediately before it is the terminal cause, matched field
        // for field. NEVER separate these two.
        makeEvent({
          kind: 'lease.released',
          actor: holder,
          recordedAt,
          workId,
          attemptId: attempt.attempt_id,
          payload: { lease_id: lease.lease_id, reason },
        }),
        makeEvent({
          kind: 'attempt.flow_recovered',
          actor: 'runtime-reconciler',
          recordedAt,
          workId,
          attemptId: attempt.attempt_id,
          payload: { from: attempt.flow_state, state: 'ended', pending_outcome: null, reason },
        }),
        makeEvent({
          kind: 'work.state',
          actor: holder,
          recordedAt,
          workId,
          attemptId: attempt.attempt_id,
          payload: { from: work.state, state: 'retry_wait', reason },
        }),
        makeEvent({
          kind: 'work.state',
          actor: 'runtime-reconciler',
          recordedAt,
          workId,
          attemptId: attempt.attempt_id,
          payload: { from: 'retry_wait', state: 'queued', reason: `${reason}; work is leasable` },
        }),
      ],
    }
  })
}

export function attachPane(input: {
  repoRoot: string
  resumeRecordId: string
  attemptId: string
  workspaceId: string
  paneId: string
  actor?: string
  now?: string | Date
}): PaneMapping {
  const recordedAt = iso(input.now)
  return mutateRuntime(input.repoRoot, (state) => {
    const authorizationAt = trustedAuthorizationTimestamp()
    const record = state.resume_records.find(
      (candidate) => candidate.resume_record_id === input.resumeRecordId,
    )
    if (!record) throw new Error(`unknown resume record: ${input.resumeRecordId}`)
    const attempt = state.attempts.find((candidate) => candidate.attempt_id === input.attemptId)
    if (
      !attempt ||
      attempt.resumes_attempt_id !== record.attempt_id ||
      record.consumed_by_attempt_id !== attempt.attempt_id ||
      attempt.work_id !== record.work_id
    ) {
      throw new Error('pane attachment requires the consuming resumed attempt')
    }
    const lease = state.leases.find((candidate) => candidate.lease_id === attempt.lease_id)
    if (
      !ACTIVE_ATTEMPT.has(attempt.state) ||
      !lease ||
      lease.released_at !== null ||
      Date.parse(lease.expires_at) <= Date.parse(authorizationAt)
    ) {
      throw new Error('pane attachment requires an active leased resumed attempt')
    }
    if (
      (attempt.workspace_id !== null && attempt.workspace_id !== input.workspaceId) ||
      (attempt.pane_id !== null && attempt.pane_id !== input.paneId)
    ) {
      throw new Error('pane attachment does not match attempt workspace/pane context')
    }
    const mapping: PaneMapping = {
      mapping_id: opaque('pmp'),
      work_id: record.work_id,
      attempt_id: attempt.attempt_id,
      workspace_id: input.workspaceId,
      pane_id: input.paneId,
      resume_record_id: record.resume_record_id,
      resume_token_digest: record.resume_token_digest,
      state: 'attached',
      attached_at: recordedAt,
      updated_at: recordedAt,
    }
    return {
      value: mapping,
      events: [
        makeEvent({
          kind: 'pane.attached',
          actor: input.actor ?? 'runtime-reconciler',
          recordedAt,
          workId: record.work_id,
          attemptId: attempt.attempt_id,
          payload: { mapping },
        }),
      ],
    }
  })
}

/**
 * The runtime's name for one Herdr pane — minted on first sight of the handle, reused ever after.
 *
 * Idempotent by handle pair, and that is what it is FOR (plan section 9.8): a second dispatch into
 * the same pane must resolve to the same `pane_ref`, not to a second registry row. It emits an
 * event only on the mint, so calling it once per dispatch costs nothing after the first.
 *
 * NEVER give this a work id or an attempt id. A pane outlives every attempt that runs in it, and an
 * identity scoped to an attempt would have to be re-minted for the next one — which is the failure
 * this record exists to remove.
 */
export function ensurePaneIdentity(input: {
  repoRoot: string
  workspaceHandle: string
  paneHandle: string
  actor?: string
  now?: string | Date
}): PaneIdentity {
  const recordedAt = iso(input.now)
  return mutateRuntime(input.repoRoot, (state) => {
    const existing = state.pane_identities.find(
      (candidate) =>
        candidate.workspace_handle === input.workspaceHandle &&
        candidate.pane_handle === input.paneHandle,
    )
    if (existing) return { value: existing, events: [] }
    const identity: PaneIdentity = {
      pane_ref: opaque('pane'),
      // Every pane in one workspace handle shares that workspace's ref, so the workspace is minted
      // once too — by looking for it on any pane already registered under the same handle.
      workspace_ref:
        state.pane_identities.find(
          (candidate) => candidate.workspace_handle === input.workspaceHandle,
        )?.workspace_ref ?? opaque('ws'),
      pane_handle: input.paneHandle,
      workspace_handle: input.workspaceHandle,
      minted_at: recordedAt,
    }
    return {
      value: identity,
      events: [
        makeEvent({
          kind: 'pane.identity',
          actor: input.actor ?? 'dispatcher',
          recordedAt,
          payload: { identity },
        }),
      ],
    }
  })
}

function assertGrantAllowsControl(
  grant: CapabilityGrant,
  scope: RuntimePause['scope'],
  scopeId: string,
  now: string,
): void {
  validateGrant(grant)
  if (!grant.pause_resume) throw new Error('capability grant does not allow pause/resume')
  assertGrantActiveAt(grant, now)
  if (
    scope === 'repository' &&
    !grant.repositories.includes(scopeId) &&
    !grant.repositories.includes('*')
  ) {
    throw new Error(`capability grant does not cover repository ${scopeId}`)
  }
  if (scope === 'initiative' && !grant.initiative_ids.includes(scopeId)) {
    throw new Error(`capability grant does not cover initiative ${scopeId}`)
  }
  if (scope === 'global' && !grant.global_control) {
    throw new Error('capability grant does not allow global control')
  }
}

export function setRuntimePause(input: {
  repoRoot: string
  scope: RuntimePause['scope']
  scopeId: string
  action: 'pause' | 'resume'
  grant: CapabilityGrant
  actor: string
  reason: string
  now?: string | Date
}): RuntimePause {
  const recordedAt = iso(input.now)
  if (!input.scopeId || !input.reason) throw new Error('pause scope and reason are required')
  return mutateRuntime(input.repoRoot, (state) => {
    const authorizationAt = trustedAuthorizationTimestamp()
    assertGrantAllowsControl(input.grant, input.scope, input.scopeId, authorizationAt)
    const registered = state.grants.find((grant) => grant.grant_id === input.grant.grant_id)
    if (!registered || registered.digest !== input.grant.digest) {
      throw new Error('pause/resume requires a registered capability grant')
    }
    if (input.actor !== input.grant.worker_id) {
      throw new Error('pause/resume actor must match the grant principal')
    }
    const current = state.pauses.find(
      (pause) => pause.scope === input.scope && pause.scope_id === input.scopeId,
    )
    const paused = input.action === 'pause'
    if (current?.paused === paused) throw new Error(`runtime scope is already ${input.action}d`)
    const control: RuntimePause = {
      scope: input.scope,
      scope_id: input.scopeId,
      paused,
      actor: input.actor,
      grant_digest: input.grant.digest,
      reason: input.reason,
      updated_at: recordedAt,
    }
    const resultingPauses = [
      ...state.pauses.filter(
        (pause) => pause.scope !== input.scope || pause.scope_id !== input.scopeId,
      ),
      control,
    ]
    const affectedAttempts = state.attempts.filter((attempt) => {
      const work = state.works.find((candidate) => candidate.work_id === attempt.work_id)
      if (!work) return false
      const inScope =
        input.scope === 'global' ||
        (input.scope === 'repository' && input.scopeId === work.repo_id) ||
        (input.scope === 'initiative' && input.scopeId === work.initiative_id)
      if (!inScope) return false
      if (paused) return attempt.state === 'running'
      return attempt.state === 'paused' && !matchingPauseIn(resultingPauses, work)
    })
    if (!paused) {
      for (const attempt of affectedAttempts) {
        const lease = state.leases.find((candidate) => candidate.lease_id === attempt.lease_id)
        if (
          !lease ||
          lease.released_at !== null ||
          Date.parse(lease.expires_at) <= Date.parse(authorizationAt)
        ) {
          throw new Error(
            `paused attempt cannot resume without a valid lease: ${attempt.attempt_id}`,
          )
        }
      }
    }
    return {
      value: control,
      events: [
        makeEvent({
          kind: paused ? 'control.paused' : 'control.resumed',
          actor: input.actor,
          recordedAt,
          payload: { control },
        }),
        ...affectedAttempts.map((attempt) =>
          makeEvent({
            kind: 'attempt.state',
            actor: input.actor,
            recordedAt,
            workId: attempt.work_id,
            attemptId: attempt.attempt_id,
            payload: {
              from: attempt.state,
              state: paused ? 'paused' : 'running',
              reason: `${input.scope} ${input.action}: ${input.reason}`,
            },
          }),
        ),
      ],
    }
  })
}

function validateMessagePayload(payload: Record<string, unknown>): void {
  const forbidden = new Set([
    'state',
    'machine_state',
    'done',
    'requirement',
    'requirement_revision',
  ])
  for (const key of Object.keys(payload)) {
    if (forbidden.has(key))
      throw new Error(`messages cannot mutate canonical lifecycle facts: ${key}`)
  }
  validateSafePayload(payload)
}

export function sendRuntimeMessage(input: {
  repoRoot: string
  senderWorkerId: string
  recipientWorkerId: string
  workId: string
  changeId: string
  type: RuntimeMessageType
  payload: Record<string, unknown>
  grant: CapabilityGrant
  causationId?: string | null
  childWorkId?: string | null
  actor?: string
  now?: string | Date
}): RuntimeMessage {
  const recordedAt = iso(input.now)
  validateMessagePayload(input.payload)
  return mutateRuntime(input.repoRoot, (state) => {
    const authorizationAt = trustedAuthorizationTimestamp()
    const grant = state.grants.find((candidate) => candidate.grant_id === input.grant.grant_id)
    if (!grant || grant.digest !== input.grant.digest || !grant.messaging) {
      throw new Error('message requires a registered messaging grant')
    }
    if (grant.worker_id !== input.senderWorkerId) throw new Error('message grant sender mismatch')
    assertGrantActiveAt(grant, authorizationAt)
    for (const workerId of [input.senderWorkerId, input.recipientWorkerId]) {
      if (!state.workers.some((worker) => worker.worker_id === workerId)) {
        throw new Error(`message references unknown worker: ${workerId}`)
      }
    }
    const work = state.works.find((candidate) => candidate.work_id === input.workId)
    if (!work || work.change_id !== input.changeId) throw new Error('message work/change mismatch')
    if (!grant.repositories.includes(work.repo_id) && !grant.repositories.includes('*')) {
      throw new Error(`message grant does not cover repository ${work.repo_id}`)
    }
    const child = input.childWorkId
      ? state.works.find((candidate) => candidate.work_id === input.childWorkId)
      : null
    const delegationType =
      (input.type === 'delegation_request' || input.type === 'delegation_result') &&
      input.childWorkId !== null &&
      input.childWorkId !== undefined
    if (
      delegationType &&
      child &&
      (child.parent_work_id !== work.work_id ||
        child.repo_id !== work.repo_id ||
        child.change_id !== work.change_id ||
        child.created_by_grant_digest !== grant.digest ||
        !input.causationId ||
        child.causation_id !== input.causationId)
    ) {
      throw new Error('delegation child lineage mismatch')
    }
    const authoritativeDelegation = delegationType && Boolean(child) && grant.child_work_creation
    const message: RuntimeMessage = {
      message_id: opaque('msg'),
      sender_worker_id: input.senderWorkerId,
      recipient_worker_id: input.recipientWorkerId,
      work_id: input.workId,
      change_id: input.changeId,
      type: input.type,
      causation_id: input.causationId ?? null,
      child_work_id: input.childWorkId ?? null,
      capability_grant_digest: grant.digest,
      authoritative_delegation: authoritativeDelegation,
      payload: input.payload,
      recorded_at: recordedAt,
    }
    return {
      value: message,
      events: [
        makeEvent({
          kind: 'message.sent',
          actor: input.actor ?? input.senderWorkerId,
          recordedAt,
          workId: input.workId,
          payload: { message },
        }),
      ],
    }
  })
}

export function recordRuntimeTraceObservation(input: {
  repoRoot: string
  attemptId: string
  name: RuntimeSpanName
  spanId?: string
  parentSpanId?: string
  startedAt: string | Date
  endedAt?: string | Date | null
  attributes?: Record<string, string | number | boolean>
  links?: RuntimeTraceObservation['links']
  actor?: string
}): RuntimeTraceObservation {
  const startedAt = iso(input.startedAt)
  const endedAt = input.endedAt === null || input.endedAt === undefined ? null : iso(input.endedAt)
  return mutateRuntime(input.repoRoot, (state) => {
    const attempt = state.attempts.find((candidate) => candidate.attempt_id === input.attemptId)
    if (!attempt)
      throw new Error(`trace observation references unknown attempt: ${input.attemptId}`)
    const spanId = requirePattern(
      'span_id',
      input.spanId ?? randomUUID().replaceAll('-', '').slice(0, 16),
      /^[0-9a-f]{16}$/,
    )
    if (
      state.attempts.some((candidate) => candidate.root_span_id === spanId) ||
      state.trace_observations.some((candidate) => candidate.span_id === spanId)
    ) {
      throw new Error(`duplicate span_id: ${spanId}`)
    }
    const observation: RuntimeTraceObservation = {
      observation_id: opaque('obs'),
      attempt_id: input.attemptId,
      name: input.name,
      span_id: spanId,
      parent_span_id: requirePattern(
        'parent_span_id',
        input.parentSpanId ?? attempt.root_span_id,
        /^[0-9a-f]{16}$/,
      ),
      started_at: startedAt,
      ended_at: endedAt,
      attributes: input.attributes ?? {},
      links: input.links ?? [],
    }
    validateSafePayload(observation.attributes)
    return {
      value: observation,
      events: [
        makeEvent({
          kind: 'trace.observed',
          actor: input.actor ?? attempt.worker_id,
          recordedAt: endedAt ?? startedAt,
          workId: attempt.work_id,
          attemptId: input.attemptId,
          payload: { observation },
        }),
      ],
    }
  })
}

export interface ReconciliationAction {
  class:
    | 'reference-orphan'
    | 'execution-orphan'
    | 'pane-orphan'
    | 'projection-orphan'
    | 'parent-terminal-orphan'
  work_id: string
  attempt_id: string | null
  action: string
}

export function reconcileRuntimeOrphans(input: {
  repoRoot: string
  now: string | Date
  validWorkIds?: Set<string>
  parentStates?: Record<string, 'active' | 'cancelled' | 'superseded'>
  observedPanes?: Array<{ pane_id: string; resume_token: string | null }>
  paneGraceMs?: number
  projectionPresent?: (work: RuntimeWork) => boolean
  rebuildProjection?: (work: RuntimeWork) => void
}): ReconciliationAction[] {
  const recordedAt = iso(input.now)
  const nowMs = Date.parse(trustedAuthorizationTimestamp())
  const observedPanes = input.observedPanes ?? []
  const paneGraceMs = input.paneGraceMs ?? 60_000
  return mutateRuntime(input.repoRoot, (state) => {
    const actions: ReconciliationAction[] = []
    const events: Array<Omit<RuntimeEvent, 'sequence'>> = []
    const handledWorkIds = new Set<string>()
    const handledMappingIds = new Set<string>()
    const closeFlow = (attempt: RuntimeAttempt, reason: string): void => {
      if (attempt.flow_state === 'ended') return
      events.push(
        makeEvent({
          kind: 'attempt.flow_recovered',
          actor: 'runtime-reconciler',
          recordedAt,
          workId: attempt.work_id,
          attemptId: attempt.attempt_id,
          payload: {
            from: attempt.flow_state,
            state: 'ended',
            pending_outcome: null,
            reason,
          },
        }),
      )
    }
    const release = (attempt: RuntimeAttempt, reason: string): void => {
      const lease = state.leases.find((candidate) => candidate.lease_id === attempt.lease_id)
      if (lease?.released_at === null) {
        events.push(
          makeEvent({
            kind: 'lease.released',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: attempt.work_id,
            attemptId: attempt.attempt_id,
            payload: { lease_id: lease.lease_id, reason },
          }),
        )
      }
    }

    for (const work of state.works) {
      if (
        input.validWorkIds &&
        !input.validWorkIds.has(work.work_id) &&
        !TERMINAL_WORK.has(work.state) &&
        work.state !== 'quarantined'
      ) {
        for (const attempt of state.attempts.filter(
          (candidate) => candidate.work_id === work.work_id && ACTIVE_ATTEMPT.has(candidate.state),
        )) {
          events.push(
            makeEvent({
              kind: 'attempt.state',
              actor: 'runtime-reconciler',
              recordedAt,
              workId: work.work_id,
              attemptId: attempt.attempt_id,
              payload: { from: attempt.state, state: 'abandoned', reason: 'reference orphan' },
            }),
          )
          release(attempt, 'reference orphan')
          closeFlow(attempt, 'reference orphan')
          for (const mapping of state.pane_mappings.filter(
            (candidate) =>
              candidate.attempt_id === attempt.attempt_id && candidate.state !== 'closed',
          )) {
            events.push(
              makeEvent({
                kind: 'pane.state',
                actor: 'runtime-reconciler',
                recordedAt,
                workId: work.work_id,
                attemptId: attempt.attempt_id,
                payload: { mapping_id: mapping.mapping_id, state: 'closed' },
              }),
            )
            handledMappingIds.add(mapping.mapping_id)
          }
        }
        events.push(
          makeEvent({
            kind: 'work.state',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: work.work_id,
            payload: { from: work.state, state: 'quarantined', reason: 'reference orphan' },
          }),
        )
        actions.push({
          class: 'reference-orphan',
          work_id: work.work_id,
          attempt_id: null,
          action: 'quarantined',
        })
        handledWorkIds.add(work.work_id)
        continue
      }
      const parentState = input.parentStates?.[work.change_id]
      if (
        (parentState === 'cancelled' || parentState === 'superseded') &&
        !TERMINAL_WORK.has(work.state) &&
        work.state !== 'quarantined' &&
        work.state !== 'legacy_unverified'
      ) {
        const attempt = state.attempts.find(
          (candidate) => candidate.work_id === work.work_id && ACTIVE_ATTEMPT.has(candidate.state),
        )
        if (attempt) {
          events.push(
            makeEvent({
              kind: 'attempt.state',
              actor: 'runtime-reconciler',
              recordedAt,
              workId: work.work_id,
              attemptId: attempt.attempt_id,
              payload: { from: attempt.state, state: parentState, reason: `parent ${parentState}` },
            }),
          )
          release(attempt, `parent ${parentState}`)
          closeFlow(attempt, `parent ${parentState}`)
          for (const mapping of state.pane_mappings.filter(
            (candidate) =>
              candidate.attempt_id === attempt.attempt_id && candidate.state !== 'closed',
          )) {
            events.push(
              makeEvent({
                kind: 'pane.state',
                actor: 'runtime-reconciler',
                recordedAt,
                workId: work.work_id,
                attemptId: attempt.attempt_id,
                payload: { mapping_id: mapping.mapping_id, state: 'closed' },
              }),
            )
            handledMappingIds.add(mapping.mapping_id)
          }
        }
        events.push(
          makeEvent({
            kind: 'work.state',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: work.work_id,
            attemptId: attempt?.attempt_id ?? null,
            payload: { from: work.state, state: parentState, reason: `parent ${parentState}` },
          }),
        )
        actions.push({
          class: 'parent-terminal-orphan',
          work_id: work.work_id,
          attempt_id: attempt?.attempt_id ?? null,
          action: parentState,
        })
        handledWorkIds.add(work.work_id)
        continue
      }
      if (input.projectionPresent && !input.projectionPresent(work)) {
        if (!input.rebuildProjection) {
          throw new Error(`projection orphan requires rebuildProjection: ${work.work_id}`)
        }
        input.rebuildProjection(work)
        actions.push({
          class: 'projection-orphan',
          work_id: work.work_id,
          attempt_id: null,
          action: 'rebuilt',
        })
      }
    }

    for (const attempt of state.attempts.filter((candidate) =>
      ACTIVE_ATTEMPT.has(candidate.state),
    )) {
      if (handledWorkIds.has(attempt.work_id)) continue
      const lease = state.leases.find((candidate) => candidate.lease_id === attempt.lease_id)
      if (!lease || lease.released_at !== null || Date.parse(lease.expires_at) > nowMs) continue
      const work = state.works.find((candidate) => candidate.work_id === attempt.work_id)!
      const attemptCount =
        state.attempts.filter((candidate) => candidate.work_id === work.work_id).length -
        work.handover_count
      const workState: MachineWorkState = attemptCount <= work.retry_limit ? 'queued' : 'exhausted'
      events.push(
        makeEvent({
          kind: 'attempt.state',
          actor: 'runtime-reconciler',
          recordedAt,
          workId: work.work_id,
          attemptId: attempt.attempt_id,
          payload: { from: attempt.state, state: 'abandoned', reason: 'lease expired' },
        }),
      )
      release(attempt, 'lease expired')
      closeFlow(attempt, 'lease expired')
      if (workState === 'queued') {
        events.push(
          makeEvent({
            kind: 'work.state',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: work.work_id,
            attemptId: attempt.attempt_id,
            payload: { from: work.state, state: 'retry_wait', reason: 'lease expired' },
          }),
          makeEvent({
            kind: 'work.state',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: work.work_id,
            attemptId: attempt.attempt_id,
            payload: { from: 'retry_wait', state: 'queued', reason: 'retry budget remains' },
          }),
        )
      } else {
        events.push(
          makeEvent({
            kind: 'work.state',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: work.work_id,
            attemptId: attempt.attempt_id,
            payload: { from: work.state, state: 'exhausted', reason: 'lease expired' },
          }),
        )
      }
      actions.push({
        class: 'execution-orphan',
        work_id: work.work_id,
        attempt_id: attempt.attempt_id,
        action: workState,
      })
    }

    for (const mapping of state.pane_mappings.filter((candidate) => candidate.state !== 'closed')) {
      if (handledMappingIds.has(mapping.mapping_id)) continue
      const attempt = state.attempts.find(
        (candidate) => candidate.attempt_id === mapping.attempt_id,
      )
      const lease = attempt
        ? state.leases.find((candidate) => candidate.lease_id === attempt.lease_id)
        : undefined
      const validExecution =
        Boolean(attempt && ACTIVE_ATTEMPT.has(attempt.state)) &&
        Boolean(lease && lease.released_at === null && Date.parse(lease.expires_at) > nowMs)
      if (validExecution && observedPanes.some((pane) => pane.pane_id === mapping.pane_id)) continue
      const matched = observedPanes.find(
        (pane) =>
          pane.resume_token && runtimeDigest(pane.resume_token) === mapping.resume_token_digest,
      )
      if (matched && validExecution) {
        events.push(
          makeEvent({
            kind: 'pane.state',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: mapping.work_id,
            attemptId: mapping.attempt_id,
            payload: {
              mapping_id: mapping.mapping_id,
              pane_id: matched.pane_id,
              state: 'reattached',
            },
          }),
        )
        actions.push({
          class: 'pane-orphan',
          work_id: mapping.work_id,
          attempt_id: mapping.attempt_id,
          action: `reattached:${matched.pane_id}`,
        })
      } else if (!validExecution || nowMs - Date.parse(mapping.updated_at) >= paneGraceMs) {
        events.push(
          makeEvent({
            kind: 'pane.state',
            actor: 'runtime-reconciler',
            recordedAt,
            workId: mapping.work_id,
            attemptId: mapping.attempt_id,
            payload: { mapping_id: mapping.mapping_id, state: 'closed' },
          }),
        )
        actions.push({
          class: 'pane-orphan',
          work_id: mapping.work_id,
          attempt_id: mapping.attempt_id,
          action: 'closed',
        })
      }
    }
    return { value: actions, events }
  })
}

function readDurableEvidenceReceipts(repoRoot: string): Array<Record<string, any>> {
  const path = join(repoRoot, '.clade', 'ai-control-plane', 'evidence.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const receipt = requireRecord('durable evidence receipt', JSON.parse(line))
      assertExactKeys('durable evidence receipt', receipt, [
        'artifact_type',
        'schema_version',
        'evidence_id',
        'change_id',
        'requirement_id',
        'requirement_revision',
        'work_id',
        'attempt_id',
        'span_id',
        'verification_policy',
        'evidence_kind',
        'subject_digest',
        'references',
        'recorded_at',
        'recorded_by',
      ])
      if (receipt.artifact_type !== 'evidence.receipt' || receipt.schema_version !== 1) {
        throw new Error('durable evidence receipt contract version mismatch')
      }
      requirePattern('evidence_id', receipt.evidence_id, /^evd_[A-Za-z0-9]+$/)
      requirePattern('evidence work_id', receipt.work_id, WORK_ID)
      requirePattern('evidence attempt_id', receipt.attempt_id, ATTEMPT_ID)
      requireDigest('evidence subject_digest', receipt.subject_digest)
      iso(receipt.recorded_at)
      if (!Array.isArray(receipt.references) || receipt.references.length === 0) {
        throw new Error('durable evidence receipt references are required')
      }
      return receipt
    })
}

export function normalizeLegacyWorkState(input: {
  repoRoot: string
  state: 'settled' | 'failed' | 'in-flight' | 'accepted' | 'dropped' | 'orphan'
  workId?: string | null
  evidenceId?: string | null
  leaseId?: string | null
  now?: string | Date
}): {
  machine_state: MachineWorkState
  human_disposition: 'none' | 'accepted' | 'dropped'
  action: string
} {
  if (input.state === 'orphan') {
    return { machine_state: 'quarantined', human_disposition: 'none', action: 'classify_orphan' }
  }
  const state = readRuntimeState(input.repoRoot)
  const work = input.workId
    ? state.works.find((candidate) => candidate.work_id === input.workId)
    : undefined
  const attempts = work
    ? state.attempts.filter((candidate) => candidate.work_id === work.work_id)
    : []
  const latestAttempt = attempts.at(-1)
  const evidence = input.evidenceId
    ? readDurableEvidenceReceipts(input.repoRoot).find(
        (candidate) => candidate.evidence_id === input.evidenceId,
      )
    : undefined
  const doneIsProven = Boolean(
    work?.state === 'done' &&
    latestAttempt?.state === 'succeeded' &&
    evidence &&
    evidence.work_id === work.work_id &&
    evidence.attempt_id === latestAttempt.attempt_id &&
    evidence.change_id === work.change_id,
  )
  const authorizationAt = trustedAuthorizationTimestamp()
  const lease = input.leaseId
    ? state.leases.find((candidate) => candidate.lease_id === input.leaseId)
    : undefined
  const runningIsProven = Boolean(
    work?.state === 'running' &&
    latestAttempt &&
    ACTIVE_ATTEMPT.has(latestAttempt.state) &&
    lease &&
    lease.work_id === work.work_id &&
    lease.attempt_id === latestAttempt.attempt_id &&
    lease.released_at === null &&
    Date.parse(lease.expires_at) > Date.parse(authorizationAt),
  )
  const retryState =
    work && attempts.length - work.handover_count <= work.retry_limit
      ? ('retry_wait' as const)
      : ('exhausted' as const)
  if (input.state === 'settled') {
    return doneIsProven
      ? { machine_state: 'done', human_disposition: 'none', action: 'migrated' }
      : { machine_state: 'legacy_unverified', human_disposition: 'none', action: 'quarantined' }
  }
  if (input.state === 'failed') {
    return retryState === 'retry_wait'
      ? { machine_state: retryState, human_disposition: 'none', action: 'requeue' }
      : { machine_state: retryState, human_disposition: 'none', action: 'terminalized' }
  }
  if (input.state === 'in-flight') {
    return runningIsProven
      ? { machine_state: 'running', human_disposition: 'none', action: 'preserved' }
      : {
          machine_state: retryState,
          human_disposition: 'none',
          action: 'abandon_then_reconcile',
        }
  }
  if (input.state === 'accepted' || input.state === 'dropped') {
    const canonicalState = doneIsProven
      ? 'done'
      : runningIsProven
        ? 'running'
        : work && work.state !== 'done' && work.state !== 'running'
          ? work.state
          : 'legacy_unverified'
    return {
      machine_state: canonicalState,
      human_disposition: input.state,
      action:
        canonicalState === 'legacy_unverified'
          ? 'reconstruction_claim_quarantined'
          : 'human_disposition_preserved',
    }
  }
  throw new Error(`unsupported legacy state: ${input.state}`)
}

function otelAttributes(attributes: Record<string, string | number | boolean>) {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value:
      typeof value === 'string'
        ? { stringValue: value }
        : typeof value === 'boolean'
          ? { boolValue: value }
          : Number.isInteger(value)
            ? { intValue: String(value) }
            : { doubleValue: value },
  }))
}

function nanos(timestamp: string): string {
  return String(BigInt(Date.parse(timestamp)) * 1_000_000n)
}

export function mapRuntimeToOtel(repoRoot: string): Record<string, unknown> {
  const state = readRuntimeState(repoRoot)
  const spans: Array<Record<string, unknown>> = []
  for (const attempt of state.attempts) {
    const links = [attempt.resumes_attempt_id, attempt.supersedes_attempt_id]
      .filter((value): value is string => Boolean(value))
      .map((linkedAttemptId) => {
        const linked = state.attempts.find((candidate) => candidate.attempt_id === linkedAttemptId)
        return linked
          ? {
              traceId: linked.root_trace_id,
              spanId: linked.root_span_id,
              attributes: otelAttributes({
                relationship:
                  linkedAttemptId === attempt.resumes_attempt_id ? 'resume' : 'supersession',
              }),
            }
          : null
      })
      .filter(Boolean)
    spans.push({
      traceId: attempt.root_trace_id,
      spanId: attempt.root_span_id,
      name: 'work.execute',
      kind: 1,
      startTimeUnixNano: nanos(attempt.started_at),
      endTimeUnixNano: ACTIVE_ATTEMPT.has(attempt.state) ? undefined : nanos(attempt.updated_at),
      attributes: otelAttributes({
        'clade.work.id': attempt.work_id,
        'clade.change.id': attempt.change_id,
        'clade.attempt.id': attempt.attempt_id,
        'clade.worker.id': attempt.worker_id,
        'clade.repo.id': attempt.repo_id,
        'clade.engine.name': attempt.engine,
        'clade.engine.version': attempt.engine_version,
        'clade.grant.digest': attempt.capability_grant_digest,
        'clade.initiative.id': attempt.initiative_id ?? '',
        'clade.requirement.id': attempt.requirement_id ?? '',
        'clade.requirement.revision': attempt.requirement_revision ?? 0,
        'clade.scenario.id': attempt.scenario_id ?? '',
        'clade.code.revision': attempt.code_revision ?? '',
        'clade.intent.revision': attempt.intent_revision ?? 0,
        'clade.worktree.id': attempt.worktree_id ?? '',
        'clade.workspace.id': attempt.workspace_id ?? '',
        'clade.pane.id': attempt.pane_id ?? '',
      }),
      links,
    })
    if (
      attempt.resumes_attempt_id &&
      !state.trace_observations.some(
        (observation) =>
          observation.attempt_id === attempt.attempt_id && observation.name === 'runtime.resume',
      )
    ) {
      const previous = state.attempts.find(
        (candidate) => candidate.attempt_id === attempt.resumes_attempt_id,
      )
      spans.push({
        traceId: attempt.root_trace_id,
        spanId: runtimeDigest(`${attempt.attempt_id}:runtime.resume`).slice(7, 23),
        parentSpanId: attempt.root_span_id,
        name: 'runtime.resume',
        kind: 1,
        startTimeUnixNano: nanos(attempt.started_at),
        endTimeUnixNano: nanos(attempt.started_at),
        attributes: otelAttributes({
          'clade.work.id': attempt.work_id,
          'clade.attempt.id': attempt.attempt_id,
          'clade.resumes.attempt.id': attempt.resumes_attempt_id,
        }),
        links: previous
          ? [
              {
                traceId: previous.root_trace_id,
                spanId: previous.root_span_id,
                attributes: otelAttributes({ relationship: 'resume' }),
              },
            ]
          : [],
      })
    }
  }
  for (const observation of state.trace_observations) {
    const attempt = state.attempts.find(
      (candidate) => candidate.attempt_id === observation.attempt_id,
    )
    if (!attempt) continue
    spans.push({
      traceId: attempt.root_trace_id,
      spanId: observation.span_id,
      parentSpanId: observation.parent_span_id,
      name: observation.name,
      kind: 1,
      startTimeUnixNano: nanos(observation.started_at),
      endTimeUnixNano: observation.ended_at ? nanos(observation.ended_at) : undefined,
      attributes: otelAttributes(observation.attributes),
      links: observation.links.map((link) => ({
        traceId: link.trace_id,
        spanId: link.span_id,
        attributes: otelAttributes({ relationship: link.relationship }),
      })),
    })
  }
  for (const message of state.messages.filter((candidate) => candidate.authoritative_delegation)) {
    const parentAttempt = state.attempts.findLast((attempt) => attempt.work_id === message.work_id)
    if (!parentAttempt) continue
    const childAttempt = message.child_work_id
      ? state.attempts.findLast((attempt) => attempt.work_id === message.child_work_id)
      : null
    spans.push({
      traceId: parentAttempt.root_trace_id,
      spanId: runtimeDigest(`${message.message_id}:work.delegate`).slice(7, 23),
      parentSpanId: parentAttempt.root_span_id,
      name: 'work.delegate',
      kind: 1,
      startTimeUnixNano: nanos(message.recorded_at),
      endTimeUnixNano: nanos(message.recorded_at),
      attributes: otelAttributes({
        'clade.work.id': message.work_id,
        'clade.child.work.id': message.child_work_id ?? '',
        'clade.message.id': message.message_id,
      }),
      links: childAttempt
        ? [
            {
              traceId: childAttempt.root_trace_id,
              spanId: childAttempt.root_span_id,
              attributes: otelAttributes({ relationship: 'delegation' }),
            },
          ]
        : [],
    })
  }
  return {
    resourceSpans: [
      {
        resource: { attributes: otelAttributes({ 'service.name': 'clade-ai-control-plane' }) },
        scopeSpans: [{ scope: { name: 'clade.runtime', version: '1' }, spans }],
      },
    ],
  }
}

export function runtimeHasActiveAttemptOrLease(repoRoot: string, workIds?: Set<string>): boolean {
  const state = readRuntimeState(repoRoot)
  return (
    state.attempts.some(
      (attempt) => (!workIds || workIds.has(attempt.work_id)) && ACTIVE_ATTEMPT.has(attempt.state),
    ) ||
    state.leases.some(
      (lease) => (!workIds || workIds.has(lease.work_id)) && lease.released_at === null,
    )
  )
}
