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
//   node vendor/scripts/improvement-digest.ts            # emit today's digest
//   node vendor/scripts/improvement-digest.ts --dry-run  # print candidates, don't write

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateRecord } from '../signals/redact.ts'
import { appendRecord } from '../signals/ledger-writer.ts'
import { aggregateConsumerSignals } from './aggregate-signals.ts'
import {
  computeLayeredMetrics,
  inferAllClosures,
  readJsonl as readJsonlScanner,
} from './closure-scanner.ts'
import { isClosedStatus, parseTechDebtStatus } from './tech-debt-status.ts'

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

interface ThresholdConfig {
  windowDays?: number
  sameFingerprintMin?: number
  crossConsumerMin?: number
  totalMin?: number
  singleConsumerSessionsMin?: number
  singleConsumerTotalMin?: number
  p0p1AlwaysList?: boolean
  requiredAdoptionP2Below?: number
  requiredAdoptionP1Below?: number
  regressionPPListThreshold?: number
  stalledDigestsMin?: number
  sessionsMin?: number
  severity?: string
}

// 欄位名 MUST 對得上 `matchesThreshold` 實際讀的名字（`totalMin` / `singleConsumerTotalMin`
// 等，見上方 ThresholdConfig）。名字打錯不會報錯，只會讓那條門檻**靜默失效**：cross-consumer
// 變成沒有事件數下限、single-consumer 分支從不觸發。SWEEP-002/003 各踩過一次。
const THRESHOLDS: Record<string, ThresholdConfig> = {
  publishGate: { windowDays: 7, sameFingerprintMin: 2, crossConsumerMin: 2, severity: 'P1' },
  vpCheck: {
    windowDays: 14,
    crossConsumerMin: 2,
    totalMin: 3,
    singleConsumerSessionsMin: 3,
    singleConsumerTotalMin: 5,
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
// auto=unset default (treated as 1.0 conservatively; metric-based promotion deferred to propagate.ts drift check)
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
// target_paths 指向 clade shim/script 的 pattern，依 ownership 明確度分兩類。
//
// 明確類：consumer 端不會長出這種結構——投影落在 consumer 的 `scripts/`，不是
// `vendor/scripts/`；`bin/vp` 與 `bin/clade-gate` 是 clade 的 same-name PATH shim。
// 路徑本身就足以證明 ownership，跨幾個 consumer 都成立。
const TOOLING_PATH_CLADE_RE =
  /^(?:bin|vendor\/scripts|plugins\/hub-core\/hooks)\/|(?:^|\/)(?:vp|clade-gate)$/
// 模糊類：clade 與 consumer 兩邊都有 `scripts/` 和 `*.sh`，路徑字串不帶 ownership
// 資訊，需要候選來源佐證（見 hasToolingSignature）。
const TOOLING_PATH_AMBIGUOUS_RE = /^scripts\/|\.sh$/
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
      '跑 `node scripts/wt-helper.ts cleanup <slug>` 移除已 merge 的 worktree，再跑 validation_commands 確認列表乾淨',
  },
  {
    actionType: 'cleanup',
    match: (c) => c.kind === 'wt-stale-idle',
    rationale: () => 'stale worktree 類（idle 超過門檻）— 一次性處置即可關閉，無標準層缺口',
    suggestion: () =>
      '確認該 session branch 要續做還是放棄：續做就 resume worktree，放棄就 `node scripts/wt-helper.ts cleanup --force <slug>`',
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
      '為該 audit signal 加強制點（publish.ts smoke gate / pre-commit hook / propagate 結尾 fail-loud），warn 升級成 block 後用 digest 觀察歸零',
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
  // 明確 clade 路徑：路徑本身即證明 ownership，跨幾個 consumer 都算工具層問題
  if (paths.some((p) => TOOLING_PATH_CLADE_RE.test(p))) return true
  // 模糊路徑（scripts/、*.sh）需要來源佐證：只有候選完全出自 clade 自己時才採信。
  // 少了這道 gate，consumer 自家的 scripts/ 會被歸成 Class A 標準層 issue——實證
  // DIG-d7c0a4931ca4：<consumer-g> 的 scripts/v1-migration/reconciliation.test.mjs 被判成
  // clade 工具鏈問題，實際與 clade scripts/ 毫無關係。
  const consumers = [...(c.consumers ?? [])]
  const cladeOnly = consumers.length > 0 && consumers.every((x) => x === 'clade')
  if (cladeOnly && paths.some((p) => TOOLING_PATH_AMBIGUOUS_RE.test(p))) return true
  const kws = c.evidence_predicate?.related_keywords ?? []
  return kws.some((k) => TOOLING_KEYWORDS.has(String(k).toLowerCase()))
}

function toolingTargetsOf(c) {
  // 這裡只產生建議文字裡的路徑清單，不做 ownership 分類（那是 hasToolingSignature
  // 的職責，且已經先過），所以兩類 pattern 都列。
  return (c.evidence_predicate?.target_paths ?? [])
    .filter((p) => TOOLING_PATH_CLADE_RE.test(p) || TOOLING_PATH_AMBIGUOUS_RE.test(p))
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

export function parseTechDebtEntries(text) {
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
    td.lastReviewed = parseLastReviewed(td.body)
  }
  return out
}

function readTechDebt() {
  if (!existsSync(SOURCES.techDebt)) return []
  return parseTechDebtEntries(readFileSync(SOURCES.techDebt, 'utf8'))
}

const RECENTLY_REVIEWED_DAYS = 30

function parseLastReviewed(body) {
  const m = body.match(/\*\*Last reviewed\*\*:\s*(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function daysSinceDate(isoDate) {
  if (!isoDate) return null
  const t = Date.parse(isoDate)
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24))
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
    // 沒設 windowDays 的 gate（review / handoff）維持 lifetime 行為不變。
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
  // pnpm-typecheck 不產生候選（2026-07-25）。
  //
  // 它是 ledger 最大來源（541/999），但 12 輪 digest 累計產出的 ts:TS**** 候選
  // **沒有任何一條**被推進成 rule 或 TD——docs/tech-debt.md 對這些錯誤碼零命中。
  //
  // 這不是巧合而是結構限制：buildErrorFingerprint 對 TS 診斷只抓 `error TS\d+`
  // 這個碼本身，不留檔案路徑與 symbol（redaction-safe by design）。於是
  // 「兩個 consumer 剛好都寫錯型別」與「clade 共用型別有 bug」產生一模一樣的
  // fingerprint——裸診斷碼沒有可 codify 的具體對象，寫不成規約。
  //
  // 關掉的只是候選生成；shim 照樣把 raw signal 寫進 ledger。真要查跨 consumer
  // 型別 pattern，/oops Mode D 直接讀 vendor/ledger/signals.jsonl 隨時可以。
  if (gate === 'pnpm-typecheck') return null
  // lint / fmt check gates — consumers emit pnpm-* variants via the
  // clade-gate wrapper (TD-152 adoption). Same grouping shape as vp-check.
  if (
    gate === 'vp-check' ||
    gate === 'vp-lint' ||
    gate === 'vp-fmt' ||
    gate === 'pnpm-lint' ||
    gate === 'pnpm-fmt'
  )
    return THRESHOLDS.vpCheck
  // pnpm-test 不產生候選（2026-08-02，TD-263 § 重訪條件 命中後比照 typecheck 處置）。
  //
  // 觸發判準是 TD 寫死的兩條，本輪逐條實測命中：pnpm-test 類仍主導候選池（2026-08-01
  // digest 的 9 條 signal-pattern 候選**全部**是 pnpm-test），且累計 7 輪、66 條候選裡
  // 被推進成 rule 或 TD 的是 **0 條**（`grep -rlE 'pnpm-test::' rules/ docs/tech-debt.md`
  // 零命中）。
  //
  // 結構限制與 typecheck 同源、方向相反：typecheck 的 fingerprint 太**粗**（裸 TS 碼，
  // 沒有可 codify 的對象）；pnpm-test 太**細**——fingerprint 帶著 consumer 自家的測試檔
  // 路徑與 test name（`test/unit/api/school-window-reporting.test.ts > GET /api/v1/... >
  // returns 422`）。那種身分依定義不可能在第二個 consumer 出現，跨 consumer 永遠不成群，
  // 而「跨 consumer 成群」正是這條 loop 用來判斷「這是 clade 標準層該管的事」的唯一依據。
  //
  // 關掉的只是候選生成；shim 照樣把 raw signal 寫進 ledger（本輪 461 筆），要查 consumer
  // 測試紅燈趨勢隨時可讀。
  if (gate === 'pnpm-test') return null
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
    validation_commands: [`node vendor/scripts/improvement-digest.ts --dry-run | grep ${errFp}`],
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
    const entry: Record<string, string> = {}
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
              description: `worktree at ${w.path} SHALL be removed via \`node scripts/wt-helper.ts cleanup <slug>\` once safe to clean`,
            },
          ],
          validation_commands: [`node vendor/scripts/wt-helper.ts list --json`],
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
          validation_commands: [`node vendor/scripts/wt-helper.ts list --json`],
          related_keywords: ['worktree', 'idle', 'stale'],
        },
      })
    }
  }
  return candidates
}

function runAuditScript(scriptPath, extraArgs = []) {
  try {
    const needsStrip = scriptPath.endsWith('.ts')
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
  const script = join(cladeRoot, 'vendor', 'scripts', 'audit-screenshot-staleness.ts')
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
        target_paths: ['vendor/scripts/audit-screenshot-staleness.ts'],
        target_symbols: [],
        expected_state: [
          {
            kind: 'zero-stale',
            description: `stale + legacy count SHALL be 0 after agent re-shoots affected screenshots`,
          },
        ],
        validation_commands: [
          'node --experimental-strip-types vendor/scripts/audit-screenshot-staleness.ts --all-consumers --json | jq .summary',
        ],
        related_keywords: ['screenshot', 'staleness', 'verify-ui', 'review-gui'],
      },
    },
  ]
}

function detectFromClaudeAnalyzedDrift() {
  const script = join(cladeRoot, 'vendor', 'scripts', 'audit-claude-analyzed-drift.ts')
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
        target_paths: ['vendor/scripts/audit-claude-analyzed-drift.ts'],
        target_symbols: [],
        expected_state: [
          {
            kind: 'zero-drift',
            description: `all resolved/out-of-scope issues SHALL have (claude-analyzed: route=E) annotation`,
          },
        ],
        validation_commands: [
          'node vendor/scripts/audit-claude-analyzed-drift.ts --all-consumers --json | jq .summary',
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
    .map((td) => {
      const recentlyReviewed =
        td.lastReviewed !== null && daysSinceDate(td.lastReviewed) <= RECENTLY_REVIEWED_DAYS
      let severity =
        td.body.includes('block production') || td.body.includes('P0')
          ? 'P0'
          : td.body.includes('P1')
            ? 'P1'
            : 'P2'
      if (recentlyReviewed && severity === 'P2') severity = 'P3'
      return {
        id: digHash(['tech-debt', td.id]),
        kind: 'tech-debt',
        severity,
        recently_reviewed: recentlyReviewed || undefined,
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
      }
    })
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

// TD-233: rejected-decision KB (mattpocock/skills `.out-of-scope/` pattern, clade 形態)。
// Wontfix TDs are prior rejections; when a new candidate's keywords overlap a wontfix
// TD title, annotate it so the digest reader sees「已拒絕過＋理由在哪」instead of
// re-litigating the same proposal every sweep. Scans the live tech-debt file plus
// closed-TD archives (rejections get archived too). `superseded` is not a rejection
// (the work happened elsewhere) so it is deliberately excluded. Keyword matching is
// ASCII-token based (extractKeywords) — Chinese-only titles won't match; accepted
// limitation, keeps the pipeline embedding-free.
export function readWontfixEntries({ root = cladeRoot } = {}) {
  const files = [join(root, 'docs', 'tech-debt.md')]
  const archivesDir = join(root, 'docs', 'archives')
  if (existsSync(archivesDir)) {
    for (const f of readdirSync(archivesDir))
      if (/^tech-debt-closed-.*\.md$/.test(f)) files.push(join(archivesDir, f))
  }
  const out = []
  for (const abs of files) {
    if (!existsSync(abs)) continue
    let text
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue // unreadable file: skip, gracefully degrade (don't block digest)
    }
    for (const td of parseTechDebtEntries(text)) {
      if (td.status !== null && td.status.split('-')[0] === 'wontfix') out.push(td)
    }
  }
  return out
}

export function wontfixKeywordIndex(entries) {
  const idx = new Map()
  for (const td of entries) {
    for (const w of extractKeywords(td.title)) {
      const key = w.toLowerCase()
      if (!idx.has(key)) idx.set(key, [])
      idx.get(key).push({ id: td.id, status: td.status })
    }
  }
  return idx
}

// `rejected prior` 要幾個 keyword 同時指向同一條 TD 才標。
//
// 門檻曾是 1（命中任一詞即標），結果 2026-07-25 那輪 17/21（81%）候選都掛上這個
// 警示——幾乎每條都亮的警示等於沒有警示。根因不是索引裡有通用詞（實測 91 個索引詞
// 有 76 個只對應唯一一條 TD，區辨力其實好），而是候選本來就帶 5-6 個 keyword，
// 對上 91 個詞的索引，至少命中一個幾乎必然。
export const REJECTED_PRIOR_MIN_HITS = 2

export function annotateRejectedPrior(candidates, wontfixEntries) {
  const idx = wontfixKeywordIndex(wontfixEntries)
  for (const c of candidates) {
    const keywords = c.evidence_predicate?.related_keywords ?? []
    const matched = new Map()
    for (const w of keywords) {
      const hits = idx.get(w.toLowerCase())
      if (hits)
        for (const h of hits) {
          const prev = matched.get(h.id)
          matched.set(h.id, { ...h, hits: (prev?.hits ?? 0) + 1 })
        }
    }
    // Defensive: a candidate must not cite its own source TD as a prior rejection
    // (detectFromTechDebt already skips closed TDs, so this is belt-and-braces).
    matched.delete(c.source_id)
    const rejected = [...matched.values()]
      .filter((h) => h.hits >= REJECTED_PRIOR_MIN_HITS)
      .slice(0, 3)
    if (rejected.length) c.rejected_prior = rejected
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

const TD_REF_FILES = ['docs/tech-debt.md']

function tdExists(tdId) {
  const archivesDir = join(cladeRoot, 'docs', 'archives')
  const files = [...TD_REF_FILES]
  if (existsSync(archivesDir)) {
    for (const f of readdirSync(archivesDir))
      if (/^tech-debt-closed-.*\.md$/.test(f)) files.push(`docs/archives/${f}`)
  }
  for (const rel of files) {
    const abs = join(cladeRoot, rel)
    if (!existsSync(abs)) continue
    try {
      if (new RegExp(`^## ${tdId} `, 'm').test(readFileSync(abs, 'utf8'))) return true
    } catch {
      // unreadable file: skip, gracefully degrade (don't block digest)
    }
  }
  return false
}

// Flag candidates whose source TD reference no longer resolves to any TD header
// in tech-debt.md or archived closed-TD files. Such a candidate re-emits every
// digest but can never close (its validation_command greps a non-existent TD).
// Flag-only: kept visible for human judgement, never skipped.
function markStaleTdRefs(candidates) {
  for (const c of candidates) {
    const src = c.source_id
    if (!src || !/^TD-\d+$/.test(src)) continue
    if (tdExists(src)) continue
    c.staleRef = true
    console.error(
      `[warn] candidate ${c.id} references ${src} which does not exist in tech-debt.md or archives`,
    )
  }
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
  {
    date = new Date().toISOString().slice(0, 10),
    action,
  }: { date?: string; action?: ReturnType<typeof classifyAction> } = {},
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
  if (c.staleRef)
    lines.push(
      `- **stale-ref**: yes — ${c.source_id} not found in tech-debt.md or archives (needs manual review)`,
    )
  if (c.recently_reviewed) lines.push(`- **recently reviewed**: yes (severity downgraded to P3)`)
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
  if (c.rejected_prior?.length)
    lines.push(
      `- **⚠️ rejected prior**: ${c.rejected_prior.map((r) => `${r.id} (${r.status})`).join(', ')} — 同題材曾被拒，重審前先讀該 TD 的拒絕理由`,
    )
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

// § Sweep effectiveness — invokes audit-sweep-regression.ts for each existing
// sweep × retrospective window (14d / 30d), aggregates JSON output into a
// markdown table. Silently degrades to a placeholder note if the audit script
// is unavailable or any sweep has no manifest yet (bootstrap before SWEEP-V2
// lands). Companion to:
//   - docs/sweeps/<date>-coordination-sweep-vN.md (manifest of prevention items)
//   - vendor/scripts/audit-sweep-regression.ts (CLI source of truth)
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
  const auditScript = join(cladeRoot, 'vendor', 'scripts', 'audit-sweep-regression.ts')
  if (!existsSync(auditScript)) {
    return [
      '## § Sweep effectiveness (auto-generated)',
      '',
      '_audit-sweep-regression.ts not found — section skipped._',
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

// Emit freeze（2026-07-26）：digest 先前的隱含 metric 是「emit 多少 candidate」，不是
// 「關掉多少」——candidate 產量從 28 爬到 87，同期 strict_realization_rate 0.07。
// unresolved 積到門檻時停發新 candidate、只 re-emit 積壓的那些，把注意力壓回收斂。
// 被壓下的候選不會消失：它們沒有 unresolved_across 紀錄，下一輪 unresolved 降到門檻
// 以下就會重新出現。
export const EMIT_FREEZE_THRESHOLD = 10

export function applyEmitFreeze(candidates, unresolvedCount, threshold = EMIT_FREEZE_THRESHOLD) {
  const frozen = unresolvedCount >= threshold
  const emitted = frozen
    ? candidates.filter((c) => (c.unresolved_across?.count ?? 0) > 0)
    : candidates
  return { frozen, emitted, suppressedCount: candidates.length - emitted.length }
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
  annotateRejectedPrior(candidates, readWontfixEntries())
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

  // 嚴格落地率（2026-07-05 銳評）：既有 artifact_realization_rate 把 diff-keyword 弱推斷層
  // 也算 realized（實測 ≈ close rate 同值 0.89，而 state+explicit 僅 ~2%）——「closed 高」
  // 會被誤讀成「都驗證補好了」。不動既有 5-metric 契約，另計 strict 版供 header 顯眼揭露。
  const latestOutcomeByDig = new Map()
  for (const o of allOutcomes) {
    const prev = latestOutcomeByDig.get(o.id)
    if (!prev || (o.inferred_at && o.inferred_at > prev.inferred_at))
      latestOutcomeByDig.set(o.id, o)
  }
  let strictRealized = 0
  let closedAnyLayer = 0
  for (const o of latestOutcomeByDig.values()) {
    if (o.layer === 'explicit' || o.layer === 'state' || o.layer === 'diff') closedAnyLayer++
    if (o.layer === 'explicit' || o.layer === 'state') strictRealized++
  }
  const strictRealizationRate =
    closedAnyLayer === 0 ? '0.00' : (strictRealized / closedAnyLayer).toFixed(2)
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
  markStaleTdRefs(deduped)
  const unresolvedCount = deduped.filter(
    (c) => (c.unresolved_across?.count ?? 0) >= 2 && !c.recently_reviewed,
  ).length

  const { frozen: emitFrozen, emitted, suppressedCount } = applyEmitFreeze(deduped, unresolvedCount)

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
    // 收斂面在前、產量面在後（2026-07-26）：header 第一眼該回答「關掉多少」，
    // 不是「發了多少」——emit 數擺第一會讓產量看起來像成果。
    `- candidates closed（explicit+state+diff 任一層）: ${closedAnyLayer}`,
    // 落地率誠實揭露（2026-07-05 銳評）：closed 的絕大多數靠最弱 diff-keyword 推斷，
    // strict（state+explicit）才代表「驗證過真的補了」——別讓「closed 高」被誤讀。
    `- ⚠ strict_realization_rate（state+explicit / closed；diff-keyword 弱推斷不計）: ${strictRealizationRate}（對照 artifact_realization_rate=${metrics.artifact_realization_rate}，該值含 diff 層）`,
    `- candidates unresolved across ≥2 of last ${UNRESOLVED_LOOKBACK} digests: ${unresolvedCount}`,
    `- candidates emitted: ${emitted.length}`,
    ...(emitFrozen
      ? [
          `- ⏸ **emit frozen** — unresolved ${unresolvedCount} ≥ ${EMIT_FREEZE_THRESHOLD}：本輪只 re-emit 積壓候選，新候選 ${suppressedCount} 條暫不發。先關既有的，unresolved 降到 ${EMIT_FREEZE_THRESHOLD} 以下自動解凍`,
        ]
      : []),
    '',
    sourceNote,
    '',
    '## Candidates',
    '',
  ].join('\n')

  const body =
    emitted.length > 0
      ? emitted.map((c) => formatCandidate(c, { date: today })).join('\n')
      : '_no candidates — bootstrap sources produced no qualifying patterns._\n\n'

  const sweepSection = formatSweepEffectiveness()

  // unresolved_across ≥3 的候選：重發多輪、既沒被 close 也沒人升級 → 輸出 TD 草案讓人一鍵落地。
  // 僅輸出草案文字，不自動寫 tech-debt.md（per improvement-loop 契約：digest 不自動改標準層）。
  const stuck = emitted.filter((c) => (c.unresolved_across?.count ?? 0) >= 3)
  const tdDraftSection =
    stuck.length === 0
      ? ''
      : [
          '## 建議升級 TD 草案（unresolved ≥3 輪，人工 review 後貼進 docs/tech-debt.md）',
          '',
          ...stuck.map((c) =>
            [
              `### 草案 — ${c.id}`,
              '',
              '```markdown',
              `## TD-NNN — ${(c.summary || c.title || c.id).slice(0, 80)}`,
              '',
              '**Class**: A | B | D — <人工判定>',
              '**Status**: open',
              '**Priority**: mid',
              `**Discovered**: ${today}`,
              '',
              `來源：improvement digest 候選 ${c.id}，連續 ${c.unresolved_across.count}/${c.unresolved_across.lookback} 輪未收斂。`,
              `Refs: ${c.id}`,
              '```',
              '',
            ].join('\n'),
          ),
        ].join('\n')

  const output = `${header}${body}${tdDraftSection}${sweepSection}${formatMetrics(metrics)}`

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
