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

function buildErrorFingerprint(stderrText, exitCode) {
  if (!stderrText) return `exit:${exitCode}`
  const clean = stripAnsi(stderrText)
  const lines = clean
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return `exit:${exitCode}`
  const errorLine = lines.find((l) => /^(error|fail|✖|×|FAIL|ERROR)/i.test(l)) ?? lines[0]
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

  const child = spawn(realBin, args, { stdio: ['inherit', 'inherit', 'pipe'] })
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
        error_fingerprint: buildErrorFingerprint(stderrText, exitCode),
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
