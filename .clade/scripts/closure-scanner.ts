// 🔒 LOCKED — managed by clade · Source: vendor/scripts/closure-scanner.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/closure-scanner.ts
// clade improvement-loop: four-layer closure scanner.
//
// Reads candidates (DIG-<hash> records emitted by improvement-digest.ts) and
// produces closure outcomes via four mechanisms, in descending confidence:
//
//   1. Explicit closure — commit / spectra change / TD / PR references "DIG-<hash>".
//   2. State closure    — current repo state satisfies the candidate's evidence
//                          predicate `expected_state` assertions.
//   3. Diff closure     — commits after the candidate's emission touch
//                          `target_paths` AND the diff matches `related_keywords`.
//   4. Superseded       — `target_paths` modified but `expected_state` still fails;
//                          recorded as `superseded-inferred`, NOT counted as closure.
//
// Diff-touch without keyword match is recorded as `touched-not-closed` and MUST
// NOT count as closure (per spec Requirement: four-layer closure inference).
//
// Append-only contract: outcomes are appended to vendor/ledger/outcomes.jsonl.
// candidates.jsonl is the immutable history of candidate emissions.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getTechDebtStatus, isClosedStatus } from './tech-debt-status.ts'

const CLADE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

interface ClosureOptions {
  repoRoot?: string
  since?: string
  explicitRefs?: Map<string, string[]>
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

export function readJsonl(path) {
  if (!existsSync(path)) return []
  const out = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t))
    } catch {}
  }
  return out
}

function findDigReferencesInGit(cwd, since) {
  const sinceArg = since ? [`--since=${since}`] : []
  const log = gitSafe(['log', ...sinceArg, '--pretty=format:%H%x09%s%x09%b'], cwd)
  if (!log) return new Map()
  const refs = new Map()
  for (const line of log.split('\n')) {
    const [sha, ...rest] = line.split('\t')
    if (!sha) continue
    const text = rest.join(' ')
    for (const m of text.matchAll(/\bDIG-[0-9a-f]{12}\b/g)) {
      const id = m[0]
      if (!refs.has(id)) refs.set(id, [])
      refs.get(id).push(sha)
    }
  }
  return refs
}

function evaluateStatePredicate(candidate, repoRoot) {
  const ep = candidate.evidence_predicate
  if (!ep?.expected_state?.length) return { satisfied: false, reason: 'no-expected-state' }
  for (const assertion of ep.expected_state) {
    if (assertion.kind === 'absent-after-fix') {
      // Best-effort: we cannot evaluate this without re-running the digest. Skip.
      return { satisfied: false, reason: 'requires-digest-rerun' }
    }
    if (assertion.kind === 'tech-debt-closed') {
      const td = candidate.source_id
      if (!td) return { satisfied: false, reason: 'no-source-id' }
      const tdFile = resolve(repoRoot, 'docs', 'tech-debt.md')
      if (!existsSync(tdFile)) return { satisfied: true, reason: 'tech-debt-file-missing' }
      const body = readFileSync(tdFile, 'utf8')
      if (
        !body.includes(`## ${td} `) &&
        !body.includes(`## ${td}\n`) &&
        !body.includes(`## ${td} —`)
      ) {
        return { satisfied: true, reason: 'tech-debt-entry-removed' }
      }
      // The candidate's expected_state is "marked closed OR removed". Clade
      // convention keeps closed TDs in-file with a flipped `**Status**:` (done /
      // resolved / wontfix / closed) as history rather than deleting them, so an
      // entry that is still present but Status-closed is closed too. Without this
      // the state layer mis-flags every normally-closed TD as still-open.
      if (isClosedStatus(getTechDebtStatus(body, td))) {
        return { satisfied: true, reason: 'tech-debt-status-closed' }
      }
      return { satisfied: false, reason: 'tech-debt-still-present' }
    }
    if (assertion.kind === 'path-contains') {
      const target = resolve(repoRoot, assertion.path)
      if (!existsSync(target)) return { satisfied: false, reason: 'path-missing' }
      const content = readFileSync(target, 'utf8')
      if (!content.includes(assertion.pattern))
        return { satisfied: false, reason: 'pattern-not-found' }
    }
    if (assertion.kind === 'path-absent') {
      const target = resolve(repoRoot, assertion.path)
      if (existsSync(target)) return { satisfied: false, reason: 'path-still-exists' }
    }
  }
  return { satisfied: true, reason: 'all-assertions-passed' }
}

function findDiffClosure(candidate, repoRoot, sinceIso) {
  const ep = candidate.evidence_predicate
  if (!ep?.target_paths?.length) return { layer: 'none', reason: 'no-target-paths' }
  const sinceArg = sinceIso ? [`--since=${sinceIso}`] : []
  const log = gitSafe(['log', ...sinceArg, '--name-only', '--pretty=format:%H%x09'], repoRoot)
  if (!log) return { layer: 'none', reason: 'no-commits' }
  const commitsTouching = []
  let currentSha = null
  for (const line of log.split('\n')) {
    if (line.endsWith('\t')) {
      currentSha = line.split('\t')[0]
      continue
    }
    if (!currentSha || !line.trim()) continue
    const touchedFile = line.trim()
    for (const target of ep.target_paths) {
      if (
        touchedFile === target ||
        touchedFile.endsWith('/' + target) ||
        target.endsWith('/' + touchedFile)
      ) {
        commitsTouching.push({ sha: currentSha, file: touchedFile })
      }
    }
  }
  if (commitsTouching.length === 0) return { layer: 'none', reason: 'no-target-path-touched' }
  if (!ep.related_keywords?.length)
    return {
      layer: 'touched-not-closed',
      reason: 'no-keywords-to-match',
      commits: commitsTouching.slice(0, 3),
    }
  for (const { sha } of commitsTouching) {
    const diff = gitSafe(['show', '--unified=0', '--no-color', sha], repoRoot)
    for (const kw of ep.related_keywords) {
      if (kw.length < 4) continue
      if (diff.includes(kw)) {
        return { layer: 'diff', reason: 'keyword-matched', sha, keyword: kw }
      }
    }
  }
  return {
    layer: 'touched-not-closed',
    reason: 'no-keyword-match',
    commits: commitsTouching.slice(0, 3),
  }
}

export function inferClosure(
  candidate,
  { repoRoot = CLADE_ROOT, since = '90 days ago', explicitRefs }: ClosureOptions = {},
) {
  if (explicitRefs?.has(candidate.id)) {
    return {
      id: candidate.id,
      layer: 'explicit',
      closed: true,
      evidence: { commits: explicitRefs.get(candidate.id) },
    }
  }
  const state = evaluateStatePredicate(candidate, repoRoot)
  if (state.satisfied) {
    return { id: candidate.id, layer: 'state', closed: true, evidence: { reason: state.reason } }
  }
  const sinceIso = sinceForGit(since)
  const diff = findDiffClosure(candidate, repoRoot, sinceIso)
  if (diff.layer === 'diff') {
    return { id: candidate.id, layer: 'diff', closed: true, evidence: diff }
  }
  if (diff.layer === 'touched-not-closed') {
    return { id: candidate.id, layer: 'touched-not-closed', closed: false, evidence: diff }
  }
  return {
    id: candidate.id,
    layer: 'none',
    closed: false,
    evidence: { reason: 'no-closure-signal' },
  }
}

function sinceForGit(s) {
  if (!s) return ''
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s
  return s
}

export function inferAllClosures(candidates, options: ClosureOptions = {}) {
  const repoRoot = options.repoRoot ?? CLADE_ROOT
  const explicitRefs = options.explicitRefs ?? findDigReferencesInGit(repoRoot, options.since)
  const now = new Date().toISOString()
  return candidates.map((c) => ({
    ...inferClosure(c, { repoRoot, since: options.since, explicitRefs }),
    inferred_at: now,
  }))
}

const INSUFFICIENT_DATA_MIN_CANDIDATES = 5
const INSUFFICIENT_DATA_MIN_AGE_DAYS = 7

export function computeLayeredMetrics({ candidates, outcomes, now = new Date() }) {
  if (candidates.length < INSUFFICIENT_DATA_MIN_CANDIDATES) {
    return blankMetrics('insufficient data')
  }
  const oldestCandidate = candidates.reduce((min, c) => {
    const t = c.emitted_at ?? c.first_seen ?? null
    if (!t) return min
    return min === null || t < min ? t : min
  }, null)
  if (oldestCandidate) {
    const ageDays = (now.getTime() - new Date(oldestCandidate).getTime()) / 86_400_000
    if (ageDays < INSUFFICIENT_DATA_MIN_AGE_DAYS) return blankMetrics('insufficient data')
  }

  const latestByDig = new Map()
  for (const o of outcomes) {
    const prev = latestByDig.get(o.id)
    if (!prev || (o.inferred_at && o.inferred_at > prev.inferred_at)) latestByDig.set(o.id, o)
  }
  let explicit = 0,
    inferred = 0,
    realized = 0
  for (const c of candidates) {
    const o = latestByDig.get(c.id)
    if (!o) continue
    if (o.layer === 'explicit') {
      explicit++
      realized++
      continue
    }
    if (o.layer === 'state' || o.layer === 'diff') {
      inferred++
      realized++
    }
  }
  const reopened = countStaleReopens(outcomes)
  const closed = explicit + inferred
  const total = candidates.length

  return {
    explicit_close_rate: pct(explicit, total),
    inferred_close_rate: pct(inferred, total),
    artifact_realization_rate: pct(realized, total),
    stale_reopen_rate: closed > 0 ? pct(reopened, closed) : '0.00',
    false_positive_rate_from_manual_review: countManualFalsePositives(outcomes, total),
  }
}

function blankMetrics(label) {
  return {
    explicit_close_rate: label,
    inferred_close_rate: label,
    artifact_realization_rate: label,
    stale_reopen_rate: label,
    false_positive_rate_from_manual_review: label,
  }
}

function pct(n, d) {
  if (d === 0) return '0.00'
  return (n / d).toFixed(2)
}

export function countStaleReopens(outcomes) {
  const byId = new Map()
  for (const o of outcomes) {
    if (!byId.has(o.id)) byId.set(o.id, [])
    byId.get(o.id).push(o)
  }
  let count = 0
  for (const seq of byId.values()) {
    const sorted = seq.toSorted((a, b) => (a.inferred_at ?? '').localeCompare(b.inferred_at ?? ''))
    let everClosed = false
    for (const o of sorted) {
      if (o.closed) everClosed = true
      else if (everClosed && o.layer !== 'touched-not-closed') {
        // a previously-closed candidate now shows no closure → stale-reopen
        count++
        break
      }
    }
  }
  return count
}

function countManualFalsePositives(outcomes, total) {
  const fp = outcomes.filter((o) => o.manual_label === 'false-positive').length
  if (total === 0) return '0.00'
  return pct(fp, total)
}
