// clade improvement-loop shim core
//
// Shared implementation for same-name PATH shims (bin/vp, bin/clade-gate, future
// shims for other first-party gates). Spawns the real binary, tees stderr so the
// user sees output verbatim while we capture a redaction-safe head for the signal
// fingerprint, then emits a signal record on non-zero exit.
//
// Transparency contract:
//   - exit code preserved
//   - stdout / stderr forwarded byte-identically to parent
//   - stdin inherited
//   - signal capture is best-effort; any error is logged to stderr and never
//     altered the child's exit semantics
//
// CLADE_IMPROVEMENT_LOOP_OFF=1 disables capture entirely.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

import { redactString } from './redact.mjs'
import { appendRecord } from './ledger-writer.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLADE_ROOT = resolve(__dirname, '..', '..')

const STDERR_CAPTURE_BYTES = 2048

function findRealBinary(name, shimAbsPath) {
  const shimDir = resolve(dirname(shimAbsPath))
  const pathDirs = (process.env.PATH ?? '').split(':')
  for (const dir of pathDirs) {
    if (!dir) continue
    const dirAbs = resolve(dir)
    if (dirAbs === shimDir) continue
    const candidate = join(dirAbs, name)
    try {
      const st = statSync(candidate)
      if (st.isFile() && st.mode & 0o111) {
        if (resolve(candidate) === shimAbsPath) continue
        return candidate
      }
    } catch {}
  }
  return null
}

function gitSafe(args, cwd) {
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

function detectConsumer(cwd) {
  try {
    const registryPath = join(CLADE_ROOT, 'registry', 'consumers.json')
    if (!existsSync(registryPath)) return { consumer_id: 'unknown', repo_id: 'unknown/unknown' }
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
    const gitTop = gitSafe(['rev-parse', '--show-toplevel'], cwd) || cwd
    const gitTopReal = resolve(gitTop)
    if (gitTopReal === resolve(CLADE_ROOT)) {
      const entry = registry.consumers.find((c) => c.consumer_id === 'clade')
      if (entry) return entry
    }
    const originUrl = gitSafe(['config', '--get', 'remote.origin.url'], cwd)
    if (originUrl) {
      const repoMatch = originUrl.match(/[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/)
      if (repoMatch) {
        const repoId = repoMatch[1]
        const entry = registry.consumers.find((c) => c.repo_id === repoId)
        if (entry) return entry
      }
    }
    return { consumer_id: 'unknown', repo_id: 'unknown/unknown' }
  } catch {
    return { consumer_id: 'unknown', repo_id: 'unknown/unknown' }
  }
}

function detectCommitSha(cwd) {
  return gitSafe(['rev-parse', '--short', 'HEAD'], cwd) || 'unknown'
}

function detectBranch(cwd) {
  return gitSafe(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || 'unknown'
}

function buildCommandFingerprint(binName, args) {
  const normalized = args.map((a) => {
    if (a.includes(sep)) return redactString(a).replace(/.*\//, '*/')
    return a
  })
  return [binName, ...normalized].join(':')
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
}

export function buildErrorFingerprint(stderrText, exitCode, fullText = '') {
  // TS 診斷優先：vue-tsc / nuxt typecheck 把錯誤印在 stdout 且行首是檔案路徑
  // （不以 error 開頭），舊邏輯永遠 fallback 到 pnpm 的通用 exit 行 → 跨 consumer
  // 各種不相干紅燈聚成同一 pattern（DIG-4f7343a79acf 根因）。只取 error code
  // 統計（純 TS\d+ 無路徑無識別字）— redaction-safe by construction。
  const tsCodes = stripAnsi(fullText || stderrText || '').match(/error (TS\d+)/g)
  if (tsCodes && tsCodes.length > 0) {
    // 只取 distinct code 集合、按 code 字母序排——**不含出現次數**。
    //
    // 早期版本回 `TS2322x3,TS2339x2`，把「該次 run 該碼出現幾次」烤進身分字串。
    // 後果：同一批型別債務只要錯誤數增減一個就變成「全新」pattern，永遠對不上舊
    // fingerprint，closure 推斷因此結構性失敗。2026-07-25 digest 實證——`ts:TS2322`
    // 的 x1/x2/x3/x4 與 `ts:TS2304` 的 x1/x2/x12 各自獨立成候選，25 條 candidate
    // 背後其實只有 3-4 個真實 pattern。
    //
    // 排序基準同時要換掉：舊版依 count 降序取 top 3，count 波動會改變「哪三個入選」
    // 與「排列順序」，光拿掉 `x{n}` 仍不穩定。改字母序後，fingerprint 只在**錯誤碼
    // 種類集合**變動時才變——那本來就是不同 pattern。
    //
    // 真實出現次數由 signal record 的 occurrences 欄位獨立記錄，不需疊在身分上。
    const codes = [...new Set(tsCodes.map((m) => m.slice('error '.length)))].toSorted()
    return `ts:${codes.slice(0, 3).join(',')}`
  }
  // 通用萃取：找以 error/fail 開頭的行。vitest 等把實際 FAIL 印在 stdout，卻把
  // coverage 版本不符 banner（`Loaded vitest@x and @vitest/coverage-v8@y`）印在
  // stderr → 舊邏輯只看 stderr、找不到 error 行就 fallback 到 stderr 第一行＝banner，
  // 把不相干 test 紅燈全聚成同一假 fingerprint（pnpm-test::Loaded… 根因，SWEEP-001）。
  // 修法：(1) stderr 找不到 error 行時改從 fullText（含 stdout）撈；(2) 過濾已知非
  // error 雜訊 banner，避免 fallback 落到資訊行。stderr 已有 error 行的 gate 行為不變。
  // (3) tinyexec 的 "Process exited with non-zero status" 是 wrapper message（nuxt
  // typecheck 經 citty 印到 stderr），把所有不同 module init error 聚成同一假 pattern
  // （DIG-4f7343a79acf 持續未收斂根因之二）。過濾後 fallback 落到更具體的 error 行。
  const ERROR_PREFIX = /^(error|fail|✖|×|FAIL|ERROR)/i
  const isNoise = (l) =>
    /^Loaded\s+vitest@/i.test(l) || /Process exited with non-zero status/i.test(l)
  const toLines = (s) =>
    stripAnsi(s ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !isNoise(l))
  const stderrLines = toLines(stderrText)
  let errorLine = stderrLines.find((l) => ERROR_PREFIX.test(l))
  if (!errorLine && fullText) errorLine = toLines(fullText).find((l) => ERROR_PREFIX.test(l))
  errorLine = errorLine ?? stderrLines[0] ?? toLines(fullText)[0]
  if (!errorLine) return `exit:${exitCode}`
  return redactString(errorLine).slice(0, 200)
}

function severityFor(gateName) {
  if (gateName === 'publish' || gateName === 'propagate' || gateName === 'validate-manifests')
    return 'P1'
  if (gateName === 'pre-commit') return 'P1'
  if (gateName.startsWith('vp-')) return 'P2'
  if (gateName === 'pnpm-test' || gateName === 'pnpm-lint' || gateName === 'pnpm-typecheck')
    return 'P2'
  return 'P2'
}

function classifyGate(binName, args) {
  if (binName === 'vp') {
    const sub = args[0] ?? ''
    if (sub === 'check') return 'vp-check'
    if (sub === 'lint') return 'vp-lint'
    if (sub === 'fmt') return 'vp-fmt'
  }
  if (binName === 'clade-gate') {
    const sub = args[1] ?? args[0] ?? ''
    if (sub === 'test') return 'pnpm-test'
    if (sub === 'lint') return 'pnpm-lint'
    if (sub === 'typecheck') return 'pnpm-typecheck'
  }
  return 'other'
}

function passthroughExec(binName, shimAbsPath) {
  const args = process.argv.slice(2)
  const realBin = findRealBinary(binName, shimAbsPath)
  if (!realBin) {
    process.stderr.write(`[clade improvement-loop] real ${binName} not found; aborting\n`)
    process.exit(127)
  }
  const child = spawn(realBin, args, { stdio: 'inherit' })
  child.on('exit', (code, sig) => process.exit(code ?? (sig ? 128 : 0)))
}

export async function runShim({ binName, shimAbsPath, source = 'shim' }) {
  if (process.env.CLADE_IMPROVEMENT_LOOP_OFF === '1') {
    passthroughExec(binName, shimAbsPath)
    return
  }
  const args = process.argv.slice(2)
  const realBin = findRealBinary(binName, shimAbsPath)
  if (!realBin) {
    process.stderr.write(`[clade improvement-loop] real ${binName} not found in PATH; aborting\n`)
    process.exit(127)
  }

  const cwd = process.cwd()
  const stderrChunks = []
  let stderrLen = 0
  // stdout 也 bounded capture（passthrough 不影響可見輸出）— 只餵
  // buildErrorFingerprint 萃取 TS error code，原始行永不入 ledger。
  // 代價：child 的 process.stdout.isTTY 變 false（gate 命令輸出格式差異可接受）。
  const stdoutChunks = []
  let stdoutLen = 0

  const child = spawn(realBin, args, { stdio: ['inherit', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    if (stdoutLen < STDERR_CAPTURE_BYTES) {
      const room = STDERR_CAPTURE_BYTES - stdoutLen
      stdoutChunks.push(chunk.slice(0, room))
      stdoutLen += Math.min(room, chunk.length)
    }
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
    if (stderrLen < STDERR_CAPTURE_BYTES) {
      const room = STDERR_CAPTURE_BYTES - stderrLen
      stderrChunks.push(chunk.slice(0, room))
      stderrLen += Math.min(room, chunk.length)
    }
  })

  const exitCode = await new Promise((resolveExit) => {
    child.on('exit', (code, sig) => resolveExit(code ?? (sig ? 128 : 0)))
  })

  const shouldLog = exitCode !== 0 || process.env.CLADE_IMPROVEMENT_LOOP_LOG_ALL === '1'
  if (shouldLog) {
    try {
      const gateName = classifyGate(binName, args)
      const stderrText = Buffer.concat(stderrChunks).toString('utf8')
      const stdoutText = Buffer.concat(stdoutChunks).toString('utf8')
      const consumer = detectConsumer(cwd)
      const record = {
        schema_version: '1',
        consumer_id: consumer.consumer_id ?? 'unknown',
        repo_id: consumer.repo_id ?? 'unknown/unknown',
        event_id: randomUUID(),
        ts_utc: new Date().toISOString(),
        session_id: `${source}-${process.pid}`,
        gate_name: gateName,
        command_fingerprint: buildCommandFingerprint(binName, args),
        error_fingerprint: buildErrorFingerprint(
          stderrText,
          exitCode,
          stdoutText + '\n' + stderrText,
        ),
        severity: exitCode !== 0 ? severityFor(gateName) : 'P2',
        redaction_applied: true,
        source,
        commit_sha: detectCommitSha(cwd),
        branch: detectBranch(cwd),
      }
      appendRecord(record)
    } catch (e) {
      process.stderr.write(`[clade improvement-loop] capture failed: ${e.message}\n`)
    }
  }

  process.exit(exitCode)
}
