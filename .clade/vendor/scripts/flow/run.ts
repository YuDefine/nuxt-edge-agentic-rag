// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/run.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/run.ts
// clade flow spine — the dumb engine (P1a)
//
// It understands serial, parallel, retry, on-fail. That is the whole language. There are NEVER
// conditionals and NEVER an expression language: judgement stays with the agent, and the engine
// only guarantees that what ran, in what order, with what result, is on the spine. Home-grown
// workflow engines become graveyards by trying to be clever; this one declines.
//
// A spec is JSON, not YAML. The repo carries no yaml parser on purpose
// (`vendor/scripts/deploy-trigger-check.ts` says so outright, and `sync-to-codex.ts` hand-rolls
// scalar quoting rather than take the dependency), so a YAML spec format would mean adding one.
//
//   { "name": "…",
//     "steps": [
//       { "node": "td-register-scan", "args": { "filter": "ready" } },
//       { "parallel": [ { "node": "…" }, { "node": "…" } ] },
//       { "node": "td-rotate", "args": { "ids": "TD-1,TD-2" }, "retry": 1, "onFail": "continue" }
//     ] }
//
// Spans: the run itself is one `invoke_workflow` span; every node invocation is an `execute_tool`
// child of it. That nesting is what makes `flow viz timeline` render a round as a DAG.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { endSpan, startSpan, type SpanHandle } from './emit.ts'
import { normalizeArtifacts } from './nodes/lib/artifacts.ts'

// Overridable so the engine's own tests can point at a fixture directory. Nodes are resolved by
// name, never by path from the spec, so a spec can never reach outside whichever directory this is.
const NODES_DIR =
  process.env.CLADE_FLOW_NODES_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'nodes')

/** Node names are filesystem paths; constrain them so a spec can never reach outside nodes/. */
const NODE_NAME = /^[a-z][a-z0-9-]*$/

export interface NodeStep {
  node: string
  args?: Record<string, string | number | boolean>
  /** Extra attempts after the first. Absent or 0 means one attempt. */
  retry?: number
  /** `stop` (default) aborts the run; `continue` records the failure and moves on. */
  onFail?: 'stop' | 'continue'
  /** Display label; defaults to the node name. */
  label?: string
}

export interface ParallelStep {
  parallel: NodeStep[]
  onFail?: 'stop' | 'continue'
}

export type Step = NodeStep | ParallelStep

export interface FlowSpec {
  name: string
  steps: Step[]
}

export interface StepResult {
  node: string
  label: string
  ok: boolean
  attempts: number
  exitCode: number
  stdout: string
  stderr: string
  data: Record<string, unknown> | null
}

export interface RunResult {
  ok: boolean
  work_id: string
  span_id: string
  results: StepResult[]
  /** Set when a `stop` failure ended the run before every step ran. */
  abortedAfter: string | null
}

function isParallel(step: Step): step is ParallelStep {
  return Array.isArray((step as ParallelStep).parallel)
}

export function nodePath(name: string): string {
  if (!NODE_NAME.test(name)) throw new Error(`illegal node name: ${name}`)
  const path = join(NODES_DIR, `${name}.ts`)
  if (!existsSync(path)) throw new Error(`unknown node: ${name} (looked in ${NODES_DIR})`)
  return path
}

/**
 * `{ filter: 'ready', json: true, quiet: false }` → `['--filter=ready', '--json']`.
 *
 * Values are attached with `=` rather than passed as a following argv entry. Several nodes take a
 * value that is itself a flag string for the tool they wrap (`audit-assert --control`,
 * `scan-orchestrate --args`), and node:util's parseArgs rejects `--control --foo bar` as ambiguous
 * — it cannot tell the value from a flag of its own. `=` removes the ambiguity for every value,
 * so the engine never has to know which nodes have that shape.
 */
/**
 * Exit code -> span outcome. Exit 2 is "nothing to show", not a failure, so a node with no work to
 * do must not abort a run. Exit 3 is `blocked`: the node refuses to act until a human lifts a
 * precondition (the runner-child guard is the canonical case). Blocked is deliberately not folded
 * into fail — a failure asks to be retried, blocked asks to be picked up, and the graph has to be
 * able to show the difference.
 */
export function outcomeFor(exitCode: number): 'ok' | 'skipped' | 'blocked' | 'fail' {
  if (exitCode === 0) return 'ok'
  if (exitCode === 2) return 'skipped'
  if (exitCode === 3) return 'blocked'
  return 'fail'
}

export function toFlags(args: Record<string, string | number | boolean> = {}): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(args)) {
    if (value === false || value === null || value === undefined) continue
    out.push(value === true ? `--${key}` : `--${key}=${value}`)
  }
  return out
}

/**
 * Run one node as a subprocess, wrapped in a span. `--json` is always added so the node's own
 * structured result lands in the span payload rather than being re-derived from prose stdout.
 */
export function runNode(
  step: NodeStep,
  { workId, parentSpan, cwd }: { workId?: string | null; parentSpan?: string | null; cwd?: string },
): StepResult {
  const label = step.label ?? step.node
  const path = nodePath(step.node)
  const flags = [...toFlags(step.args), '--json']
  const maxAttempts = Math.max(1, 1 + (step.retry ?? 0))

  const span = startSpan({
    work_id: workId ?? null,
    kind: 'execute_tool',
    actor: `flow:node:${step.node}`,
    substrate: 'work-loop',
    parent_span: parentSpan ?? null,
    payload: { node: step.node, label, args: step.args ?? {}, max_attempts: maxAttempts },
    cwd,
  })

  let attempts = 0
  let proc = spawnSync(process.execPath, [path, ...flags], { encoding: 'utf8', cwd })
  attempts += 1
  while (proc.status !== 0 && attempts < maxAttempts) {
    proc = spawnSync(process.execPath, [path, ...flags], { encoding: 'utf8', cwd })
    attempts += 1
  }

  const stdout = proc.stdout ?? ''
  let data: Record<string, unknown> | null = null
  try {
    data = JSON.parse(stdout)
  } catch {
    data = null
  }

  const exitCode = proc.status ?? 1
  const ok = exitCode === 0
  const outcome = outcomeFor(exitCode)

  // Artifacts are the one part of a node's `data` that gets lifted to a named payload field
  // rather than staying inside the node's own blob: `brief.ts` reads `payload.artifacts` to
  // answer "where does a successor pick this up", and a coordinate nested under a per-node shape
  // would be invisible to it. Normalised, never trusted verbatim — the strict check ran inside
  // the node, and by here the work is already done (telemetry NEVER outranks it).
  // `defineNode` prints `{ node, summary, data }`, so a node's own structured result is one level
  // down — reading `data.artifacts` off the envelope silently finds nothing forever, and an
  // empty artifact list is indistinguishable from a node that never recorded one.
  const artifacts = normalizeArtifacts(
    (data?.data as Record<string, unknown> | undefined)?.artifacts,
  )

  endSpan(span, {
    outcome,
    payload: {
      attempts,
      exit_code: exitCode,
      summary: (data?.summary as string) ?? stdout.trim().split('\n')[0] ?? '',
      ...(artifacts.length > 0 ? { artifacts } : {}),
      ...(ok ? {} : { stderr: (proc.stderr ?? '').trim().slice(0, 2000) }),
    },
    cwd,
  })

  return {
    node: step.node,
    label,
    ok: ok || exitCode === 2,
    attempts,
    exitCode,
    stdout,
    stderr: proc.stderr ?? '',
    data,
  }
}

/**
 * Wrap an arbitrary command in a span. This is the escape hatch the whole incentive story rests
 * on: when no node fits, the work still has to be able to land on the graph, or "no node fits" and
 * "the work never happened" become the same picture. A library that only records its own nodes
 * measures its own adoption and nothing else.
 *
 * stdio is inherited rather than captured — the point is that wrapping a command behaves exactly
 * like running it, including for long or interactive ones. The span therefore records that it ran
 * and how it ended, not what it printed.
 */
export function runCommand(
  { label, command }: { label?: string; command: string[] },
  { workId, parentSpan, cwd }: { workId?: string | null; parentSpan?: string | null; cwd?: string },
): StepResult {
  if (command.length === 0) throw new Error('runCommand needs a command')
  const name = label ?? command[0]

  const span = startSpan({
    work_id: workId ?? null,
    kind: 'execute_tool',
    actor: `flow:cmd:${name}`,
    substrate: 'work-loop',
    parent_span: parentSpan ?? null,
    payload: { label: name, command },
    cwd,
  })

  const proc = spawnSync(command[0], command.slice(1), { stdio: 'inherit', cwd })
  const exitCode = proc.status ?? 1
  const ok = exitCode === 0
  const outcome = outcomeFor(exitCode)

  endSpan(span, { outcome, payload: { exit_code: exitCode, wrapped: true }, cwd })

  return {
    node: '(command)',
    label: name,
    ok: ok || exitCode === 2,
    attempts: 1,
    exitCode,
    stdout: '',
    stderr: '',
    data: null,
  }
}

/**
 * Execute a spec. `parallel` runs its members before the group's result is judged; because nodes
 * are subprocesses and this engine is synchronous, members run one after another — the semantics
 * that matter (no ordering guarantee between them, group failure judged as a whole) hold either
 * way, and a spec written for parallel stays correct if that ever becomes concurrent.
 */
export function runSpec(
  spec: FlowSpec,
  { workId, cwd }: { workId?: string | null; cwd?: string } = {},
): RunResult {
  const runSpan: SpanHandle = startSpan({
    work_id: workId ?? null,
    kind: 'invoke_workflow',
    actor: `flow:spec:${spec.name}`,
    substrate: 'work-loop',
    payload: { spec: spec.name, steps: spec.steps.length },
    cwd,
  })

  const results: StepResult[] = []
  let abortedAfter: string | null = null

  outer: for (const step of spec.steps) {
    const members = isParallel(step) ? step.parallel : [step]
    const groupResults = members.map((m) =>
      runNode(m, { workId: runSpan.work_id, parentSpan: runSpan.span_id, cwd }),
    )
    results.push(...groupResults)

    for (const [i, r] of groupResults.entries()) {
      if (r.ok) continue
      const onFail = step.onFail ?? 'stop'
      if (onFail === 'stop') {
        abortedAfter = members[i].label ?? members[i].node
        break outer
      }
    }
  }

  const ok = abortedAfter === null && results.every((r) => r.ok)
  endSpan(runSpan, {
    outcome: ok ? 'ok' : 'fail',
    payload: {
      spec: spec.name,
      steps_run: results.length,
      failed: results.filter((r) => !r.ok).map((r) => r.label),
      ...(abortedAfter ? { aborted_after: abortedAfter } : {}),
    },
    cwd,
  })

  return { ok, work_id: runSpan.work_id, span_id: runSpan.span_id, results, abortedAfter }
}

export function loadSpec(path: string): FlowSpec {
  const resolved = resolve(path)
  if (!existsSync(resolved)) throw new Error(`spec not found: ${resolved}`)
  const spec = JSON.parse(readFileSync(resolved, 'utf8'))
  if (!spec || typeof spec.name !== 'string' || !Array.isArray(spec.steps)) {
    throw new Error(`malformed spec (needs { name, steps: [] }): ${resolved}`)
  }
  return spec as FlowSpec
}
