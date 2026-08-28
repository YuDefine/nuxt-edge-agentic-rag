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
//   flow ask --question Q [--option ...]    put a question on the decision queue
//   flow pending [--json] [--repo-only]  the decision queue as `\my` renders it in chat
//   flow sources [--apply] [--all]     read HANDOFF / TD / state.json / tasks into the queue
//   flow ask-options <span_id>          hand a ruling back: it arrived with no options
//   flow clarify <span_id> --text T     answer a "this question needs more detail" request
//   flow ingest <file|dir>              merge events produced elsewhere (CI artifact, journal)
//   flow run <spec.json>                execute a spec through the dumb engine
//   flow step <node> [--flags]          run one node from the library, recorded as a span
//   flow status --all                   every repo on the roster, read where it lies
//   flow viz timeline [<work_id>]       span waterfall for one work item (default: latest)
//   flow viz --md [<work_id>]           persist docs/flow/<work_id>.md (mermaid graph + gantt)
//   flow viz --fleet                    persist docs/flow/fleet.md from the propagate ledger
//   flow status [--json] [--stalled]    one line per work item; --stalled is the stall query
//   flow otlp [<work_id>] [--out P]     export spans as OTLP/HTTP JSON (deep query lives in a
//                                       real trace UI, not in review-gui)
//
// Exit codes: 0 ok, 1 usage error, 2 nothing to show, 3 stalls found (`--stalled`, the same
// convention as herdr-patrol so a hook or a work-loop round can branch on it).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { findConsumerRoot } from '../claim-helper.ts'
import { fleetRoots, syncDecisions, syncFleet } from './decision-sync.ts'
import {
  acceptWork,
  answerClarification,
  dismissGated,
  dropWork,
  amendDecision,
  emitEvent,
  endSpan,
  eventsPath,
  ingestEvents,
  knownWorkIds,
  markWorkDone,
  newSpanId,
  openWork,
  parkWork,
  parseEventLines,
  pickupDecision,
  readEvents,
  requestClarification,
  requestDecision,
  resolveWorkId,
  spanHandleFromSpine,
  spanIsClosed,
} from './emit.ts'
import { REF_SCHEMES, answerDecision, parseRef } from './answer.ts'
import { LINT_NOTES, OPTIONS_REQUEST_TEXT, buildDecisionQueue } from './decisions.ts'
import { isAnswerable } from './decision-sources.ts'

/** `flow ask --category` 的驗收。無效值 fail closed，NEVER 靜默降級成 `ruling`。 */
const ASK_CATEGORIES = [
  'ruling',
  'review',
  'other-repo',
  'human-action',
  'loop-structural',
] as const

function askCategory(raw: string | null | undefined): (typeof ASK_CATEGORIES)[number] {
  if (!raw) return 'ruling'
  const hit = ASK_CATEGORIES.find((c) => c === raw)
  if (!hit) {
    throw new Error(`--category 只收 ${ASK_CATEGORIES.join(' / ')}，收到「${raw}」`)
  }
  return hit
}
import {
  REPO_NOT_ON_ROSTER,
  buildFleetSnapshot,
  renderFleetStatus,
  resolveRepoRootByName,
} from './fleet.ts'
import { QUESTION_DIR } from '../review-gui.question-page.ts'
import { inlineOptionLetters, inlineOptionsRefusal } from './inline-options.ts'
import { measureRepo, measurementLine } from './measure.ts'
import { DEFAULT_OTLP_ENDPOINT, countSpans, postOtlp, toOtlpPayload } from './otlp-export.ts'
import { loadSpec, runCommand, runNode, runSpec } from './run.ts'
import { buildServeSnapshot } from './serve.ts'
import {
  buildWorkItems,
  foldSpans,
  indexById,
  latestWorkId,
  orphanRatio,
  spanDepth,
} from './spine.ts'
import { DEFAULT_STALL_MINUTES, findOwnershipStalls, findStalls, renderStalls } from './stall.ts'
import { readWaves, renderFleetMarkdown, renderWorkMarkdown } from './viz-md.ts'
import { buildBoardLanes } from './board.ts'
import { buildDossier, dossierJson, overviewJson, renderDossier, renderOverview } from './brief.ts'
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
    endpoint: { type: 'string' },
    'parent-span': { type: 'string' },
    session: { type: 'string' },
    reason: { type: 'string' },
    // `done` / `park` flags — declared for the same reason as `emit`'s: strict:false turns an
    // undeclared long option into `true` with its value stranded in positionals.
    verification: { type: 'string' },
    'verified-by': { type: 'string' },
    note: { type: 'string' },
    // `ask` / `clarify` flags — 同上一段註解的理由，未宣告會變成 true 並把值推進 positionals。
    question: { type: 'string' },
    options: { type: 'string' },
    // 可重複。`--options 'A,B'` 的逗號切法對「選項本文含逗號」無解，而拍板題的選項是整句
    // 「這樣做會怎樣」，含逗號是常態。multiple 讓一條選項一個旗標，NEVER 再靠切字串。
    option: { type: 'string', multiple: true },
    recommended: { type: 'string' },
    category: { type: 'string' },
    carrier: { type: 'string' },
    // 互動決策頁。同上：未宣告的話 `--question-page .impeccable/questions/x.json` 會變成
    // question-page=true、路徑落進 positionals，而題目照樣進佇列 —— 只是點開來沒有頁。
    'question-page': { type: 'string' },
    'question-page-label': { type: 'string' },
    text: { type: 'string' },
    // `answers` flag. Boolean, but declared for the same reason as the rest: it is the difference
    // between reading answers and freezing them, and that is not a distinction to leave to
    // strict:false's guesswork.
    claim: { type: 'boolean', default: false },
    // `open` flags — same reason again: undeclared, `--origin notion:<uuid>` becomes
    // origin=true with the uuid stranded in positionals, and the work item opens with no origin
    // while the caller sees a success line.
    origin: { type: 'string' },
    title: { type: 'string' },
    // `sources` flag. Boolean, so strict:false would already yield `true` — declared anyway so
    // the option list stays the one place that says what this CLI accepts.
    apply: { type: 'boolean', default: false },
    // `pending` flag. Fleet is the default there (a question in a consumer repo is still a
    // question for the same human), so the flag has to be the one that NARROWS.
    'repo-only': { type: 'boolean', default: false },
    // `answer` flags — 同 `emit` 那段的理由。這裡漏宣告的代價特別高：`--answer <text>` 變成
    // true 之後答案本文會落進 positionals，而 span_id 也在 positionals 裡。
    answer: { type: 'string' },
    repo: { type: 'string' },
    via: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  // `flow step <node> --whatever` forwards unknown flags to the node, so parseArgs must not
  // reject them here. The node's own parser is the one that validates them.
  strict: false,
})

const USAGE = `Usage: flow <open|done|accept|drop|park|ask|pending|answer|answers|sources|amend-options|ask-options|clarify|dismiss|emit|close|ingest|run|step|viz|status|who|brief|otlp> [args]

  open <slug> [--actor <actor>]   mint a work id and emit its work.open event
  done <work_id>                  claim the work item is finished. --verification is REQUIRED and
       --verification '<how>'     is refused when empty: a done nobody can check is what makes
       [--verified-by W]          "accepted" meaningless. Any span started later reverts it.
  accept <work_id> --reason R     the human verdict: this work item is finished and accepted
  drop <work_id> --reason R       the human verdict: this work item is written off
  park <work_id> --carrier C      the work stopped at a prose carrier awaiting a successor
       [--note N]                 (handoff:<section> | td:TD-NNN | tasks:<path>)
  ask --question Q                put a question on the decision queue (/decisions renders it)
      [--question-page P]          the question is answered on an impeccable decision page, not by
                                   picking an option: P is the payload JSON, repo-relative under
                                   .impeccable/questions/. /decisions spawns it on open and frames
                                   it. NEVER pass a port — the server is started when the card is
                                   opened, which may be hours later.
      [--question-page-label L]    one line saying what that page is choosing
      [--option '<一句話>']...     選項一條一個旗標（推薦用這個；--options 'A,B' 仍可用）。
      [--recommended R]            問句本文自己寫了 (A)/(B) 卻沒帶選項時，ask 會拒絕：那樣
      [--carrier PATH]             /decisions 只畫得出一個空白輸入框。
      [--category C] [--actor A]
  pending [--json]                the decision queue, rendered the way \`\\my\` reads it in chat:
          [--repo-only]           only \`ruling\` gets a Qn, the other buckets are bullets, and the
                                  現況量測 line is measured live. Fleet by default. exit 2 = empty.
  answer <span_id>                answer one pending decision the way /decisions does — same
         --answer '<text>'        function, same repo resolution, same carrier landing. This is
         [--repo <name>]          what \`\\my\` runs when Charles replies in chat; NEVER hand-write
         [--via <text>] [--dry-run]  an inline import of answerDecision instead.
  answers [--claim] [--json]      list this repo's recently answered decisions. --claim emits a
                                  decision.pickup on each still-editable one: it says an agent has
                                  read the answer and is acting on it, which is what stops
                                  /decisions from offering to change it underneath you
  sources [--apply] [--all]       reconcile the four FILE sources of \`\\my\` (work-loop state,
          [--json]                HANDOFF.md, docs/tech-debt.md, openspec tasks) against the
                                  queue. Without --apply it only reports what it would do.
  dismiss <span_id> --reason R    write off a decision span that no longer needs anyone — blocked
                                  and settled another way, or asked but never really a question.
                                  Clears it from /decisions and --stalled.
  amend-options <span_id>         supply the options a ruling should have arrived with, without
      --option '<一句話>'...       re-asking it (a re-ask retracts the answer history). This is
      [--recommended R]            what \`ask-options\` asks for; NEVER hand-write an inline import
      --reason '<why>'             of amendDecision instead.
  ask-options <span_id>           hand a ruling back because it arrived with no options. The
                                  wording is fixed (\`OPTIONS_REQUEST_TEXT\`) so it costs one
                                  command, not a paragraph typed on a phone.
  clarify <span_id> --text T      answer a "this question needs more detail" request. What
                                  \`status --stalled\` tells you to run for clarification-requested.
  emit --kind K --actor A         append one point event (CI action, hooks, any shell)
       [--substrate S] [--outcome O] [--payload '<json>'] [--work-id W]
  close <span_id> --outcome O     close an in-flight span nobody will ever close itself
        --reason '<why>'          (dead pi run, killed process). Herdr dispatches and decision
                                  requests have their own closers and are refused here.
  ingest <file|dir>               merge externally produced events (CI artifact, journal)
  run <spec.json>                 execute a spec (serial / parallel / retry / on-fail only)
  step <node> [--flags]           run one node from the library, recorded as a span
  step [<label>] -- <cmd>...      wrap any command in a span (use when no node fits)
  status --all                    read every repo on consumers.local, not just this one.
                                  (viz --fleet is a different view: propagate asset lineage)
  viz timeline [<work_id>]        span waterfall for a work item (default: most recent)
  viz --md [<work_id>] [--out P]  write docs/flow/<work_id>.md (mermaid graph + gantt)
  viz --fleet [--waves N]         write docs/flow/fleet.md from the propagate ledger
  brief [--json]                  the board: 待你 / 受阻 / 進行中 / 擱置 / 已收, under a hard
        [--work-id W]             token budget. Without --work-id it is the session-opening
                                  overview; with one it is that work item's dossier (state, lane,
                                  origin, last 10 events, pending decisions, dispatch trail,
                                  session chain, stall + action). Same lane function /board reads.
  who [--json] [--transcripts]    one line per contended resource (dirty path / worktree /
                                  stash) with an owner verdict + a named action. Reads
                                  write-time evidence, not declared fields (TD-664).
                                  --transcripts also greps ~/.claude/projects for candidate
                                  authors of paths the journal has no entry for: minutes, not
                                  seconds (4.3 GB corpus), so it is off unless asked for.
  status [--json]                 summarize every work item on the spine, then the done-not-yet-
                                  accepted queue (what \`\\my\` has to sweep for otherwise)
  status --stalled [--json]       stall query; exits 3 when anything is stalled
                                  [--stall-minutes N] grace period (default ${DEFAULT_STALL_MINUTES})
  otlp [<work_id>] [--out P]      render the spine as OTLP/HTTP JSON. Without --out it POSTs to
       [--endpoint URL]           ${DEFAULT_OTLP_ENDPOINT}
                                  (self-host Arize Phoenix: one container, native gen_ai semconv).
                                  Deep span query belongs there, NEVER in review-gui.

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

/** Report one write and exit on its result. Spine writes are fail-open; the CLI still tells you. */
function report(
  res: { written?: boolean; errors?: { code: string; message?: string }[] },
  extra: Record<string, unknown>,
): never {
  const ok = res.written === true
  if (!ok && res.errors) {
    process.stderr.write(`flow: ${res.errors.map((e) => e.message ?? e.code).join('; ')}\n`)
  }
  process.stdout.write(`${JSON.stringify({ written: ok, ...extra })}\n`)
  process.exit(ok ? 0 : 1)
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
  const origin = strFlag(args.origin)
  const title = strFlag(args.title)
  // Rejected at the CLI rather than swallowed: `--origin` is something a caller typed on purpose,
  // and a typo'd scheme would fold into a work item whose origin can never be joined against
  // anything. Omitting the flag stays free — this refuses a WRONG origin, never a missing one.
  if (origin) {
    const parsed = parseRef(origin)
    if (!parsed?.scheme) {
      fail(
        `open --origin must be <scheme>:<id> with scheme one of ${REF_SCHEMES.join(' | ')} (got: ${origin})`,
      )
    }
  }
  const { work_id, span_id } = openWork({ slug, actor, origin, title })
  process.stdout.write(`${JSON.stringify({ work_id, span_id })}\n`)
  process.stderr.write(`export CLADE_WORK_ID=${work_id}\n`)
  process.exit(0)
}

/**
 * The terminal half of the work lifecycle: an agent claims `done`, a human answers `accept` / `drop`.
 *
 * Split across three verbs rather than one `flow close-work --state`, because who may write which is
 * the whole point: the claim and the verdict come from different parties, and a single verb with a
 * state flag invites the doing side to type its own acceptance.
 */
const WORK_VERBS = new Set(['done', 'accept', 'drop', 'park'])

if (WORK_VERBS.has(cmd)) {
  const workId = positionals[1] ?? strFlag(args['work-id'])
  if (!workId) fail(`${cmd} needs a work id (or --work-id)`)
  // An unknown work id would file a claim against a work item that does not exist — countable
  // nowhere, visible nowhere, and indistinguishable from a typo in the id you meant to finish.
  if (!knownWorkIds().has(workId)) {
    fail(`no work item ${workId} on this spine (${eventsPath()}); \`flow open <slug>\` mints one`)
  }
  const actor = strFlag(args.actor) ?? 'unknown'

  if (cmd === 'done') {
    const verification = strFlag(args.verification)
    // Refused here AND in emitEvent. Not redundancy: this one gives the person a usage message,
    // the one in the library covers every other door into the same kind.
    if (!verification) {
      fail(
        "done needs --verification '<how it was verified>'; an unverifiable done is what makes acceptance meaningless",
      )
    }
    const res = markWorkDone({
      work_id: workId,
      verification,
      verifiedBy: strFlag(args['verified-by']) ?? actor,
      actor,
      substrate: strFlag(args.substrate) ?? 'claude-code',
    })
    report(res, { work_id: workId, state: 'done' })
  }

  if (cmd === 'accept' || cmd === 'drop') {
    const reason = strFlag(args.reason)
    if (!reason) fail(`${cmd} needs --reason; a verdict with no stated basis is a silent close`)
    const by = strFlag(args['verified-by']) ?? strFlag(args.actor) ?? 'human'
    const res = (cmd === 'accept' ? acceptWork : dropWork)({
      work_id: workId,
      reason,
      by,
      substrate: strFlag(args.substrate) ?? 'manual',
    })
    report(res, { work_id: workId, state: cmd === 'accept' ? 'accepted' : 'dropped' })
  }

  const carrier = strFlag(args.carrier)
  if (!carrier) fail('park needs --carrier (handoff:<section> | td:TD-NNN | tasks:<path>)')
  const res = parkWork({
    work_id: workId,
    carrier,
    note: strFlag(args.note),
    actor,
    substrate: strFlag(args.substrate) ?? 'claude-code',
  })
  report(res, { work_id: workId, parked_at: carrier })
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

if (cmd === 'ask') {
  // The CLI door to `requestDecision`. Before this existed the only way to put a question on the
  // queue was to import the lib from inside a process that happened to be running, which meant
  // shells, hooks and one-off scripts had no way to ask anything at all.
  const question = strFlag(args.question)
  if (!question) fail('ask needs --question')
  const rawOptions = strFlag(args.options)
  const options = [
    ...(Array.isArray(args.option) ? args.option : []).map((o) => String(o).trim()),
    ...(rawOptions ? rawOptions.split(',').map((o) => o.trim()) : []),
  ].filter(Boolean)
  // 問句本文自己列了 (A)/(B)，卻沒有一條選項進 payload —— 那題會以一個空白輸入框出現在手機
  // 上，看起來可以回答，實際上答的人得自己把字母打回去。拒絕，而不是替它猜：猜錯的選項被點
  // 下去就是一個沒人想要的答案被落檔（同 [[decision-authoring]] 對散文的 NEVER）。
  //
  // 互動決策頁（`--question-page`）的選項是頁面上的卡片，不是 `options[]`。路徑在這裡就驗，
  // 而不是等到 `/decisions` 點開才發現 —— 那時發問的人已經走了。
  const questionPagePath = strFlag(args['question-page'])
  const questionPage = questionPagePath
    ? {
        payload_path: questionPagePath,
        label: strFlag(args['question-page-label']) ?? null,
      }
    : null
  if (questionPage && !questionPage.payload_path.startsWith(`${QUESTION_DIR}/`)) {
    fail(
      `--question-page 必須是 ${QUESTION_DIR}/ 底下的 repo-relative 路徑（收到 ${questionPage.payload_path}）`,
    )
  }

  // 只擋這一個形狀。「這題要給值」的題本來就沒有選項，本文裡也不會有從 A 起連續的字母。
  // 帶決策頁的題同樣豁免：它的選項在頁面上，把它們抄成 `--option` 就是把卡片壓成一行字。
  if (options.length === 0 && !questionPage) {
    const letters = inlineOptionLetters(question)
    if (letters.length > 0) {
      fail(inlineOptionsRefusal(letters, letters.map((l) => `--option '${l} …'`).join(' ')))
    }
  }
  const handle = requestDecision({
    question,
    options,
    ...(questionPage ? { payload: { question_page: questionPage } } : {}),
    recommended: strFlag(args.recommended) ?? null,
    /*
     * 驗過再送，NEVER 用窄 cast 把任何字串當成 `ruling` 塞進 span。
     *
     * 原本寫 `as 'ruling'`，於是 `--category review` 會被型別系統當成 ruling 收下、實際上把
     * 使用者給的字串原樣寫進 payload——編譯期靜音、執行期靜音，而錯的 category 決定這一列在
     * 兩個渲染端落在哪一桶、編不編 Qn。詞彙表擴充時這種 cast 不會報錯，這正是它的問題。
     */
    category: askCategory(strFlag(args.category)),
    carrier: strFlag(args.carrier) ?? null,
    actor: strFlag(args.actor) ?? 'unknown',
    work_id: strFlag(args['work-id']) ?? null,
  })
  process.stdout.write(`${JSON.stringify({ span_id: handle.span_id, work_id: handle.work_id })}\n`)
  process.exit(0)
}

if (cmd === 'pending') {
  // `\my` 的 CLI 門 —— 對話端要看的那份佇列。
  //
  // 讀的是 `/decisions` 那個畫面用的同一組函式（`buildServeSnapshot` → `buildDecisionQueue`
  // → `measureRepo`，見 `vendor/review-gui-web/server/api/decisions.get.ts`）。同源是刻意的：
  // 2026-08-27 的決策是「`\my` 是 `/decisions` 的 chat 互動版本」，兩邊各掃各的會讓同一個
  // 待拍板事項在手機上與對話裡長得不一樣，而人會以為那是兩件事。
  //
  // Fleet 是預設：consumer repo 裡的問題照樣是同一個人要回的，只看 clade 會讓它們永遠不出現。
  const root = process.env.CLADE_HOME ?? repoRoot()
  const fleet = args['repo-only'] !== true
  const snapshot = buildServeSnapshot({ cwd: root, cladeRoot: root, fleet })
  // 分桶不再吃 fleet 旗標：`跨 repo` 那幾節在 `categoryOfHeading` 就被擋掉，兩邊看到的是
  // 同一份佇列。`\my` 與 `/decisions` 的漂移由那裡收斂，不在這裡。
  const queue = buildDecisionQueue(snapshot.spans)

  // 現況量測**當下實跑**，NEVER 快取：`\my` 契約逐字要求它不得引用寫死的數字，而過期的
  // dirty 數與新鮮的長得一模一樣。
  const measurements = fleet ? fleetRoots(root).map(measureRepo) : [measureRepo(root)]

  if (args.json === true) {
    const fleetError = 'fleet_error' in snapshot ? { fleet_error: snapshot.fleet_error } : {}
    process.stdout.write(`${JSON.stringify({ ...queue, measurements, ...fleetError }, null, 2)}\n`)
    process.exit(queue.asked.length + queue.gated.length === 0 ? 2 : 0)
  }

  const lines: string[] = []
  if ('fleet_error' in snapshot && snapshot.fleet_error) lines.push(`⚠ ${snapshot.fleet_error}`, '')

  // 只有 ruling 編 Qn。其餘三類照 QnX 協定一律 bullet —— 編了號的東西讀起來就像回一個字母
  // 就能結案，而 human-action / other-repo / loop-structural 三類回不掉。
  //
  // 分組鍵用 `bucket` 不用 `category`：spine 是 append-only，退役的 `irreversible` 詞彙還留在
  // 既有 span 上，`bucket` 在 `buildDecisionQueue` 把它摺進 human-action——一次、兩個渲染端共用。
  //
  // `ruling` 與 `review` 是可回答的兩類，只有它們編 `Qn`，而且編號**連續**跑過去，
  // 「回 Q1A Q2通過」才是一個平坦的命名空間。NEVER 在第二組重新從 Q1 起算。
  const ruling = queue.asked.filter((d) => d.bucket === 'ruling')
  const review = queue.asked.filter((d) => d.bucket === 'review')
  const answerable = [...ruling, ...review]
  const rest = queue.asked.filter((d) => !isAnswerable(d.bucket))

  const hours = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m}m`)
  const where = (d: { repo: string | null }) => (d.repo ? `[${d.repo}] ` : '')

  // 同 `pages/decisions.vue` 的 `optionText()`：`recommended` 欄是推薦的唯一來源，文字裡再寫
  // 一個「（推薦）」就會渲染成兩個。requestDecision 從 2026-08-27 起會剝掉新寫入的，但脊椎是
  // append-only，既有的 span 只能在渲染這一端容忍。
  const optionText = (option: string) => option.replace(/\s*（推薦）\s*$/u, '')

  // 問題原文可以是好幾行（從 HANDOFF 段落搬過來的那些就是）。一題一行才數得出有幾題。
  const oneLine = (text: string, max = 78) => {
    const flat = text.replace(/\s+/gu, ' ').trim()
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
  }

  answerable.forEach((d, i) => {
    // Group heading, emitted at the boundary rather than by slicing the list into two loops:
    // the `Qn` counter has to keep running across the boundary, and two loops means two counters.
    if (i === 0 && ruling.length > 0) lines.push(`要我拍板（${ruling.length}）`, '')
    if (i === ruling.length && review.length > 0) lines.push(`要我驗收（${review.length}）`, '')

    lines.push(`Q${i + 1}  ${where(d)}${oneLine(d.question)}  ${hours(d.age_minutes)}`)
    d.options.forEach((option, oi) => {
      const star =
        d.recommended !== null && optionText(d.recommended) === optionText(option) ? '（推薦）' : ''
      lines.push(`      ${String.fromCodePoint(65 + oi)}. ${optionText(option)}${star}`)
    })
    // NEVER 把「沒有選項」印成「這題要給值」——`\my` 契約要的是二擇一：附選項，**或**明說
    // 要給值並逐項列出要填什麼。兩者都沒有的題目是沒寫完，把它渲染成第二種等於幫違規蓋章，
    // 而讀的人會以為球在自己手上（2026-08-27 實測 38 題有 37 題落在這一格）。
    if (d.needs_options) {
      lines.push('      ⚠ 沒給選項也沒說要填什麼——這題現在答不了')
      lines.push(`      要選項：node vendor/scripts/flow/flow.ts ask-options ${d.span_id}`)
    }
    // 驗收側的同一件事：選項在（通過／退回永遠都在），但沒有東西可看，所以一樣答不了。
    // 印在選項下面而不是取代它們——選項還是對的，缺的是判斷依據。
    if (d.needs_evidence) {
      lines.push('      ⚠ 沒附「改了什麼 / 證據 / 退回會怎樣」——看不到要看什麼，這題現在驗不了')
      lines.push('      已自動退回給 agent 補件；補齊後下次掃描就會消失')
    }
    // 寫法警示，印在題目下面而不是彙總在結尾：讀的人有兩種，而它們對這行的用途不同——
    // 回答的人要知道「這題長成這樣不是我看錯」，下一個編那份檔的 agent 要知道「這一條是我
    // 造成的、該去修哪」。彙總區塊只服務前者，第二種讀者不會往下捲。
    //
    // NEVER 升級成錯誤或擋下任何東西：HANDOFF 是高頻活文件，把寫法卡在寫入路徑上換到的是
    // 一個 bypass flag，不是更好的 bullet。
    if (d.lint.includes('near-miss-option-line')) {
      lines.push(`      ✎ ${LINT_NOTES['near-miss-option-line']}`)
    }
    if (d.carrier) lines.push(`      答案落到：${d.carrier}`)
    if (d.awaiting_clarification) {
      lines.push(
        `      ⚠ 你問了「${oneLine(d.clarifications.at(-1)?.text ?? '', 40)}」，還沒有人回`,
      )
    }
    lines.push(`      span ${d.span_id}`)
    lines.push('')
  })

  // 桶名的動詞承載分類軸（球在誰手上、什麼型態的動作）：「要我動手」是只有人做得到的一次性
  // 動作，讀者看桶名就知道這一段不是拍板題。舊名「不可逆／人類 gate」被 2026-08-28 退役——
  // 它描述的是 heading 規則（Blocked 整節倒進來），不是讀者要做什麼，實測 15 列有 ~10 列是
  // 狀態註記，Charles 的逐字反應是「我看不懂我要幹嘛」。
  const BUCKET: Record<string, string> = {
    'human-action': '要我動手',
    'other-repo': '不在本 repo',
    'loop-structural': 'loop 結構性推不動',
  }
  for (const [bucket, title] of Object.entries(BUCKET)) {
    const rows = rest.filter((d) => d.bucket === bucket)
    if (rows.length === 0) continue
    lines.push(`${title}（${rows.length}）`, '')
    for (const d of rows) {
      /*
       * 「登記於 X 前」, NEVER 「等了 X」.
       *
       * 這幾桶是狀態與（球不在讀者手上的）動作：把時間印成「等了」，量的是一個不歸任何人關掉
       * 的延遲。四列 16.6h 印成等待，教會讀者這一頁的數字是雜訊——那個代價會傳染到上面真的
       * 在等人的 `Qn`。年齡照樣印，因為一週沒動的狀態值得注意；改掉的只是那個「宣稱」。
       */
      lines.push(`  - ${where(d)}${oneLine(d.question)}  登記於 ${hours(d.age_minutes)} 前`)
      // 動作行是這一桶存在的理由：條目標題是「哪件事」，這一行才是「我要幹嘛」。
      if (d.action) lines.push(`    → ${d.action}`)
      if (d.lint.includes('near-miss-option-line')) {
        lines.push(`    ✎ ${LINT_NOTES['near-miss-option-line']}`)
      }
    }
    lines.push('')
  }

  const unknown = rest.filter((d) => !(d.bucket in BUCKET))
  if (unknown.length > 0) {
    lines.push(`未分類（${unknown.length}）`, '')
    for (const d of unknown)
      lines.push(`  - ${where(d)}${oneLine(d.question)}  ${hours(d.age_minutes)}`)
    lines.push('')
  }

  if (queue.gated.length > 0) {
    lines.push(`卡住、等人動手（${queue.gated.length}）`, '')
    for (const g of queue.gated) {
      lines.push(`  - ${where(g)}${g.label ?? g.kind}  ${hours(g.age_minutes)}`)
      lines.push(`    → ${g.action}`)
    }
    lines.push('')
  }

  if (queue.asked.length + queue.gated.length === 0) lines.push('佇列是空的。', '')

  const measured = measurementLine(measurements)
  if (measured) lines.push(measured)

  process.stdout.write(`${lines.join('\n')}\n`)
  process.exit(queue.asked.length + queue.gated.length === 0 ? 2 : 0)
}

if (cmd === 'sources') {
  // The file half of `\my`. `ask` is how an agent puts a question on the queue deliberately;
  // this is how the questions that were only ever written into a file get there too.
  //
  // DRY BY DEFAULT. Applying is a write to every repo on the roster, and the failure mode of
  // getting the dedup key wrong is a queue that grows without bound — so the safe invocation has
  // to be the short one, and `--apply` has to be typed on purpose.
  const apply = args.apply === true
  const results =
    args.all === true
      ? syncFleet({ cladeRoot: process.env.CLADE_HOME ?? repoRoot(), dryRun: !apply })
      : [syncDecisions({ repoRoot: findConsumerRoot(process.cwd()) ?? repoRoot(), dryRun: !apply })]

  if (args.json === true) {
    process.stdout.write(`${JSON.stringify({ applied: apply, results }, null, 2)}\n`)
    process.exit(0)
  }

  let opened = 0
  let retracted = 0
  let amended = 0
  let suppressed = 0
  for (const result of results) {
    suppressed += result.suppressed
    const opens = result.actions.filter((a) => a.type === 'open')
    const retracts = result.actions.filter((a) => a.type === 'retract')
    const amends = result.actions.filter((a) => a.type === 'amend')
    opened += opens.length
    retracted += retracts.length
    amended += amends.length
    if (result.skipped) {
      process.stdout.write(`${result.repo}\n  skipped: ${result.skipped}\n`)
      continue
    }
    if (opens.length === 0 && retracts.length === 0 && amends.length === 0) continue
    process.stdout.write(
      `${result.repo}  (掃到 ${result.scanned} 件，已在佇列 ${result.tracked} 件)\n`,
    )
    for (const action of opens) {
      process.stdout.write(`  + ${action.category.padEnd(15)} ${action.question.slice(0, 88)}\n`)
    }
    for (const action of retracts) {
      process.stdout.write(`  - 撤回（來源已消失） ${action.source_id}\n`)
    }
    // Distinguished from `+` on purpose: an amend does NOT add a row to anybody's queue, it
    // corrects one that is already there. Printing them alike would make a parser fix reaching
    // the backlog look like a flood of new questions.
    for (const action of amends) {
      process.stdout.write(`  ~ 更新既有題目 ${action.question.slice(0, 78)}\n`)
    }
  }

  const verb = apply ? '已' : '將會'
  // `suppressed` is printed even when it is the only non-zero number: it is the count of items
  // deliberately NOT re-asked because a human already ruled on them, and a silent suppression is
  // indistinguishable from a scanner that stopped seeing the file at all.
  if (suppressed > 0) process.stdout.write(`\n已答過、不再重問：${suppressed} 題\n`)
  process.stdout.write(
    `\n${verb}開 ${opened} 題、${verb}撤回 ${retracted} 題、${verb}更新 ${amended} 題`,
  )
  process.stdout.write(apply ? '\n' : '（加 --apply 才會真的寫入）\n')
  // 2 = nothing to show, the same convention `status` uses.
  process.exit(opened + retracted + amended === 0 ? 2 : 0)
}

if (cmd === 'dismiss') {
  // The gated bucket's only exit. `answer` closes a question and `clarify` re-opens one, but a
  // blocked span already ended — nothing can close it twice — so before this the only thing that
  // ever cleared a gated card was unrelated work starting in the same work id. A question settled
  // through a different route therefore sat on `/decisions` forever, and a queue that cannot be
  // emptied is a queue that stops being read.
  const spanId = positionals[1]
  const reason = strFlag(args.reason)
  if (!spanId || !reason) fail('dismiss needs <span_id> and --reason')
  const res = dismissGated({ spanId, reason, dismissedBy: strFlag(args.actor) ?? 'human' })
  if (!res.written) {
    process.stderr.write(`${res.errors?.map((e) => e.code).join(',') ?? 'not written'}\n`)
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify({ written: true, span_id: spanId })}\n`)
  process.exit(0)
}

if (cmd === 'amend-options') {
  // 一題以空白輸入框停在佇列上時，唯一的出路本來是「改寫問句重問」——而那會撤回舊題、
  // 換一題新的，答題人看到的是它消失又出現。amend 是就地補上選項的那條路，`decision-sync`
  // 對檔案來源早就這樣做，session-only 的題（`flow ask` / herdr blocked）在 2026-08-28 之前
  // 沒有對應的門。
  const spanId = positionals[1]
  if (!spanId) fail('amend-options needs <span_id>')
  const options = (Array.isArray(args.option) ? args.option : [])
    .map((o) => String(o).trim())
    .filter(Boolean)
  const reason = strFlag(args.reason)
  if (options.length < 2) fail('amend-options needs at least two --option')
  if (!reason) fail('amend-options needs --reason')
  const res = amendDecision({
    spanId,
    options,
    recommended: strFlag(args.recommended),
    reason,
    actor: strFlag(args.actor) ?? 'unknown',
  })
  if (!res.written) {
    process.stderr.write(`${res.errors?.map((e) => e.code).join(',') ?? 'not written'}\n`)
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify({ written: true, span_id: spanId, options })}\n`)
  process.exit(0)
}

if (cmd === 'ask-options') {
  // `\my` 端的那顆按鈕。文字不由人打，SoT 是 `OPTIONS_REQUEST_TEXT`——同一句話手抄 N 次不會
  // 發生，而不發生的結果就是題目一直停在不可回答的狀態。
  const spanId = positionals[1]
  if (!spanId) fail('ask-options needs <span_id>')
  const res = requestClarification({
    spanId,
    text: OPTIONS_REQUEST_TEXT,
    actor: strFlag(args.actor) ?? 'charles',
  })
  if (!res.written) {
    process.stderr.write(`${res.errors?.map((e) => e.code).join(',') ?? 'not written'}\n`)
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify({ written: true, span_id: spanId })}\n`)
  process.exit(0)
}

if (cmd === 'clarify') {
  // The other half of what `--stalled` prints for `clarification-requested`. Without this the
  // stall line names a state with no way out of it, which is worse than not reporting it: a
  // surface that only ever accumulates teaches people to stop reading it.
  const spanId = positionals[1]
  const text = strFlag(args.text)
  if (!spanId || !text) fail('clarify needs <span_id> and --text')
  const res = answerClarification({
    spanId,
    text,
    actor: strFlag(args.actor) ?? 'unknown',
  })
  if (!res.written) {
    process.stderr.write(`${res.errors?.map((e) => e.code).join(',') ?? 'not written'}\n`)
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify({ written: true, span_id: spanId })}\n`)
  process.exit(0)
}

if (cmd === 'answer') {
  // The chat surface's write path, and deliberately the SAME one the page uses.
  //
  // Before this existed, `\my` answered by hand-writing an inline `import { answerDecision }`
  // and passing a `repoRoot` resolved by eye. That is a second implementation of repo resolution
  // whose failure mode is not "one surface is broken" — it is an answer landing on another
  // repo's spine and editing that repo's file, for a span that repo has never heard of.
  // per rules/core/review-gui-surface.md § 待拍板佇列 MUST（寫入端共用同一組函式）.
  const spanId = positionals[1]
  const answerText = strFlag(args.answer)
  if (!spanId || !answerText) fail("answer needs <span_id> and --answer '<text>'")
  const home = process.env.CLADE_HOME ?? repoRoot()
  const target = resolveRepoRootByName(strFlag(args.repo), home)
  if (!target) {
    // NEVER fall back to `home`: writing a consumer's answer into clade is the failure this
    // whole path exists to prevent, and it would look like a success.
    process.stderr.write(`flow: ${REPO_NOT_ON_ROSTER(strFlag(args.repo))}\n`)
    process.exit(1)
  }
  const res = answerDecision({
    spanId,
    answer: answerText,
    answeredBy: 'flow-cli',
    via: strFlag(args.via) ?? 'Charles 在 chat 回答，由主線代填',
    repoRoot: target,
    dryRun: args['dry-run'] === true,
  })
  process.stdout.write(`${JSON.stringify(res)}\n`)
  // `ok:false` is a real failure (no such decision / already resolved). `landed:false` is not:
  // the span is closed and the answer is on the spine, only the carrier append did not happen —
  // exit 0 with the reason printed, so a wrapper does not retry a write that already took.
  process.exit(res.ok ? 0 : 1)
}

if (cmd === 'answers') {
  // The entry point for reading answers, and the ONLY thing that can produce a hard lock.
  //
  // Until now an answer had no reader: it landed on a carrier and whoever happened to open that
  // file next found it. That is why `/decisions` can offer to edit an answer at all — nothing on
  // the spine ever said anybody had taken it. `--claim` is that missing half, and it is a claim in
  // the literal sense: whoever runs it is saying "I have read these and I am acting on them", after
  // which the surface stops offering the edit.
  //
  // Scoped to this repo on purpose. Claiming answers fleet-wide from one cwd would let a session
  // freeze questions belonging to work it has never seen.
  const answersRoot = process.cwd()
  const queue = buildDecisionQueue(foldSpans(readEvents(answersRoot)), {})
  const items = queue.answered.filter((item) => !item.locked)
  const claim = args.claim === true

  if (args.json === true) {
    process.stdout.write(
      `${JSON.stringify({ answered: queue.answered, claimed: claim }, null, 2)}\n`,
    )
  } else if (queue.answered.length === 0) {
    process.stdout.write('近七天沒有已回答的待拍板。\n')
  } else {
    for (const item of queue.answered) {
      const lock = item.locked ? `　🔒 ${item.locked.by} ${item.locked.actor}` : ''
      const revised = item.revision_count > 0 ? `　（已修訂 ${item.revision_count} 次）` : ''
      process.stdout.write(
        `${item.span_id}  ${item.question}\n  → ${item.answer}${revised}${lock}\n`,
      )
    }
  }

  if (!claim) process.exit(0)
  let claimed = 0
  for (const item of items) {
    const res = pickupDecision({
      spanId: item.span_id,
      actor: strFlag(args.actor) ?? 'agent',
      note: strFlag(args.note) ?? null,
      cwd: answersRoot,
    })
    if (res.written) claimed += 1
    // Never fatal: a claim that could not be written must not stop the caller from reading the
    // answers it came for. It only means the lock stays soft for that one.
    else
      process.stderr.write(
        `claim 失敗 ${item.span_id}：${res.errors?.map((e) => e.code).join(',')}\n`,
      )
  }
  process.stdout.write(`claimed ${claimed}/${items.length}\n`)
  process.exit(0)
}

const CLOSE_OUTCOMES = ['ok', 'fail', 'skipped', 'blocked']

if (cmd === 'close') {
  // `in-flight-overdue` used to be reportable and nothing else: a span with no `end` can only be
  // closed by an `end` event, and `emit` writes points. So a pi run whose process died sat on the
  // stall list forever, and a queue nobody can ever drain trains its readers to skip it (TD-673).
  //
  // This is the generic door, for substrates with no closer of their own. It is NOT a second way
  // to close the two that do have one — see the refusals below.
  const spanId = positionals[1]
  if (!spanId) fail('close needs a span id')
  const outcome = strFlag(args.outcome)
  if (!outcome || !CLOSE_OUTCOMES.includes(outcome)) {
    fail(`close needs --outcome (${CLOSE_OUTCOMES.join(' | ')})`)
  }
  const reason = strFlag(args.reason)
  // Same bar `--adjudicate` holds third-party closure to: a closure with no stated basis is
  // indistinguishable from quietly deleting the evidence that something stalled.
  if (!reason) fail('close needs --reason; a closure with no stated basis is a silent delete')

  const handle = spanHandleFromSpine(spanId)
  if (!handle) fail(`no span on the spine starts with id ${spanId}`)
  if (spanIsClosed(spanId)) fail(`span ${spanId} is already closed`)

  // Both refusals name the right door rather than just saying no. Without them this becomes a way
  // to launder the two closures that carry accountability: an adjudication is signed by a named
  // session, and an answer lands on the carrier the question named. Closing either from here would
  // clear the stall and destroy exactly the record that made it answerable.
  if (handle.substrate === 'herdr') {
    fail(
      `span ${spanId} is a herdr dispatch; close it out with a signed adjudication:\n` +
        `  node vendor/scripts/herdr-session-handoff.ts --adjudicate <dispatch-id> --disposition <landed|obsolete|dropped|harvested-absent> --reason '<why>'`,
    )
  }
  if (handle.kind === 'decision.request') {
    fail(
      `span ${spanId} is a question waiting on a human; answering it is what closes it.\n` +
        `  answer it in review-gui /decisions, which lands the answer on the carrier the question named`,
    )
  }

  const res = endSpan(handle, {
    outcome,
    payload: { closed_by: 'third-party', reason },
  })
  process.stdout.write(
    `${JSON.stringify({ written: res.written === true, span_id: spanId, outcome })}\n`,
  )
  process.exit(res.written === true ? 0 : 1)
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
  // Ownership stalls do not live on the spine, so an empty spine MUST NOT suppress them:
  // a repo with no events can still have a dead holder pinning a file and a stash nobody
  // will come back for, and those are exactly the states `--stalled` exists to surface.
  if (events.length === 0 && !args.stalled) {
    process.stderr.write(`flow: no events on the spine (${eventsPath()})\n`)
    process.exit(2)
  }
  const spans = buildSpans(events)

  if (args.stalled) {
    // Same question herdr-patrol asks, asked of the spine so it covers every substrate at once.
    // Exit 3 on any stall matches patrol's convention; see stall.ts for what patrol still owns.
    const stalls = [
      ...findStalls(spans, {
        thresholdMinutes: numberFlag(args['stall-minutes'], DEFAULT_STALL_MINUTES),
      }),
      // Working-tree ownership stalls are not on the spine — they are derived from git status ×
      // the provenance journal (see stall.ts). Deliberately repo-local: `--all` above folds each
      // consumer's events.jsonl, and a fleet-wide answer would have to walk 14 working trees on
      // disk, which is a different question with a different cost.
      //
      // Skipped when `CLADE_FLOW_EVENTS` names a spine, because that env means "this run reads
      // the events I point at" and a working tree is the one input it cannot redirect. Without
      // the skip, a caller that supplied its own events still gets stalls derived from whatever
      // the real checkout happens to look like right now — so the answer depends on the machine,
      // not on the input, and `--stalled` can exit 3 on a spine that has nothing wrong with it.
      //
      // That is not hypothetical: it kept `flow status --stalled` red for every publish on any
      // machine with a stray stash, and the two tests that assert the clean case were green on a
      // fresh checkout and red on every real one. NEVER fix that shape by tidying the working
      // tree — the environment dependency is the defect, and a green run bought by deleting a
      // stash carries no information about the logic under test.
      ...(process.env.CLADE_FLOW_EVENTS
        ? []
        : findOwnershipStalls(buildWhoRows(findConsumerRoot() ?? repoRoot()))),
    ]
    // Attribution health rides along with the stall list because it shares the one consumer that
    // actually reads this command unprompted: the SessionStart hook. A ratio printed anywhere
    // else is a number nobody opens — the same failure the stall list itself was built to end.
    const orphans = orphanRatio(events)
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ stalls, orphan_ratio: orphans }, null, 2)}\n`)
    } else {
      process.stdout.write(renderStalls(stalls))
      if (orphans.over_threshold) {
        const pct = (orphans.ratio * 100).toFixed(0)
        const RECENT_MINT_HOURS_LABEL = orphans.by_entry[0]?.recent_hours ?? 24
        process.stdout.write(
          `\n⚠ 歸因: 近 ${orphans.window_days} 天 ${orphans.minted}/${orphans.total} 筆事件（${pct}%）由本窗口內「新鑄」的 orphan work id 承載，` +
            `門檻 ${(orphans.threshold * 100).toFixed(0)}%。\n` +
            `    另有 ${orphans.inherited} 筆繼承自窗口之前就存在的 orphan id（pre-fix 血脈，等那些 pane 退場才會消，不計入門檻）。\n` +
            `    這是「說不出這些事件屬於哪件工作」，不是某件事卡住。判一題：哪個入口鑄名退化了。\n` +
            `    下面已經替你分好桶（第一個事件的 kind|actor|substrate = 鑄名的那個入口）。\n` +
            `    判的是「近 N 小時鑄名」那一欄，NEVER 是最後鑄名時間：修法落在 7 天窗口內時，\n` +
            `    整週的 pre-fix 事件仍在分子裡，最後鑄名也還是近的——兩者都會把已修好的入口讀成退化中。\n` +
            `    近 ${RECENT_MINT_HOURS_LABEL}h 鑄名 0 = 那個入口已經停鑄，等事件滾出窗口即可；>0 = 現在還在鑄，那就是要修的那一個。\n` +
            `    判得出來當場修，判不出來登一條 TD。\n` +
            orphans.by_entry
              .slice(0, 5)
              .map(
                (b) =>
                  `      ${String(b.events).padStart(4)} 事件 / ${String(b.ids).padStart(3)} id  近 ${b.recent_hours}h 鑄名 ${String(b.ids_recent).padStart(2)}  最後鑄名 ${b.newest_mint.slice(0, 16).replace('T', ' ')}Z  ${b.entry}\n`,
              )
              .join(''),
        )
      }
    }
    // Exit 3 covers the orphan warning too. Gating it on stalls alone would make this print only
    // on the days something else was already wrong — the hook stays silent at exit 0, so a
    // warning that does not move the code is a warning nobody ever sees.
    process.exit(stalls.length > 0 || orphans.over_threshold ? 3 : 0)
  }

  const rows = buildWorkItems(spans)
  if (args.json) {
    // An object, not the bare array this printed before P2. `awaiting_acceptance` is the answer to
    // a different question than "what is on the spine" — it is the queue a person has to drain —
    // and a top-level array has nowhere to put it that JSON.stringify would actually serialize.
    process.stdout.write(
      `${JSON.stringify(
        { work_items: rows, awaiting_acceptance: rows.filter((r) => r.state === 'done') },
        null,
        2,
      )}\n`,
    )
    process.exit(0)
  }

  for (const r of rows) {
    process.stdout.write(
      `${r.work_id}  ${r.state.padEnd(9)} spans=${r.spans} in-flight=${r.in_flight} failed=${r.failed}  ${r.last_ts}${r.parked_at ? `  parked@${r.parked_at}` : ''}\n`,
    )
  }

  // The done-not-yet-accepted queue, printed second and separately because it is the one bucket
  // that needs a person: everything else on this list is either moving or already finished, while
  // these are finished-as-claimed and waiting on a verdict nobody is prompted for otherwise.
  const awaiting = rows.filter((r) => r.state === 'done')
  if (awaiting.length > 0) {
    process.stdout.write(`\n宣告完成、等驗收（${awaiting.length}）:\n`)
    for (const r of awaiting) {
      process.stdout.write(`    ${r.slug ?? r.work_id}  ${r.done_ts}\n`)
      process.stdout.write(`      驗證: ${r.verification ?? '(none)'}\n`)
      process.stdout.write(
        `      node vendor/scripts/flow/flow.ts accept ${r.work_id} --reason '<why>'   (或 drop)\n`,
      )
    }
  }
  process.exit(0)
}

if (cmd === 'brief') {
  // The board is a projection of the same three things every other view already folds, which is
  // why this command builds nothing of its own: same events, same spans, same stalls, same lane
  // function `/board` will render as columns. A second derivation here would be a second board.
  const events = readEvents()
  if (events.length === 0) {
    process.stderr.write(`flow: no events on the spine (${eventsPath()})\n`)
    process.exit(2)
  }
  const spans = buildSpans(events)
  // Ownership stalls are deliberately included: a dead holder pinning a file is exactly the kind
  // of thing an agent opening a session must see, and it is the half that is not on the spine.
  // Skipped under CLADE_FLOW_EVENTS for the reason `status --stalled` documents at length — a
  // caller that supplied its own spine cannot redirect the working tree, so leaving it in makes
  // the answer depend on the machine rather than on the input.
  const stalls = [
    ...findStalls(spans, {
      thresholdMinutes: numberFlag(args['stall-minutes'], DEFAULT_STALL_MINUTES),
    }),
    ...(process.env.CLADE_FLOW_EVENTS
      ? []
      : findOwnershipStalls(buildWhoRows(findConsumerRoot() ?? repoRoot()))),
  ]
  const workItems = buildWorkItems(spans)
  const board = buildBoardLanes(workItems, stalls, spans)

  const workId = strFlag(args['work-id'])
  if (workId) {
    const dossier = buildDossier({ workId, board, workItems, spans, stalls, events })
    process.stdout.write(args.json ? dossierJson(dossier) : renderDossier(dossier))
    process.exit(dossier.found ? 0 : 2)
  }
  process.stdout.write(args.json ? overviewJson(board) : renderOverview(board))
  process.exit(0)
}

if (cmd === 'who') {
  // Ownership is a property of the consumer's shared main tree, so every worktree asks the
  // same root — otherwise two sessions in two worktrees would each see a different answer to
  // "who holds this file" and both would be right about their own tree and wrong about the
  // contention. findConsumerRoot resolves any cwd inside the repo to that single root.
  const consumerRoot = findConsumerRoot() ?? repoRoot()
  // `--transcripts` 是唯一打開 transcript 取證的入口：全 corpus 掃描要人明確要求才付
  // （見 who.ts 的 buildWhoRows doc）。預設關掉也讓這裡的預設輸出與 review-gui 的
  // ownership 投影**逐字相同** —— TD-664 Phase 3 的「人看的與 agent 查的是同一份」。
  const rows = buildWhoRows(consumerRoot, {
    selfSessionId: strFlag(args.session),
    transcriptEvidence: args.transcripts === true,
  })
  process.stdout.write(args.json ? `${JSON.stringify(rows, null, 2)}\n` : renderWho(rows))
  // Exit 3 on anything held by someone else or unattributable — same convention `status
  // --stalled` and herdr-patrol use, so a caller can gate on it without parsing output.
  process.exit(rows.some((r) => r.verdict !== 'mine') ? 3 : 0)
}

if (cmd === 'otlp') {
  const events = readEvents()
  if (events.length === 0) {
    process.stderr.write(`flow: no events on ${eventsPath()}\n`)
    process.exit(2)
  }
  const workId = positionals[1] ?? strFlag(args['work-id']) ?? null
  const payload = toOtlpPayload(events, { workId })
  const total = countSpans(payload)
  if (total === 0) {
    process.stderr.write(`flow: no spans for ${workId ?? 'this spine'}\n`)
    process.exit(2)
  }

  const out = strFlag(args.out)
  if (out) {
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`)
    process.stdout.write(`flow: wrote ${total} span(s) to ${out}\n`)
    process.exit(0)
  }

  const endpoint =
    strFlag(args.endpoint) ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_OTLP_ENDPOINT
  try {
    await postOtlp(payload, endpoint)
  } catch (err) {
    // Loud on purpose: an export is something a human asked for just now, so a silent no-op
    // (the right default for `emitEvent`) would be the wrong contract here.
    process.stderr.write(`flow: ${(err as Error).message}\n`)
    process.exit(1)
  }
  process.stdout.write(`flow: exported ${total} span(s) to ${endpoint}\n`)
  process.exit(0)
}

fail(`unknown subcommand: ${cmd}`)
