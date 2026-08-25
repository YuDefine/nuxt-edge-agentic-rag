#!/usr/bin/env node
// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/flow.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/flow.ts
// clade flow spine — CLI (P0-min surface)
//
// Subcommands are read/write on the spine, plus the P1a execution surface. The engine stays dumb
// (serial / parallel / retry / on-fail only) so the spine, not the engine's log, remains the
// source of truth about what happened.
//
//   flow open <slug> [--actor <a>]      mint W-<date>-<slug>, emit the work.open point event
//   flow emit --kind K --actor A        one point event from any shell (the CI action's door)
//   flow ingest <file|dir>              merge events produced elsewhere (CI artifact, journal)
//   flow run <spec.json>                execute a spec through the dumb engine
//   flow step <node> [--flags]          run one node from the library, recorded as a span
//   flow status --all                   every repo on the roster, read where it lies
//   flow viz timeline [<work_id>]       span waterfall for one work item (default: latest)
//   flow viz --md [<work_id>]           persist docs/flow/<work_id>.md (mermaid graph + gantt)
//   flow viz --fleet                    persist docs/flow/fleet.md from the propagate ledger
//   flow status [--json] [--stalled]    one line per work item; --stalled is the stall query
//
// Exit codes: 0 ok, 1 usage error, 2 nothing to show, 3 stalls found (`--stalled`, the same
// convention as herdr-patrol so a hook or a work-loop round can branch on it).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { findConsumerRoot } from '../claim-helper.ts'
import {
  emitEvent,
  eventsPath,
  ingestEvents,
  newSpanId,
  openWork,
  parseEventLines,
  readEvents,
  resolveWorkId,
} from './emit.ts'
import { buildFleetSnapshot, renderFleetStatus } from './fleet.ts'
import { loadSpec, runCommand, runNode, runSpec } from './run.ts'
import { buildWorkItems, foldSpans, indexById, latestWorkId, spanDepth } from './spine.ts'
import { DEFAULT_STALL_MINUTES, findStalls, renderStalls } from './stall.ts'
import { readWaves, renderFleetMarkdown, renderWorkMarkdown } from './viz-md.ts'
import { buildWhoRows, renderWho } from './who.ts'

// parseArgs folds everything after `--` into positionals, losing the boundary, so the split has
// to come from raw argv. `flow step <label> -- <cmd>` needs to know where the command starts.
const RAW = process.argv.slice(2)
const DASH_DASH = RAW.indexOf('--')

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    actor: { type: 'string' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
    stalled: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    md: { type: 'boolean', default: false },
    fleet: { type: 'boolean', default: false },
    out: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string' },
    'stall-minutes': { type: 'string' },
    waves: { type: 'string' },
    ledger: { type: 'string' },
    // `emit` flags MUST be declared even though parseArgs runs with strict:false — an
    // undeclared long option there swallows nothing and yields `true`, so `--kind gate`
    // would silently become kind=true with "gate" pushed into positionals.
    kind: { type: 'string' },
    substrate: { type: 'string' },
    outcome: { type: 'string' },
    payload: { type: 'string' },
    'work-id': { type: 'string' },
    'parent-span': { type: 'string' },
    session: { type: 'string' },
  },
  // `flow step <node> --whatever` forwards unknown flags to the node, so parseArgs must not
  // reject them here. The node's own parser is the one that validates them.
  strict: false,
})

const USAGE = `Usage: flow <open|emit|ingest|run|step|viz|status|who> [args]

  open <slug> [--actor <actor>]   mint a work id and emit its work.open event
  emit --kind K --actor A         append one point event (CI action, hooks, any shell)
       [--substrate S] [--outcome O] [--payload '<json>'] [--work-id W]
  ingest <file|dir>               merge externally produced events (CI artifact, journal)
  run <spec.json>                 execute a spec (serial / parallel / retry / on-fail only)
  step <node> [--flags]           run one node from the library, recorded as a span
  step [<label>] -- <cmd>...      wrap any command in a span (use when no node fits)
  status --all                    read every repo on consumers.local, not just this one.
                                  (viz --fleet is a different view: propagate asset lineage)
  viz timeline [<work_id>]        span waterfall for a work item (default: most recent)
  viz --md [<work_id>] [--out P]  write docs/flow/<work_id>.md (mermaid graph + gantt)
  viz --fleet [--waves N]         write docs/flow/fleet.md from the propagate ledger
  who [--json]                    one line per contended resource (dirty path / worktree /
                                  stash) with an owner verdict + a named action. Reads
                                  write-time evidence, not declared fields (TD-664).
  status [--json]                 summarize every work item on the spine
  status --stalled [--json]       stall query; exits 3 when anything is stalled
                                  [--stall-minutes N] grace period (default ${DEFAULT_STALL_MINUTES})

Spine: ${eventsPath()}
`

function fail(msg) {
  process.stderr.write(`flow: ${msg}\n\n${USAGE}`)
  process.exit(1)
}

if (args.help || positionals.length === 0) {
  process.stdout.write(USAGE)
  process.exit(args.help ? 0 : 1)
}

const cmd = positionals[0]

// The fold used to live here. It moved to `spine.ts` when P2 added four more views: a second copy
// of "how events become spans" is a second data model, and two views could then disagree about
// whether the same work item is in flight.
const buildSpans = foldSpans

/** Repo root, so persisted views land in docs/flow/ of this checkout rather than of the cwd. */
function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return process.cwd()
  }
}

function writeView(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body, 'utf8')
  process.stdout.write(`${path}\n`)
}

/** strict:false widens every value to string | boolean; a flag given without a value is `true`. */
function strFlag(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberFlag(value: unknown, fallback: number) {
  const n = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n : fallback
}

if (cmd === 'open') {
  const slug = positionals[1]
  if (!slug) fail('open needs a slug')
  // strict:false (needed so `flow step` can forward unknown flags) widens every parsed value to
  // string | boolean, so narrow rather than assert — a bare `??` lets `--actor` with no value
  // through as `true`.
  const actor = typeof args.actor === 'string' ? args.actor : 'unknown'
  const { work_id, span_id } = openWork({ slug, actor })
  process.stdout.write(`${JSON.stringify({ work_id, span_id })}\n`)
  process.stderr.write(`export CLADE_WORK_ID=${work_id}\n`)
  process.exit(0)
}

if (cmd === 'emit') {
  // A point event from outside this process tree. The CI action is the reason it exists (a
  // composite action cannot import the lib), but nothing about it is CI-specific — any shell,
  // hook, or Makefile can put a fact on the spine with it.
  const kind = strFlag(args.kind)
  const actor = strFlag(args.actor)
  if (!kind || !actor) fail('emit needs --kind and --actor')
  let payload = {}
  const rawPayload = strFlag(args.payload)
  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload)
    } catch {
      fail('--payload must be JSON')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      fail('--payload must be a JSON object')
    }
  }
  const res = emitEvent({
    work_id: resolveWorkId(strFlag(args['work-id'])),
    span_id: newSpanId(),
    parent_span: strFlag(args['parent-span']) ?? process.env.CLADE_FLOW_PARENT_SPAN ?? null,
    phase: 'point',
    kind,
    actor,
    substrate: strFlag(args.substrate) ?? 'manual',
    payload,
    outcome: strFlag(args.outcome) ?? 'ok',
  })
  // Emit is fail-open like every other spine write, but the CLI still reports what happened:
  // a caller that asked for a fact to be recorded deserves to know it was not.
  process.stdout.write(`${JSON.stringify({ written: res.written === true })}\n`)
  process.exit(0)
}

if (cmd === 'ingest') {
  const target = positionals[1]
  if (!target) fail('ingest needs a file or directory')
  if (!existsSync(target)) fail(`no such path: ${target}`)
  const files = statSync(target).isDirectory()
    ? readdirSync(target)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(target, f))
    : [target]
  let malformed = 0
  const records = []
  for (const f of files) {
    const parsed = parseEventLines(readFileSync(f, 'utf8'))
    records.push(...parsed.records)
    malformed += parsed.malformed
  }
  const res = ingestEvents(records)
  const summary = { files: files.length, ...res, malformed }
  process.stdout.write(
    args.json
      ? `${JSON.stringify(summary)}\n`
      : `ingested ${res.ingested}, duplicate ${res.duplicates}, rejected ${res.rejected + malformed} (${files.length} file(s))\n`,
  )
  process.exit(0)
}

if (cmd === 'run') {
  const specPath = positionals[1]
  if (!specPath) fail('run needs a spec path')
  let spec
  try {
    spec = loadSpec(specPath)
  } catch (err) {
    fail((err as Error).message)
  }
  const result = runSpec(spec)
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(`spec: ${spec.name}  work: ${result.work_id}\n`)
    for (const r of result.results) {
      process.stdout.write(
        `${r.ok ? '●' : '✗'} ${r.label}  exit=${r.exitCode} attempts=${r.attempts}\n`,
      )
    }
    if (result.abortedAfter) {
      process.stdout.write(`aborted after: ${result.abortedAfter}\n`)
    }
  }
  process.exit(result.ok ? 0 : 1)
}

if (cmd === 'step') {
  // `-- <cmd>` form first: an arbitrary command wrapped in a span. Without this, work that has no
  // matching node is simply absent from the graph, and the audit signal's advice ("if none fit,
  // say so") would make that absence the expected outcome.
  if (DASH_DASH >= 0) {
    const command = RAW.slice(DASH_DASH + 1)
    if (command.length === 0) fail('step -- needs a command after the separator')
    const label = positionals[1] && positionals[1] !== command[0] ? positionals[1] : undefined
    const result = runCommand({ label, command }, {})
    process.exit(result.exitCode)
  }

  const node = positionals[1]
  if (!node) fail('step needs a node name or `-- <cmd>`')
  // Everything parseArgs did not claim as a flow flag belongs to the node.
  const FLOW_OWNED = new Set([
    'json',
    'help',
    'actor',
    'stalled',
    'all',
    'md',
    'fleet',
    'out',
    'port',
    'host',
    'stall-minutes',
    'waves',
    'ledger',
  ])
  const forwarded: Record<string, string | boolean> = {}
  for (const [k, v] of Object.entries(args)) {
    if (FLOW_OWNED.has(k)) continue
    forwarded[k] = v as string | boolean
  }
  let result
  try {
    result = runNode({ node, args: forwarded }, {})
  } catch (err) {
    fail((err as Error).message)
  }
  process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

// `flow serve` 已退場（2026-08-25 Phase 3）—— viewer 是 review-gui 的 `/flow` 頁。
// 保留成一條會說話的分支而不是直接刪掉：照舊 runbook 打過來的人會拿到 usage error，
// 那讀起來像「打錯字」，而不是「這條路已經收掉了、去哪裡看」。
if (cmd === 'serve') {
  process.stderr.write(
    `flow serve 已退場（2026-08-25）。流程檢視在 review-gui 裡：\n` +
      `  https://review-gui.<maintainer-domain>/flow\n` +
      `  http://127.0.0.1:5174/flow        （本機；systemctl status review-gui.service）\n` +
      `資料同源：該頁走 /api/flow/spine，折的是同一份 ${eventsPath()}。\n` +
      `純文字摘要仍在 CLI：flow status [--all] [--stalled] [--json]\n`,
  )
  process.exit(1)
} else if (cmd === 'viz' && args.fleet) {
  const ledger =
    typeof args.ledger === 'string'
      ? resolve(args.ledger)
      : join(repoRoot(), '.clade', 'metrics', 'propagate-performance.jsonl')
  const waves = readWaves(ledger, numberFlag(args.waves, 6))
  if (waves.length === 0) {
    process.stderr.write(`flow: no propagate runs on ${ledger}\n`)
    process.exit(2)
  }
  let consumerIds: string[] = []
  try {
    const registry = JSON.parse(
      readFileSync(join(repoRoot(), 'registry', 'consumers.json'), 'utf8'),
    )
    consumerIds = (registry.consumers ?? []).map((c) => c.consumer_id).filter(Boolean)
  } catch {
    // The registry is a nicety here — it only turns a path into a shorter name.
  }
  const out =
    typeof args.out === 'string' ? resolve(args.out) : join(repoRoot(), 'docs', 'flow', 'fleet.md')
  writeView(out, renderFleetMarkdown(waves, consumerIds))
  process.exit(0)
} else if (cmd === 'viz' && args.md) {
  const events = readEvents()
  const workId = positionals[1] ?? latestWorkId(events)
  if (!workId) {
    process.stderr.write(`flow: no events on the spine (${eventsPath()})\n`)
    process.exit(2)
  }
  const spans = buildSpans(events.filter((e) => e.work_id === workId))
  if (spans.length === 0) {
    process.stderr.write(`flow: no spans for ${workId}\n`)
    process.exit(2)
  }
  const out =
    typeof args.out === 'string'
      ? resolve(args.out)
      : join(repoRoot(), 'docs', 'flow', `${workId}.md`)
  writeView(out, renderWorkMarkdown(workId, spans))
  process.exit(0)
} else if (cmd === 'viz') {
  const sub = positionals[1]
  if (sub !== 'timeline') {
    fail(`unknown viz view: ${sub ?? '(none)'} (timeline, --md, --fleet)`)
  }
  const events = readEvents()
  const workId = positionals[2] ?? latestWorkId(events)
  if (!workId) {
    process.stderr.write(`flow: no events on the spine (${eventsPath()})\n`)
    process.exit(2)
  }
  const spans = buildSpans(events.filter((e) => e.work_id === workId))
  if (spans.length === 0) {
    process.stderr.write(`flow: no spans for ${workId}\n`)
    process.exit(2)
  }
  const t0 = Date.parse(spans[0].start_ts)
  const tEnd = Math.max(...spans.map((s) => Date.parse(s.end_ts ?? s.start_ts) || t0), t0 + 1)
  const total = Math.max(1, tEnd - t0)
  const WIDTH = 40
  const MARK = { ok: '●', fail: '✗', blocked: '▲', skipped: '·' }

  // Depth by parent_span so a herdr pane under a pi dispatch reads as nested, not as a peer.
  const byId = indexById(spans)
  const depthOf = (s) => spanDepth(s, byId)

  process.stdout.write(`work: ${workId}\nspine: ${eventsPath()}\nspans: ${spans.length}\n\n`)
  for (const s of spans) {
    const start = Date.parse(s.start_ts)
    const end = Date.parse(s.end_ts ?? s.start_ts)
    const from = Math.floor(((start - t0) / total) * WIDTH)
    const width = Math.max(1, Math.round(((end - start) / total) * WIDTH))
    const bar = `${' '.repeat(from)}${'█'.repeat(Math.min(width, WIDTH - from))}`.padEnd(WIDTH)
    const state = s.end_ts ? (MARK[s.outcome] ?? '?') : '…'
    const dur = s.duration_ms === null ? 'in-flight' : `${s.duration_ms}ms`
    const label = `${'  '.repeat(depthOf(s))}${s.substrate}:${s.kind}`
    process.stdout.write(
      `${state} ${bar} ${dur.padStart(10)}  ${label} (${s.actor}) ${s.span_id.slice(0, 8)}\n`,
    )
  }
  process.exit(0)
}

if (cmd === 'status' && args.all) {
  // The one-site view: clade plus every consumer, each read where it lies. Events are NEVER
  // copied here — this opens 14 files and folds each one separately.
  const cladeRoot = repoRoot()
  const snapshot = buildFleetSnapshot({
    cladeRoot,
    stallMinutes: numberFlag(args['stall-minutes'], DEFAULT_STALL_MINUTES),
  })
  if (!snapshot) {
    process.stderr.write(
      `flow: no roster at ${join(cladeRoot, 'consumers.local')} — --all only works in the clade repo\n`,
    )
    process.exit(2)
  }
  if (args.stalled) {
    process.stdout.write(
      args.json
        ? `${JSON.stringify({ stalls: snapshot.stalls, unreadable: snapshot.unreadable }, null, 2)}\n`
        : `${renderStalls(snapshot.stalls.map((s) => ({ ...s, work_id: `${s.repo}/${s.work_id}` })))}` +
            (snapshot.unreadable.length > 0
              ? `\n讀不到（${snapshot.unreadable.length}）:\n${snapshot.unreadable.map((r) => `    ${r.name}  ${r.why}`).join('\n')}\n`
              : ''),
    )
    process.exit(snapshot.stalls.length > 0 ? 3 : 0)
  }
  process.stdout.write(
    args.json ? `${JSON.stringify(snapshot, null, 2)}\n` : renderFleetStatus(snapshot),
  )
  process.exit(0)
}

if (cmd === 'status') {
  const events = readEvents()
  if (events.length === 0) {
    process.stderr.write(`flow: no events on the spine (${eventsPath()})\n`)
    process.exit(2)
  }
  const spans = buildSpans(events)

  if (args.stalled) {
    // Same question herdr-patrol asks, asked of the spine so it covers every substrate at once.
    // Exit 3 on any stall matches patrol's convention; see stall.ts for what patrol still owns.
    const stalls = findStalls(spans, {
      thresholdMinutes: numberFlag(args['stall-minutes'], DEFAULT_STALL_MINUTES),
    })
    process.stdout.write(args.json ? `${JSON.stringify(stalls, null, 2)}\n` : renderStalls(stalls))
    process.exit(stalls.length > 0 ? 3 : 0)
  }

  const rows = buildWorkItems(spans)
  if (args.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
  } else {
    for (const r of rows) {
      process.stdout.write(
        `${r.work_id}  spans=${r.spans} in-flight=${r.in_flight} failed=${r.failed}  ${r.last_ts}\n`,
      )
    }
  }
  process.exit(0)
}

if (cmd === 'who') {
  // Ownership is a property of the consumer's shared main tree, so every worktree asks the
  // same root — otherwise two sessions in two worktrees would each see a different answer to
  // "who holds this file" and both would be right about their own tree and wrong about the
  // contention. findConsumerRoot resolves any cwd inside the repo to that single root.
  const consumerRoot = findConsumerRoot() ?? repoRoot()
  const rows = buildWhoRows(consumerRoot, { selfSessionId: strFlag(args.session) })
  process.stdout.write(args.json ? `${JSON.stringify(rows, null, 2)}\n` : renderWho(rows))
  // Exit 3 on anything held by someone else or unattributable — same convention `status
  // --stalled` and herdr-patrol use, so a caller can gate on it without parsing output.
  process.exit(rows.some((r) => r.verdict !== 'mine') ? 3 : 0)
}

fail(`unknown subcommand: ${cmd}`)
