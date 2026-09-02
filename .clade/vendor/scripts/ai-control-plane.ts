// 🔒 LOCKED — managed by clade · Source: vendor/scripts/ai-control-plane.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/ai-control-plane.ts
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

import { atomicWriteText } from './lib/atomic-file.ts'
import {
  assertBindingCommittedIfGoverned,
  controlPlaneIntentPath,
  toOpenSpecAlias,
} from './ai-control-plane-profile.ts'
import {
  endSpan,
  markWorkDone,
  openWork,
  readEvents,
  startSpan,
  type SpanHandle,
} from './flow/emit.ts'
import { redactPayload } from '../signals/redact.ts'
import {
  beginRuntimeAttempt,
  capabilityGrantDigest,
  ensurePaneIdentity,
  handOffRuntimeAttempt,
  ensureRuntimeWork,
  finishRuntimeAttemptBySpan,
  markRuntimeFlowStarted,
  prepareRuntimeAttemptFinish,
  readRuntimeState,
  reconcileRuntimeFlowBoundaries,
  reconcileRuntimeEngine,
  registerCapabilityGrant,
  registerWorkerProfile,
  type CapabilityGrant,
  type RuntimeDigest,
  type RuntimeState,
  type WorkerProfile,
} from './ai-control-plane-runtime.ts'

const ID = {
  change: /^chg_[A-Za-z0-9]+$/,
  requirement: /^req_[A-Za-z0-9]+$/,
  workSpec: /^wsp_[A-Za-z0-9]+$/,
  // Minted by the flow controller (`openWork`), never here — plan section 3.2 rule 7.
  work: /^W-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9][a-z0-9-]*$/,
  attempt: /^att_[A-Za-z0-9]+$/,
  evidence: /^evd_[A-Za-z0-9]+$/,
  gate: /^gate_[A-Za-z0-9]+$/,
  span: /^[0-9a-f]{16}$/,
}
const DIGEST = /^sha256:[0-9a-f]{64}$/
const PROJECTOR = 'ai-control-plane/tasks-v1'

export type Digest = `sha256:${string}`

export interface RequirementRef {
  requirement_id: string
  revision: number
  text_digest: Digest
}

export interface NormalizedOpsxChange {
  artifact_type: 'normalized.change'
  schema_version: 1
  change_id: string
  /**
   * Provenance, not authority. `spectra-v1` appears only on the read path
   * (`readWorkflowChange`); every writer in this module still requires an `opsx-v2`
   * assignment, so widening this does not widen who may write.
   */
  source_profile: 'spectra-v1' | 'opsx-v2'
  source_revision: string
  source_digest: Digest
  intent_revision: number
  requirements: RequirementRef[]
  clarification_ids: string[]
  impact_ids: string[]
  work_plan_revision: number
  normalized_at: string
}

export interface OpsxChangeSource {
  profile_assignment: Record<string, any>
  native_artifacts: Array<Record<string, any>>
  normalized_change?: Record<string, any>
}

/**
 * A change that is still owned by Spectra. Its artifacts are preserved verbatim under
 * `legacy_artifacts` and pinned by `preserved_evidence_digest`, so normalization is a pure
 * read: nothing rewrites a legacy change in place, and the legacy reader stays available
 * until every Spectra-owned change is archived (retirement gate 8).
 */
export interface SpectraLegacySource {
  profile_assignment: Record<string, any>
  legacy_source: {
    artifact_root: string
    preserved_evidence_digest: Digest
    legacy_artifacts: Array<Record<string, any>>
  }
  normalized_change?: Record<string, any>
  projector_input?: Record<string, any>
}

export type WorkflowChangeSource = OpsxChangeSource | SpectraLegacySource

/**
 * One append-only entry in a change's intent revision ledger.
 *
 * The ledger lives beside the intent source but under its own directory so that it stays a
 * machine-local fact: `.clade/ai-control-plane/intent/` is tracked canonical state (TD-849),
 * and a revision ledger that grows on every read would not belong in that set.
 */
export interface IntentRevisionRecord {
  artifact_type: 'intent.revision'
  schema_version: 1
  change_id: string
  revision: number
  intent_revision: number
  source_digest: Digest
  source_revision: string
  recorded_at: string
  previous_record_digest: Digest | null
}

export interface IntentArchiveResult {
  changeId: string
  sourcePath: string
  preserved: true
}

/**
 * The storage seam of §10.3. The filesystem/git implementation below is the reliable path;
 * OpenSpec Stores beta would be a second implementation of the same five methods, proven
 * equivalent by contract tests. Work, decision and evidence history never depends solely on
 * a beta store — those ledgers stay in `.clade/ai-control-plane/`.
 */
export interface IntentStore {
  create(source: WorkflowChangeSource): Promise<string>
  read(changeId: string): { source: WorkflowChangeSource; normalized: NormalizedOpsxChange }
  list(): string[]
  profile(changeId: string): 'spectra-v1' | 'opsx-v2' | null
  archive(changeId: string): IntentArchiveResult
}

export interface EvidenceReference {
  kind: 'report' | 'trace' | 'screenshot' | 'api-receipt'
  locator: string
  digest: Digest
}

export interface EvidenceReceipt {
  artifact_type: 'evidence.receipt'
  schema_version: 1
  evidence_id: string
  change_id: string
  requirement_id: string
  requirement_revision: number
  work_id: string
  attempt_id: string
  span_id: string
  verification_policy: string
  evidence_kind: EvidenceReference['kind']
  subject_digest: Digest
  references: EvidenceReference[]
  recorded_at: string
  recorded_by: string
}

export interface ArchivePredicates {
  current_intent_valid: boolean
  impacts_current_and_consistent: boolean
  required_work_terminal_with_current_evidence: boolean
  required_gates_terminal: boolean
  no_active_attempt_or_lease: boolean
  projection_cursors_current: boolean
  single_writer: boolean
  no_stale_evidence: boolean
}

export interface ArchiveReadiness {
  artifact_type: 'archive.readiness'
  schema_version: 1
  change_id: string
  intent_revision: number
  evaluated_at: string
  predicates: ArchivePredicates
  ready: boolean
  blocking_reasons: string[]
}

export type HumanGateFamily =
  | 'product-ruling'
  | 'experience-acceptance'
  | 'external-action'
  | 'exception-escalation'

export type HumanGateState = 'open' | 'answered' | 'expired' | 'cancelled'

export interface HumanGateProjection {
  gate_id: string
  family: HumanGateFamily
  state: HumanGateState
  judgment: string
  why_actionable: string
  expected_behavior: string
  actual_evidence: Array<{ label: string; locator: string }>
  consequences: Array<{ option: string; outcome: string }>
  recommendation: string | null
  controls: {
    mode: 'choose-option' | 'provide-value' | 'accept-reject' | 'confirm-action' | 'recovery'
    options: string[]
    requested_fields: string[]
  }
  response_url: string
  affected_requirement_ids: string[]
  affected_work_spec_ids: string[]
  decision_id: string | null
  decision_outcome: string | null
  decision_evidence_links: string[]
}

export interface HumanDecisionRecord {
  artifact_type: 'human.decision'
  schema_version: 1
  decision_id: string
  gate_id: string
  change_id: string
  outcome: string
  provided_fields: Record<string, string>
  evidence_links: string[]
  recorded_at: string
}

export interface FeatureMapReference {
  reference_id: string
  feature_id: string
  feature_map_locator: string
  entry_point: string
  subject_revision: number
  digest: Digest
  receipt_id: string | null
  requirement_id: string
  work_spec_id: string
}

export interface ImpactProjection {
  impact_id: string
  requirement_id: string
  requirement_revision: number
  target_type: string
  target_id: string
  consistency: string
  rationale: string
}

export interface ControlPlaneProjection {
  checkpoint: {
    artifact_type: 'projection.updated'
    schema_version: 1
    projection_id: string
    change_id: string
    projector: string
    through_cursor: string
    input_digest: Digest
    output_digest: Digest
    output_path: string
    recorded_at: string
  }
  profile: 'opsx-v2'
  title: string
  change_id: string
  intent_revision: number
  source_digest: Digest
  requirements: RequirementRef[]
  work_records: Array<{
    work_spec_id: string
    label: string
    depends_on: string[]
    work_id: string | null
    state: 'planned' | 'ready' | 'running' | 'blocked' | 'done'
    verification_policy: string
    evidence_ids: string[]
    blocking_gate_ids: string[]
    latest_valid_evidence_id: string | null
    human_disposition: 'none' | 'waiting' | 'resolved'
  }>
  attempts: Array<{
    attempt_id: string
    work_id: string
    span_id: string
    worker_id: string | null
    engine: string | null
    engine_version: string | null
    lease_id: string | null
    worktree_id: string | null
    workspace_id: string | null
    pane_id: string | null
    resumes_attempt_id: string | null
    state:
      | 'leased'
      | 'running'
      | 'paused'
      | 'abandoned'
      | 'succeeded'
      | 'failed'
      | 'exhausted'
      | 'cancelled'
      | 'superseded'
  }>
  runtime_topology: Omit<RuntimeState, 'events'> & { event_count: number }
  evidence: EvidenceReceipt[]
  impact_matrix: ImpactProjection[]
  human_gates: HumanGateProjection[]
  attention_cards: HumanGateProjection[]
  feature_map_refs: FeatureMapReference[]
  archive_readiness: ArchiveReadiness
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256(value: string | Buffer | unknown): Digest {
  const body = typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)
  return `sha256:${createHash('sha256').update(body).digest('hex')}`
}

export function mintOpaqueId(prefix: 'att' | 'evd' | 'prj'): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

function requireId(label: keyof typeof ID, value: unknown): string {
  if (typeof value !== 'string' || !ID[label].test(value)) {
    throw new Error(`${label}_id has invalid canonical form: ${JSON.stringify(value)}`)
  }
  return value
}

function requireDigest(label: string, value: unknown): Digest {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new Error(`${label} must be sha256:<64 lowercase hex>`)
  }
  return value as Digest
}

function artifact<T extends Record<string, any>>(source: OpsxChangeSource, type: string): T {
  const matches = source.native_artifacts.filter((candidate) => candidate.artifact_type === type)
  if (matches.length !== 1)
    throw new Error(`opsx-v2 requires exactly one ${type}, got ${matches.length}`)
  return matches[0] as T
}

export function readOpsxChange(
  source: OpsxChangeSource,
  normalizedAt?: string,
): NormalizedOpsxChange {
  const assignment = source.profile_assignment
  if (assignment?.profile !== 'opsx-v2') {
    throw new Error(
      `persisted workflow_profile must be opsx-v2, got ${JSON.stringify(assignment?.profile)}`,
    )
  }
  const changeId = requireId('change', assignment.change_id)
  const intake = artifact(source, 'intent.intake_batch')
  const plan = artifact(source, 'intent.work_plan')
  const impacts = source.native_artifacts.filter(
    (candidate) => candidate.artifact_type === 'requirement.impact',
  )
  if (impacts.length === 0) throw new Error('opsx-v2 requires at least one requirement.impact')
  for (const candidate of [intake, plan, ...impacts]) {
    if (candidate.change_id !== changeId)
      throw new Error(`${candidate.artifact_type} change_id mismatch`)
  }
  const requirementById = new Map<string, RequirementRef>()
  for (const impact of impacts) {
    const requirement = {
      requirement_id: requireId('requirement', impact.requirement_id),
      revision: Number(impact.requirement_revision),
      text_digest: sha256(String(impact.source_quote)),
    }
    const previous = requirementById.get(requirement.requirement_id)
    if (
      previous &&
      (previous.revision !== requirement.revision ||
        previous.text_digest !== requirement.text_digest)
    ) {
      throw new Error(`requirement impacts disagree for ${requirement.requirement_id}`)
    }
    requirementById.set(requirement.requirement_id, requirement)
  }
  const requirements = [...requirementById.values()].toSorted((a, b) =>
    a.requirement_id.localeCompare(b.requirement_id),
  )
  const locator = String(intake.source?.locator ?? changeId)
  return {
    artifact_type: 'normalized.change',
    schema_version: 1,
    change_id: changeId,
    source_profile: 'opsx-v2',
    source_revision: `opsx:${locator}:r${Number(intake.change_revision)}`,
    source_digest: requireDigest('profile source_digest', assignment.source_digest),
    intent_revision: Number(plan.intent_revision),
    requirements,
    clarification_ids: source.native_artifacts
      .filter((candidate) => candidate.artifact_type === 'intent.clarification')
      .map((candidate) => String(candidate.clarification_id))
      .toSorted(),
    impact_ids: impacts.map((impact) => String(impact.impact_id)).toSorted(),
    work_plan_revision: Number(plan.plan_revision),
    normalized_at: normalizedAt ?? String(plan.generated_at),
  }
}

/**
 * Reduce any workflow source to the one shape the normalizer understands.
 *
 * A Spectra source is read *through* its preserved artifacts rather than re-derived: the
 * digest pins exactly what was preserved, so a legacy change cannot drift under the reader.
 * The synthesized assignment is a local value, never written anywhere — profile ownership
 * still comes only from the committed intent binding.
 */
export function canonicalOpsxSource(source: WorkflowChangeSource): {
  source: OpsxChangeSource
  profile: 'spectra-v1' | 'opsx-v2'
} {
  const assignment = source.profile_assignment
  if (assignment?.profile === 'opsx-v2') {
    return { source: source as OpsxChangeSource, profile: 'opsx-v2' }
  }
  if (assignment?.profile !== 'spectra-v1' || !('legacy_source' in source)) {
    throw new Error(`unsupported workflow profile: ${JSON.stringify(assignment?.profile)}`)
  }
  const legacy = (source as SpectraLegacySource).legacy_source
  const preserved = requireDigest(
    'legacy preserved_evidence_digest',
    legacy.preserved_evidence_digest,
  )
  if (!Array.isArray(legacy.legacy_artifacts) || legacy.legacy_artifacts.length === 0) {
    throw new Error('legacy normalization requires preserved legacy_artifacts')
  }
  if (sha256(canonical(legacy.legacy_artifacts)) !== preserved) {
    throw new Error('legacy preserved evidence digest does not match legacy_artifacts')
  }
  return {
    profile: 'spectra-v1',
    source: {
      profile_assignment: { ...assignment, profile: 'opsx-v2', source_digest: preserved },
      native_artifacts: legacy.legacy_artifacts,
    },
  }
}

/**
 * Workflow-neutral read (§10.2): legacy and OPSX changes normalize into the same canonical
 * contract, differing only in the provenance recorded on `source_profile` / `source_revision`.
 * Every projector and reader downstream of this function is profile-blind, which is what
 * makes retirement gate 3 (equivalent projections) checkable rather than aspirational.
 */
export function readWorkflowChange(source: WorkflowChangeSource): NormalizedOpsxChange {
  const canonicalSource = canonicalOpsxSource(source)
  const normalized = readOpsxChange(canonicalSource.source)
  if (canonicalSource.profile === 'opsx-v2') return normalized
  const legacy = (source as SpectraLegacySource).legacy_source
  return {
    ...normalized,
    source_profile: 'spectra-v1',
    source_revision: `legacy:${legacy.artifact_root}:r${normalized.intent_revision}`,
  }
}

export function readOpsxChangeFile(path: string): {
  source: OpsxChangeSource
  normalized: NormalizedOpsxChange
} {
  const source = JSON.parse(readFileSync(path, 'utf8')) as OpsxChangeSource
  return { source, normalized: readOpsxChange(source) }
}

function workPlan(source: OpsxChangeSource): Record<string, any> {
  return artifact(source, 'intent.work_plan')
}

/**
 * Mint seed for the flow controller, derived from the work spec's own identity.
 *
 * `work_spec_id` rather than the label: the label is prose a human rewords, and a reworded label
 * that changed the seed would read as if the work had been renamed. The seed is not an identity
 * key either way (rule 7) — this only keeps the minted id legible on `/board`.
 */
function workSlug(spec: Record<string, any>): string {
  return String(spec.work_spec_id)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function materializeWork(input: {
  repoRoot: string
  source: OpsxChangeSource
  workSpecId: string
  workId?: string
  actor?: string
  now?: string | Date
}): { work_id: string; span_id: string } {
  const normalized = readOpsxChange(input.source)
  // Before `readEvents`, and so before `openWork` can mint a card: item 2's refusal covers the
  // flow spine too (ruling (f)). Gating only at `ensureRuntimeWork` still refused the work, but
  // left a `work.open` event behind — a card on `/board` with no runtime behind it, which is
  // exactly the half-real state the refusal exists to prevent.
  assertBindingCommittedIfGoverned(input.repoRoot, normalized.change_id)
  const plan = workPlan(input.source)
  const spec = plan.work_specs.find((candidate: any) => candidate.work_spec_id === input.workSpecId)
  if (!spec) throw new Error(`unknown work_spec_id: ${input.workSpecId}`)
  const requirement = spec.requirement_refs?.[0]
  const existing = readEvents(input.repoRoot).filter(
    (event) =>
      event.kind === 'work.open' &&
      event.payload?.change_id === normalized.change_id &&
      event.payload?.work_spec_id === spec.work_spec_id,
  )
  if (existing.length > 1) {
    throw new Error(`multiple work materializations for work_spec_id: ${input.workSpecId}`)
  }
  if (existing.length === 1) {
    const current = existing[0]
    const currentWorkId = requireId('work', current.work_id)
    if (input.workId !== undefined && input.workId !== currentWorkId) {
      throw new Error(
        `work_spec_id ${input.workSpecId} is already materialized as ${currentWorkId}`,
      )
    }
    if (
      current.payload?.requirement_id !== requirement?.id ||
      current.payload?.requirement_revision !== Number(requirement?.revision) ||
      current.payload?.verification_policy !== String(spec.verification_policy)
    ) {
      throw new Error(`existing materialization is stale for work_spec_id: ${input.workSpecId}`)
    }
    ensureRuntimeWork({
      repoRoot: input.repoRoot,
      workId: currentWorkId,
      repoId: basename(input.repoRoot),
      changeId: normalized.change_id,
      now: input.now,
    })
    return {
      work_id: currentWorkId,
      span_id: requireId('span', current.span_id),
    }
  }
  // The flow controller is the work-id allocator (plan section 3.2 rule 7). An explicit `workId`
  // is still honoured — a caller re-materializing a known item is naming it, not minting it — but
  // with nothing supplied this asks `openWork` for a `W-<date>-<slug>` instead of minting a second
  // vocabulary the spine's own readers reject (`flow/nodes/ingest-pi-ledger.ts` WORK_ID_RE).
  //
  // The slug is a mint seed and nothing else: renaming the work spec never renames the id.
  const opened = openWork({
    slug: workSlug(spec),
    work_id: input.workId === undefined ? null : requireId('work', input.workId),
    actor: input.actor ?? 'flow-controller',
    substrate: 'claude-code',
    title: String(spec.label),
    payload: {
      change_id: normalized.change_id,
      requirement_id: requireId('requirement', requirement?.id),
      requirement_revision: Number(requirement?.revision),
      work_spec_id: requireId('workSpec', spec.work_spec_id),
      verification_policy: String(spec.verification_policy),
    },
    cwd: input.repoRoot,
  })
  const workId = requireId('work', opened.work_id)
  ensureRuntimeWork({
    repoRoot: input.repoRoot,
    workId,
    repoId: basename(input.repoRoot),
    changeId: normalized.change_id,
    now: input.now,
  })
  return opened
}

function ensureDefaultRuntimeIdentity(
  repoRoot: string,
  actor: string,
  now?: string | Date,
  engineOverride?: { engine: string; version: string },
): {
  worker: WorkerProfile
  grant: CapabilityGrant
  engine: string
  engineVersion: string
} {
  const workerId = 'wkr_implementation'
  const engine = engineOverride?.engine ?? 'claude-code'
  const engineVersion = engineOverride?.version ?? process.env.CLAUDE_CODE_VERSION ?? 'unversioned'
  const registeredAt = now instanceof Date ? now.toISOString() : (now ?? new Date().toISOString())
  let state = readRuntimeState(repoRoot)
  let worker = state.workers.find((candidate) => candidate.worker_id === workerId)
  if (!worker) {
    worker = registerWorkerProfile(repoRoot, {
      artifact_type: 'worker.profile',
      schema_version: 1,
      worker_id: workerId,
      name: actor,
      role: 'implementation',
      capabilities: ['code', 'test', 'evidence'],
      allowed_repositories: [basename(repoRoot)],
      allowed_folders: ['.'],
      delegation_grants: [],
      messaging_grants: [],
      routine_triggers: [],
      default_engines: [{ engine, version: engineVersion }],
      evidence_policy: 'canonical-evidence-v1',
      verification_policy: 'declared-work-policy',
      registered_at: registeredAt,
    })
    state = readRuntimeState(repoRoot)
  }
  let grant = state.grants.find((candidate) => candidate.grant_id === 'grt_implementation')
  if (!grant) {
    const body: Omit<CapabilityGrant, 'digest'> = {
      grant_id: 'grt_implementation',
      worker_id: workerId,
      repositories: [basename(repoRoot)],
      folders: ['.'],
      tools: ['code', 'test', 'evidence'],
      network: [],
      credentials: [],
      child_work_creation: false,
      messaging: false,
      pause_resume: false,
      global_control: false,
      initiative_ids: [],
      // `registeredAt`, NEVER `worker.registered_at` (plan section 9.8 rule 6). When the worker
      // already exists, its registration timestamp is older than everything in the journal, and
      // `mutateRuntime` refuses an event whose `recorded_at` precedes the last one — so a grant
      // issued on a second dispatch would be rejected with a message about the journal clock.
      issued_at: registeredAt,
      expires_at: null,
    }
    grant = registerCapabilityGrant(repoRoot, { ...body, digest: capabilityGrantDigest(body) })
  }
  // Version too, not just the name: `validateAttemptAdmission` requires the registered version to
  // equal the attempt's, so an engine row left at yesterday's version refuses every attempt with a
  // message about the engine rather than about the version — the half that actually moved.
  if (
    !state.engines.some(
      (candidate) => candidate.engine === engine && candidate.version === engineVersion,
    )
  ) {
    reconcileRuntimeEngine(repoRoot, {
      artifact_type: 'runtime.engine',
      schema_version: 1,
      engine,
      path: engine,
      version: engineVersion,
      health: 'healthy',
      ownership: 'clade-managed',
      structured_output: true,
      resume_capability: true,
      incompatibilities: [],
      // Same reason as the grant's `issued_at` above (plan section 9.8 rule 6). This is the half
      // that was measured: a real Herdr dispatch into a journal that already held one engine came
      // back `attempt not recorded (fail-open): runtime events cannot backfill the canonical
      // journal clock`, because the FIRST engine's registration had set `worker.registered_at`
      // and every later engine copied it. Tests never saw it — each one starts a fresh journal,
      // where the copied timestamp is also the newest one.
      validated_at: registeredAt,
    })
  }
  return { worker, grant, engine, engineVersion }
}

export function startAttempt(input: {
  repoRoot: string
  workId: string
  attemptId?: string
  actor?: string
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
  now?: string | Date
}): { attempt_id: string; lease_id: string; handle: SpanHandle } {
  const workId = requireId('work', input.workId)
  const attemptId = requireId('attempt', input.attemptId ?? mintOpaqueId('att'))
  const identity = ensureDefaultRuntimeIdentity(
    input.repoRoot,
    input.actor ?? 'implementation-worker',
    input.now,
  )
  const workOpen = readEvents(input.repoRoot).find(
    (event) => event.kind === 'work.open' && event.work_id === workId,
  )
  const declaredRequirementRevision = Number(workOpen?.payload?.requirement_revision)
  const rootSpanId = randomUUID().replaceAll('-', '').slice(0, 16)
  const attempt = beginRuntimeAttempt({
    repoRoot: input.repoRoot,
    workId,
    workerId: identity.worker.worker_id,
    engine: identity.engine,
    engineVersion: identity.engineVersion,
    capabilityGrantDigest: identity.grant.digest,
    rootSpanId,
    attemptId,
    leaseDurationMs: input.leaseDurationMs,
    scopeFolder: input.scopeFolder,
    worktreeId: input.worktreeId,
    worktreeHead: input.worktreeHead,
    workspaceId: input.workspaceId,
    paneId: input.paneId,
    initiativeId: input.initiativeId,
    requirementId: input.requirementId ?? workOpen?.payload?.requirement_id ?? null,
    requirementRevision:
      input.requirementRevision ??
      (Number.isInteger(declaredRequirementRevision) ? declaredRequirementRevision : null),
    scenarioId: input.scenarioId,
    codeRevision: input.codeRevision,
    intentRevision: input.intentRevision,
    resumesAttemptId: input.resumesAttemptId,
    resumeRecordId: input.resumeRecordId,
    resumeToken: input.resumeToken,
    resumeOpsxArtifactDigest: input.resumeOpsxArtifactDigest,
    resumeCheckpointIds: input.resumeCheckpointIds,
    resumeEvidenceIds: input.resumeEvidenceIds,
    supersedesAttemptId: input.supersedesAttemptId,
    actor: input.actor,
    now: input.now,
  })
  const handle = startSpan({
    work_id: workId,
    span_id: rootSpanId,
    kind: 'execute_tool',
    actor: input.actor ?? 'implementation-worker',
    substrate: 'claude-code',
    payload: { attempt_id: attemptId },
    cwd: input.repoRoot,
  })
  const flowStartPersisted = readEvents(input.repoRoot).some(
    (event) => event.span_id === rootSpanId && event.phase === 'start',
  )
  if (!flowStartPersisted) {
    const actions = reconcileRuntimeFlowBoundaries({
      repoRoot: input.repoRoot,
      flowEvents: readEvents(input.repoRoot),
      readFlowEvents: () => readEvents(input.repoRoot),
      boundaryGraceMs: 0,
      actor: 'flow-controller',
      now: input.now,
    })
    if (!actions.some((action) => action.action === 'flow-start-committed')) {
      throw new Error(`flow start was not persisted for runtime attempt ${attemptId}`)
    }
    return { attempt_id: attemptId, lease_id: attempt.lease_id, handle }
  }
  markRuntimeFlowStarted({
    repoRoot: input.repoRoot,
    attemptId,
    actor: input.actor,
    now: input.now,
  })
  return { attempt_id: attemptId, lease_id: attempt.lease_id, handle }
}

export function finishAttempt(input: {
  repoRoot: string
  handle: SpanHandle
  outcome?: 'ok' | 'fail' | 'blocked'
  actor?: string
  now?: string | Date
}): ReturnType<typeof endSpan> {
  const state = readRuntimeState(input.repoRoot)
  const attempt = state.attempts.find(
    (candidate) => candidate.root_span_id === input.handle.span_id,
  )
  if (!attempt) throw new Error(`runtime attempt not found for span: ${input.handle.span_id}`)
  prepareRuntimeAttemptFinish({
    repoRoot: input.repoRoot,
    attemptId: attempt.attempt_id,
    outcome: input.outcome ?? 'ok',
    actor: input.actor,
    now: input.now,
  })
  const result = endSpan(input.handle, { outcome: input.outcome ?? 'ok', cwd: input.repoRoot })
  if (!result.written) return result
  finishRuntimeAttemptBySpan({
    repoRoot: input.repoRoot,
    rootSpanId: input.handle.span_id,
    outcome: input.outcome ?? 'ok',
    actor: input.actor,
    now: input.now,
  })
  return result
}

// ── Dispatcher adapter (plan section 9.8) ────────────────────────────────────────────────────
//
// The Phase 3 runtime is authoritative only if the REAL dispatchers write through it. Both of them
// (`pi-dispatch.ts`, `herdr-session-handoff.ts`) already open a flow span per dispatch; these two
// functions hang an execution attempt and its lease off that same span, so the lease and the span
// are two views of one fact rather than two stores that can disagree.
//
// FAIL-OPEN IS THE CONTRACT, not a convenience. A telemetry write NEVER changes the outcome of the
// work it observes — the same rule `flow/emit.ts` states and both dispatchers already honour. Every
// export below swallows its own errors and returns null; a caller that branches on the return value
// is reading "was an attempt recorded", never "did the dispatch succeed".

/**
 * The change a dispatch belongs to when it belongs to no OPSX change.
 *
 * Most dispatches are not work items of a normalized change: somebody exported `CLADE_WORK_ID` and
 * asked for a pane. `RuntimeWork.change_id` is non-null by contract, so those attempts need a change
 * to hang from, and this is it — one well-known sentinel, named for what it is. It is deliberately
 * NOT written to `.clade/ai-control-plane/intent/`: nothing may read it back as a real change, and
 * an absent intent file is the difference between a placeholder and a forgery.
 */
export const UNMANAGED_DISPATCH_CHANGE = 'chg_unmanageddispatch'

/** Runtime journal writes are machine-local telemetry, never repo content. */
function ensureRuntimeIgnored(repoRoot: string): void {
  const dir = join(repoRoot, '.clade', 'ai-control-plane')
  const ignore = join(dir, '.gitignore')
  if (existsSync(ignore)) return
  mkdirSync(dir, { recursive: true })
  atomicWriteText(ignore, '*\n')
}

export interface DispatchAttemptRef {
  attempt_id: string
  lease_id: string
}

/**
 * Record one dispatch as an execution attempt against the work it came out of.
 *
 * `workId` is whatever the dispatcher already put on its span, and for a DELEGATION that is the
 * CHILD card, never the ambient id (plan section 9.8 rule 1). One work holds one lease and a
 * successful attempt terminalizes its work, so recording a second pi call against the long-lived
 * ambient card would mark that card `done` after the first success and decline every later
 * attempt — the runtime reporting the wrong work, correctly. The dispatchers mint that child at
 * their own door (`workIdFromLabel`); NEVER mint one here, because a second mint is how TD-684 and
 * TD-787 split one piece of work into unrelated traces in the first place.
 *
 * Returns null, quietly, whenever the runtime declines the attempt. The commonest decline is the
 * Phase 3 single-lease rule (`work already has an unreconciled lease`): a fanout puts N panes on one
 * ambient work id, and only the first is an attempt of that work — the rest carry their own slice
 * cards and are recorded against those. NEVER relax that rule from here; a dispatcher that widened
 * the runtime's own invariant to make its telemetry prettier would be the one writer that cannot be
 * trusted about what it recorded.
 */
export function recordAttempt(input: {
  repoRoot: string
  workId: string | null | undefined
  /** `pi:<model>`, `herdr:<launcher>` — SAFE_ID, so a slash is not available as a separator. */
  engine: string
  engineVersion?: string
  rootSpanId: string
  paneId?: string | null
  workspaceId?: string | null
  worktreeId?: string | null
  worktreeHead?: string | null
  /** The predecessor's attempt, from `handOffAttemptForRelay`. Requires the two fields below. */
  resumesAttemptId?: string | null
  resumeRecordId?: string | null
  resumeToken?: string | null
  actor?: string
  leaseDurationMs?: number
  now?: string | Date
}): DispatchAttemptRef | null {
  try {
    if (typeof input.workId !== 'string' || !ID.work.test(input.workId)) return null
    ensureRuntimeIgnored(input.repoRoot)
    // A dispatch card gets NO retry budget (plan section 9.8 rule 3) — a relay's continuation card
    // included, which is why there is no fork here any more. There used to be one: the handover
    // budget rode on `retry_limit`, so a card a relay would later hand over had to be minted with 64
    // to be handed over at all. The runtime now counts handovers apart from retries (rule 8), so the
    // budget a relay needs is no longer this field's to give, and the one thing the fork still
    // changed was the wrong thing — whether a FAILED attempt on the card requeues. It should not:
    // a card whose only evidence is a dispatch is finished when that dispatch fails, relay or not.
    //
    // With a budget, a failed attempt leaves the work in `retry_wait` and the reconciler
    // immediately requeues it, so every failed
    // pi call would sit on the runtime as work waiting to be picked up again — and re-enter
    // `flow status --stalled` and `flow sources` as exactly the noise TD-787 removed. A retry of a
    // dispatch is a NEW dispatch (`--retry-of <label>`), which mints its own child card.
    //
    // The 0 applies ONLY to a card this adapter mints: `retry_limit` is part of runtime work
    // identity, so passing it for a work materialized elsewhere (default 2) would throw — which is
    // one of the two reasons the ensure below is skipped for an existing work.
    const existingWork = readRuntimeState(input.repoRoot).works.find(
      (candidate) => candidate.work_id === input.workId,
    )
    // ONLY materialize a work this adapter is the first to see. For one that already exists,
    // `ensureRuntimeWork` has exactly two outcomes: echo the record back untouched, or throw
    // `runtime work identity is immutable` — and that throw lands in the fail-open catch below as a
    // silently unrecorded attempt. Passing the sentinel `change_id` at an existing card guarantees
    // the throw whenever the card came from `materializeWork` with a real change (W1), which is
    // every relay against an OPSX-managed work.
    //
    // NEVER "fix" this by echoing the existing record's fields back instead: `parent_work_id` is
    // one of the compared fields, and a non-null `parentWorkId` re-runs the full child-work
    // delegation-lineage check (grant still active, causation message still present) — turning a
    // no-op re-assertion into a second chance to fail for reasons that have nothing to do with this
    // dispatch. There is nothing to ensure about a work that is already there.
    if (!existingWork) {
      ensureRuntimeWork({
        repoRoot: input.repoRoot,
        workId: input.workId,
        repoId: basename(input.repoRoot),
        changeId: UNMANAGED_DISPATCH_CHANGE,
        retryLimit: 0,
        now: input.now,
      })
    }
    // The pane the dispatch landed in, under the runtime's OWN name (plan section 9.8). The
    // `w7:p8B` handle the caller passes is mutable — Herdr recycles it the moment the pane is
    // closed and re-created — so it stays on the attempt as an alias while `pane_ref`/`workspace_ref`
    // are minted once per handle and reused by every later attempt in that same pane. Two dispatches
    // into one pane are then recognisably one pane, which no pair of handles can promise.
    //
    // Fail-open like everything else here: a registry write that throws must never take the dispatch
    // down, and an attempt without a pane ref is strictly better than a dispatch that did not happen.
    if (input.paneId && input.workspaceId) {
      try {
        ensurePaneIdentity({
          repoRoot: input.repoRoot,
          workspaceHandle: input.workspaceId,
          paneHandle: input.paneId,
          actor: input.actor ?? 'dispatcher',
          now: input.now,
        })
      } catch (error) {
        process.stderr.write(
          `[clade runtime] pane identity not recorded (fail-open): ${(error as Error).message}\n`,
        )
      }
    }
    const identity = ensureDefaultRuntimeIdentity(
      input.repoRoot,
      input.actor ?? 'dispatcher',
      input.now,
      { engine: input.engine, version: input.engineVersion ?? 'unversioned' },
    )
    const attempt = beginRuntimeAttempt({
      repoRoot: input.repoRoot,
      workId: input.workId,
      workerId: identity.worker.worker_id,
      engine: identity.engine,
      engineVersion: identity.engineVersion,
      capabilityGrantDigest: identity.grant.digest,
      rootSpanId: input.rootSpanId,
      leaseDurationMs: input.leaseDurationMs,
      workspaceId: input.workspaceId ?? null,
      paneId: input.paneId ?? null,
      worktreeId: input.worktreeId ?? null,
      worktreeHead: input.worktreeHead ?? null,
      resumesAttemptId: input.resumesAttemptId ?? null,
      resumeRecordId: input.resumeRecordId ?? null,
      resumeToken: input.resumeToken ?? null,
      now: input.now,
    })
    // The dispatcher opens its span before it calls this, so the start event is already on the
    // spine and the attempt may leave `pending_start` immediately. When it is not (emit is
    // fail-open and may have written nothing), the attempt stays pending and
    // `reconcileRuntimeFlowBoundaries` is the one that closes the gap — NEVER force the transition
    // here, because "the flow event exists" is the only thing that transition is claiming.
    const flowStarted = readEvents(input.repoRoot).some(
      (event) => event.span_id === input.rootSpanId && event.phase === 'start',
    )
    if (flowStarted) {
      markRuntimeFlowStarted({
        repoRoot: input.repoRoot,
        attemptId: attempt.attempt_id,
        now: input.now,
      })
    }
    return { attempt_id: attempt.attempt_id, lease_id: attempt.lease_id }
  } catch (error) {
    // Two declines are the DESIGNED path, not a fault: a fanout puts N panes on one work id and the
    // runtime admits one lease per work. Printing on those would put a scary line in front of every
    // ordinary fanout worker, and a warning that fires on correct behaviour stops being read.
    const message = (error as Error).message
    if (!/unreconciled lease|cannot lease from state/.test(message)) {
      process.stderr.write(`[clade runtime] attempt not recorded (fail-open): ${message}\n`)
    }
    return null
  }
}

/**
 * Stand the current attempt on `workId` down so a successor may take the same work (rule 8).
 *
 * The relay half of `recordAttempt`. Call it BEFORE the successor's dispatch records its own
 * attempt: the runtime admits one lease per work, so a successor that arrives while the
 * predecessor still holds one is declined, and a predecessor closed as `ok` afterwards would have
 * marked the work `done` — which is the shape checker round 2 measured (W3), where every relay past
 * the first came back `cannot lease from state done`.
 *
 * Fail-open, like everything else in this file: a handoff that cannot be recorded returns null and
 * the relay proceeds. The successor's `recordAttempt` then declines too (no causal link for a
 * second attempt), so the failure mode is a missing attempt, never a wrong one.
 */
export function handOffAttemptForRelay(input: {
  repoRoot: string
  workId: string | null | undefined
  /** The successor's own session id: the thing that actually lets the work continue. */
  resumeToken: string
  now?: string | Date
}): {
  attempt_id: string
  resume_record_id: string
  worktree_id: string
  worktree_head: string
} | null {
  try {
    if (typeof input.workId !== 'string' || !ID.work.test(input.workId)) return null
    const handoff = handOffRuntimeAttempt({
      repoRoot: input.repoRoot,
      workId: input.workId,
      resumeToken: input.resumeToken,
      now: input.now,
    })
    if (!handoff) return null
    return {
      attempt_id: handoff.attempt_id,
      resume_record_id: handoff.resume_record_id,
      worktree_id: handoff.worktree_id,
      worktree_head: handoff.worktree_head,
    }
  } catch (error) {
    process.stderr.write(
      `[clade runtime] relay handoff not recorded (fail-open): ${(error as Error).message}\n`,
    )
    return null
  }
}

/**
 * Close the attempt hanging off `rootSpanId`, if there is one and its lease is still good.
 *
 * Three outcomes, and the caller is told which:
 *   `closed`  — a real terminal receipt: the lease was live and the attempt reached a terminal state
 *   `legacy`  — an attempt exists but its lease is gone (expired, or already reconciled away). The
 *               receipt is recorded as legacy by the CALLER, on its own record. Plan section 9.8:
 *               a completion without a lease is never fabricated into one.
 *   `none`    — no attempt for this span at all (the dispatch predates the wiring, or the runtime
 *               declined it at the door).
 *
 * The flow span is closed by the caller, not here: the dispatchers each have exactly one place that
 * ends a span, and a second closer inside this file is how a span ends up with two end events.
 */
export function closeAttemptForSpan(input: {
  repoRoot: string
  rootSpanId: string
  outcome: 'ok' | 'fail' | 'blocked'
  actor?: string
  now?: string | Date
}): { status: 'closed' | 'legacy' | 'none'; attempt_id: string | null; reason: string | null } {
  let attemptId: string | null = null
  try {
    const state = readRuntimeState(input.repoRoot)
    const attempt = state.attempts.find((candidate) => candidate.root_span_id === input.rootSpanId)
    if (!attempt) return { status: 'none', attempt_id: null, reason: null }
    attemptId = attempt.attempt_id
    // NEVER pass a caller's actor down these two. The fold authorizes `lease.released` only when
    // its actor is the lease HOLDER (`wkr_implementation`) or `runtime-reconciler`, and it checks
    // that the preceding `attempt.state` event matches it exactly — so a dispatcher-shaped actor
    // like `pi:gpt-5.6-luna` makes the release unreadable and the whole finish rolls back. Measured
    // 2026-09-02: the receipt came back `legacy` with `lease release lacks a preceding terminal
    // holder or reconciler cause`, on a dispatch whose lease had ten minutes left.
    prepareRuntimeAttemptFinish({
      repoRoot: input.repoRoot,
      attemptId: attempt.attempt_id,
      outcome: input.outcome,
      now: input.now,
    })
    finishRuntimeAttemptBySpan({
      repoRoot: input.repoRoot,
      rootSpanId: input.rootSpanId,
      outcome: input.outcome,
      now: input.now,
    })
    return { status: 'closed', attempt_id: attempt.attempt_id, reason: null }
  } catch (error) {
    // An expired lease lands here, and that is the designed path rather than an error: the work
    // outlived its lease, `reconcileRuntimeOrphans` owns what happens to the attempt, and this
    // completion is a legacy receipt. Silent on purpose — the caller records the verdict.
    // The reason travels with the verdict. `legacy` has several causes that look identical on a
    // card — an expired lease, an attempt already reconciled away, a state machine that refused —
    // and a reader who cannot tell them apart cannot tell a normal long-running pane from a bug.
    return {
      status: attemptId ? 'legacy' : 'none',
      attempt_id: attemptId,
      reason: (error as Error).message,
    }
  }
}

export function reconcileAttemptFlowBoundary(
  repoRoot: string,
  now?: string | Date,
): Array<{
  attempt_id: string
  action: string
}> {
  const flowEvents = readEvents(repoRoot)
  return reconcileRuntimeFlowBoundaries({
    repoRoot,
    flowEvents,
    readFlowEvents: () => readEvents(repoRoot),
    actor: 'flow-controller',
    now,
    emitMissingEnd: (attempt) => {
      const handle: SpanHandle = {
        work_id: attempt.work_id,
        span_id: attempt.root_span_id,
        parent_span: null,
        started_at: attempt.started_at,
        kind: 'execute_tool',
        actor: attempt.worker_id,
        substrate: 'claude-code',
        session_id: null,
      }
      return endSpan(handle, {
        outcome: attempt.pending_outcome ?? 'fail',
        payload: { reconciled: true },
        cwd: repoRoot,
      }).written
    },
  })
}

export function intentSourcePath(repoRoot: string, changeId: string): string {
  // Delegates for real: the guard, the binding check and the projector must not be able to
  // drift onto two different files. Identifier validation is this layer's own addition —
  // the leaf deliberately accepts the looser runtime alphabet.
  return controlPlaneIntentPath(repoRoot, requireId('change', changeId))
}

export async function persistOpsxChangeSource(
  repoRoot: string,
  source: OpsxChangeSource,
): Promise<string> {
  const normalized = readOpsxChange(source)
  const path = intentSourcePath(repoRoot, normalized.change_id)
  const content = `${JSON.stringify(source, null, 2)}\n`
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf8')
    if (sha256(current) !== sha256(content)) {
      throw new Error(
        `intent source is immutable for ${normalized.change_id}; append a revision instead`,
      )
    }
    return path
  }
  await atomicWriteText(path, content)
  return path
}

export function readPersistedOpsxChange(
  repoRoot: string,
  changeId: string,
): { source: OpsxChangeSource; normalized: NormalizedOpsxChange } {
  return readOpsxChangeFile(intentSourcePath(repoRoot, changeId))
}

/**
 * Append-only intent revision ledger.
 *
 * Deliberately *not* under `.clade/ai-control-plane/intent/`: that directory is tracked
 * canonical state (TD-849, §12.3), and a ledger that grows on every revision read would put
 * machine-local churn into every consumer's git history.
 */
export function intentRevisionLedgerPath(repoRoot: string, changeId: string): string {
  return join(
    repoRoot,
    '.clade',
    'ai-control-plane',
    'intent-revisions',
    `${requireId('change', changeId)}.jsonl`,
  )
}

export function readIntentRevisions(repoRoot: string, changeId: string): IntentRevisionRecord[] {
  const path = intentRevisionLedgerPath(repoRoot, changeId)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IntentRevisionRecord)
}

/**
 * Record one intent revision. Chained by `previous_record_digest` so a truncated or
 * reordered ledger is detectable; re-recording an identical revision is a no-op, which
 * makes the writer safe to re-run after a crash.
 */
export function recordIntentRevision(input: {
  repoRoot: string
  source: WorkflowChangeSource
  now?: string | Date
}): IntentRevisionRecord {
  const normalized = readWorkflowChange(input.source)
  const existing = readIntentRevisions(input.repoRoot, normalized.change_id)
  const sourceDigest = sha256(canonical(input.source))
  const last = existing.at(-1) ?? null
  if (last?.source_digest === sourceDigest) return last
  const record: IntentRevisionRecord = {
    artifact_type: 'intent.revision',
    schema_version: 1,
    change_id: normalized.change_id,
    revision: existing.length + 1,
    intent_revision: normalized.intent_revision,
    source_digest: sourceDigest,
    source_revision: normalized.source_revision,
    recorded_at: new Date(input.now ?? Date.now()).toISOString(),
    previous_record_digest: last ? sha256(canonical(last)) : null,
  }
  const path = intentRevisionLedgerPath(input.repoRoot, normalized.change_id)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(record)}\n`)
  return record
}

/**
 * Where a change's generated artifacts live, for both profiles.
 *
 * For `opsx-v2` the answer is arithmetic — the alias is a total function of the change id
 * (§10.6 naming amendment) — so there is no binding file to read, nothing to keep in sync,
 * and no state that can disagree with the directory. For `spectra-v1` the legacy source
 * carries its own `artifact_root`.
 */
export function resolveWorkflowProjectionBinding(
  repoRoot: string,
  source: WorkflowChangeSource,
): { alias: string; artifactRoot: string; repositoryRelative: string } {
  const assignment = source.profile_assignment
  const alias =
    assignment?.profile === 'spectra-v1'
      ? basename(String((source as SpectraLegacySource).legacy_source.artifact_root))
      : toOpenSpecAlias(requireId('change', assignment?.change_id))
  if (!/^[A-Za-z0-9._-]+$/.test(alias) || alias === 'archive' || alias.includes('..')) {
    throw new Error(`invalid workflow projection alias: ${JSON.stringify(alias)}`)
  }
  const repositoryRelative = join('openspec', 'changes', alias)
  return { alias, artifactRoot: join(repoRoot, repositoryRelative), repositoryRelative }
}

/**
 * Filesystem/git implementation of the intent store (§10.3).
 *
 * `create` is delegated to the bound OpenSpec adapter for `opsx-v2` because creation is not
 * a file write — it is the binding commit of §10.6 item 2, and only the adapter knows how to
 * make one. Everything else here is a read.
 */
export class FilesystemIntentStore implements IntentStore {
  private readonly repoRoot: string
  private readonly opsxAdapter: {
    create(source: OpsxChangeSource): Promise<string>
    archive(changeId: string): IntentArchiveResult
  } | null

  constructor(
    repoRoot: string,
    opsxAdapter: {
      create(source: OpsxChangeSource): Promise<string>
      archive(changeId: string): IntentArchiveResult
    } | null = null,
  ) {
    this.repoRoot = repoRoot
    this.opsxAdapter = opsxAdapter
  }

  async create(source: WorkflowChangeSource): Promise<string> {
    const assignment = source.profile_assignment
    if (assignment?.profile !== 'opsx-v2') {
      throw new Error('the intent store creates opsx-v2 changes only; Spectra owns its own slugs')
    }
    if (!this.opsxAdapter) {
      throw new Error('OPSX creation requires the bound OpenSpec adapter (binding commit)')
    }
    const expected = intentSourcePath(this.repoRoot, requireId('change', assignment.change_id))
    const sourcePath = await this.opsxAdapter.create(source as OpsxChangeSource)
    if (sourcePath !== expected) {
      throw new Error('bound OPSX adapter returned a foreign intent source path')
    }
    return sourcePath
  }

  read(changeId: string): { source: WorkflowChangeSource; normalized: NormalizedOpsxChange } {
    const path = intentSourcePath(this.repoRoot, changeId)
    const source = JSON.parse(readFileSync(path, 'utf8')) as WorkflowChangeSource
    return { source, normalized: readWorkflowChange(source) }
  }

  list(): string[] {
    const root = join(this.repoRoot, '.clade', 'ai-control-plane', 'intent')
    if (!existsSync(root)) return []
    return readdirSync(root)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .toSorted()
  }

  profile(changeId: string): 'spectra-v1' | 'opsx-v2' | null {
    const path = intentSourcePath(this.repoRoot, changeId)
    if (!existsSync(path)) return null
    const source = JSON.parse(readFileSync(path, 'utf8')) as WorkflowChangeSource
    const profile = source.profile_assignment?.profile
    return profile === 'opsx-v2' || profile === 'spectra-v1' ? profile : null
  }

  archive(changeId: string): IntentArchiveResult {
    const sourcePath = intentSourcePath(this.repoRoot, changeId)
    if (!existsSync(sourcePath)) throw new Error(`intent source not found for ${changeId}`)
    if (this.profile(changeId) !== 'opsx-v2') {
      throw new Error('Spectra archive stays with Spectra during coexistence (§10.2)')
    }
    if (!this.opsxAdapter) throw new Error('OPSX archive requires the bound OpenSpec adapter')
    const result = this.opsxAdapter.archive(changeId)
    if (result.changeId !== changeId || result.sourcePath !== sourcePath || !result.preserved) {
      throw new Error('bound OPSX adapter returned an invalid archive result')
    }
    // Archive never deletes canonical facts (§10.5): the intent source survives the move.
    if (!existsSync(sourcePath)) throw new Error('archive removed the canonical intent source')
    return result
  }
}

export function evidenceLedgerPath(repoRoot: string): string {
  return join(repoRoot, '.clade', 'ai-control-plane', 'evidence.jsonl')
}

export function projectionPath(repoRoot: string, changeId: string): string {
  return join(
    repoRoot,
    '.clade',
    'ai-control-plane',
    'projections',
    `${requireId('change', changeId)}.json`,
  )
}

export function readEvidence(repoRoot: string): EvidenceReceipt[] {
  const path = evidenceLedgerPath(repoRoot)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvidenceReceipt)
}

function sleepMs(ms: number): void {
  const buffer = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(buffer), 0, 0, ms)
}

function withFileLock<T>(lockPath: string, label: string, run: () => T): T {
  let fd: number | null = null
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      fd = openSync(lockPath, 'wx')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 5_000) unlinkSync(lockPath)
      } catch {}
      sleepMs(10)
    }
  }
  if (fd === null) throw new Error(`${label} lock contention: ${lockPath}`)
  try {
    return run()
  } finally {
    closeSync(fd)
    try {
      unlinkSync(lockPath)
    } catch {}
  }
}

function withEvidenceLock<T>(path: string, run: () => T): T {
  return withFileLock(`${path}.lock`, 'evidence ledger', run)
}

function projectionLockPath(repoRoot: string, changeId: string): string {
  return join(
    repoRoot,
    '.clade',
    'ai-control-plane',
    'locks',
    `${requireId('change', changeId)}.lock`,
  )
}

export async function withProjectionLock<T>(
  repoRoot: string,
  changeId: string,
  run: () => Promise<T>,
): Promise<T> {
  const lockPath = projectionLockPath(repoRoot, changeId)
  mkdirSync(dirname(lockPath), { recursive: true })
  let fd: number | null = null
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      fd = openSync(lockPath, 'wx')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  if (fd === null) throw new Error(`projection lock contention: ${lockPath}`)
  try {
    return await run()
  } finally {
    closeSync(fd)
    try {
      unlinkSync(lockPath)
    } catch {}
  }
}

function withProjectionReadLock<T>(repoRoot: string, changeId: string, run: () => T): T {
  const lockPath = projectionLockPath(repoRoot, changeId)
  mkdirSync(dirname(lockPath), { recursive: true })
  let fd: number | null = null
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      fd = openSync(lockPath, 'wx')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      sleepMs(10)
    }
  }
  if (fd === null) throw new Error(`projection lock contention: ${lockPath}`)
  try {
    return run()
  } finally {
    closeSync(fd)
    try {
      unlinkSync(lockPath)
    } catch {}
  }
}

function validateEvidence(receipt: EvidenceReceipt): void {
  requireId('evidence', receipt.evidence_id)
  requireId('change', receipt.change_id)
  requireId('requirement', receipt.requirement_id)
  requireId('work', receipt.work_id)
  requireId('attempt', receipt.attempt_id)
  requireId('span', receipt.span_id)
  requireDigest('subject_digest', receipt.subject_digest)
  if (!Number.isInteger(receipt.requirement_revision) || receipt.requirement_revision < 1) {
    throw new Error('requirement_revision must be a positive integer')
  }
  if (!receipt.verification_policy) throw new Error('verification_policy is required')
  if (receipt.references.length === 0)
    throw new Error('at least one evidence reference is required')
  for (const ref of receipt.references) requireDigest('reference digest', ref.digest)
  const { redaction_applied: _, ...redacted } = redactPayload(
    receipt as unknown as Record<string, unknown>,
  )
  if (canonical(redacted) !== canonical(receipt)) {
    throw new Error(
      'evidence receipt contains a value that requires redaction; store a digest or safe locator',
    )
  }
}

export function recordEvidence(repoRoot: string, receipt: EvidenceReceipt): EvidenceReceipt {
  validateEvidence(receipt)
  const path = evidenceLedgerPath(repoRoot)
  mkdirSync(dirname(path), { recursive: true })
  return withEvidenceLock(path, () => {
    const existing = readEvidence(repoRoot)
    if (existing.some((candidate) => candidate.evidence_id === receipt.evidence_id)) {
      throw new Error(`duplicate evidence_id: ${receipt.evidence_id}`)
    }
    appendFileSync(path, `${JSON.stringify(receipt)}\n`)
    return receipt
  })
}

function correlatedWorkEvents(repoRoot: string, changeId: string): Array<Record<string, any>> {
  const workIds = new Set(
    readEvents(repoRoot)
      .filter((event) => event.kind === 'work.open' && event.payload?.change_id === changeId)
      .map((event) => event.work_id),
  )
  return readEvents(repoRoot).filter((event) => event.work_id && workIds.has(event.work_id))
}

function correlatedRuntimeState(repoRoot: string, changeId: string): RuntimeState {
  const state = readRuntimeState(repoRoot)
  const works = state.works.filter((work) => work.change_id === changeId)
  const workIds = new Set(works.map((work) => work.work_id))
  const repoIds = new Set(works.map((work) => work.repo_id))
  const initiativeIds = new Set(
    works
      .map((work) => work.initiative_id)
      .filter((initiativeId): initiativeId is string => initiativeId !== null),
  )
  const attempts = state.attempts.filter((attempt) => workIds.has(attempt.work_id))
  const attemptIds = new Set(attempts.map((attempt) => attempt.attempt_id))
  const messages = state.messages.filter((message) => workIds.has(message.work_id))
  const pauses = state.pauses.filter(
    (pause) =>
      pause.scope === 'global' ||
      (pause.scope === 'repository' && repoIds.has(pause.scope_id)) ||
      (pause.scope === 'initiative' && initiativeIds.has(pause.scope_id)),
  )
  const referencedGrantDigests = new Set([
    ...attempts.map((attempt) => attempt.capability_grant_digest),
    ...messages.map((message) => message.capability_grant_digest),
    ...pauses.map((pause) => pause.grant_digest),
  ])
  const referencedGrantWorkerIds = new Set(
    state.grants
      .filter((grant) => referencedGrantDigests.has(grant.digest))
      .map((grant) => grant.worker_id),
  )
  const workers = state.workers.filter(
    (worker) =>
      referencedGrantWorkerIds.has(worker.worker_id) ||
      worker.allowed_repositories.includes('*') ||
      worker.allowed_repositories.some((repoId) => repoIds.has(repoId)),
  )
  const workerIds = new Set([
    ...attempts.map((attempt) => attempt.worker_id),
    ...messages.flatMap((message) => [message.sender_worker_id, message.recipient_worker_id]),
    ...workers.map((worker) => worker.worker_id),
  ])
  const grants = state.grants.filter(
    (grant) =>
      referencedGrantDigests.has(grant.digest) ||
      (workerIds.has(grant.worker_id) &&
        (grant.repositories.includes('*') ||
          grant.repositories.some((repoId) => repoIds.has(repoId))) &&
        (grant.initiative_ids.length === 0 ||
          grant.initiative_ids.some((initiativeId) => initiativeIds.has(initiativeId)))),
  )
  const grantDigests = new Set([
    ...attempts.map((attempt) => attempt.capability_grant_digest),
    ...messages.map((message) => message.capability_grant_digest),
    ...grants.map((grant) => grant.digest),
  ])
  const engines = state.engines
  const engineNames = new Set(engines.map((engine) => engine.engine))
  return {
    events: state.events.filter(
      (event) =>
        (event.work_id !== null && workIds.has(event.work_id)) ||
        (event.attempt_id !== null && attemptIds.has(event.attempt_id)) ||
        (event.kind === 'worker.registered' && workerIds.has(event.payload?.profile?.worker_id)) ||
        (event.kind === 'grant.registered' && grantDigests.has(event.payload?.grant?.digest)) ||
        (event.kind === 'engine.registered' && engineNames.has(event.payload?.engine?.engine)) ||
        (event.kind.startsWith('control.') &&
          (event.payload?.control?.scope === 'global' ||
            (event.payload?.control?.scope === 'repository' &&
              repoIds.has(event.payload?.control?.scope_id)) ||
            (event.payload?.control?.scope === 'initiative' &&
              initiativeIds.has(event.payload?.control?.scope_id)))),
    ),
    workers,
    grants,
    engines,
    works,
    attempts,
    leases: state.leases.filter((lease) => workIds.has(lease.work_id)),
    resume_records: state.resume_records.filter((record) => workIds.has(record.work_id)),
    pane_mappings: state.pane_mappings.filter((mapping) => workIds.has(mapping.work_id)),
    // A pane identity carries no work id — a pane outlives the work that ran in it — so it is
    // scoped by the handles the in-scope attempts recorded as their aliases.
    pane_identities: state.pane_identities.filter((identity) =>
      attempts.some(
        (attempt) =>
          attempt.pane_id === identity.pane_handle &&
          attempt.workspace_id === identity.workspace_handle,
      ),
    ),
    messages,
    pauses,
    trace_observations: state.trace_observations.filter((observation) =>
      attemptIds.has(observation.attempt_id),
    ),
  }
}

function buildAttemptRows(
  events: Array<Record<string, any>>,
  runtime: RuntimeState,
): ControlPlaneProjection['attempts'] {
  if (runtime.attempts.length > 0) {
    return runtime.attempts.map((attempt) => ({
      attempt_id: requireId('attempt', attempt.attempt_id),
      work_id: requireId('work', attempt.work_id),
      span_id: requireId('span', attempt.root_span_id),
      worker_id: attempt.worker_id,
      engine: attempt.engine,
      engine_version: attempt.engine_version,
      lease_id: attempt.lease_id,
      worktree_id: attempt.worktree_id,
      workspace_id: attempt.workspace_id,
      pane_id: attempt.pane_id,
      resumes_attempt_id: attempt.resumes_attempt_id,
      state: attempt.state,
    }))
  }
  const starts = events.filter(
    (event) => event.phase === 'start' && typeof event.payload?.attempt_id === 'string',
  )
  return starts.map((start) => {
    const end = events.find(
      (candidate) =>
        candidate.phase === 'end' &&
        candidate.span_id === start.span_id &&
        candidate.kind === start.kind,
    )
    return {
      attempt_id: requireId('attempt', start.payload.attempt_id),
      work_id: requireId('work', start.work_id),
      span_id: requireId('span', start.span_id),
      worker_id: null,
      engine: null,
      engine_version: null,
      lease_id: null,
      worktree_id: null,
      workspace_id: null,
      pane_id: null,
      resumes_attempt_id: null,
      state: end ? (end.outcome === 'ok' ? 'succeeded' : 'failed') : 'running',
    }
  })
}

function maxTimestamp(
  source: OpsxChangeSource,
  events: Array<Record<string, any>>,
  runtimeEvents: Array<{ recorded_at: string }>,
  evidence: EvidenceReceipt[],
  decisions: HumanDecisionRecord[],
): string {
  const times = [
    ...source.native_artifacts.flatMap((candidate) =>
      ['recorded_at', 'generated_at', 'assessed_at'].map((key) => candidate[key]).filter(Boolean),
    ),
    ...events.map((event) => event.ts_utc),
    ...runtimeEvents.map((event) => event.recorded_at),
    ...evidence.map((receipt) => receipt.recorded_at),
    ...decisions.map((decision) => decision.recorded_at),
  ].filter(
    (value): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)),
  )
  return times.toSorted().at(-1) ?? new Date(0).toISOString()
}

function changeTitle(source: OpsxChangeSource): string {
  const intake = artifact(source, 'intent.intake_batch')
  const explicit = typeof intake.title === 'string' ? intake.title.trim() : ''
  if (explicit) return explicit
  const raw = String(intake.raw_text ?? '').trim()
  return raw.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? raw
}

function impactMatrix(source: OpsxChangeSource): ImpactProjection[] {
  return source.native_artifacts
    .filter((candidate) => candidate.artifact_type === 'requirement.impact')
    .map((candidate) => ({
      impact_id: String(candidate.impact_id),
      requirement_id: requireId('requirement', candidate.requirement_id),
      requirement_revision: Number(candidate.requirement_revision),
      target_type: String(candidate.target?.type ?? ''),
      target_id: String(candidate.target?.id ?? ''),
      consistency: String(candidate.consistency),
      rationale: String(candidate.rationale),
    }))
    .toSorted((left, right) => left.impact_id.localeCompare(right.impact_id))
}

function humanGateRows(
  source: OpsxChangeSource,
  changeId: string,
  durableDecisions: HumanDecisionRecord[],
): HumanGateProjection[] {
  const decisions = [
    ...source.native_artifacts.filter((candidate) => candidate.artifact_type === 'human.decision'),
    ...durableDecisions,
  ]
  const families = new Set<HumanGateFamily>([
    'product-ruling',
    'experience-acceptance',
    'external-action',
    'exception-escalation',
  ])
  return source.native_artifacts
    .filter((candidate) => candidate.artifact_type === 'human.gate')
    .map((candidate) => {
      if (candidate.change_id !== changeId) throw new Error('human.gate change_id mismatch')
      const family = String(candidate.family) as HumanGateFamily
      if (!families.has(family)) throw new Error(`unsupported human gate family: ${family}`)
      const gateId = requireId('gate', candidate.gate_id)
      const gateDecisions = decisions.filter((row) => row.gate_id === gateId)
      if (gateDecisions.length > 1) {
        throw new Error(`gate has multiple terminal decisions: ${gateId}`)
      }
      const decision = gateDecisions[0]
      const declaredState = String(candidate.state ?? 'open') as HumanGateState
      const state = decision ? 'answered' : declaredState
      if (!['open', 'answered', 'expired', 'cancelled'].includes(state)) {
        throw new Error(`unsupported human gate state: ${state}`)
      }
      const controlMode = String(
        candidate.controls?.mode,
      ) as HumanGateProjection['controls']['mode']
      const allowedModes: Record<HumanGateFamily, HumanGateProjection['controls']['mode'][]> = {
        'product-ruling': ['choose-option', 'provide-value'],
        'experience-acceptance': ['accept-reject'],
        'external-action': ['confirm-action'],
        'exception-escalation': ['recovery'],
      }
      if (!allowedModes[family].includes(controlMode)) {
        throw new Error(`human gate ${gateId} has invalid controls for ${family}`)
      }
      const controlOptions = (candidate.controls?.options ?? []).map(String)
      const requestedFields = (candidate.controls?.requested_fields ?? []).map(String)
      if (
        controlMode === 'provide-value' ? requestedFields.length === 0 : controlOptions.length === 0
      ) {
        throw new Error(`human gate ${gateId} has empty bounded controls`)
      }
      if (decision) validateHumanDecisionAgainstGate(decision as HumanDecisionRecord, candidate)
      const affected = candidate.affected ?? {}
      return {
        gate_id: gateId,
        family,
        state,
        judgment: String(candidate.judgment),
        why_actionable: String(candidate.why_actionable),
        expected_behavior: String(candidate.expected_behavior),
        actual_evidence: (candidate.actual_evidence ?? []).map((row: any) => ({
          label: String(row.label),
          locator: String(row.locator),
        })),
        consequences: (candidate.consequences ?? []).map((row: any) => ({
          option: String(row.option),
          outcome: String(row.outcome),
        })),
        recommendation:
          typeof candidate.recommendation === 'string' ? candidate.recommendation : null,
        controls: {
          mode: controlMode,
          options: controlOptions,
          requested_fields: requestedFields,
        },
        response_url: String(candidate.response_url ?? '/decisions'),
        affected_requirement_ids: (affected.requirement_ids ?? []).map((id: unknown) =>
          requireId('requirement', id),
        ),
        affected_work_spec_ids: (affected.work_spec_ids ?? []).map((id: unknown) =>
          requireId('workSpec', id),
        ),
        decision_id: decision ? String(decision.decision_id) : null,
        decision_outcome: decision ? String(decision.outcome) : null,
        decision_evidence_links: decision
          ? (decision.evidence_links ?? []).map((link: unknown) => String(link))
          : [],
      }
    })
    .toSorted((left, right) => left.gate_id.localeCompare(right.gate_id))
}

function featureMapReferences(source: OpsxChangeSource, changeId: string): FeatureMapReference[] {
  return source.native_artifacts
    .filter((candidate) => candidate.artifact_type === 'verification.feature_map_reference')
    .map((candidate) => {
      if (candidate.change_id !== changeId) {
        throw new Error('verification.feature_map_reference change_id mismatch')
      }
      return {
        reference_id: String(candidate.reference_id),
        feature_id: String(candidate.feature_id),
        feature_map_locator: String(candidate.feature_map_locator),
        entry_point: String(candidate.entry_point),
        subject_revision: Number(candidate.subject_revision),
        digest: requireDigest('feature map digest', candidate.digest),
        receipt_id:
          typeof candidate.receipt_id === 'string'
            ? requireId('evidence', candidate.receipt_id)
            : null,
        requirement_id: requireId('requirement', candidate.requirement_id),
        work_spec_id: requireId('workSpec', candidate.work_spec_id),
      }
    })
    .toSorted((left, right) => left.reference_id.localeCompare(right.reference_id))
}

export function humanDecisionLedgerPath(repoRoot: string): string {
  return join(repoRoot, '.clade', 'ai-control-plane', 'human-decisions.jsonl')
}

export function readHumanDecisions(repoRoot: string): HumanDecisionRecord[] {
  const path = humanDecisionLedgerPath(repoRoot)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HumanDecisionRecord)
}

function validateHumanDecisionAgainstGate(
  decision: HumanDecisionRecord,
  gate: Record<string, any>,
): void {
  if (decision.change_id !== gate.change_id || decision.gate_id !== gate.gate_id) {
    throw new Error('human decision gate/change correlation mismatch')
  }
  const mode = String(gate.controls?.mode)
  const options = (gate.controls?.options ?? []).map(String)
  const requestedFields = (gate.controls?.requested_fields ?? []).map(String)
  if (mode !== 'provide-value' && options.length === 0) {
    throw new Error(`human gate ${decision.gate_id} requires at least one allowed outcome`)
  }
  if (mode !== 'provide-value' && !options.includes(decision.outcome)) {
    throw new Error(`human decision outcome is not allowed for ${decision.gate_id}`)
  }
  if (mode === 'provide-value') {
    if (requestedFields.length === 0) {
      throw new Error(`human gate ${decision.gate_id} requires at least one requested field`)
    }
    const missing = requestedFields.filter(
      (field) =>
        typeof decision.provided_fields?.[field] !== 'string' || !decision.provided_fields[field],
    )
    if (missing.length > 0) {
      throw new Error(`human decision is missing requested fields: ${missing.join(', ')}`)
    }
    const unexpected = Object.keys(decision.provided_fields).filter(
      (field) => !requestedFields.includes(field),
    )
    if (unexpected.length > 0) {
      throw new Error(`human decision has undeclared fields: ${unexpected.join(', ')}`)
    }
  } else if (Object.keys(decision.provided_fields ?? {}).length > 0) {
    throw new Error(`human decision provided_fields are not allowed for ${mode}`)
  }
  if (
    (gate.family === 'external-action' || gate.family === 'exception-escalation') &&
    decision.evidence_links.length === 0
  ) {
    throw new Error(`human decision evidence is required for ${gate.family}`)
  }
}

export function recordHumanDecision(
  repoRoot: string,
  decision: HumanDecisionRecord,
): HumanDecisionRecord {
  if (decision.artifact_type !== 'human.decision' || decision.schema_version !== 1) {
    throw new Error('human decision contract mismatch')
  }
  if (!/^dec_[A-Za-z0-9]+$/.test(decision.decision_id)) {
    throw new Error(`decision_id has invalid canonical form: ${decision.decision_id}`)
  }
  requireId('gate', decision.gate_id)
  requireId('change', decision.change_id)
  if (!decision.outcome.trim()) throw new Error('human decision outcome is required')
  if (Number.isNaN(Date.parse(decision.recorded_at))) {
    throw new Error('human decision recorded_at must be a date-time')
  }
  const path = humanDecisionLedgerPath(repoRoot)
  mkdirSync(dirname(path), { recursive: true })
  return withFileLock(`${path}.lock`, 'human decision ledger', () => {
    const persisted = readPersistedOpsxChange(repoRoot, decision.change_id)
    const gate = persisted.source.native_artifacts.find(
      (candidate) =>
        candidate.artifact_type === 'human.gate' && candidate.gate_id === decision.gate_id,
    )
    if (!gate || gate.change_id !== decision.change_id) {
      throw new Error(`human decision does not match a gate in ${decision.change_id}`)
    }
    validateHumanDecisionAgainstGate(decision, gate)
    const nativeDecisions = persisted.source.native_artifacts.filter(
      (candidate) => candidate.artifact_type === 'human.decision',
    )
    if (nativeDecisions.some((row) => row.decision_id === decision.decision_id)) {
      throw new Error(`duplicate decision_id: ${decision.decision_id}`)
    }
    if (nativeDecisions.some((row) => row.gate_id === decision.gate_id)) {
      throw new Error(`gate already has a terminal decision: ${decision.gate_id}`)
    }
    const existing = readHumanDecisions(repoRoot)
    if (existing.some((row) => row.decision_id === decision.decision_id)) {
      throw new Error(`duplicate decision_id: ${decision.decision_id}`)
    }
    if (existing.some((row) => row.gate_id === decision.gate_id)) {
      throw new Error(`gate already has a terminal decision: ${decision.gate_id}`)
    }
    appendFileSync(path, `${JSON.stringify(decision)}\n`)
    return decision
  })
}

export function buildProjectorInput(input: {
  repoRoot: string
  source: OpsxChangeSource
  projectionCurrent?: boolean
  activeWriters?: string[]
}): {
  normalized: NormalizedOpsxChange
  title: string
  projectorInput: Record<string, any>
  attempts: ControlPlaneProjection['attempts']
  evidence: EvidenceReceipt[]
  impactMatrix: ImpactProjection[]
  humanGates: HumanGateProjection[]
  attentionCards: HumanGateProjection[]
  featureMapRefs: FeatureMapReference[]
  runtimeTopology: ControlPlaneProjection['runtime_topology']
  archiveReadiness: ArchiveReadiness
} {
  const normalized = readOpsxChange(input.source)
  const events = correlatedWorkEvents(input.repoRoot, normalized.change_id)
  const runtime = correlatedRuntimeState(input.repoRoot, normalized.change_id)
  const { events: runtimeEvents, ...runtimeTopology } = runtime
  const attempts = buildAttemptRows(events, runtime)
  const evidence = readEvidence(input.repoRoot).filter(
    (row) => row.change_id === normalized.change_id,
  )
  const plan = workPlan(input.source)
  const impacts = impactMatrix(input.source)
  const decisions = readHumanDecisions(input.repoRoot).filter(
    (decision) => decision.change_id === normalized.change_id,
  )
  const humanGates = humanGateRows(input.source, normalized.change_id, decisions)
  const attentionCards = humanGates.filter((gate) => gate.state === 'open')
  const featureMapRefs = featureMapReferences(input.source, normalized.change_id)
  let duplicateMaterialization = false
  const workRecords = plan.work_specs.map((spec: any) => {
    const openings = events.filter(
      (event) => event.kind === 'work.open' && event.payload?.work_spec_id === spec.work_spec_id,
    )
    duplicateMaterialization ||= openings.length > 1
    const open = openings.length === 1 ? openings[0] : null
    const workId = open?.work_id ?? null
    const done = workId
      ? events.find((event) => event.kind === 'work.done' && event.work_id === workId)
      : null
    const workAttempts = workId ? attempts.filter((attempt) => attempt.work_id === workId) : []
    const evidenceIds = workId
      ? evidence
          .filter((receipt) => receipt.work_id === workId)
          .map((receipt) => receipt.evidence_id)
      : []
    const relatedGates = humanGates.filter((gate) =>
      gate.affected_work_spec_ids.includes(String(spec.work_spec_id)),
    )
    const blockingGateIds = relatedGates
      .filter((gate) => gate.state === 'open')
      .map((gate) => gate.gate_id)
    return {
      work_spec_id: String(spec.work_spec_id),
      label: String(spec.label),
      depends_on: (spec.depends_on ?? []).map(String).toSorted(),
      work_id: workId,
      state: done
        ? 'done'
        : blockingGateIds.length > 0
          ? 'blocked'
          : workAttempts.some((attempt) => attempt.state === 'running')
            ? 'running'
            : open
              ? 'ready'
              : 'planned',
      verification_policy: String(spec.verification_policy),
      evidence_ids: evidenceIds.toSorted(),
      blocking_gate_ids: blockingGateIds.toSorted(),
      latest_valid_evidence_id: null,
      human_disposition:
        blockingGateIds.length > 0 ? 'waiting' : relatedGates.length > 0 ? 'resolved' : 'none',
    }
  })
  const evidenceIsCurrent = (receipt: EvidenceReceipt): boolean => {
    const requirement = normalized.requirements.find(
      (candidate) => candidate.requirement_id === receipt.requirement_id,
    )
    const work = workRecords.find((candidate: any) => candidate.work_id === receipt.work_id)
    return (
      requirement?.revision === receipt.requirement_revision &&
      work?.verification_policy === receipt.verification_policy &&
      receipt.subject_digest === requirement.text_digest &&
      attempts.some(
        (attempt) =>
          attempt.attempt_id === receipt.attempt_id &&
          attempt.span_id === receipt.span_id &&
          attempt.work_id === receipt.work_id &&
          attempt.state === 'succeeded',
      )
    )
  }
  for (const work of workRecords) {
    work.latest_valid_evidence_id =
      evidence
        .filter((receipt) => receipt.work_id === work.work_id && evidenceIsCurrent(receipt))
        .toSorted((left, right) => left.recorded_at.localeCompare(right.recorded_at))
        .at(-1)?.evidence_id ?? null
  }
  const inputFacts = {
    source: input.source,
    flow_events: events,
    runtime_events: runtimeEvents,
    evidence,
    human_decisions: decisions,
  }
  const cursor = `intent:${normalized.intent_revision};flow:${events.length};runtime:${runtimeEvents.length};evidence:${evidence.length};decision:${decisions.length}`
  const evidenceCurrent = evidence.every(evidenceIsCurrent)
  const runtimeWorkIds = new Set(
    runtime.works
      .filter((work) => work.change_id === normalized.change_id)
      .map((work) => work.work_id),
  )
  const runtimeAttemptIds = new Set(
    runtime.attempts
      .filter((attempt) => runtimeWorkIds.has(attempt.work_id))
      .map((attempt) => attempt.attempt_id),
  )
  const predicates: ArchivePredicates = {
    current_intent_valid: true,
    impacts_current_and_consistent: impacts.every(
      (impact) =>
        impact.consistency === 'consistent' &&
        normalized.requirements.some(
          (requirement) =>
            requirement.requirement_id === impact.requirement_id &&
            requirement.revision === impact.requirement_revision,
        ),
    ),
    required_work_terminal_with_current_evidence:
      workRecords.every(
        (work: any) =>
          work.state === 'done' &&
          work.evidence_ids.length > 0 &&
          work.evidence_ids.every((id: string) =>
            evidence.some((receipt) => receipt.evidence_id === id),
          ),
      ) && evidenceCurrent,
    required_gates_terminal: humanGates.every((gate) => gate.state !== 'open'),
    no_active_attempt_or_lease:
      runtime.attempts
        .filter((attempt) => runtimeAttemptIds.has(attempt.attempt_id))
        .every(
          (attempt) =>
            !['leased', 'running', 'paused'].includes(attempt.state) &&
            attempt.flow_state === 'ended',
        ) &&
      runtime.leases
        .filter((lease) => runtimeAttemptIds.has(lease.attempt_id))
        .every((lease) => lease.released_at !== null) &&
      runtime.pane_mappings
        .filter((mapping) => runtimeAttemptIds.has(mapping.attempt_id))
        .every((mapping) => mapping.state === 'closed'),
    projection_cursors_current: input.projectionCurrent === true,
    single_writer:
      !duplicateMaterialization && new Set(input.activeWriters ?? ['flow-controller']).size === 1,
    no_stale_evidence: evidenceCurrent,
  }
  const blockingReasons = Object.entries(predicates)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  const archiveReadiness: ArchiveReadiness = {
    artifact_type: 'archive.readiness',
    schema_version: 1,
    change_id: normalized.change_id,
    intent_revision: normalized.intent_revision,
    evaluated_at: maxTimestamp(input.source, events, runtimeEvents, evidence, decisions),
    predicates,
    ready: blockingReasons.length === 0,
    blocking_reasons: blockingReasons,
  }
  return {
    normalized,
    title: changeTitle(input.source),
    projectorInput: {
      artifact_type: 'projection.input',
      schema_version: 1,
      change_id: normalized.change_id,
      intent_revision: normalized.intent_revision,
      through_cursor: cursor,
      facts_digest: sha256(inputFacts),
      requirements: normalized.requirements,
      work_records: workRecords,
      gate_ids: humanGates.map((gate) => gate.gate_id),
      evidence_ids: evidence.map((receipt) => receipt.evidence_id).toSorted(),
      impact_matrix: impacts,
      human_gates: humanGates,
      attention_cards: attentionCards,
      feature_map_refs: featureMapRefs,
      archive_predicates: predicates,
    },
    attempts,
    evidence,
    impactMatrix: impacts,
    humanGates,
    attentionCards,
    featureMapRefs,
    runtimeTopology: { ...runtimeTopology, event_count: runtimeEvents.length },
    archiveReadiness,
  }
}

export function completeControlPlaneWork(input: {
  repoRoot: string
  source: OpsxChangeSource
  workId: string
  evidenceId: string
  actor?: string
}): ReturnType<typeof markWorkDone> {
  const normalized = readOpsxChange(input.source)
  const receipt = readEvidence(input.repoRoot).find(
    (candidate) => candidate.evidence_id === input.evidenceId,
  )
  if (!receipt) throw new Error(`evidence receipt not found: ${input.evidenceId}`)
  if (receipt.change_id !== normalized.change_id || receipt.work_id !== input.workId) {
    throw new Error('evidence receipt does not correlate to this change/work')
  }
  const requirement = normalized.requirements.find(
    (candidate) => candidate.requirement_id === receipt.requirement_id,
  )
  if (
    !requirement ||
    requirement.revision !== receipt.requirement_revision ||
    requirement.text_digest !== receipt.subject_digest
  ) {
    throw new Error('evidence receipt is stale for the current requirement revision')
  }
  const events = correlatedWorkEvents(input.repoRoot, normalized.change_id)
  const attempts = buildAttemptRows(
    events,
    correlatedRuntimeState(input.repoRoot, normalized.change_id),
  )
  const attempt = attempts.find(
    (candidate) =>
      candidate.attempt_id === receipt.attempt_id &&
      candidate.span_id === receipt.span_id &&
      candidate.work_id === receipt.work_id,
  )
  if (!attempt || attempt.state !== 'succeeded')
    throw new Error('evidence attempt/span is not terminal-success')
  const open = events.find((event) => event.kind === 'work.open' && event.work_id === input.workId)
  if (open?.payload?.verification_policy !== receipt.verification_policy) {
    throw new Error('evidence verification policy does not match the materialized work')
  }
  return markWorkDone({
    work_id: input.workId,
    verification: `current evidence ${receipt.evidence_id} satisfies ${receipt.verification_policy}`,
    verifiedBy: 'evidence-recorder',
    actor: input.actor ?? 'flow-controller',
    substrate: 'claude-code',
    artifacts: [
      { type: 'file', ref: relative(input.repoRoot, evidenceLedgerPath(input.repoRoot)) },
    ],
    payload: { evidence_ids: [receipt.evidence_id] },
    cwd: input.repoRoot,
  })
}

function renderTasks(
  view: Omit<ControlPlaneProjection, 'checkpoint'>,
  cursor: string,
  inputDigest: Digest,
): string {
  const readiness = view.archive_readiness
  let predicateRows = Object.entries(readiness.predicates)
    .map(([key, value]) => `| ${key} | ${value ? 'pass' : 'block'} |`)
    .join('\n')
  const requirements = view.requirements
    .map(
      (requirement) =>
        `| \`${requirement.requirement_id}\` | r${requirement.revision} | \`${requirement.text_digest}\` |`,
    )
    .join('\n')
  const workRows = view.work_records
    .map(
      (work) =>
        `| \`${work.work_spec_id}\` | ${work.label} | ${work.depends_on.map((id) => `\`${id}\``).join(', ') || '—'} | \`${work.work_id ?? 'unmaterialized'}\` | ${work.state} | ${work.blocking_gate_ids.map((id) => `\`${id}\``).join(', ') || '—'} | \`${work.latest_valid_evidence_id ?? 'none'}\` |`,
    )
    .join('\n')
  const workChecklist = view.work_records
    .map(
      (work, index) =>
        `- [${work.state === 'done' ? 'x' : ' '}] #${index + 1} ${work.label} (policy \`${work.verification_policy}\`, spec \`${work.work_spec_id}\`, work \`${work.work_id ?? 'unmaterialized'}\`, state \`${work.state}\`, evidence \`${work.latest_valid_evidence_id ?? 'none'}\`)`,
    )
    .join('\n')
  predicateRows += `\n\n## 9. 人工檢查\n\n${workChecklist}`
  const impactRows = view.impact_matrix
    .map(
      (impact) =>
        `| \`${impact.impact_id}\` | \`${impact.requirement_id}\` r${impact.requirement_revision} | ${impact.target_type}:\`${impact.target_id}\` | ${impact.consistency} | ${impact.rationale} |`,
    )
    .join('\n')
  const attemptRows = view.attempts
    .map(
      (attempt) =>
        `- \`${attempt.attempt_id}\` → work \`${attempt.work_id}\`, span \`${attempt.span_id}\`, ${attempt.state}`,
    )
    .join('\n')
  const evidenceRows = view.evidence
    .map(
      (receipt) =>
        `- \`${receipt.evidence_id}\` (${receipt.recorded_at}) protects \`${receipt.requirement_id}\` r${receipt.requirement_revision} via ${receipt.references.map((ref) => `[${ref.kind}](${ref.locator})`).join(', ')}`,
    )
    .join('\n')
  const featureRows = view.feature_map_refs
    .map(
      (reference) =>
        `| \`${reference.feature_id}\` | [${reference.feature_map_locator}](${reference.feature_map_locator}) | \`${reference.entry_point}\` | r${reference.subject_revision} | \`${reference.digest}\` | \`${reference.receipt_id ?? 'none'}\` |`,
    )
    .join('\n')
  const gateRows = view.human_gates
    .map(
      (gate) =>
        `| \`${gate.gate_id}\` | ${gate.family} | ${gate.state} | ${gate.judgment} | [respond](${gate.response_url}) |`,
    )
    .join('\n')
  const cards = view.attention_cards
    .map(
      (gate) =>
        `### ${gate.family}: ${gate.judgment}\n\n- Gate: \`${gate.gate_id}\`\n- Why now: ${gate.why_actionable}\n- Expected: ${gate.expected_behavior}\n- Actual: ${gate.actual_evidence.map((item) => `[${item.label}](${item.locator})`).join(', ') || 'No evidence attached'}\n- Consequences: ${gate.consequences.map((item) => `${item.option} → ${item.outcome}`).join('; ')}\n- Recommendation: ${gate.recommendation ?? 'None'}\n- Controls: ${gate.controls.mode}; ${[...gate.controls.options, ...gate.controls.requested_fields].join(', ') || 'none'}\n- Affected: ${[...gate.affected_requirement_ids, ...gate.affected_work_spec_ids].map((id) => `\`${id}\``).join(', ') || 'change-wide'}\n- [Open bounded response](${gate.response_url})`,
    )
    .join('\n\n')
  return `<!-- control-plane-change-id: ${view.change_id} -->\n<!-- control-plane-projector: ${PROJECTOR} -->\n<!-- control-plane-cursor: ${cursor} -->\n<!-- control-plane-input-digest: ${inputDigest} -->\n# ${view.title}\n\n> Generated by ${PROJECTOR}. Do not edit; rebuild from canonical facts.\n\n## Current intent\n\n- Profile: \`${view.profile}\`\n- Change: \`${view.change_id}\`\n- Intent revision: r${view.intent_revision}\n\n| Requirement | Revision | Text digest |\n| --- | --- | --- |\n${requirements}\n\n## Impact matrix\n\n| Impact | Requirement | Target | Consistency | Rationale |\n| --- | --- | --- | --- | --- |\n${impactRows || '| — | — | — | — | — |'}\n\n## Work DAG\n\n| Work spec | Label | Depends on | Work | State | Blocking gates | Latest valid evidence |\n| --- | --- | --- | --- | --- | --- | --- |\n${workRows}\n\n## Attempts\n\n${attemptRows || '- None'}\n\n## Evidence timeline\n\n${evidenceRows || '- None'}\n\n## Verification feature map\n\n| Feature | Map | Entry point | Subject revision | Digest | Receipt |\n| --- | --- | --- | --- | --- | --- |\n${featureRows || '| — | — | — | — | — | — |'}\n\n## Human gates\n\n| Gate | Family | State | Judgment | Response |\n| --- | --- | --- | --- | --- |\n${gateRows || '| — | — | — | — | — |'}\n\n## Human attention\n\n${cards || 'No actionable human judgment.'}\n\n## Archive readiness\n\nReady: **${readiness.ready ? 'yes' : 'no'}**\n\n| Predicate | Result |\n| --- | --- |\n${predicateRows}\n`
}

export function projectionEventsPath(repoRoot: string): string {
  return join(repoRoot, '.clade', 'ai-control-plane', 'projection-events.jsonl')
}

function readProjectionCheckpoints(repoRoot: string): ControlPlaneProjection['checkpoint'][] {
  const path = projectionEventsPath(repoRoot)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ControlPlaneProjection['checkpoint'])
}

function appendProjectionCheckpoint(
  repoRoot: string,
  checkpoint: ControlPlaneProjection['checkpoint'],
): void {
  const path = projectionEventsPath(repoRoot)
  mkdirSync(dirname(path), { recursive: true })
  withFileLock(`${path}.lock`, 'projection event journal', () => {
    appendFileSync(path, `${JSON.stringify(checkpoint)}\n`)
  })
}

export async function projectChange(input: {
  repoRoot: string
  source: OpsxChangeSource
  alias: string
  activeWriters?: string[]
}): Promise<ControlPlaneProjection> {
  if (!/^[A-Za-z0-9._-]+$/.test(input.alias) || input.alias === 'archive') {
    throw new Error(`invalid mutable change alias: ${input.alias}`)
  }
  const expected = readOpsxChange(input.source)
  return withProjectionLock(input.repoRoot, expected.change_id, async () => {
    const persisted = readPersistedOpsxChange(input.repoRoot, expected.change_id)
    if (canonical(persisted.source) !== canonical(input.source)) {
      throw new Error(`projector source does not match persisted intent for ${expected.change_id}`)
    }
    const built = buildProjectorInput({
      repoRoot: input.repoRoot,
      source: input.source,
      projectionCurrent: true,
      activeWriters: input.activeWriters,
    })
    const viewWithoutCheckpoint = {
      profile: 'opsx-v2' as const,
      title: built.title,
      change_id: built.normalized.change_id,
      intent_revision: built.normalized.intent_revision,
      source_digest: built.normalized.source_digest,
      requirements: built.normalized.requirements,
      work_records: built.projectorInput.work_records,
      attempts: built.attempts,
      runtime_topology: built.runtimeTopology,
      evidence: built.evidence,
      impact_matrix: built.impactMatrix,
      human_gates: built.humanGates,
      attention_cards: built.attentionCards,
      feature_map_refs: built.featureMapRefs,
      archive_readiness: built.archiveReadiness,
    }
    const tasks = renderTasks(
      viewWithoutCheckpoint,
      built.projectorInput.through_cursor,
      built.projectorInput.facts_digest as Digest,
    )
    const tasksPath = join(input.repoRoot, 'openspec', 'changes', input.alias, 'tasks.md')
    const outputDigest = sha256(tasks)
    const checkpoint = {
      artifact_type: 'projection.updated' as const,
      schema_version: 1 as const,
      projection_id: `prj_${built.projectorInput.facts_digest.slice('sha256:'.length, 'sha256:'.length + 16)}`,
      change_id: built.normalized.change_id,
      projector: PROJECTOR,
      through_cursor: built.projectorInput.through_cursor,
      input_digest: built.projectorInput.facts_digest as Digest,
      output_digest: outputDigest,
      output_path: relative(input.repoRoot, tasksPath),
      recorded_at: built.archiveReadiness.evaluated_at,
    }
    const projection: ControlPlaneProjection = { checkpoint, ...viewWithoutCheckpoint }
    await atomicWriteText(tasksPath, tasks)
    await atomicWriteText(
      projectionPath(input.repoRoot, built.normalized.change_id),
      `${JSON.stringify(projection, null, 2)}\n`,
    )
    appendProjectionCheckpoint(input.repoRoot, checkpoint)
    return projection
  })
}

export async function rebuildControlPlaneProjection(input: {
  repoRoot: string
  changeId: string
  alias: string
  activeWriters?: string[]
}): Promise<ControlPlaneProjection> {
  const persisted = readPersistedOpsxChange(input.repoRoot, input.changeId)
  return projectChange({
    repoRoot: input.repoRoot,
    source: persisted.source,
    alias: input.alias,
    activeWriters: input.activeWriters,
  })
}

/**
 * Re-derive one change's `tasks.md` from the tracked intent source, without writing
 * anything.
 *
 * Returns `unreconstructible` when the tracked facts are not there to rebuild from — that
 * is the only case where a missing sidecar is still a violation, because then nothing in
 * the repository explains where the generated file came from.
 */
function rebuildJudgementFromTrackedFacts(
  repoRoot: string,
  alias: string,
  tasksPath: string,
): { verdict: 'current' | 'drift' | 'unreconstructible'; reason: string } {
  const changeId = readControlPlaneChangeId(tasksPath)
  if (!changeId || !existsSync(intentSourcePath(repoRoot, changeId))) {
    return { verdict: 'unreconstructible', reason: 'missing projection sidecar' }
  }
  try {
    const persisted = readPersistedOpsxChange(repoRoot, changeId)
    const bound = resolveWorkflowProjectionBinding(repoRoot, persisted.source).alias
    if (bound !== alias) {
      return {
        verdict: 'unreconstructible',
        reason: `intent source binds ${bound}, not the directory it was found in`,
      }
    }
    const built = buildProjectorInput({
      repoRoot,
      source: persisted.source,
      projectionCurrent: true,
    })
    const tasks = renderTasks(
      {
        profile: 'opsx-v2',
        title: built.title,
        change_id: built.normalized.change_id,
        intent_revision: built.normalized.intent_revision,
        source_digest: built.normalized.source_digest,
        requirements: built.normalized.requirements,
        work_records: built.projectorInput.work_records,
        attempts: built.attempts,
        runtime_topology: built.runtimeTopology,
        evidence: built.evidence,
        impact_matrix: built.impactMatrix,
        human_gates: built.humanGates,
        attention_cards: built.attentionCards,
        feature_map_refs: built.featureMapRefs,
        archive_readiness: built.archiveReadiness,
      },
      built.projectorInput.through_cursor,
      built.projectorInput.facts_digest as Digest,
    )
    return sha256(tasks) === sha256(readFileSync(tasksPath, 'utf8'))
      ? { verdict: 'current', reason: '' }
      : { verdict: 'drift', reason: '' }
  } catch (error) {
    // The reason travels with the verdict, because the two unreconstructible cases are not
    // the same problem and the operator's next move differs. "The tracked facts are not
    // there" is a fresh clone missing its intent source; "the tracked facts refuse to
    // normalize" is acceptance 4 — someone changed `workflow_profile` in a committed intent
    // source. Reporting both as `missing projection sidecar` sent the second one looking for
    // a file that was never the problem.
    return {
      verdict: 'unreconstructible',
      reason: error instanceof Error ? error.message : 'canonical facts are unreconstructible',
    }
  }
}

export function validateControlPlaneProjections(
  repoRoot: string,
): Array<{ path: string; reason: string }> {
  const changesRoot = join(repoRoot, 'openspec', 'changes')
  if (!existsSync(changesRoot)) return []
  const violations: Array<{ path: string; reason: string }> = []
  for (const entry of readdirSync(changesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'archive') continue
    const tasksPath = join(changesRoot, entry.name, 'tasks.md')
    if (!readControlPlaneChangeId(tasksPath)) continue
    let projection: ControlPlaneProjection | null = null
    try {
      projection = readControlPlaneProjection(repoRoot, tasksPath)
    } catch (error) {
      violations.push({
        path: relative(repoRoot, tasksPath),
        reason: error instanceof Error ? error.message : 'projection validation failed',
      })
      continue
    }
    if (!projection) {
      // Fresh clone: the sidecar lives under ignored machine-local state, while the intent
      // source and the change directory are tracked (TD-849). Judging on the sidecar's
      // absence would fail every clone of a healthy repository, so rebuild from the tracked
      // facts and compare against the committed `tasks.md` instead.
      const rebuilt = rebuildJudgementFromTrackedFacts(repoRoot, entry.name, tasksPath)
      if (rebuilt.verdict === 'unreconstructible') {
        violations.push({ path: relative(repoRoot, tasksPath), reason: rebuilt.reason })
      } else if (rebuilt.verdict === 'drift') {
        violations.push({
          path: relative(repoRoot, tasksPath),
          reason: 'generated projection differs from canonical facts; rebuild required',
        })
      }
    } else if (!projection.archive_readiness.predicates.projection_cursors_current) {
      violations.push({
        path: relative(repoRoot, tasksPath),
        reason: 'generated projection differs from canonical facts; rebuild required',
      })
    }
  }
  return violations
}

export function readControlPlaneChangeId(tasksPath: string): string | null {
  if (!existsSync(tasksPath)) return null
  const content = readFileSync(tasksPath, 'utf8')
  return content.match(/^<!-- control-plane-change-id: (chg_[A-Za-z0-9]+) -->$/m)?.[1] ?? null
}

export function readControlPlaneProjection(
  repoRoot: string,
  tasksPath: string,
): ControlPlaneProjection | null {
  const changeId = readControlPlaneChangeId(tasksPath)
  if (!changeId) return null
  return withProjectionReadLock(repoRoot, changeId, () => {
    if (readControlPlaneChangeId(tasksPath) !== changeId) return null
    const content = readFileSync(tasksPath, 'utf8')
    const path = projectionPath(repoRoot, changeId)
    if (!existsSync(path)) return null
    const projection = JSON.parse(readFileSync(path, 'utf8')) as ControlPlaneProjection
    const actualOutputDigest = sha256(content)
    let canonicalInputCurrent = false
    let journalCurrent = false
    try {
      const persisted = readPersistedOpsxChange(repoRoot, changeId)
      const events = correlatedWorkEvents(repoRoot, changeId)
      const runtime = correlatedRuntimeState(repoRoot, changeId)
      const evidence = readEvidence(repoRoot).filter((row) => row.change_id === changeId)
      const decisions = readHumanDecisions(repoRoot).filter((row) => row.change_id === changeId)
      canonicalInputCurrent =
        projection.checkpoint.input_digest ===
        sha256({
          source: persisted.source,
          flow_events: events,
          runtime_events: runtime.events,
          evidence,
          human_decisions: decisions,
        })
      const latest = readProjectionCheckpoints(repoRoot).findLast(
        (checkpoint) => checkpoint.change_id === changeId,
      )
      journalCurrent = Boolean(latest) && canonical(latest) === canonical(projection.checkpoint)
    } catch {
      canonicalInputCurrent = false
      journalCurrent = false
    }
    if (
      projection.change_id !== changeId ||
      projection.checkpoint.change_id !== changeId ||
      projection.checkpoint.output_digest !== actualOutputDigest ||
      !canonicalInputCurrent ||
      !journalCurrent
    ) {
      return {
        ...projection,
        archive_readiness: {
          ...projection.archive_readiness,
          predicates: {
            ...projection.archive_readiness.predicates,
            projection_cursors_current: false,
          },
          ready: false,
          blocking_reasons: [
            ...new Set([
              ...projection.archive_readiness.blocking_reasons,
              'projection_cursors_current',
            ]),
          ],
        },
      }
    }
    return projection
  })
}
