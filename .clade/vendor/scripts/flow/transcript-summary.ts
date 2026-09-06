// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/transcript-summary.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/transcript-summary.ts
// clade flow — 治理軌跡採集：從 harness 自己在寫的 transcript 摺出 `session_summary`
//
// 要回答的問題是「那一次是什麼檔位、走過哪些 skill、外派了誰」，而**沒有任何欄位可以叫 agent
// 自己填**：自報欄位的實測結局是 work-loop `decisions{}` 那 39 筆全 null 的 `answeredAt`。所以
// 採集源選 `~/.claude/projects/<slug>/<session_id>.jsonl` —— harness 本來就在寫的檔，agent 側
// 0 token、0 spawn、0 紀律，而且**可 backfill**：存量 transcript 是既有歷史，落地當天就摺得回去。
//
// 三條硬規則（違反任一條，這支就不該存在）：
//
//  1. **NEVER 收錄 `<command-args>` 原文**。只收 `{name, mode, invoked_by}` 三個枚舉值，`mode` 是
//     args 首 token 且 MUST 命中該 skill 的白名單，命中不到記 null。風險有兩層：args 可能含 home
//     路徑（`redact.ts` 會把它改寫成 `<HOME>`，欄位當場變形）；更重要的是 **args 是使用者原話，
//     可能含不在任何 pattern 內的業務細節** —— redact 攔不到的那半才是真正的洩漏面。只收枚舉值
//     之後 redaction 面歸零。
//  2. **治理欄位一律裸名稱**，NEVER 絕對路徑。model 名 / skill 名 / mode 枚舉 / 版本號都不撞
//     `SECRET_PATTERNS`，`test/flow-session-summary.test.ts` 的「過 redact 不變形」斷言機械守住。
//  3. **fail-open**：transcript 是 harness 內部格式、無穩定契約，版本升級會變形。parse 不出就
//     缺席 + 一行 warn，**NEVER 讓它擋 session start**。變形要靠 fixture 測試先紅，不是靜默缺席。
//
// `session_summary` 不帶 work_id（`work_id: null`，validator 有對應條款）：它是 **session 的性質，
// 不是 work 的性質** —— 一個 session 橫跨多件 work、一件 work 橫跨多個 session，任何硬掛規則都會
// 錯誤歸屬。歸屬在讀端 join on `session_id`（每件 work 的 span 本來就帶它），零新欄位。

import { isRecord, parseJsonRecord } from '../lib/json-unknown.ts'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { emitEvent, eventsPath, newSpanId } from './emit.ts'

export const SESSION_SUMMARY_KIND = 'session_summary'

/** 兩種 source 各自 last-write-wins，NEVER 互相覆蓋——見 `stampSession` 上方的註解。 */
export type SummarySource = 'transcript-parse' | 'session-start-stamp'

/**
 * 每支 skill 的已知 mode 白名單。
 *
 * 白名單而非「取首 token 就好」，是規則 1 的執行機制：`\do-all` 的 args 是一整句業務敘述，首
 * token 是「把」；沒有白名單，那個字就會進 spine，而它是使用者原話的第一個字。命中不到記 null
 * 是正確結局 —— 缺席可讀成缺席，猜出來的枚舉值在讀端與量到的不可區分。
 *
 * 新增 skill mode 時補這裡。漏補的成本是該次 mode 記 null，**NEVER** 是洩漏。
 */
export const KNOWN_SKILL_MODES: Record<string, string[]> = {
  handoff: ['park', 'relay', 'fanout', 'next'],
  'clade-health': ['layers', 'enforcement', 'conformance', 'full'],
  'notion-board': ['scan', 'triage', 'sync', 'reconcile', 'report'],
  bp: ['plan'],
  'code-review': ['ultra'],
  'work-loop': ['unattended'],
  'dep-upgrade': ['fleet'],
}

const MODE_TOKEN = /^[a-z][a-z0-9-]{0,23}$/

/** args 首 token ∩ 該 skill 白名單。其餘一律 null，含「白名單裡沒有這支 skill」。 */
export function normaliseSkillMode(skill: string, args: unknown): string | null {
  if (typeof args !== 'string') return null
  const token = args.trim().split(/\s+/)[0] ?? ''
  if (!MODE_TOKEN.test(token)) return null
  const allowed = KNOWN_SKILL_MODES[skill]
  if (!allowed || !allowed.includes(token)) return null
  return token
}

export interface SkillUse {
  name: string
  mode: string | null
  invoked_by: 'human' | 'model'
  count: number
}

export interface SubagentUse {
  type: string
  model: string | null
  count: number
}

export interface SessionSummaryPayload {
  source: 'transcript-parse'
  session_id: string
  turns: number
  sidechain_turns: number
  model: string | null
  effort: string | null
  /** 不同 model 值的個數。1 = 全程同一檔位；>1 = 中途換過，讀端才不會把眾數讀成全部。 */
  model_variants: number
  effort_variants: number
  permission_mode: string | null
  /** transcript 的 `version` 欄位是 **Claude Code 版本**，順手收——它 NEVER 是 clade_version。 */
  cc_version: string | null
  started_at: string | null
  ended_at: string | null
  tokens: { input: number; output: number; cache_read: number; cache_creation: number }
  skills: SkillUse[]
  subagents: SubagentUse[]
  skills_truncated?: number
  subagents_truncated?: number
}

export interface StampPayload {
  source: 'session-start-stamp'
  session_id: string
  /**
   * **只有在 session 開始那一刻量得到**。transcript 永遠不會有它，所以 stamp 是 parse 的補集而
   * 不是替代品。歷史 session 沒有 stamp → `clade_version` 缺席，**NEVER 用 parse 時的 git HEAD
   * 或今天的版本推導補**：推出來的與量到的在讀端不可區分，那是假訊號。
   */
  clade_version: string | null
  rule_bundle: { rules: number; bytes: number }
}

const MAX_SKILLS = 40
const MAX_SUBAGENTS = 20

/**
 * The "no cost" claim is four measurable thresholds, and this is the one with no natural ceiling:
 * turns, tokens and version strings are bounded by their own shape, but a long session can invoke
 * an unbounded number of distinct skills. The bound is enforced HERE, in code, rather than left as
 * a stated estimate — an unenforced budget is the shape of the `answeredAt` field that came back
 * 39 rows all null.
 */
export const MAX_PAYLOAD_BYTES = 1024

/**
 * Trim the least-used tail until the payload fits. Both lists arrive sorted by count descending, so
 * what goes is what was used least; what stays is what the session actually did. The dropped count
 * stays on the record — a silent truncation reads as "that session used two skills".
 */
function fitBudget(payload: SessionSummaryPayload): SessionSummaryPayload {
  while (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
    if (payload.subagents.length > 0) {
      payload.subagents.pop()
      payload.subagents_truncated = (payload.subagents_truncated ?? 0) + 1
      continue
    }
    if (payload.skills.length > 0) {
      payload.skills.pop()
      payload.skills_truncated = (payload.skills_truncated ?? 0) + 1
      continue
    }
    // Nothing left to trim: the fixed fields alone exceed the budget, which means the SHAPE grew,
    // not the session. Refusing here would lose the record; the honest move is to keep it and let
    // the budget test go red so someone looks at the shape.
    break
  }
  return payload
}

function topOf(counts: Map<string, number>): { top: string | null; variants: number } {
  let top: string | null = null
  let best = -1
  for (const [k, v] of counts) {
    if (v > best) {
      best = v
      top = k
    }
  }
  return { top, variants: counts.size }
}

function bump(counts: Map<string, number>, key: unknown) {
  if (typeof key !== 'string' || key.length === 0) return
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      out += (block as { text: string }).text
    }
  }
  return out
}

const COMMAND_NAME = /<command-name>\s*\/?([A-Za-z0-9:_-]{1,64})\s*<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]{0,4096}?)<\/command-args>/
const SKILL_NAME_OK = /^[A-Za-z0-9:_-]{1,64}$/

export interface SummariseResult {
  session_id: string | null
  payload: SessionSummaryPayload | null
  warnings: string[]
}

function recordSkill(
  into: Map<string, SkillUse>,
  name: string,
  mode: string | null,
  invokedBy: 'human' | 'model',
) {
  if (!SKILL_NAME_OK.test(name)) return
  const key = `${name} ${mode ?? ''} ${invokedBy}`
  const held = into.get(key) ?? { name, mode, invoked_by: invokedBy, count: 0 }
  held.count += 1
  into.set(key, held)
}

/**
 * 摺一份 transcript。永遠不 throw：呼叫者是 session start hook，它的契約勝過 telemetry。
 *
 * 行層級的 prefilter 是效能的全部：`attachment` 記錄可以是 MB 級而其中沒有一個治理欄位，
 * 用字串比對跳掉它們比 `JSON.parse` 之後再判便宜一個數量級。
 */
export function summariseTranscript(file: string): SummariseResult {
  const warnings: string[] = []
  let sessionId: string | null = null
  try {
    const raw = readFileSync(file, 'utf8')
    const models = new Map<string, number>()
    const efforts = new Map<string, number>()
    const permissionModes = new Map<string, number>()
    const versions = new Map<string, number>()
    const skills = new Map<string, SkillUse>()
    const subagents = new Map<string, SubagentUse>()
    const tokens = { input: 0, output: 0, cache_read: 0, cache_creation: 0 }
    let turns = 0
    let sidechainTurns = 0
    let startedAt: string | null = null
    let endedAt: string | null = null
    let parseFailures = 0

    for (const line of raw.split('\n')) {
      if (line.length === 0) continue
      const interesting =
        line.includes('"assistant"') || line.includes('"user"') || line.includes('<command-name>')
      if (!interesting) {
        // sessionId 任何 record 都帶，看到一次就夠。省下對 attachment 的整份 parse。
        if (sessionId === null) {
          const m = /"sessionId"\s*:\s*"([^"]{1,128})"/.exec(line)
          if (m) sessionId = m[1]
        }
        continue
      }
      let rec: Record<string, unknown>
      try {
        rec = parseJsonRecord(line)
      } catch {
        parseFailures += 1
        continue
      }
      if (typeof rec.sessionId === 'string' && rec.sessionId.length > 0) sessionId = rec.sessionId
      const ts = typeof rec.timestamp === 'string' ? rec.timestamp : null
      if (ts) {
        if (startedAt === null || ts < startedAt) startedAt = ts
        if (endedAt === null || ts > endedAt) endedAt = ts
      }
      bump(permissionModes, rec.permissionMode)
      bump(versions, rec.version)
      const message = isRecord(rec.message) ? rec.message : {}
      const content = message.content

      if (rec.type === 'assistant') {
        if (rec.isSidechain === true) sidechainTurns += 1
        else turns += 1
        // model 在 `message.model`、另有版本放 top-level。兩邊都看，NEVER 只認一邊：認錯一邊的
        // 失敗形狀是整欄靜默缺席，而缺席讀起來像「這個 session 沒用過 model」。
        bump(models, typeof rec.model === 'string' ? rec.model : message.model)
        bump(
          efforts,
          typeof rec.effort === 'string' ? rec.effort : (message as { effort?: unknown }).effort,
        )
        const usage = (message.usage ?? {}) as Record<string, unknown>
        tokens.input += Number(usage.input_tokens) || 0
        tokens.output += Number(usage.output_tokens) || 0
        tokens.cache_read += Number(usage.cache_read_input_tokens) || 0
        tokens.cache_creation += Number(usage.cache_creation_input_tokens) || 0
      }

      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          const b = block as Record<string, unknown>
          if (b.type !== 'tool_use') continue
          const input = (b.input ?? {}) as Record<string, unknown>
          if (b.name === 'Skill' && typeof input.skill === 'string') {
            recordSkill(skills, input.skill, normaliseSkillMode(input.skill, input.args), 'model')
          }
          if (
            (b.name === 'Agent' || b.name === 'Task') &&
            typeof input.subagent_type === 'string'
          ) {
            const model = typeof input.model === 'string' ? input.model : null
            const key = `${input.subagent_type} ${model ?? ''}`
            const held = subagents.get(key) ?? { type: input.subagent_type, model, count: 0 }
            held.count += 1
            subagents.set(key, held)
          }
        }
      }

      if (rec.type === 'user') {
        const text = textOf(content)
        const name = COMMAND_NAME.exec(text)
        if (name) {
          const args = COMMAND_ARGS.exec(text)
          // args 原文只活在這一行的區域變數裡，且只被 `normaliseSkillMode` 讀成一個枚舉值。
          // NEVER 把 args[1] 放進任何寫出去的物件——那是規則 1 的唯一失效路徑。
          recordSkill(skills, name[1], normaliseSkillMode(name[1], args?.[1] ?? null), 'human')
        }
      }
    }

    if (parseFailures > 0) warnings.push(`${parseFailures} unparsable line(s) skipped`)
    if (sessionId === null) {
      warnings.push(`no sessionId in ${basename(file)} — transcript schema may have changed`)
      return { session_id: null, payload: null, warnings }
    }
    if (turns === 0 && sidechainTurns === 0) {
      // 一個 assistant turn 都沒有的 transcript 沒有治理內容可記。缺席比一筆全 null 誠實。
      return { session_id: sessionId, payload: null, warnings }
    }

    const skillList = [...skills.values()].toSorted((a, b) => b.count - a.count)
    const subagentList = [...subagents.values()].toSorted((a, b) => b.count - a.count)
    const m = topOf(models)
    const e = topOf(efforts)
    const payload: SessionSummaryPayload = {
      source: 'transcript-parse',
      session_id: sessionId,
      turns,
      sidechain_turns: sidechainTurns,
      model: m.top,
      effort: e.top,
      model_variants: m.variants,
      effort_variants: e.variants,
      permission_mode: topOf(permissionModes).top,
      cc_version: topOf(versions).top,
      started_at: startedAt,
      ended_at: endedAt,
      tokens,
      skills: skillList.slice(0, MAX_SKILLS),
      subagents: subagentList.slice(0, MAX_SUBAGENTS),
    }
    if (skillList.length > MAX_SKILLS) payload.skills_truncated = skillList.length - MAX_SKILLS
    if (subagentList.length > MAX_SUBAGENTS) {
      payload.subagents_truncated = subagentList.length - MAX_SUBAGENTS
    }
    return { session_id: sessionId, payload: fitBudget(payload), warnings }
  } catch (err) {
    warnings.push(`summarise failed (fail-open): ${(err as Error).message}`)
    return { session_id: sessionId, payload: null, warnings }
  }
}

/** 一筆 `session_summary`：point 事件、work_id null、substrate claude-code。 */
export function emitSessionSummary(
  payload: SessionSummaryPayload | StampPayload,
  { cwd, ts }: { cwd: string; ts?: string },
) {
  return emitEvent({
    work_id: null,
    span_id: newSpanId(),
    parent_span: null,
    phase: 'point',
    kind: SESSION_SUMMARY_KIND,
    actor: payload.source,
    substrate: 'claude-code',
    session_id: payload.session_id,
    payload: { ...payload },
    outcome: 'ok',
    ...(ts ? { ts_utc: ts } : {}),
    cwd,
  })
}

// --- 開場 stamp -------------------------------------------------------------

function cladeVersion(root: string): string | null {
  try {
    const hub = join(root, '.claude', 'hub.json')
    if (existsSync(hub)) {
      const v = parseJsonRecord(readFileSync(hub, 'utf8')).version
      return typeof v === 'string' ? v : null
    }
    const marketplace = join(root, '.claude-plugin', 'marketplace.json')
    if (existsSync(marketplace)) {
      const metadata = parseJsonRecord(readFileSync(marketplace, 'utf8')).metadata
      const v = isRecord(metadata) ? metadata.version : undefined
      return typeof v === 'string' ? v : null
    }
  } catch {
    // fail-open: 版本量不到就缺席，NEVER 推導。
  }
  return null
}

/**
 * 規約包指紋：`.claude/rules` 底下 `.md` 檔的檔數與總 byte 數。
 *
 * 不是內容 hash，因為要回答的問題是「做壞那次是哪一版規約」而不是「哪一行改了」—— 後者 git
 * 已經有了。檔數 + byte 數對「rule 被加 / 被刪 / 被大改」全部有反應，成本是一趟 stat。
 */
function ruleBundle(root: string): { rules: number; bytes: number } {
  let rules = 0
  let bytes = 0
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name.endsWith('.md')) {
        try {
          bytes += statSync(full).size
          rules += 1
        } catch {
          // 單檔 stat 失敗不該讓整個指紋消失。
        }
      }
    }
  }
  walk(join(root, '.claude', 'rules'), 0)
  return { rules, bytes }
}

/**
 * Session 開始那一刻的環境快照。
 *
 * 與 `transcript-parse` 那半共用 kind，靠 `payload.source` 分辨，而 idempotency 是**逐 source**
 * last-write-wins：讀端取「最新的 stamp」∪「最新的 summary」，NEVER 只取最新那一筆。兩者的欄位
 * 不重疊（stamp 有 clade_version、summary 沒有），單純取最新會讓後寫的那半把另一半抹掉。
 */
export function stampSession({
  sessionId,
  root,
  cwd = root,
}: {
  sessionId: string
  root: string
  cwd?: string
}) {
  const payload: StampPayload = {
    source: 'session-start-stamp',
    session_id: sessionId,
    clade_version: cladeVersion(root),
    rule_bundle: ruleBundle(root),
  }
  return emitSessionSummary(payload, { cwd })
}

// --- 增量 sweep -------------------------------------------------------------

export const DEFAULT_SILENCE_MINUTES = 30
export const DEFAULT_SWEEP_LIMIT = 25

function transcriptsRoot(): string {
  return process.env.CLADE_TRANSCRIPT_ROOT ?? join(homedir(), '.claude', 'projects')
}

/** Claude Code 的 project 目錄名 = cwd 的非英數字元逐一換成 `-`。 */
export function projectSlug(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * 這個 repo 的 transcript 目錄，加上它的 worktree 兄弟目錄。
 *
 * worktree session 做的是同一個 repo 的工作，而它的 `.clade/` 隨 worktree 一起消失 —— 摺進主
 * repo 的 spine 是唯一留得住它的地方。`<slug>-wt-` 前綴對應 `wt-helper` 的 `<repo>-wt/<name>` 慣例。
 */
export function projectDirsFor(root: string): string[] {
  const base = transcriptsRoot()
  const slug = projectSlug(root)
  const out: string[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(base)
  } catch {
    return out
  }
  const wtPrefix = `${slug}-wt-`
  for (const name of entries) {
    if (name === slug || name.startsWith(wtPrefix)) out.push(join(base, name))
  }
  return out.toSorted()
}

function watermarkPath(cwd: string): string {
  return join(dirname(eventsPath(cwd)), 'transcript-sweep.json')
}

function readWatermark(cwd: string): number {
  try {
    const raw = parseJsonRecord(readFileSync(watermarkPath(cwd), 'utf8'))
    const value = raw.watermark_ms
    const ms = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0
    return Number.isFinite(ms) ? ms : 0
  } catch {
    return 0
  }
}

function writeWatermark(cwd: string, ms: number) {
  const path = watermarkPath(cwd)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ watermark_ms: ms }, null, 2)}\n`)
  } catch {
    // 水位寫不進去只代表下一輪重掃，不代表這一輪錯了。
  }
}

export interface SweepResult {
  candidates: number
  emitted: number
  /** 還在動（靜默不足門檻）或就是當前 session，這一輪不摺，也不讓水位越過它。 */
  held: number
  skipped: number
  warnings: string[]
  watermark_ms: number
}

/**
 * 摺所有「水位之後動過、且已靜默 ≥ silenceMinutes」的 transcript。
 *
 * 水位推進是這支唯一有陷阱的地方：**NEVER 讓水位越過任何一個沒摺的檔**。被 hold 的檔 mtime 比
 * 水位新，下一輪才會再被看到；水位若直接取「這輪摺過的最大 mtime」，一個進行中的 session 只要
 * mtime 比某個已摺檔早，就會永遠掉進水位下方、再也不會被摺 —— 而它恰好是最需要事後歸因的那種。
 */
export function sweepTranscripts({
  root,
  cwd = root,
  now = Date.now(),
  excludeSessionId = null,
  limit = DEFAULT_SWEEP_LIMIT,
  silenceMinutes = DEFAULT_SILENCE_MINUTES,
  dryRun = false,
}: {
  root: string
  cwd?: string
  now?: number
  excludeSessionId?: string | null
  limit?: number
  silenceMinutes?: number
  dryRun?: boolean
}): SweepResult {
  const warnings: string[] = []
  const watermark = readWatermark(cwd)
  const cutoff = now - silenceMinutes * 60_000
  const ready: { file: string; mtime: number }[] = []
  const heldMtimes: number[] = []

  for (const dir of projectDirsFor(root)) {
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const file = join(dir, name)
      let mtime: number
      try {
        mtime = statSync(file).mtimeMs
      } catch {
        continue
      }
      if (mtime <= watermark) continue
      const isCurrent = excludeSessionId !== null && name === `${excludeSessionId}.jsonl`
      if (isCurrent || mtime > cutoff) {
        heldMtimes.push(mtime)
        continue
      }
      ready.push({ file, mtime })
    }
  }

  ready.sort((a, b) => a.mtime - b.mtime)
  const take = ready.slice(0, Math.max(0, limit))
  const deferred = ready.slice(take.length)
  let emitted = 0
  let skipped = 0

  for (const { file } of take) {
    const res = summariseTranscript(file)
    warnings.push(...res.warnings)
    if (!res.payload) {
      skipped += 1
      continue
    }
    if (dryRun) {
      emitted += 1
      continue
    }
    // ts_utc 綁 session 自己的最後一筆活動，不綁掃描時刻：掃描時刻會把三週前的 backfill 全部
    // 蓋成今天，而讀端唯一能分辨兩者的就是這個欄位。
    const written = emitSessionSummary(res.payload, { cwd, ts: res.payload.ended_at ?? undefined })
    if (written.written) {
      emitted += 1
    } else {
      skipped += 1
      warnings.push(`emit refused for ${basename(file)}`)
    }
  }

  const blockers = [...heldMtimes, ...deferred.map((d) => d.mtime)]
  const processedHigh = Math.max(watermark, take.at(-1)?.mtime ?? watermark)
  const nextWatermark =
    blockers.length > 0 ? Math.min(processedHigh, Math.min(...blockers) - 1) : processedHigh
  if (!dryRun && nextWatermark > watermark) writeWatermark(cwd, nextWatermark)

  return {
    candidates: ready.length + heldMtimes.length,
    emitted,
    held: heldMtimes.length,
    skipped,
    warnings,
    watermark_ms: nextWatermark,
  }
}

// --- CLI --------------------------------------------------------------------

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(`--${name}`)
  const value = i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
  // An empty string is the shape a shell passes when its own lookup failed. Reading it as a value
  // would leave `excludeSessionId` set to something that matches nothing — the exclusion would be
  // switched on and doing nothing, which is worse than off.
  return value === null || value.length === 0 ? null : value
}

function repoRoot(): string {
  return process.env.CLADE_PROJECT_ROOT ?? process.cwd()
}

function main(argv: string[]): number {
  const cmd = argv[0] ?? 'session'
  const root = repoRoot()
  if (cmd === 'session') {
    // session start 走的那一條：stamp（有 session id 才做）＋ 增量 sweep（排除自己）。
    const sessionId = flag(argv, 'session-id')
    if (sessionId) stampSession({ sessionId, root })
    const res = sweepTranscripts({ root, excludeSessionId: sessionId })
    if (process.env.CLADE_TRANSCRIPT_VERBOSE === '1') {
      process.stderr.write(`${JSON.stringify(res)}\n`)
    }
    return 0
  }
  if (cmd === 'backfill') {
    const res = sweepTranscripts({
      root,
      limit: Number(flag(argv, 'limit') ?? '100000'),
      dryRun: argv.includes('--dry-run'),
    })
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`)
    return 0
  }
  if (cmd === 'summarise') {
    const file = flag(argv, 'file')
    if (!file) {
      process.stderr.write('usage: transcript-summary.ts summarise --file <path>\n')
      return 2
    }
    process.stdout.write(`${JSON.stringify(summariseTranscript(file), null, 2)}\n`)
    return 0
  }
  process.stderr.write('usage: transcript-summary.ts [session|backfill|summarise] [flags]\n')
  return 2
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (err) {
    // 這支是 telemetry。它 NEVER 有權讓 session start 失敗。
    process.stderr.write(
      `[clade flow] transcript sweep failed (fail-open): ${(err as Error).message}\n`,
    )
    process.exitCode = 0
  }
}
