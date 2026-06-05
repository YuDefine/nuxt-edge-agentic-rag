#!/usr/bin/env node
// clade improvement-loop: git pre-commit signal adapter.
//
// Called from vendor/git-pre-commit.sh after the hook decides to reject the commit.
// Emits a signal record with gate_name=pre-commit, source=git-hook, and an
// error_fingerprint passed in via argv[2] (defaults to "unknown").
//
// Exit semantics: this adapter ALWAYS exits 0 so the hook's reject decision is
// preserved by the surrounding bash script. Signal capture failures are logged to
// stderr but never alter the hook's own rejection exit code.

import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { appendRecord } from '../signals/ledger-writer.mjs'

const CLADE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

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
    if (resolve(gitTop) === resolve(CLADE_ROOT)) {
      const entry = registry.consumers.find((c) => c.consumer_id === 'clade')
      if (entry) return entry
    }
    const originUrl = gitSafe(['config', '--get', 'remote.origin.url'], cwd)
    if (originUrl) {
      const repoMatch = originUrl.match(/[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/)
      if (repoMatch) {
        const entry = registry.consumers.find((c) => c.repo_id === repoMatch[1])
        if (entry) return entry
      }
    }
    return { consumer_id: 'unknown', repo_id: 'unknown/unknown' }
  } catch {
    return { consumer_id: 'unknown', repo_id: 'unknown/unknown' }
  }
}

const reason = process.argv[2] ?? 'unknown-reject-reason'
const cwd = process.cwd()
const consumer = detectConsumer(cwd)

appendRecord({
  schema_version: '1',
  consumer_id: consumer.consumer_id ?? 'unknown',
  repo_id: consumer.repo_id ?? 'unknown/unknown',
  event_id: randomUUID(),
  ts_utc: new Date().toISOString(),
  session_id: `git-hook-${process.pid}`,
  gate_name: 'pre-commit',
  command_fingerprint: 'git:commit:pre-commit',
  error_fingerprint: reason.slice(0, 200),
  severity: 'P1',
  redaction_applied: true,
  source: 'git-hook',
  commit_sha: gitSafe(['rev-parse', '--short', 'HEAD'], cwd) || 'unknown',
  branch: gitSafe(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || 'unknown',
})

process.exit(0)
