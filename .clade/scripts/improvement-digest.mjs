#!/usr/bin/env node
// clade improvement-loop digest
//
// Reads structured signal sources (tech-debt, archived spectra changes, audit outputs,
// signal records), groups them by fingerprint, applies deterministic threshold rules,
// and emits docs/digests/<YYYY-MM-DD>.md with each candidate carrying:
//   - DIG-<hash> stable id (derived from the pattern fingerprint)
//   - evidence predicate (target_paths, target_symbols, expected_state,
//     validation_commands, related_keywords)
//
// Threshold rules implementing Pattern detection (no LLM, no embeddings). LLM use is
// forbidden in v1: any code path attempting llm-based scoring MUST throw.
//
// Usage:
//   node vendor/scripts/improvement-digest.mjs            # emit today's digest
//   node vendor/scripts/improvement-digest.mjs --dry-run  # print candidates, don't write

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateRecord } from '../signals/redact.mjs'
import { appendRecord } from '../signals/ledger-writer.mjs'
import { aggregateConsumerSignals } from './aggregate-signals.mjs'
import {
  computeLayeredMetrics,
  inferAllClosures,
  readJsonl as readJsonlScanner,
} from './closure-scanner.mjs'
import { isClosedStatus, parseTechDebtStatus } from './tech-debt-status.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cladeRoot = resolve(__dirname, '..', '..')

const SOURCES = {
  techDebt: join(cladeRoot, 'docs', 'tech-debt.md'),
  archive: join(cladeRoot, 'openspec', 'changes', 'archive'),
  ledger: join(cladeRoot, 'vendor', 'ledger', 'candidates.jsonl'),
  outcomes: join(cladeRoot, 'vendor', 'ledger', 'outcomes.jsonl'),
  signals: join(cladeRoot, 'vendor', 'ledger', 'signals.jsonl'),
  registry: join(cladeRoot, 'registry', 'consumers.json'),
}

const THRESHOLDS = {
  publishGate: { windowDays: 7, sameFingerprintMin: 2, crossConsumerMin: 2, severity: 'P1' },
  vpCheck: {
    windowDays: 14,
    crossConsumerMin: 2,
    totalMin: 3,
    singleConsumerSessionsMin: 3,
    singleConsumerTotalMin: 5,
    severity: 'P2',
  },
  testFailure: {
    // SWEEP-003: crossConsumerCountMin / singleConsumerCountMin 過去是 dead config —
    // 欄位名不符 matchesThreshold 實際讀的 totalMin / singleConsumerTotalMin（同
    // SWEEP-002 class）。後果：(1) cross-consumer 沒有事件數下限（任 2 consumer 各 1 筆
    // 就達標）；(2) single-consumer 分支從不觸發（singleConsumerTotalMin 未定義 → TDMS
    // 等單一 consumer 的持續 test 失敗永遠 surface 不出來）。接上欄位名、維持原數值語意。
    // windowDays:14（對齊 vpCheck）必須配 single-consumer 偵測一起上：否則啟用後 pre-SWEEP-001
    // 的歷史殘渣 fingerprint（vitest banner 等）因 testFailure 原本無窗而永久佔位 digest。
    windowDays: 14,
    crossConsumerMin: 2,
    totalMin: 2,
    singleConsumerSessionsMin: 3,
    singleConsumerTotalMin: 3,
    severity: 'P2',
  },
  preCommit: { windowDays: 7, crossConsumerMin: 2, totalMin: 3, severity: 'P2' },
  audit: {
    p0p1AlwaysList: true,
    requiredAdoptionP2Below: 80,
    requiredAdoptionP1Below: 60,
    regressionPPListThreshold: 10,
  },
  handoff: { crossConsumerMin: 2, stalledDigestsMin: 2, severity: 'P2' },
  review: { p0p1AlwaysList: true, sessionsMin: 2, severity: 'P1' },
}

// TD-112: business_activity weight for signal aggregation
// See rules/local/improvement-loop.md § 2 + docs/discussions/2026-05-18-active-consumer-subset.md
// active=primary signal source; maintenance=downweighted; paused=excluded from cookbook count;
// auto=unset default (treated as 1.0 conservatively; metric-based promotion deferred to propagate.mjs drift check)
const ACTIVITY_WEIGHTS = { active: 1.0, maintenance: 0.3, paused: 0, auto: 1.0 }

function weightForActivity(activity) {
  return ACTIVITY_WEIGHTS[activity ?? 'auto'] ?? 1.0
}

function computeConsumerWeights(registry) {
  return new Map(
    registry.consumers.map((c) => [c.consumer_id, weightForActivity(c.business_activity)]),
  )
}

function forbidLLMScoring() {
  // Sentinel: spec/design forbid LLM in v1 pattern detection.
  // Any future contributor must remove this guard explicitly with a design change.
  if (process.env.IMPROVEMENT_DIGEST_USE_LLM) {
    throw new Error(
      'LLM-based pattern detection is forbidden in v1; remove the env override or amend the spec first',
    )
  }
}

// ---------------------------------------------------------------------------
// § 建議行動 classification（純 rule-based，no LLM — forbidLLMScoring 同樣適用）
//
// 每條 candidate 依「來源 detector kind + target_paths + keywords」分類成一個
// actionType + 具體 suggestion，讓 digest 讀者只做批准、不用從零發想行動 —
// 修補 explicit closure 0% 的最後一哩斷鏈（candidate 看得到、行動接不上）。
// 規則表由上而下 first-match-wins；新增 detector kind 時在 ACTION_RULES 補一條。

// clade 自家工具鏈 gate — 這些 gate fail 多半是 shim/script 本體問題，非 consumer 行為
const TOOLING_GATES = new Set(['validate-manifests', 'publish', 'propagate'])
// target_paths 指向 clade shim/script 的 pattern（bin/vp、bin/clade-gate、scripts/*、hooks/*、*.sh）
const TOOLING_PATH_RE =
  /^(?:bin|scripts|vendor\/scripts|plugins\/hub-core\/hooks)\/|\.sh$|(?:^|\/)(?:vp|clade-gate)$/
// fingerprint keywords 指向工具層的詞（extractKeywords 產出為小寫比對）
const TOOLING_KEYWORDS = new Set(['shim', 'wrapper', 'hook', 'propagate', 'publish', 'sync'])

// TD hygiene gate Invariant 3（rules/local/clade-role-and-todo-discipline.md）：
// Location 禁 consumer 業務路徑 — 命中時 draft 降為 Class B 一行記實
const CONSUMER_BUSINESS_PATH_RE =
  /^(?:server\/(?:api|utils|db|routes)|test\/(?:integration|e2e|unit)|app\/(?:components|pages|layouts)|pages|composables|stores)\//
// clade SoT 路徑（Invariant 3 例外清單）→ Class A
const CLADE_SOT_PATH_RE = /^(?:scripts|vendor|rules|plugins\/hub-core|claude-md|registry|docs)\//

// first-match-wins 規則表。match 只看 candidate 的 kind / gate_name /
// evidence_predicate（target_paths + related_keywords）— 全部明文規則，不上 LLM。
const ACTION_RULES = [
  {
    actionType: 'advance-td',
    match: (c) => c.kind === 'tech-debt',
    rationale: (c) =>
      `tech-debt 來源（${c.source_id ?? '既有 TD'}）— TD 已在 docs/tech-debt.md 登記，行動是推進既有 status，不開新 TD`,
    suggestion: (c) =>
      `推進 ${c.source_id ?? '該 TD'} status：要做就排進 plan/tasks，落地後補 \`### Resolution\` + Status: done；不做改 Status: wontfix + 一行理由；狀況不變補 \`**Last reviewed**\` 重置 60d 稽核計時`,
  },
  {
    actionType: 'cleanup',
    match: (c) => c.kind === 'wt-stale-merged',
    rationale: () => 'stale worktree 類（已 merge）— 一次性清理即可關閉，無標準層缺口',
    suggestion: () =>
      '跑 `node scripts/wt-helper.mjs cleanup <slug>` 移除已 merge 的 worktree，再跑 validation_commands 確認列表乾淨',
  },
  {
    actionType: 'cleanup',
    match: (c) => c.kind === 'wt-stale-idle',
    rationale: () => 'stale worktree 類（idle 超過門檻）— 一次性處置即可關閉，無標準層缺口',
    suggestion: () =>
      '確認該 session branch 要續做還是放棄：續做就 resume worktree，放棄就 `node scripts/wt-helper.mjs cleanup --force <slug>`',
  },
  {
    actionType: 'cleanup',
    match: (c) => c.kind === 'audit-screenshot-staleness',
    rationale: () => 'stale screenshot 類 — 重拍即可關閉，無標準層缺口',
    suggestion: () =>
      '對受影響 consumer 重拍 stale/legacy 截圖（verify-ui 流程），跑 validation_commands 確認 summary 歸零',
  },
  {
    actionType: 'add-gate',
    match: (c) => c.kind.startsWith('audit-'),
    rationale: () => 'audit script 已有偵測 signal 但無強制執行點 — 候選持續出現代表純 warn 不收斂',
    suggestion: () =>
      '為該 audit signal 加強制點（publish.mjs smoke gate / pre-commit hook / propagate 結尾 fail-loud），warn 升級成 block 後用 digest 觀察歸零',
  },
  {
    actionType: 'fix-tooling',
    match: (c) => c.kind === 'signal-pattern' && hasToolingSignature(c),
    rationale: (c) =>
      `signal-pattern 指向 clade shim/script（gate=${c.gate_name}）— 重複 fail 多半是工具自身失效，非 consumer 行為問題`,
    suggestion: (c) =>
      `修 ${toolingTargetsOf(c).join(', ') || `\`${c.gate_name}\` gate 對應 script`} 的 root cause，修完跑 validation_commands 驗 7 天不再出現`,
  },
  {
    actionType: 'add-rule-section',
    match: (c) => c.kind === 'signal-pattern' && (c.consumers?.length ?? 0) >= 2,
    rationale: (c) =>
      `跨 consumer（${c.consumers.join(', ')}）重複的行為類問題 — 無單一 script 可修，需標準層規約防再犯`,
    suggestion: () =>
      '在 rules/core/ 對應 topic 補規約 §（必要時配 cookbook），措辭明寫「每一個 consumer / 每一次」範圍，propagate 後用 digest 觀察 fingerprint 消失',
  },
  // catch-all：單 consumer 行為類 signal-pattern 或未知 kind — 保守走標準層規約評估
  {
    actionType: 'add-rule-section',
    match: () => true,
    rationale: (c) => `kind=${c.kind} 無更特定規則命中 — 保守 default 走標準層規約補強評估`,
    suggestion: () =>
      '評估是否值得補規約 §：先確認有無 cross-consumer 訊號；單 consumer 重複問題可先在該 consumer `.claude/rules/local/` 收斂',
  },
]

function hasToolingSignature(c) {
  if (TOOLING_GATES.has(c.gate_name)) return true
  const paths = c.evidence_predicate?.target_paths ?? []
  if (paths.some((p) => TOOLING_PATH_RE.test(p))) return true
  const kws = c.evidence_predicate?.related_keywords ?? []
  return kws.some((k) => TOOLING_KEYWORDS.has(String(k).toLowerCase()))
}

function toolingTargetsOf(c) {
  return (c.evidence_predicate?.target_paths ?? [])
    .filter((p) => TOOLING_PATH_RE.test(p))
    .map((p) => `\`${p}\``)
}

export function classifyAction(candidate) {
  forbidLLMScoring()
  const rule = ACTION_RULES.find((r) => r.match(candidate))
  return {
    actionType: rule.actionType,
    rationale: rule.rationale(candidate),
    suggestion: rule.suggestion(candidate),
  }
}

// Source-of-truth write invariants (rules/core/improvement-loop.md §SoT write invariants).
// Digest output is restricted to docs/digests/ and vendor/ledger/. Any attempt to
// write to rules/core/, plugins/hub-core/skills/, plugins/hub-core/hooks/, or
// openspec/changes/ from the digest pipeline throws — auto-codification is forbidden.
const FORBIDDEN_OUTPUT_PREFIXES = [
  'rules/core/',
  'plugins/hub-core/skills/',
  'plugins/hub-core/hooks/',
  'openspec/changes/',
]
const ALLOWED_OUTPUT_PREFIXES = ['docs/digests/', 'vendor/ledger/']

export function assertSafeOutputPath(outputPath) {
  const rel = outputPath.startsWith(cladeRoot) ? outputPath.slice(cladeRoot.length + 1) : outputPath
  for (const forbidden of FORBIDDEN_OUTPUT_PREFIXES) {
    if (rel.startsWith(forbidden)) {
      throw new Error(
        `source-of-truth write invariant violated: digest must not modify ${rel}; promote candidates manually via spectra change`,
      )
    }
  }
  const allowed = ALLOWED_OUTPUT_PREFIXES.some((p) => rel.startsWith(p))
  if (!allowed) {
    throw new Error(
      `digest output path '${rel}' is outside the allowlist (${ALLOWED_OUTPUT_PREFIXES.join(', ')})`,
    )
  }
}

function digHash(parts) {
  const h = createHash('sha256')
  for (const p of parts) h.update(String(p))
  h.update('|')
  return `DIG-${h.digest('hex').slice(0, 12)}`
}

// Scan prior digest .md files in docs/digests/ for DIG-id frequency over a lookback window.
// Returns Map<DIG-id, count>. Used to flag candidates unresolved across multiple digests —
// i.e. same fingerprint emitted but never converged (no tech-debt close / no rule landing).
// `_bootstrap-*.md` files are excluded; today's digest is excluded by `currentDate`.
function scanPriorDigestsForIds({ digestsRoot, currentDate, lookback = 5 }) {
  const dir = join(digestsRoot, 'docs', 'digests')
  if (!existsSync(dir)) return new Map()
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_bootstrap') && f !== `${currentDate}.md`)
    .toSorted()
    .toReversed()
    .slice(0, lookback)
  const freq = new Map()
  for (const f of files) {
    const content = readFileSync(join(dir, f), 'utf8')
    const seen = new Set()
    for (const m of content.matchAll(/^### (DIG-[0-9a-f]{12})\b/gm)) seen.add(m[1])
    for (const id of seen) freq.set(id, (freq.get(id) ?? 0) + 1)
  }
  return freq
}

function readRegistry() {
  return JSON.parse(readFileSync(SOURCES.registry, 'utf8'))
}

function readTechDebt() {
  if (!existsSync(SOURCES.techDebt)) return []
  const text = readFileSync(SOURCES.techDebt, 'utf8')
  const out = []
  const lines = text.split('\n')
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(/^## (TD-\d+)\s*[—-]\s*(.+)$/)
    if (m) {
      if (current) out.push(current)
      current = { id: m[1], title: m[2], bodyStartLine: i + 1, body: [] }
      continue
    }
    if (current && line.startsWith('## ')) {
      out.push(current)
      current = null
    }
    if (current) current.body.push(line)
  }
  if (current) out.push(current)
  for (const td of out) {
    td.body = td.body.join('\n').trim()
    td.status = parseTechDebtStatus(td.body)
  }
  return out
}

// Closed TDs SHALL NOT be re-emitted as candidates (state-layer closure): the
// fix has landed or is intentionally not happening, even though the header still
// exists. Status parsing lives in ./tech-debt-status.mjs so this skip and the
// closure scanner's tech-debt-closed check share one definition.
function isClosedTechDebt(td) {
  return isClosedStatus(td.status)
}

function readArchivedChanges() {
  if (!existsSync(SOURCES.archive)) return []
  const out = []
  for (const entry of readdirSync(SOURCES.archive)) {
    const dir = join(SOURCES.archive, entry)
    if (!statSync(dir).isDirectory()) continue
    const proposalPath = join(dir, 'proposal.md')
    if (!existsSync(proposalPath)) continue
    const body = readFileSync(proposalPath, 'utf8')
    const titleMatch = entry.match(/^\d{4}-\d{2}-\d{2}-(.+)$/)
    out.push({
      id: entry,
      slug: titleMatch ? titleMatch[1] : entry,
      archivedDate: titleMatch ? entry.slice(0, 10) : null,
      body,
    })
  }
  return out
}

function readJsonl(path) {
  if (!existsSync(path)) return []
  const out = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch (e) {
      console.warn(`▸ skip malformed jsonl line in ${path}: ${e.message}`)
    }
  }
  return out
}

function readSignals() {
  const raw = readJsonl(SOURCES.signals)
  const accepted = []
  let rejected = 0
  for (const rec of raw) {
    const { ok } = validateRecord(rec)
    if (ok) accepted.push(rec)
    else rejected++
  }
  return { accepted, rejected }
}

function groupSignalsByFingerprint(signals) {
  const groups = new Map()
  for (const s of signals) {
    const key = `${s.gate_name}::${s.error_fingerprint}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }
  return groups
}

export function detectFromSignals(signals, registry, nowMs = Date.now()) {
  if (signals.length === 0) return []
  forbidLLMScoring()
  const consumerWeights = registry ? computeConsumerWeights(registry) : new Map()
  const groups = groupSignalsByFingerprint(signals)
  const candidates = []
  for (const [key, allEvents] of groups) {
    const [gate, errFp] = key.split('::')
    const tCfg = thresholdFor(gate)
    if (!tCfg) continue
    // SWEEP-002: windowDays 過去是 dead config（定義於 THRESHOLDS 卻從未消費）→ stale
    // 訊號永久滿足 threshold + occurrences 灌水（sync-rules-drift 報 18 occ，其中 17 筆
    // 是 2 週前的死事件）。修法：有設 windowDays 的 gate 只計窗內事件做 threshold/計數；
    // 沒設 windowDays 的 gate（testFailure / review / handoff）維持 lifetime 行為不變。
    const events = tCfg.windowDays
      ? allEvents.filter((e) => {
          const ms = Date.parse(e.ts_utc)
          return Number.isFinite(ms) && nowMs - ms <= tCfg.windowDays * 86_400_000
        })
      : allEvents
    if (events.length === 0) continue
    const consumers = new Set(events.map((e) => e.consumer_id))
    const hit = matchesThreshold(events, consumers, tCfg, consumerWeights)
    if (!hit) continue
    // TD-112: split active vs non-active for display + cookbook generalization
    const consumersList = [...consumers]
    const activeConsumers = consumersList.filter((c) => (consumerWeights.get(c) ?? 1.0) === 1.0)
    const nonActiveConsumers = consumersList.filter((c) => (consumerWeights.get(c) ?? 1.0) < 1.0)
    const lastSeen = allEvents
      .map((e) => e.ts_utc)
      .toSorted()
      .at(-1)
    candidates.push({
      id: digHash([gate, errFp, 'signals']),
      kind: 'signal-pattern',
      severity: tCfg.severity ?? 'P2',
      gate_name: gate,
      error_fingerprint: errFp,
      consumers: consumersList,
      active_consumers: activeConsumers,
      non_active_consumers: nonActiveConsumers,
      occurrences: events.length,
      occurrences_lifetime: allEvents.length,
      window_days: tCfg.windowDays ?? null,
      last_seen: lastSeen,
      sample_event_ids: events.slice(0, 3).map((e) => e.event_id),
      evidence_predicate: buildSignalEvidence(gate, errFp),
    })
  }
  return candidates
}

function thresholdFor(gate) {
  if (gate === 'validate-manifests' || gate === 'publish' || gate === 'propagate')
    return THRESHOLDS.publishGate
  // typecheck / lint / fmt check gates — consumers emit pnpm-* variants via the
  // clade-gate wrapper (TD-152 adoption). Same grouping shape as vp-check.
  if (
    gate === 'vp-check' ||
    gate === 'vp-lint' ||
    gate === 'vp-fmt' ||
    gate === 'pnpm-typecheck' ||
    gate === 'pnpm-lint' ||
    gate === 'pnpm-fmt'
  )
    return THRESHOLDS.vpCheck
  if (gate === 'pnpm-test') return THRESHOLDS.testFailure
  if (gate === 'pre-commit') return THRESHOLDS.preCommit
  if (gate === 'review-output') return THRESHOLDS.review
  return null
}

function matchesThreshold(events, consumers, cfg, consumerWeights) {
  // TD-112: weighted cardinality — `crossConsumerMin` 用 weighted sum 而非純 distinct count
  // active=1.0 / maintenance=0.3 / paused=0 / auto=1.0；2 active = 2.0；1 active + 2 maintenance = 1.6 < 2.0
  const weightedCount = [...consumers].reduce((s, c) => s + (consumerWeights?.get(c) ?? 1.0), 0)
  if (
    cfg.crossConsumerMin &&
    weightedCount >= cfg.crossConsumerMin &&
    (!cfg.totalMin || events.length >= cfg.totalMin)
  )
    return true
  if (cfg.sameFingerprintMin && events.length >= cfg.sameFingerprintMin) return true
  if (cfg.singleConsumerSessionsMin && cfg.singleConsumerTotalMin && consumers.size === 1) {
    const sessionCount = new Set(events.map((e) => e.session_id)).size
    if (
      sessionCount >= cfg.singleConsumerSessionsMin &&
      events.length >= cfg.singleConsumerTotalMin
    )
      return true
  }
  return false
}

function buildSignalEvidence(gate, errFp) {
  const targets = inferTargetPaths(errFp)
  return {
    target_paths: targets,
    target_symbols: [],
    expected_state: [
      {
        kind: 'absent-after-fix',
        description: `signal '${gate}::${errFp}' SHALL NOT recur in 7 consecutive days after the fix is promoted`,
      },
    ],
    validation_commands: [`node vendor/scripts/improvement-digest.mjs --dry-run | grep ${errFp}`],
    related_keywords: extractKeywords(errFp),
  }
}

function inferTargetPaths(fingerprint) {
  const m = fingerprint.match(/([A-Za-z0-9_/.-]+\.(?:ts|mjs|js|mts|md|sh|json))/g)
  return m ?? []
}

function extractKeywords(text) {
  return text
    .split(/[^A-Za-z0-9_]+/)
    .filter((w) => w.length >= 4)
    .slice(0, 6)
}

/**
 * Detect stale session worktrees inside cladeRoot. Two emission triggers:
 *   - wt-stale-idle:   session/* branch with no commit for >=14 days
 *   - wt-stale-merged: session/* branch merged into main but worktree dir on disk
 */
const STALE_IDLE_DAYS = 14

function gitOut(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function parseWorktreePorcelain(out) {
  const recs = out.split(/\n\n+/)
  const list = []
  for (const r of recs) {
    if (!r.trim()) continue
    const entry = {}
    for (const line of r.split('\n')) {
      const idx = line.indexOf(' ')
      if (idx < 0) entry[line] = ''
      else entry[line.slice(0, idx)] = line.slice(idx + 1)
    }
    if (entry.worktree) {
      list.push({ path: entry.worktree, head: entry.HEAD, branch: entry.branch || null })
    }
  }
  return list
}

function detectFromStaleWorktrees(now = Date.now()) {
  const out = gitOut(['worktree', 'list', '--porcelain'], cladeRoot)
  if (!out) return []
  const sessions = parseWorktreePorcelain(out).filter(
    (w) => w.branch && w.branch.startsWith('refs/heads/session/'),
  )
  if (sessions.length === 0) return []

  const mergedRaw = gitOut(['branch', '--merged', 'main'], cladeRoot)
  const merged = new Set(
    mergedRaw
      .split('\n')
      .map((l) => l.replace(/^[*+]?\s*/, '').trim())
      .filter(Boolean),
  )

  const candidates = []
  for (const w of sessions) {
    const branchName = w.branch.replace('refs/heads/', '')
    const lastCt = parseInt(gitOut(['log', '-1', '--format=%ct', branchName], cladeRoot) || '0', 10)
    const lastMs = Number.isFinite(lastCt) ? lastCt * 1000 : 0
    const daysOld = lastMs ? Math.floor((now - lastMs) / 86_400_000) : null

    if (merged.has(branchName)) {
      candidates.push({
        id: digHash(['wt-stale-merged', branchName]),
        kind: 'wt-stale-merged',
        severity: 'P2',
        title: `Session worktree branch \`${branchName}\` is merged into main but worktree directory still on disk`,
        evidence_predicate: {
          target_paths: [w.path],
          target_symbols: [],
          expected_state: [
            {
              kind: 'worktree-removed',
              description: `worktree at ${w.path} SHALL be removed via \`node scripts/wt-helper.mjs cleanup <slug>\` once safe to clean`,
            },
          ],
          validation_commands: [`node vendor/scripts/wt-helper.mjs list --json`],
          related_keywords: ['worktree', 'merged', 'cleanup'],
        },
      })
      continue
    }

    if (daysOld !== null && daysOld >= STALE_IDLE_DAYS) {
      candidates.push({
        id: digHash(['wt-stale-idle', branchName]),
        kind: 'wt-stale-idle',
        severity: 'P2',
        title: `Session worktree branch \`${branchName}\` idle for ${daysOld} days (>=${STALE_IDLE_DAYS}d threshold)`,
        evidence_predicate: {
          target_paths: [w.path],
          target_symbols: [],
          expected_state: [
            {
              kind: 'worktree-active-or-removed',
              description: `branch ${branchName} SHALL either resume activity or be cleaned up (merge → cleanup, or abandon → cleanup --force)`,
            },
          ],
          validation_commands: [`node vendor/scripts/wt-helper.mjs list --json`],
          related_keywords: ['worktree', 'idle', 'stale'],
        },
      })
    }
  }
  return candidates
}

function runAuditScript(scriptPath, extraArgs = []) {
  try {
    const needsStrip = scriptPath.endsWith('.mts')
    const nodeArgs = needsStrip
      ? ['--experimental-strip-types', scriptPath, ...extraArgs]
      : [scriptPath, ...extraArgs]
    const result = spawnSync('node', nodeArgs, {
      cwd: cladeRoot,
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.status !== 0 || !result.stdout) return null
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

function detectFromScreenshotStaleness() {
  const script = join(cladeRoot, 'vendor', 'scripts', 'audit-screenshot-staleness.mts')
  if (!existsSync(script)) return []
  const report = runAuditScript(script, ['--all-consumers', '--json'])
  if (!report?.summary) return []
  const staleCount = report.summary.staleCount ?? 0
  const legacyCount = report.summary.legacyCount ?? 0
  if (staleCount + legacyCount === 0) return []
  const affected = (report.consumers ?? [])
    .filter(
      (c) => c.status === 'ok' && c.changes?.some((ch) => ch.stale?.length || ch.legacy?.length),
    )
    .map((c) => c.name)
  return [
    {
      id: digHash(['audit-screenshot-staleness', ...affected.toSorted()]),
      kind: 'audit-screenshot-staleness',
      severity: 'P2',
      consumers: affected,
      title: `Screenshot staleness: ${staleCount} stale + ${legacyCount} legacy across ${affected.length} consumer(s)`,
      evidence_predicate: {
        target_paths: ['vendor/scripts/audit-screenshot-staleness.mts'],
        target_symbols: [],
        expected_state: [
          {
            kind: 'zero-stale',
            description: `stale + legacy count SHALL be 0 after agent re-shoots affected screenshots`,
          },
        ],
        validation_commands: [
          'node --experimental-strip-types vendor/scripts/audit-screenshot-staleness.mts --all-consumers --json | jq .summary',
        ],
        related_keywords: ['screenshot', 'staleness', 'verify-ui', 'review-gui'],
      },
    },
  ]
}

function detectFromClaudeAnalyzedDrift() {
  const script = join(cladeRoot, 'vendor', 'scripts', 'audit-claude-analyzed-drift.mjs')
  if (!existsSync(script)) return []
  const report = runAuditScript(script, ['--all-consumers', '--json'])
  if (!report?.summary) return []
  const total = report.summary.totalFindings ?? 0
  if (total === 0) return []
  const affected = (report.consumers ?? [])
    .filter((c) => c.status === 'ok' && c.findings?.length)
    .map((c) => c.name)
  return [
    {
      id: digHash(['audit-claude-analyzed-drift', ...affected.toSorted()]),
      kind: 'audit-claude-analyzed-drift',
      severity: 'P2',
      consumers: affected,
      title: `Claude-analyzed drift: ${total} item(s) with resolved prose but no machine annotation across ${affected.length} consumer(s)`,
      evidence_predicate: {
        target_paths: ['vendor/scripts/audit-claude-analyzed-drift.mjs'],
        target_symbols: [],
        expected_state: [
          {
            kind: 'zero-drift',
            description: `all resolved/out-of-scope issues SHALL have (claude-analyzed: route=E) annotation`,
          },
        ],
        validation_commands: [
          'node vendor/scripts/audit-claude-analyzed-drift.mjs --all-consumers --json | jq .summary',
        ],
        related_keywords: ['claude-analyzed', 'drift', 'annotation', 'review-gui', 'bucket'],
      },
    },
  ]
}

function detectFromTechDebt(items) {
  // State-layer closure: skip TDs whose `**Status**:` is done/resolved/wontfix/closed.
  // Re-emitting closed TDs as candidates falsely inflates the "unresolved across
  // digests" convergence metric (the fix has already landed — header still exists).
  return items
    .filter((td) => !isClosedTechDebt(td))
    .map((td) => ({
      id: digHash(['tech-debt', td.id]),
      kind: 'tech-debt',
      severity:
        td.body.includes('block production') || td.body.includes('P0')
          ? 'P0'
          : td.body.includes('P1')
            ? 'P1'
            : 'P2',
      source_id: td.id,
      title: td.title,
      evidence_predicate: {
        target_paths: extractPathsFromBody(td.body),
        target_symbols: [],
        expected_state: [
          {
            kind: 'tech-debt-closed',
            description: `${td.id} SHALL be marked closed or removed from docs/tech-debt.md after the fix lands`,
          },
        ],
        validation_commands: [`grep -A2 '^## ${td.id}' docs/tech-debt.md`],
        related_keywords: extractKeywords(td.title),
      },
    }))
}

function extractPathsFromBody(body) {
  const set = new Set()
  for (const m of body.matchAll(/`([A-Za-z0-9_./-]+\.(?:ts|mjs|js|mts|md|sh|json))`/g))
    set.add(m[1])
  for (const m of body.matchAll(
    /(?:^|[^`])(scripts\/[A-Za-z0-9_./-]+|vendor\/[A-Za-z0-9_./-]+|rules\/[A-Za-z0-9_./-]+|docs\/[A-Za-z0-9_./-]+)/g,
  ))
    set.add(m[1])
  return [...set].slice(0, 8)
}

function archivedKeywordIndex(archived) {
  const idx = new Map()
  for (const arch of archived) {
    const words = arch.slug.split(/-/).filter((w) => w.length >= 4)
    for (const w of words) {
      if (!idx.has(w)) idx.set(w, [])
      idx.get(w).push(arch.id)
    }
  }
  return idx
}

function annotatePriorArt(candidates, archived) {
  const idx = archivedKeywordIndex(archived)
  for (const c of candidates) {
    const keywords = c.evidence_predicate?.related_keywords ?? []
    const matched = new Set()
    for (const w of keywords) {
      const ids = idx.get(w.toLowerCase())
      if (ids) ids.forEach((id) => matched.add(id))
    }
    c.prior_art = [...matched].slice(0, 3)
  }
}

function deduplicateCandidates(candidates) {
  const seen = new Map()
  for (const c of candidates) {
    const existing = seen.get(c.id)
    if (!existing) seen.set(c.id, c)
    else existing.occurrences = (existing.occurrences ?? 1) + (c.occurrences ?? 1)
  }
  return [...seen.values()]
}

function candidateTitle(c) {
  return c.title ?? `${c.gate_name}::${c.error_fingerprint}`
}

function formatEvidencePredicate(ep) {
  const lines = ['**Evidence predicate**:']
  if (ep.target_paths?.length)
    lines.push(`- target_paths: ${ep.target_paths.map((p) => `\`${p}\``).join(', ')}`)
  if (ep.target_symbols?.length) lines.push(`- target_symbols: ${ep.target_symbols.join(', ')}`)
  lines.push('- expected_state:')
  for (const s of ep.expected_state ?? []) lines.push(`  - \`${s.kind}\`: ${s.description}`)
  if (ep.validation_commands?.length) {
    lines.push('- validation_commands:')
    for (const cmd of ep.validation_commands) lines.push(`  - \`${cmd}\``)
  }
  if (ep.related_keywords?.length)
    lines.push(`- related_keywords: ${ep.related_keywords.join(', ')}`)
  return lines
}

// TD draft 的 Class 推斷（TD hygiene gate：clade-role-and-todo-discipline.md § TD entry hygiene gate）。
// 優先序：consumer 業務路徑（Invariant 3 → B 一行記實）> cleanup（clade home housekeeping → A）
// > add-gate（preventive tooling → D）> clade SoT 路徑 → A > 其餘（consumer 完善度）→ B
export function inferTdClass(candidate, action = classifyAction(candidate)) {
  const paths = candidate.evidence_predicate?.target_paths ?? []
  const consumerBusinessPaths = paths.filter((p) => CONSUMER_BUSINESS_PATH_RE.test(p))
  if (consumerBusinessPaths.length > 0) {
    return {
      tdClass: 'B',
      classNote:
        'consumer 完善度長期未收斂（target_paths 含 consumer 業務路徑，per TD hygiene gate Invariant 3 改一行記實）',
      consumerBusinessPaths,
    }
  }
  if (action.actionType === 'cleanup') {
    return {
      tdClass: 'A',
      classNote: 'clade 標準層 housekeeping（stale worktree / screenshot 清理）',
      consumerBusinessPaths: [],
    }
  }
  if (action.actionType === 'add-gate') {
    return {
      tdClass: 'D',
      classNote: 'preventive tooling（audit signal 已存在，缺強制執行點）',
      consumerBusinessPaths: [],
    }
  }
  if (paths.some((p) => CLADE_SOT_PATH_RE.test(p))) {
    return {
      tdClass: 'A',
      classNote: 'clade 標準層 issue（target_paths 指向 clade SoT）',
      consumerBusinessPaths: [],
    }
  }
  return { tdClass: 'B', classNote: 'consumer 完善度長期未收斂', consumerBusinessPaths: [] }
}

// 非 tech-debt 來源 candidate 產出 TD draft 段（fenced code block，人工 copy-paste
// 批准制 — 本 script 永不自動寫入 docs/tech-debt.md，per SoT write invariants）。
// tech-debt 來源回傳 null：行動是推進既有 TD（advance-td），不開新 TD。
export function buildTdDraft(
  candidate,
  { date = new Date().toISOString().slice(0, 10), action } = {},
) {
  if (candidate.kind === 'tech-debt') return null
  const act = action ?? classifyAction(candidate)
  const { tdClass, classNote, consumerBusinessPaths } = inferTdClass(candidate, act)
  const title = candidateTitle(candidate)
  const paths = candidate.evidence_predicate?.target_paths ?? []
  const draft = []
  draft.push(`## TD-XXX — ${title}`)
  draft.push('')
  if (consumerBusinessPaths.length > 0) {
    // Invariant 3：Location 禁 consumer 業務路徑 → 降為 Class B 一行記實格式
    const cladeSafe = paths.filter((p) => !CONSUMER_BUSINESS_PATH_RE.test(p))
    draft.push(`**Class**: B — ${classNote}`)
    draft.push(
      `**Location**: ${cladeSafe.length ? cladeSafe.map((p) => `\`${p}\``).join(', ') : 'clade 稽核層'}（consumer 業務路徑已剔除：${consumerBusinessPaths.map((p) => `\`${p}\``).join(', ')} — consumer 自治區）`,
    )
    draft.push(`**Discovered**: ${date}`)
    draft.push('')
    draft.push(
      `${title} — consumer 自治區實作，clade 一行記實、不拆步驟、不追蹤內部檔。Refs: ${candidate.id}`,
    )
  } else {
    draft.push(`**Class**: ${tdClass} — ${classNote}`)
    draft.push(
      `**Location**: ${paths.length ? paths.map((p) => `\`${p}\``).join(', ') : '（無明確 target_paths — 批准時補）'}`,
    )
    draft.push(`**Discovered**: ${date}`)
    draft.push('')
    draft.push(`**建議行動**: ${act.actionType} — ${act.suggestion}`)
    draft.push('')
    draft.push(...formatEvidencePredicate(candidate.evidence_predicate ?? {}))
    draft.push('')
    draft.push(`Refs: ${candidate.id}`)
  }
  return [
    '**TD draft**（人工批准制，copy-paste 進 docs/tech-debt.md — 填號前先 grep `^## TD-` 主檔 docs/tech-debt.md + docs/archives/ 查重，確認編號未被使用）:',
    '',
    '```md',
    ...draft,
    '```',
  ].join('\n')
}

export function formatCandidate(c, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const ep = c.evidence_predicate
  const lines = []
  lines.push(`### ${c.id} — ${candidateTitle(c)}`)
  lines.push('')
  lines.push(`- **kind**: ${c.kind}`)
  lines.push(`- **severity**: ${c.severity}`)
  if (c.source_id) lines.push(`- **source**: ${c.source_id}`)
  // TD-112: prefer active/non-active split when present (signal-pattern candidates)，
  // fallback to flat `consumers` list（tech-debt / archive / stale-wt candidates 用單 list）
  if (c.active_consumers?.length || c.non_active_consumers?.length) {
    if (c.active_consumers?.length)
      lines.push(`- **active consumers**: ${c.active_consumers.join(', ')}`)
    if (c.non_active_consumers?.length)
      lines.push(`- **non-active consumers**: ${c.non_active_consumers.join(', ')}`)
  } else if (c.consumers) {
    lines.push(`- **consumers**: ${c.consumers.join(', ')}`)
  }
  if (c.occurrences) {
    let occLine = `- **occurrences**: ${c.occurrences}`
    // SWEEP-002: signal-pattern 候選標明窗 + lifetime + last seen，讓 stale 訊號一眼可辨
    if (c.window_days) occLine += ` (last ${c.window_days}d)`
    if (c.occurrences_lifetime && c.occurrences_lifetime !== c.occurrences)
      occLine += ` / ${c.occurrences_lifetime} lifetime`
    lines.push(occLine)
    if (c.last_seen) lines.push(`- **last seen**: ${c.last_seen}`)
  }
  if (c.unresolved_across && c.unresolved_across.count >= 2)
    lines.push(
      `- **unresolved across digests**: appeared in ${c.unresolved_across.count} of last ${c.unresolved_across.lookback}`,
    )
  if (c.sample_event_ids?.length)
    lines.push(`- **sample event ids**: ${c.sample_event_ids.join(', ')}`)
  if (c.prior_art?.length) lines.push(`- **prior art**: ${c.prior_art.join(', ')}`)
  lines.push('')
  lines.push(...formatEvidencePredicate(ep))
  const action = classifyAction(c)
  lines.push('')
  lines.push(`**建議行動**: ${action.actionType} — ${action.suggestion}`)
  lines.push(`- rationale: ${action.rationale}`)
  const tdDraft = buildTdDraft(c, { date, action })
  if (tdDraft) {
    lines.push('')
    lines.push(tdDraft)
  }
  lines.push('')
  return lines.join('\n')
}

function formatMetrics(metrics) {
  return [
    '## Metrics',
    '',
    `- explicit_close_rate: ${metrics.explicit_close_rate}`,
    `- inferred_close_rate: ${metrics.inferred_close_rate}`,
    `- artifact_realization_rate: ${metrics.artifact_realization_rate}`,
    `- stale_reopen_rate: ${metrics.stale_reopen_rate}`,
    `- false_positive_rate_from_manual_review: ${metrics.false_positive_rate_from_manual_review}`,
    '',
  ].join('\n')
}

// § Sweep effectiveness — invokes audit-sweep-regression.mts for each existing
// sweep × retrospective window (14d / 30d), aggregates JSON output into a
// markdown table. Silently degrades to a placeholder note if the audit script
// is unavailable or any sweep has no manifest yet (bootstrap before SWEEP-V2
// lands). Companion to:
//   - docs/sweeps/<date>-coordination-sweep-vN.md (manifest of prevention items)
//   - vendor/scripts/audit-sweep-regression.mts (CLI source of truth)
//   - rules/local/clade-role-and-todo-discipline.md § new-standard SOP step 5
function formatSweepEffectiveness() {
  const sweepsDir = join(cladeRoot, 'docs', 'sweeps')
  if (!existsSync(sweepsDir)) {
    return [
      '## § Sweep effectiveness',
      '',
      '_no sweep manifests in `docs/sweeps/` — section skipped._',
      '',
    ].join('\n')
  }
  const sweepIds = readSweepIds(sweepsDir)
  if (sweepIds.length === 0) {
    return [
      '## § Sweep effectiveness',
      '',
      '_no parseable sweep manifests — section skipped._',
      '',
    ].join('\n')
  }
  const auditScript = join(cladeRoot, 'vendor', 'scripts', 'audit-sweep-regression.mts')
  if (!existsSync(auditScript)) {
    return [
      '## § Sweep effectiveness (auto-generated)',
      '',
      '_audit-sweep-regression.mts not found — section skipped._',
      '',
    ].join('\n')
  }
  const rows = []
  const findings = []
  for (const sweepId of sweepIds) {
    for (const window of [14, 30]) {
      const result = runAuditSweepRegression(auditScript, sweepId, window)
      if (!result) {
        rows.push({ sweepId, window, count: null, status: '⚠ audit failed' })
        continue
      }
      const count = result.summary?.totalRegressions ?? 0
      const status = count === 0 ? '✅ stable' : '⚠ regression detected'
      rows.push({ sweepId, window, count, status })
      if (count > 0) {
        for (const row of result.rows ?? []) {
          for (const pf of row.regressionPitfalls ?? []) {
            findings.push({ sweepId, preventionId: row.preventionId, window, pitfall: pf })
          }
        }
      }
    }
  }
  const lines = [
    '## § Sweep effectiveness (auto-generated)',
    '',
    '| Sweep | Window | Regression count | Status |',
    '| --- | --- | ---: | --- |',
  ]
  for (const r of rows) {
    const countCell = r.count === null ? '—' : String(r.count)
    lines.push(`| ${r.sweepId} | ${r.window}d | ${countCell} | ${r.status} |`)
  }
  if (findings.length > 0) {
    lines.push('', '### Regression details', '')
    for (const f of findings) {
      lines.push(
        `- \`${f.sweepId}\` / \`${f.preventionId}\` (${f.window}d): \`${f.pitfall.pitfallId}\` (${f.pitfall.discovered}) → ${f.pitfall.pitfallPath}`,
      )
    }
    lines.push(
      '',
      'Each regression hit indicates a sweep prevention failed. Strengthen the',
      'prevention in the next sweep, or supersede with a stronger guard (audit-signal',
      '/ pre-commit-hook / upstream-pr).',
    )
  }
  lines.push('')
  return lines.join('\n')
}

function readSweepIds(sweepsDir) {
  const entries = readdirSync(sweepsDir).filter((e) => e.endsWith('.md'))
  const ids = []
  for (const entry of entries) {
    try {
      const text = readFileSync(join(sweepsDir, entry), 'utf8')
      const m = text.match(/^sweep_id:\s*(\S+)\s*$/m)
      if (m) ids.push(m[1])
    } catch {
      // skip unreadable
    }
  }
  return [...new Set(ids)].toSorted()
}

function runAuditSweepRegression(scriptPath, sweepId, windowDays) {
  const result = spawnSync(
    'node',
    [
      '--experimental-strip-types',
      scriptPath,
      '--window',
      String(windowDays),
      '--sweep',
      sweepId,
      '--json',
    ],
    { cwd: cladeRoot, encoding: 'utf8', timeout: 15000 },
  )
  // Exit 0 = OK, Exit 1 = regression detected (still has JSON in stdout).
  if (result.status !== 0 && result.status !== 1) return null
  if (!result.stdout) return null
  // Markdown is also emitted by default; we passed --json so stdout is pure JSON.
  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

function persistCandidates(candidates) {
  const ts = new Date().toISOString()
  const existing = readJsonlScanner(SOURCES.ledger)
  const seen = new Set(existing.map((c) => c.id))
  for (const c of candidates) {
    if (seen.has(c.id)) continue
    appendRecord(
      { ...c, emitted_at: ts, ledger_kind: 'candidate' },
      { ledgerPath: SOURCES.ledger, skipSchema: true },
    )
  }
}

// dry-run 等價模擬：回傳「persistCandidates 寫完後 readJsonlScanner(SOURCES.ledger)
// 會看到的內容」（既有 history + 本輪未見過的 candidate，附 persist 時會加的
// emitted_at / ledger_kind）— 零寫入，讓 dry-run metrics 跟真跑一致。
function simulatePersistedCandidates(candidates, ts = new Date().toISOString()) {
  const existing = readJsonlScanner(SOURCES.ledger)
  const seen = new Set(existing.map((c) => c.id))
  const fresh = candidates
    .filter((c) => !seen.has(c.id))
    .map((c) => ({ ...c, emitted_at: ts, ledger_kind: 'candidate' }))
  return [...existing, ...fresh]
}

function persistOutcomes(outcomes) {
  for (const o of outcomes) {
    appendRecord(
      { ...o, ledger_kind: 'outcome' },
      { ledgerPath: SOURCES.outcomes, skipSchema: true },
    )
  }
}

export async function runDigest({ dryRun = false } = {}) {
  forbidLLMScoring()
  // TD-189: consumer signals are written to <consumer>/.clade/vendor/ledger/ and
  // never reach clade home. Pull them into the home ledger (dedup by event_id)
  // BEFORE reading signals, so detection sees fresh consumer data. Registry-driven.
  const agg = aggregateConsumerSignals({ cladeRoot, dryRun })
  if (agg.ok && agg.pulled > 0) {
    console.log(`▸ signal aggregation: pulled ${agg.pulled} consumer record(s) into home ledger`)
  }
  const registry = readRegistry()
  const td = readTechDebt()
  const archived = readArchivedChanges()
  const { accepted: signals, rejected: signalsRejected } = readSignals()

  const candidates = [
    ...detectFromTechDebt(td),
    ...detectFromSignals(signals, registry),
    ...detectFromStaleWorktrees(),
    ...detectFromScreenshotStaleness(),
    ...detectFromClaudeAnalyzedDrift(),
  ]
  annotatePriorArt(candidates, archived)
  const deduped = deduplicateCandidates(candidates)
  deduped.sort((a, b) => {
    const order = { P0: 0, P1: 1, P2: 2 }
    return (order[a.severity] ?? 9) - (order[b.severity] ?? 9)
  })

  // Persist candidates (immutable history) and run closure inference + outcome ledger.
  // dry-run MUST NOT append to vendor/ledger/*.jsonl — simulate the post-write ledger
  // state in memory instead, so metrics still match what a real run would report.
  if (dryRun) {
    console.log(
      '▸ dry-run: skipped ledger writes (vendor/ledger/candidates.jsonl, vendor/ledger/outcomes.jsonl)',
    )
  } else {
    persistCandidates(deduped)
  }
  const candidateHistory = dryRun
    ? simulatePersistedCandidates(deduped)
    : readJsonlScanner(SOURCES.ledger)
  const outcomes = inferAllClosures(deduped, { repoRoot: cladeRoot, since: '90 days ago' })
  if (!dryRun) persistOutcomes(outcomes)
  const allOutcomes = dryRun
    ? [
        ...readJsonlScanner(SOURCES.outcomes),
        ...outcomes.map((o) => ({ ...o, ledger_kind: 'outcome' })),
      ]
    : readJsonlScanner(SOURCES.outcomes)

  const metrics = computeLayeredMetrics({ candidates: candidateHistory, outcomes: allOutcomes })
  const today = new Date().toISOString().slice(0, 10)

  // Annotate candidates that have appeared in prior digests but didn't close —
  // surfaces fingerprints that auto-pipeline keeps emitting because no fix landed.
  const UNRESOLVED_LOOKBACK = 5
  const priorFreq = scanPriorDigestsForIds({
    digestsRoot: cladeRoot,
    currentDate: today,
    lookback: UNRESOLVED_LOOKBACK,
  })
  for (const c of deduped) {
    const count = priorFreq.get(c.id) ?? 0
    if (count > 0) c.unresolved_across = { count, lookback: UNRESOLVED_LOOKBACK }
  }
  const unresolvedCount = deduped.filter((c) => (c.unresolved_across?.count ?? 0) >= 2).length

  const signalSource =
    signals.length < 10 ? 'bootstrap-only' : signals.length < 100 ? 'partial' : 'steady-state'
  const sourceNote = {
    'bootstrap-only': `> signal-source: **bootstrap-only** — \`vendor/ledger/signals.jsonl\` has ${signals.length} record${signals.length === 1 ? '' : 's'} (<10). Pattern detection uses tech-debt + archive + audit fallback; real signal grouping inactive. Instrumentation (PATH shim / repo-script wrapper / git hook) not yet propagated to consumers — see \`rules/local/improvement-loop.md § 8\`.`,
    partial: `> signal-source: **partial** — \`vendor/ledger/signals.jsonl\` has ${signals.length} records (10-99). Signal grouping active for high-frequency patterns; low-frequency still relies on fallback sources.`,
    'steady-state': `> signal-source: **steady-state** — \`vendor/ledger/signals.jsonl\` has ${signals.length} records (≥100). Full threshold-based grouping active.`,
  }[signalSource]

  // TD-112: business_activity activity counts (active/maintenance/paused/auto)
  const activityCounts = registry.consumers.reduce((acc, c) => {
    const a = c.business_activity ?? 'auto'
    acc[a] = (acc[a] ?? 0) + 1
    return acc
  }, {})
  const activitySummary = `active=${activityCounts.active ?? 0} maintenance=${activityCounts.maintenance ?? 0} paused=${activityCounts.paused ?? 0} auto=${activityCounts.auto ?? 0}`

  const header = [
    `# Improvement digest — ${today}`,
    '',
    `- consumers tracked: ${registry.consumers.length} (${activitySummary})`,
    `- tech-debt entries ingested: ${td.length}`,
    `- archived changes ingested: ${archived.length}`,
    `- signal records accepted: ${signals.length}`,
    `- signal records rejected (validation): ${signalsRejected}`,
    `- candidates emitted: ${deduped.length}`,
    `- candidates unresolved across ≥2 of last ${UNRESOLVED_LOOKBACK} digests: ${unresolvedCount}`,
    '',
    sourceNote,
    '',
    '## Candidates',
    '',
  ].join('\n')

  const body =
    deduped.length > 0
      ? deduped.map((c) => formatCandidate(c, { date: today })).join('\n')
      : '_no candidates — bootstrap sources produced no qualifying patterns._\n\n'

  const sweepSection = formatSweepEffectiveness()

  const output = `${header}${body}${sweepSection}${formatMetrics(metrics)}`

  if (dryRun) {
    process.stdout.write(output)
    return { output, candidates: deduped, metrics }
  }

  const outDir = join(cladeRoot, 'docs', 'digests')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${today}.md`)
  assertSafeOutputPath(outPath)
  writeFileSync(outPath, output)
  console.log(`▸ wrote ${outPath} (${deduped.length} candidate(s))`)
  return { output, candidates: deduped, metrics, outPath }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const dryRun = process.argv.includes('--dry-run')
  runDigest({ dryRun }).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
