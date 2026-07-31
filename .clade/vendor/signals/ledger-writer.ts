// clade improvement-loop ledger writer
//
// Single-writer guarantee via OS-level advisory lock (atomic lockfile create).
// Used by bin/vp shim, bin/clade-gate wrapper, the git pre-commit signal adapter,
// and any future PostToolUse hook. All persisted records MUST pass through
// appendRecord() so that:
//   1. Schema validation runs (validateRecord).
//   2. Redaction enforcement runs (no record with redaction_applied !== true survives).
//   3. JSONL append happens under exclusive lock so concurrent writers do not interleave.
//
// Fail-open: any persistence error is reported to stderr but does NOT throw to the
// caller. Shims must remain transparent (preserve exit code + stdout/stderr verbatim)
// even when signal capture fails.

import {
  closeSync,
  openSync,
  statSync,
  unlinkSync,
  appendFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { redactPayload, validateRecord } from './redact.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLADE_ROOT = resolve(__dirname, '..', '..')

const STALE_LOCK_MS = 5_000
const MAX_LOCK_RETRIES = 200
const LOCK_RETRY_SLEEP_MS = 10

interface LedgerOptions {
  ledgerPath?: string
  skipSchema?: boolean
}

function defaultLedgerPath() {
  return process.env.CLADE_LEDGER_PATH ?? join(CLADE_ROOT, 'vendor', 'ledger', 'signals.jsonl')
}

function sleepMs(ms) {
  // Synchronous sleep using Atomics.wait on a SharedArrayBuffer — works in Node main
  // thread without spinning the event loop.
  const buf = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(buf), 0, 0, ms)
}

function acquireLock(lockPath) {
  for (let i = 0; i < MAX_LOCK_RETRIES; i++) {
    try {
      const fd = openSync(lockPath, 'wx')
      return fd
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        const st = statSync(lockPath)
        if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
          try {
            unlinkSync(lockPath)
          } catch {}
          continue
        }
      } catch {}
      sleepMs(LOCK_RETRY_SLEEP_MS)
    }
  }
  throw new Error(
    `ledger lock contention: ${lockPath} held > ${(MAX_LOCK_RETRIES * LOCK_RETRY_SLEEP_MS) / 1000}s`,
  )
}

function releaseLock(lockPath, fd) {
  try {
    closeSync(fd)
  } catch {}
  try {
    unlinkSync(lockPath)
  } catch {}
}

export function appendRaw(rawRecord, options: LedgerOptions = {}) {
  const ledgerPath = options.ledgerPath ?? defaultLedgerPath()
  try {
    const dir = dirname(ledgerPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const redacted = redactPayload(rawRecord)

    const lockPath = `${ledgerPath}.lock`
    const fd = acquireLock(lockPath)
    try {
      appendFileSync(ledgerPath, `${JSON.stringify(redacted)}\n`)
      return { written: true, record: redacted }
    } finally {
      releaseLock(lockPath, fd)
    }
  } catch (e) {
    process.stderr.write(`[clade improvement-loop] ledger write failed: ${e.message}\n`)
    return { written: false, errors: [{ code: 'write-failed', message: e.message }] }
  }
}

export function appendRecord(rawRecord, options: LedgerOptions = {}) {
  if (options.skipSchema) return appendRaw(rawRecord, options)
  const ledgerPath = options.ledgerPath ?? defaultLedgerPath()
  try {
    const dir = dirname(ledgerPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const redacted = redactPayload(rawRecord)
    const { ok, errors } = validateRecord(redacted)
    if (!ok) {
      const summary = errors.map((e) => e.code).join(',')
      process.stderr.write(`[clade improvement-loop] signal rejected (${summary})\n`)
      return { written: false, errors }
    }

    const lockPath = `${ledgerPath}.lock`
    const fd = acquireLock(lockPath)
    try {
      appendFileSync(ledgerPath, `${JSON.stringify(redacted)}\n`)
      return { written: true }
    } finally {
      releaseLock(lockPath, fd)
    }
  } catch (e) {
    process.stderr.write(`[clade improvement-loop] signal write failed: ${e.message}\n`)
    return { written: false, errors: [{ code: 'write-failed', message: e.message }] }
  }
}
