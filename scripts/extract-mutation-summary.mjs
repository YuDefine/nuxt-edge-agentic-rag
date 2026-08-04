#!/usr/bin/env node
/**
 * 從 Stryker 原生報告萃取 clade audit 讀得懂的 summary。
 *
 * 用法：node scripts/extract-mutation-summary.mjs [--in <path>] [--out <path>]
 *   預設 in  = reports/mutation/mutation.json
 *   預設 out = .clade/mutation-summary.json
 *
 * 為什麼不直接 commit Stryker 的 mutation.json：它內嵌每個檔案的完整原始碼，
 * 動輒數 MB，且每次跑都整份改寫，diff 無法閱讀。
 *
 * Cookbook: ~/offline/clade/vendor/snippets/mutation-testing/README.md
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA_VERSION = '1'

// (killed + timeout) / (killed + timeout + survived + noCoverage)
// CompileError / RuntimeError / Ignored 不計入分母——它們不代表測試的敏感度
const KILLED_STATUSES = new Set(['Killed', 'Timeout'])
const MISSED_STATUSES = new Set(['Survived', 'NoCoverage'])

function parseArgs(argv) {
  const args = { in: 'reports/mutation/mutation.json', out: '.clade/mutation-summary.json' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') args.in = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
  }
  return args
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`[mutation-summary] 找不到 ${what}：${path}`)
      console.error('[mutation-summary] 先跑 `stryker run` 產生報告，或用 --in 指定路徑。')
      process.exit(1)
    }
    console.error(`[mutation-summary] ${what} 解析失敗：${path}\n${err.message}`)
    process.exit(1)
  }
}

function commitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], // 吞掉 git 的 "not a git repository" 噪音
    }).trim()
  } catch {
    return null // 不在 git repo 或 git 不可用——audit 端會標為 freshness unknown
  }
}

function emptyTally() {
  return { killed: 0, survived: 0, timeout: 0, noCoverage: 0, ignored: 0, error: 0 }
}

function tally(bucket, status) {
  if (status === 'Killed') bucket.killed += 1
  else if (status === 'Survived') bucket.survived += 1
  else if (status === 'Timeout') bucket.timeout += 1
  else if (status === 'NoCoverage') bucket.noCoverage += 1
  else if (status === 'Ignored') bucket.ignored += 1
  else bucket.error += 1 // CompileError / RuntimeError / Pending
}

function score(bucket) {
  const killed = bucket.killed + bucket.timeout
  const denominator = killed + bucket.survived + bucket.noCoverage
  if (denominator === 0) return null // 沒有可評分的突變體——不是 0 分，是無資訊
  return Math.round((killed / denominator) * 1000) / 10
}

/**
 * 只看「測試有覆蓋到」的突變體（分母排除 noCoverage）。
 *
 * 為什麼兩個分數都要輸出：分數低有兩種完全相反的成因，單一數字分不出來——
 *   noCoverage 高 → 那段 code 根本沒被測到，要補的是**覆蓋範圍**
 *   survived 高   → 測到了但抓不到錯，要補的是 **assertion 強度**
 * 實測（2026-08-04）perno 44.1% / covered 78.1%（noCoverage 74）與
 * sroi 51.4% / covered 58.2%（survived 38）就是這兩型，行動完全不同。
 */
function coveredScore(bucket) {
  const killed = bucket.killed + bucket.timeout
  const denominator = killed + bucket.survived
  if (denominator === 0) return null
  return Math.round((killed / denominator) * 1000) / 10
}

const args = parseArgs(process.argv.slice(2))
const report = readJson(args.in, 'Stryker 報告')

if (!report.files || typeof report.files !== 'object') {
  console.error(`[mutation-summary] ${args.in} 沒有 files 欄位——這不像 Stryker 的 json reporter 輸出。`)
  process.exit(1)
}

const totals = emptyTally()
const byMutator = {}

for (const file of Object.values(report.files)) {
  for (const mutant of file.mutants ?? []) {
    tally(totals, mutant.status)
    const name = mutant.mutatorName ?? 'Unknown'
    byMutator[name] ??= emptyTally()
    tally(byMutator[name], mutant.status)
  }
}

// scope 從 stryker config 讀回來，讓 audit 能驗「宣告的範圍」vs「實際跑的範圍」
let scope = null
try {
  // NEVER 用 readJson()——它在 ENOENT 時 process.exit(1)，try/catch 攔不到。
  // config 是選用的（可能叫別的名字、或走純 CLI flags），讀不到要能繼續。
  scope = JSON.parse(readFileSync('stryker.config.json', 'utf8')).mutate ?? null
} catch {
  // scope 留 null，audit 端標 unknown
}

const summary = {
  schema_version: SCHEMA_VERSION,
  generated_at: new Date().toISOString(),
  commit_sha: commitSha(),
  scope,
  mutation_score: score(totals),
  mutation_score_covered: coveredScore(totals),
  totals,
  by_mutator: byMutator,
  thresholds: report.thresholds ?? null,
}

mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`)

const s = summary.mutation_score
const sc = summary.mutation_score_covered
console.log(`[mutation-summary] → ${args.out}`)
console.log(`[mutation-summary] score=${s === null ? 'n/a（無可評分突變體）' : `${s}%`} killed=${totals.killed} survived=${totals.survived} noCoverage=${totals.noCoverage}`)

// 兩個分數差距大 = 問題出在覆蓋範圍而非 assertion 強度，兩者的修法相反
if (s !== null && sc !== null && sc - s >= 10) {
  console.log(`[mutation-summary] covered-only score=${sc}%（差 ${Math.round((sc - s) * 10) / 10} 個百分點）`)
  console.log(`[mutation-summary]    → 低分主因是 ${totals.noCoverage} 個 noCoverage，不是測試不敏感。`)
  console.log('[mutation-summary]    要補的是「覆蓋範圍」（測試沒碰到那段 code），不是 assertion 強度。')
  console.log('[mutation-summary]    考慮把沒覆蓋的檔移出 mutate，並登記「該檔缺測試」。')
}

// timeout 算進 mutation score 的分子（Stryker 視為 detected）。機器被搶光時測試會因為
// 排不到 CPU 而超時，那些偽 timeout 會讓分數虛高，且從 survived 數字看不出來。
const detected = totals.killed + totals.timeout
if (totals.timeout > 0 && totals.timeout > detected * 0.1) {
  const pct = Math.round((totals.timeout / detected) * 100)
  console.log(`[mutation-summary] ⚠️  timeout 佔 detected 的 ${pct}% —— timeout 算進 killed，這個比例下分數會虛高。`)
  console.log('[mutation-summary]    確認跑的當下機器沒被佔滿（NEVER 多個 repo 同時跑 Stryker），必要時重跑。')
}

if (totals.survived > 0) {
  const worst = Object.entries(byMutator)
    .filter(([, b]) => b.survived > 0)
    .sort((a, b) => b[1].survived - a[1].survived)
    .slice(0, 3)
    .map(([name, b]) => `${name}(${b.survived})`)
    .join(' ')
  console.log(`[mutation-summary] 存活最多的 mutator：${worst}`)
  console.log('[mutation-summary] EqualityOperator / ConditionalExpression 的存活體優先看——那是沒被釘住的邊界。')
}
