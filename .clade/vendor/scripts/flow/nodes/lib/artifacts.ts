// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/nodes/lib/artifacts.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/nodes/lib/artifacts.ts
// clade flow spine — span-end artifacts (P2)
//
// What a completed span LEFT BEHIND, as coordinates a successor can act on:
// `{ type, ref, repo? }`, written by the node that produced the thing — NEVER typed by a human
// after the fact. A successor asking "where do I pick this up" gets a commit SHA it can
// `git show`, not a sentence saying a commit happened.
//
// So `ref` MUST be machine-usable, and that is enforced here rather than trusted:
//
//   - `commit` / `propagate` → the full 40-hex SHA. NEVER the 12-char display abbreviation the
//     summary line carries: an abbreviation is for eyes, and the whole point of this field is
//     that nothing has to re-derive it. (An abbreviation also stops being unique as a repo grows,
//     which is the failure that surfaces long after the write.)
//   - `tag` → repo-qualified: the tag alone (`v1.11.91`) names nothing on its own, because every
//     consumer in the fleet has its own tags. `repo` is REQUIRED for this type.
//   - `file` → a repo-relative path. Absolute paths encode one machine's checkout, which is
//     exactly the coordinate a successor on another machine cannot use.
//
// Both ends live here. `artifact()` is the producing end and is deliberately strict; `artifactsOf()`
// is the consuming end (it used to be a private function inside `brief.ts`, and moved here when the
// work layer needed the same aggregation the dossier already did). One module, so the two ends can
// never disagree about what a ref means — NEVER add a third normalisation or a second aggregator.

import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fatal } from './contract.ts'

export const ARTIFACT_TYPES = ['commit', 'tag', 'propagate', 'file', 'url'] as const
export type ArtifactType = (typeof ARTIFACT_TYPES)[number]

export interface Artifact {
  type: ArtifactType
  ref: string
  repo?: string
}

const FULL_SHA = /^[0-9a-f]{40}$/

/**
 * Build one artifact, refusing a ref that would not survive the trip to whoever reads it.
 *
 * Refusal is a FATAL rather than a dropped entry: a node that reached the point of recording an
 * artifact already did the work, and silently emitting nothing would leave a span that looks
 * artifact-less — indistinguishable from a node that was never taught to record one.
 */
export function artifact(type: ArtifactType, ref: string, repo?: string | null): Artifact {
  const value = String(ref ?? '').trim()
  if (!ARTIFACT_TYPES.includes(type)) fatal(`unknown artifact type: ${type}`)
  if (!value) fatal(`artifact ${type} has an empty ref`)
  if ((type === 'commit' || type === 'propagate') && !FULL_SHA.test(value)) {
    fatal(
      `artifact ${type} ref must be a full 40-hex SHA (got "${value}") — an abbreviation is a display string, not a coordinate`,
    )
  }
  const owner = String(repo ?? '').trim()
  if (type === 'tag' && !owner) {
    fatal(
      `artifact tag "${value}" needs --repo qualification — a bare tag names nothing in a fleet`,
    )
  }
  if (type === 'file' && value.startsWith('/')) {
    fatal(`artifact file ref must be repo-relative (got absolute "${value}")`)
  }
  // `url` carries the coordinates that live outside any checkout — a PR, a deploy, a dashboard.
  // https only: an `http://` link is a coordinate that a browser will refuse or downgrade, and a
  // bare `github.com/...` is a display string, which is the one thing this field must not become.
  if (type === 'url' && !value.startsWith('https://')) {
    fatal(`artifact url ref must start with https:// (got "${value}")`)
  }
  return owner ? { type, ref: value, repo: owner } : { type, ref: value }
}

/**
 * `owner/repo` for a checkout, from its origin remote. Best-effort: an artifact with no repo
 * qualification is still worth having for the types that do not require one, and a missing
 * remote MUST NEVER take down the node whose work it is describing.
 */
export function repoSlug(repoPath: string): string | null {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: repoPath, encoding: 'utf8' })
  if ((r.status ?? 1) !== 0) return null
  const url = (r.stdout ?? '').trim()
  const match = /(?:[:/])([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url)
  return match ? match[1] : null
}

/**
 * Keep only the entries that still parse as artifacts, for the READ side (the engine folding a
 * node's `--json` into a span payload). Fail-open here on purpose: telemetry NEVER outranks the
 * thing being instrumented, and by this point the node has already exited 0. The strict half is
 * `artifact()` above, which runs inside the node where a bad ref is still fixable.
 */
export function normalizeArtifacts(raw: unknown): Artifact[] {
  if (!Array.isArray(raw)) return []
  const out: Artifact[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const type = String(item.type ?? '')
    const ref = String(item.ref ?? '').trim()
    if (!ref || !ARTIFACT_TYPES.includes(type as ArtifactType)) continue
    const repo = String(item.repo ?? '').trim()
    out.push({ type: type as ArtifactType, ref, ...(repo ? { repo } : {}) })
  }
  return out
}

/**
 * What a release left behind: its tag and its release commit, read back off git.
 *
 * Read back rather than scraped out of `publish.ts`'s log — that script's output changes every
 * few versions, and a scraped string is a display artifact, the one thing this field must not be.
 * Best-effort: publish already succeeded by the time this runs, and a missing coordinate NEVER
 * turns a delivered release into a failed node. An unqualified tag is SKIPPED rather than
 * recorded, because every consumer in the fleet has its own `v1.2.3`.
 */
export function releaseArtifacts(repo: string): Artifact[] {
  const repoId = repoSlug(repo)
  const out: Artifact[] = []
  const tag = git(repo, ['describe', '--tags', '--abbrev=0'])
  if (tag && repoId) out.push(artifact('tag', tag, repoId))
  const head = git(repo, ['rev-parse', 'HEAD'])
  if (head && FULL_SHA.test(head)) out.push(artifact('commit', head, repoId))
  return out
}

function git(repo: string, args: string[]): string | null {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  if ((r.status ?? 1) !== 0) return null
  const value = (r.stdout ?? '').trim()
  return value.length > 0 ? value : null
}

/** The version `propagate` was just asked to deliver, per `.claude-plugin/marketplace.json`. */
export function cladeVersion(repo: string): string | null {
  try {
    const raw = readFileSync(join(repo, '.claude-plugin', 'marketplace.json'), 'utf8')
    const version = (JSON.parse(raw) as { metadata?: { version?: string } }).metadata?.version
    return typeof version === 'string' && version.length > 0 ? version : null
  } catch {
    return null
  }
}

interface JournalEntry {
  consumer?: string
  status?: string
  commitSha?: string | null
}

/**
 * One `propagate` artifact per consumer the delivery reached, out of the journal `propagate.ts`
 * already writes (`.git/.clade-propagate/v<version>/<consumer>.json`).
 *
 * The journal, never the log: it is the same record `--resume` trusts, so an artifact scraped
 * from prose would be a second, weaker copy of the truth. Entries with no commit SHA are skipped
 * — a consumer with no coordinate has nothing to hand a successor, and a placeholder would be
 * exactly the display string this field exists to keep out.
 */
export function journalArtifacts(repo: string): Artifact[] {
  const version = cladeVersion(repo)
  if (!version) return []
  const dir = join(repo, '.git', '.clade-propagate', `v${version}`)
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out: Artifact[] = []
  for (const file of files.toSorted()) {
    let entry: JournalEntry
    try {
      entry = JSON.parse(readFileSync(join(dir, file), 'utf8')) as JournalEntry
    } catch {
      continue
    }
    const sha = String(entry.commitSha ?? '').trim()
    if (!FULL_SHA.test(sha)) continue
    // `repo` falls back to the journal's own short consumer name: it is not `owner/repo`, but a
    // coordinate that cannot say WHICH consumer it landed in is not usable by a successor either.
    const consumerRepo = entry.consumer ? repoSlug(entry.consumer) : null
    out.push(artifact('propagate', sha, consumerRepo ?? file.replace(/\.json$/, '')))
  }
  return out
}

/**
 * What one span RECORDED it left behind, as it sits on the stream.
 *
 * Looser than `Artifact` on purpose, and the looseness is a fact about the data rather than a
 * convenience: this reads an append-only stream whose oldest entries predate every constraint
 * above, so a `type` that is no longer in `ARTIFACT_TYPES` is history, not a bug to null out. The
 * strict half runs at the WRITE end (`artifact()`), where a bad ref is still fixable.
 */
export interface SpanArtifact {
  type: string
  ref: string
  repo?: string
}

/**
 * Every artifact carried by a set of spans, in span order.
 *
 * MOVED here from `brief.ts`, where it was private, when the work layer needed the same list the
 * dossier had been rendering all along. Behaviour is unchanged BY DESIGN — a fold that dropped
 * unrecognised types would quietly shorten dossiers that have been correct for weeks, and this
 * function's job is to report what the stream says, not to re-litigate it.
 *
 * Takes a structural shape rather than `Span` so the spine can call it without a module cycle.
 */
export function artifactsOf(
  spans: readonly { payload?: Record<string, unknown> }[],
): SpanArtifact[] {
  const out: SpanArtifact[] = []
  for (const s of spans) {
    const list = s.payload?.artifacts
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const ref = nonEmpty(item.ref)
      if (!ref) continue
      out.push({
        type: nonEmpty(item.type) ?? 'file',
        ref,
        ...(nonEmpty(item.repo) ? { repo: nonEmpty(item.repo) as string } : {}),
      })
    }
  }
  return out
}

/** `<type>:<ref>[@<repo>]` — the identity two copies of the same artifact share. */
export function artifactKey(a: SpanArtifact): string {
  return `${a.type}:${a.ref}${a.repo ? `@${a.repo}` : ''}`
}

/** Same list, first sighting of each artifact kept. Order is the evidence trail, so it is preserved. */
export function dedupeArtifacts(list: readonly SpanArtifact[]): SpanArtifact[] {
  const seen = new Set<string>()
  const out: SpanArtifact[] = []
  for (const a of list) {
    const key = artifactKey(a)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
