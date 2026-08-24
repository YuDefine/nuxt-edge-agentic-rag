// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/viz-md.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/viz-md.ts
// clade flow spine — persisted views (P2)
//
// `flow viz timeline` is live and ephemeral; this is the durable face: a git-tracked markdown file
// per work item under docs/flow/, plus the fleet wave view. Both are pure projections of data that
// already exists — the spine for work items, the frozen propagate-performance ledger for the fleet.
// NEVER add a store to make a view easier: a view that owns data is a second source of truth.
//
// Output is deterministic. The same input renders byte-identical output, with no "generated at"
// stamp, because these files are committed and a timestamp would make every regeneration a diff.

import { existsSync, readFileSync } from 'node:fs'

import { childrenOf, rootsOf, type Span } from './spine.ts'

const OUTCOME_CLASS: Record<string, string> = {
  ok: 'ok',
  fail: 'fail',
  blocked: 'blocked',
  skipped: 'skipped',
}

/**
 * Mermaid node ids must be identifier-shaped, and they must be the WHOLE span id: a shortened one
 * reads fine until two spans share a prefix, at which point mermaid silently merges them into one
 * node and the graph shows a run that never happened.
 */
function nodeId(span: Span): string {
  return `s${span.span_id}`
}

/** Quoted mermaid labels still choke on a literal quote; nothing else needs escaping. */
function label(text: string): string {
  return text.replace(/"/g, "'")
}

function spanLabel(span: Span): string {
  const name = [span.substrate, span.kind].join(':')
  const detail = span.payload?.label ?? span.payload?.node ?? span.payload?.slug
  const suffix = typeof detail === 'string' && detail.length > 0 ? `<br/>${detail}` : ''
  return label(`${name}${suffix}`)
}

function stateOf(span: Span): string {
  if (!span.end_ts) return 'inflight'
  return OUTCOME_CLASS[span.outcome ?? ''] ?? 'skipped'
}

/** Mermaid gantt splits fields on `:`, so a task name must never contain one. */
function ganttName(span: Span): string {
  return spanLabel(span)
    .replace(/<br\/>/g, ' ')
    .replaceAll(':', '/')
    .replaceAll(',', ' ')
}

function ganttStamp(ts: string): string {
  return ts.slice(0, 19)
}

export function renderSpanGraph(spans: Span[]): string {
  const lines = ['```mermaid', 'graph TD']
  const emit = (span: Span) => {
    lines.push(`  ${nodeId(span)}["${spanLabel(span)}"]:::${stateOf(span)}`)
    for (const child of childrenOf(spans, span.span_id)) {
      lines.push(`  ${nodeId(span)} --> ${nodeId(child)}`)
      emit(child)
    }
  }
  for (const root of rootsOf(spans)) emit(root)
  lines.push(
    '  classDef ok fill:#d7f5dd,stroke:#2e7d4f',
    '  classDef fail fill:#fadbd8,stroke:#c0392b',
    '  classDef blocked fill:#fdf0c8,stroke:#b8860b',
    '  classDef skipped fill:#eceff1,stroke:#78909c',
    '  classDef inflight fill:#dbe9fa,stroke:#2f6fb0,stroke-dasharray: 4 3',
    '```',
  )
  return lines.join('\n')
}

export function renderGantt(spans: Span[]): string {
  const timed = spans.filter((s) => s.start_ts && !s.is_point)
  if (timed.length === 0) return ''
  const lines = [
    '```mermaid',
    'gantt',
    '  dateFormat YYYY-MM-DDTHH:mm:ss',
    '  axisFormat %H:%M:%S',
    '  title span waterfall',
  ]
  let section = ''
  for (const span of timed) {
    if (span.substrate !== section) {
      section = span.substrate
      lines.push(`  section ${section}`)
    }
    const start = ganttStamp(span.start_ts as string)
    // An in-flight span has no end. Mermaid needs one, so it gets its start plus a nominal minute
    // and a `crit` marker — the row says "still open", it does not invent a duration.
    const end = span.end_ts ? ganttStamp(span.end_ts) : null
    const tag = !span.end_ts ? 'crit, ' : span.outcome === 'fail' ? 'crit, ' : 'active, '
    lines.push(`  ${ganttName(span)} :${tag}${nodeId(span)}, ${start}, ${end ?? '1m'}`)
  }
  lines.push('```')
  return lines.join('\n')
}

function durationCell(span: Span): string {
  if (!span.end_ts) return 'in-flight'
  if (span.duration_ms === null) return '—'
  return span.duration_ms >= 1000
    ? `${(span.duration_ms / 1000).toFixed(1)}s`
    : `${span.duration_ms}ms`
}

export function renderWorkMarkdown(workId: string, spans: Span[]): string {
  const first = spans.find((s) => s.start_ts)?.start_ts ?? '—'
  const last = spans.reduce((acc, s) => {
    const ts = s.end_ts ?? s.start_ts ?? ''
    return ts > acc ? ts : acc
  }, '')
  const inFlight = spans.filter((s) => !s.end_ts && !s.is_point).length
  const failed = spans.filter((s) => s.outcome === 'fail').length

  const rows = spans.map((s) => {
    const state = !s.end_ts ? 'in-flight' : (s.outcome ?? '—')
    return `| ${s.substrate} | ${s.kind} | ${label(s.actor)} | ${state} | ${durationCell(s)} | \`${s.span_id}\` |`
  })

  const gantt = renderGantt(spans)

  return `${[
    `# ${workId}`,
    '',
    `Projection of \`.clade/flow/events.jsonl\` — regenerate with \`flow viz --md ${workId}\`.`,
    'Never edit by hand: the spine is the source, this file is the face.',
    '',
    `- spans: ${spans.length} (in-flight ${inFlight}, failed ${failed})`,
    `- first event: ${first}`,
    `- last event: ${last || '—'}`,
    '',
    '## Run graph',
    '',
    renderSpanGraph(spans),
    ...(gantt ? ['', '## Waterfall', '', gantt] : []),
    '',
    '## Spans',
    '',
    '| substrate | kind | actor | outcome | duration | span |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')}\n`
}

// ---------------------------------------------------------------------------
// Fleet wave view
// ---------------------------------------------------------------------------

export interface WaveConsumer {
  consumer: string
  status: string
  error: string | null
}

export interface Wave {
  run_id: string
  version: string
  started_at: string
  consumers: WaveConsumer[]
}

/**
 * Read the propagate-performance ledger. Its schema is frozen (§3 of the flow-spine plan): this is
 * a reader, never a writer, and the file it reads is one of the four legacy ledgers the spine tees
 * from rather than replaces.
 */
export function readWaves(path: string, limit = 6): Wave[] {
  if (!existsSync(path)) return []
  const waves: Wave[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const run = JSON.parse(line)
      if (!run?.version || !Array.isArray(run.consumers)) continue
      waves.push({
        run_id: String(run.run_id ?? ''),
        version: String(run.version),
        started_at: String(run.started_at ?? ''),
        consumers: run.consumers.map((c) => ({
          consumer: String(c.consumer ?? ''),
          status: String(c.status ?? 'unknown'),
          error: c.error ? String(c.error) : null,
        })),
      })
    } catch {
      // A malformed line is a line, not a reason to fail a read-only view.
    }
  }
  return waves.slice(-limit)
}

/** Ledger records carry absolute paths; prefer the registry id when one matches. */
export function consumerName(path: string, ids: string[]): string {
  const match = ids.find((id) => path.endsWith(`/${id}`))
  if (match) return match
  const parts = path.split('/').filter(Boolean)
  return parts.slice(-2).join('/') || path
}

/**
 * Edge style by materialization status. Keys are the ledger's own spelling — `push-withheld`,
 * hyphen and all — because a table that quietly normalized them would stop matching the day
 * propagate adds a status, and the fallback would hide it rather than show it.
 */
const STATUS_EDGE: Record<string, string> = {
  bumped: '==>',
  'bumped-local': '==>',
  bumped_local: '==>',
  skipped: '-.->',
  failed: '-->',
  'push-withheld': '-->',
  'push-unconfirmed': '-->',
}

/** Mermaid class names are identifier-shaped; the ledger's statuses are not. */
function statusClass(status: string): string {
  return `st_${status.replace(/[^A-Za-z0-9]/g, '_')}`
}

export function renderFleetMarkdown(waves: Wave[], consumerIds: string[]): string {
  if (waves.length === 0) {
    return '# clade fleet waves\n\nNo propagate runs on `.clade/metrics/propagate-performance.jsonl`.\n'
  }
  const latest = waves[waves.length - 1]
  const names = new Set<string>()
  for (const wave of waves) {
    for (const c of wave.consumers) names.add(consumerName(c.consumer, consumerIds))
  }
  const ordered = [...names].toSorted()

  // Asset lineage, not a task sequence: an edge exists only because the ledger recorded that this
  // version was actually materialized into that consumer. There is nowhere to declare a dependency,
  // so a fake edge cannot be drawn — that structural property is the whole point of the shape.
  const graph = ['```mermaid', 'graph LR', `  V["clade ${latest.version}"]:::version`]
  for (const c of latest.consumers) {
    const name = consumerName(c.consumer, consumerIds)
    const arrow = STATUS_EDGE[c.status] ?? '-->'
    graph.push(
      `  V ${arrow}|${c.status}| ${assetId(name)}["${label(name)}"]:::${statusClass(c.status)}`,
    )
  }
  graph.push(
    '  classDef version fill:#e8eaf6,stroke:#3f51b5',
    `  classDef ${statusClass('bumped')} fill:#d7f5dd,stroke:#2e7d4f`,
    `  classDef ${statusClass('bumped-local')} fill:#d7f5dd,stroke:#2e7d4f`,
    `  classDef ${statusClass('skipped')} fill:#eceff1,stroke:#78909c`,
    `  classDef ${statusClass('failed')} fill:#fadbd8,stroke:#c0392b`,
    `  classDef ${statusClass('push-withheld')} fill:#fdf0c8,stroke:#b8860b`,
    `  classDef ${statusClass('push-unconfirmed')} fill:#fdf0c8,stroke:#b8860b`,
    '```',
  )

  // Two propagate runs of the same version are normal, so the column has to carry the run's time
  // as well — a header with `1.11.60` twice reads as a rendering bug rather than as two waves.
  const columns = waves.map((w) => `${w.version} @${w.started_at.slice(11, 16)}`)
  const header = `| consumer | ${columns.join(' | ')} |`
  const divider = `| --- | ${waves.map(() => '---').join(' | ')} |`
  const rows = ordered.map((name) => {
    const cells = waves.map((w) => {
      const hit = w.consumers.find((c) => consumerName(c.consumer, consumerIds) === name)
      return hit ? hit.status : '—'
    })
    return `| ${name} | ${cells.join(' | ')} |`
  })

  return `${[
    '# clade fleet waves',
    '',
    'Projection of `.clade/metrics/propagate-performance.jsonl` — regenerate with `flow viz --fleet`.',
    'Edges exist only where a propagate run actually materialized that version into that consumer;',
    'there is no place to declare one, so this graph cannot show a dependency that never happened.',
    '',
    `- latest wave: ${latest.version} (${latest.started_at})`,
    `- waves shown: ${waves.length}`,
    `- consumers seen: ${ordered.length}`,
    '',
    '## Latest wave',
    '',
    graph.join('\n'),
    '',
    '## Wave history',
    '',
    header,
    divider,
    ...rows,
  ].join('\n')}\n`
}

function assetId(name: string): string {
  return `c_${name.replace(/[^A-Za-z0-9]/g, '_')}`
}
