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

import { readEvents, resolveDecision } from './emit.ts'

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
}

export interface DecisionLookup {
  spanId: string
  workId: string
  question: string
  options: string[]
  recommended: string | null
  category: string
  carrier: string | null
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
  }
}

/**
 * Where an answer has to be written down so it survives this process.
 *
 * A bare `TD-<n>` means the shared register, not a file of its own. Everything else is a repo
 * -relative path, and the containment check is load-bearing: `carrier` reaches here from a
 * payload, and a payload is not a trusted path source. Outside the repo → null, never followed.
 */
export function carrierPath(carrier: string | null, repoRoot: string): string | null {
  if (!carrier) return null
  const trimmed = carrier.trim()
  if (/^TD-\d+$/u.test(trimmed)) return join(repoRoot, TD_REGISTER)
  const root = resolve(repoRoot)
  const p = resolve(root, trimmed.split('#')[0])
  return p === root || p.startsWith(`${root}/`) ? p : null
}

export function landingBlock(
  question: string,
  answer: string,
  spanId: string,
  via: string,
  now = new Date(),
): string {
  const stamp = now.toISOString().slice(0, 10)
  return [
    '',
    `### 決策紀錄 ${stamp} — ${question}`,
    '',
    `**答案**：${answer}`,
    '',
    `來源：flow spine \`decision.request\` span \`${spanId}\`（${via}）。`,
    '',
  ].join('\n')
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
